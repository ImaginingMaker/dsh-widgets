// Project brief route: off means off, a read never blocks, the model is clipped, and a failure is visible and retryable.
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRIEF_MAX_TOKENS, BRIEF_PATH, installBrief } from '../dist/index.js';
import { call, makeCtx, makeLlm, realSubprocess, tempDir } from './helpers.mjs';

function setup({ on = true, language = 'auto', pinned = true, summary = 'A small app.', fail = false } = {}) {
  const home = tempDir();
  const projectPath = join(home.dir, 'project');
  mkdirSync(projectPath, { recursive: true });
  const project = realpathSync(projectPath);
  writeFileSync(join(project, 'README.md'), '# app\n\nRun the tests with npm test.\n');
  mkdirSync(join(home.dir, 'storages/dsh-widgets'), { recursive: true });
  writeFileSync(join(home.dir, 'storages/dsh-widgets/settings.json'), JSON.stringify({
    on: { projectBrief: on },
    analysis: { model: pinned ? { provider: 'p', model: 'm' } : null },
    language,
  }));

  const llm = makeLlm({ p: { models: [{ id: 'm', name: 'M' }] } }, { preparers: () => summary });
  if (fail) {
    const originalPrepare = llm.prepareCall;
    llm.prepareCall = async (config) => {
      llm.calls.push(config);
      return {
        config,
        stream: () => (async function* generate() {
          yield { type: 'finish', reason: { kind: 'error', failure: { message: 'model down' } } };
        })(),
      };
    };
  }
  const { ctx, routes } = makeCtx({
    services: { llm },
    sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd: project } } }) } },
    ctx: { subprocess: realSubprocess() },
  });
  const installer = installBrief(ctx, home.dir);
  return { home, project, llm, routes, installer };
}

{
  const rt = setup();
  const first = await call(rt.routes, BRIEF_PATH, { search: { sessionId: 's1' } });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.status, 'analyzing', 'the route answers before the model does');
  assert.equal(first.json.cwd, rt.project);
  const settled = await rt.installer.runner.settled(rt.project);
  assert.equal(settled.status, 'ready');
  const ready = await call(rt.routes, BRIEF_PATH, { search: { sessionId: 's1' } });
  assert.equal(ready.json.status, 'ready');
  assert.equal(ready.json.text, 'A small app.');
  assert.equal(ready.json.cwd, rt.project);
  assert.equal(rt.llm.calls[0].maxTokens, BRIEF_MAX_TOKENS);
  assert.match(rt.llm.streams[0].messages[0].content[0].text, /README\.md/);
  rt.home.cleanup();
}

{
  const rt = setup({ language: 'zh', summary: '```markdown\n# Title\n\n一个小应用。\n```' });
  await call(rt.routes, BRIEF_PATH, { search: { sessionId: 's1' } });
  const settled = await rt.installer.runner.settled(rt.project);
  assert.equal(settled.text, '一个小应用。', 'the route clips the model answer');
  assert.match(rt.llm.streams[0].messages[0].content[0].text, /准备项目背景/);
  rt.home.cleanup();
}

{
  const rt = setup({ on: false });
  const answer = await call(rt.routes, BRIEF_PATH, { search: { sessionId: 's1' } });
  assert.deepEqual(answer.json, { status: 'idle' });
  assert.equal(rt.llm.calls.length, 0, 'off means no folder read and no model call');
  const posted = await call(rt.routes, BRIEF_PATH, { method: 'POST', body: { sessionId: 's1', retry: true } });
  assert.deepEqual(posted.json, { status: 'idle' });
  rt.home.cleanup();
}

{
  const rt = setup();
  assert.equal((await call(rt.routes, BRIEF_PATH)).status, 400);
  assert.equal((await call(rt.routes, BRIEF_PATH, { search: { sessionId: 'nope' } })).status, 400);
  assert.equal((await call(rt.routes, BRIEF_PATH, { method: 'POST', body: 'x' })).status, 400);
  assert.equal((await call(rt.routes, BRIEF_PATH, { method: 'POST', body: { sessionId: 's1' } })).status, 200);
  rt.home.cleanup();
}

{
  const rt = setup();
  await call(rt.routes, BRIEF_PATH, { search: { sessionId: 's1' } });
  await rt.installer.runner.settled(rt.project);
  const before = rt.llm.calls.length;
  const retried = await call(rt.routes, BRIEF_PATH, { method: 'POST', body: { sessionId: 's1', retry: true } });
  assert.equal(retried.json.status, 'analyzing');
  await rt.installer.runner.settled(rt.project);
  assert.equal(rt.llm.calls.length, before + 1, 'an explicit retry starts another read');
  rt.home.cleanup();
}

{
  const rt = setup({ fail: true });
  await call(rt.routes, BRIEF_PATH, { search: { sessionId: 's1' } });
  await rt.installer.runner.settled(rt.project);
  const failed = await call(rt.routes, BRIEF_PATH, { search: { sessionId: 's1' } });
  assert.equal(failed.json.status, 'failed');
  assert.match(failed.json.error, /model down/);
  const again = await call(rt.routes, BRIEF_PATH, { search: { sessionId: 's1' } });
  assert.equal(again.json.status, 'failed');
  assert.equal(rt.llm.calls.length, 1, 'a failed unchanged project is not retried on every open');
  rt.home.cleanup();
}

{
  const rt = setup({ pinned: false });
  await call(rt.routes, BRIEF_PATH, { search: { sessionId: 's1' } });
  const settled = await rt.installer.runner.settled(rt.project);
  assert.equal(settled.status, 'failed');
  assert.match(settled.error, /no model/);
  rt.home.cleanup();
}

console.log('brief route checks passed');