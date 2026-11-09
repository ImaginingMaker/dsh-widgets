import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { realpathSync } from 'node:fs';
import { branchSlug, worktreeFolder } from '../shared/branch.js';
import type { Target, TargetMode } from '../shared/types.js';
import { WORKTREES_DIR } from '../shared/routes.js';
import type { SubprocessService } from './context.js';
import { isInsideProject } from './files.js';

const GIT_ENV = { GIT_CONFIG_COUNT: '0', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
const GIT_OUTPUT_MAX = 1024 * 1024;
const GIT_TIMEOUT_MS = 120_000;

export interface GitResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run `git <args>` in `cwd` through dsh's subprocess service: argv only, scrubbed config, bounded output, a timeout. */
export async function runGit(
  subprocess: SubprocessService,
  cwd: string,
  args: readonly string[],
  signal?: AbortSignal,
  timeoutMs = GIT_TIMEOUT_MS,
): Promise<GitResult> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const executable = await subprocess.resolveExecutable('git');
  const handle = subprocess.spawn({
    argv: [executable, ...args],
    cwd,
    stdio: { stdin: 'ignore', stdout: { maxBytes: GIT_OUTPUT_MAX }, stderr: { maxBytes: 16384 } },
    graceMs: 1000,
    signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    env: GIT_ENV,
  });
  const outcome = await handle.done;
  return {
    code: outcome.exitCode,
    stdout: handle.collected.stdout?.readFrom(0).text ?? '',
    stderr: handle.collected.stderr?.readFrom(0).text ?? '',
  };
}

/** The branch a folder is on, or undefined for a detached HEAD, an unborn HEAD or a folder that is not a repository. */
export async function currentBranch(subprocess: SubprocessService, cwd: string, signal?: AbortSignal): Promise<string | undefined> {
  const result = await runGit(subprocess, cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], signal);
  if (result.code !== 0) return undefined;
  const branch = result.stdout.trim();
  return branch === '' || branch === 'HEAD' ? undefined : branch;
}

/** Every local branch of the repository, in git's own order. */
export async function localBranches(subprocess: SubprocessService, cwd: string, signal?: AbortSignal): Promise<string[]> {
  const result = await runGit(subprocess, cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], signal);
  if (result.code !== 0) return [];
  return result.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '');
}

export interface WorktreeEntry {
  readonly path: string;
  readonly branch?: string;
  readonly main?: boolean;
}

/** The worktrees git knows about: `[{path, branch, main}]`, the project's own folder first. */
export async function worktreeList(subprocess: SubprocessService, cwd: string, signal?: AbortSignal): Promise<WorktreeEntry[]> {
  const result = await runGit(subprocess, cwd, ['worktree', 'list', '--porcelain'], signal);
  if (result.code !== 0) return [];
  const entries: WorktreeEntry[] = [];
  let current: { path: string; branch?: string; main?: boolean } | undefined;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), main: entries.length === 0 };
      entries.push(current);
      continue;
    }
    if (current !== undefined && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
  }
  return entries.filter((item) => typeof item.path === 'string' && item.path !== '');
}

export interface AppliedTarget {
  readonly cwd: string;
  readonly branch: string | null;
  readonly mode: TargetMode;
  readonly worktree?: string;
}

export type ApplyResult = { ok: AppliedTarget } | { error: string };

/**
 * Carries out one target. `current` runs no git at all — the default must never touch the repository. The other modes
 * refuse to create anything that already exists, and a new worktree always creates its own branch first, so a chat is
 * never "on a branch and in a worktree" at the same time.
 */
export async function applyTarget(
  subprocess: SubprocessService,
  dir: string,
  target: Target,
  text: string | undefined,
  signal?: AbortSignal,
): Promise<ApplyResult> {
  const real = realpathSync(dir);

  if (target.mode === 'current') {
    return { ok: { cwd: real, branch: (await currentBranch(subprocess, real, signal)) ?? null, mode: 'current' } };
  }

  const top = await runGit(subprocess, real, ['rev-parse', '--show-toplevel'], signal);
  if (top.code !== 0) return { error: 'this folder is not a git repository, or it has no commit yet' };
  const head = await runGit(subprocess, real, ['rev-parse', '--verify', 'HEAD'], signal);
  if (head.code !== 0) return { error: 'this repository has no commit yet' };

  const existing = await localBranches(subprocess, real, signal);

  if (target.mode === 'branch') {
    const branch = target.branchName ?? branchSlug(text, existing);
    if (existing.includes(branch)) return { error: `the branch ${branch} already exists` };
    const created = await runGit(subprocess, real, ['switch', '-c', branch], signal);
    if (created.code !== 0) return { error: created.stderr.trim() || 'git could not create the branch' };
    return { ok: { cwd: real, branch, mode: 'branch' } };
  }

  if (target.mode === 'worktree') {
    const branch = target.branchName ?? branchSlug(text, existing);
    if (existing.includes(branch)) return { error: `the branch ${branch} already exists` };
    const path = join(real, WORKTREES_DIR, worktreeFolder(branch));
    if (existsSync(path)) return { error: `the folder ${path} already exists` };
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const added = await runGit(subprocess, real, ['worktree', 'add', '-b', branch, path, 'HEAD'], signal);
    if (added.code !== 0) return { error: added.stderr.trim() || 'git could not create the worktree' };
    return { ok: { cwd: path, branch, mode: 'worktree', worktree: path } };
  }

  if (target.mode === 'existing-branch') {
    const switched = await runGit(subprocess, real, ['switch', target.existingBranch], signal);
    if (switched.code !== 0) return { error: switched.stderr.trim() || 'git could not switch to that branch' };
    return { ok: { cwd: real, branch: target.existingBranch, mode: 'existing-branch' } };
  }

  // existing-worktree: the folder must be a worktree git already knows, and not the project's own folder.
  let realWorktree: string;
  try { realWorktree = realpathSync(target.worktreePath); } catch { return { error: 'that worktree folder does not exist' }; }
  const known = await worktreeList(subprocess, real, signal);
  const entry = known.find((item) => {
    try { return realpathSync(item.path) === realWorktree; } catch { return false; }
  });
  if (entry === undefined) return { error: 'that folder is not a worktree of this repository' };
  if (entry.main === true) return { error: 'that folder is the project itself: use the current branch' };
  if (!isInsideProject(real, realWorktree)) return { error: 'that worktree is outside this project' };
  return { ok: { cwd: realWorktree, branch: entry.branch ?? null, mode: 'existing-worktree', worktree: realWorktree } };
}