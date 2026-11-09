import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { branchSlug, worktreeFolder } from '../shared/branch.js';
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

export interface CreatedWorktree {
  readonly path: string;
  readonly branch: string;
}

/**
 * Create a branch and a worktree for it, then answer where it is.
 *
 * This is the one piece of git this plugin still runs itself, and only because the chat's working directory is a property
 * of the session rather than something a prompt can change: for the chat to really be "in the worktree", the folder has
 * to exist before the first step runs. Which branch to cut and what to do inside it is still the agent's business.
 */
export async function createWorktree(
  subprocess: SubprocessService,
  projectDir: string,
  options: { readonly branchName?: string; readonly text?: string },
  signal?: AbortSignal,
): Promise<{ ok: CreatedWorktree; base: string } | { error: string }> {
  let real: string;
  try { real = realpathSync(projectDir); } catch { return { error: 'this project folder is gone' }; }

  const top = await runGit(subprocess, real, ['rev-parse', '--show-toplevel'], signal);
  if (top.code !== 0) return { error: 'this folder is not a git repository' };
  const head = await runGit(subprocess, real, ['rev-parse', '--verify', 'HEAD'], signal);
  if (head.code !== 0) return { error: 'this repository has no commit yet' };

  const existing = await localBranches(subprocess, real, signal);
  const base = (await currentBranch(subprocess, real, signal)) ?? 'HEAD';
  const branch = options.branchName ?? branchSlug(options.text, existing);
  if (existing.includes(branch)) return { error: `the branch ${branch} already exists` };

  const path = join(real, WORKTREES_DIR, worktreeFolder(branch));
  if (existsSync(path)) return { error: `the folder ${path} already exists` };
  if (!isInsideProject(real, join(real, WORKTREES_DIR))) return { error: 'the worktree would be outside the project' };

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const added = await runGit(subprocess, real, ['worktree', 'add', '-b', branch, path, 'HEAD'], signal);
  if (added.code !== 0) return { error: added.stderr.trim() || 'git could not create the worktree' };
  return { ok: { path, branch }, base };
}