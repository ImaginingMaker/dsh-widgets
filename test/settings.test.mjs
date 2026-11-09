// The settings file and its route: defaults, narrowing, atomic owner-only writes, serialized writes, and every accepted
// or refused patch shape.
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  LANGUAGES, MODES, OFF_BY_DEFAULT, SETTINGS_PATH, WIDGETS, defaultOn, defaultSettings, installSettings,
  isWidget, parseSettingsPatch, sanitizeSettings, settingsStore,
} from '../dist/index.js';
import { call, makeCtx, tempDir } from './helpers.mjs';

// The switch table: six widgets, one off by default, and the default follows that list.
assert.equal(WIDGETS.length, 7);
assert.deepEqual(OFF_BY_DEFAULT, ['branchTree', 'projectBrief']);
assert.equal(defaultOn('projectBrief'), false, 'Project brief waits for the user');
assert.equal(defaultOn('branchTree'), false);
for (const id of WIDGETS.filter((entry) => !OFF_BY_DEFAULT.includes(entry))) assert.equal(defaultOn(id), true, id);
assert.equal(isWidget('branchTree'), true);
assert.equal(isWidget('nope'), false);
assert.deepEqual(Object.keys(defaultSettings().on).sort(), [...WIDGETS].sort());
assert.equal(defaultSettings().branchTarget.mode, 'current');
assert.equal(defaultSettings().analysis.model, null);
assert.equal(defaultSettings().analysis.effort, null);
assert.equal(defaultSettings().language, 'auto');

// Narrowing: unknown keys go, wrong types fall back, and a good value survives.
const narrowed = sanitizeSettings({
  on: { branchTree: true, planToggle: 'yes', extra: true },
  branchTarget: { mode: 'worktree', junk: 1 },
  analysis: { model: { provider: 'p', model: 'm', extra: 1 }, effort: 'low' },
  language: 'zh',
  unknown: 1,
});
assert.equal(narrowed.on.branchTree, true);
assert.equal(narrowed.on.planToggle, true, 'a wrong type keeps the default');
assert.equal('extra' in narrowed.on, false, 'an unknown switch is dropped');
assert.equal(narrowed.branchTarget.mode, 'worktree');
assert.deepEqual(narrowed.branchTarget, { mode: 'worktree' });
assert.deepEqual(narrowed.analysis.model, { provider: 'p', model: 'm' });
assert.equal(narrowed.analysis.effort, 'low');
assert.equal(narrowed.language, 'zh');
assert.equal('unknown' in narrowed, false);
assert.equal(sanitizeSettings({ language: 'fr' }).language, 'auto', 'an unsupported language follows dsh');
for (const value of LANGUAGES) assert.equal(sanitizeSettings({ language: value }).language, value);
for (const bad of [null, 'text', 42, [], undefined]) assert.deepEqual(sanitizeSettings(bad), defaultSettings(), String(bad));
// The 0.2.x file kept the model under `improve`; an upgrade must not lose the user's choice.
assert.deepEqual(sanitizeSettings({ improve: { model: { provider: 'p', model: 'm' }, effort: 'high' } }).analysis,
  { model: { provider: 'p', model: 'm' }, effort: 'high' });
assert.equal(sanitizeSettings({ branchTarget: { mode: 'bogus' } }).branchTarget.mode, 'current');
for (const mode of MODES) assert.equal(sanitizeSettings({ branchTarget: { mode } }).branchTarget.mode, mode);

// The patch parser: what the panel sends, and everything it may not send.
assert.deepEqual(parseSettingsPatch({ id: 'planToggle', on: false }), { patch: { kind: 'switch', id: 'planToggle', on: false } });
assert.deepEqual(parseSettingsPatch({ analysis: { effort: 'high' } }), { patch: { kind: 'analysis', patch: { effort: 'high' } } });
assert.deepEqual(parseSettingsPatch({ analysis: { model: null } }), { patch: { kind: 'analysis', patch: { model: null } } });
assert.deepEqual(parseSettingsPatch({ language: 'zh' }), { patch: { kind: 'language', language: 'zh' } });
assert.deepEqual(parseSettingsPatch({ branchTarget: { mode: 'worktree' } }), { patch: { kind: 'mode', mode: 'worktree' } });
for (const bad of [
  null, 'x', {}, { id: 'nope', on: true }, { id: 'planToggle', on: 'yes' }, { id: 'planToggle' },
  { analysis: {} , extra: 1 }, { analysis: { nope: 1 } }, { analysis: { model: { provider: 'p' } } },
  { analysis: { effort: '' } }, { branchTarget: { mode: 'bogus' } }, { branchTarget: { mode: 'current', x: 1 } },
  { branchTarget: {} }, { language: 'fr' }, { language: 1 },
]) {
  assert.equal(parseSettingsPatch(bad).error, 'bad request', JSON.stringify(bad));
}

const { dir, cleanup } = tempDir();
const file = join(dir, 'nested', 'settings.json');

// A missing file, an unreadable file and a broken file all read as the defaults: one bad write cannot lock Settings.
const store = settingsStore(file);
assert.deepEqual(store.read(), defaultSettings(), 'missing file reads as defaults');
mkdirSync(join(dir, 'nested'), { recursive: true });
writeFileSync(file, '{not json');
assert.deepEqual(store.read(), defaultSettings(), 'broken file reads as defaults');

// A write creates the folder, keeps the file owner-only, and lands the narrowed shape.
const written = await store.write((current) => ({ ...current, on: { ...current.on, branchTree: true } }));
assert.equal(written.on.branchTree, true);
assert.equal(JSON.parse(readFileSync(file, 'utf8')).on.branchTree, true);
assert.equal(statSync(file).mode & 0o777, 0o600, 'owner-only');
assert.equal(store.read().on.branchTree, true);

// Two writes in flight are serialized rather than interleaved: both land, in order.
await Promise.all([
  store.write((current) => ({ ...current, analysis: { ...current.analysis, effort: 'low' } })),
  store.write((current) => ({ ...current, analysis: { ...current.analysis, model: { provider: 'p', model: 'm' } } })),
]);
assert.equal(store.read().analysis.effort, 'low');
assert.deepEqual(store.read().analysis.model, { provider: 'p', model: 'm' });

// The route: GET answers the saved shape, POST applies one patch at a time, and a bad patch is a 400 that changes nothing.
{
  const home = join(dir, 'home');
  const { ctx, routes } = makeCtx();
  const { store: installed } = installSettings(ctx, home);
  const before = await call(routes, SETTINGS_PATH);
  assert.equal(before.status, 200);
  assert.deepEqual(before.json.on, defaultSettings().on);

  const off = await call(routes, SETTINGS_PATH, { method: 'POST', body: { id: 'improvePrompt', on: false } });
  assert.equal(off.status, 200);
  assert.equal(off.json.on.improvePrompt, false);

  const mode = await call(routes, SETTINGS_PATH, { method: 'POST', body: { branchTarget: { mode: 'worktree' } } });
  assert.equal(mode.json.branchTarget.mode, 'worktree');

  const model = await call(routes, SETTINGS_PATH, { method: 'POST', body: { analysis: { model: { provider: 'aliyun-code-plan', model: 'deepseek-v4.1-flash-1017' } } } });
  assert.deepEqual(model.json.analysis.model, { provider: 'aliyun-code-plan', model: 'deepseek-v4.1-flash-1017' });
  const effort = await call(routes, SETTINGS_PATH, { method: 'POST', body: { analysis: { effort: 'high' } } });
  assert.equal(effort.json.analysis.effort, 'high');
  assert.deepEqual(effort.json.analysis.model, { provider: 'aliyun-code-plan', model: 'deepseek-v4.1-flash-1017' }, 'a patch keeps the rest');

  const cleared = await call(routes, SETTINGS_PATH, { method: 'POST', body: { analysis: { model: null } } });
  assert.equal(cleared.json.analysis.model, null);
  const clearedEffort = await call(routes, SETTINGS_PATH, { method: 'POST', body: { analysis: { effort: null } } });
  assert.equal(clearedEffort.json.analysis.effort, null);

  const language = await call(routes, SETTINGS_PATH, { method: 'POST', body: { language: 'zh' } });
  assert.equal(language.json.language, 'zh');

  const refused = await call(routes, SETTINGS_PATH, { method: 'POST', body: { id: 'nope', on: true } });
  assert.equal(refused.status, 400);
  const broken = await call(routes, SETTINGS_PATH, { method: 'POST', body: '{oops' });
  assert.equal(broken.status, 400);
  assert.equal(installed.read().on.improvePrompt, false, 'a refused patch changed nothing');

  // The file it wrote is the one the panel reads back, in the same place.
  assert.equal(JSON.parse(readFileSync(join(home, 'storages', 'dsh-widgets', 'settings.json'), 'utf8')).on.improvePrompt, false);
}

cleanup();
console.log('settings checks passed');