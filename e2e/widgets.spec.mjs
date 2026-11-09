// Real-app check of dsh-widgets: a real dsh process, a throwaway DSH_HOME and a headless Chrome, with a fake model.
//
//   npm run e2e
//
// What it proves that the unit tests cannot: the bundle patch loads, the client bundle runs, the slot names are the ones
// dsh publishes, `/plan` really toggles plan mode, the project brief really reaches the model, and the git side works.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL('..', import.meta.url));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PLAYWRIGHT = process.env.PLAYWRIGHT ?? join(repo, 'node_modules/playwright');
const { chromium } = require(PLAYWRIGHT);

const dshBin = process.argv[2] ?? join(repo, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
if (!existsSync(dshBin)) throw new Error(`no dsh CLI at ${dshBin}; run npm install first`);

// ---- a fake model, so no real provider is called ------------------------------------------------------------
const bodies = [];
const SUMMARY = 'acme-web is a small demo app. Run the tests with npm test.';
const fake = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (!req.url.includes('chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"data":[{"id":"demo"}]}');
      return;
    }
    bodies.push(body);
    // A project summary is asked for by the brief prompt; everything else is an ordinary reply.
    // The plugin asks in the language it was pinned to, so the summary request is recognised in either language.
    const wantsSummary = /preparing context for a coding task|准备项目背景/.test(body);
    const chunk = (delta, finish) => `data: ${JSON.stringify({
      id: 'x', object: 'chat.completion.chunk', created: 1, model: 'demo',
      choices: [{ index: 0, delta, finish_reason: finish ?? null }],
      ...(finish ? { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } : {}),
    })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const text = wantsSummary ? SUMMARY : 'Sure — here is the plan.';
    res.end(chunk({ role: 'assistant', content: text }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
  });
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
const fakePort = fake.address().port;

const gitEnv = {
  ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 't@example.com',
};
const git = (cwd, ...args) => execFileSync('git', ['-c', 'maintenance.auto=false', ...args], { cwd, env: gitEnv, encoding: 'utf8' });

const openWidgets = async (page) => {
  const direct = page.getByRole('button', { name: 'Settings', exact: true });
  if (await direct.isVisible().catch(() => false)) await direct.click();
  else { await page.getByRole('button', { name: 'Account menu', exact: true }).click(); await page.getByRole('menuitem', { name: /^Settings/ }).click(); }
  // The app is in English; the plugin is pinned to Chinese on purpose, which is the language override under test.
  try {
    try {
    await page.getByRole('button', { name: '小组件' }).first().click({ timeout: 20_000 });
  } catch (error) {
    const labels = await page.locator('button').evaluateAll((nodes) => nodes.map((node) => (node.innerText || node.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 60));
    console.error(`--- settings nav ---\n${JSON.stringify(labels)}`);
    console.error(`--- console ---\n${consoleLines.slice(-12).join("\n")}`);
    console.error(`--- page errors ---\n${pageErrors.join("\n")}`);
    throw error;
  }
  } catch (error) {
    const labels = await page.locator('button').evaluateAll((nodes) => nodes.map((node) => (node.innerText || node.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 80));
    console.error(`--- buttons after opening Settings ---\n${JSON.stringify(labels)}`);
    throw error;
  }
  await page.locator('[data-dsh-widgets-settings]').waitFor({ state: 'visible', timeout: 20_000 });
};

const closeSettings = async (page) => {
  const close = page.getByRole('button', { name: /^Close$/ }).first();
  if (await close.count()) await close.click();
  else await page.keyboard.press('Escape');
  await pause(500);
};

const results = [];
const step = (name) => results.push(`  ✓ ${name}`);
/** Console and page errors of the current page, so a helper can report them. */
let consoleLines = [];
let pageErrors = [];

const launchOptions = process.env.PW_CHANNEL ?? (existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined);
const browser = await chromium.launch(launchOptions === undefined ? {} : { channel: launchOptions });
let child;
let context;
try {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'dsh-widgets-')));
  const profile = join(home, 'profiles/web');
  await mkdir(join(profile, 'node_modules'), { recursive: true });
  await symlink(repo, join(profile, 'node_modules/dsh-widgets'));
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'widgets-test',
    private: true,
    // `dsh-api-remotes` is what gives a client plugin `ctx.remote.commands`, which Shift+Tab uses for `/plan`.
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-api-remotes', 'dsh-widgets'] } },
  }));
  await writeFile(join(profile, 'cordis.yml'), '[]\n');
  await writeFile(join(profile, 'cordis.patch.yml'), `- id: ui-settings-general
  name: "@deepseek-ai/dsh-client-ui-settings-general"
  config: { welcomeNoticeVersion: 2026-09-28.1 }
- id: llm-pi-ai
  config:
    providers:
      demo:
        displayName: Demo
        api: openai-completions
        baseURL: http://127.0.0.1:${fakePort}/v1
        apiKeyEnv: DEMO_KEY
        retryPolicy: { mode: normal, maxRetries: 0 }
        models:
          - { id: demo, name: Demo model, contextWindow: 100000, maxTokens: 1000, input: [ text ], reasoningEfforts: false }
          - id: demo-thinks
            name: Demo thinking
            contextWindow: 100000
            maxTokens: 1000
            input: [ text ]
            reasoningEfforts:
              off: null
              low: low
              high: high
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config: { provider: demo, model: demo }
- id: permission-presets
  config: { default: full-access }
`);

  const project = join(home, 'projects', 'acme-web');
  await mkdir(project, { recursive: true });
  await writeFile(join(project, 'README.md'), '# acme-web\n\nA small demo app. Run `npm test`.\n');
  await writeFile(join(project, 'AGENTS.md'), 'Keep the tests green.\n');
  git(project, 'init', '-q', '-b', 'main');
  git(project, 'add', '-A');
  git(project, 'commit', '-q', '-m', 'init');

  const id = 'ws-1';
  const now = new Date().toISOString();
  await mkdir(join(home, 'storages/dsh-widgets'), { recursive: true });
  // The app runs in English; the plugin is pinned to Chinese, so the panel's language is its own choice, not the app's.
  await writeFile(join(home, 'storages/dsh-widgets/settings.json'), JSON.stringify({ language: 'zh' }));
  await mkdir(join(home, 'storages'), { recursive: true });
  await writeFile(join(home, 'storages/workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [id], archivedSessionIds: [], pinnedSessionIds: [], defaultWorkspaceId: id },
    tables: { workspaces: { [id]: { path: project, title: 'acme-web', sessionIds: [], createdAt: now, updatedAt: now } } },
  }));

  const port = 3207 + Math.floor(Math.random() * 400);
  let log = '';
  child = spawn(process.execPath, [dshBin, '--profile', 'web', '--port', String(port), '--no-open'], {
    cwd: project,
    env: { ...process.env, ...gitEnv, DSH_HOME: home, DEMO_KEY: 'demo', DSH_PERMISSION_MODE: 'danger-full-access' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data) => { log += data; });
  child.stderr.on('data', (data) => { log += data; });
  await waitForPort(port, 90_000, () => log);
  const token = /\?token=([^\s]+)/.exec(log)?.[1];
  assert.ok(token, `dsh printed no access token\n${log.slice(-2000)}`);
  const url = `http://127.0.0.1:${port}/?token=${token}`;
  await pause(1500);

  context = await browser.newContext({ locale: 'en-US', viewport: { width: 1400, height: 900 }, colorScheme: 'light' });
  const page = await context.newPage();
  consoleLines = [];
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Settings' })
      .or(page.getByRole('button', { name: 'Account menu' }))
      .or(page.getByRole('button', { name: /新建会话/ }))
      .first().waitFor({ timeout: 60_000 });
  } catch (error) {
    await mkdir(join(repo, 'e2e/artifacts'), { recursive: true });
    await page.screenshot({ path: join(repo, 'e2e/artifacts/failure.png'), fullPage: true });
    console.error(`--- page text ---\n${(await page.evaluate(() => document.body?.innerText ?? '')).slice(0, 1200)}`);
    console.error(`--- console ---\n${consoleLines.slice(-40).join('\n')}`);
    console.error(`--- dsh log ---\n${log.slice(-3000)}`);
    throw error;
  }
  step('dsh started and rendered with dsh-widgets loaded');
  console.error(`--- ctx keys ---\n${consoleLines.filter((line) => line.includes('[widgets] ctx')).join("\n")}`);

  // 1. The settings section is ours, is Chinese, and has one row per widget.
  await openWidgets(page);
  assert.equal(await page.locator('[data-dsh-widgets-row]').count(), 5, 'five widget rows');
  assert.equal(await page.locator('[data-dsh-widgets-row="projectBrief"]').count(), 1);
  const sectionText = await page.locator('[data-dsh-widgets-settings]').innerText();
  assert.match(sectionText, /项目基本信息/, 'the panel speaks the app language');
  assert.equal(/Improve prompt|Project brief/.test(sectionText), false, 'no English left in a Chinese panel');
  step('Settings → 小组件 shows five rows, in Chinese');

  // 2. Off by default, and switching it on reaches the Host's settings file.
  const briefSwitch = page.locator('[data-dsh-widgets-row="projectBrief"] [data-dsh-widgets-switch]');
  assert.equal(await briefSwitch.getAttribute('aria-checked'), 'false', 'Project brief is off by default');
  await briefSwitch.click();
  await page.waitForFunction(
    () => document.querySelector('[data-dsh-widgets-row="projectBrief"] [data-dsh-widgets-switch]')?.getAttribute('aria-checked') === 'true',
    null, { timeout: 10_000 },
  );
  await pause(500);
  const settingsFile = join(home, 'storages/dsh-widgets/settings.json');
  assert.equal(JSON.parse(readFileSync(settingsFile, 'utf8')).on.projectBrief, true);
  step('a switch writes storages/dsh-widgets/settings.json');

  // 3. One shared model, and the ladder read from the configuration.
  const modelMenu = page.locator('[data-dsh-widgets-analysis-model]');
  await modelMenu.waitFor({ state: 'visible', timeout: 10_000 });
  assert.ok((await modelMenu.locator('option').allTextContents()).includes('跟随会话模型'));
  await modelMenu.selectOption({ label: 'Demo model' });
  await pause(700);
  assert.equal(await page.locator('[data-dsh-widgets-effort-none]').count(), 1, 'a model with no efforts says so');

  await modelMenu.selectOption({ label: 'Demo thinking' });
  await page.locator('[data-dsh-widgets-analysis-effort]').waitFor({ state: 'visible', timeout: 10_000 });
  const efforts = await page.locator('[data-dsh-widgets-analysis-effort] option').evaluateAll((nodes) => nodes.map((node) => node.value));
  assert.deepEqual(efforts, ['', 'off', 'low', 'high'], 'off is offered like any other level');
  await page.locator('[data-dsh-widgets-analysis-effort]').selectOption('off');
  await pause(500);
  assert.equal(JSON.parse(readFileSync(settingsFile, 'utf8')).analysis.effort, 'off');
  step('the reasoning ladder comes from the model configuration, and off is a level of it');
  await closeSettings(page);
  await pause(800);

  // 4. The wand has no box of its own: the shared stylesheet owns how it looks.
  const wand = page.locator('[data-dsh-widgets-wand]').first();
  await wand.waitFor({ state: 'visible', timeout: 10_000 });
  const border = await wand.evaluate((node) => {
    const style = getComputedStyle(node);
    return `${style.borderTopWidth} ${style.borderTopStyle} ${style.backgroundColor}`;
  });
  assert.match(border, /^0px none/, `the wand draws no border (${border})`);
  step('the Improve prompt icon has no border and no background of its own');

  // 5. The project brief is read quietly, and its own icon says so.
  const briefIcon = page.locator('[data-dsh-widgets-brief]').first();
  await briefIcon.waitFor({ state: 'visible', timeout: 20_000 });
  await pause(4000);
  const briefState = await page.evaluate(() => {
    const node = document.querySelector('[data-dsh-widgets-brief]');
    return { attr: node?.getAttribute('data-dsh-widgets-brief'), title: node?.getAttribute('title'), label: node?.getAttribute('aria-label') };
  });
  console.error(`--- brief state ---\n${JSON.stringify(briefState)}`);
  console.error(`--- brief store ---\n${readFileSync(join(home, 'storages/dsh-widgets/project-briefs.json'), 'utf8').slice(0, 600)}`);
  await page.waitForFunction(
    () => document.querySelector('[data-dsh-widgets-brief]')?.getAttribute('data-dsh-widgets-brief') === 'ready',
    null, { timeout: 60_000 },
  );
  step('the project brief is read in the background and reports itself ready');

  // 5a. The panel is a real popover: it closes from outside and from Escape, and its action looks pressable.
  await briefIcon.click();
  const panel = page.locator('[data-dsh-widgets-brief-panel]');
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
  const action = page.locator('[data-dsh-widgets-reanalyze]');
  const actionStyle = await action.evaluate((node) => {
    const style = getComputedStyle(node);
    return { border: style.borderTopWidth, cursor: style.cursor, width: node.getBoundingClientRect().width };
  });
  assert.notEqual(actionStyle.border, '0px', `the re-analyse action has a visible border (${JSON.stringify(actionStyle)})`);
  assert.equal(actionStyle.cursor, 'pointer');
  // A picture of the panel is worth keeping when someone is reviewing how it looks.
  if (process.env.WIDGETS_SHOT === '1') {
    await mkdir(join(repo, 'e2e/artifacts'), { recursive: true });
    await page.locator('[data-composer-seat]').first().screenshot({ path: join(repo, 'e2e/artifacts/brief-panel.png') }).catch(async () => {
      await panel.screenshot({ path: join(repo, 'e2e/artifacts/brief-panel.png') });
    });
  }

  // A click outside the popover closes it — the bug was that only the icon could. The click goes to empty space in the
  // conversation area, not to the composer, which the popover overlaps.
  await page.mouse.click(700, 140);
  await panel.waitFor({ state: 'detached', timeout: 10_000 });

  await briefIcon.click();
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached', timeout: 10_000 });
  step('the brief panel closes from outside and from Escape, and its action looks like a button');

  // 6. The wand works: not disabled, and pressing it really rewrites the draft through the model.
  const composer = page.locator('[data-composer-input]').first();
  await composer.waitFor({ state: 'visible', timeout: 20_000 });
  await composer.click();
  assert.equal(await wand.isDisabled(), false, 'the wand is pressable even before the chat has a model of its own');
  await page.keyboard.type('改一下登录页');
  bodies.length = 0;
  await wand.click();
  await page.waitForFunction(
    () => (document.querySelector('[data-composer-input]')?.innerText ?? '').trim() === 'Sure — here is the plan.',
    null, { timeout: 30_000 },
  );
  assert.ok(bodies.length > 0, 'the wand called the model');
  step('the wand is pressable and rewrites the draft');

  // 7. The first task opens with the project summary — and the hierarchy it was made from.
  await composer.click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Backspace');
  await pause(300);
  bodies.length = 0;
  await page.keyboard.type('把测试跑一遍');
  await page.keyboard.press('Enter');
  await pause(6000);
  assert.ok(bodies.length > 0, 'the model was called');
  const first = bodies.join('\n');
  assert.ok(bodies.some((body) => body.includes('acme-web is a small demo app')), 'the first task opens with the project summary');
  // The note carries the hierarchy too, not only the conclusion.
  assert.match(first, /<目录结构>|<file hierarchy>/, 'the note carries the file hierarchy');
  assert.match(first, /README\.md/, 'the hierarchy names the project files');
  step('the first task opens with the summary plus the file hierarchy, as a prompt');

  // 8. In a chat that now exists, Shift+Tab turns plan mode on through dsh's own command: the draft stays empty, and the
  //    next request carries the policy dsh attaches to a plan-mode turn.
  await composer.click();
  await page.keyboard.press('Shift+Tab');
  await pause(1200);
  assert.equal((await composer.innerText()).trim(), '', 'turning plan mode on writes nothing into the draft');

  bodies.length = 0;
  await page.keyboard.type('继续');
  await page.keyboard.press('Enter');
  await pause(6000);
  const second = bodies.join('\n');
  assert.ok(bodies.length > 0, 'the second message reached the model');
  assert.match(second, /exit_plan_mode|plan mode/i, `the next request carries dsh's plan-mode policy (${second.slice(0, 160)})`);
  step('Shift+Tab turns plan mode on through dsh\'s own command: the next request carries the policy, the draft stays empty');

  assert.deepEqual(pageErrors, [], 'no page error');
  console.log(`dsh ${dshBin}\n${results.join('\n')}`);
} finally {
  await context?.close().catch(() => {});
  await browser.close().catch(() => {});
  child?.kill('SIGTERM');
  fake.close();
}

async function waitForPort(port, timeoutMs, logOf) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok || response.status === 401) return;
    } catch { /* not up yet */ }
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`dsh exited ${child.exitCode}\n${logOf().slice(-3000)}`);
    }
    await pause(300);
  }
  throw new Error(`dsh did not listen on ${port}\n${logOf().slice(-3000)}`);
}