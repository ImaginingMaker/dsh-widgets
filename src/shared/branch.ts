import { MODES } from './types.js';
import type { Target, TargetMode } from './types.js';

export const BRANCH_MAX = 64;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isText = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

/** A git branch name git and the filesystem both accept. Rejects options (a leading `-`), `..`, `//` and ref suffixes. */
export function isBranchName(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > BRANCH_MAX) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return false;
  if (value.startsWith('-') || value.startsWith('/') || value.endsWith('/')) return false;
  if (value.includes('//') || value.includes('..') || value.includes('@{')) return false;
  if (value.endsWith('.lock') || value.endsWith('.')) return false;
  return true;
}

/**
 * A branch name from the first message: `feat/...` or `fix/...` plus an ASCII slug. Deterministic and offline — no model
 * call is made for a name, so the same message always proposes the same branch. A slug already taken gets `-2`, `-3`…
 * A message without ASCII letters (for example Chinese) becomes `feat/change`.
 */
export function branchSlug(text: string | null | undefined, existing: readonly string[] = []): string {
  const raw = String(text ?? '');
  const ascii = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const stem = ascii === '' ? 'change' : ascii.slice(0, 40).replace(/-+$/, '') || 'change';
  const prefix = /\b(fix|bug|repair|hotfix|issue)\b|修复|修正|缺陷|报错/i.test(raw) ? 'fix' : 'feat';
  const base = `${prefix}/${stem}`;
  const taken = new Set(existing.map((entry) => String(entry).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (candidate.length <= BRANCH_MAX && !taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}-${Date.now()}`.slice(0, BRANCH_MAX);
}

/** The folder under `<project>/.worktrees/` for a branch name: `feat/add-login` → `feat-add-login`. */
export const worktreeFolder = (branch: string): string =>
  String(branch).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'worktree';

const isMode = (value: unknown): value is TargetMode =>
  typeof value === 'string' && (MODES as readonly string[]).includes(value);

/** The result of reading one target request: the target, or the reason it is refused. */
export type TargetResultOf = { target: Target } | { error: string };

/**
 * Read and check one target request. The five modes are mutually exclusive by construction: a `branch` target carries no
 * worktree, a `worktree` target starts its own branch, and a request that names both is refused.
 */
export function parseTarget(body: unknown): TargetResultOf {
  if (!isPlainObject(body)) return { error: 'bad request' };
  const mode = body.mode ?? 'current';
  if (!isMode(mode)) return { error: 'unknown mode' };
  const branchName = body.branchName;
  const worktreePath = body.worktreePath;
  const existingBranch = body.existingBranch;

  if (branchName !== undefined && worktreePath !== undefined) {
    return { error: 'a target is either a branch or a worktree, never both' };
  }
  if (branchName !== undefined && branchName !== null && !isBranchName(branchName)) return { error: 'invalid branch name' };

  switch (mode) {
    case 'current':
      if (branchName != null || worktreePath != null || existingBranch != null) {
        return { error: 'current takes no branch and no worktree' };
      }
      return { target: { mode: 'current' } };
    case 'branch':
      if (worktreePath != null || existingBranch != null) return { error: 'a new branch stays in the project folder' };
      return { target: branchName == null ? { mode: 'branch' } : { mode: 'branch', branchName: branchName as string } };
    case 'worktree':
      if (existingBranch != null) return { error: 'a new worktree starts its own branch' };
      return { target: branchName == null ? { mode: 'worktree' } : { mode: 'worktree', branchName: branchName as string } };
    case 'existing-branch':
      if (!isBranchName(existingBranch)) return { error: 'invalid existing branch' };
      if (worktreePath != null || branchName != null) return { error: 'an existing branch takes no new branch and no worktree' };
      return { target: { mode: 'existing-branch', existingBranch } };
    case 'existing-worktree':
      if (!isText(worktreePath, 4096)) return { error: 'invalid worktree path' };
      if (branchName != null || existingBranch != null) return { error: 'an existing worktree keeps its own branch' };
      return { target: { mode: 'existing-worktree', worktreePath } };
  }
}
