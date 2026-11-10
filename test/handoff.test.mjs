// Handoff: the transcript, the two prompts, and the route that creates a same-project session and sends the handoff.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HANDOFF_PATH, detectHandoffLanguage, handoffContinuation, handoffSystem, handoffSummaryPrompt, handoffTitle,
  handoffTranscript, installHandoff,
} from '../dist/index.js';
import { call, makeCtx, tempDir } from './helpers.mjs';

const tempHandoffs = () => readdirSync(tmpdir()).filter((name) => name.startsWith('dsh-widgets-handoff-'));

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

// Long histories keep the tail and say that they were trimmed.
const long = handoffTranscript(Array.from({ length: 200 }, (_, index) => ({
  type: 'user/message',
  data: { content: [{ type: 'text', text: `message-${index}` }], source: { kind: 'user' } },
})));
assert.match(long, /^\(earlier messages omitted\)/);
assert.ok(long.includes('message-199'));
assert.equal(long.includes('message-0'), false);
assert.match(handoffTranscript([{ type: 'user/message', data: { content: [{ type: 'text', text: '   ' }] } }]), /^$/);

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
assert.equal(detectHandoffLanguage([user('日本語のタスク')]), 'en', 'kana is not mistaken for Chinese');
assert.equal(detectHandoffLanguage([user('한국어 작업')]), 'en', 'hangul is not mistaken for Chinese');
assert.equal(detectHandoffLanguage([user('brief noise'), { type: 'user/message', data: { content: [{ type: 'text', text: '中文任务' }], source: { kind: 'dsh-widgets-note' } } }]), 'en', 'the plugin note is not user language');

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

// ---- the route --------------------------------------------------------------------------------------------------------
function setup({ history = true, project = true, workspace = true, promptFails = false, language = 'auto', noModel = false, historyLanguage = 'en' } = {}) {
  const home = tempDir();
  const projectDir = join(home.dir, 'project');
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(join(home.dir, 'storages/dsh-widgets'), { recursive: true });
  writeFileSync(join(home.dir, 'storages/dsh-widgets/settings.json'), JSON.stringify({
    analysis: { model: { provider: 'p', model: 'm' } },
    language,
  }));

  const streams = [];
  const llm = {
    listProviders: () => [{ id: 'p', name: 'P' }],
    listModels: async () => [],
    resolveModelInfo: async () => ({}),
    prepareCall: async (config) => ({
      config,
      stream(options) {
        streams.push(options);
        return (async function* generate() {
          yield { type: 'text-delta', text: '## Project and goal\nFix login.\n\n## Next steps\nRun tests.' };
          yield { type: 'finish', reason: { kind: 'stop' } };
        })();
      },
    }),
  };
  const events = history ? [
    { type: 'user/message', data: { content: [{ type: 'text', text: historyLanguage === 'zh' ? '改一下登录页' : 'fix login' }], source: { kind: 'user' } } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'changed the form' }] } } },
  ] : [];
  const sessionQuery = {
    observeSession: async () => ({
      header: { id: 's1', ...(project ? { cwd: projectDir } : {}) },
      events,
      projections: { values: { plan: { active: true } } },
    }),
    readTitle: async () => ({ title: { text: historyLanguage === 'zh' ? '登录修复' : 'Original task' } }),
  };
  const workspaceRegistry = workspace
    ? { list: () => [], create: async () => ({ id: 'ws-1', path: projectDir }), resolveByPath: async () => ({ id: 'ws-1', path: projectDir, title: 'Project' }), archiveSession: async () => {} }
    : { list: () => [], create: async () => ({ id: 'ws-1', path: projectDir }) };
  let createdRequest;
  let promptRequest;
  let renameRequest;
  const sessionController = {
    resolveAgent: async () => ({ agent: {} }),
    create: async (request) => { createdRequest = request; return { sessionId: 'new-1' }; },
    rename: async (request) => { renameRequest = request; return {}; },
    prompt: async (request) => {
      if (promptFails) throw new Error('prompt failed');
      promptRequest = request;
      return { accepted: true };
    },
  };
  const services = { ...(noModel ? {} : { llm }), sessionQuery, ...(workspace ? { workspaceRegistry } : {}) };
  const { ctx, routes } = makeCtx({ services, ctx: { sessionController } });
  if (!workspace) ctx.get = (name) => (name === 'workspaceRegistry' ? undefined : services[name]);
  const archivedCalls = [];
  if (workspace) workspaceRegistry.archiveSession = async (id) => { archivedCalls.push(id); };
  installHandoff(ctx, home.dir);
  return { home, routes, projectDir, streams, createdRequest: () => createdRequest, promptRequest: () => promptRequest, renameRequest: () => renameRequest, archivedCalls, promptFails };
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

{
  const rt = setup({ noModel: true });
  const response = await call(rt.routes, HANDOFF_PATH, { method: 'POST', body: { sessionId: 's1' } });
  assert.equal(response.status, 409);
  assert.match(response.json.error, /cannot call a model/);
  rt.home.cleanup();
}

console.log('handoff checks passed');