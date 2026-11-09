import { realpathSync } from 'node:fs';
import type { HostContext, WorkspaceRegistry } from './context.js';
import { service } from './context.js';

const isText = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

const realpathOrUndefined = (path: string): string | undefined => {
  try { return realpathSync(path); } catch { return undefined; }
};

/**
 * Which chat folder a request means: an existing chat's directory, or a project the workspace registry already knows.
 * A path the registry does not know is refused, so a request cannot point git at any folder it likes.
 */
export async function projectDirOf(
  ctx: HostContext,
  body: { readonly sessionId?: unknown; readonly cwd?: unknown },
): Promise<string | undefined> {
  if (isText(body.sessionId, 200)) {
    try {
      const found = await ctx.sessionController?.resolveAgent(body.sessionId);
      if (found !== undefined && !('error' in found)) {
        const working = service<{ get?(session: unknown): unknown }>(ctx, 'workingDirectory');
        const fromService = working?.get?.(found.agent.session);
        if (isText(fromService, 4096)) return realpathOrUndefined(fromService);
      }
    } catch { /* fall through to the chat list */ }
    const listed = ctx.sessions?.list?.getSnapshot().byId?.[body.sessionId as string]?.cwd;
    if (isText(listed, 4096)) return realpathOrUndefined(listed);
  }

  if (isText(body.cwd, 4096)) {
    const real = realpathOrUndefined(body.cwd);
    if (real === undefined) return undefined;
    const registry = service<WorkspaceRegistry>(ctx, 'workspaceRegistry');
    const known = registry?.list?.() ?? [];
    const match = known.find((workspace) => realpathOrUndefined(workspace.path) === real);
    return match === undefined ? undefined : real;
  }

  return undefined;
}