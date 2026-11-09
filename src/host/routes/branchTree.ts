import { existsSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { basename, join } from 'node:path';
import { BRANCH_TREE_PATH, WORKTREES_DIR } from '../../shared/routes.js';
import type { HostContext, WorkspaceRegistry } from '../context.js';
import { service } from '../context.js';
import { json } from '../context.js';
import { sharedStore, settingsFileOf } from '../store.js';

export interface BranchTreeInstaller {
  /** Register every branch folder that is not a project yet; answers how many were added. */
  sweep(): Promise<number>;
  /** The branch folders the projects on disk have. */
  folders(): Record<string, string>;
}

/**
 * `GET /api/widgets.branch-tree` / `POST {on}` — Branches in the workspace tree. While the widget is off this answers
 * `{on: false, folders: {}}` and the sweep registers nothing: off means the widget does nothing at all.
 */
export function installBranchTree(ctx: HostContext, home: string): BranchTreeInstaller {
  const store = sharedStore(settingsFileOf(home));
  const registry = (): WorkspaceRegistry | undefined => service<WorkspaceRegistry>(ctx, 'workspaceRegistry');

  const folders = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const workspace of registry()?.list?.() ?? []) {
      const base = join(workspace.path, WORKTREES_DIR);
      if (!existsSync(base)) continue;
      let entries: Dirent[];
      try { entries = readdirSync(base, { withFileTypes: true }) as Dirent[]; } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        out[join(base, entry.name)] = basename(entry.name);
      }
    }
    return out;
  };

  const sweep = async (): Promise<number> => {
    if (store.read().on.branchTree !== true) return 0;
    const api = registry();
    if (api?.create === undefined) return 0;
    const known = new Set((api.list?.() ?? []).map((workspace) => workspace.path));
    let added = 0;
    for (const folder of Object.keys(folders())) {
      if (known.has(folder)) continue;
      try { await api.create(folder, basename(folder)); added += 1; } catch { /* a folder that vanished meanwhile */ }
    }
    return added;
  };

  ctx.connection.fetch.register({
    path: BRANCH_TREE_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      if (request.method === 'POST') {
        let body: { on?: unknown };
        try { body = (await request.json()) as { on?: unknown }; } catch { return json({ error: 'bad request' }, 400); }
        if (typeof body?.on !== 'boolean') return json({ error: 'bad request' }, 400);
        await store.write({ kind: 'switch', id: 'branchTree', on: body.on });
      }
      const on = store.read().on.branchTree === true;
      return json({ on, folders: on ? folders() : {} });
    },
  });

  return { sweep, folders };
}