// Shared helpers for the dsh-widgets tests: a fake dsh Context that records registered routes, a Request driver for
// those routes, a real git-backed `subprocess` service, and a throwaway git repository.
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A Context with the surfaces these installers read: `connection.fetch.register`, `get(name)`, `sessions` and anything
 * else passed in `extra`. `routes` is keyed by path, as dsh does.
 */
export function makeCtx(extra = {}) {
  const routes = new Map();
  const ctx = {
    connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } },
    get: (name) => extra.services?.[name],
    sessions: extra.sessions ?? { list: { getSnapshot: () => ({ byId: {} }) } },
    ...(extra.ctx ?? {}),
  };
  return { ctx, routes };
}

/** Drive one registered route with a real Request, the way dsh's connection carrier does. */
export async function call(routes, path, { method = 'GET', body, search, signal } = {}) {
  const route = routes.get(path);
  if (route === undefined) throw new Error(`no route registered for ${path}`);
  if (!route.methods.includes(method)) throw new Error(`${path} does not take ${method}`);
  const url = `http://test${path}${search === undefined ? '' : `?${new URLSearchParams(search)}`}`;
  const init = { method, ...(signal === undefined ? {} : { signal }) };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const response = await route.fetch(new Request(url, init));
  const text = await response.text();
  let parsed;
  try { parsed = text === '' ? undefined : JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, json: parsed };
}

/**
 * A `subprocess` service that really runs commands, so the git helpers are exercised against git itself rather than
 * against a mock that cannot disagree with them.
 */
export function realSubprocess() {
  return {
    async resolveExecutable(command) { return command; },
    spawn({ argv, cwd, env = {} }) {
      const [file, ...args] = argv;
      const out = { stdout: '', stderr: '' };
      const done = new Promise((resolve) => {
        execFile(file, args, { cwd, env: { ...process.env, ...env }, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
          out.stdout = stdout ?? '';
          out.stderr = stderr ?? '';
          resolve({ exitCode: error === null ? 0 : (typeof error.code === 'number' ? error.code : 1) });
        });
      });
      return {
        done,
        collected: {
          stdout: { readFrom: () => ({ text: out.stdout }) },
          stderr: { readFrom: () => ({ text: out.stderr }) },
        },
      };
    },
  };
}

/** Run one command synchronously in a test repository, for arranging state. */
export function tempDir(prefix = 'dsh-widgets-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A real git repository with one commit on `main`, plus a helper to add a second commit. */
export function makeLlm(table, { preparers } = {}) {
  const calls = [];
  const streams = [];
  return {
    calls,
    streams,
    listProviders: () => Object.keys(table).map((id) => ({ id, name: id })),
    listModels: async (provider) => (table[provider]?.models ?? []).map((model) => ({ provider, id: model.id, name: model.name ?? model.id })),
    resolveModelInfo: async (provider, model) => {
      const entry = table[provider]?.models?.find((item) => item.id === model);
      if (entry === undefined) throw new Error(`unknown model ${provider}/${model}`);
      return {
        provider, id: model, name: entry.name ?? model,
        ...(entry.reasoning === undefined ? {} : { reasoning: entry.reasoning }),
        ...(entry.inputModalities === undefined ? {} : { inputModalities: entry.inputModalities }),
      };
    },
    prepareCall: async (config) => {
      calls.push(config);
      return {
        config,
        stream(options) {
          streams.push(options);
          const text = preparers?.(config, options) ?? 'rewritten';
          return (async function* generate() {
            yield { type: 'text-delta', index: 0, text };
            yield { type: 'finish', reason: { kind: 'stop' } };
          })();
        },
      };
    },
  };
}