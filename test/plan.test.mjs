// The plan route: the allowlist, the live agent, the command result, and every refusal before or after the command.
import assert from 'node:assert/strict';
import { PLAN_LINES, PLAN_PATH, installPlan } from '../dist/index.js';
import { call, makeCtx } from './helpers.mjs';

assert.deepEqual([...PLAN_LINES], ['/plan', '/plan off']);

function setup({ commands = true, found = true, noExecution = false, execution = { result: { kind: 'success', text: 'Plan mode on.' } } } = {}) {
  const executed = [];
  const { ctx, routes } = makeCtx({
    services: commands ? { commands: { execute: async (agent, line, attachments, signal) => { executed.push({ agent, line, attachments, signal }); return noExecution ? undefined : execution; } } } : {},
    ctx: {
      sessionController: {
        resolveAgent: async (id) => (found && id === 's1' ? { agent: { id: 'a1' } } : { error: { code: 'session/not-found' } }),
      },
    },
  });
  installPlan(ctx);
  return { routes, executed };
}

{
  const { routes, executed } = setup();
  const on = await call(routes, PLAN_PATH, { method: 'POST', body: { sessionId: 's1', line: '/plan' } });
  assert.equal(on.status, 200);
  assert.deepEqual(on.json, { ok: true, text: 'Plan mode on.' });
  assert.equal(executed[0].line, '/plan');
  assert.deepEqual(executed[0].agent, { id: 'a1' });
  assert.deepEqual(executed[0].attachments, []);
  assert.ok(executed[0].signal instanceof AbortSignal);

  const off = await call(routes, PLAN_PATH, { method: 'POST', body: { sessionId: 's1', line: '/plan off' } });
  assert.equal(off.status, 200);
  assert.equal(executed[1].line, '/plan off');
}

{
  const { routes } = setup({ execution: { result: { kind: 'success' } } });
  const answer = await call(routes, PLAN_PATH, { method: 'POST', body: { sessionId: 's1', line: '/plan' } });
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.json, { ok: true, text: null });
}

{
  const { routes } = setup({ execution: { result: { kind: 'error', text: 'not now' } } });
  const answer = await call(routes, PLAN_PATH, { method: 'POST', body: { sessionId: 's1', line: '/plan' } });
  assert.equal(answer.status, 409);
  assert.deepEqual(answer.json, { error: 'not now', ok: false });
}

{
  const { routes } = setup({ execution: { result: { kind: 'error' } } });
  const answer = await call(routes, PLAN_PATH, { method: 'POST', body: { sessionId: 's1', line: '/plan' } });
  assert.equal(answer.status, 409);
  assert.match(answer.json.error, /refused/);
}

{
  const { routes } = setup();
  for (const body of [
    'x', {}, { sessionId: '', line: '/plan' }, { sessionId: 'x'.repeat(201), line: '/plan' },
    { sessionId: 's1', line: '/other' }, { sessionId: 's1', line: '/plan now' }, { sessionId: 's1', line: 7 },
  ]) {
    assert.equal((await call(routes, PLAN_PATH, { method: 'POST', body })).status, 400, JSON.stringify(body));
  }
  const gone = await call(routes, PLAN_PATH, { method: 'POST', body: { sessionId: 'nope', line: '/plan' } });
  assert.equal(gone.status, 409);
  assert.match(gone.json.error, /not available/);
}

{
  const { routes } = setup({ commands: false });
  const answer = await call(routes, PLAN_PATH, { method: 'POST', body: { sessionId: 's1', line: '/plan' } });
  assert.equal(answer.status, 409);
  assert.match(answer.json.error, /cannot run commands/);
}

{
  const { routes } = setup({ noExecution: true });
  const answer = await call(routes, PLAN_PATH, { method: 'POST', body: { sessionId: 's1', line: '/plan' } });
  assert.equal(answer.status, 409);
  assert.match(answer.json.error, /no plan command/);
}

console.log('plan route checks passed');