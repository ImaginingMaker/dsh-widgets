// Runs the real client.js PlanToggle against a fake React and DOM: Shift+Tab commands dsh's own `plan` when the chat
// exists, falls back to the draft prefix only for a chat that has not started, and never touches the draft otherwise.
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
const styleHost = { setAttribute() {}, textContent: '' };
globalThis.document = {
  createRange: () => ({ selectNodeContents(node) { this.node = node; }, collapse(atStart) { this.toEnd = !atStart; } }),
  querySelector: () => null,
  createElement: () => styleHost,
  head: { appendChild() {} },
};

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
  useSyncExternalStore: (subscribe, get) => get(),
  useState: (initial) => [initial, () => {}],
  Fragment: 'Fragment',
};

const plugin = module.factory((id) => (id === 'react' ? React : {}));
const registrations = [];
let planFailure = null;
const makeCtx = (planEnabled) => ({
  slots: { inject: (name, callback) => callback(), register: (options, Component) => { registrations.push({ options, Component }); return () => {}; } },
  locale: { getSnapshot: () => ({ active: 'en' }) },
  sessions: { list: { getSnapshot: () => ({ byId: {} }) }, scope: () => undefined },
  get: () => undefined,
  ...(planEnabled === undefined ? {} : {}),
});
plugin.apply(makeCtx());
const plan = registrations.find((entry) => entry.options.id === 'widgets-plan-toggle');
assert.ok(plan !== undefined, 'the plan widget registers a slot occupant');
assert.equal(plan.options.name, 'conversation.input.right');
const slot = plan.Component;

let edits;
const actions = {
  captureInsertion: () => ({ start: 3, end: 5, draftRev: 7 }),
  insertText: (text, spec) => { edits.push([text, spec]); return true; },
};
let planRequests = [];
const injected = { ...plan.options.inject('s1'), togglePlan: async (on) => { planRequests.push(on); return planFailure; } };
assert.equal(typeof plan.options.inject('s1').togglePlan, 'function', 'the slot hands the widget the plan toggle');
const mount = (draft, options = {}) => {
  effects = [];
  slot({
    ...injected,
    useInput: (read) => read({ draft }),
    inputActions: actions,
    ...(options.plan === undefined ? {} : { useProjection: (name) => { assert.equal(name, 'plan'); return options.plan; } }),
    ...(options.extra ?? {}),
  });
  return effects[0]();
};
const press = (overrides = {}) => {
  edits = []; frames = []; selection.range = null; planRequests.length = 0;
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

// ---- no chat yet: the only option is the draft prefix ---------------------------------------------------------------
const cases = [
  ['', '/plan ', 0, 0],
  ['make the login work', '/plan ', 0, 0],
  ['a\nb', '/plan ', 0, 0],
  ['/planning x', '/plan ', 0, 0],
  ['/plan x', '', 0, 6],
  ['/plan', '', 0, 5],
  ['/plan\tx', '', 0, 6],
  ['/plan  x', '', 0, 6],
];
for (const [draft, text, start, end] of cases) {
  const stop = mount(draft);
  const event = shiftTab();
  assert.equal(event.prevented, 1, `handled: ${draft}`);
  assert.deepEqual(edits, [[text, { start, end, draftRev: 7 }]], `edit: ${draft}`);
  assert.deepEqual(planRequests, [], 'no command without a chat');
  assert.ok(selection.range !== null && selection.range.node === input && selection.range.toEnd === true, `caret at the end: ${draft}`);
  stop();
  assert.equal(listener, null, 'the listener is removed with the widget');
}

// ---- a chat that exists: dsh's own command, and the draft is left alone ----------------------------------------------
{
  mount('', { plan: { active: false, pending: false } });
  const event = shiftTab();
  assert.equal(event.prevented, 1);
  assert.deepEqual(edits, [], 'entering plan mode does not write into the draft');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(planRequests, [false], 'the widget asks the Host to turn plan mode on');
}
{
  mount('draft text', { plan: { active: true, pending: false } });
  shiftTab();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(planRequests, [true], 'leaving plan mode is the off form');
  assert.deepEqual(edits, []);
}
{
  // A pending switch already flips the folded value, exactly as dsh's own chip does.
  mount('', { plan: { active: false, pending: true } });
  shiftTab();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(planRequests, [true]);
}
{
  mount('', { plan: { active: true, pending: true } });
  shiftTab();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(planRequests, [false]);
}

// A command that cannot run (a draft chat has a plan projection but no agent) falls back to the draft prefix; a notice is
// only for the case where even that fails.
{
  planFailure = 'no session';
  const notices = [];
  mount('hello', { plan: { active: false, pending: false }, extra: { notify: (level, text) => notices.push([level, text]) } });
  shiftTab();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(edits, [['/plan ', { start: 0, end: 0, draftRev: 7 }]], 'the prefix is the fallback');
  assert.deepEqual(notices, [], 'a fallback is not an error to show');

  actions.insertText = () => false;
  mount('hello', { plan: { active: false, pending: false }, extra: { notify: (level, text) => notices.push([level, text]) } });
  shiftTab();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(notices, [['error', 'no session']], 'only a fallback that also fails is reported');
  actions.insertText = (text, spec) => { edits.push([text, spec]); return true; };
  planFailure = null;
}

// ---- the key itself ---------------------------------------------------------------------------------------------------
mount('x', { plan: { active: false, pending: false } });
for (const overrides of [{ shiftKey: false }, { shiftKey: true, altKey: true }, { shiftKey: true, ctrlKey: true }, { shiftKey: true, metaKey: true }, { shiftKey: true, key: 'a' }]) {
  const event = shiftTab(overrides);
  assert.equal(event.prevented, 0, JSON.stringify(overrides));
}
for (const overrides of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }]) {
  const event = shiftTab(overrides);
  assert.equal(event.prevented, 1, `swallowed: ${JSON.stringify(overrides)}`);
  assert.deepEqual(planRequests, [], 'a repeated or composing key commands nothing');
}
menu = {};
assert.equal(shiftTab().prevented, 0, 'Shift+Tab closes dsh\'s own menu');
menu = null;
const outside = Object.assign(new Element(), { closest: () => null });
assert.equal(shiftTab({ target: outside }).prevented, 0, 'outside the composer');

// A refused insertion leaves the caret alone.
mount('x');
actions.insertText = () => false;
shiftTab();
assert.equal(selection.range, null);

console.log('client plan-toggle checks passed');