import type { SubprocessService } from './context.js';

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

