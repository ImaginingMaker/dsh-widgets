// Branch and worktree targets: the name rules, the mutual exclusion of the five modes, the one remaining git effect
// (creating worktrees), and the routes the composer chip talks to.
import assert from 'node:assert/strict';
import { existsSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  BRANCH_TARGET_PATH, INTENT_TTL_MS, TARGET_INTENT_PATH, branchSlug, createWorktree, currentBranch, installBranchTarget,
  installTargetIntent, intents, isBranchName, isInsideProject, listTargets, localBranches, parseTarget, projectDirOf,
  pruneIntents, resolveTarget, runGit, worktreeFolder, worktreeList,
} from '../dist/index.js';
import { call, makeCtx, makePlainDir, makeRepo, realSubprocess } from './helpers.mjs';

const subprocess = realSubprocess();

// ---- names -----------------------------------------------------------------------------------------------------------
for (const good of ['main', 'feat/add-login', 'fix/a.b-c_d', 'a', `x/${'y'.repeat(60)}`.slice(0, 64)]) {
  assert.equal(isBranchName(good), true, good);
}
for (const bad of [
  '', '-x', 'a..b', 'a//b', '/a', 'a/', 'a.lock', 'a.', 'a b', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a@{1}',
  'x'.repeat(65), null, 42, undefined,
]) {
  assert.equal(isBranchName(bad), false, JSON.stringify(bad));
}

assert.equal(branchSlug('Add a login form'), 'feat/add-a-login-form');
assert.equal(branchSlug('Fix the crash on save'), 'fix/fix-the-crash-on-save');
assert.equal(branchSlug('修复登录页崩溃'), 'fix/change', 'a Chinese message still gets a valid name');
assert.equal(branchSlug('   '), 'feat/change');
assert.equal(branchSlug('Add a login form'), branchSlug('Add a login form'), 'deterministic');
assert.equal(branchSlug('Add a login form', ['feat/add-a-login-form']), 'feat/add-a-login-form-2');
assert.equal(worktreeFolder('feat/add-login'), 'feat-add-login');
assert.equal(worktreeFolder('!!!'), 'worktree');

// ---- the five modes are mutually exclusive ---------------------------------------------------------------------------
assert.deepEqual(parseTarget({ mode: 'current' }).target, { mode: 'current' });
assert.deepEqual(parseTarget({}).target, { mode: 'current' }, 'no mode is the default');
assert.deepEqual(parseTarget({ mode: 'branch', branchName: 'feat/x' }).target, { mode: 'branch', branchName: 'feat/x' });
assert.deepEqual(parseTarget({ mode: 'worktree' }).target, { mode: 'worktree' });
assert.deepEqual(parseTarget({ mode: 'existing-branch', existingBranch: 'main' }).target, { mode: 'existing-branch', existingBranch: 'main' });
assert.deepEqual(parseTarget({ mode: 'existing-worktree', worktreePath: '/tmp/w' }).target, { mode: 'existing-worktree', worktreePath: '/tmp/w' });

for (const [body, why] of [
  [{ mode: 'branch', branchName: 'feat/x', worktreePath: '/tmp/w' }, 'branch and worktree together'],
  [{ mode: 'worktree', branchName: 'feat/x', worktreePath: '/tmp/w' }, 'worktree with a checkout path'],
  [{ mode: 'worktree', existingBranch: 'main' }, 'new worktree on an existing branch'],
  [{ mode: 'branch', existingBranch: 'main' }, 'new branch on an existing branch'],
  [{ mode: 'current', branchName: 'feat/x' }, 'current with a branch'],
  [{ mode: 'current', worktreePath: '/tmp/w' }, 'current with a worktree'],
  [{ mode: 'existing-branch', existingBranch: 'main', branchName: 'feat/x' }, 'existing branch with a new name'],
  [{ mode: 'nope' }, 'unknown mode'],
  [{ mode: 'branch', branchName: 'a..b' }, 'bad name'],
  [{ mode: 'existing-branch' }, 'no branch named'],
  [{ mode: 'existing-worktree' }, 'no path named'],
  [null, 'not an object'],
]) {
  assert.equal(parseTarget(body).error !== undefined, true, why);
}

assert.equal(isInsideProject('/a/b', '/a/b'), true);
assert.equal(isInsideProject('/a/b', '/a/b/c'), true);
assert.equal(isInsideProject('/a/b', '/a/bc'), false, 'a prefix is not a child');

// ---- creating a worktree ----------------------------------------------------------------------------------------------
const repo = await makeRepo();
try {
  const real = realpathSync(repo.dir);
  const created = await createWorktree(subprocess, repo.dir, { text: 'Try the new parser' });
  assert.ok('ok' in created, JSON.stringify(created));
  assert.equal(created.ok.branch, 'feat/try-the-new-parser');
  assert.equal(created.base, 'main', 'the base is the branch the project folder is on');
  assert.equal(created.ok.path, join(real, '.worktrees', 'feat-try-the-new-parser'));
  assert.equal(existsSync(created.ok.path), true);
  assert.equal(await currentBranch(subprocess, created.ok.path), 'feat/try-the-new-parser');
  assert.equal(await currentBranch(subprocess, repo.dir), 'main', 'the project folder is left alone');

  // A name that is taken, and a folder that exists, are refused instead of overwritten.
  const taken = await createWorktree(subprocess, repo.dir, { branchName: 'feat/try-the-new-parser' });
  assert.match(taken.error, /already exists/);

  // An explicit name is honoured.
  const named = await createWorktree(subprocess, repo.dir, { branchName: 'feat/explicit' });
  assert.ok('ok' in named);
  assert.equal(named.ok.branch, 'feat/explicit');
} finally { repo.cleanup(); }

const plain = makePlainDir();
try {
  const refused = await createWorktree(subprocess, plain.dir, {});
  assert.match(refused.error, /not a git repository/);
} finally { plain.cleanup(); }

// ---- reading a target -------------------------------------------------------------------------------------------------
const repo2 = await makeRepo();
try {
  const info = await listTargets(subprocess, repo2.dir, 'current');
  assert.equal(info.repo, true);
  assert.equal(info.branch, 'main');
  assert.deepEqual(info.branches, ['main']);
  assert.deepEqual(info.worktrees, [], 'the project folder itself is not listed as a worktree');

  const resolved = await resolveTarget(subprocess, repo2.dir, { mode: 'current' });
  assert.equal(resolved.branch, 'main');
  const worktreeResolved = await resolveTarget(subprocess, repo2.dir, { mode: 'worktree', branchName: 'feat/x' });
  assert.equal(worktreeResolved.mode, 'worktree');
  assert.equal(worktreeResolved.cwd, repo2.dir, 'until the chat starts, the folder is still the project');

  await createWorktree(subprocess, repo2.dir, { branchName: 'feat/listed' });
  const withWorktree = await listTargets(subprocess, repo2.dir, 'current');
  assert.equal(withWorktree.worktrees.length, 1);
  assert.equal(withWorktree.worktrees[0].branch, 'feat/listed');
  assert.equal((await worktreeList(subprocess, repo2.dir)).length, 2);
  assert.deepEqual(await localBranches(subprocess, repo2.dir), ['feat/listed', 'main']);
} finally { repo2.cleanup(); }

// ---- the routes -------------------------------------------------------------------------------------------------------
{
  const { dir, cleanup } = { dir: (await makeRepo()).dir, cleanup: () => {} };
  const registry = { list: () => [{ id: 'w1', path: dir }] };
  const { ctx, routes } = makeCtx({ services: { workspaceRegistry: registry }, subprocess });
  installBranchTarget({ ...ctx, subprocess }, dir);
  installTargetIntent({ ...ctx, subprocess }, dir);

  const info = await call(routes, BRANCH_TARGET_PATH, { search: { cwd: dir } });
  assert.equal(info.status, 200);
  assert.equal(info.json.branch, 'main');
  assert.equal(info.json.locked, false, 'a chat that has not started can still choose');
  assert.equal(info.json.mode, 'current');

  // A path the workspace registry does not know is refused.
  assert.equal((await call(routes, BRANCH_TARGET_PATH, { search: { cwd: '/tmp' } })).status, 400);

  // Recording an intent creates nothing.
  const before = await runGit(subprocess, dir, ['worktree', 'list']);
  const stored = await call(routes, TARGET_INTENT_PATH, { method: 'POST', body: { cwd: dir, sessionId: 's1', mode: 'worktree', branchName: 'feat/later' } });
  assert.equal(stored.status, 200);
  assert.equal(stored.json.stored, true);
  assert.equal(intents.get('s1')?.target.mode, 'worktree');
  assert.equal((await runGit(subprocess, dir, ['worktree', 'list'])).stdout, before.stdout, 'no worktree is created by the route');
  assert.equal(existsSync(join(dir, '.worktrees')), false);

  // The default target records nothing at all.
  await call(routes, TARGET_INTENT_PATH, { method: 'POST', body: { cwd: dir, sessionId: 's1', mode: 'current' } });
  assert.equal(intents.has('s1'), false, 'current clears any intent');

  // Bad bodies are refused.
  // No mode at all means "current", which is a valid request that simply records nothing.
  assert.equal((await call(routes, TARGET_INTENT_PATH, { method: 'POST', body: { sessionId: 's' } })).json.stored, false);
  for (const body of [{}, { mode: 'nope' }, { sessionId: 's', mode: 'nope' }, { sessionId: 's', mode: 'branch', branchName: 'a..b' }]) {
    assert.equal((await call(routes, TARGET_INTENT_PATH, { method: 'POST', body })).status, 400, JSON.stringify(body));
  }

  cleanup();
}

// An intent that was never used expires, so an abandoned chat cannot surprise a later one.
{
  const { ctx } = makeCtx({ services: { workspaceRegistry: { list: () => [] } }, subprocess });
  installTargetIntent(ctx, '/tmp');
  intents.set('old', { target: { mode: 'branch', branchName: 'feat/x' }, at: Date.now() - INTENT_TTL_MS - 1000 });
  intents.set('fresh', { target: { mode: 'branch' }, at: Date.now() });
  assert.equal(pruneIntents(), 1);
  assert.equal(intents.has('old'), false);
  assert.equal(intents.has('fresh'), true);
  intents.delete('fresh');
}

// A symlinked project folder resolves to its real path, so containment checks compare real paths.
{
  const repo3 = await makeRepo();
  const link = join(repo3.dir, '..', `${Date.now()}-link`);
  symlinkSync(repo3.dir, link);
  const { ctx } = makeCtx({ services: { workspaceRegistry: { list: () => [{ id: 'w', path: link }] } } });
  assert.equal(await projectDirOf(ctx, { cwd: link }), realpathSync(repo3.dir));
  repo3.cleanup();
}

console.log('branch-target checks passed');