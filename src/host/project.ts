import { realpathSync } from 'node:fs';
import type { Agent, HostContext } from './context.js';
import { service } from './context.js';

const isText = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

const realpathOrUndefined = (path: string): string | undefined => {
  try { return realpathSync(path); } catch { return undefined; }
};

/**
 * Which folder a chat runs in, for a chat whose agent is already resolved.
 *
 * Split from `projectDirOf` so a caller that needs the agent anyway — the handoff reads the model route off it — resolves it
 * once instead of twice. The folder comes from the working directory dsh keeps for the agent, else from the chat list's own
 * record; a request cannot point either at an arbitrary path.
 */
export async function projectDirFor(
  ctx: HostContext,
  request: { readonly sessionId?: unknown; readonly agent?: Agent },
): Promise<string | undefined> {
  if (!isText(request.sessionId, 200)) return undefined;
  if (request.agent !== undefined) {
    try {
      const working = service<{ get?(session: unknown): unknown }>(ctx, 'workingDirectory');
      const fromService = working?.get?.(request.agent.session);
      if (isText(fromService, 4096)) {
        const resolved = realpathOrUndefined(fromService);
        if (resolved !== undefined) return resolved;
      }
    } catch { /* fall through to the chat list */ }
  }
  const listed = ctx.sessions?.list?.getSnapshot().byId?.[request.sessionId]?.cwd;
  return isText(listed, 4096) ? realpathOrUndefined(listed) : undefined;
}

/**
 * Which folder a chat runs in: the working directory dsh keeps for its agent, else the chat list's own record.
 *
 * Only a chat can name a folder. A request cannot point this plugin at an arbitrary path, which is what keeps a summary —
 * or a model call — scoped to the project the user actually opened.
 */
export async function projectDirOf(
  ctx: HostContext,
  body: { readonly sessionId?: unknown },
): Promise<string | undefined> {
  if (!isText(body.sessionId, 200)) return undefined;
  let agent: Agent | undefined;
  try {
    const found = await ctx.sessionController?.resolveAgent(body.sessionId);
    if (found !== undefined && !('error' in found)) agent = found.agent;
  } catch { /* the chat list still knows the folder */ }
  return projectDirFor(ctx, { sessionId: body.sessionId, agent });
}