// Branches in the workspace tree: off by default and inert while off, idempotent while on, and never destructive when a
// folder disappears.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRANCH_TREE_PATH, installBranchTree } from '../index.js';
import { call, makeCtx, tempDir } from './helpers.mjs';

/** A workspace registry that records what it was asked to create. */
function makeRegistry(paths) {
  const created = [];
  let list = paths.map((path, index) => ({ id: `w${index}`, path }));
  return {
    created,
    list: () => list,
    async create(path, title) { created.push({ path, title }); list = [...list, { id: `new${created.length}`, path }]; return { id: `new${created.length}`, path }; },
  };
}

const workspace = tempDir();
const worktrees = join(workspace.dir, '.worktrees');
mkdirSync(join(worktrees, 'feat-one'), { recursive: true });
mkdirSync(join(worktrees, 'feat-two'), { recursive: true });
writeFileSync(join(worktrees, 'not-a-folder'), 'file');

// Off (the default): nothing is read for creation, nothing is created, and the route reports an empty map.
{
  const registry = makeRegistry([workspace.dir]);
  const home = tempDir();
  const { ctx, routes } = makeCtx({ services: { workspaceRegistry: registry } });
  const tree = installBranchTree(ctx, home.dir);

  assert.equal(await tree.sweep(), 0, 'off: the sweep does nothing');
  assert.deepEqual(registry.created, [], 'off: no workspace is created');

  const answer = await call(routes, BRANCH_TREE_PATH);
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.json, { on: false, folders: {} }, 'off: the route reports nothing');

  // Switching it on through the route is what makes the next sweep act.
  const on = await call(routes, BRANCH_TREE_PATH, { method: 'POST', body: { on: true } });
  assert.equal(on.json.on, true);
  assert.deepEqual(Object.keys(on.json.folders).sort(), [join(worktrees, 'feat-one'), join(worktrees, 'feat-two')].sort(), 'only folders count');

  assert.equal(await tree.sweep(), 2, 'on: both folders are registered');
  assert.deepEqual(registry.created.map((entry) => entry.path).sort(), [join(worktrees, 'feat-one'), join(worktrees, 'feat-two')].sort());
  assert.equal(registry.created[0].title, 'feat-one', 'the folder name is the title');

  // Running it again changes nothing: the sweep is idempotent.
  assert.equal(await tree.sweep(), 0, 'on: a second sweep adds nothing');
  assert.equal(registry.created.length, 2);

  // A folder that disappears stops being reported; its workspace is left alone rather than deleted.
  assert.deepEqual(Object.keys(tree.folders()).length, 2);
  home.cleanup();
}

// Off again: the switch really is the only condition.
{
  const registry = makeRegistry([workspace.dir]);
  const home = tempDir();
  const { ctx, routes } = makeCtx({ services: { workspaceRegistry: registry } });
  const tree = installBranchTree(ctx, home.dir);
  await call(routes, BRANCH_TREE_PATH, { method: 'POST', body: { on: true } });
  await tree.sweep();
  const after = registry.created.length;
  await call(routes, BRANCH_TREE_PATH, { method: 'POST', body: { on: false } });
  mkdirSync(join(worktrees, 'feat-three'), { recursive: true });
  assert.equal(await tree.sweep(), 0, 'switched off, a new folder is ignored');
  assert.equal(registry.created.length, after);
  assert.deepEqual((await call(routes, BRANCH_TREE_PATH)).json, { on: false, folders: {} });
  home.cleanup();
}

// A bad switch body is refused and does not flip anything.
{
  const home = tempDir();
  const { ctx, routes } = makeCtx({ services: { workspaceRegistry: makeRegistry([]) } });
  installBranchTree(ctx, home.dir);
  assert.equal((await call(routes, BRANCH_TREE_PATH, { method: 'POST', body: { on: 'yes' } })).status, 400);
  assert.equal((await call(routes, BRANCH_TREE_PATH, { method: 'POST', body: 'nope' })).status, 400);
  assert.equal((await call(routes, BRANCH_TREE_PATH)).json.on, false);
  home.cleanup();
}

// A dsh without a workspace registry: the sweep is a no-op rather than a crash.
{
  const home = tempDir();
  const { ctx, routes } = makeCtx({ services: {} });
  const tree = installBranchTree(ctx, home.dir);
  await call(routes, BRANCH_TREE_PATH, { method: 'POST', body: { on: true } });
  assert.equal(await tree.sweep(), 0);
  home.cleanup();
}

workspace.cleanup();
console.log('branch-tree checks passed');