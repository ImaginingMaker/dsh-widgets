import { realpathSync } from 'node:fs';
import type { HostContext } from './context.js';
import { service } from './context.js';

const isText = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

const realpathOrUndefined = (path: string): string | undefined => {
  try { return realpathSync(path); } catch { return undefined; }
};

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
  try {
    const found = await ctx.sessionController?.resolveAgent(body.sessionId);
    if (found !== undefined && !('error' in found)) {
      const working = service<{ get?(session: unknown): unknown }>(ctx, 'workingDirectory');
      const fromService = working?.get?.(found.agent.session);
      if (isText(fromService, 4096)) return realpathOrUndefined(fromService);
    }
  } catch { /* fall through to the chat list */ }
  const listed = ctx.sessions?.list?.getSnapshot().byId?.[body.sessionId]?.cwd;
  return isText(listed, 4096) ? realpathOrUndefined(listed) : undefined;
}
