// Runs the real client.js components against a fake React and DOM: the queue strip, the target chip (picker and badge),
// the Improve prompt wand, the project-brief status icon, and the Settings panel.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../dist/web/client.js', import.meta.url), 'utf8');
let module;
globalThis.window = { __ModuleLoader__: { load: (value) => { module = value; } } };
eval(source);

// ---- a very small hook runtime -----------------------------------------------------------------------------------------
let hooks = [];
let hookIndex = 0;
let effects = [];
const React = {
  Fragment: 'Fragment',
  createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children: children.flat(Infinity) } }),
  useRef: (initial) => {
    const index = hookIndex++;
    if (hooks[index] === undefined) hooks[index] = { current: initial };
    return hooks[index];
  },
  useState: (initial) => {
    const index = hookIndex++;
    if (hooks[index] === undefined) hooks[index] = initial;
    return [hooks[index], (next) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }];
  },
  useEffect: (fn) => { effects.push(fn); },
  useCallback: (fn) => fn,
  useSyncExternalStore: (subscribe, get) => { subscribe?.(() => {}); return get(); },
};
const resetHooks = () => { hooks = []; hookIndex = 0; effects = []; };
const runEffects = async () => {
  const pending = effects;
  effects = [];
  const cleanups = [];
  for (const effect of pending) {
    const cleanup = effect();
    if (typeof cleanup === 'function') cleanups.push(cleanup);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  return cleanups;
};

// ---- tree helpers ------------------------------------------------------------------------------------------------------
const nodes = (node) => {
  if (node === null || node === undefined || node === false || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (typeof node.type === 'function') return [node, ...nodes(node.type(node.props))];
  return [node, ...nodes(node.props?.children ?? [])];
};
const withProp = (tree, name) => nodes(tree).filter((node) => node.props?.[name] !== undefined);
const texts = (tree) => nodes(tree).flatMap((node) => node.props?.children ?? []).filter((child) => typeof child === 'string');

// ---- the fake page -----------------------------------------------------------------------------------------------------
const styleNodes = [];
const listeners = new Map();
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ setAttribute() {}, textContent: '' }),
  head: { appendChild: (node) => styleNodes.push(node) },
  addEventListener: (type, fn) => { listeners.set(`${type}`, fn); },
  removeEventListener: (type) => { listeners.delete(`${type}`); },
};

// ---- fetch stub --------------------------------------------------------------------------------------------------------
let requests = [];
let answer = () => ({ ok: true, value: {} });
globalThis.fetch = async (url, init) => {
  requests.push({ url, method: init?.method ?? 'GET', body: init?.body === undefined ? undefined : JSON.parse(init.body) });
  const { ok = true, value = {}, status = 200 } = answer(url, init);
  return { ok, status, json: async () => value };
};
const lastRequest = () => requests.at(-1);

// ---- boot the plugin ---------------------------------------------------------------------------------------------------
const registrations = [];
const commands = [];
const ctx = {
  slots: { inject: (name, callback) => callback(), register: (options, Component) => { registrations.push({ options, Component }); return () => {}; } },
  locale: { getSnapshot: () => ({ active: 'zh' }) },
  sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd: '/repo' } } }) }, scope: () => undefined },
  remote: { commands: { execute: async (sessionId, line) => { commands.push([sessionId, line]); return { ok: true, value: {} }; } } },
  get: () => undefined,
  effect: (fn) => { effects.push(() => () => fn()?.()); },
};
module.factory((id) => (id === 'react' ? React : {})).apply(ctx);
const find = (id) => registrations.find((entry) => entry.options.id === id);

assert.ok(styleNodes.length >= 1, 'the shared stylesheet is installed once, not by whichever widget renders first');

// ---- the queue strip ---------------------------------------------------------------------------------------------------
{
  const entry = find('widgets-queue');
  assert.ok(entry !== undefined, 'the queue panel registers');
  assert.equal(entry.options.name, 'conversation.input.dock');
  const render = (rows, settings = { on: {} }, notify = () => {}) => {
    hookIndex = 0;
    const element = entry.Component({ sessionId: 's1', useProjection: () => rows, notify, t: (key) => key });
    return element.type({ ...element.props, settings });
  };
  const rows = [
    { id: 'a', source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] },
    { id: 'b', source: { kind: 'user' }, content: [{ type: 'text', text: 'second' }] },
    { id: 'g', source: { kind: 'goal' }, content: [{ type: 'text', text: 'goal round' }] },
  ];
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  resetHooks(); requests = [];
  let tree = render(rows);
  assert.equal(withProp(tree, 'data-dsh-widgets-queue').length, 1);
  const grips = withProp(tree, 'data-dsh-widgets-grip');
  assert.equal(grips.length, 2, 'only your own messages get a grip');

  await grips[0].props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  await flush();
  assert.deepEqual(lastRequest().body, { sessionId: 's1', itemId: 'a', to: 1, before: ['a', 'b', 'g'] });

  // A refusal is reported through dsh's own notice.
  const notices = [];
  answer = () => ({ ok: false, status: 409, value: { error: 'the queue changed' } });
  hookIndex = 0;
  const failing = render(rows, { on: {} }, (level, text) => notices.push([level, text]));
  await withProp(failing, 'data-dsh-widgets-grip')[0].props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  await flush();
  assert.deepEqual(notices, [['error', 'queue.failed']]);
  answer = () => ({ ok: true, value: {} });

  // In-place editing saves what the user saw.
  resetHooks(); requests = [];
  tree = render(rows);
  withProp(tree, 'data-dsh-widgets-queue-row')[0].props.children.find((child) => child?.props?.className === 'dw-text').props.onDoubleClick();
  hookIndex = 0;
  tree = render(rows);
  withProp(tree, 'data-dsh-widgets-edit')[0].props.onChange({ target: { value: 'first, edited' } });
  hookIndex = 0;
  tree = render(rows);
  await withProp(tree, 'data-dsh-widgets-edit')[0].props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault() {} });
  await flush();
  assert.deepEqual(lastRequest().body, { sessionId: 's1', itemId: 'a', content: [{ type: 'text', text: 'first, edited' }], seen: [['text', 'first']] });

  resetHooks();
  assert.equal(render(rows.slice(0, 1)), null, 'one row is not worth a strip');
  assert.equal(render(rows, { on: { queueReorder: false, queueEdit: false } }), null);
}

// ---- the Improve prompt wand -------------------------------------------------------------------------------------------
{
  const entry = find('widgets-improve');
  const drafts = [];
  const notices = [];
  const storeOf = (analysis) => ({ getSnapshot: () => ({ analysis }) });
  let state = { draft: 'make login work', attachmentIds: [] };
  const base = {
    sessionId: 's1', useInput: (read) => read(state), inputActions: { setDraft: (text) => drafts.push(text) },
    store: storeOf({ model: null, effort: null }),
    notify: (level, text) => notices.push([level, text]), t: (key) => key,
  };

  answer = () => ({ value: { text: 'Make the login form work end to end.' } });
  resetHooks(); requests = [];
  let tree = entry.Component({ ...base, store: storeOf({ model: null, effort: 'high' }) });
  await withProp(tree, 'data-dsh-widgets-wand')[0].props.onClick();
  // "Same as the chat" sends no route at all: the Host resolves it, because only the Host can see the chat's model.
  assert.deepEqual(lastRequest().body, { sessionId: 's1', text: 'make login work', effort: 'high' });
  assert.deepEqual(drafts, ['Make the login form work end to end.']);

  // A model chosen in Settings after the chat opened is the one used.
  requests = [];
  hookIndex = 0;
  tree = entry.Component({ ...base, store: storeOf({ model: { provider: 'p', model: 'm' }, effort: 'off' }) });
  await withProp(tree, 'data-dsh-widgets-wand')[0].props.onClick();
  assert.deepEqual(lastRequest().body, { sessionId: 's1', text: 'make login work', provider: 'p', model: 'm', effort: 'off' });

  // A failure is reported and the draft is left alone.
  answer = () => ({ ok: false, status: 502, value: { error: 'the model failed' } });
  const before = drafts.length;
  resetHooks();
  tree = entry.Component({ ...base, store: storeOf({ model: null, effort: null }) });
  await withProp(tree, 'data-dsh-widgets-wand')[0].props.onClick();
  assert.equal(drafts.length, before);
  assert.deepEqual(notices, [['error', 'improve.failed']]);

  // The icon carries no class that could draw a box: the shared stylesheet owns its look.
  assert.equal(withProp(tree, 'data-dsh-widgets-wand')[0].props.className, 'dw-btn');
  // A wand with no chat model in reach is still a wand you can press.
  assert.equal(withProp(tree, 'data-dsh-widgets-wand')[0].props.disabled, false);

  // ---- the undo belongs to a draft, not to a sent message ---------------------------------------------------------
  {
    state = { draft: 'make login work', attachmentIds: [] };
    answer = () => ({ value: { text: 'Make the login form work.' } });
    resetHooks();
    tree = entry.Component(base);
    await withProp(tree, 'data-dsh-widgets-wand')[0].props.onClick();
    hookIndex = 0;
    tree = entry.Component(base);
    assert.equal(withProp(tree, 'data-dsh-widgets-undo-draft').length, 1, 'an undo appears beside the wand');

    // The message is sent: the composer empties.
    state = { draft: '', attachmentIds: [] };
    hookIndex = 0;
    tree = entry.Component(base);
    await runEffects();
    hookIndex = 0;
    tree = entry.Component(base);
    assert.equal(withProp(tree, 'data-dsh-widgets-undo-draft').length, 0, 'a sent message leaves no undo behind');
  }

  // ---- a call in flight: the icon says so, the composer is locked, the images travel ---------------------------------
  {
    state = { draft: 'match this screenshot', attachmentIds: ['a1'] };
    let release;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      requests.push({ url, method: init?.method ?? 'GET', body: init?.body === undefined ? undefined : JSON.parse(init.body) });
      await new Promise((resolve) => { release = resolve; });
      return { ok: true, status: 200, json: async () => ({ text: 'Rewritten.' }) };
    };
    const serialized = [];
    let seatAttribute = null;
    const seat = { setAttribute: (name, value) => { seatAttribute = [name, value]; }, removeAttribute: () => { seatAttribute = null; }, addEventListener: () => {}, removeEventListener: () => {} };
    const realDocument = globalThis.document;
    globalThis.document = { ...realDocument, querySelector: () => seat };

    resetHooks(); requests = [];
    tree = entry.Component({
      ...base,
      serializeAttachments: async (ids) => { serialized.push(...ids); return [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }]; },
    });
    const pending = withProp(tree, 'data-dsh-widgets-wand')[0].props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    hookIndex = 0;
    tree = entry.Component(base);
    const cleanups = await runEffects();
    hookIndex = 0;
    tree = entry.Component(base);
    const running = withProp(tree, 'data-dsh-widgets-wand')[0];
    assert.equal(running.props['aria-busy'], true, 'the icon reports that it is working');
    assert.equal(running.props['data-dsh-widgets-working'], '', 'and carries the pulse');
    assert.equal(running.props.disabled, true, 'a second press cannot start a second call');
    assert.deepEqual(seatAttribute, ['data-dsh-widgets-busy', ''], 'the composer is marked as locked');
    assert.deepEqual(serialized, ['a1'], 'the staged image was serialized');
    assert.deepEqual(requests.at(-1).body.attachments, [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }]);

    release();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    // React runs the previous cleanup when the effect's dependency changes; the fake runtime is told to do the same.
    for (const cleanup of cleanups) cleanup();
    hookIndex = 0;
    tree = entry.Component(base);
    assert.equal(withProp(tree, 'data-dsh-widgets-wand')[0].props['aria-busy'], false, 'the icon stops when the call settles');
    assert.equal(seatAttribute, null, 'and the composer is handed back');
    globalThis.document = realDocument;
    globalThis.fetch = realFetch;
  }
  answer = () => ({ ok: true, value: {} });
}

// ---- the project brief status icon -------------------------------------------------------------------------------------
{
  // Project brief is off by default, so the panel only exists once the stored switch says so. Boot the plugin again with
  // that switch on, exactly as a second page load would.
  const settingsValue = {
    on: { projectBrief: true },
    analysis: { model: null, effort: null },
    language: 'zh',
  };
  registrations.length = 0;
  answer = (url) => (String(url).includes('/api/widgets.settings') ? { value: settingsValue } : { value: {} });
  module.factory((id) => (id === 'react' ? React : {})).apply(ctx);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const entry = find('widgets-brief');
  assert.ok(entry !== undefined, 'the brief icon registers');
  const props = entry.options.inject('s1');

  // A read in flight spins.
  answer = () => ({ value: { status: 'analyzing', cwd: '/repo' } });
  resetHooks();
  let tree = entry.Component(props);
  await runEffects();
  hookIndex = 0;
  tree = entry.Component(props);
  const spin = withProp(tree, 'data-dsh-widgets-brief')[0];
  assert.equal(spin.props['data-dsh-widgets-brief'], 'analyzing');
  assert.equal(spin.props['aria-busy'], true);

  // A finished read shows a dot, and its tooltip is the summary.
  answer = () => ({ value: { status: 'ready', text: 'A small app.', cwd: '/repo' } });
  resetHooks();
  tree = entry.Component(props);
  await runEffects();
  hookIndex = 0;
  tree = entry.Component(props);
  const ready = withProp(tree, 'data-dsh-widgets-brief')[0];
  assert.equal(ready.props['data-dsh-widgets-brief'], 'ready');
  assert.equal(ready.props['aria-haspopup'], 'dialog');
  ready.props.onClick();
  hookIndex = 0;
  tree = entry.Component(props);
  await runEffects();
  hookIndex = 0;
  tree = entry.Component(props);
  assert.equal(withProp(tree, 'data-dsh-widgets-brief-panel').length, 1, 'the summary can be read');
  assert.ok(texts(tree).includes('A small app.'));

  // The action at the foot of the panel looks like a button, not like text.
  const reanalyze = withProp(tree, 'data-dsh-widgets-reanalyze')[0];
  assert.equal(reanalyze.props.className, 'dw-action', 'the action carries the bordered button class');
  assert.equal(withProp(tree, 'data-dsh-widgets-reanalyze')[0].props.className === 'dw-btn', false);

  // Clicking anywhere else closes it, and so does Escape.
  assert.equal(typeof listeners.get('pointerdown'), 'function', 'an outside-click listener is installed while open');
  listeners.get('pointerdown')({ target: { closest: () => null } });
  hookIndex = 0;
  tree = entry.Component(props);
  assert.equal(withProp(tree, 'data-dsh-widgets-brief-panel').length, 0, 'a click outside closed the panel');

  hookIndex = 0;
  tree = entry.Component(props);
  withProp(tree, 'data-dsh-widgets-brief')[0].props.onClick();
  hookIndex = 0;
  tree = entry.Component(props);
  await runEffects();
  hookIndex = 0;
  tree = entry.Component(props);
  assert.equal(withProp(tree, 'data-dsh-widgets-brief-panel').length, 1, 'reopened');
  listeners.get('keydown')({ key: 'Escape' });
  hookIndex = 0;
  tree = entry.Component(props);
  assert.equal(withProp(tree, 'data-dsh-widgets-brief-panel').length, 0, 'Escape closed the panel');

  // A click inside the popover leaves it open.
  hookIndex = 0;
  tree = entry.Component(props);
  withProp(tree, 'data-dsh-widgets-brief')[0].props.onClick();
  hookIndex = 0;
  tree = entry.Component(props);
  await runEffects();
  listeners.get('pointerdown')({ target: { closest: (selector) => (selector === '.dw-brief' ? {} : null) } });
  hookIndex = 0;
  tree = entry.Component(props);
  assert.equal(withProp(tree, 'data-dsh-widgets-brief-panel').length, 1, 'a click inside keeps it open');
  hookIndex = 0;
  tree = entry.Component(props);
  withProp(tree, 'data-dsh-widgets-brief')[0].props.onClick();

  // A failure offers a retry, and retrying POSTs.
  answer = () => ({ value: { status: 'failed', error: 'timed out', cwd: '/repo' } });
  resetHooks();
  tree = entry.Component(props);
  await runEffects();
  hookIndex = 0;
  tree = entry.Component(props);
  requests = [];
  answer = () => ({ value: { status: 'analyzing', cwd: '/repo' } });
  await withProp(tree, 'data-dsh-widgets-brief')[0].props.onClick();
  assert.equal(lastRequest().method, 'POST');
  assert.deepEqual(lastRequest().body, { sessionId: 's1', retry: true });

  // Nothing at all while the widget is off: the route answers idle and the icon stays away.
  answer = () => ({ value: { status: 'idle' } });
  resetHooks();
  tree = entry.Component(props);
  await runEffects();
  hookIndex = 0;
  assert.equal(entry.Component(props), null);
  answer = () => ({ ok: true, value: {} });
}

// ---- the Settings panel ------------------------------------------------------------------------------------------------
{
  const entry = find('widgets');
  assert.equal(entry.options.name, 'settings.section');
  assert.equal(entry.options.label(), '小组件', 'the section follows the language the plugin resolves');

  const makeStore = (initial) => {
    let state = initial;
    const saved = [];
    return {
      saved,
      getSnapshot: () => state,
      subscribe: () => () => {},
      save: async (body) => { saved.push(body); state = { ...state, ...body }; return state; },
    };
  };
  const makeModels = (reasoning) => ({
    getSnapshot: () => ({ providers: [{ id: 'aliyun-code-plan', name: 'Aliyun', models: [{ id: 'deepseek-v4.1-flash-1017', name: 'Flash 1017' }] }] }),
    subscribe: () => () => {},
    reasoningOf: async () => reasoning,
  });
  const settingsOf = (overrides = {}) => ({
    on: {}, analysis: { model: null, effort: null }, language: 'zh', ...overrides,
  });

  // Every widget has a row, in Settings order, in Chinese.
  resetHooks();
  let tree = entry.Component({ store: makeStore(settingsOf()), models: makeModels({ supported: false, efforts: [] }), locale: ctx.locale });
  assert.deepEqual(withProp(tree, 'data-dsh-widgets-row').map((node) => node.props['data-dsh-widgets-row']),
    ['planToggle', 'queueReorder', 'queueEdit', 'improvePrompt', 'projectBrief']);
  assert.ok(texts(tree).includes('项目基本信息'), 'the new widget is described in the UI language');

  // A switch writes exactly its own id.
  const store = makeStore(settingsOf());
  resetHooks();
  tree = entry.Component({ store, models: makeModels({ supported: false, efforts: [] }), locale: ctx.locale });
  // The marker is on the Switch element and on the button it draws; the element is the one with `onChange`.
  const switches = withProp(tree, 'data-dsh-widgets-switch').filter((node) => typeof node.props.onChange === 'function');
  assert.equal(switches.length, 5);
  switches.find((node) => node.props.label === '项目基本信息').props.onChange(true);
  assert.deepEqual(store.saved, [{ id: 'projectBrief', on: true }]);

  // The language row pins the plugin's own language.
  const languageSelect = withProp(tree, 'data-dsh-widgets-language')[0];
  assert.deepEqual(languageSelect.props.children.map((option) => option.props.value), ['auto', 'en', 'zh']);
  languageSelect.props.onChange({ target: { value: 'en' } });
  assert.deepEqual(store.saved.at(-1), { language: 'en' });

  // One model setting, shared: "same as the chat" claims nothing about a ladder it has not resolved.
  const modelMenu = withProp(tree, 'data-dsh-widgets-analysis-model')[0];
  assert.ok(modelMenu !== undefined);
  assert.equal(withProp(tree, 'data-dsh-widgets-effort-follows').length, 1, 'no false "this model has no effort"');
  assert.equal(withProp(tree, 'data-dsh-widgets-effort-none').length, 0);
  modelMenu.props.onChange({ target: { value: JSON.stringify(['aliyun-code-plan', 'deepseek-v4.1-flash-1017']) } });
  assert.deepEqual(store.saved.at(-1), { analysis: { model: { provider: 'aliyun-code-plan', model: 'deepseek-v4.1-flash-1017' }, effort: null } });

  // A chosen model that declares no ladder says so; one that does offers exactly its levels.
  resetHooks();
  tree = entry.Component({ store: makeStore(settingsOf({ analysis: { model: { provider: 'p', model: 'm' }, effort: null } })), models: makeModels({ supported: false, efforts: [] }), locale: ctx.locale });
  assert.equal(withProp(tree, 'data-dsh-widgets-effort-none').length, 1);

  const effortStore = makeStore(settingsOf({ analysis: { model: { provider: 'p', model: 'm' }, effort: null } }));
  const reasoning = { supported: true, efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] };
  resetHooks();
  tree = entry.Component({ store: effortStore, models: makeModels(reasoning), locale: ctx.locale });
  await runEffects();
  hookIndex = 0;
  tree = entry.Component({ store: effortStore, models: makeModels(reasoning), locale: ctx.locale });
  const effortMenu = withProp(tree, 'data-dsh-widgets-analysis-effort')[0];
  assert.deepEqual(effortMenu.props.children.map((option) => option.props.value), ['', 'off', 'low', 'high'], 'off is offered like any other level');
  effortMenu.props.onChange({ target: { value: 'off' } });
  assert.deepEqual(effortStore.saved.at(-1), { analysis: { effort: 'off' } });

  // Search narrows the rows.
  resetHooks();
  tree = entry.Component({ store, models: makeModels(reasoning), locale: ctx.locale });
  withProp(tree, 'data-dsh-widgets-search')[0].props.onChange({ target: { value: 'queue' } });
  hookIndex = 0;
  tree = entry.Component({ store, models: makeModels(reasoning), locale: ctx.locale });
  assert.deepEqual(withProp(tree, 'data-dsh-widgets-row').map((node) => node.props['data-dsh-widgets-row']), ['queueReorder', 'queueEdit']);
}

console.log('client widgets checks passed');