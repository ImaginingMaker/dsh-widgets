/**
 * dsh-widgets — Host half.
 *
 * Everything that must outlive a page load or must run outside the browser: the switches and their settings, the branch
 * and worktree target of a chat, the model catalogue and the reasoning efforts this Mac's own configuration declares,
 * the Improve prompt model call, moving and editing queued messages, and registering `.worktrees/*` folders as projects
 * while that widget is on.
 *
 * Nothing here opens a port, starts a server, or calls a model without a click.
 */
import { homedir } from 'node:os';
import { BRANCH_TREE_SWEEP_MS } from '../shared/routes.js';
import type { HostContext } from './context.js';
import { service } from './context.js';
import { installBranchTarget } from './routes/branchTarget.js';
import { installBranchTree } from './routes/branchTree.js';
import { installImprove } from './routes/improve.js';
import { installModels } from './routes/models.js';
import { installQueueEdit, installQueueMove } from './routes/queue.js';
import { installSettings } from './routes/settings.js';
import type { SettingsStore } from './store.js';

export const name = 'dsh-widgets';
export const inject = ['connection', 'subprocess', 'sessionQuery', 'sessionController'];

export interface HostHandle {
  readonly store: SettingsStore;
  readonly sweep: () => Promise<number>;
  readonly dispose: () => void;
}

export function apply(ctx: HostContext): HostHandle {
  const home = process.env.DSH_HOME ?? `${homedir()}/.dsh`;
  const queueBusy = new Set<string>();

  const { store } = installSettings(ctx, home);
  installModels(ctx);
  installImprove(ctx, home);
  installBranchTarget(ctx, home);
  const tree = installBranchTree(ctx, home);
  installQueueMove(ctx, queueBusy);
  installQueueEdit(ctx, queueBusy);

  // The branch-folder sweep only runs while the widget is on, and only when dsh's own registry can take a folder.
  const timer = service<{ interval(callback: () => void, delay: number): () => void }>(ctx, 'timer');
  const stop = timer?.interval(() => { void tree.sweep().catch(() => {}); }, BRANCH_TREE_SWEEP_MS);

  return { store, sweep: tree.sweep, dispose: () => { stop?.(); } };
}

export * from './context.js';
export * from './store.js';
export * from './files.js';
export * from './git.js';
export * from './project.js';
export * from '../shared/types.js';
export * from '../shared/routes.js';
export * from '../shared/settings.js';
export * from '../shared/reasoning.js';
export * from '../shared/branch.js';
export * from '../shared/queue.js';
export { installSettings } from './routes/settings.js';
export { installModels } from './routes/models.js';
export { installBranchTarget } from './routes/branchTarget.js';
export { installBranchTree } from './routes/branchTree.js';
export { installImprove, IMPROVE_MAX_TOKENS } from './routes/improve.js';
export { installQueueMove, installQueueEdit } from './routes/queue.js';