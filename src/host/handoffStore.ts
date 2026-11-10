import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HandoffProject, HandoffStatus, HandoffTimings } from '../shared/handoff.js';

/**
 * One remembered handoff, keyed by the session it was started from.
 *
 * `pid` is part of the record, not bookkeeping: a `running` record whose process is gone was interrupted by a restart, and
 * the composer must say so instead of polling forever.
 */
export interface HandoffRecord {
  readonly status: 'running' | 'done' | 'failed';
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly pid: number;
  readonly newSessionId?: string;
  readonly title?: string;
  readonly project?: HandoffProject;
  readonly error?: string;
  readonly timings?: HandoffTimings;
}

interface HandoffFile {
  readonly handoffs: Record<string, HandoffRecord>;
}

/** How many sessions keep a remembered handoff. */
export const HANDOFF_RECORDS_MAX = 100;
/** A running record older than this cannot still be running: the job times out long before. */
export const HANDOFF_STALE_MS = 5 * 60_000;
/**
 * The handoff state of every session that had one.
 *
 * Same shape as the project-brief store: a read that never throws, and writes serialized through one promise chain, each a
 * temp file renamed into place so a reader never sees half a file. The file holds only state — never the note itself.
 */
export function handoffStore(file: string) {
  let tail: Promise<unknown> = Promise.resolve();

  const read = (): HandoffFile => {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { handoffs?: unknown };
      const records = parsed?.handoffs;
      if (records === null || typeof records !== 'object' || Array.isArray(records)) return { handoffs: {} };
      return { handoffs: records as Record<string, HandoffRecord> };
    } catch {
      return { handoffs: {} };
    }
  };

  const write = (mutate: (current: HandoffFile) => HandoffFile): Promise<HandoffFile> => {
    const run = tail.then(() => {
      const next = mutate(read());
      const entries = Object.entries(next.handoffs).sort((a, b) => b[1].startedAt - a[1].startedAt);
      const kept = Object.fromEntries(entries.slice(0, HANDOFF_RECORDS_MAX));
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      writeFileSync(temp, `${JSON.stringify({ handoffs: kept }, null, 2)}\n`, { mode: 0o600 });
      try { chmodSync(temp, 0o600); } catch { /* filesystems without modes */ }
      renameSync(temp, file);
      return { handoffs: kept };
    });
    tail = run.catch(() => {});
    return run;
  };

  return {
    read,
    write,
    get: (sessionId: string): HandoffRecord | undefined => read().handoffs[sessionId],
    set: (sessionId: string, record: HandoffRecord): Promise<HandoffFile> =>
      write((current) => ({ handoffs: { ...current.handoffs, [sessionId]: record } })),
    remove: (sessionId: string): Promise<HandoffFile> =>
      write((current) => {
        const { [sessionId]: _dropped, ...rest } = current.handoffs;
        return { handoffs: rest };
      }),
  };
}

/**
 * One stored record as the wire sees it.
 *
 * A `running` record left by another process (or one older than any handoff can live) is reported as failed: the job that
 * would have finished it is gone, and the user needs a retry rather than an endless spinner.
 */
export function handoffViewOf(
  record: HandoffRecord | undefined,
  options: { readonly now?: number; readonly pid?: number } = {},
): HandoffStatus {
  if (record === undefined) return { status: 'idle' };
  const now = options.now ?? Date.now();
  const pid = options.pid ?? process.pid;
  const interrupted = record.status === 'running' && (record.pid !== pid || now - record.startedAt > HANDOFF_STALE_MS);
  const base = {
    startedAt: record.startedAt,
    ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
    ...(record.newSessionId === undefined ? {} : { newSessionId: record.newSessionId }),
    ...(record.title === undefined ? {} : { title: record.title }),
    ...(record.project === undefined ? {} : { project: record.project }),
    ...(record.timings === undefined ? {} : { timings: record.timings }),
  };
  if (interrupted) return { status: 'failed', ...base, error: 'the previous handoff was interrupted' };
  if (record.status === 'running') return { status: 'running', ...base };
  if (record.status === 'done') return { status: 'done', ...base };
  return { status: 'failed', ...base, ...(record.error === undefined ? {} : { error: record.error }) };
}

/** The file this plugin keeps its handoff state in, under one dsh home. */
export const handoffFileOf = (home: string): string => `${home}/storages/dsh-widgets/handoffs.json`;