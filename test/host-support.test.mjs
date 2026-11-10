// Host support: project resolution, git invocation, note shape, path boundaries, and the durable brief store.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BRIEF_PROJECTS_MAX, BRIEF_PATH, HANDOFF_PATH, IMPROVE_PATH, MODELS_PATH, PLAN_PATH, QUEUE_EDIT_PATH, QUEUE_MOVE_PATH,
  SETTINGS_PATH, apply, briefMaterial, briefNote, briefRunner, briefStore, clipTree, hasNote, improvePromptText,
  isInsideProject, json, noteMessage, projectDirOf, projectDocuments, projectTree, runGit, service, signatureOf,
} from '../dist/index.js';
import { makeCtx, realSubprocess, tempDir } from './helpers.mjs';

// ---- projectDirOf ------------------------------------------------------------------------------------------------------
{
  const home = tempDir();
  const good = join(home.dir, 'good');
  const other = join(home.dir, 'other');
  mkdirSync(good);
  mkdirSync(other);
  const sessions = { list: { getSnapshot: () => ({ byId: { s1: { cwd: other } } }) } };
  const base = { get: () => undefined, sessions };

  const working = { get: () => good };
  const withWorking = { ...base, get: (name) => (name === 'workingDirectory' ? working : undefined), sessionController: { resolveAgent: async () => ({ agent: { session: {} } }) } };
  assert.equal(await projectDirOf(withWorking, { sessionId: 's1' }), realpathSync(good), 'the working directory wins');

  const stale = { ...base, get: (name) => (name === 'workingDirectory' ? { get: () => join(home.dir, 'gone') } : undefined), sessionController: { resolveAgent: async () => ({ agent: { session: {} } }) } };
  assert.equal(await projectDirOf(stale, { sessionId: 's1' }), realpathSync(other), 'a stale working directory falls back to the chat list');

  const throwing = { ...base, get: (name) => (name === 'workingDirectory' ? { get: () => { throw new Error('gone'); } } : undefined), sessionController: { resolveAgent: async () => ({ agent: { session: {} } }) } };
  assert.equal(await projectDirOf(throwing, { sessionId: 's1' }), realpathSync(other), 'a failing working directory falls back');

  const agentError = { ...base, sessionController: { resolveAgent: async () => ({ error: { code: 'session/not-found' } }) } };
  assert.equal(await projectDirOf(agentError, { sessionId: 's1' }), realpathSync(other));
  assert.equal(await projectDirOf(base, { sessionId: '' }), undefined);
  assert.equal(await projectDirOf(base, { sessionId: 'x'.repeat(201) }), undefined);
  assert.equal(await projectDirOf(base, { sessionId: 'unknown' }), undefined);
  home.cleanup();
}

// ---- runGit ------------------------------------------------------------------------------------------------------------
{
  const captured = [];
  const subprocess = {
    resolveExecutable: async (command) => `/bin/${command}`,
    spawn(spec) {
      captured.push(spec);
      return {
        done: Promise.resolve({ exitCode: 3 }),
        collected: {
          stdout: { readFrom: () => ({ text: 'out text' }) },
          stderr: { readFrom: () => ({ text: 'err text' }) },
        },
      };
    },
  };
  const result = await runGit(subprocess, '/repo', ['status', '--short'], undefined, 1234);
  assert.deepEqual(result, { code: 3, stdout: 'out text', stderr: 'err text' });
  assert.deepEqual(captured[0].argv, ['/bin/git', 'status', '--short']);
  assert.equal(captured[0].cwd, '/repo');
  assert.equal(captured[0].graceMs, 1000);
  assert.equal(captured[0].env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(captured[0].env.LC_ALL, 'C');
  assert.ok(captured[0].signal instanceof AbortSignal);

  const sparse = {
    resolveExecutable: async () => 'git',
    spawn: () => ({ done: Promise.resolve({ exitCode: 0 }), collected: {} }),
  };
  assert.deepEqual(await runGit(sparse, '/repo', []), { code: 0, stdout: '', stderr: '' });

  const fails = { resolveExecutable: async () => { throw new Error('no git'); }, spawn: () => { throw new Error('unreachable'); } };
  await assert.rejects(() => runGit(fails, '/repo', []), /no git/);

}

// ---- notes -------------------------------------------------------------------------------------------------------------
{
  const message = noteMessage('hello');
  assert.equal(message.role, 'user');
  assert.equal(message.content[0].text, 'hello');
  assert.equal(message.source.kind, 'dsh-widgets-note');
  assert.equal(message.source.form, 'snapshot');
  assert.equal(Object.isFrozen(message), true);
  assert.notEqual(noteMessage('hello').id, message.id);

  assert.equal(hasNote([{ type: 'user/message', data: { source: { kind: 'dsh-widgets-note' } } }]), true);
  assert.equal(hasNote([{ type: 'assistant/message', data: { source: { kind: 'dsh-widgets-note' } } }]), false);
  assert.equal(hasNote([{ type: 'user/message', data: { source: { kind: 'user' } } }]), false);
  assert.equal(hasNote([null]), false);

  assert.equal(clipTree('a\n\nb\nc'), 'a\nb\nc', 'empty lines go');
  assert.match(clipTree('a\nb\nc', 2), /more entries omitted/);
  assert.match(clipTree('abcdefghij', 10, 5), /more entries omitted/);
  assert.equal(clipTree('short'), 'short');

  assert.match(briefNote('text', undefined, 'auto'), /Background on this project/);
}

// ---- files -------------------------------------------------------------------------------------------------------------
{
  assert.equal(isInsideProject('/a/b', '/a/b'), true);
  assert.equal(isInsideProject('/a/b', '/a/b/c'), true);
  assert.equal(isInsideProject('/a/b', '/a/bc'), false, 'a prefix is not a descendant');
  assert.equal(isInsideProject('/a/b/', '/a/b/c'), true);

  const home = tempDir();
  const dir = join(home.dir, 'p');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'index.ts'), 'x');
  assert.deepEqual(projectTree(dir, { depth: 0, maxEntries: 0 }), ['src/'], 'depth/entry bounds are clamped to one');
  assert.equal(projectDocuments(dir), '', 'no usual documents is no material');
  assert.match(improvePromptText('draft', '', 0), /<draft>\ndraft\n<\/draft>/);
  assert.equal(improvePromptText('draft', '', 0).includes(' carries '), false);
  assert.match(improvePromptText('draft', '', 1), /1 image/);
  assert.match(improvePromptText('draft', '', 2), /2 images/);
  home.cleanup();
}

// ---- context helpers ---------------------------------------------------------------------------------------------------
{
  const thrown = { get: () => { throw new Error('no service'); } };
  assert.equal(service(thrown, 'anything'), undefined);
  const response = json({ ok: true }, 201);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: true });
}

// ---- the brief store, material, and signature --------------------------------------------------------------------------
{
  const home = tempDir();
  const rawDir = join(home.dir, 'project');
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(join(rawDir, 'README.md'), '# app\n');
  writeFileSync(join(rawDir, 'AGENTS.md'), 'rules\n');
  const dir = realpathSync(rawDir);

  const material = briefMaterial(dir);
  assert.match(material.text, /<README\.md>/);
  assert.match(material.text, /AGENTS\.md/);
  assert.match(material.tree, /README\.md/);

  const first = await signatureOf(realSubprocess(), dir);
  const again = await signatureOf(realSubprocess(), dir);
  assert.equal(first, again, 'an unchanged project has a stable fingerprint');
  writeFileSync(join(dir, 'README.md'), '# app\nmore\n');
  assert.notEqual(await signatureOf(realSubprocess(), dir), first, 'a changed document changes the fingerprint');

  const file = join(home.dir, 'briefs.json');
  const store = briefStore(file);
  await Promise.all(Array.from({ length: 12 }, (_, index) => store.set(`/p${index}`, {
    status: 'ready', text: `t${index}`, at: index,
  })));
  assert.equal(Object.keys(JSON.parse(readFileSync(file, 'utf8')).projects).length, 12, 'concurrent writes all land');

  for (let index = 0; index < BRIEF_PROJECTS_MAX + 5; index += 1) {
    await store.set(`/many/${index}`, { status: 'ready', text: 'x', at: index });
  }
  const kept = Object.keys(JSON.parse(readFileSync(file, 'utf8')).projects);
  assert.equal(kept.length, BRIEF_PROJECTS_MAX, 'the store keeps a bounded number of projects');
  assert.ok(kept.includes(`/many/${BRIEF_PROJECTS_MAX + 4}`), 'the newest record survives');

  writeFileSync(file, JSON.stringify({ projects: { bad: null, arr: [], good: { status: 'ready', text: 'ok' } } }));
  assert.deepEqual(Object.keys(store.read().projects), ['arr', 'good'], 'non-object records are dropped');
  rmSync(file);
}

// ---- the runner: timeout and isRunning --------------------------------------------------------------------------------
{
  const home = tempDir();
  const store = briefStore(join(home.dir, 'briefs.json'));
  let runningSeen = false;
  const runner = briefRunner({
    store,
    signatureOf: async () => 'sig',
    material: () => ({ text: 'material', tree: '' }),
    complete: async (_prompt, signal) => {
      runningSeen = runner.isRunning('/timeout');
      await new Promise((_, reject) => {
        if (signal.aborted) reject(new Error('aborted'));
        else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      return { text: 'never', model: 'p/m' };
    },
    timeoutMs: 5,
  });
  await runner.ensure('/timeout');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const settled = await runner.settled('/timeout');
  assert.equal(runningSeen, true);
  assert.equal(settled.status, 'failed');
  assert.match(settled.error, /timed out/);
  assert.equal(runner.isRunning('/timeout'), false);
  home.cleanup();
}

// ---- the plugin entry registers every route and the pre-step hook ------------------------------------------------
{
  const home = tempDir();
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home.dir;
  try {
    const hooks = [];
    const { ctx, routes } = makeCtx({
      ctx: {
        on: (event, listener) => hooks.push([event, listener]),
        subprocess: realSubprocess(),
        sessionController: { resolveAgent: async () => ({ error: { code: 'session/not-found' } }) },
      },
    });
    const handle = apply(ctx);
    assert.equal(typeof handle.store.read, 'function');
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0][0], 'agent/pre-step');
    for (const path of [SETTINGS_PATH, MODELS_PATH, IMPROVE_PATH, HANDOFF_PATH, PLAN_PATH, BRIEF_PATH, QUEUE_MOVE_PATH, QUEUE_EDIT_PATH]) {
      assert.ok(routes.has(path), `${path} is registered`);
    }
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    home.cleanup();
  }
}

console.log('host support checks passed');