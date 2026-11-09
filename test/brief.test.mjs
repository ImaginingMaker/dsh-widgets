// Project brief: the prompt, the clipping, the fingerprint, the store, and the runner that keeps one read per project
// while never making a chat wait for it.
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRIEF_MAX, briefPrompt, briefSignature, briefStore, briefRunner, clipBrief, projectBrief, projectListing } from '../dist/index.js';
import { tempDir } from './helpers.mjs';

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

// ---- a project with no document of its own -----------------------------------------------------------------------------
{
  // A workspace of repositories has no README at its own root; its listing is still real material.
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const home2 = tempDir();
  try {
    const workspace = join(home2.dir, 'workspace');
    mkdirSync(join(workspace, 'repo-a'), { recursive: true });
    mkdirSync(join(workspace, 'repo-b'), { recursive: true });
    mkdirSync(join(workspace, 'node_modules'), { recursive: true });
    writeFileSync(join(workspace, '.hidden'), 'x');
    assert.deepEqual(projectListing(workspace), ['repo-a/', 'repo-b/'], 'hidden and node_modules are left out');
    assert.match(projectBrief(workspace), /<listing>\nrepo-a\/\nrepo-b\/\n<\/listing>/);

    // A folder with nothing in it is not material at all.
    mkdirSync(join(home2.dir, 'empty'), { recursive: true });
    assert.deepEqual(projectListing(join(home2.dir, 'empty')), []);
    assert.equal(projectBrief(join(home2.dir, 'empty')), '');
  } finally { home2.cleanup(); }
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
    material: () => 'README says hello',
    complete: async (material) => { calls += 1; return { text: `summary of ${material}`, model: 'p/m' }; },
    timeoutMs: 5000,
  });

  const first = await runner.ensure('/p');
  assert.equal(first.record.status, 'analyzing', 'the answer never waits for the model');
  assert.equal(first.started, true);
  const settled = await runner.settled('/p');
  assert.equal(settled.status, 'ready');
  assert.equal(settled.signature, 'sig-1');
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
    material: () => 'README says hello',
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
    material: () => 'material',
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
    material: () => '   ',
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
    material: () => 'material',
    complete: async () => ({ text: '   ', model: 'p/m' }),
  });
  await blank.ensure('/b');
  assert.equal((await blank.settled('/b')).status, 'failed');

  // One read per project at a time: a second open joins the first.
  let resolveSlow;
  const slow = briefRunner({
    store: briefStore(join(home.dir, 'b5.json')),
    signatureOf: async () => 'sig',
    material: () => 'material',
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