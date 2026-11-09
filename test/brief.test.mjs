// Project brief: the prompt, the clipping, the fingerprint, the store, and the runner that keeps one read per project
// while never making a chat wait for it.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRIEF_MAX, analysisRoute, briefNote, briefPrompt, briefSignature, briefStore, briefRunner, clipBrief, clipTree, projectBrief, projectTree, textHash } from '../dist/index.js';
import { makeCtx, tempDir } from './helpers.mjs';

// ---- the prompt --------------------------------------------------------------------------------------------------------
const prompt = briefPrompt('<README.md>\n# app\n</README.md>', 'en');
assert.match(prompt, new RegExp(String(BRIEF_MAX)));
assert.match(prompt, /<README\.md>\n# app\n<\/README\.md>/, 'the material travels verbatim');
assert.match(prompt, /how to run it and how to run its tests/);
assert.match(prompt, /no heading, no code fence, no preamble/, 'the answer is raw text');
assert.match(briefPrompt('x', 'zh'), /不超过 500 个汉字/);

// ---- clipping ----------------------------------------------------------------------------------------------------------
assert.equal(clipBrief('  plain text  '), 'plain text');
assert.equal(clipBrief('```markdown\n# Title\n\nBody here.\n```'), 'Body here.', 'fences and a leading title go');
assert.equal(clipBrief(''), '');
assert.equal(clipBrief('   \n\n  '), '', 'whitespace is not a summary');
assert.equal(clipBrief('a'.repeat(600)).length, BRIEF_MAX, 'the cap is applied');
assert.ok(clipBrief('a'.repeat(600)).endsWith('…'));
const astral = '😀'.repeat(900);
const clipped = clipBrief(astral);
assert.equal([...clipped].length, BRIEF_MAX, 'the cap counts characters, not UTF-16 units');
assert.equal(clipped.includes('\uFFFD'), false, 'a surrogate pair is never cut in half');

// ---- the fingerprint ---------------------------------------------------------------------------------------------------
const a = briefSignature({ head: 'abc', files: [{ name: 'README.md', size: 1, mtimeMs: 10 }, { name: 'AGENTS.md', size: 2, mtimeMs: 20 }] });
const b = briefSignature({ head: 'abc', files: [{ name: 'AGENTS.md', size: 2, mtimeMs: 20 }, { name: 'README.md', size: 1, mtimeMs: 10 }] });
assert.equal(a, b, 'the order of the files does not matter');
assert.notEqual(a, briefSignature({ head: 'def', files: [] }), 'a new commit changes it');
assert.notEqual(
  briefSignature({ head: 'abc', files: [{ name: 'README.md', size: 1, mtimeMs: 10 }] }),
  briefSignature({ head: 'abc', files: [{ name: 'README.md', size: 2, mtimeMs: 10 }] }),
  'a changed file changes it',
);

// ---- the file hierarchy, which is the material ----------------------------------------------------------------
{
  // A workspace of repositories has no README at its own root; its listing is still real material.
  const home2 = tempDir();
  try {
    const workspace = join(home2.dir, 'workspace');
    mkdirSync(join(workspace, 'repo-a'), { recursive: true });
    mkdirSync(join(workspace, 'repo-b'), { recursive: true });
    mkdirSync(join(workspace, 'node_modules'), { recursive: true });
    writeFileSync(join(workspace, '.hidden'), 'x');
    assert.deepEqual(projectTree(workspace), ['repo-a/', 'repo-b/', '.hidden'], 'directories first; node_modules is left out');
    assert.match(projectBrief(workspace), /<tree>\nrepo-a\/\nrepo-b\/\n\.hidden\n<\/tree>/);

    // A folder with nothing in it is not material at all.
    mkdirSync(join(home2.dir, 'empty'), { recursive: true });
    assert.deepEqual(projectTree(join(home2.dir, 'empty')), []);
    assert.equal(projectBrief(join(home2.dir, 'empty')), '');

    // Depth is honoured, and the cut is visible rather than silent.
    const deep = join(home2.dir, 'deep');
    mkdirSync(join(deep, 'a/b/c/d'), { recursive: true });
    writeFileSync(join(deep, 'a/b/c/d/leaf.ts'), '');
    assert.deepEqual(projectTree(deep), ['a/', '  b/', '    c/'], 'three levels, no deeper');
    assert.deepEqual(projectTree(deep, { depth: 4 }), ['a/', '  b/', '    c/', '      d/']);

    // A tree that stops early says so.
    const many = join(home2.dir, 'many');
    mkdirSync(many, { recursive: true });
    for (let index = 0; index < 30; index += 1) writeFileSync(join(many, `file-${index}.ts`), '');
    const capped = projectTree(many, { maxEntries: 10 });
    assert.equal(capped.length, 11, 'ten entries plus the marker');
    assert.match(capped.at(-1), /more entries omitted/);

    // node_modules and .git never appear, at any level.
    mkdirSync(join(workspace, 'repo-a/node_modules/pkg'), { recursive: true });
    mkdirSync(join(workspace, 'repo-a/.git'), { recursive: true });
    assert.equal(projectTree(workspace).some((line) => /node_modules|\.git/.test(line)), false);

    // A symbolic link is named but never followed, so it cannot loop or escape the project.
    symlinkSync(join(home2.dir, 'workspace'), join(workspace, 'loop'));
    assert.deepEqual(projectTree(join(workspace, 'repo-a')), [], 'node_modules and .git are skipped at any depth');
    assert.equal(projectTree(workspace).includes('loop'), true);

    // A name with a newline cannot forge a line of the tree.
    writeFileSync(join(many, 'evil\nname.ts'), '');
    assert.equal(projectTree(many).some((line) => /\n/.test(line)), false);
  } finally { home2.cleanup(); }
}

assert.equal(textHash('a/b'), textHash('a/b'), 'the hash is stable');
assert.notEqual(textHash('a/b'), textHash('a/c'), 'a moved file changes the hash');
assert.match(textHash(''), /^[a-z0-9]+$/);

// ---- which model a plugin call uses ------------------------------------------------------------------------------------
{
  const home = tempDir();
  const file = join(home.dir, 'storages/dsh-widgets/settings.json');
  const write = (value) => { mkdirSync(join(home.dir, 'storages/dsh-widgets'), { recursive: true }); writeFileSync(file, JSON.stringify(value)); };
  const { ctx } = makeCtx({ services: { agentDefaultModel: { currentSelection: () => ({ provider: 'default', model: 'd' }) } } });
  ctx.sessionController = { agents: { selectionFor: () => ({ current: { provider: 'chat', model: 'c' } }) } };
  const agent = { id: 'a' };

  // 1. A model pinned for this plugin wins.
  write({ analysis: { model: { provider: 'pinned', model: 'p' } } });
  assert.deepEqual(analysisRoute(ctx, home.dir, agent), { provider: 'pinned', model: 'p' });
  assert.deepEqual(analysisRoute(ctx, home.dir), { provider: 'pinned', model: 'p' }, 'it does not need a chat');

  // 2. "Same as the chat" means the chat: the session's own selection, read on the Host.
  write({ analysis: { model: null } });
  assert.deepEqual(analysisRoute(ctx, home.dir, agent), { provider: 'chat', model: 'c' });

  // 3. A chat that is not there yet leaves dsh's own default.
  assert.deepEqual(analysisRoute(ctx, home.dir), { provider: 'default', model: 'd' });
  assert.deepEqual(analysisRoute(ctx, home.dir, agent), { provider: 'chat', model: 'c' }, 'a session with a model still wins');

  // 4. Nothing at all is undefined, which the routes report as "no model is configured".
  const bare = makeCtx({ services: {} }).ctx;
  bare.sessionController = { agents: { selectionFor: () => ({}) } };
  assert.equal(analysisRoute(bare, home.dir, agent), undefined);
  home.cleanup();
}

// ---- the note carries the summary and the hierarchy ----------------------------------------------------------------------
{
  const note = briefNote('A small app.', 'src/\n  index.ts', 'en');
  assert.match(note, /Background on this project/);
  assert.match(note, /<summary>\nA small app\.\n<\/summary>/);
  assert.match(note, /<file hierarchy>\nsrc\/\n  index\.ts\n<\/file hierarchy>/);

  const zh = briefNote('一个小应用。', 'src/', 'zh');
  assert.match(zh, /本项目的背景/);
  assert.match(zh, /<结论>\n一个小应用。\n<\/结论>/);
  assert.match(zh, /<目录结构>\nsrc\/\n<\/目录结构>/);

  // A summary with no hierarchy still reads correctly, and a hierarchy is never the whole store.
  assert.match(briefNote('only text', undefined, 'en'), /<summary>\nonly text\n<\/summary>/);
  assert.equal(/file hierarchy/.test(briefNote('only text', undefined, 'en')), false);

  // A long tree is clipped, and says so.
  const long = Array.from({ length: 200 }, (_, index) => `  file-${index}.ts`).join('\n');
  const clipped = clipTree(long);
  assert.equal(clipped.split('\n').length <= 82, true);
  assert.match(clipped, /more entries omitted/);
  assert.equal(clipTree('src/\n  a.ts'), 'src/\n  a.ts', 'a short tree is passed through untouched');
}

// ---- the store ---------------------------------------------------------------------------------------------------------
const home = tempDir();
try {
  const file = join(home.dir, 'nested', 'briefs.json');
  const store = briefStore(file);
  assert.deepEqual(store.read().projects, {}, 'a missing file reads as empty');
  assert.equal(store.get('/p'), undefined);

  await store.set('/p', { status: 'ready', text: 'hi', signature: 's', at: 1 });
  assert.equal(store.get('/p').text, 'hi');
  assert.equal(statSync(file).mode & 0o777, 0o600, 'owner-only');

  writeFileSync(file, '{broken');
  assert.deepEqual(store.read().projects, {}, 'a broken file reads as empty');

  await store.set('/q', { status: 'failed', error: 'x', at: 2 });
  assert.equal(store.get('/q').status, 'failed');
} finally { home.cleanup(); }

// ---- the runner --------------------------------------------------------------------------------------------------------
{
  const home = tempDir();
  const store = briefStore(join(home.dir, 'briefs.json'));
  let calls = 0;
  const runner = briefRunner({
    store,
    signatureOf: async () => 'sig-1',
    material: () => ({ text: 'README says hello', tree: 'src/index.ts' }),
    complete: async (material) => { calls += 1; return { text: `summary of ${material}`, model: 'p/m' }; },
    timeoutMs: 5000,
  });

  const first = await runner.ensure('/p');
  assert.equal(first.record.status, 'analyzing', 'the answer never waits for the model');
  assert.equal(first.started, true);
  const settled = await runner.settled('/p');
  assert.equal(settled.status, 'ready');
  assert.equal(settled.signature, 'sig-1');
  assert.equal(settled.tree, 'src/index.ts', 'the hierarchy is kept beside the summary, for the note');
  assert.equal(calls, 1);

  // A second open of a fresh summary answers it straight away and calls no model.
  const again = await runner.ensure('/p');
  assert.equal(again.record.status, 'ready');
  assert.equal(again.started, false);
  assert.equal(calls, 1, 'a ready summary is reused');

  // A changed project is read again.
  const changed = briefRunner({
    store,
    signatureOf: async () => 'sig-2',
    material: () => ({ text: 'README says hello', tree: 'src/index.ts' }),
    complete: async () => { calls += 1; return { text: 'new', model: 'p/m' }; },
    timeoutMs: 5000,
  });
  await changed.ensure('/p');
  await changed.settled('/p');
  assert.equal(calls, 2, 'a changed fingerprint starts a new read');

  // A failed read of an unchanged project is not retried on every chat open.
  const failing = briefRunner({
    store: briefStore(join(home.dir, 'b2.json')),
    signatureOf: async () => 'sig-x',
    material: () => ({ text: 'material', tree: 'src/' }),
    complete: async () => { throw new Error('the model is down'); },
    timeoutMs: 5000,
  });
  await failing.ensure('/q');
  const failed = await failing.settled('/q');
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /model is down/);
  const retried = await failing.ensure('/q');
  assert.equal(retried.started, false, 'an explicit retry is the only way back');
  const forced = await failing.ensure('/q', true);
  assert.equal(forced.started, true);

  // A folder with nothing in it is idle, not a failure: there is nothing to summarise and nothing to show the user.
  let emptyCalls = 0;
  const empty = briefRunner({
    store: briefStore(join(home.dir, 'b3.json')),
    signatureOf: async () => 'sig',
    material: () => ({ text: '   ', tree: '' }),
    complete: async () => { emptyCalls += 1; return { text: 'x', model: 'p/m' }; },
  });
  const started = await empty.ensure('/e');
  assert.equal(started.record.status, 'analyzing');
  // Nothing is written at all: an empty folder leaves no record, which the route reports as `idle`.
  assert.equal(await empty.settled('/e'), undefined);
  assert.equal(emptyCalls, 0, 'nothing to read means no model call');

  // An empty answer is a failure, never a summary of nothing.
  const blank = briefRunner({
    store: briefStore(join(home.dir, 'b4.json')),
    signatureOf: async () => 'sig',
    material: () => ({ text: 'material', tree: 'src/' }),
    complete: async () => ({ text: '   ', model: 'p/m' }),
  });
  await blank.ensure('/b');
  assert.equal((await blank.settled('/b')).status, 'failed');

  // One read per project at a time: a second open joins the first.
  let resolveSlow;
  const slow = briefRunner({
    store: briefStore(join(home.dir, 'b5.json')),
    signatureOf: async () => 'sig',
    material: () => ({ text: 'material', tree: 'src/' }),
    complete: () => new Promise((resolve) => { resolveSlow = () => resolve({ text: 'slow', model: 'p/m' }); }),
  });
  await slow.ensure('/s');
  const joined = await slow.ensure('/s');
  assert.equal(joined.started, false, 'a read already running is not started twice');
  assert.equal(joined.record.status, 'analyzing');
  resolveSlow();
  assert.equal((await slow.settled('/s')).status, 'ready');
  home.cleanup();
}

void readFileSync;
console.log('brief checks passed');