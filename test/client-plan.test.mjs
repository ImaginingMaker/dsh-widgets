// Runs the real client.js PlanToggle against a fake React and DOM: Shift+Tab adds or removes a leading `/plan` in the
// format dsh recognises, leaves plan mode through `/plan off`, and never reacts to any other key or modifier.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../dist/web/client.js', import.meta.url), 'utf8');
let module;
const selection = { removeAllRanges() { this.range = null; }, addRange(range) { this.range = range; } };
globalThis.window = { __ModuleLoader__: { load: (value) => { module = value; } }, getSelection: () => selection };
eval(source);

let frames = [];
globalThis.requestAnimationFrame = (fn) => frames.push(fn);
globalThis.Element = class {};
globalThis.document = { createRange: () => ({ selectNodeContents(node) { this.node = node; }, collapse(atStart) { this.toEnd = !atStart; } }) };

let listener = null;
let menu = null;
const seat = {
  querySelector: () => menu,
  addEventListener(type, fn, capture) { assert.equal(type, 'keydown'); assert.equal(capture, true); listener = fn; },
  removeEventListener(type, fn) { if (fn === listener) listener = null; },
};
const input = Object.assign(new Element(), { isContentEditable: true, isConnected: true, closest: (query) => (query === '[data-composer-input]' ? input : seat) });
const anchorElement = { closest: () => seat };

let effects = [];
const React = {
  useRef: () => ({ current: anchorElement }),
  useEffect: (fn) => effects.push(fn),
  createElement: (type, props) => ({ type, props }),
};

const plugin = module.factory((id) => (id === 'react' ? React : {}));
const registrations = [];
const ctx = {
  slots: { inject: (name, callback) => callback(), register: (options, Component) => { registrations.push({ options, Component }); return () => {}; } },
  locale: { getSnapshot: () => ({ active: 'en' }) },
  sessions: { list: { getSnapshot: () => ({ byId: {} }) }, scope: () => undefined },
  get: () => undefined,
};
plugin.apply(ctx);
const plan = registrations.find((entry) => entry.options.id === 'widgets-plan-toggle');
assert.ok(plan !== undefined, 'the plan widget registers a slot occupant');
assert.equal(plan.options.name, 'conversation.input.right');
assert.equal(plan.options.order, 999);
const slot = plan.Component;

let edits;
const actions = {
  captureInsertion: () => ({ start: 3, end: 5, draftRev: 7 }),
  insertText: (text, spec) => { edits.push([text, spec]); return true; },
};
const mount = (draft) => { effects = []; slot({ useInput: (read) => read({ draft }), inputActions: actions }); return effects[0](); };
const press = (overrides = {}) => {
  edits = []; frames = []; selection.range = null;
  const event = {
    key: 'Tab', altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, repeat: false, isComposing: false, keyCode: 9,
    target: input, prevented: 0, preventDefault() { this.prevented += 1; }, stopPropagation() {},
    ...overrides,
  };
  listener(event);
  for (const frame of frames) frame();
  return event;
};
const shiftTab = (overrides = {}) => press({ shiftKey: true, ...overrides });

// The exact prefix dsh recognises: `/plan` then a space, tab or the end of the draft. `/planning` is not the command.
const cases = [
  ['', '/plan ', 0, 0],
  ['make the login work', '/plan ', 0, 0],
  ['a\nb', '/plan ', 0, 0],
  ['/planning x', '/plan ', 0, 0],
  ['/plan x', '', 0, 6],
  ['/plan', '', 0, 5],
  ['/plan\tx', '', 0, 6],
  ['/plan  x', '', 0, 6],
  ['/plan\nx', '', 0, 5],
];
for (const [draft, text, start, end] of cases) {
  const stop = mount(draft);
  const event = shiftTab();
  assert.equal(event.prevented, 1, `handled: ${draft}`);
  assert.deepEqual(edits, [[text, { start, end, draftRev: 7 }]], `edit: ${draft}`);
  assert.ok(selection.range !== null && selection.range.node === input && selection.range.toEnd === true, `caret at the end: ${draft}`);
  stop();
  assert.equal(listener, null, 'the listener is removed with the widget');
}

// Nothing else counts: a plain Tab, or any other modifier, is left to dsh.
mount('x');
for (const overrides of [{ shiftKey: false }, { shiftKey: true, altKey: true }, { shiftKey: true, ctrlKey: true }, { shiftKey: true, metaKey: true }, { shiftKey: true, key: 'a' }]) {
  const event = shiftTab(overrides);
  assert.equal(event.prevented, 0, JSON.stringify(overrides));
  assert.deepEqual(edits, []);
}

// A repeated key, an IME composition and the IME key code are swallowed but do not edit.
for (const overrides of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }]) {
  const event = shiftTab(overrides);
  assert.equal(event.prevented, 1, `swallowed: ${JSON.stringify(overrides)}`);
  assert.deepEqual(edits, [], JSON.stringify(overrides));
}

// An open slash menu owns Shift+Tab, and a key outside the composer is not ours.
menu = {};
assert.equal(shiftTab().prevented, 0, 'Shift+Tab closes dsh\'s own menu');
menu = null;
const outside = Object.assign(new Element(), { closest: () => null });
assert.equal(shiftTab({ target: outside }).prevented, 0, 'outside the composer');

// A refused edit leaves the caret alone.
actions.insertText = () => false;
shiftTab();
assert.equal(selection.range, null);

// In plan mode Shift+Tab leaves it through dsh's own `/plan off` instead of editing the draft.
actions.insertText = (text, spec) => { edits.push([text, spec]); return true; };
const notices = [];
const commands = {
  async execute(sessionId, line, args) { executed.push([sessionId, line, args]); return { ok: true, value: {} }; },
};
const executed = [];

// Re-apply against a Context that also carries the command service, then take the injected props for one chat.
registrations.length = 0;
plugin.apply({
  ...ctx,
  remote: { commands },
  slots: ctx.slots,
});
const withCommands = registrations.find((entry) => entry.options.id === 'widgets-plan-toggle').Component;
const injected = registrations.find((entry) => entry.options.id === 'widgets-plan-toggle').options.inject('s1');
const mountInPlan = (draft, plan) => {
  effects = [];
  withCommands({ useInput: (read) => read({ draft }), inputActions: actions, useProjection: (name) => { assert.equal(name, 'plan'); return plan; }, ...injected, notify: (level, text) => notices.push([level, text]) });
  return effects[0]();
};
for (const plan of [{ active: true, pending: false }, { active: false, pending: true }]) {
  mountInPlan('', plan);
  const event = shiftTab();
  assert.equal(event.prevented, 1);
  assert.deepEqual(edits, [], 'no draft edit while in plan mode');
}
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(executed, [['s1', '/plan off', []], ['s1', '/plan off', []]], 'the exact command dsh takes');
for (const plan of [{ active: false, pending: false }, { active: true, pending: true }, undefined]) {
  mountInPlan('x', plan);
  shiftTab();
  assert.deepEqual(edits, [['/plan ', { start: 0, end: 0, draftRev: 7 }]], `out of plan mode: ${JSON.stringify(plan)}`);
}
assert.equal(executed.length, 2);

// A refused `/plan off` is reported, not swallowed.
commands.execute = async () => ({ ok: false, error: { message: 'busy', code: 'locked' } });
mountInPlan('', { active: true, pending: false });
shiftTab();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(notices, [['error', 'busy (locked)']]);

console.log('client plan-toggle checks passed');