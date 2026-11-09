import { BRANCH_TARGET_PATH } from '../../shared/routes.js';
import { parseTarget } from '../../shared/branch.js';
import type { TargetInfo } from '../../shared/types.js';
import type { HostContext } from '../context.js';
import { json } from '../context.js';
import { applyTarget, currentBranch, localBranches, worktreeList } from '../git.js';
import { projectDirOf } from '../project.js';
import { sharedStore, settingsFileOf } from '../store.js';

/**
 * `GET /api/widgets.branch-target` — the current branch, the branches, the worktrees and the saved default mode.
 * `POST` — carry out one target and answer where the chat must start.
 */
export function installBranchTarget(ctx: HostContext, home: string): void {
  const store = sharedStore(settingsFileOf(home));
  const busy = new Set<string>();

  ctx.connection.fetch.register({
    path: BRANCH_TARGET_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      const subprocess = ctx.subprocess;

      if (request.method === 'GET') {
        const url = new URL(request.url);
        const dir = await projectDirOf(ctx, {
          sessionId: url.searchParams.get('sessionId') ?? undefined,
          cwd: url.searchParams.get('cwd') ?? undefined,
        });
        if (dir === undefined) return json({ error: 'this chat has no project folder' }, 400);

        const [branch, branches, worktrees] = await Promise.all([
          currentBranch(subprocess, dir, request.signal),
          localBranches(subprocess, dir, request.signal),
          worktreeList(subprocess, dir, request.signal),
        ]);
        const isRepo = branch !== undefined;
        const info: TargetInfo = {
          cwd: dir,
          repo: isRepo,
          branch: branch ?? null,
          branches,
          worktrees: worktrees.filter((entry) => entry.main !== true).map((entry) => ({ path: entry.path, branch: entry.branch ?? null })),
          mode: store.read().branchTarget.mode,
          ...(isRepo ? {} : { reason: 'this folder is not a git repository, or it has no commit yet' }),
        };
        return json(info);
      }

      let body: Record<string, unknown>;
      try { body = (await request.json()) as Record<string, unknown>; } catch { return json({ error: 'bad request' }, 400); }
      const parsed = parseTarget(body);
      if ('error' in parsed) return json({ error: parsed.error }, 400);

      const dir = await projectDirOf(ctx, { sessionId: body.sessionId, cwd: body.cwd });
      if (dir === undefined) return json({ error: 'this chat has no project folder' }, 400);
      if (busy.has(dir)) return json({ error: 'a target for this project is already being prepared' }, 409);

      busy.add(dir);
      try {
        const text = typeof body.text === 'string' ? body.text : undefined;
        const result = await applyTarget(subprocess, dir, parsed.target, text, request.signal);
        if ('error' in result) return json({ error: result.error }, 409);
        return json(result.ok);
      } catch (error) {
        return json({ error: String((error as Error)?.message ?? error) }, 500);
      } finally {
        busy.delete(dir);
      }
    },
  });
}