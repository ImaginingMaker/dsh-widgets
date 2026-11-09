import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { briefSignature } from '../shared/brief.js';
import type { BriefStatus } from '../shared/types.js';
import type { SubprocessService } from './context.js';
import { projectBrief, projectListing } from './files.js';
import { runGit } from './git.js';

export interface BriefRecord {
  readonly status: BriefStatus;
  readonly text?: string;
  readonly error?: string;
  readonly signature?: string;
  readonly at?: number;
  readonly model?: string;
}

interface BriefFile {
  readonly projects: Record<string, BriefRecord>;
}

/** How long one analysis may take before it is reported as failed. */
export const BRIEF_TIMEOUT_MS = 60_000;
/** How many projects keep a summary. */
export const BRIEF_PROJECTS_MAX = 200;

const chunks = ['AGENTS.md', 'README.md', 'package.json'];

/**
 * The summary of one project, keyed by its real path, with the fingerprint it was made from. A record whose fingerprint no
 * longer matches the project is stale: the next chat in that project rebuilds it.
 */
export function briefStore(file: string) {
  let tail: Promise<unknown> = Promise.resolve();

  const read = (): BriefFile => {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      const projects = parsed?.projects;
      if (projects === null || typeof projects !== 'object' || Array.isArray(projects)) return { projects: {} };
      const kept: Record<string, BriefRecord> = {};
      for (const [path, record] of Object.entries(projects as Record<string, BriefRecord>)) {
        if (typeof path !== 'string' || record === null || typeof record !== 'object') continue;
        kept[path] = record;
      }
      return { projects: kept };
    } catch {
      return { projects: {} };
    }
  };

  const write = (mutate: (current: BriefFile) => BriefFile): Promise<BriefFile> => {
    const run = tail.then(async () => {
      const next = mutate(read());
      const entries = Object.entries(next.projects);
      const trimmed = entries.length <= BRIEF_PROJECTS_MAX
        ? next.projects
        : Object.fromEntries(entries.sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).slice(0, BRIEF_PROJECTS_MAX));
      const { mkdirSync, renameSync, writeFileSync, chmodSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      writeFileSync(temp, `${JSON.stringify({ projects: trimmed }, null, 2)}\n`, { mode: 0o600 });
      try { chmodSync(temp, 0o600); } catch { /* filesystems without modes */ }
      renameSync(temp, file);
      return { projects: trimmed };
    });
    tail = run.catch(() => {});
    return run;
  };

  return {
    read,
    write,
    get: (path: string): BriefRecord | undefined => read().projects[path],
    set: (path: string, record: BriefRecord): Promise<BriefFile> =>
      write((current) => ({ projects: { ...current.projects, [path]: record } })),
  };
}

/** The fingerprint of what a summary was made from: the commit plus the three readable files' size and mtime. */
export async function signatureOf(subprocess: SubprocessService, dir: string): Promise<string> {
  let head: string | undefined;
  try {
    const result = await runGit(subprocess, dir, ['rev-parse', 'HEAD']);
    if (result.code === 0) head = result.stdout.trim();
  } catch { /* not a repository: the files alone decide */ }
  // A project with no document of its own is summarised from its listing, so the listing is part of what the summary was
  // made from: a new folder in such a project invalidates the old summary instead of reusing it for ever.
  const files = chunks.flatMap((name) => {
    try {
      const path = join(dir, name);
      if (!existsSync(path)) return [];
      const stat = statSync(path);
      return [{ name, size: stat.size, mtimeMs: stat.mtimeMs }];
    } catch {
      return [];
    }
  });
  if (files.length === 0) {
    const listing = projectListing(dir);
    return `${briefSignature({ head, files })}@${listing.join(',')}`;
  }
  return briefSignature({ head, files });
}

/** The material one analysis reads: the same files the Improve prompt already trusts. */
export const briefMaterial = (dir: string): string => projectBrief(dir);

export interface BriefJob {
  readonly path: string;
  readonly promise: Promise<BriefRecord>;
}

/**
 * Runs one analysis per project at a time. A second request for a project already being read joins the first instead of
 * starting another model call, which is what keeps a page reload from billing twice.
 */
export function briefRunner(deps: {
  readonly store: ReturnType<typeof briefStore>;
  readonly signatureOf: (dir: string) => Promise<string>;
  readonly material: (dir: string) => string;
  readonly complete: (prompt: string, signal: AbortSignal) => Promise<{ text: string; model: string }>;
  readonly timeoutMs?: number;
}) {
  const running = new Map<string, Promise<BriefRecord>>();

  const start = async (dir: string, force: boolean): Promise<BriefRecord> => {
    const signature = await deps.signatureOf(dir);
    const existing = deps.store.get(dir);
    if (!force && existing !== undefined && existing.status === 'ready' && existing.signature === signature) return existing;

    const material = deps.material(dir);
    if (material.trim() === '') {
      // An empty folder is not a failure to report: there is simply nothing to summarise, and nothing to inject.
      return { status: 'idle', signature, at: Date.now() };
    }

    const timeout = AbortSignal.timeout(deps.timeoutMs ?? BRIEF_TIMEOUT_MS);
    try {
      const { text, model } = await deps.complete(material, timeout);
      if (text.trim() === '') throw new Error('the model gave no text');
      const record: BriefRecord = { status: 'ready', text, signature, at: Date.now(), model };
      await deps.store.set(dir, record);
      return record;
    } catch (error) {
      const reason = timeout.aborted ? 'timed out' : String((error as Error)?.message ?? error);
      const record: BriefRecord = { status: 'failed', error: reason, signature, at: Date.now() };
      await deps.store.set(dir, record);
      return record;
    }
  };

  return {
    /** Answer what is known now; start a read when there is nothing fresh, and answer `analyzing` for it. */
    async ensure(dir: string, force = false): Promise<{ record: BriefRecord; started: boolean }> {
      if (running.has(dir)) return { record: { status: 'analyzing' }, started: false };
      const signature = await deps.signatureOf(dir);
      const existing = deps.store.get(dir);
      if (!force && existing !== undefined && existing.status === 'ready' && existing.signature === signature) {
        return { record: existing, started: false };
      }
      if (!force && existing !== undefined && existing.status === 'failed' && existing.signature === signature) {
        // A failed read of an unchanged project is not retried on every chat open; only an explicit retry starts again.
        return { record: existing, started: false };
      }
      const promise = start(dir, true).finally(() => { running.delete(dir); });
      running.set(dir, promise);
      void promise.catch(() => {});
      return { record: { status: 'analyzing' }, started: true };
    },
    /** Wait for the read in flight, if any (the tests use this; the route never blocks on it). */
    async settled(dir: string): Promise<BriefRecord | undefined> {
      const promise = running.get(dir);
      if (promise === undefined) return deps.store.get(dir);
      await promise.catch(() => {});
      return deps.store.get(dir);
    },
    isRunning: (dir: string): boolean => running.has(dir),
  };
}