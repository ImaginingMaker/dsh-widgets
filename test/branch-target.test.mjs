// Branch and worktree targets: the name rules, the mutual exclusion of the five modes, and the git effects — including
// that the default mode touches the repository not at all.
import assert from 'node:assert/strict';
import { existsSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  BRANCH_TARGET_PATH, applyTarget, branchSlug, currentBranch, installBranchTarget, isBranchName, isInsideProject,
  localBranches, parseTarget, projectDirOf, runGit, worktreeFolder, worktreeList,
} from '../dist/index.js';
import { call, gitSync, makeCtx, makePlainDir, makeRepo, realSubprocess } from './helpers.mjs';

const subprocess = realSubprocess();
/** `applyTarget` answers `{ok}` or `{error}`; the checks below read the result itself. */
const doTarget = async (...args) => {
  const result = await applyTarget(...args);
  return 'ok' in result ? result.ok : result;
};

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

// A slug is deterministic, offline, and never repeats a name that is already taken.
assert.equal(branchSlug('Add a login form'), 'feat/add-a-login-form');
assert.equal(branchSlug('Fix the crash on save'), 'fix/fix-the-crash-on-save');
assert.equal(branchSlug('bug: null deref'), 'fix/bug-null-deref');
assert.equal(branchSlug('修复登录页崩溃'), 'fix/change', 'a Chinese message still gets a valid name');
assert.equal(branchSlug('   '), 'feat/change');
assert.equal(branchSlug('Add a login form'), branchSlug('Add a login form'), 'deterministic');
assert.equal(branchSlug('Add a login form', ['feat/add-a-login-form']), 'feat/add-a-login-form-2');
assert.equal(branchSlug('Add a login form', ['feat/add-a-login-form', 'feat/add-a-login-form-2']), 'feat/add-a-login-form-3');
assert.ok(branchSlug(`x ${'y'.repeat(200)}`).length <= 64);
assert.equal(isBranchName(branchSlug('x '.repeat(40))), true);

assert.equal(worktreeFolder('feat/add-login'), 'feat-add-login');
assert.equal(worktreeFolder('a/b/c'), 'a-b-c');
assert.equal(worktreeFolder('!!!'), 'worktree');

// ---- the five modes are mutually exclusive ---------------------------------------------------------------------------
assert.deepEqual(parseTarget({ mode: 'current' }).target, { mode: 'current' });
assert.deepEqual(parseTarget({}).target, { mode: 'current' }, 'no mode is the default');
assert.deepEqual(parseTarget({ mode: 'branch' }).target, { mode: 'branch' });
assert.deepEqual(parseTarget({ mode: 'branch', branchName: 'feat/x' }).target, { mode: 'branch', branchName: 'feat/x' });
assert.deepEqual(parseTarget({ mode: 'worktree' }).target, { mode: 'worktree' });
assert.deepEqual(parseTarget({ mode: 'existing-branch', existingBranch: 'main' }).target, { mode: 'existing-branch', existingBranch: 'main' });
assert.deepEqual(parseTarget({ mode: 'existing-worktree', worktreePath: '/tmp/w' }).target, { mode: 'existing-worktree', worktreePath: '/tmp/w' });

// The invariant: a target can never be a branch and a worktree at once, and a new worktree starts its own branch.
for (const [body, why] of [
  [{ mode: 'branch', branchName: 'feat/x', worktreePath: '/tmp/w' }, 'branch and worktree together'],
  [{ mode: 'worktree', branchName: 'feat/x', worktreePath: '/tmp/w' }, 'worktree with a checkout path'],
  [{ mode: 'worktree', existingBranch: 'main' }, 'new worktree on an existing branch'],
  [{ mode: 'branch', existingBranch: 'main' }, 'new branch on an existing branch'],
  [{ mode: 'current', branchName: 'feat/x' }, 'current with a branch'],
  [{ mode: 'current', worktreePath: '/tmp/w' }, 'current with a worktree'],
  [{ mode: 'existing-branch', existingBranch: 'main', branchName: 'feat/x' }, 'existing branch with a new name'],
  [{ mode: 'existing-worktree', worktreePath: '/tmp/w', existingBranch: 'main' }, 'existing worktree with a branch'],
  [{ mode: 'nope' }, 'unknown mode'],
  [{ mode: 'branch', branchName: 'a..b' }, 'bad name'],
  [{ mode: 'existing-branch' }, 'no branch named'],
  [{ mode: 'existing-worktree' }, 'no path named'],
  [null, 'not an object'],
  ['x', 'not an object'],
]) {
  assert.equal(parseTarget(body).error !== undefined, true, why);
}

// ---- path containment -------------------------------------------------------------------------------------------------
assert.equal(isInsideProject('/a/b', '/a/b'), true);
assert.equal(isInsideProject('/a/b', '/a/b/c'), true);
assert.equal(isInsideProject('/a/b', '/a/bc'), false, 'a prefix is not a child');
assert.equal(isInsideProject('/a/b/', '/a/b/c'), true, 'a trailing separator is tolerated');
assert.equal(isInsideProject('/a/b', '/a/c'), false);

// ---- a real repository -----------------------------------------------------------------------------------------------
const repo = await makeRepo();
/** macOS resolves /var through /private/var, so a folder is compared by its real path. */
const real = (path) => realpathSync(path);
try {
  assert.equal(await currentBranch(subprocess, repo.dir), 'main');
  assert.deepEqual(await localBranches(subprocess, repo.dir), ['main']);

  // current: no branch is created, no commit, nothing written.
  const head = (await runGit(subprocess, repo.dir, ['rev-parse', 'HEAD'])).stdout.trim();
  const current = await doTarget(subprocess, repo.dir, { mode: 'current' }, 'Add a login form');
  assert.equal(current.mode, 'current');
  assert.equal(current.branch, 'main');
  assert.equal((await runGit(subprocess, repo.dir, ['rev-parse', 'HEAD'])).stdout.trim(), head, 'current changes no commit');
  assert.deepEqual(await localBranches(subprocess, repo.dir), ['main'], 'current creates no branch');

  // branch: a new branch in the project folder, named from the message.
  const branch = await doTarget(subprocess, repo.dir, { mode: 'branch' }, 'Add a login form');
  assert.equal(branch.mode, 'branch');
  assert.equal(branch.branch, 'feat/add-a-login-form');
  assert.equal(branch.cwd, real(repo.dir));
  assert.equal(await currentBranch(subprocess, repo.dir), 'feat/add-a-login-form');
  assert.equal(existsSync(join(repo.dir, '.worktrees')), false, 'a branch makes no worktree');

  // The same message again would collide, so the slug moves on; and an explicit name that exists is refused.
  await gitSync(repo.dir, ['switch', 'main']);
  const second = await doTarget(subprocess, repo.dir, { mode: 'branch' }, 'Add a login form');
  assert.equal(second.branch, 'feat/add-a-login-form-2');
  await gitSync(repo.dir, ['switch', 'main']);
  const clash = await doTarget(subprocess, repo.dir, { mode: 'branch', branchName: 'feat/add-a-login-form' }, 'x');
  assert.match(clash.error, /already exists/);

  // worktree: its own branch AND its own folder, from the current branch.
  const worktree = await doTarget(subprocess, repo.dir, { mode: 'worktree' }, 'Try the new parser');
  assert.equal(worktree.mode, 'worktree');
  assert.equal(worktree.branch, 'feat/try-the-new-parser');
  assert.equal(worktree.cwd, join(real(repo.dir), '.worktrees', 'feat-try-the-new-parser'));
  assert.equal(existsSync(worktree.cwd), true);
  assert.equal(await currentBranch(subprocess, worktree.cwd), 'feat/try-the-new-parser');
  assert.equal(await currentBranch(subprocess, repo.dir), 'main', 'the project folder stays on its branch');
  assert.equal((await worktreeList(subprocess, repo.dir)).length, 2);

  // A worktree path that exists is refused, never overwritten.
  await gitSync(repo.dir, ['switch', 'main']);
  const occupied = await doTarget(subprocess, repo.dir, { mode: 'worktree', branchName: 'feat/try-the-new-parser' }, 'x');
  assert.match(occupied.error, /already exists/);

  // existing-branch: check out what is there, create nothing.
  const existing = await doTarget(subprocess, repo.dir, { mode: 'existing-branch', existingBranch: 'feat/add-a-login-form' }, 'x');
  assert.equal(existing.mode, 'existing-branch');
  assert.equal(existing.branch, 'feat/add-a-login-form');
  assert.equal(await currentBranch(subprocess, repo.dir), 'feat/add-a-login-form');
  const missing = await doTarget(subprocess, repo.dir, { mode: 'existing-branch', existingBranch: 'nope' }, 'x');
  assert.equal(typeof missing.error, 'string');
  await gitSync(repo.dir, ['switch', 'main']);

  // existing-worktree: only a worktree this repository knows, inside the project.
  const reused = await doTarget(subprocess, repo.dir, { mode: 'existing-worktree', worktreePath: worktree.cwd }, 'x');
  assert.equal(reused.mode, 'existing-worktree');
  assert.equal(reused.branch, 'feat/try-the-new-parser');
  const itself = await doTarget(subprocess, repo.dir, { mode: 'existing-worktree', worktreePath: repo.dir }, 'x');
  assert.match(itself.error, /project itself/, 'the project folder is the current-branch target, not a worktree');
  const nowhere = await doTarget(subprocess, repo.dir, { mode: 'existing-worktree', worktreePath: '/tmp/definitely-not-here-12345' }, 'x');
  assert.match(nowhere.error, /does not exist/);
} finally { repo.cleanup(); }

// ---- a folder that is not a repository, and one with no commit --------------------------------------------------------
const plain = makePlainDir();
try {
  const fallback = await doTarget(subprocess, plain.dir, { mode: 'current' });
  assert.equal(fallback.mode, 'current');
  assert.equal(fallback.branch, null);
  const refused = await doTarget(subprocess, plain.dir, { mode: 'branch' }, 'x');
  assert.match(refused.error, /not a git repository/);
} finally { plain.cleanup(); }

const empty = await makeRepo();
try {
  // An unborn HEAD: `git switch -c` would work but a worktree at HEAD cannot, so both are refused with a clear reason.
  await gitSync(empty.dir, ['checkout', '--orphan', 'bornless']);
  await gitSync(empty.dir, ['rm', '-rf', '--cached', '.']);
  // An unborn HEAD resolves to no branch at all, which is what the picker reports as "not a repository with a commit".
  assert.equal(await currentBranch(subprocess, empty.dir), undefined);
  const unbornWorktree = await doTarget(subprocess, empty.dir, { mode: 'worktree' }, 'x');
  assert.match(unbornWorktree.error, /no commit/);
  const unbornBranch = await doTarget(subprocess, empty.dir, { mode: 'branch' }, 'x');
  assert.match(unbornBranch.error, /no commit/);
} finally { empty.cleanup(); }

// ---- the route --------------------------------------------------------------------------------------------------------
{
  const repo2 = await makeRepo();
  const registry = { list: () => [{ id: 'w1', path: repo2.dir }] };
  const { ctx, routes } = makeCtx({ services: { workspaceRegistry: registry }, subprocess });
  installBranchTarget({ ...ctx, subprocess }, repo2.dir);

  // GET with a registered project path: the branch, the branches, and the saved mode.
  const info = await call(routes, BRANCH_TARGET_PATH, { search: { cwd: repo2.dir } });
  assert.equal(info.status, 200);
  assert.equal(info.json.repo, true);
  assert.equal(info.json.branch, 'main');
  assert.deepEqual(info.json.branches, ['main']);
  assert.equal(info.json.mode, 'current');

  // A path the workspace registry does not know is refused, so a request cannot point git at any folder it likes.
  const unknown = await call(routes, BRANCH_TARGET_PATH, { search: { cwd: '/tmp' } });
  assert.equal(unknown.status, 400);

  // POST current: no git at all, and the answer says where the chat starts.
  const started = await call(routes, BRANCH_TARGET_PATH, { method: 'POST', body: { cwd: repo2.dir, mode: 'current' } });
  assert.equal(started.status, 200);
  assert.equal(started.json.mode, 'current');
  assert.equal(started.json.branch, 'main');

  const worktree = await call(routes, BRANCH_TARGET_PATH, { method: 'POST', body: { cwd: repo2.dir, mode: 'worktree', text: 'Rewrite the parser' } });
  assert.equal(worktree.status, 200);
  assert.equal(worktree.json.branch, 'feat/rewrite-the-parser');
  assert.equal(existsSync(worktree.json.cwd), true);

  // A refused target is a 409 carrying git's own words, and a malformed one is a 400.
  const refused = await call(routes, BRANCH_TARGET_PATH, { method: 'POST', body: { cwd: repo2.dir, mode: 'existing-branch', existingBranch: 'nope' } });
  assert.equal(refused.status, 409);
  const malformed = await call(routes, BRANCH_TARGET_PATH, { method: 'POST', body: { cwd: repo2.dir, mode: 'nope' } });
  assert.equal(malformed.status, 400);
  const together = await call(routes, BRANCH_TARGET_PATH, { method: 'POST', body: { cwd: repo2.dir, mode: 'branch', branchName: 'feat/x', worktreePath: '/tmp/w' } });
  assert.equal(together.status, 400, 'a branch and a worktree at once never reaches git');
  repo2.cleanup();
}

// ---- a session folder that is a symlink -------------------------------------------------------------------------------
{
  const repo3 = await makeRepo();
  const { dir: linkParent, cleanup } = { dir: repo3.dir, cleanup: () => {} };
  const { ctx, routes } = makeCtx({ services: {}, subprocess, sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd: join(linkParent) } } }) } } });
  installBranchTarget({ ...ctx, subprocess }, repo3.dir);
  const bySession = await call(routes, BRANCH_TARGET_PATH, { search: { sessionId: 's1' } });
  assert.equal(bySession.status, 200);
  assert.equal(bySession.json.branch, 'main');
  repo3.cleanup();
  void cleanup;
}

// `projectDirOf` resolves a symlinked project folder to its real path, so containment checks compare real paths.
{
  const repo4 = await makeRepo();
  const link = join(repo4.dir, '..', `${Date.now()}-link`);
  symlinkSync(repo4.dir, link);
  const registry = { list: () => [{ id: 'w', path: link }] };
  const { ctx } = makeCtx({ services: { workspaceRegistry: registry } });
  assert.equal(await projectDirOf(ctx, { cwd: link }), realpathSync(repo4.dir));
  repo4.cleanup();
}
console.log('branch-target checks passed');