import { BRANCH_TARGET_PATH } from '../../shared/routes.js';
import type { TargetInfo } from '../../shared/types.js';
import type { HostContext } from '../context.js';
import { json } from '../context.js';
import { projectDirOf } from '../project.js';
import { sharedStore, settingsFileOf } from '../store.js';
import { listTargets } from '../target.js';
import { intents } from './targetIntent.js';

/** Whether the chat has already sent something, which is what makes the target read-only. */
async function isLocked(ctx: HostContext, sessionId: string): Promise<boolean> {
  try {
    const query = ctx.get('sessionQuery') as {
      observeSession?(id: string, options: { projectionMode: 'none' }): Promise<{ events?: readonly { type?: string }[] }>;
    } | undefined;
    const observation = await query?.observeSession?.(sessionId, { projectionMode: 'none' });
    return (observation?.events ?? []).some((event) => event?.type === 'user/message');
  } catch {
    return false;
  }
}

export interface TargetState extends TargetInfo {
  /** True once the chat has sent a message: the chip shows where the task runs instead of offering a choice. */
  readonly locked: boolean;
  /** The target the composer recorded for this chat, when it is still waiting for the first step. */
  readonly pending?: TargetInfo['mode'];
}

/**
 * `GET /api/widgets.branch-target` — the read-only view the composer chip draws: the branch, the branches, the worktrees,
 * the saved default, whether the chat can still pick, and the target waiting for the first step.
 *
 * Nothing here runs git that writes: creating a worktree happens at the chat's first step, not when a page opens.
 */
export function installBranchTarget(ctx: HostContext, home: string): void {
  const store = sharedStore(settingsFileOf(home));

  ctx.connection.fetch.register({
    path: BRANCH_TARGET_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const sessionId = url.searchParams.get('sessionId') ?? undefined;
      const dir = await projectDirOf(ctx, { sessionId, cwd: url.searchParams.get('cwd') ?? undefined });
      if (dir === undefined) return json({ error: 'this chat has no project folder' }, 400);

      const mode = store.read().branchTarget.mode;
      const info = await listTargets(ctx.subprocess, dir, mode, request.signal);
      const locked = sessionId === undefined ? false : await isLocked(ctx, sessionId);
      const pending = sessionId === undefined ? undefined : intents.get(sessionId)?.target.mode;
      const state: TargetState = { ...info, locked, ...(pending === undefined ? {} : { pending }) };
      return json(state);
    },
  });
}