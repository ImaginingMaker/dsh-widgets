// Client kernels: the real settings/model stores and HTTP wrapper, booted through the plugin bundle with a fake fetch.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../dist/web/client.js', import.meta.url), 'utf8');
let module;
globalThis.window = { __ModuleLoader__: { load: (value) => { module = value; } } };
eval(source);

const React = {
  Fragment: 'Fragment',
  createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children: children.flat(Infinity) } }),
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
  useEffect: () => {},
  useSyncExternalStore: (subscribe, get) => { subscribe?.(() => {}); return get(); },
  useCallback: (fn) => fn,
};
const style = { setAttribute() {}, textContent: '' };
globalThis.document = {
  querySelector: () => null,
  createElement: () => style,
  head: { appendChild() {} },
};

let requests = [];
let handler = () => ({ ok: true, status: 200, json: async () => ({}) });
globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), method: init?.method ?? 'GET', headers: init?.headers, body: init?.body === undefined ? undefined : JSON.parse(init.body) });
  return handler(String(url), init);
};

const registrations = [];
let localeActive = 'zh';
const ctx = {
  slots: { inject: (_name, callback) => callback(), register: (options, Component) => { registrations.push({ options, Component }); return () => {}; } },
  locale: { getSnapshot: () => ({ active: localeActive }) },
  sessions: { list: { getSnapshot: () => ({ byId: {} }) }, scope: () => undefined },
  get: () => undefined,
  effect: (fn) => { fn(); },
};

const settingsValue = {
  on: { planToggle: true, queueReorder: true, queueEdit: true, improvePrompt: true, handoff: true, projectBrief: false },
  analysis: { model: null, effort: null },
  language: 'zh',
};
handler = (url) => (url.includes('/api/widgets.settings') ? { ok: true, status: 200, json: async () => settingsValue } : {
  ok: true, status: 200, json: async () => ({ providers: [{ id: 'p', name: 'P', models: [{ id: 'm', name: 'M' }] }] }),
});

module.factory((id) => (id === 'react' ? React : {})).apply(ctx);
await new Promise((resolve) => setTimeout(resolve, 0));
const settingsSection = registrations.find((entry) => entry.options.id === 'widgets');
assert.ok(settingsSection, 'the settings section is registered after its load');
const injected = settingsSection.options.inject();
const store = injected.store;
const models = injected.models;

// The real store adopts the Host's answer and notifies subscribers after a save.
{
  const seen = [];
  const off = store.subscribe(() => seen.push(store.getSnapshot()));
  assert.equal(store.getSnapshot().ready, true);
  assert.equal(store.getSnapshot().language, 'zh');
  assert.equal(store.getSnapshot().on.queueEdit, true);
  requests = [];
  handler = (url, init) => (init?.method === 'POST'
    ? { ok: true, status: 200, json: async () => ({ ...settingsValue, on: { ...settingsValue.on, queueEdit: false } }) }
    : { ok: true, status: 200, json: async () => settingsValue });
  await store.save({ id: 'queueEdit', on: false });
  assert.equal(store.getSnapshot().on.queueEdit, false);
  assert.equal(seen.length, 1, 'subscribers see the saved state');
  assert.deepEqual(requests.at(-1).body, { id: 'queueEdit', on: false });
  assert.equal(requests.at(-1).headers['content-type'], 'application/json');
  off();
}

// A failed load and a failed save are both visible as the store's error, and the store remains usable.
{
  handler = () => ({ ok: false, status: 500, json: async () => ({ error: 'settings down' }) });
  await store.load();
  assert.equal(store.getSnapshot().error, 'settings down');
  handler = () => ({ ok: false, status: 500, json: async () => { throw new Error('not json'); } });
  await store.save({ id: 'queueEdit', on: true });
  assert.equal(store.getSnapshot().error, 'HTTP 500');
}

// The model store loads the catalogue and caches each reasoning query.
{
  handler = (url) => (url.includes('/api/widgets.models')
    ? { ok: true, status: 200, json: async () => ({ providers: [{ id: 'p', name: 'P', models: [{ id: 'm', name: 'M' }] }] }) }
    : { ok: true, status: 200, json: async () => ({}) });
  await models.load();
  assert.equal(models.getSnapshot().providers[0].models[0].id, 'm');
  assert.equal(models.getSnapshot().error, undefined);

  handler = (url) => {
    if (url.includes('provider=p')) return { ok: true, status: 200, json: async () => ({ reasoning: { supported: true, efforts: [{ id: 'off' }] } }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  requests = [];
  const first = await models.reasoningOf('p', 'm');
  assert.equal(first.supported, true);
  assert.equal(requests.length, 1);
  await models.reasoningOf('p', 'm');
  assert.equal(requests.length, 1, 'the reasoning answer is cached');

  handler = () => ({ ok: false, status: 500, json: async () => ({ error: 'no' }) });
  const missing = await models.reasoningOf('p', 'other');
  assert.deepEqual(missing, { supported: false, efforts: [] }, 'an unreadable reasoning answer reads as no efforts');

  handler = () => ({ ok: false, status: 500, json: async () => ({}) });
  await models.load();
  assert.equal(models.getSnapshot().error, 'HTTP 500');
}

// Labels follow the pinned language, then the app's language for `auto`.
{
  handler = (url) => (url.includes('/api/widgets.settings')
    ? { ok: true, status: 200, json: async () => ({ ...settingsValue, language: 'en' }) }
    : { ok: true, status: 200, json: async () => ({ providers: [] }) });
  await store.load();
  assert.equal(settingsSection.options.label(), 'Widgets');
  localeActive = 'zh';
  handler = (url) => (url.includes('/api/widgets.settings')
    ? { ok: true, status: 200, json: async () => ({ ...settingsValue, language: 'auto' }) }
    : { ok: true, status: 200, json: async () => ({ providers: [] }) });
  await store.load();
  assert.equal(settingsSection.options.label(), '小组件');
  localeActive = 'en';
  handler = (url) => (url.includes('/api/widgets.settings')
    ? { ok: true, status: 200, json: async () => ({ ...settingsValue, language: 'auto' }) }
    : { ok: true, status: 200, json: async () => ({ providers: [] }) });
  await store.load();
  assert.equal(settingsSection.options.label(), 'Widgets');
}

// A host route with a non-JSON error still reports its status.
{
  handler = () => ({ ok: false, status: 503, json: async () => { throw new Error('broken'); } });
  await store.load();
  assert.equal(store.getSnapshot().error, 'HTTP 503');
}

console.log('client kernel checks passed');