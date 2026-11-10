// The queue: the ordering rule on its own, then both routes against dsh's own inbox shape — moving a message with its
// attachment, refusing a queue that changed, editing in place, and never touching a message that is not yours.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  QUEUE_EDIT_PATH, QUEUE_MOVE_PATH, editContentOk, installQueueEdit, installQueueMove, isEditPart, mergeQueueOrder, seenOf,
} from '../dist/index.js';
import { call, makeCtx, tempDir } from './helpers.mjs';

// ---- the ordering rule -------------------------------------------------------------------------------------------------
assert.deepEqual(mergeQueueOrder(['a', 'b', 'c', 'd'], 'c', 0, ['a', 'b', 'c', 'd']), { moved: true, order: ['c', 'a', 'b', 'd'] });
assert.deepEqual(mergeQueueOrder(['a', 'b', 'c', 'd'], 'c', 3, ['a', 'b', 'c', 'd']), { moved: true, order: ['a', 'b', 'd', 'c'] });
assert.deepEqual(mergeQueueOrder(['a', 'b'], 'a', 0, ['a', 'b']), { moved: false, order: ['a', 'b'] }, 'already there');
// The user may see only part of the queue (dsh hides rows already echoed in the chat): `to` counts in that part.
assert.deepEqual(mergeQueueOrder(['e', 'a', 'b', 'c'], 'c', 0, ['a', 'b', 'c']), { moved: true, order: ['e', 'c', 'a', 'b'] });
// Anything that does not match what the user saw is refused, not guessed at.
for (const [ids, item, to, before, why] of [
  [['b', 'c'], 'c', 0, ['a', 'b', 'c'], 'the first message started sending'],
  [['a', 'c'], 'c', 0, ['a', 'b', 'c'], 'a middle message left'],
  [['c', 'b', 'a'], 'c', 0, ['a', 'b', 'c'], 'the order changed'],
  [['a', 'b'], 'c', 0, ['a', 'b'], 'the item is gone'],
  [['a', 'b'], 'a', 2, ['a', 'b'], 'past the end'],
  [['a', 'b'], 'a', -1, ['a', 'b'], 'negative index'],
  [['a', 'b'], 'a', 1.5, ['a', 'b'], 'a fractional index'],
  [['a', 'b'], 'a', 0, 'ab', 'before is not a list'],
  [['a', 'b'], 7, 0, ['a', 'b'], 'a non-string id'],
]) {
  assert.equal(mergeQueueOrder(ids, item, to, before).error !== undefined, true, why);
}
assert.equal(mergeQueueOrder(null, 'a', 0, ['a']).error !== undefined, true);

// ---- edit parts --------------------------------------------------------------------------------------------------------
assert.equal(isEditPart({ type: 'text', text: 'hi' }), true);
assert.equal(isEditPart({ type: 'image', attachmentId: 'x' }), true);
assert.equal(isEditPart({ type: 'file', receiptId: 'r' }), true);
assert.equal(isEditPart({ type: 'text', text: 'hi', extra: 1 }), false, 'unknown keys are refused');
assert.equal(isEditPart({ type: 'text', text: 42 }), false);
assert.equal(isEditPart({ type: 'audio', attachmentId: 'x' }), false);
assert.equal(isEditPart(null), false);
assert.equal(editContentOk([{ type: 'text', text: 'hi' }]), true);
assert.equal(editContentOk([{ type: 'text', text: '   ' }]), false, 'blank text alone edits nothing');
assert.equal(editContentOk([{ type: 'text', text: '' }, { type: 'image', attachmentId: 'a' }]), true, 'a kept attachment counts');
assert.equal(editContentOk([]), false);
assert.equal(editContentOk('x'), false);
assert.equal(editContentOk([{ type: 'nope' }]), false);

assert.deepEqual(seenOf([{ type: 'text', text: 'a' }, { type: 'image', attachment: { attachmentId: 'i1' } }]), [['text', 'a'], ['image', 'i1']]);
assert.deepEqual(seenOf(undefined), []);

// ---- the routes --------------------------------------------------------------------------------------------------------
const message = (id, kind = 'user', content = [{ type: 'text', text: id }]) => ({ id, source: { kind }, content });

/** A fake inbox with dsh's own shape: `nextTurn`, `splice` and `replace`. */
function makeInbox(initial) {
  let queue = initial;
  const splices = [];
  return {
    get nextTurn() { return queue; },
    splices,
    splice(target, start, count, inserted) { splices.push({ target, start, count, ids: inserted.map((item) => item.id) }); queue.splice(start, count, ...inserted); },
    replace(id, next) {
      const index = queue.findIndex((item) => item.id === id);
      if (index === -1) return false;
      queue[index] = next;
      return true;
    },
    set(next) { queue = next; },
  };
}

function wire(inbox, extra = {}) {
  const home = tempDir();
  const { ctx, routes } = makeCtx({
    services: extra.services ?? {},
    ctx: {
      sessionController: { resolveAgent: async (id) => (id === 'gone' ? { error: { code: 'session/not-found' } } : { agent: { inbox, session: { header: {} } } }) },
      get: (name) => (extra.services ?? {})[name],
    },
  });
  const busy = new Set();
  installQueueMove(ctx, busy);
  installQueueEdit(ctx, busy);
  return { routes, busy, home };
}

// Moving: one splice over the moved range, and each message keeps its own content.
{
  const inbox = makeInbox([message('a'), message('b', 'user', [{ type: 'image', attachment: { attachmentId: 'x' } }, { type: 'text', text: 'B' }]), message('c'), message('d')]);
  const { routes, home } = wire(inbox);
  const moved = await call(routes, QUEUE_MOVE_PATH, { method: 'POST', body: { sessionId: 's', itemId: 'c', to: 0, before: ['a', 'b', 'c', 'd'] } });
  assert.equal(moved.status, 200);
  assert.deepEqual(moved.json, { moved: true, order: ['c', 'a', 'b', 'd'] });
  assert.deepEqual(inbox.splices, [{ target: 'next-turn', start: 0, count: 3, ids: ['c', 'a', 'b'] }], 'one splice over the moved range');
  assert.equal(inbox.nextTurn[2].content[0].type, 'image', 'the attachment stays with its message');

  const already = await call(routes, QUEUE_MOVE_PATH, { method: 'POST', body: { sessionId: 's', itemId: 'c', to: 0, before: ['c', 'a', 'b', 'd'] } });
  assert.deepEqual(already.json, { moved: false });
  home.cleanup();
}

// A queue that changed since the user looked: 409, and nothing moves.
{
  const inbox = makeInbox([message('b'), message('c')]);
  const { routes, home } = wire(inbox);
  const refused = await call(routes, QUEUE_MOVE_PATH, { method: 'POST', body: { sessionId: 's', itemId: 'c', to: 0, before: ['a', 'b', 'c'] } });
  assert.equal(refused.status, 409);
  assert.match(refused.json.error, /queue changed/);
  assert.deepEqual(inbox.splices, []);
  home.cleanup();
}

// Only your own messages move: a goal round in the range keeps its place.
{
  const inbox = makeInbox([message('a'), message('g', 'goal'), message('b')]);
  const { routes, home } = wire(inbox);
  const refused = await call(routes, QUEUE_MOVE_PATH, { method: 'POST', body: { sessionId: 's', itemId: 'b', to: 0, before: ['a', 'g', 'b'] } });
  assert.equal(refused.status, 409);
  assert.deepEqual(inbox.nextTurn.map((item) => item.id), ['a', 'g', 'b']);
  home.cleanup();
}

// Bad input, an unknown chat, and a chat that cannot take a queue change.
{
  const inbox = makeInbox([message('a'), message('b')]);
  const { routes, busy, home } = wire(inbox);
  for (const body of ['x', {}, { sessionId: 's', itemId: 'a' }, { sessionId: '', itemId: 'a', to: 0, before: ['a'] }, { sessionId: 's', itemId: 'a', to: 'x', before: ['a'] }]) {
    assert.equal((await call(routes, QUEUE_MOVE_PATH, { method: 'POST', body })).status, 400, JSON.stringify(body));
  }
  const gone = await call(routes, QUEUE_MOVE_PATH, { method: 'POST', body: { sessionId: 'gone', itemId: 'a', to: 0, before: ['a'] } });
  assert.equal(gone.status, 409);

  // One change per chat at a time.
  busy.add('s');
  const held = await call(routes, QUEUE_MOVE_PATH, { method: 'POST', body: { sessionId: 's', itemId: 'b', to: 0, before: ['a', 'b'] } });
  assert.equal(held.status, 409);
  assert.match(held.json.error, /already running/);
  busy.delete('s');
  home.cleanup();
}

// A dsh without a movable inbox says so instead of pretending.
{
  const { routes, home } = wire({ nextTurn: [] });
  const answer = await call(routes, QUEUE_MOVE_PATH, { method: 'POST', body: { sessionId: 's', itemId: 'a', to: 0, before: ['a'] } });
  assert.equal(answer.status, 409);
  assert.match(answer.json.error, /cannot move/);
  home.cleanup();
}

// Editing: new text in place, the same id and the same place.
{
  const inbox = makeInbox([message('a'), message('b'), message('c')]);
  const { routes, home } = wire(inbox);
  const edited = await call(routes, QUEUE_EDIT_PATH, {
    method: 'POST',
    body: { sessionId: 's', itemId: 'b', content: [{ type: 'text', text: 'new words' }], seen: [['text', 'b']] },
  });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.json, { edited: true, seen: [['text', 'new words']] });
  assert.deepEqual(inbox.nextTurn.map((item) => item.id), ['a', 'b', 'c'], 'the message keeps its place');
  assert.equal(inbox.nextTurn[1].content[0].text, 'new words');
  // dsh's replace takes a whole message; a bare content array would leave an id-less fragment in the queue.
  assert.equal(inbox.nextTurn[1].id, 'b');
  assert.deepEqual(inbox.nextTurn[1].source, { kind: 'user' });
  home.cleanup();
}

// A collapsed edit that no longer matches what the user saw is refused, so another device's change is not overwritten.
{
  const inbox = makeInbox([message('a'), message('b')]);
  const { routes, home } = wire(inbox);
  const stale = await call(routes, QUEUE_EDIT_PATH, { method: 'POST', body: { sessionId: 's', itemId: 'b', content: [{ type: 'text', text: 'x' }], seen: [['text', 'other']] } });
  assert.equal(stale.status, 409);
  assert.equal(inbox.nextTurn[1].content[0].text, 'b');
  const missing = await call(routes, QUEUE_EDIT_PATH, { method: 'POST', body: { sessionId: 's', itemId: 'zzz', content: [{ type: 'text', text: 'x' }] } });
  assert.equal(missing.status, 409);
  home.cleanup();
}

// A kept attachment is carried over in the order the client names it.
{
  const inbox = makeInbox([message('a'), message('b', 'user', [{ type: 'image', attachment: { attachmentId: 'i1' } }, { type: 'text', text: 'b' }])]);
  const { routes, home } = wire(inbox);
  const kept = await call(routes, QUEUE_EDIT_PATH, {
    method: 'POST',
    body: { sessionId: 's', itemId: 'b', content: [{ type: 'image', attachmentId: 'i1' }, { type: 'text', text: 'with the image' }] },
  });
  assert.equal(kept.status, 200);
  assert.deepEqual(inbox.nextTurn[1].content.map((block) => block.type), ['image', 'text']);
  assert.equal(inbox.nextTurn[1].content[0].attachment.attachmentId, 'i1');

  const ghost = await call(routes, QUEUE_EDIT_PATH, {
    method: 'POST',
    body: { sessionId: 's', itemId: 'b', content: [{ type: 'image', attachmentId: 'nope' }] },
  });
  assert.equal(ghost.status, 409, 'an attachment that is not in the message cannot be kept');
  home.cleanup();
}

// A file receipt resolves through dsh's upload service; a stale receipt is refused.
{
  const inbox = makeInbox([message('a')]);
  const uploads = { resolve: (agent, id) => (id === 'good' ? { type: 'file', attachment: { attachmentId: 'f1', name: 'a.txt' } } : undefined) };
  const { routes, home } = wire(inbox, { services: { fileUploads: uploads } });
  const added = await call(routes, QUEUE_EDIT_PATH, { method: 'POST', body: { sessionId: 's', itemId: 'a', content: [{ type: 'text', text: 'see file' }, { type: 'file', receiptId: 'good' }] } });
  assert.equal(added.status, 200);
  assert.deepEqual(inbox.nextTurn[0].content.map((block) => block.type), ['text', 'file']);
  const stale = await call(routes, QUEUE_EDIT_PATH, { method: 'POST', body: { sessionId: 's', itemId: 'a', content: [{ type: 'file', receiptId: 'gone' }] } });
  assert.equal(stale.status, 409);
  home.cleanup();
}

// A new image is refused with a reason rather than being dropped silently.
{
  const inbox = makeInbox([message('a')]);
  const { routes, home } = wire(inbox);
  const image = await call(routes, QUEUE_EDIT_PATH, { method: 'POST', body: { sessionId: 's', itemId: 'a', content: [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }] } });
  assert.equal(image.status, 409);
  assert.match(image.json.error, /cannot add images/);
  home.cleanup();
}

// A message that is not yours cannot be edited, and a bad body is a 400.
{
  const inbox = makeInbox([message('g', 'goal')]);
  const { routes, home } = wire(inbox);
  const foreign = await call(routes, QUEUE_EDIT_PATH, { method: 'POST', body: { sessionId: 's', itemId: 'g', content: [{ type: 'text', text: 'x' }] } });
  assert.equal(foreign.status, 409);
  for (const body of [{}, { sessionId: 's', itemId: 'g' }, { sessionId: 's', itemId: 'g', content: [] }, { sessionId: 's', itemId: 'g', content: [{ type: 'text', text: ' ' }] }]) {
    assert.equal((await call(routes, QUEUE_EDIT_PATH, { method: 'POST', body })).status, 400, JSON.stringify(body));
  }
  home.cleanup();
}

void join;
console.log('queue checks passed');