// The pre-step hook: one handoff note per chat, only from a fresh ready summary, and never in the way of a failing read.
import assert from 'node:assert/strict';
import { installPreStep, resetPrepared } from '../dist/index.js';
import { makeCtx } from './helpers.mjs';

const readyRecord = { status: 'ready', text: 'A small app.', tree: 'src/\n  index.ts', signature: 'sig-1' };

function setup(overrides = {}) {
  const listeners = [];
  const { ctx } = makeCtx({
    services: { workingDirectory: { get: () => process.cwd() } },
    ctx: {
      on: (event, listener) => { assert.equal(event, 'agent/pre-step'); listeners.push(listener); },
      sessionController: { resolveAgent: async () => ({ agent: { session: {} } }) },
    },
  });
  const settings = overrides.settings ?? { on: { projectBrief: true }, analysis: { model: null, effort: null }, language: 'en' };
  const deps = {
    store: { read: () => settings },
    briefOf: overrides.briefOf ?? (async () => ({ record: readyRecord, signature: 'sig-1' })),
    language: () => settings.language,
    log: overrides.log,
  };
  installPreStep(ctx, deps);
  return { listener: listeners[0], settings };
}

const nextWith = (messages = [{ id: 'm1' }]) => async () => ({ kind: 'enter', messages });

{
  resetPrepared();
  const { listener } = setup();
  const decision = await listener({ agent: { id: 's1' } }, nextWith());
  assert.equal(decision.messages.length, 2);
  assert.equal(decision.messages[0].source.kind, 'dsh-widgets-note');
  assert.match(decision.messages[0].content[0].text, /<summary>\nA small app\.\n<\/summary>/);
  assert.match(decision.messages[0].content[0].text, /<file hierarchy>\nsrc\/\n  index\.ts\n<\/file hierarchy>/);
  assert.equal(decision.messages[1].id, 'm1');

  const second = await listener({ agent: { id: 's1' } }, nextWith());
  assert.deepEqual(second.messages, [{ id: 'm1' }], 'one chat is prepared once');
  const other = await listener({ agent: { id: 's2' } }, nextWith());
  assert.equal(other.messages.length, 2, 'another chat gets its own note');
}

{
  resetPrepared();
  const { listener } = setup({ settings: { on: { projectBrief: false }, analysis: { model: null, effort: null }, language: 'en' } });
  const decision = await listener({ agent: { id: 's1' } }, nextWith());
  assert.deepEqual(decision.messages, [{ id: 'm1' }]);
}

{
  resetPrepared();
  for (const [label, record, signature] of [
    ['stale', readyRecord, 'sig-2'],
    ['failed', { status: 'failed', error: 'nope', signature: 'sig-1' }, 'sig-1'],
    ['analyzing', { status: 'analyzing', signature: 'sig-1' }, 'sig-1'],
    ['empty text', { ...readyRecord, text: '   ' }, 'sig-1'],
  ]) {
    const { listener } = setup({ briefOf: async () => ({ record, signature }) });
    const decision = await listener({ agent: { id: `s-${label}` } }, nextWith());
    assert.deepEqual(decision.messages, [{ id: 'm1' }], label);
  }
}

{
  resetPrepared();
  const { listener } = setup();
  const decision = await listener({ agent: { id: 's1' } }, async () => ({ kind: 'reject' }));
  assert.deepEqual(decision, { kind: 'reject' });
}

{
  resetPrepared();
  const logs = [];
  const { listener } = setup({
    briefOf: async () => { throw new Error('disk gone'); },
    log: (line) => logs.push(line),
  });
  const decision = await listener({ agent: { id: 's1' } }, nextWith());
  assert.deepEqual(decision.messages, [{ id: 'm1' }]);
  assert.match(logs[0], /could not prepare/);
  const again = await listener({ agent: { id: 's1' } }, nextWith());
  assert.deepEqual(again.messages, [{ id: 'm1' }], 'a failed preparation is not retried on every step');
}

{
  resetPrepared();
  const { listener } = setup();
  const decision = await listener({}, nextWith());
  assert.deepEqual(decision.messages, [{ id: 'm1' }], 'a payload without an agent id is passed through');
}

console.log('pre-step checks passed');