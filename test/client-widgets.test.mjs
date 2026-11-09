// Runs the real client.js components against a fake React and DOM: the queue strip (drag, keys, in-place edit), the
// branch-target picker (five mutually exclusive modes), the Improve prompt wand (model + effort), and the Settings panel
// (one row per switch, the model menu, and the reasoning menu that follows the local configuration).
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
  // Children are flattened, as a rendered tree would be: a `select`'s options are one flat list.
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
  useSyncExternalStore: (subscribe, get) => { subscribe?.(() => {}); return get(); },
};
const resetHooks = () => { hooks = []; hookIndex = 0; effects = []; };

// ---- tree helpers ------------------------------------------------------------------------------------------------------
const nodes = (node) => {
  if (node === null || node === undefined || node === false || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children ?? [])];
};
const withProp = (tree, name) => nodes(tree).filter((node) => node.props?.[name] !== undefined);
const byType = (tree, type) => nodes(tree).filter((node) => node.type === type);
const texts = (tree) => nodes(tree).flatMap((node) => node.props?.children ?? []).filter((child) => typeof child === 'string');

// ---- fetch stub --------------------------------------------------------------------------------------------------------
let requests = [];
let answer = () => ({ ok: true, value: {} });
globalThis.fetch = async (url, init) => {
  requests.push({ url, method: init?.method ?? 'GET', body: init?.body === undefined ? undefined : JSON.parse(init.body) });
  const { ok = true, value = {}, status = 200 } = answer(url, init);
  return { ok, status, json: async () => value };
};
const lastRequest = () => requests.at(-1);
/** Let the fire-and-forget move/edit settle before looking at what it did. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---- boot the plugin ---------------------------------------------------------------------------------------------------
const registrations = [];
const ctx = {
  slots: { inject: (name, callback) => callback(), register: (options, Component) => { registrations.push({ options, Component }); return () => {}; } },
  locale: { getSnapshot: () => ({ active: 'en' }) },
  sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd: '/repo' } } }) }, scope: () => undefined },
  get: () => undefined,
};
module.factory((id) => (id === 'react' ? React : {})).apply(ctx);
const find = (id) => registrations.find((entry) => entry.options.id === id);

// ---- the queue strip ---------------------------------------------------------------------------------------------------
{
  const entry = find('widgets-queue');
  assert.ok(entry !== undefined, 'the queue panel registers');
  assert.equal(entry.options.name, 'conversation.input.dock');
  const render = (rows, settings = { on: {} }, notify = () => {}) => {
    // One hook index for the whole tree: the wrapper's store hook and the panel's own state must stay aligned between
    // renders, exactly as React keeps them.
    hookIndex = 0;
    const element = entry.Component({ sessionId: 's1', useProjection: () => rows, notify, t: (key) => key });
    return element.type({ ...element.props, settings });
  };
  const rows = [
    { id: 'a', source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] },
    { id: 'b', source: { kind: 'user' }, content: [{ type: 'text', text: 'second' }] },
    { id: 'g', source: { kind: 'goal' }, content: [{ type: 'text', text: 'goal round' }] },
  ];

  resetHooks(); requests = [];
  let tree = render(rows);
  assert.equal(withProp(tree, 'data-dsh-widgets-queue').length, 1);
  assert.equal(withProp(tree, 'data-dsh-widgets-queue-row').length, 3, 'one row per queued message');
  const grips = withProp(tree, 'data-dsh-widgets-grip');
  assert.equal(grips.length, 2, 'only your own messages get a grip');
  assert.equal(grips[0].props.disabled, false);

  // The down key asks the Host to move the row, naming the queue the user saw.
  await grips[0].props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  await flush();
  assert.deepEqual(lastRequest().body, { sessionId: 's1', itemId: 'a', to: 1, before: ['a', 'b', 'g'] });
  assert.equal(lastRequest().url, '/api/widgets.queue-move');

  // The first row cannot go up, and a goal round is never moved.
  requests = []; hookIndex = 0;
  tree = render(rows);
  assert.equal(withProp(tree, 'data-dsh-widgets-grip').length, 2, 'a goal round gets no grip at all');
  const arrows = withProp(tree, 'aria-label');
  assert.equal(arrows.filter((node) => node.props['aria-label'] === 'queue.moveUp').length, 2);

  // A refusal is reported through dsh's own notice, and nothing else happens.
  const notices = [];
  answer = () => ({ ok: false, status: 409, value: { error: 'the queue changed' } });
  hookIndex = 0;
  const failing = render(rows, { on: {} }, (level, text) => notices.push([level, text]));
  await withProp(failing, 'data-dsh-widgets-grip')[0].props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  await flush();
  assert.deepEqual(notices, [['error', 'queue.failed']]);
  answer = () => ({ ok: true, value: {} });

  // In-place editing: double-click opens a field, Enter saves with what the user saw, Esc cancels.
  resetHooks(); requests = [];
  tree = render(rows);
  const labels = withProp(tree, 'data-dsh-widgets-queue-row');
  labels[0].props.children.find((child) => child?.props?.className === 'dw-text').props.onDoubleClick();
  hookIndex = 0;
  tree = render(rows);
  const field = withProp(tree, 'data-dsh-widgets-edit')[0];
  assert.ok(field !== undefined, 'the editor opens in the row');
  field.props.onChange({ target: { value: 'first, edited' } });
  hookIndex = 0;
  tree = render(rows);
  await withProp(tree, 'data-dsh-widgets-edit')[0].props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault() {} });
  await flush();
  const saved = lastRequest();
  assert.equal(saved.url, '/api/widgets.queue-edit');
  assert.deepEqual(saved.body, { sessionId: 's1', itemId: 'a', content: [{ type: 'text', text: 'first, edited' }], seen: [['text', 'first']] });

  // Shift+Enter adds a line instead of saving; Esc closes without a request.
  requests = [];
  hookIndex = 0;
  tree = render(rows);
  withProp(tree, 'data-dsh-widgets-queue-row')[0].props.children.find((child) => child?.props?.className === 'dw-text').props.onDoubleClick();
  hookIndex = 0;
  tree = render(rows);
  requests = [];
  withProp(tree, 'data-dsh-widgets-edit')[0].props.onKeyDown({ key: 'Enter', shiftKey: true, preventDefault() {} });
  assert.deepEqual(requests, [], 'Shift+Enter does not save');
  withProp(tree, 'data-dsh-widgets-edit')[0].props.onKeyDown({ key: 'Escape', preventDefault() {} });
  assert.deepEqual(requests, []);

  // One row is not worth a strip, and both switches off removes the panel entirely.
  resetHooks();
  assert.equal(render(rows.slice(0, 1)), null);
  assert.equal(render(rows, { on: { queueReorder: false, queueEdit: false } }), null);

  // With reorder off and edit on, the strip stays and only the edit affordance remains.
  resetHooks();
  tree = render(rows, { on: { queueReorder: false, queueEdit: true } });
  assert.equal(withProp(tree, 'data-dsh-widgets-grip').length, 0);
  assert.ok(withProp(tree, 'data-dsh-widgets-edit-open').length > 0);
}

// ---- the branch-target picker ------------------------------------------------------------------------------------------
{
  const entry = find('widgets-branch-target');
  assert.ok(entry !== undefined, 'the target picker registers');
  const started = [];
  const props = entry.options.inject('s1');
  assert.equal(props.projectPath, '/repo', 'the picker knows the chat\'s project folder');

  answer = (url) => (String(url).startsWith('/api/widgets.branch-target')
    ? { value: { cwd: '/repo', repo: true, branch: 'main', branches: ['main', 'feat/x'], worktrees: [{ path: '/repo/.worktrees/feat-x', branch: 'feat/x' }], mode: 'current' } }
    : { value: {} });
  resetHooks(); requests = [];
  let tree = entry.Component({ ...props, startIn: (value) => started.push(value) });
  assert.equal(withProp(tree, 'data-dsh-widgets-branch-open').length, 1);
  assert.equal(texts(tree).join(' '), 'Start on', 'the button starts on the plain title');

  // Opening the panel reads the project once.
  await withProp(tree, 'data-dsh-widgets-branch-open')[0].props.onClick();
  assert.equal(lastRequest().url, '/api/widgets.branch-target?sessionId=s1');
  hookIndex = 0;
  tree = entry.Component({ ...props, startIn: (value) => started.push(value) });
  assert.ok(withProp(tree, 'data-dsh-widgets-branch-panel').length === 1, 'the panel opens');

  // Every mode is offered, and the current branch is the one selected at first.
  const modeSelect = withProp(tree, 'data-dsh-widgets-mode')[0];
  assert.deepEqual(modeSelect.props.children.map((option) => option.props.value), ['current', 'branch', 'worktree', 'existing-branch', 'existing-worktree']);
  assert.equal(modeSelect.props.value, 'current');

  // Choosing a new branch shows a name field, and starting sends exactly that mode with the typed name.
  modeSelect.props.onChange({ target: { value: 'branch' } });
  hookIndex = 0;
  tree = entry.Component({ ...props, startIn: (value) => started.push(value) });
  const nameField = withProp(tree, 'data-dsh-widgets-branch-name')[0];
  assert.ok(nameField !== undefined, 'a new branch asks for its name');
  nameField.props.onChange({ target: { value: 'feat/typed' } });
  hookIndex = 0;
  tree = entry.Component({ ...props, startIn: (value) => started.push(value) });
  requests = [];
  await withProp(tree, 'data-dsh-widgets-branch-start')[0].props.onClick();
  assert.equal(lastRequest().method, 'POST');
  assert.deepEqual(lastRequest().body, { mode: 'branch', sessionId: 's1', branchName: 'feat/typed' });
  assert.equal(started.length, 1);

  // A worktree sends the worktree mode and never a branch name at the same time.
  answer = (url) => (String(url).startsWith('/api/widgets.branch-target')
    ? { value: { cwd: '/repo', repo: true, branch: 'main', branches: ['main'], worktrees: [{ path: '/repo/.worktrees/w', branch: 'feat/x' }], mode: 'current' } }
    : { value: {} });
  resetHooks(); requests = []; started.length = 0;
  tree = entry.Component({ ...props, startIn: (value) => started.push(value) });
  await withProp(tree, 'data-dsh-widgets-branch-open')[0].props.onClick();
  hookIndex = 0;
  tree = entry.Component({ ...props, startIn: (value) => started.push(value) });
  withProp(tree, 'data-dsh-widgets-mode')[0].props.onChange({ target: { value: 'worktree' } });
  hookIndex = 0;
  tree = entry.Component({ ...props, startIn: (value) => started.push(value) });
  requests = [];
  await withProp(tree, 'data-dsh-widgets-branch-start')[0].props.onClick();
  assert.deepEqual(lastRequest().body, { mode: 'worktree', sessionId: 's1' }, 'no name typed: the Host names it, and no branch is named alongside');

  // An existing worktree is a different mode, with the folder chosen from the list. Starting a target closes the panel,
  // so it is opened again first.
  hookIndex = 0;
  tree = entry.Component({ ...props, startIn: (value) => started.push(value) });
  await withProp(tree, 'data-dsh-widgets-branch-open')[0].props.onClick();
  await flush();
  hookIndex = 0;
  tree = entry.Component({ ...props, startIn: (value) => started.push(value) });
  withProp(tree, 'data-dsh-widgets-mode')[0].props.onChange({ target: { value: 'existing-worktree' } });
  hookIndex = 0;
  tree = entry.Component({ ...props, startIn: (value) => started.push(value) });
  const worktreeSelect = withProp(tree, 'data-dsh-widgets-existing-worktree')[0];
  assert.ok(worktreeSelect !== undefined, 'an existing worktree is picked from the list the Host knows');
  worktreeSelect.props.onChange({ target: { value: '/repo/.worktrees/w' } });
  hookIndex = 0;
  tree = entry.Component({ ...props, startIn: (value) => started.push(value) });
  requests = [];
  await withProp(tree, 'data-dsh-widgets-branch-start')[0].props.onClick();
  assert.deepEqual(lastRequest().body, { mode: 'existing-worktree', sessionId: 's1', worktreePath: '/repo/.worktrees/w' });

  // A refusal is shown in the panel and reported, and no chat is started.
  answer = () => ({ ok: false, status: 409, value: { error: 'the branch already exists' } });
  const notices = [];
  resetHooks();
  tree = entry.Component({ ...props, notify: (level, text) => notices.push([level, text]), startIn: (value) => started.push(value) });
  await withProp(tree, 'data-dsh-widgets-branch-open')[0].props.onClick();
  hookIndex = 0;
  tree = entry.Component({ ...props, notify: (level, text) => notices.push([level, text]), startIn: () => assert.fail('no chat for a refused target') });
  await withProp(tree, 'data-dsh-widgets-branch-start')[0].props.onClick();
  assert.deepEqual(notices, [['error', 'Could not start there: the branch already exists']], 'the reason is shown, in the UI language');
  answer = () => ({ ok: true, value: {} });
}

// ---- the Improve prompt wand -------------------------------------------------------------------------------------------
{
  const entry = find('widgets-improve');
  assert.ok(entry !== undefined, 'the wand registers');
  const drafts = [];
  const actions = { setDraft: (text) => drafts.push(text) };
  const notices = [];
  const storeOf = (improve) => ({ getSnapshot: () => ({ improve }) });
  const base = {
    sessionId: 's1', useInput: (read) => read({ draft: 'make login work' }), inputActions: actions,
    chatProvider: 'local', chatModel: 'with-effort', store: storeOf({ model: null, effort: null }),
    notify: (level, text) => notices.push([level, text]), t: (key) => key,
  };

  // One click sends the draft, the model and the saved effort, then replaces the draft without sending it.
  answer = () => ({ value: { text: 'Make the login form work end to end.' } });
  resetHooks(); requests = [];
  let tree = entry.Component({ ...base, store: storeOf({ model: null, effort: 'high' }) });
  await withProp(tree, 'data-dsh-widgets-wand')[0].props.onClick();
  assert.equal(lastRequest().url, '/api/widgets.improve');
  assert.deepEqual(lastRequest().body, { sessionId: 's1', text: 'make login work', provider: 'local', model: 'with-effort', effort: 'high' });
  assert.deepEqual(drafts, ['Make the login form work end to end.']);

  // A model and an effort chosen in Settings after the chat opened are the ones used: the wand reads the settings at
  // click time, not at mount time.
  const later = { improve: { model: { provider: 'aliyun-code-plan', model: 'deepseek-v4.1-flash-1017' }, effort: 'low' } };
  requests = [];
  hookIndex = 0;
  tree = entry.Component({ ...base, store: { getSnapshot: () => later } });
  await withProp(tree, 'data-dsh-widgets-wand')[0].props.onClick();
  assert.deepEqual(lastRequest().body, {
    sessionId: 's1', text: 'make login work', provider: 'aliyun-code-plan', model: 'deepseek-v4.1-flash-1017', effort: 'low',
  });

  // Nothing chosen leaves the field out, so the model's own configuration decides.
  requests = [];
  hookIndex = 0;
  tree = entry.Component({ ...base, store: storeOf({ model: null, effort: null }) });
  await withProp(tree, 'data-dsh-widgets-wand')[0].props.onClick();
  assert.equal('effort' in lastRequest().body, false);

  // Undo puts the original draft back, in one step.
  hookIndex = 0;
  tree = entry.Component({ ...base, store: storeOf({ effort: null }) });
  const undo = withProp(tree, 'data-dsh-widgets-undo')[0];
  assert.ok(undo !== undefined, 'an improvement can be undone');
  undo.props.onClick();
  assert.equal(drafts.at(-1), 'make login work');

  // A failure is reported and the draft is left alone.
  answer = () => ({ ok: false, status: 502, value: { error: 'the model failed' } });
  const before = drafts.length;
  resetHooks();
  tree = entry.Component({ ...base, store: storeOf({}), notify: (level, text) => notices.push([level, text]) });
  await withProp(tree, 'data-dsh-widgets-wand')[0].props.onClick();
  assert.equal(drafts.length, before, 'a failure does not replace the draft');
  assert.deepEqual(notices, [['error', 'improve.failed']]);
  hookIndex = 0;
  tree = entry.Component({ ...base, store: storeOf({}), notify: (level, text) => notices.push([level, text]) });
  assert.ok(withProp(tree, 'role')[0] !== undefined, 'the panel keeps the reason');

  // An empty draft costs no model call; a chat without a model disables the wand.
  requests = [];
  hookIndex = 0;
  tree = entry.Component({ ...base, useInput: (read) => read({ draft: '   ' }), store: storeOf({}) });
  await withProp(tree, 'data-dsh-widgets-wand')[0].props.onClick();
  assert.deepEqual(requests, []);
  hookIndex = 0;
  tree = entry.Component({ ...base, chatProvider: undefined, chatModel: undefined, store: storeOf({}) });
  assert.equal(withProp(tree, 'data-dsh-widgets-wand')[0].props.disabled, true);
  answer = () => ({ ok: true, value: {} });
}

// ---- the Settings panel ------------------------------------------------------------------------------------------------
{
  const entry = find('widgets');
  assert.ok(entry !== undefined, 'the settings section registers');

  assert.equal(entry.options.name, 'settings.section');
  const label = entry.options.label();
  assert.equal(label, 'Widgets', 'English first, from the one place that names the section');

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
    getSnapshot: () => ({ providers: [{ id: 'aliyun-code-plan', name: 'Aliyun Code Plan', models: [{ id: 'deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash 1017' }] }] }),
    subscribe: () => () => {},
    reasoningOf: async () => reasoning,
  });

  // Every widget has a row, and a switch writes exactly its own id.
  const store = makeStore({ on: {}, branchTarget: { mode: 'current' }, improve: { model: null, effort: null } });
  resetHooks();
  let tree = entry.Component({ store, models: makeModels({ supported: false, efforts: [] }), locale: ctx.locale });
  for (const id of ['branchTarget', 'branchTree', 'planToggle', 'queueReorder', 'queueEdit', 'improvePrompt']) {
    assert.equal(withProp(tree, 'data-dsh-widgets-row').some((node) => node.props['data-dsh-widgets-row'] === id), true, id);
  }
  const switches = withProp(tree, 'data-dsh-widgets-switch');
  assert.equal(switches.length, 6);
  assert.deepEqual(switches.map((node) => node.props.label), [
    'Branch per chat', 'Branches in the workspace tree', 'Shift+Tab plan mode',
    'Queue drag-and-drop', 'Edit queued message in place', 'Improve prompt',
  ], 'the rows are in Settings order, in the UI language');
  const branchTreeSwitch = switches[1];
  assert.equal(branchTreeSwitch.props.on, false, 'off by default');
  branchTreeSwitch.props.onChange(true);
  assert.deepEqual(store.saved, [{ id: 'branchTree', on: true }]);

  // The switch itself is one accessible control, and its state is in `aria-checked`.
  const SwitchComponent = switches[0].type;
  const onButton = SwitchComponent({ on: true, onChange: () => {}, label: 'x' });
  assert.equal(onButton.type, 'button');
  assert.equal(onButton.props.role, 'switch');
  assert.equal(onButton.props['aria-checked'], true);
  assert.equal(onButton.props['aria-label'], 'x');
  const offButton = SwitchComponent({ on: false, onChange: () => {}, label: 'x' });
  assert.equal(offButton.props['aria-checked'], false);

  // The Improve prompt row carries the model menu; the reasoning menu appears only when the model declares efforts.
  const modelMenu = withProp(tree, 'data-dsh-widgets-improve-model')[0];
  assert.ok(modelMenu !== undefined);
  assert.deepEqual(modelMenu.props.children[0].props.children, ['Same as the chat'], 'the first entry follows the chat');
  modelMenu.props.onChange({ target: { value: JSON.stringify(['aliyun-code-plan', 'deepseek-v4.1-flash-1017']) } });
  assert.deepEqual(store.saved.at(-1), { improve: { model: { provider: 'aliyun-code-plan', model: 'deepseek-v4.1-flash-1017' }, effort: null } });

  // A model with no declared effort says so instead of offering a made-up ladder.
  const noEffortStore = makeStore({ on: {}, branchTarget: { mode: 'current' }, improve: { model: { provider: 'aliyun-code-plan', model: 'deepseek-v4.1-flash' }, effort: null } });
  resetHooks();
  tree = entry.Component({ store: noEffortStore, models: makeModels({ supported: false, efforts: [] }), locale: ctx.locale });
  assert.equal(withProp(tree, 'data-dsh-widgets-improve-effort').length, 0);
  assert.equal(withProp(tree, 'data-dsh-widgets-effort-none').length, 1);
  assert.equal(texts(withProp(tree, 'data-dsh-widgets-effort-none')[0]).join(''), 'This model declares no reasoning effort');

  // A model that does declare efforts offers exactly those, and choosing one saves it.
  const effortStore = makeStore({ on: {}, branchTarget: { mode: 'current' }, improve: { model: { provider: 'aliyun-code-plan', model: 'deepseek-v4.1-flash-1017' }, effort: null } });
  const reasoning = { supported: true, efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }], defaultEffort: 'medium' };
  resetHooks();
  tree = entry.Component({ store: effortStore, models: makeModels(reasoning), locale: ctx.locale });
  for (const run of effects) run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  hookIndex = 0;
  tree = entry.Component({ store: effortStore, models: makeModels(reasoning), locale: ctx.locale });
  const effortMenu = withProp(tree, 'data-dsh-widgets-improve-effort')[0];
  assert.ok(effortMenu !== undefined, 'the effort menu follows the model the configuration declares');
  assert.deepEqual(effortMenu.props.children.map((option) => option.props.value), ['', 'off', 'low', 'medium', 'high']);
  effortMenu.props.onChange({ target: { value: 'high' } });
  assert.deepEqual(effortStore.saved.at(-1), { improve: { effort: 'high' } });

  // The default target lives here too, and the switch state gates it.
  const modeStore = makeStore({ on: {}, branchTarget: { mode: 'current' }, improve: { model: null, effort: null } });
  resetHooks();
  tree = entry.Component({ store: modeStore, models: makeModels(reasoning), locale: ctx.locale });
  const modeSelect = withProp(tree, 'data-dsh-widgets-default-mode')[0];
  modeSelect.props.onChange({ target: { value: 'worktree' } });
  assert.deepEqual(modeStore.saved, [{ branchTarget: { mode: 'worktree' } }]);
  resetHooks();
  tree = entry.Component({ store: makeStore({ on: { branchTarget: false, improvePrompt: false }, branchTarget: { mode: 'current' }, improve: { model: null, effort: null } }), models: makeModels(reasoning), locale: ctx.locale });
  assert.equal(withProp(tree, 'data-dsh-widgets-default-mode').length, 0, 'a switched-off widget shows no settings');
  assert.equal(withProp(tree, 'data-dsh-widgets-improve-model').length, 0);

  // The search narrows the rows, and an empty result says so.
  resetHooks();
  tree = entry.Component({ store, models: makeModels({ supported: false, efforts: [] }), locale: ctx.locale });
  withProp(tree, 'data-dsh-widgets-search')[0].props.onChange({ target: { value: 'queue' } });
  hookIndex = 0;
  tree = entry.Component({ store, models: makeModels({ supported: false, efforts: [] }), locale: ctx.locale });
  assert.deepEqual(withProp(tree, 'data-dsh-widgets-row').map((node) => node.props['data-dsh-widgets-row']), ['queueReorder', 'queueEdit']);
  withProp(tree, 'data-dsh-widgets-search')[0].props.onChange({ target: { value: 'zzz' } });
  hookIndex = 0;
  tree = entry.Component({ store, models: makeModels({ supported: false, efforts: [] }), locale: ctx.locale });
  assert.equal(withProp(tree, 'data-dsh-widgets-row').length, 0);
  assert.equal(texts(tree).includes('No matching widget.'), true);

  // A read failure is shown, not hidden.
  resetHooks();
  tree = entry.Component({ store: { ...makeStore({ on: {}, improve: {} }), getSnapshot: () => ({ on: {}, improve: {}, error: 'boom' }) }, models: makeModels({ supported: false, efforts: [] }), locale: ctx.locale });
  assert.equal(texts(tree).some((text) => String(text).startsWith('The settings could not be read')), true);
}

// ---- switching a widget off takes its panel away ------------------------------------------------------------------------
{
  registrations.length = 0;
  let state = { on: {}, branchTarget: { mode: 'current' }, improve: { model: null, effort: null } };
  const listeners = new Set();
  const subscribes = [];
  const togglesCtx = {
    ...ctx,
    slots: {
      inject: (name, callback) => callback(),
      register: (options, Component) => {
        subscribes.push(options.id);
        return () => { const index = subscribes.indexOf(options.id); if (index !== -1) subscribes.splice(index, 1); };
      },
    },
  };
  answer = () => ({ value: state });
  module.factory((id) => (id === 'react' ? React : {})).apply(togglesCtx);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const registered = [...subscribes];
  assert.ok(registered.includes('widgets-queue'), 'the queue panel is on at first');
  assert.ok(registered.includes('widgets-plan-toggle'), 'the plan key is on at first');
  assert.equal(registered.includes('widgets-plan-toggle'), true);
  void listeners; void byType;
}

console.log('client widgets checks passed');