/**
 * dsh-widgets — Host half.
 *
 * Everything that must outlive a page load or must run outside the browser: the switches and their settings, the branch
 * and worktree target of a chat, the model catalogue and the reasoning efforts this Mac's own configuration declares, the
 * one model call behind Improve prompt and Project brief, moving and editing queued messages, and registering
 * `.worktrees/*` folders as projects while that widget is on.
 *
 * Nothing here opens a port, starts a server, or calls a model without a click — except Project brief, which is off by
 * default and says so.
 */
import { homedir } from 'node:os';
import { BRANCH_TREE_SWEEP_MS } from '../shared/routes.js';
import { targetNote } from '../shared/targetNote.js';
import type { LanguageSetting } from '../shared/types.js';
import { briefStore, signatureOf } from './briefStore.js';
import type { HostContext } from './context.js';
import { installBrief } from './routes/brief.js';
import { installBranchTarget } from './routes/branchTarget.js';
import { installBranchTree } from './routes/branchTree.js';
import { installImprove } from './routes/improve.js';
import { installModels } from './routes/models.js';
import { installPlan } from './routes/plan.js';
import { installQueueEdit, installQueueMove } from './routes/queue.js';
import { installSettings } from './routes/settings.js';
import { installTargetIntent, pruneIntents } from './routes/targetIntent.js';
import { installPreStep } from './preStep.js';
import { projectDirOf } from './project.js';
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
  installTargetIntent(ctx, home);
  installPlan(ctx);
  const brief = installBrief(ctx, home);
  const tree = installBranchTree(ctx, home);
  installQueueMove(ctx, queueBusy);
  installQueueEdit(ctx, queueBusy);

  // The one hook that prepares a chat: the target the composer asked for, and the project summary gathered in advance.
  installPreStep(ctx, {
    store,
    language: (): LanguageSetting => store.read().language,
    briefOf: async (dir) => ({ record: brief.store.get(dir), signature: await signatureOf(ctx.subprocess, dir) }),
    log: (message) => { try { console.warn(message); } catch { /* no console */ } },
  });

  const timer = (() => {
    try { return ctx.get('timer') as { interval(callback: () => void, delay: number): () => void } | undefined; } catch { return undefined; }
  })();
  const stopSweep = timer?.interval(() => { void tree.sweep().catch(() => {}); }, BRANCH_TREE_SWEEP_MS);
  const stopPrune = timer?.interval(() => { pruneIntents(); }, 60_000);

  return {
    store,
    sweep: tree.sweep,
    dispose: () => {
      stopSweep?.();
      stopPrune?.();
    },
  };
}

/**
 * The brief material the pre-step reads, so a summary is only used when it was made from the project as it is now. Exposed
 * because the hook must not block: it reads the cached record and compares signatures synchronously.
 */
export { briefStore, signatureOf, targetNote, projectDirOf };
export * from './context.js';
export * from './store.js';
export * from './files.js';
export * from './git.js';
export * from './project.js';
export * from './notes.js';
export * from './target.js';
export * from './preStep.js';
export * from './briefStore.js';
export * from '../shared/types.js';
export * from '../shared/routes.js';
export * from '../shared/settings.js';
export * from '../shared/reasoning.js';
export * from '../shared/branch.js';
export * from '../shared/queue.js';
export * from '../shared/targetNote.js';
export * from '../shared/brief.js';
export * from '../shared/styles.js';
export { installSettings } from './routes/settings.js';
export { installModels } from './routes/models.js';
export { installBranchTarget } from './routes/branchTarget.js';
export { installBranchTree } from './routes/branchTree.js';
export { installImprove, IMPROVE_MAX_TOKENS } from './routes/improve.js';
export { installQueueMove, installQueueEdit } from './routes/queue.js';
export { installTargetIntent, intents, pruneIntents, INTENT_TTL_MS } from './routes/targetIntent.js';
export { installBrief, analysisRoute, BRIEF_MAX_TOKENS } from './routes/brief.js';
export { installPlan, PLAN_LINES } from './routes/plan.js';