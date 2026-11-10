// Runs the real client.js components against a fake React and DOM: the target chip (picker and badge), the Improve
// prompt wand, the project-brief status icon, and the Settings panel.
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

// ---- the Improve prompt wand -------------------------------------------------------------------------------------------
{
  const entry = find('widgets-improve');
  const drafts = [];
  const notices = [];
  const storeOf = (analysis) => ({ getSnapshot: () => ({ analysis }) });
  let state = { draft: 'make login work', attachmentIds: [], phase: 'plain', draftRev: 1 };
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
    state = { draft: 'make login work', attachmentIds: [], phase: 'plain', draftRev: 1 };
    answer = () => ({ value: { text: 'Make the login form work.' } });
    resetHooks();
    tree = entry.Component(base);
    await withProp(tree, 'data-dsh-widgets-wand')[0].props.onClick();
    hookIndex = 0;
    tree = entry.Component(base);
    assert.equal(withProp(tree, 'data-dsh-widgets-undo-draft').length, 1, 'an undo appears beside the wand');

    // The message is sent: the composer empties.
    state = { draft: '', attachmentIds: [], phase: 'sending', draftRev: 2 };
    hookIndex = 0;
    tree = entry.Component(base);
    await runEffects();
    hookIndex = 0;
    tree = entry.Component(base);
    assert.equal(withProp(tree, 'data-dsh-widgets-undo-draft').length, 0, 'a sent message leaves no undo behind');

    // A send that clears the editor a moment later, then a new draft typed before the effect runs: the submit phase
    // alone must drop the history.
    state = { draft: 'make login work', attachmentIds: [], phase: 'plain', draftRev: 1 };
    answer = () => ({ value: { text: 'Make the login form work.' } });
    resetHooks(); tree = entry.Component(base);
    await withProp(tree, 'data-dsh-widgets-wand')[0].props.onClick();
    hookIndex = 0; tree = entry.Component(base);
    assert.equal(withProp(tree, 'data-dsh-widgets-undo').length, 1);
    state = { draft: 'new draft', attachmentIds: [], phase: 'sending', draftRev: 4 };
    hookIndex = 0; tree = entry.Component(base);
    await runEffects();
    hookIndex = 0; tree = entry.Component(base);
    assert.equal(withProp(tree, 'data-dsh-widgets-undo').length, 0, 'send clears even when a new draft is already there');
    assert.equal(withProp(tree, 'data-dsh-widgets-redo').length, 0);
  }

  // ---- undo → redo switches the icons and the draft ----------------------------------------------------------------
  {
    state = { draft: 'make login work', attachmentIds: [], phase: 'plain', draftRev: 1 };
    answer = () => ({ value: { text: 'Make the login form work.' } });
    resetHooks(); tree = entry.Component(base);
    await withProp(tree, 'data-dsh-widgets-wand')[0].props.onClick();
    hookIndex = 0; tree = entry.Component(base);
    withProp(tree, 'data-dsh-widgets-undo')[0].props.onClick();
    assert.deepEqual(drafts.at(-1), 'make login work');
    state = { draft: 'make login work', attachmentIds: [], phase: 'plain', draftRev: 1 };
    hookIndex = 0; tree = entry.Component(base);
    assert.equal(withProp(tree, 'data-dsh-widgets-undo').length, 0, 'the undo is replaced by the reverse action');
    assert.equal(withProp(tree, 'data-dsh-widgets-redo').length, 1);
    withProp(tree, 'data-dsh-widgets-redo')[0].props.onClick();
    assert.deepEqual(drafts.at(-1), 'Make the login form work.');
    state = { draft: 'Make the login form work.', attachmentIds: [], phase: 'plain', draftRev: 5 };
    hookIndex = 0; tree = entry.Component(base);
    assert.equal(withProp(tree, 'data-dsh-widgets-redo').length, 0, 'restoring the rewrite brings the undo back');
    assert.equal(withProp(tree, 'data-dsh-widgets-undo').length, 1);
  }

  // ---- a failed image read is an error, never a silent text-only optimisation ---------------------------------------
  {
    state = { draft: 'match this screenshot', attachmentIds: ['a1'], phase: 'plain', draftRev: 1 };
    requests = []; const count = drafts.length;
    resetHooks(); tree = entry.Component({
      ...base,
      serializeAttachments: async () => { throw new Error('cannot read'); },
    });
    await withProp(tree, 'data-dsh-widgets-wand')[0].props.onClick();
    assert.equal(requests.length, 0, 'no text-only request is sent');
    assert.equal(drafts.length, count, 'the draft is untouched');
    assert.deepEqual(notices.at(-1), ['error', 'improve.failed']);
  }

  // ---- a result that arrives after the draft moved on is discarded, never refilled ---------------------------------
  {
    state = { draft: 'keep this', attachmentIds: [], phase: 'plain', draftRev: 10 };
    let release;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      requests.push({ url, method: init?.method ?? 'GET', body: init?.body === undefined ? undefined : JSON.parse(init.body) });
      await new Promise((resolve) => { release = resolve; });
      return { ok: true, status: 200, json: async () => ({ text: 'stale rewrite' }) };
    };
    resetHooks(); requests = []; const count = drafts.length;
    tree = entry.Component(base);
    const pending = withProp(tree, 'data-dsh-widgets-wand')[0].props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    state = { draft: '', attachmentIds: [], phase: 'sending', draftRev: 11 };
    hookIndex = 0; tree = entry.Component(base);
    release();
    await pending;
    hookIndex = 0; tree = entry.Component(base);
    assert.equal(drafts.length, count, 'the sent draft is not refilled');
    assert.equal(withProp(tree, 'data-dsh-widgets-undo').length, 0);
    globalThis.fetch = realFetch;
  }

  // ---- a call in flight: the icon says so, the composer is locked, the images travel ---------------------------------
  {
    state = { draft: 'match this screenshot', attachmentIds: ['a1'], phase: 'plain', draftRev: 3 };
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

    const locks = [];
    const lockComposer = (reason) => { locks.push(['lock', reason]); return () => { locks.push(['release']); }; };
    resetHooks(); requests = [];
    tree = entry.Component({
      ...base,
      serializeAttachments: async (ids) => { serialized.push(...ids); return [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }]; },
      lockComposer,
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
    assert.deepEqual(locks, [['lock', 'improve.working']], 'the composer block is raised before the call');

    release();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    // React runs the previous cleanup when the effect's dependency changes; the fake runtime is told to do the same.
    for (const cleanup of cleanups) cleanup();
    hookIndex = 0;
    tree = entry.Component(base);
    assert.equal(withProp(tree, 'data-dsh-widgets-wand')[0].props['aria-busy'], false, 'the icon stops when the call settles');
    assert.equal(seatAttribute, null, 'and the composer is handed back');
    assert.deepEqual(locks, [['lock', 'improve.working'], ['release']], 'and the composer block is released');
    globalThis.document = realDocument;
    globalThis.fetch = realFetch;
  }
  answer = () => ({ ok: true, value: {} });
}

// ---- the Handoff to a new session icon ---------------------------------------------------------------------------------
{
  const entry = find('widgets-handoff');
  assert.ok(entry !== undefined, 'the handoff icon registers');
  assert.equal(entry.options.name, 'conversation.input.right');
  assert.equal(entry.options.order, 996, 'between the project brief and the Improve wand');

  const opened = [];
  const notices = [];
  const props = {
    sessionId: 's1',
    t: (key, vars) => (vars === undefined ? key : `${key}(${Object.values(vars).join(',')})`),
    notify: (level, text) => notices.push([level, text]),
    openSession: async (id) => { opened.push(id); },
  };
  const state = (tree) => withProp(tree, 'data-dsh-widgets-handoff-state')[0]?.props['data-dsh-widgets-handoff-state'];
  const doneResult = {
    status: 'done', sessionId: 'new-1', newSessionId: 'new-1', handoff: '## Goal\nShip it.', project: { cwd: '/repo' },
    timings: { totalMs: 1234, readMs: 1, prepareMs: 2, modelMs: 1000, createMs: 3, promptMs: 4, transcriptChars: 500, outputChars: 100, reasoningChars: 0, repaired: false },
  };

  // A session with no remembered handoff starts idle; one click hands it off and leaves a pill that can open the new
  // session again.
  answer = (url, init) => (init?.method === 'POST' ? { value: doneResult } : { value: { status: 'idle' } });
  resetHooks(); requests = []; notices.length = 0; opened.length = 0;
  let tree = entry.Component(props);
  await runEffects();
  hookIndex = 0; tree = entry.Component(props);
  assert.equal(state(tree), 'idle', 'the recovered state is idle');
  await withProp(tree, 'data-dsh-widgets-handoff')[0].props.onClick();
  hookIndex = 0; tree = entry.Component(props);
  assert.deepEqual(lastRequest().body, { sessionId: 's1' });
  assert.equal(lastRequest().url, '/api/widgets.handoff');
  assert.deepEqual(opened, ['new-1'], 'the new session is opened');
  assert.deepEqual(notices, [['info', 'handoff.done']]);
  assert.equal(state(tree), 'done', 'a finished handoff stays visible');
  const pill = withProp(tree, 'data-dsh-widgets-handoff-open')[0];
  const pillText = pill.props.children.join('');
  assert.match(pillText, /handoff\.completed/, 'the pill says the handoff is done');
  assert.match(pillText, /handoff\.seconds\(1\.2\)/, 'and how long it took');
  const before = requests.length;
  await withProp(tree, 'data-dsh-widgets-handoff-open')[0].props.onClick();
  assert.deepEqual(opened, ['new-1', 'new-1'], 'the pill reopens the handoff session');
  assert.equal(requests.length, before, 'opening it again does not start another handoff');

  // Forgetting the handoff returns the icon, and the next click is a new handoff.
  answer = (url, init) => (init?.method === 'POST' && init.body.includes('dismiss')
    ? { value: { status: 'idle' } }
    : init?.method === 'POST' ? { value: { ...doneResult, sessionId: 'new-2', newSessionId: 'new-2' } } : { value: { status: 'done', newSessionId: 'new-1' } });
  resetHooks(); requests = []; opened.length = 0;
  entry.Component(props);
  await runEffects();
  hookIndex = 0; tree = entry.Component(props);
  assert.equal(state(tree), 'done', 'the Host remembers the finished handoff after a remount');
  assert.deepEqual(opened, [], 'recovering a finished handoff does not hijack navigation');
  await withProp(tree, 'data-dsh-widgets-handoff-dismiss')[0].props.onClick();
  hookIndex = 0; tree = entry.Component(props);
  assert.deepEqual(lastRequest().body, { sessionId: 's1', dismiss: true });
  assert.equal(state(tree), 'idle', 'the record was forgotten');
  await withProp(tree, 'data-dsh-widgets-handoff')[0].props.onClick();
  assert.equal(lastRequest().method, 'POST');
  assert.equal(opened.at(-1), 'new-2', 'a new click starts a new handoff');

  // A call in flight: the icon reports work and cannot be pressed twice.
  {
    let release;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      requests.push({ url, method: init?.method ?? 'GET', body: init?.body === undefined ? undefined : JSON.parse(init.body) });
      if (init?.method !== 'POST') return { ok: true, status: 200, json: async () => ({ status: 'idle' }) };
      await new Promise((resolve) => { release = resolve; });
      return { ok: true, status: 200, json: async () => ({ ...doneResult, sessionId: 'new-2' }) };
    };
    resetHooks(); requests = []; opened.length = 0;
    tree = entry.Component(props);
    await runEffects();
    const pending = withProp(tree, 'data-dsh-widgets-handoff')[0].props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    hookIndex = 0; tree = entry.Component(props);
    const running = withProp(tree, 'data-dsh-widgets-handoff')[0];
    assert.equal(running.props['aria-busy'], true);
    assert.equal(running.props['data-dsh-widgets-handoff-working'], '');
    assert.equal(running.props.disabled, true);
    assert.equal(state(tree), 'running');
    release();
    await pending;
    hookIndex = 0; tree = entry.Component(props);
    assert.equal(state(tree), 'done');
    globalThis.fetch = realFetch;
  }

  // A failure keeps the current session and reports why.
  answer = () => ({ ok: false, status: 502, value: { error: 'the model failed' } });
  resetHooks(); opened.length = 0;
  tree = entry.Component(props);
  await withProp(tree, 'data-dsh-widgets-handoff')[0].props.onClick();
  hookIndex = 0; tree = entry.Component(props);
  assert.deepEqual(opened, []);
  assert.equal(notices.at(-1)[0], 'error');
  assert.match(notices.at(-1)[1], /^handoff\.failed/, 'the failure is reported with its reason');
  assert.equal(withProp(tree, 'role').some((node) => node.props.role === 'alert'), true, 'the error is visible');
  assert.equal(state(tree), 'failed');

  // A handoff whose process died is reported as interrupted, not as an endless work state.
  answer = (url, init) => (init?.method === 'GET' || init?.method === undefined
    ? { value: { status: 'failed', error: 'the previous handoff was interrupted' } }
    : { value: { status: 'idle' } });
  resetHooks(); notices.length = 0;
  tree = entry.Component(props);
  await runEffects();
  hookIndex = 0; tree = entry.Component(props);
  assert.equal(state(tree), 'failed');
  assert.equal(texts(tree).includes('handoff.interrupted'), true, 'the interruption is said in the UI language');

  // A handoff still running when the session is reopened keeps reporting work, then lands on its own.
  {
    let phase = 'running';
    answer = (url, init) => (init?.method === 'GET' || init?.method === undefined
      ? { value: phase === 'running' ? { status: 'running', startedAt: Date.now() } : { status: 'done', newSessionId: 'new-9', title: 'Handoff — old', timings: doneResult.timings } }
      : { value: { status: 'idle' } });
    resetHooks(); notices.length = 0; opened.length = 0;
    entry.Component(props);
    const first = await runEffects();
    hookIndex = 0; tree = entry.Component(props);
    assert.equal(state(tree), 'running', 'the running handoff was recovered from the Host');
    const polling = await runEffects();
    phase = 'done';
    await new Promise((resolve) => setTimeout(resolve, 1100));
    hookIndex = 0; tree = entry.Component(props);
    assert.equal(state(tree), 'done', 'the poll saw it finish');
    assert.deepEqual(opened, [], 'finishing in the background does not hijack navigation');
    assert.deepEqual(notices.at(-1), ['info', 'handoff.done'], 'it is announced once');
    for (const drop of [...first, ...polling]) drop?.();
  }

  // Navigation failing does not lose the handoff: the new id is reported.
  answer = () => ({ value: { ...doneResult, sessionId: 'new-3' } });
  resetHooks(); notices.length = 0;
  tree = entry.Component({ ...props, openSession: async () => { throw new Error('no navigation'); } });
  await withProp(tree, 'data-dsh-widgets-handoff')[0].props.onClick();
  assert.deepEqual(notices.map(([level, text]) => [level, text.replace(/\(.*$/, '')]),
    [['info', 'handoff.done'], ['error', 'handoff.openFailed']]);

  // No session means no target, and an empty handoff is not sent.
  resetHooks(); requests = []; notices.length = 0;
  tree = entry.Component({ ...props, sessionId: undefined });
  assert.equal(withProp(tree, 'data-dsh-widgets-handoff')[0].props.disabled, true);
  await withProp(tree, 'data-dsh-widgets-handoff')[0].props.onClick();
  assert.equal(requests.length, 0);
  assert.deepEqual(notices, [['warn', 'handoff.empty']]);
  answer = () => ({ ok: true, value: {} });
  notices.length = 0;
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
    ['planToggle', 'improvePrompt', 'handoff', 'projectBrief']);
  assert.ok(texts(tree).includes('项目基本信息'), 'the new widget is described in the UI language');

  // A switch writes exactly its own id.
  const store = makeStore(settingsOf());
  resetHooks();
  tree = entry.Component({ store, models: makeModels({ supported: false, efforts: [] }), locale: ctx.locale });
  // The marker is on the Switch element and on the button it draws; the element is the one with `onChange`.
  const switches = withProp(tree, 'data-dsh-widgets-switch').filter((node) => typeof node.props.onChange === 'function');
  assert.equal(switches.length, 4);
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
  withProp(tree, 'data-dsh-widgets-search')[0].props.onChange({ target: { value: 'improvePrompt' } });
  hookIndex = 0;
  tree = entry.Component({ store, models: makeModels(reasoning), locale: ctx.locale });
  assert.deepEqual(withProp(tree, 'data-dsh-widgets-row').map((node) => node.props['data-dsh-widgets-row']), ['improvePrompt']);

  // Empty search says so; a load error is visible; language resolves from the pinned value or the app.
  resetHooks();
  tree = entry.Component({ store: makeStore(settingsOf()), models: makeModels(reasoning), locale: ctx.locale });
  withProp(tree, 'data-dsh-widgets-search')[0].props.onChange({ target: { value: 'zzz-no-widget' } });
  hookIndex = 0;
  tree = entry.Component({ store: makeStore(settingsOf()), models: makeModels(reasoning), locale: ctx.locale });
  assert.ok(texts(tree).includes('没有匹配的小组件。'));

  resetHooks();
  tree = entry.Component({ store: makeStore(settingsOf({ error: 'boom' })), models: makeModels(reasoning), locale: ctx.locale });
  assert.ok(texts(tree).some((text) => text.includes('无法读取设置')), 'the load error is shown');
  assert.equal(withProp(tree, 'role').some((node) => node.props.role === 'alert'), true);

  resetHooks();
  tree = entry.Component({ store: makeStore(settingsOf({ language: 'en' })), models: makeModels(reasoning), locale: ctx.locale });
  assert.ok(texts(tree).includes('Project brief'));
  assert.equal(texts(tree).includes('项目基本信息'), false, 'the pinned language wins over the app');

  resetHooks();
  tree = entry.Component({ store: makeStore(settingsOf({ language: 'auto' })), models: makeModels(reasoning), locale: ctx.locale });
  assert.ok(texts(tree).includes('项目基本信息'), 'auto follows the app language');

  // Choosing an effort writes only that field; turning Improve off hides its shared model row.
  const edgeEffortStore = makeStore(settingsOf({ analysis: { model: { provider: 'p', model: 'm' }, effort: null } }));
  resetHooks();
  tree = entry.Component({ store: edgeEffortStore, models: makeModels(reasoning), locale: ctx.locale });
  await runEffects();
  hookIndex = 0;
  tree = entry.Component({ store: edgeEffortStore, models: makeModels(reasoning), locale: ctx.locale });
  withProp(tree, 'data-dsh-widgets-analysis-effort')[0].props.onChange({ target: { value: 'high' } });
  assert.deepEqual(edgeEffortStore.saved.at(-1), { analysis: { effort: 'high' } });

  resetHooks();
  tree = entry.Component({ store: makeStore(settingsOf({ on: { improvePrompt: false } })), models: makeModels(reasoning), locale: ctx.locale });
  assert.equal(withProp(tree, 'data-dsh-widgets-analysis-model').length, 0, 'the model row belongs to the Improve widget');
}

console.log('client widgets checks passed');