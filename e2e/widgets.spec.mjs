// Real-app check of dsh-widgets: a real dsh process, a throwaway DSH_HOME and a headless Chrome, with a fake model.
//
//   npm run e2e
//
// What it proves that the unit tests cannot: the bundle patch loads, the client bundle builds and runs, the slot names are
// the ones dsh publishes, the Host routes answer, and the git side really runs.
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

// Playwright is a development dependency; PLAYWRIGHT can point at another copy.
const PLAYWRIGHT = process.env.PLAYWRIGHT
  ?? (() => { try { return join(repo, 'node_modules/playwright'); } catch { return ''; } })();
const { chromium } = require(PLAYWRIGHT);

// CI has no branded Chrome; locally the installed Chrome is the honest target.
const launchOptions = process.env.PW_CHANNEL ?? (existsSync('/Applications/Google Chrome.app') ? 'chrome' : undefined);

// The dsh under test: the one this repository develops against, or one given as the first argument.
const dshBin = process.argv[2] ?? join(repo, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
if (!existsSync(dshBin)) throw new Error(`no dsh CLI at ${dshBin}; run npm install first`);

// ---- a fake model, so no real provider is called ------------------------------------------------------------
const fake = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (!req.url.includes('chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"data":[{"id":"demo"}]}');
      return;
    }
    const chunk = (delta, finish) => `data: ${JSON.stringify({
      id: 'x', object: 'chat.completion.chunk', created: 1, model: 'demo',
      choices: [{ index: 0, delta, finish_reason: finish ?? null }],
      ...(finish ? { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } : {}),
    })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(chunk({ role: 'assistant', content: 'Rewritten: make the login form work end to end.' }) + chunk({}, 'stop') + 'data: [DONE]\n\n');
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
  await page.getByRole('button', { name: 'Close' }).first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
  // The settings nav is a row of buttons; ours is the one this plugin labels "Widgets".
  const nav = page.getByRole('button', { name: 'Widgets', exact: true });
  try {
    await nav.first().click({ timeout: 15_000 });
  } catch (error) {
    const names = await page.locator('[role="button"], button').evaluateAll((nodes) => nodes.map((n) => (n.innerText || n.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 60));
    console.error(`--- settings buttons ---\n${JSON.stringify(names)}`);
    throw error;
  }
  await page.locator('[data-dsh-widgets-settings]').waitFor({ state: 'visible', timeout: 20_000 });
};

const results = [];
const step = (name) => results.push(`  ✓ ${name}`);

const browser = await chromium.launch(launchOptions === undefined ? {} : { channel: launchOptions });
let child;
let context;
try {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'dsh-widgets-')));
  const profile = join(home, 'profiles/web');
  await mkdir(join(profile, 'node_modules'), { recursive: true });
  // The plugin under test, mounted the way `dsh plugin add` mounts it: a package in the profile.
  await symlink(repo, join(profile, 'node_modules/dsh-widgets'));
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'widgets-test',
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-widgets'] } },
  }));
  await writeFile(join(profile, 'cordis.yml'), '[]\n');
  await writeFile(join(profile, 'cordis.patch.yml'), `# A first start shows a welcome dialog whose mask covers the page; mark it as seen.
- id: ui-settings-general
  name: "@deepseek-ai/dsh-client-ui-settings-general"
  config:
    welcomeNoticeVersion: 2026-09-28.1
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
  await writeFile(join(project, 'README.md'), '# acme-web\n');
  git(project, 'init', '-q', '-b', 'main');
  git(project, 'add', '-A');
  git(project, 'commit', '-q', '-m', 'init');

  const id = 'ws-1';
  const now = new Date().toISOString();
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

  context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 820 }, colorScheme: 'light' });
  const page = await context.newPage();
  const errors = [];
  const consoleLines = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
  page.on('requestfailed', (request) => consoleLines.push(`failed ${request.url()} ${request.failure()?.errorText ?? ''}`));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await page.getByRole('button', { name: 'Settings', exact: true }).or(page.getByRole('button', { name: 'Account menu', exact: true })).first().waitFor({ timeout: 60_000 });
  } catch (error) {
    await mkdir(join(repo, 'e2e/artifacts'), { recursive: true });
    await page.screenshot({ path: join(repo, 'e2e/artifacts/failure.png'), fullPage: true });
    const text = (await page.evaluate(() => document.body?.innerText ?? '')).slice(0, 1200);
    console.error(`--- page text ---\n${text}`);
    console.error(`--- console ---\n${consoleLines.slice(-40).join('\n')}`);
    console.error(`--- page errors ---\n${errors.join('\n')}`);
    console.error(`--- dsh log ---\n${log.slice(-3000)}`);
    throw error;
  }
  step('dsh started and rendered with dsh-widgets loaded');

  await openWidgets(page);
  const rows = page.locator('[data-dsh-widgets-row]');
  assert.equal(await rows.count(), 6, 'six widget rows');
  step('Settings → Widgets shows the six rows');

  // Off by default, and switching it on reaches the Host's settings file.
  const branchTree = page.locator('[data-dsh-widgets-row="branchTree"] [data-dsh-widgets-switch]');
  assert.equal(await branchTree.getAttribute('aria-checked'), 'false', 'Branches in the workspace tree is off by default');
  await branchTree.click();
  await page.waitForFunction(
    () => document.querySelector('[data-dsh-widgets-row="branchTree"] [data-dsh-widgets-switch]')?.getAttribute('aria-checked') === 'true',
    null,
    { timeout: 10_000 },
  );
  await pause(500);
  const saved = JSON.parse(readFileSync(join(home, 'storages/dsh-widgets/settings.json'), 'utf8'));
  assert.equal(saved.on.branchTree, true, 'the switch reached the Host settings file');
  step('a switch writes storages/dsh-widgets/settings.json');

  // The reasoning menu follows the local model configuration.
  const modelMenu = page.locator('[data-dsh-widgets-improve-model]');
  await modelMenu.waitFor({ state: 'visible', timeout: 10_000 });
  const options = await modelMenu.locator('option').allTextContents();
  assert.ok(options.includes('Same as the chat'), 'the first entry follows the chat');
  await modelMenu.selectOption({ label: 'Demo model' });
  await pause(700);
  assert.equal(await page.locator('[data-dsh-widgets-effort-none]').count(), 1, 'a model with no efforts says so');
  step('a model without reasoningEfforts offers no effort menu');

  await modelMenu.selectOption({ label: 'Demo thinking' });
  await page.locator('[data-dsh-widgets-improve-effort]').waitFor({ state: 'visible', timeout: 10_000 });
  const efforts = await page.locator('[data-dsh-widgets-improve-effort] option').evaluateAll((nodes) => nodes.map((node) => node.value));
  assert.deepEqual(efforts, ['', 'off', 'low', 'high'], 'the ladder comes from the model configuration');
  await page.locator('[data-dsh-widgets-improve-effort]').selectOption('high');
  await pause(500);
  assert.equal(JSON.parse(readFileSync(join(home, 'storages/dsh-widgets/settings.json'), 'utf8')).improve.effort, 'high');
  step('the reasoning ladder is read from the model configuration, and the choice is saved');

  await page.keyboard.press('Escape');
  await pause(500);

  // The target picker rides the composer slot and the Host answers with the real branch.
  const branchButton = page.locator('[data-dsh-widgets-branch-open]').first();
  await branchButton.waitFor({ state: 'visible', timeout: 25_000 });
  await branchButton.click();
  await page.locator('[data-dsh-widgets-branch-panel]').waitFor({ state: 'visible', timeout: 10_000 });
  const modes = await page.locator('[data-dsh-widgets-mode] option').evaluateAll((nodes) => nodes.map((node) => node.value));
  assert.deepEqual(modes, ['current', 'branch', 'worktree', 'existing-branch', 'existing-worktree']);
  assert.equal(await page.locator('[data-dsh-widgets-mode]').inputValue(), 'current', 'the current branch is the default');
  step('the target picker is in the composer with all five modes, defaulting to the current branch');

  // A new worktree really creates a branch and a checkout — through the real Host route and real git.
  await page.locator('[data-dsh-widgets-mode]').selectOption('worktree');
  await page.locator('[data-dsh-widgets-branch-name]').fill('feat/from-the-app');
  await page.locator('[data-dsh-widgets-branch-start]').click();
  await page.waitForFunction(() => !document.querySelector('[data-dsh-widgets-branch-panel]'), null, { timeout: 30_000 });
  await pause(900);
  assert.equal(existsSync(join(project, '.worktrees', 'feat-from-the-app')), true, 'the worktree folder exists on disk');
  assert.equal(git(join(project, '.worktrees', 'feat-from-the-app'), 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'feat/from-the-app');
  assert.equal(git(project, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main', 'the project folder stayed on its branch');
  step('a new worktree created a real branch and checkout, and left the project folder alone');

  // Shift+Tab writes the /plan prefix dsh recognises, in the real composer.
  const composer = page.locator('[data-composer-input]').first();
  await composer.waitFor({ state: 'visible', timeout: 20_000 });
  await composer.click();
  await page.keyboard.press('Shift+Tab');
  await pause(500);
  const draft = await composer.innerText();
  assert.match(draft, /^\/plan\s*$/, `the composer holds the plan prefix, got ${JSON.stringify(draft)}`);
  await page.keyboard.press('Shift+Tab');
  await pause(500);
  assert.equal((await composer.innerText()).trim(), '', 'Shift+Tab again removes it');
  step('Shift+Tab writes and removes the /plan prefix in the real composer');

  assert.deepEqual(errors, [], 'no page error');
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