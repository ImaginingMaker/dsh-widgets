import type { Target, TargetInfo } from '../shared/types.js';
import type { SubprocessService } from './context.js';
import { currentBranch, localBranches, worktreeList } from './git.js';

/** Everything the composer chip needs about one project. */
export async function listTargets(subprocess: SubprocessService, dir: string, mode: TargetInfo['mode'], signal?: AbortSignal): Promise<TargetInfo> {
  const [branch, branches, worktrees] = await Promise.all([
    currentBranch(subprocess, dir, signal),
    localBranches(subprocess, dir, signal),
    worktreeList(subprocess, dir, signal),
  ]);
  const isRepo = branch !== undefined;
  return {
    cwd: dir,
    repo: isRepo,
    branch: branch ?? null,
    branches,
    worktrees: worktrees.filter((entry) => entry.main !== true).map((entry) => ({ path: entry.path, branch: entry.branch ?? null })),
    mode,
    ...(isRepo ? {} : { reason: 'this folder is not a git repository, or it has no commit yet' }),
  };
}

/** Where a target will run, as the chip describes it after the first step. */
export interface AppliedTarget {
  readonly cwd: string;
  readonly branch: string | null;
  readonly mode: Target['mode'];
  readonly worktree?: string;
}

/**
 * The folder and branch a target resolves to right now, without creating anything. Used by the read-only chip once a chat
 * has started, so the chip shows where the task actually runs rather than what was asked for.
 */
export async function resolveTarget(subprocess: SubprocessService, dir: string, target: Target, signal?: AbortSignal): Promise<AppliedTarget> {
  switch (target.mode) {
    case 'worktree':
      return { cwd: dir, branch: target.branchName ?? null, mode: target.mode };
    case 'branch':
      return { cwd: dir, branch: target.branchName ?? (await currentBranch(subprocess, dir, signal)) ?? null, mode: target.mode };
    case 'existing-branch':
      return { cwd: dir, branch: target.existingBranch, mode: target.mode };
    case 'existing-worktree':
      return { cwd: target.worktreePath, branch: null, mode: target.mode, worktree: target.worktreePath };
    case 'current':
      return { cwd: dir, branch: (await currentBranch(subprocess, dir, signal)) ?? null, mode: target.mode };
  }
}