// Handoff: the transcript, the two prompts, and the route that creates a same-project session and sends the handoff.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HANDOFF_PATH, detectHandoffLanguage, handoffContinuation, handoffLanguageOk, handoffLanguageRepairPrompt,
  handoffSystem, handoffSummaryPrompt, handoffTitle, handoffTranscript, installHandoff,
} from '../dist/index.js';
import { call, makeCtx, tempDir } from './helpers.mjs';

const tempHandoffs = () => readdirSync(tmpdir()).filter((name) => name.startsWith('dsh-widgets-handoff-'));
/** One harness-injected user message: time samples, runtime snapshots, skill catalogues, mode notices. */
const narration = (kind, text) => ({ type: 'user/message', data: { content: [{ type: 'text', text }], source: { kind, form: 'snapshot' } } });

// ---- transcript extraction --------------------------------------------------------------------------------------------
const transcript = handoffTranscript([
  { type: 'system/message', data: { message: { content: [{ type: 'text', text: 'system prompt' }] } } },
  { type: 'user/message', data: { content: [{ type: 'text', text: 'fix the login page' }], source: { kind: 'user' } } },
  { type: 'user/message', data: { content: [{ type: 'text', text: 'brief noise' }], source: { kind: 'dsh-widgets-note' } } },
  { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'I changed the form.' }] } } },
  { type: 'tool/call', data: { name: 'bash', arguments: '{"command":"npm test"}' } },
  { type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'all tests passed' }] } } },
]);
assert.match(transcript, /\[user\]\nfix the login page/);
assert.match(transcript, /\[assistant\]\nI changed the form\./);
assert.match(transcript, /\[tool\] bash/);
assert.match(transcript, /\[tool result\]\nall tests passed/);
assert.equal(transcript.includes('brief noise'), false, 'the plugin brief is not the user task');
assert.equal(transcript.includes('system prompt'), false, 'the system prompt is not handoff material');

// Harness narration is not the task either, and it must not eat the transcript budget.
const narrated = handoffTranscript([
  { type: 'user/message', data: { content: [{ type: 'text', text: 'fix the login page' }], source: { kind: 'user' } } },
  narration('runtime-context', 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.'),
  narration('time-context', 'Time sampled while preparing turn 1, step 1: 2026-11-09T14:21:22+08:00.'),
  narration('skill-catalog', 'A skill is a reusable set of task-specific instructions.'),
  narration('plan-mode', 'The user switched this session to plan mode.'),
  { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'changed the form.' }] } } },
]);
assert.match(narrated, /\[user\]\nfix the login page/);
assert.match(narrated, /\[assistant\]\nchanged the form\./);
for (const noise of ['runtime context', 'Time sampled', 'reusable set of task-specific', 'switched this session to plan mode']) {
  assert.equal(narrated.toLowerCase().includes(noise.toLowerCase()), false, `"${noise}" is not handoff material`);
}

// Long histories keep the tail and say that they were trimmed.
const long = handoffTranscript(Array.from({ length: 200 }, (_, index) => ({
  type: 'user/message',
  data: { content: [{ type: 'text', text: `message-${index}` }], source: { kind: 'user' } },
})));
assert.match(long, /^\(earlier messages omitted\)/);
assert.ok(long.includes('message-199'));
assert.equal(long.includes('message-0'), false);
const huge = handoffTranscript([{ type: 'user/message', data: { content: [{ type: 'text', text: 'x'.repeat(30_000) }], source: { kind: 'user' } } }]);
assert.match(huge, /^\(earlier messages omitted\)/);
assert.ok(huge.length < 30_000, 'a single huge message is clipped');
assert.match(handoffTranscript([{ type: 'user/message', data: { content: [{ type: 'text', text: '   ' }] } }]), /^$/);

// A long tail of assistant and tool output must not squeeze the human's own task out of the transcript.
{
  const events = [
    { type: 'user/message', data: { content: [{ type: 'text', text: '把登录页的校验补上' }], source: { kind: 'user' } } },
    ...Array.from({ length: 20 }, (_, index) => ({
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: `assistant-step-${index} ${'x'.repeat(2000)}` }] } },
    })),
  ];
  const bounded = handoffTranscript(events);
  assert.match(bounded, /^\(earlier messages omitted/, 'the transcript still says what was dropped');
  assert.ok(bounded.includes('把登录页的校验补上'), 'the human message before the tail is reserved');
  assert.ok(bounded.includes('messages between these and the following transcript omitted'), 'the reserved part is labelled');
  assert.ok(bounded.length < 24_000 + 2_500, `the transcript and its reserve stay bounded (${bounded.length})`);
  assert.ok(bounded.indexOf('把登录页的校验补上') < bounded.indexOf('assistant-step-19'), 'the reserved message comes first');

  // A short history is unchanged: no reserve machinery leaks into the normal case.
  const short = handoffTranscript(events.slice(0, 2));
  assert.equal(short.startsWith('(earlier messages omitted)'), false);
  assert.ok(short.includes('把登录页的校验补上'));
}

// ---- language detection follows the human, not the model or the plugin UI --------------------------------------------
const user = (text) => ({ type: 'user/message', data: { content: [{ type: 'text', text }], source: { kind: 'user' } } });
const assistant = (text) => ({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } });

assert.equal(detectHandoffLanguage([user('改一下登录页'), user('继续')]), 'zh');
assert.equal(detectHandoffLanguage([user('fix login'), user('continue')]), 'en');
assert.equal(detectHandoffLanguage([user('fix 登录页')]), 'zh', 'a mixed technical message still reads Chinese');
assert.equal(detectHandoffLanguage([user('中文任务'), assistant('I changed the form.')]), 'zh', 'assistant English does not flip the language');
assert.equal(detectHandoffLanguage([user('中文任务'), user('continue')]), 'en', 'the most recent natural user message wins');
assert.equal(detectHandoffLanguage([user('中文任务'), user('`npm test`')]), 'zh', 'a code-only message is skipped');
assert.equal(detectHandoffLanguage([], '登录修复'), 'zh', 'the title is the fallback when there is no user text');
assert.equal(detectHandoffLanguage([], ''), 'en');
assert.equal(detectHandoffLanguage([], 'Project X'), 'en', 'a Latin title falls back to English');
assert.equal(detectHandoffLanguage([user('日本語のタスク')]), 'en', 'kana is not mistaken for Chinese');
assert.equal(detectHandoffLanguage([user('한국어 작업')]), 'en', 'hangul is not mistaken for Chinese');
assert.equal(detectHandoffLanguage([user('brief noise'), { type: 'user/message', data: { content: [{ type: 'text', text: '中文任务' }], source: { kind: 'dsh-widgets-note' } } }]), 'en', 'the plugin note is not user language');

// The harness narrates in English while the human writes Chinese: narration is not a language signal.
assert.equal(
  detectHandoffLanguage([
    user('改一下登录页并补测试'),
    narration('runtime-context', 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.'),
    narration('time-context', 'Time sampled while preparing turn 2, step 39: 2026-11-10T10:31:19+08:00.'),
    narration('skill-catalog', 'A skill is a reusable set of task-specific instructions.'),
    narration('plan-mode', 'The user switched this session to plan mode.'),
  ]),
  'zh',
  'harness narration does not outvote the human language',
);
assert.equal(
  detectHandoffLanguage([narration('time-context', 'Time sampled while preparing turn 1, step 1.')], '登录修复'),
  'zh',
  'with no human message at all, the title still decides',
);
assert.equal(
  detectHandoffLanguage([{ type: 'user/message', data: { content: [{ type: 'text', text: 'fix the login page' }] } }]),
  'en',
  'a message with no source tag is still the human',
);

// ---- the prompts ------------------------------------------------------------------------------------------------------
const meta = { cwd: '/repo/app', workspaceTitle: 'App', sessionId: 's1', sessionTitle: 'Login fix', planActive: true };
const summaryPrompt = handoffSummaryPrompt(meta, '[user]\nfix login', 'en');
assert.match(summaryPrompt, /<project>\/repo\/app<\/project>/);
assert.match(summaryPrompt, /<workspace>App<\/workspace>/);
assert.match(summaryPrompt, /<session>Login fix<\/session>/);
assert.match(summaryPrompt, /<plan-mode>The previous session was in plan mode\.<\/plan-mode>/);
assert.match(summaryPrompt, /## Current plan and next steps/);
assert.match(summaryPrompt, /## Risks, unverified items and open questions/);
assert.match(summaryPrompt, /## Acceptance checks for continuing/);
assert.match(summaryPrompt, /same natural language as the user's messages/);
assert.match(summaryPrompt, /<transcript>\n\[user\]\nfix login\n<\/transcript>/);

const zhPrompt = handoffSummaryPrompt(meta, 'x', 'zh');
assert.match(zhPrompt, /## 当前计划与下一步/);
assert.match(zhPrompt, /必须使用中文/);
assert.match(zhPrompt, /不要用 todo 状态代替计划/);
assert.match(zhPrompt, /必须区分：已完成、进行中、未验证、阻塞/);
assert.match(zhPrompt, /## 继续工作的验收条件/);

assert.match(handoffSystem('zh'), /中文交接说明/);
assert.match(handoffSystem('en'), /same natural language as the user's messages/);
assert.equal(handoffLanguageOk('## 项目与目标\n修复登录页并补充测试。\n\n## 当前计划与下一步\n运行测试。', 'zh'), true);
assert.equal(handoffLanguageOk('## 项目与目标\n修复登录。', 'zh'), true, 'a concise Chinese handoff still passes');
assert.equal(handoffLanguageOk('## Project and goal\nFix login.\n\n## Next steps\nRun tests.', 'zh'), false, 'a Chinese session rejects an English handoff');
assert.equal(handoffLanguageOk('', 'zh'), false);
assert.equal(handoffLanguageOk('## Project and goal\nFix login.', 'en'), true);
assert.match(handoffLanguageRepairPrompt('## Project and goal\nFix login.', 'zh'), /上一份交接没有使用中文/);

const continuation = handoffContinuation('## Goal\nShip it.', meta, 'en');
assert.match(continuation, /<handoff>\n## Goal\nShip it\.\n<\/handoff>/);
assert.match(continuation, /Continue in the language of the handoff/);
assert.match(continuation, /Treat this handoff as the previous session's task history/);
assert.match(continuation, /Continue expanding the plan/);
assert.match(continuation, /Do not start implementing until the user explicitly approves/);
assert.match(continuation, /Do not repeat completed work/);
const zhContinuation = handoffContinuation('x', meta, 'zh');
assert.match(zhContinuation, /请使用中文继续/);
assert.match(zhContinuation, /继续拓展计划/);
assert.equal(handoffTitle(meta, 'en'), 'Handoff — Login fix');
assert.equal(handoffTitle(meta, 'zh'), '交接 — Login fix');
assert.equal(handoffTitle({ ...meta, sessionTitle: undefined }, 'en'), 'Handoff — app');
assert.equal(handoffTitle({ ...meta, sessionTitle: undefined }, 'zh'), '交接 — app');

// Handing off a handoff must not stack prefixes.
assert.equal(handoffTitle({ ...meta, sessionTitle: 'Handoff — Login fix' }, 'zh'), '交接 — Login fix', 'a Latin prefix is not stacked');
assert.equal(handoffTitle({ ...meta, sessionTitle: '交接 — 登录修复' }, 'en'), 'Handoff — 登录修复', 'a Chinese prefix is not stacked');
assert.equal(handoffTitle({ ...meta, sessionTitle: '交接 — 交接 — 登录修复' }, 'zh'), '交接 — 登录修复', 'prefixes do not accumulate');
assert.equal(handoffTitle({ ...meta, sessionTitle: 'Handoff — ' }, 'en'), 'Handoff — app', 'a bare prefix falls back to the project');

// ---- the route --------------------------------------------------------------------------------------------------------
function setup({
  history = true, project = true, workspace = true, promptFails = false, language = 'auto', noModel = false,
  historyLanguage = 'en', summaries, modelFails = false, titleFails = false, workspaceThrows = false,
  archiveFails = false, noSessionController = false, noCreate = false, longHistory = false,
  holdModel = undefined, observeDelayMs = 0, modelEfforts = undefined, settingsEffort = undefined,
  events: eventsOverride = undefined, planActive = true, commands: commandsMode = 'ok',
} = {}) {
  const home = tempDir();
  const projectDir = join(home.dir, 'project');
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(join(home.dir, 'storages/dsh-widgets'), { recursive: true });
  writeFileSync(join(home.dir, 'storages/dsh-widgets/settings.json'), JSON.stringify({
    analysis: { model: { provider: 'p', model: 'm' }, ...(settingsEffort === undefined ? {} : { effort: settingsEffort }) },
    language,
  }));

  const streams = [];
  const defaultSummary = historyLanguage === 'zh'
    ? '## 项目与目标\n修复登录页并补充测试。\n\n## 当前计划与下一步\n运行测试并继续拓展计划。\n\n## 继续工作的验收条件\n测试全部通过。'
    : '## Project and goal\nFix login.\n\n## Next steps\nRun tests.';
  const queue = [...(summaries ?? [defaultSummary])];
  const nextSummary = () => (queue.length > 1 ? queue.shift() : queue[0]);
  const preparedConfigs = [];
  const infoAt = [];
  let observeResolvedAt = 0;
  const llm = {
    listProviders: () => [{ id: 'p', name: 'P' }],
    listModels: async () => [],
    resolveModelInfo: async () => {
      infoAt.push(Date.now());
      return modelEfforts === undefined ? {} : { reasoning: { efforts: modelEfforts, defaultEffort: modelEfforts.at(-1).id } };
    },
    prepareCall: async (config) => {
      preparedConfigs.push(config);
      return {
      config,
      stream(options) {
        streams.push(options);
        if (holdModel !== undefined) return (async function* generate() {
          await holdModel;
          yield { type: 'text-delta', text: nextSummary() };
          yield { type: 'finish', reason: { kind: 'stop' } };
        })();
        if (modelFails) {
          return (async function* generate() {
            yield { type: 'finish', reason: { kind: 'error', failure: { message: 'handoff model failed' } } };
          })();
        }
        const text = nextSummary();
        return (async function* generate() {
          yield { type: 'text-delta', text };
          yield { type: 'finish', reason: { kind: 'stop' } };
        })();
      },
      };
    },
  };
  const events = eventsOverride ?? (longHistory
    ? [{ type: 'user/message', data: { content: [{ type: 'text', text: 'x'.repeat(30_000) }], source: { kind: 'user' } } }]
    : history ? [
      { type: 'user/message', data: { content: [{ type: 'text', text: historyLanguage === 'zh' ? '改一下登录页' : 'fix login' }], source: { kind: 'user' } } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'changed the form' }] } } },
    ] : []);
  const sessionQuery = {
    observeSession: async () => {
      if (observeDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, observeDelayMs));
      observeResolvedAt = Date.now();
      return {
        header: { id: 's1', ...(project ? { cwd: projectDir } : {}) },
        events,
        projections: { values: { plan: { active: planActive } } },
      };
    },
    readTitle: async () => {
      if (titleFails) throw new Error('title unavailable');
      return { title: { text: historyLanguage === 'zh' ? '登录修复' : 'Original task' } };
    },
  };
  const workspaceRegistry = workspace
    ? {
      list: () => [],
      create: async () => ({ id: 'ws-1', path: projectDir }),
      resolveByPath: async () => {
        if (workspaceThrows) throw new Error('workspace lookup failed');
        return { id: 'ws-1', path: projectDir, title: 'Project' };
      },
      archiveSession: async () => { if (archiveFails) throw new Error('archive failed'); },
    }
    : { list: () => [], create: async () => ({ id: 'ws-1', path: projectDir }) };
  let createdRequest;
  let promptRequest;
  let renameRequest;
  /** The order in which create, plan and prompt happened. */
  const order = [];
  let resolveAgentCalls = 0;
  const resolvedIds = [];
  const sessionController = {
    resolveAgent: async (sessionId) => {
      resolveAgentCalls += 1;
      resolvedIds.push(sessionId);
      return { agent: { session: { id: sessionId } } };
    },
    ...(noCreate ? {} : { create: async (request) => { order.push('create'); createdRequest = request; return { sessionId: 'new-1' }; } }),
    rename: async (request) => { renameRequest = request; return {}; },
    prompt: async (request) => {
      if (promptFails) throw new Error('prompt failed');
      order.push('prompt');
      promptRequest = request;
      return { accepted: true };
    },
  };
  const commandCalls = [];
  const commands = {
    execute: async (agent, line, attachments) => {
      commandCalls.push({ agent, line, attachments });
      order.push('plan');
      return commandsMode === 'error'
        ? { result: { kind: 'error', text: 'plan mode is unavailable' } }
        : { result: { kind: 'success', text: 'Plan mode on.' } };
    },
  };
  const services = {
    ...(noModel ? {} : { llm }), sessionQuery,
    ...(workspace ? { workspaceRegistry } : {}),
    ...(commandsMode === 'missing' ? {} : { commands }),
  };
  const { ctx, routes } = makeCtx({ services, ctx: noSessionController ? {} : { sessionController } });
  if (!workspace) ctx.get = (name) => (name === 'workspaceRegistry' ? undefined : services[name]);
  const archivedCalls = [];
  if (workspace && !archiveFails) workspaceRegistry.archiveSession = async (id) => { archivedCalls.push(id); };
  installHandoff(ctx, home.dir);
  return {
    home, routes, projectDir, streams, services, ctx,
    createdRequest: () => createdRequest, promptRequest: () => promptRequest, renameRequest: () => renameRequest,
    archivedCalls, promptFails,
    preparedConfigs, infoAt, observeResolvedAt: () => observeResolvedAt, resolveAgentCalls: () => resolveAgentCalls,
    resolveAgentIds: () => resolvedIds,
    commandCalls: () => commandCalls, order: () => order,
  };
}

{
  const before = tempHandoffs();
  const rt = setup();
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(response.json.sessionId, 'new-1');
  assert.match(response.json.handoff, /Fix login/);
  assert.deepEqual(rt.createdRequest(), { workspaceId: 'ws-1' }, 'the new session inherits the workspace');
  assert.equal(rt.promptRequest().sessionId, 'new-1');
  assert.match(rt.promptRequest().content[0].text, /Treat this handoff as the previous session's task history/);
  assert.match(rt.promptRequest().content[0].text, /Fix login/);
  assert.match(rt.streams[0].messages[0].content[0].text, /<transcript>\n\[user\]\nfix login/);
  assert.equal(existsSync(join(rt.projectDir, 'HANDOFF.md')), false, 'nothing is written into the project');
  assert.deepEqual(tempHandoffs(), before, 'the temporary handoff file is deleted');
  rt.home.cleanup();
}

{
  const rt = setup({ workspace: false });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.deepEqual(rt.createdRequest(), { cwd: rt.projectDir }, 'without a workspace the cwd is inherited');
  rt.home.cleanup();
}

{
  const rt = setup({ history: false });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 409);
  assert.match(response.json.error, /no task history/);
  rt.home.cleanup();
}

{
  const rt = setup({ project: false });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 409);
  assert.match(response.json.error, /no project folder/);
  rt.home.cleanup();
}

{
  const rt = setup({ promptFails: true });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 502);
  assert.match(response.json.error, /prompt failed/);
  assert.equal(rt.archivedCalls[0], 'new-1', 'a session left behind by a failed prompt is archived');
  rt.home.cleanup();
}

{
  const rt = setup();
  for (const body of ['x', {}, { sessionId: '' }, { sessionId: 'x'.repeat(201) }]) {
    assert.equal((await call(rt.routes, HANDOFF_PATH, { method: 'POST', body })).status, 400, JSON.stringify(body));
  }
  rt.home.cleanup();
}

// A Chinese conversation stays Chinese even when the plugin UI is pinned to English.
{
  const rt = setup({ historyLanguage: 'zh', language: 'en' });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.match(rt.streams[0].messages[0].content[0].text, /## 当前计划与下一步/);
  assert.match(rt.streams[0].messages[0].content[0].text, /必须使用中文/);
  assert.match(rt.promptRequest().content[0].text, /请使用中文继续/);
  assert.deepEqual(rt.renameRequest(), { sessionId: 'new-1', title: '交接 — 登录修复' });
  rt.home.cleanup();
}

// An English conversation stays English even when the plugin UI is pinned to Chinese.
{
  const rt = setup({ historyLanguage: 'en', language: 'zh' });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.match(rt.streams[0].messages[0].content[0].text, /## Current plan and next steps/);
  assert.match(rt.promptRequest().content[0].text, /Continue in the language of the handoff/);
  assert.deepEqual(rt.renameRequest(), { sessionId: 'new-1', title: 'Handoff — Original task' });
  rt.home.cleanup();
}

// A Chinese session that gets an English handoff is retried once with a corrective prompt.
{
  const rt = setup({
    historyLanguage: 'zh', language: 'en',
    summaries: ['## Project and goal\nEnglish only.', '## 项目与目标\n修复登录页并补充测试。\n\n## 当前计划与下一步\n运行测试。\n\n## 继续工作的验收条件\n测试通过。'],
  });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.match(response.json.handoff, /修复登录页/);
  assert.equal(rt.streams.length, 2, 'one corrective model call');
  assert.match(rt.streams[1].messages[0].content[0].text, /上一份交接没有使用中文/);
  rt.home.cleanup();
}

// Still English after the corrective call: fail loudly instead of sending the wrong language.
{
  const rt = setup({
    historyLanguage: 'zh', language: 'en',
    summaries: ['## Project and goal\nEnglish only.', '## Project and goal\nStill English.'],
  });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 502);
  assert.match(response.json.error, /Chinese handoff/);
  assert.equal(rt.promptRequest(), undefined, 'no session prompt was sent');
  rt.home.cleanup();
}

// A streamed model error is a 502, and no session is created.
{
  const rt = setup({ modelFails: true });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 502);
  assert.match(response.json.error, /handoff model failed/);
  assert.equal(rt.createdRequest(), undefined);
  rt.home.cleanup();
}

// A title-read failure does not block the handoff.
{
  const rt = setup({ titleFails: true, historyLanguage: 'zh', language: 'en' });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.deepEqual(rt.renameRequest(), { sessionId: 'new-1', title: '交接 — project' });
  rt.home.cleanup();
}

// A dsh without session creation fails before reading history or calling a model.
{
  for (const opts of [{ noSessionController: true }, { noCreate: true }]) {
    const rt = setup(opts);
    const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
    assert.equal(response.status, 409);
    assert.match(response.json.error, /cannot create a new session/);
    rt.home.cleanup();
  }
}

// A single huge message exercises character clipping in the transcript handed to the model.
{
  const rt = setup({ longHistory: true });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.match(rt.streams[0].messages[0].content[0].text, /\(earlier messages omitted\)/);
  rt.home.cleanup();
}

// If the workspace lookup fails, the new session still inherits the cwd.
{
  const rt = setup({ workspaceThrows: true });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.deepEqual(rt.createdRequest(), { cwd: rt.projectDir });
  rt.home.cleanup();
}

// An archive failure after a failed prompt does not replace the original error.
{
  const rt = setup({ promptFails: true, archiveFails: true });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 502);
  assert.match(response.json.error, /prompt failed/);
  rt.home.cleanup();
}

{
  const rt = setup({ noModel: true });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 409);
  assert.match(response.json.error, /cannot call a model/);
  rt.home.cleanup();
}

console.log('handoff checks passed');
// ---- the handoff is remembered, and outlives the request that started it -----------------------------------------------
const GET = (routes, sessionId) => call(routes, HANDOFF_PATH, { method: 'GET', search: { sessionId } });
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

{
  const rt = setup();
  assert.deepEqual((await GET(rt.routes, 's1')).json, { status: 'idle' }, 'a fresh session has no remembered handoff');
  assert.equal((await call(rt.routes, HANDOFF_PATH, { method: 'GET' })).status, 400, 'a status read needs a session');

  const post = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(post.status, 200, JSON.stringify(post.json));
  assert.equal(post.json.status, 'done');
  assert.equal(post.json.newSessionId, 'new-1');
  assert.equal(typeof post.json.timings.totalMs, 'number');
  assert.equal(post.json.timings.repaired, false);
  assert.equal(post.json.timings.outputChars > 0, true);
  assert.equal(post.json.timings.transcriptChars > 0, true);

  const view = (await GET(rt.routes, 's1')).json;
  assert.equal(view.status, 'done');
  assert.equal(view.newSessionId, 'new-1');
  assert.equal(view.timings.totalMs, post.json.timings.totalMs, 'the timings are remembered with the state');

  // The state is on disk, so a plugin reload still knows what happened.
  const { ctx: second, routes: secondRoutes } = makeCtx({ services: rt.services, ctx: { sessionController: rt.ctx.sessionController } });
  installHandoff(second, rt.home.dir);
  const recovered = (await GET(secondRoutes, 's1')).json;
  assert.equal(recovered.status, 'done');
  assert.equal(recovered.newSessionId, 'new-1');

  // Dismissing forgets it, and the next click is a new handoff.
  const dismissed = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1', dismiss: true } });
  assert.deepEqual(dismissed.json, { status: 'idle' });
  assert.equal((await GET(rt.routes, 's1')).json.status, 'idle');
  rt.home.cleanup();
}

// Switching sessions (or closing the page) cancels the wait, not the work.
{
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const rt = setup({ holdModel: gate });
  const controller = new AbortController();
  const pending = call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' }, signal: controller.signal });
  await tick();
  const running = (await GET(rt.routes, 's1')).json;
  assert.equal(running.status, 'running', 'the work is visible before it finishes');
  assert.equal(typeof running.startedAt, 'number');
  controller.abort();
  release();
  const finished = await pending;
  assert.equal(finished.status, 200, 'leaving the session does not cancel the handoff');
  assert.equal(rt.promptRequest()?.sessionId, 'new-1', 'the prompt was still sent');
  assert.equal((await GET(rt.routes, 's1')).json.status, 'done');
  rt.home.cleanup();
}

// A second click while the first runs joins it: one model call, one new session.
{
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const rt = setup({ holdModel: gate });
  const first = call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  await tick();
  const second = call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.json.sessionId, b.json.sessionId);
  assert.equal(rt.streams.length, 1, 'a double click spends one model call');
  rt.home.cleanup();
}

// A running handoff cannot be dismissed away from under the job that owns it.
{
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const rt = setup({ holdModel: gate });
  const pending = call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  await tick();
  const refused = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1', dismiss: true } });
  assert.equal(refused.status, 409);
  release();
  await pending;
  rt.home.cleanup();
}

// A running record left by a process that is gone is reported as interrupted, not as endless work.
{
  const rt = setup();
  mkdirSync(join(rt.home.dir, 'storages/dsh-widgets'), { recursive: true });
  writeFileSync(join(rt.home.dir, 'storages/dsh-widgets/handoffs.json'), JSON.stringify({
    handoffs: { s1: { status: 'running', startedAt: Date.now() - 1000, pid: process.pid + 1_000_000 } },
  }));
  const view = (await GET(rt.routes, 's1')).json;
  assert.equal(view.status, 'failed');
  assert.match(view.error, /interrupted/);
  const post = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(post.status, 200);
  assert.equal((await GET(rt.routes, 's1')).json.status, 'done', 'a fresh click replaces the interrupted record');
  rt.home.cleanup();
}

// ---- the pipeline does no work twice ----------------------------------------------------------------------------------
{
  const rt = setup({ observeDelayMs: 60 });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(rt.resolveAgentIds().filter((id) => id === 's1').length, 1, 'the handed-off agent is resolved once, not once per consumer');
  assert.equal(rt.resolveAgentIds().filter((id) => id === 'new-1').length, 1, 'the new session is resolved once, for plan mode');
  assert.equal(rt.infoAt.length, 1, 'the model metadata is resolved once');
  assert.ok(rt.infoAt[0] < rt.observeResolvedAt(), 'preparation starts while the history is still being read');
  rt.home.cleanup();
}

// ---- quality is not traded for speed -----------------------------------------------------------------------------------
{
  const rt = setup();
  await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(rt.preparedConfigs[0].maxTokens, 4000, 'the output ceiling stays at 4000 tokens');
  assert.equal(rt.preparedConfigs[0].reasoningEffort, undefined, 'a model without a ladder sends no effort');
  const prompt = rt.streams[0].messages[0].content[0].text;
  assert.match(prompt, /roughly 1000 words/, 'the handoff still asks for a full note');
  assert.equal(/600.900|≤\s*5\s*条|at most 5 bullets/.test(prompt), false, 'no compactness rule was added');
  rt.home.cleanup();

  // A pinned effort is honoured; an unpinned one keeps following the model, never a level the plugin picked.
  const pinned = setup({ modelEfforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }], settingsEffort: 'high' });
  await call(pinned.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(pinned.preparedConfigs[0].reasoningEffort, 'high');
  pinned.home.cleanup();

  const auto = setup({ modelEfforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }] });
  await call(auto.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(auto.preparedConfigs[0].reasoningEffort, 'high', 'without a pinned effort the model default still applies');
  auto.home.cleanup();
}

// A Chinese handoff whose headings are written differently is still Chinese: no second generation.
{
  const variants = [
    '### 项目与目标\n修复登录页并补充测试。\n\n### 当前计划与下一步\n运行测试。',
    '## **项目与目标**\n修复登录页并补充测试。\n\n## **当前计划与下一步**\n运行测试。',
    '## 1. 项目与目标\n修复登录页并补充测试。\n\n## 2. 当前计划与下一步\n运行测试。',
    '## 项目与目标（Project and goal）\n修复登录页并补充测试。\n\n## 当前计划与下一步\n运行测试。',
  ];
  for (const summary of variants) {
    const rt = setup({ historyLanguage: 'zh', summaries: [summary] });
    const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.equal(rt.streams.length, 1, `${summary.split('\n')[0]} does not buy a second generation`);
    rt.home.cleanup();
  }
}

// The corrective generation is still reported as its own phase.
{
  const rt = setup({
    historyLanguage: 'zh',
    summaries: ['## Project and goal\nEnglish only.', '## 项目与目标\n修复登录页并补充测试。\n\n## 当前计划与下一步\n运行测试。'],
  });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(response.json.timings.repaired, true);
  assert.equal(typeof response.json.timings.repairMs, 'number');
  assert.equal(rt.preparedConfigs.length, 2, 'the corrective call is prepared as its own call');
  rt.home.cleanup();
}

// A Chinese conversation whose most recent user messages are harness narration still gets a Chinese handoff.
{
  const rt = setup({
    summaries: ['## 项目与目标\n修复登录页并补充测试。\n\n## 当前计划与下一步\n运行测试。'],
    events: [
      { type: 'user/message', data: { content: [{ type: 'text', text: '改一下登录页并补充测试' }], source: { kind: 'user' } } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '已修改表单' }] } } },
      narration('runtime-context', 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.'),
      narration('time-context', 'Time sampled while preparing turn 3, step 1: 2026-11-10T10:31:19+08:00.'),
      narration('skill-catalog', 'A skill is a reusable set of task-specific instructions.'),
      narration('plan-mode', 'The user switched this session to plan mode.'),
    ],
  });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const prompt = rt.streams[0].messages[0].content[0].text;
  assert.match(prompt, /## 当前计划与下一步/, 'the Chinese template was chosen');
  assert.equal(prompt.includes('You are preparing a handoff note'), false, 'not the English template');
  assert.equal(prompt.includes('This snapshot supersedes'), false, 'harness narration is not in the transcript');
  assert.match(rt.renameRequest().title, /^交接 — /, 'the new session gets a Chinese title');
  assert.equal(response.json.timings.repaired, false, 'no corrective generation was needed');
  rt.home.cleanup();
}

// ---- plan mode is a state, not a sentence: a planning session's new session really enters plan mode ---------------------
{
  const rt = setup();
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const calls = rt.commandCalls();
  assert.equal(calls.length, 1, 'dsh\'s own plan command runs once');
  assert.equal(calls[0].line, '/plan', 'the new session is put into plan mode');
  assert.equal(calls[0].agent.session.id, 'new-1', 'the command acts on the new session, not the old one');
  assert.deepEqual(rt.order(), ['create', 'plan', 'prompt'], 'the mode is set before the continuation turn starts');
  assert.equal(response.json.timings.planApplied, true);
  rt.home.cleanup();
}

// A standard-mode session's new session stays standard, and the command is not run.
{
  const rt = setup({ planActive: false });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.deepEqual(rt.order(), ['create', 'prompt']);
  assert.equal(rt.commandCalls().length, 0);
  assert.equal(response.json.timings.planApplied, undefined);
  rt.home.cleanup();
}

// A dsh without a command registry, or a refused command, keeps the note and still hands off.
for (const mode of ['missing', 'error']) {
  const rt = setup({ commands: mode });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 200, `${mode}: ${JSON.stringify(response.json)}`);
  assert.equal(response.json.timings.planApplied, false, `${mode}: the mode was not applied`);
  assert.equal(rt.promptRequest()?.sessionId, 'new-1', `${mode}: the handoff still reached the new session`);
  rt.home.cleanup();
}
