// The project's own promises: the manifest dsh reads, the bundle patch, the CI workflow, and that every widget is
// switchable, documented, and translated into both languages this plugin ships.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { WIDGETS } from '../dist/index.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const manifest = JSON.parse(read('package.json'));

// ---- the manifest dsh reads -------------------------------------------------------------------------------------------
assert.equal(manifest.name, 'dsh-widgets');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.type, 'module');
assert.equal(manifest.license, 'MIT');
assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './client', './package.json']);
assert.equal(manifest.exports['.'], './dist/index.js');
assert.equal(manifest.exports['./client'], './dist/web/client.js');
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(manifest.dsh.client.platform, 'web');
assert.equal(manifest.dsh.client.immediately, true);
assert.ok(Array.isArray(manifest.dsh.client.inject) && manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'));
assert.match(manifest.engines.node, />=22/);
assert.match(manifest.engines.dsh, />=0\.2\.2/);
assert.match(manifest.scripts.test, /build/);
assert.match(manifest.scripts.test, /node --test/);
for (const file of ['dist', 'README.md', 'LICENSE', 'cordis.patch.yml']) {
  assert.ok(manifest.files.includes(file), `${file} ships`);
}
assert.equal(manifest.dependencies, undefined, 'no runtime dependencies');
assert.equal(manifest.main, 'dist/index.js');
assert.equal(manifest.types, 'dist/index.d.ts');

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
// The sources are what a reader reviews; the bundle is what dsh loads.
const client = ['src/web/index.ts', 'src/web/kernel/i18n.ts', 'src/web/kernel/plan.ts', 'src/web/widgets/planToggle.ts'].map(read).join('\n');
const index = ['src/host/index.ts', 'src/host/store.ts', 'src/host/files.ts', 'src/host/routes/improve.ts', 'src/host/routes/models.ts'].map(read).join('\n');
const bundle = read('dist/web/client.js');
assert.equal(WIDGETS.length, 6);
for (const id of WIDGETS) {
  // The client half names every widget (the label, the panel or the settings row); the Host half only owns the ones whose
  // work runs outside the browser, which the checks below pin down.
  assert.ok(client.includes(id), `${id} is handled by the client half`);
  // The English and Chinese text of each widget, at least once per language.
  const label = new RegExp(`'widget\\.${id}':`, 'g');
  assert.equal((client.match(label) ?? []).length, 2, `${id} has an English and a Chinese name`);
  const description = new RegExp(`'widget\\.${id}\\.desc':`, 'g');
  assert.equal((client.match(description) ?? []).length, 2, `${id} has an English and a Chinese description`);
}
assert.match(client, /'settings\.nav': 'Widgets'/);
assert.match(client, /'settings\.nav': '小组件'/);
// Only English and Chinese are shipped.
assert.equal((client.match(/^\s+(en|zh): \{/gm) ?? []).length, 2);

// ---- the parts that make the promises true ----------------------------------------------------------------------------
assert.match(client, /PLAN_PREFIX = \/\^\\\/plan/, 'the /plan format dsh recognises');
assert.match(client, /'\/plan off'/, 'leaving plan mode goes through dsh\'s own command');
assert.match(index, /storages\/dsh-widgets\/settings\.json/, 'one settings file');
assert.match(index, /reasoningOptions/, 'the reasoning ladder is read, not invented');
assert.match(index, /improve/, 'the Host half owns the Improve prompt call');
assert.match(index, /resolveModelInfo/, 'from the local model configuration');
assert.match(index, /O_NOFOLLOW/, 'file reads cannot follow a swapped-in symlink');

// ---- the README documents each widget, in both languages --------------------------------------------------------------
const readme = read('README.md');
for (const id of WIDGETS) assert.ok(readme.includes(id), `README names ${id}`);
for (const gone of ['branchTarget', 'branchTree', 'Branch per chat', 'Branches in the workspace tree']) {
  assert.equal(readme.includes(gone), false, `README no longer mentions ${gone}`);
}
for (const phrase of ['Shift+Tab plan mode', 'Queue drag-and-drop', 'Edit queued message in place', 'Improve prompt', 'Project brief']) {
  assert.ok(readme.includes(phrase), `README documents ${phrase}`);
}
assert.match(readme, /MIT/);
assert.match(readme, /中文|Chinese/);

// ---- the build pipeline ------------------------------------------------------------------------------------------------
assert.equal(existsSync(new URL('build.web.mjs', root)), true, 'the web bundle script ships');
for (const config of ['tsconfig.json', 'tsconfig.build.json', 'tsconfig.web.json']) {
  assert.equal(existsSync(new URL(config, root)), true, `${config} ships`);
}
assert.match(read('tsconfig.web.json'), /"lib": \[[^\]]*"DOM"/, 'the web half is type-checked against the DOM');
assert.equal(/"node:"\s*:/.test(read('tsconfig.web.json')), false);
assert.match(manifest.scripts.build, /build:host/);
assert.match(manifest.scripts.build, /build:web/);
// The bundle dsh loads is generated, wrapped in the loader call, and free of node built-ins.
assert.match(bundle, /window\.__ModuleLoader__\.load\(/);
assert.match(bundle, /factory\(require\)/);
assert.equal(bundle.includes('node:'), false, 'the browser bundle has no node: module');

// ---- a license and an icon ----------------------------------------------------------------------------------------------
assert.match(read('LICENSE'), /MIT License/);
assert.equal(existsSync(new URL('assets/icon.svg', root)), true);
assert.match(read('assets/icon.svg'), /<svg/);

console.log('meta checks passed');