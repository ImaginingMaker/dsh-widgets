// The project's own promises: the manifest dsh reads, the bundle patch, the CI workflow, and that every widget is
// switchable, documented, and translated into both languages this plugin ships.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { WIDGETS } from '../index.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const manifest = JSON.parse(read('package.json'));

// ---- the manifest dsh reads -------------------------------------------------------------------------------------------
assert.equal(manifest.name, 'dsh-widgets');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.type, 'module');
assert.equal(manifest.license, 'MIT');
assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './client', './package.json']);
assert.equal(manifest.exports['.'], './index.js');
assert.equal(manifest.exports['./client'], './client.js');
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(manifest.dsh.client.platform, 'web');
assert.equal(manifest.dsh.client.immediately, true);
assert.ok(Array.isArray(manifest.dsh.client.inject) && manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'));
assert.match(manifest.engines.node, />=22/);
assert.match(manifest.engines.dsh, />=0\.2\.0/);
assert.equal(manifest.scripts.test, 'node --test test/*.test.mjs');
for (const file of ['index.js', 'client.js', 'README.md', 'LICENSE', 'cordis.patch.yml']) {
  assert.ok(manifest.files.includes(file), `${file} ships`);
}
assert.equal(manifest.dependencies, undefined, 'no runtime dependencies');

// ---- the bundle patch -------------------------------------------------------------------------------------------------
const patch = read('cordis.patch.yml');
assert.match(patch, /- insert:/);
assert.match(patch, /id: widgets/);
assert.match(patch, /name: dsh-widgets/);

// ---- CI ---------------------------------------------------------------------------------------------------------------
assert.equal(existsSync(new URL('.github/workflows/ci.yml', root)), true, 'the CI workflow ships');
const ci = read('.github/workflows/ci.yml');
assert.match(ci, /on:\s*\[?push/);
assert.match(ci, /pull_request/);
assert.match(ci, /npm test/);
assert.match(ci, /actions\/checkout@/);
assert.match(ci, /actions\/setup-node@/);

// ---- every widget is real, switchable, and translated in both languages ----------------------------------------------
const client = read('client.js');
const index = read('index.js');
assert.equal(WIDGETS.length, 6);
for (const id of WIDGETS) {
  for (const file of [client, index]) {
    assert.ok(file.includes(`'${id}'`), `${id} is named in both halves`);
  }
  // The English and Chinese text of each widget, at least once per language.
  const label = new RegExp(`'widget\\.${id}':`, 'g');
  assert.equal((client.match(label) ?? []).length, 2, `${id} has an English and a Chinese name`);
  const description = new RegExp(`'widget\\.${id}\\.desc':`, 'g');
  assert.equal((client.match(description) ?? []).length, 2, `${id} has an English and a Chinese description`);
}
assert.match(client, /'settings\.nav': 'Widgets'/);
assert.match(client, /'settings\.nav': '小组件'/);
// Only English and Chinese are shipped.
assert.equal((client.match(/^\s{6}(en|zh): \{/gm) ?? []).length, 2);

// ---- the parts that make the promises true ----------------------------------------------------------------------------
assert.match(client, /const PLAN_PREFIX = \/\^\\\/plan\(\?=\$\|\\s\)\[ \\t\]\?\//, 'the /plan format dsh recognises');
assert.match(client, /'\/plan off'/, 'leaving plan mode goes through dsh\'s own command');
assert.match(index, /storages', 'dsh-widgets', 'settings\.json'/, 'one settings file');
assert.match(index, /reasoningOptions/, 'the reasoning ladder is read, not invented');
assert.match(index, /resolveModelInfo/, 'from the local model configuration');
assert.match(index, /O_NOFOLLOW/, 'file reads cannot follow a swapped-in symlink');

// ---- the README documents each widget, in both languages --------------------------------------------------------------
const readme = read('README.md');
for (const id of WIDGETS) assert.ok(readme.includes(id), `README names ${id}`);
for (const phrase of ['Branch per chat', 'Branches in the workspace tree', 'Shift+Tab plan mode', 'Queue drag-and-drop', 'Edit queued message in place', 'Improve prompt']) {
  assert.ok(readme.includes(phrase), `README documents ${phrase}`);
}
assert.match(readme, /MIT/);
assert.match(readme, /中文|Chinese/);

// ---- a license and an icon ----------------------------------------------------------------------------------------------
assert.match(read('LICENSE'), /MIT License/);
assert.equal(existsSync(new URL('assets/icon.svg', root)), true);
assert.match(read('assets/icon.svg'), /<svg/);

console.log('meta checks passed');