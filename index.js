/**
 * dsh-widgets — Host half.
 *
 * Six small, independently switchable widgets for the DeepSeek Harness UI. This half owns everything that must outlive a
 * page load or must run outside the browser:
 *
 * - the switches and their settings (`storages/dsh-widgets/settings.json`, owner-only, atomic writes);
 * - the branch / worktree target of a chat (git through `ctx.subprocess`, argv only, never a shell);
 * - the model catalog and the reasoning efforts that this Mac's own model configuration declares;
 * - the Improve prompt model call;
 * - moving and editing queued messages in dsh's own inbox;
 * - registering `<project>/.worktrees/*` folders as projects, but only while that widget is on.
 *
 * Nothing here opens a port, starts a server, or calls a model without a click. Every route is on dsh's authenticated
 * `/api` channel; every write is serialized so two windows cannot interleave.
 */
import {
  chmodSync, closeSync, constants as fsConstants, existsSync, mkdirSync, openSync, readFileSync, readSync,
  readdirSync, realpathSync, renameSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';

export const name = 'dsh-widgets';
export const inject = ['connection', 'subprocess', 'sessionQuery', 'sessionController'];

/* ---------------------------------------------------------------------------------------------------------------- routes */

export const SETTINGS_PATH = '/api/widgets.settings';
export const MODELS_PATH = '/api/widgets.models';
export const IMPROVE_PATH = '/api/widgets.improve';
export const BRANCH_TARGET_PATH = '/api/widgets.branch-target';
export const BRANCH_TREE_PATH = '/api/widgets.branch-tree';
export const QUEUE_MOVE_PATH = '/api/widgets.queue-move';
export const QUEUE_EDIT_PATH = '/api/widgets.queue-edit';

const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const isText = (value, max = 4096) => typeof value === 'string' && value.length > 0 && value.length <= max;
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/* -------------------------------------------------------------------------------------------------------------- widgets */

/** Every widget, in Settings order. */
export const WIDGETS = ['branchTarget', 'branchTree', 'planToggle', 'queueReorder', 'queueEdit', 'improvePrompt'];

/** These do nothing until the user switches them on: Branches in the workspace tree writes to the workspace registry. */
export const OFF_BY_DEFAULT = ['branchTree'];

export const isWidget = (id) => WIDGETS.includes(id);
/** The default value of one switch: off only for `OFF_BY_DEFAULT`. */
export const defaultOn = (id) => !OFF_BY_DEFAULT.includes(id);

/** The five ways a chat can start. `mode` is a single value, which is what keeps a branch and a worktree from ever
 * being true at once. */
export const MODES = ['current', 'branch', 'worktree', 'existing-branch', 'existing-worktree'];
export const BRANCH_MAX = 64;
/** The effort id that means "do not ask for reasoning": the local model config spells it `off: null`. */
export const OFF_EFFORT = 'off';
export const IMPROVE_INPUT_MAX = 8000;
export const IMPROVE_MAX_TOKENS = 16000;
export const IMPROVE_TIMEOUT_MS = 120000;
const BRIEF_FILE_MAX = 4000;

/** The settings every widget starts from. `improve.model === null` follows the chat's own model. */
export function defaultSettings() {
  return {
    on: Object.fromEntries(WIDGETS.map((id) => [id, defaultOn(id)])),
    branchTarget: { mode: 'current' },
    improve: { model: null, effort: null },
  };
}

/** A stored value narrowed to the shape this plugin writes: unknown keys go, wrong types fall back to the default. */
export function sanitizeSettings(value) {
  const next = defaultSettings();
  const source = plainObject(value) ? value : {};
  if (plainObject(source.on)) {
    for (const id of WIDGETS) if (typeof source.on[id] === 'boolean') next.on[id] = source.on[id];
  }
  if (plainObject(source.branchTarget) && MODES.includes(source.branchTarget.mode)) next.branchTarget.mode = source.branchTarget.mode;
  if (plainObject(source.improve)) {
    const model = source.improve.model;
    if (plainObject(model) && isText(model.provider, 200) && isText(model.model, 200)) next.improve.model = { provider: model.provider, model: model.model };
    if (typeof source.improve.effort === 'string' && source.improve.effort !== '' && source.improve.effort.length <= 64) next.improve.effort = source.improve.effort;
  }
  return next;
}

/**
 * One settings file. `read()` never throws: a missing, unreadable or broken file reads as the defaults, so one bad write
 * cannot lock the user out of Settings. `write(mutate)` serializes through a promise chain, writes a temp file and renames
 * it (a reader never sees half a file), and keeps the file owner-only.
 */
export function settingsStore(file) {
  let tail = Promise.resolve();
  const read = () => {
    try {
      return sanitizeSettings(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      return defaultSettings();
    }
  };
  const write = (mutate) => {
    const run = tail.then(() => {
      const next = sanitizeSettings(typeof mutate === 'function' ? mutate(read()) : mutate);
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      try { chmodSync(temp, 0o600); } catch { /* best effort on filesystems without modes */ }
      renameSync(temp, file);
      return next;
    });
    tail = run.catch(() => {});
    return run;
  };
  return { read, write };
}

/** One store per file. Three installers read the same settings file, and a second queue for the same file would let two
 * writes interleave; sharing the store keeps every write serialized. */
const stores = new Map();
export function sharedStore(file) {
  if (!stores.has(file)) stores.set(file, settingsStore(file));
  return stores.get(file);
}

/** What a switch change may touch: `{id, on}` for a widget, `{improve: {...}}` for the Improve prompt settings. */
export function parseSettingsPatch(body) {
  if (!plainObject(body)) return { error: 'bad request' };
  const keys = Object.keys(body);
  if (keys.length === 2 && keys.includes('id') && keys.includes('on')) {
    if (!isWidget(body.id) || typeof body.on !== 'boolean') return { error: 'bad request' };
    return { kind: 'switch', id: body.id, on: body.on };
  }
  if (keys.length === 1 && keys.includes('improve')) {
    if (!plainObject(body.improve)) return { error: 'bad request' };
    const patch = body.improve;
    const allowed = ['model', 'effort'];
    if (!Object.keys(patch).every((key) => allowed.includes(key))) return { error: 'bad request' };
    if (patch.model !== undefined && patch.model !== null) {
      if (!plainObject(patch.model) || !isText(patch.model.provider, 200) || !isText(patch.model.model, 200)) return { error: 'bad request' };
    }
    if (patch.effort !== undefined && patch.effort !== null) {
      if (typeof patch.effort !== 'string' || patch.effort === '' || patch.effort.length > 64) return { error: 'bad request' };
    }
    return { kind: 'improve', patch };
  }
  if (keys.length === 1 && keys.includes('branchTarget')) {
    if (!plainObject(body.branchTarget) || Object.keys(body.branchTarget).length !== 1) return { error: 'bad request' };
    if (!MODES.includes(body.branchTarget.mode)) return { error: 'bad request' };
    return { kind: 'mode', mode: body.branchTarget.mode };
  }
  return { error: 'bad request' };
}

/* ---------------------------------------------------------------------------------------------------- reasoning model */

/**
 * The reasoning efforts this Mac's model configuration declares for one model, from `llm.resolveModelInfo`. The list is
 * the configuration's own list — never a fixed ladder — so a model configured with `off/low/medium/high` offers those
 * four and a model configured with none offers nothing.
 */
export function reasoningOptions(modelInfo) {
  const reasoning = plainObject(modelInfo?.reasoning) ? modelInfo.reasoning : undefined;
  const declared = Array.isArray(reasoning?.efforts) ? reasoning.efforts : [];
  const seen = new Set();
  const efforts = [];
  for (const entry of declared) {
    if (!plainObject(entry) || !isText(entry.id, 64) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    efforts.push({
      id: entry.id,
      name: isText(entry.name, 200) ? entry.name : entry.id,
      ...(isText(entry.description, 500) ? { description: entry.description } : {}),
    });
  }
  return {
    supported: efforts.length > 0,
    efforts,
    defaultEffort: isText(reasoning?.defaultEffort, 64) ? reasoning.defaultEffort : undefined,
  };
}

/**
 * The request controls for one Improve prompt call. An effort the model does not declare is replaced by the model's own
 * default (dsh rejects an unknown effort rather than clamping it); `off` and "nothing chosen" both send no
 * `reasoningEffort` at all, which is exactly what the local config's `off: null` means.
 */
export function callControls(effort, modelInfo) {
  const { efforts, defaultEffort } = reasoningOptions(modelInfo);
  if (efforts.length === 0) return {};
  const ids = efforts.map((entry) => entry.id);
  const wanted = isText(effort, 64) && ids.includes(effort) ? effort : defaultEffort;
  if (wanted === undefined || wanted === OFF_EFFORT || !ids.includes(wanted)) return {};
  return { reasoningEffort: wanted };
}

/* --------------------------------------------------------------------------------------------------------------- names */

/** A git branch name git and the filesystem both accept. Rejects options (a leading `-`), `..`, `//` and ref suffixes. */
export function isBranchName(value) {
  if (typeof value !== 'string' || value === '' || value.length > BRANCH_MAX) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return false;
  if (value.startsWith('-') || value.startsWith('/') || value.endsWith('/')) return false;
  if (value.includes('//') || value.includes('..') || value.includes('@{')) return false;
  if (value.endsWith('.lock') || value.endsWith('.')) return false;
  return true;
}

/**
 * A branch name from the first message: `feat/...` or `fix/...` plus an ASCII slug. Deterministic and offline — no model
 * call is made for a name, so the same message always proposes the same branch. A slug taken by an existing branch gets
 * `-2`, `-3`… A message without ASCII letters (for example Chinese) becomes `feat/change`.
 */
export function branchSlug(text, existing = []) {
  const raw = String(text ?? '');
  const ascii = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const stem = ascii === '' ? 'change' : ascii.slice(0, 40).replace(/-+$/, '') || 'change';
  const prefix = /\b(fix|bug|repair|hotfix|issue)\b|修复|修正|缺陷|报错/i.test(raw) ? 'fix' : 'feat';
  const base = `${prefix}/${stem}`;
  const taken = new Set(existing.map((entry) => String(entry).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate.toLowerCase()) && candidate.length <= BRANCH_MAX) return candidate;
  }
  return `${base}-${Date.now()}`.slice(0, BRANCH_MAX);
}

/** The folder under `<project>/.worktrees/` for a branch name: `feat/add-login` → `feat-add-login`. */
export const worktreeFolder = (branch) => String(branch).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'worktree';

/* ------------------------------------------------------------------------------------------------------------- targets */

/**
 * Read and check one target request. The five modes are mutually exclusive by construction: a `branch` target carries no
 * worktree, a `worktree` target starts its own branch, and a request that names both is refused.
 */
export function parseTarget(body) {
  if (!plainObject(body)) return { error: 'bad request' };
  const mode = body.mode ?? 'current';
  if (!MODES.includes(mode)) return { error: 'unknown mode' };
  const { branchName, worktreePath, existingBranch } = body;
  if (branchName !== undefined && worktreePath !== undefined) return { error: 'a target is either a branch or a worktree, never both' };
  if (branchName !== undefined && branchName !== null && !isBranchName(branchName)) return { error: 'invalid branch name' };
  switch (mode) {
    case 'current':
      if (branchName != null || worktreePath != null || existingBranch != null) return { error: 'current takes no branch and no worktree' };
      return { target: { mode } };
    case 'branch':
      if (worktreePath != null || existingBranch != null) return { error: 'a new branch stays in the project folder' };
      return { target: { mode, ...(branchName == null ? {} : { branchName }) } };
    case 'worktree':
      if (existingBranch != null) return { error: 'a new worktree starts its own branch' };
      return { target: { mode, ...(branchName == null ? {} : { branchName }) } };
    case 'existing-branch':
      if (!isBranchName(existingBranch)) return { error: 'invalid existing branch' };
      if (worktreePath != null || branchName != null) return { error: 'an existing branch takes no new branch and no worktree' };
      return { target: { mode, existingBranch } };
    case 'existing-worktree':
      if (!isText(worktreePath, 4096)) return { error: 'invalid worktree path' };
      if (branchName != null || existingBranch != null) return { error: 'an existing worktree keeps its own branch' };
      return { target: { mode, worktreePath } };
    default:
      return { error: 'unknown mode' };
  }
}

/** Whether `candidate` is `project` or lives inside it, comparing resolved paths. */
export function isInsideProject(project, candidate) {
  if (typeof project !== 'string' || typeof candidate !== 'string') return false;
  const base = project.endsWith(sep) ? project.slice(0, -1) : project;
  return candidate === base || candidate.startsWith(`${base}${sep}`);
}

/* --------------------------------------------------------------------------------------------------------------- files */

/**
 * The first `maxBytes` of one regular file inside `dir`, or undefined. The path is resolved first and must stay inside
 * `dir`, and the file is opened with `O_NOFOLLOW | O_NONBLOCK`, so a swapped-in symlink or a FIFO cannot escape or block.
 */
export function readInside(dir, name, maxBytes = BRIEF_FILE_MAX) {
  let real;
  try { real = realpathSync(join(dir, name)); } catch { return undefined; }
  if (!isInsideProject(dir, real)) return undefined;
  try { if (!statSync(real).isFile()) return undefined; } catch { return undefined; }
  let fd;
  try { fd = openSync(real, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK); } catch { return undefined; }
  try {
    const buffer = Buffer.alloc(maxBytes);
    const read = readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, read).toString('utf8');
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/** A short, read-only description of the project for the Improve prompt call. */
export function projectBrief(dir, maxPerFile = BRIEF_FILE_MAX) {
  return ['AGENTS.md', 'README.md', 'package.json']
    .map((entry) => {
      const text = readInside(dir, entry, maxPerFile);
      return text === undefined || text.trim() === '' ? undefined : `<${entry}>\n${text.trim()}\n</${entry}>`;
    })
    .filter((part) => part !== undefined)
    .join('\n\n');
}

/** The Improve prompt request: the draft first, then what the project is, then the shape the answer must have. */
export function improvePromptText(draft, brief) {
  return [
    'You rewrite a developer\'s rough draft into a clearer prompt for a coding agent.',
    'Keep the writer\'s language and intent. Never invent file names, commands or facts that the draft and the project',
    'description do not support. Return only the rewritten prompt, with no preamble and no quotation marks.',
    '',
    '<draft>',
    draft,
    '</draft>',
    ...(brief === '' ? [] : ['', '<project>', brief, '</project>']),
    '',
    '<shape>',
    'State the goal first. When the draft has several parts, use a short numbered list. End with the check that should',
    'pass when the work is done, when the draft implies one.',
    '</shape>',
  ].join('\n');
}

export const improveInputOk = (text) => typeof text === 'string' && text.trim() !== '' && text.length <= IMPROVE_INPUT_MAX;

/* --------------------------------------------------------------------------------------------------------------- queue */

/** What the user sees of one queued message: its text and attachment ids, in order. */
export const seenOf = (content) => (Array.isArray(content) ? content : []).map((block) => (block?.type === 'text' ? ['text', block.text] : [block?.type ?? null, block?.attachment?.attachmentId ?? null]));

export const isEditPart = (part) => part !== null && typeof part === 'object' && (
  (part.type === 'text' && Object.keys(part).length === 2 && typeof part.text === 'string' && part.text.length <= 1e6)
  || ((part.type === 'image' || part.type === 'file') && Object.keys(part).length === 2 && isText(part.attachmentId, 512))
  || (part.type === 'image' && Object.keys(part).every((key) => ['type', 'mediaType', 'data', 'name'].includes(key)) && isText(part.mediaType, 64)
    && isText(part.data, 400e6) && (part.name === undefined || isText(part.name, 1024)))
  || (part.type === 'file' && Object.keys(part).length === 2 && isText(part.receiptId, 128))
);

/** A queue edit body: a non-empty list of known parts, at least one of them not blank text. */
export const editContentOk = (content) => Array.isArray(content) && content.length > 0 && content.length <= 100
  && content.every(isEditPart) && content.some((part) => part.type !== 'text' || part.text.trim() !== '');

/**
 * The queue order after moving one row to index `to` of `before`, the ids the user saw. Returns `{order}` or `{error}`:
 * `before` must still be a prefix-consistent view of the queue, so a message that started sending meanwhile is refused
 * instead of silently reordering the wrong row.
 */
export function mergeQueueOrder(ids, itemId, to, before) {
  if (!Array.isArray(ids) || !Array.isArray(before) || !before.every((id) => typeof id === 'string')) return { error: 'bad request' };
  if (typeof itemId !== 'string' || !Number.isSafeInteger(to) || to < 0) return { error: 'bad request' };
  if (to >= before.length) return { error: 'the queue changed' };
  const seen = ids.filter((id) => before.includes(id));
  if (seen.length !== before.length || seen.some((id, index) => id !== before[index])) return { error: 'the queue changed' };
  const from = ids.indexOf(itemId);
  const target = ids.indexOf(before[to]);
  if (from === -1 || target === -1) return { error: 'the queue changed' };
  if (from === target) return { moved: false, order: ids };
  const order = [...ids];
  const [moved] = order.splice(from, 1);
  order.splice(target, 0, moved);
  return { moved: true, order };
}

/* ----------------------------------------------------------------------------------------------------------------- git */

const GIT_ENV = { GIT_CONFIG_COUNT: '0', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
const GIT_OUTPUT_MAX = 1024 * 1024;
const GIT_TIMEOUT_MS = 120000;

/** Run `git <args>` in `cwd` through dsh's subprocess service: argv only, scrubbed config, bounded output, a timeout. */
export async function runGit(subprocess, cwd, args, signal, { timeoutMs = GIT_TIMEOUT_MS } = {}) {
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
  const out = handle.collected.stdout?.readFrom(0) ?? { text: '' };
  return {
    code: outcome.exitCode,
    stdout: out.text,
    stderr: handle.collected.stderr?.readFrom(0).text ?? '',
  };
}

/** The branch a folder is on, or undefined for a detached HEAD or a folder that is not a repository. */
export async function currentBranch(subprocess, cwd, signal) {
  const result = await runGit(subprocess, cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], signal);
  if (result.code !== 0) return undefined;
  const branch = result.stdout.trim();
  return branch === '' || branch === 'HEAD' ? undefined : branch;
}

/** Every local branch of the repository, in git's own order. */
export async function localBranches(subprocess, cwd, signal) {
  const result = await runGit(subprocess, cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], signal);
  if (result.code !== 0) return [];
  return result.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '' && isBranchName(line));
}

/** The worktrees git knows about: `[{path, branch, main}]`, the project's own folder first. */
export async function worktreeList(subprocess, cwd, signal) {
  const result = await runGit(subprocess, cwd, ['worktree', 'list', '--porcelain'], signal);
  if (result.code !== 0) return [];
  const entries = [];
  let entry;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      entry = { path: line.slice('worktree '.length), main: entries.length === 0 };
      entries.push(entry);
      continue;
    }
    if (entry !== undefined && line.startsWith('branch ')) {
      const ref = line.slice('branch '.length);
      entry.branch = ref.replace(/^refs\/heads\//, '');
    }
  }
  return entries.filter((item) => typeof item.path === 'string' && item.path !== '');
}

/* --------------------------------------------------------------------------------------------------------- installers */

/** Which chat folder a request means: an existing chat's directory, or a project the workspace registry already knows. */
export async function projectDirOf(ctx, body) {
  const sessionId = body?.sessionId;
  if (isText(sessionId, 200)) {
    try {
      const found = await ctx.sessionController.resolveAgent(sessionId);
      if (!('error' in found)) {
        const working = ctx.get?.('workingDirectory');
        const fromService = working?.get?.(found.agent.session);
        if (isText(fromService, 4096)) return realpathSync(fromService);
      }
    } catch { /* fall through to the workspace registry */ }
    const listed = ctx.sessions?.list?.getSnapshot?.().byId?.[sessionId]?.cwd;
    if (isText(listed, 4096)) return realpathSync(listed);
  }
  const wanted = body?.cwd;
  if (isText(wanted, 4096)) {
    const registry = ctx.get?.('workspaceRegistry');
    const known = registry?.list?.() ?? [];
    let real;
    try { real = realpathSync(wanted); } catch { return undefined; }
    const match = known.find((workspace) => {
      try { return realpathSync(workspace.path) === real; } catch { return false; }
    });
    if (match !== undefined) return real;
  }
  return undefined;
}

/**
 * `GET /api/widgets.branch-target` — the current branch, the branches, the worktrees and the saved default mode.
 * `POST` — carry out one target and answer where the chat must start.
 */
export function installBranchTarget(ctx, home) {
  const store = sharedStore(join(home, 'storages', 'dsh-widgets', 'settings.json'));
  const busy = new Set();
  ctx.connection.fetch.register({
    path: BRANCH_TARGET_PATH, methods: ['GET', 'POST'], requestBody: 'buffered',
    fetch: async (request) => {
      const subprocess = ctx.subprocess;
      if (request.method === 'GET') {
        const url = new URL(request.url);
        const dir = await projectDirOf(ctx, { sessionId: url.searchParams.get('sessionId') ?? undefined, cwd: url.searchParams.get('cwd') ?? undefined });
        if (dir === undefined) return json({ error: 'this chat has no project folder' }, 400);
        const [branch, branches, worktrees] = await Promise.all([
          currentBranch(subprocess, dir, request.signal),
          localBranches(subprocess, dir, request.signal),
          worktreeList(subprocess, dir, request.signal),
        ]);
        const isRepo = branch !== undefined;
        return json({
          cwd: dir,
          repo: isRepo,
          branch: branch ?? null,
          branches,
          worktrees: worktrees.filter((entry) => entry.main !== true).map((entry) => ({ path: entry.path, branch: entry.branch ?? null })),
          mode: store.read().branchTarget.mode,
          ...(isRepo ? {} : { reason: 'this folder is not a git repository, or it has no commit yet' }),
        });
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
      const parsed = parseTarget(body);
      if (parsed.error !== undefined) return json({ error: parsed.error }, 400);
      const dir = await projectDirOf(ctx, body);
      if (dir === undefined) return json({ error: 'this chat has no project folder' }, 400);
      if (busy.has(dir)) return json({ error: 'a target for this project is already being prepared' }, 409);
      busy.add(dir);
      try {
        const result = await applyTarget(subprocess, dir, parsed.target, body.text, request.signal);
        if (result.error !== undefined) return json({ error: result.error }, 409);
        return json(result);
      } catch (error) {
        return json({ error: String(error?.message ?? error) }, 500);
      } finally { busy.delete(dir); }
    },
  });
  return { ready: store };
}

/**
 * Carries out one target. `current` runs no git at all — the default must never touch the repository. The other modes
 * refuse to create anything that already exists, and a new worktree always creates its own branch first, so a chat is
 * never "on a branch and in a worktree" at the same time.
 */
export async function applyTarget(subprocess, dir, target, text, signal) {
  const real = realpathSync(dir);
  if (target.mode === 'current') {
    return { cwd: real, branch: (await currentBranch(subprocess, real, signal)) ?? null, mode: 'current' };
  }
  const top = await runGit(subprocess, real, ['rev-parse', '--show-toplevel'], signal);
  if (top.code !== 0) return { error: 'this folder is not a git repository, or it has no commit yet' };
  const head = await runGit(subprocess, real, ['rev-parse', '--verify', 'HEAD'], signal);
  if (head.code !== 0) return { error: 'this repository has no commit yet' };

  if (target.mode === 'branch') {
    const existing = await localBranches(subprocess, real, signal);
    const branch = target.branchName ?? branchSlug(text, existing);
    if (existing.includes(branch)) return { error: `the branch ${branch} already exists` };
    const created = await runGit(subprocess, real, ['switch', '-c', branch], signal);
    if (created.code !== 0) return { error: created.stderr.trim() || 'git could not create the branch' };
    return { cwd: real, branch, mode: 'branch' };
  }

  if (target.mode === 'worktree') {
    const existing = await localBranches(subprocess, real, signal);
    const branch = target.branchName ?? branchSlug(text, existing);
    if (existing.includes(branch)) return { error: `the branch ${branch} already exists` };
    const folder = worktreeFolder(branch);
    const path = join(real, '.worktrees', folder);
    if (existsSync(path)) return { error: `the folder ${path} already exists` };
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const added = await runGit(subprocess, real, ['worktree', 'add', '-b', branch, path, 'HEAD'], signal);
    if (added.code !== 0) return { error: added.stderr.trim() || 'git could not create the worktree' };
    return { cwd: path, branch, mode: 'worktree', worktree: path };
  }

  if (target.mode === 'existing-branch') {
    const switched = await runGit(subprocess, real, ['switch', target.existingBranch], signal);
    if (switched.code !== 0) return { error: switched.stderr.trim() || 'git could not switch to that branch' };
    return { cwd: real, branch: target.existingBranch, mode: 'existing-branch' };
  }

  // existing-worktree: the folder must be a worktree git already knows about for this repository.
  let realWorktree;
  try { realWorktree = realpathSync(target.worktreePath); } catch { return { error: 'that worktree folder does not exist' }; }
  const known = await worktreeList(subprocess, real, signal);
  const entry = known.find((item) => {
    try { return realpathSync(item.path) === realWorktree; } catch { return false; }
  });
  if (entry === undefined) return { error: 'that folder is not a worktree of this repository' };
  // The project's own folder is the `current` target, not a worktree target: the modes stay distinct.
  if (entry.main === true) return { error: 'that folder is the project itself: use the current branch' };
  if (!isInsideProject(real, realWorktree)) return { error: 'that worktree is outside this project' };
  return { cwd: realWorktree, branch: entry.branch ?? null, mode: 'existing-worktree', worktree: realWorktree };
}

/**
 * `GET /api/widgets.branch-tree` — the switch and the worktree folders it has registered. While the widget is off this
 * answers `{on: false, folders: {}}` and registers nothing: off means the widget does nothing at all.
 */
export function installBranchTree(ctx, home) {
  const store = sharedStore(join(home, 'storages', 'dsh-widgets', 'settings.json'));
  const folders = () => {
    const registry = ctx.get?.('workspaceRegistry');
    const out = {};
    for (const workspace of registry?.list?.() ?? []) {
      const base = join(workspace.path, '.worktrees');
      if (!existsSync(base)) continue;
      let entries;
      try { entries = readdirSync(base, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        out[join(base, entry.name)] = basename(entry.name);
      }
    }
    return out;
  };
  const sweep = async () => {
    if (store.read().on.branchTree !== true) return 0;
    const registry = ctx.get?.('workspaceRegistry');
    if (registry?.create === undefined) return 0;
    const known = new Set((registry.list?.() ?? []).map((workspace) => workspace.path));
    let added = 0;
    for (const folder of Object.keys(folders())) {
      if (known.has(folder)) continue;
      try { await registry.create(folder, basename(folder)); added += 1; } catch { /* a folder that vanished meanwhile */ }
    }
    return added;
  };
  ctx.connection.fetch.register({
    path: BRANCH_TREE_PATH, methods: ['GET', 'POST'], requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
        if (typeof body?.on !== 'boolean') return json({ error: 'bad request' }, 400);
        await store.write((current) => ({ ...current, on: { ...current.on, branchTree: body.on } }));
      }
      const on = store.read().on.branchTree === true;
      return json({ on, folders: on ? folders() : {} });
    },
  });
  return { sweep, folders };
}

/** `GET /api/widgets.settings` / `POST` — the switches and the Improve prompt settings. */
export function installSettings(ctx, home) {
  const store = sharedStore(join(home, 'storages', 'dsh-widgets', 'settings.json'));
  ctx.connection.fetch.register({
    path: SETTINGS_PATH, methods: ['GET', 'POST'], requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
        const patch = parseSettingsPatch(body);
        if (patch.error !== undefined) return json({ error: patch.error }, 400);
        const next = await store.write((current) => {
          if (patch.kind === 'switch') return { ...current, on: { ...current.on, [patch.id]: patch.on } };
          if (patch.kind === 'mode') return { ...current, branchTarget: { ...current.branchTarget, mode: patch.mode } };
          const improve = { ...current.improve, ...patch.patch };
          if (patch.patch.model === null) improve.model = null;
          if (patch.patch.effort === null) improve.effort = null;
          return { ...current, improve };
        });
        return json(next);
      }
      return json(store.read());
    },
  });
  return { store };
}

/**
 * `GET /api/widgets.models` — the providers and models this Mac's configuration declares; with `provider` and `model` it
 * adds that model's own reasoning efforts, read from `llm.resolveModelInfo` rather than from a fixed list.
 */
export function installModels(ctx) {
  const llm = () => { try { return ctx.get?.('llm'); } catch { return undefined; } };
  ctx.connection.fetch.register({
    path: MODELS_PATH, methods: ['GET'], requestBody: 'buffered',
    fetch: async (request) => {
      const service = llm();
      if (service?.listProviders === undefined) return json({ error: 'this dsh profile has no model service' }, 409);
      const url = new URL(request.url);
      const provider = url.searchParams.get('provider');
      const model = url.searchParams.get('model');
      if (provider !== null && model !== null) {
        try {
          const info = await service.resolveModelInfo?.(provider, model, request.signal);
          return json({ provider, model, reasoning: reasoningOptions(info) });
        } catch (error) {
          // A route the configuration still lists but the adapter no longer serves: no efforts, and the panel stays usable.
          return json({ provider, model, reasoning: { supported: false, efforts: [] }, error: String(error?.message ?? error) });
        }
      }
      const providers = [];
      for (const entry of service.listProviders() ?? []) {
        let models = [];
        try {
          models = (await service.listModels?.(entry.id)) ?? [];
        } catch { models = []; }
        providers.push({
          id: entry.id,
          name: isText(entry.name, 200) ? entry.name : entry.id,
          models: models.filter((item) => isText(item?.id, 200)).map((item) => ({
            id: item.id,
            name: isText(item.name, 200) ? item.name : item.id,
            ...(Array.isArray(item.inputModalities) ? { inputModalities: [...item.inputModalities] } : {}),
          })),
        });
      }
      return json({ providers });
    },
  });
}

/**
 * `POST /api/widgets.improve` — one model call that rewrites the draft. One improvement per chat at a time: a newer ask
 * aborts the older call, which answers 409 rather than locking the composer.
 */
export function installImprove(ctx, home) {
  const store = sharedStore(join(home, 'storages', 'dsh-widgets', 'settings.json'));
  const running = new Map();
  const llm = () => { try { return ctx.get?.('llm'); } catch { return undefined; } };
  ctx.connection.fetch.register({
    path: IMPROVE_PATH, methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
      if (!plainObject(body) || !isText(body.sessionId, 200) || !improveInputOk(body.text)) return json({ error: 'bad request' }, 400);
      if (!isText(body.provider, 200) || !isText(body.model, 200)) return json({ error: 'bad request' }, 400);
      const service = llm();
      if (service?.prepareCall === undefined) return json({ error: 'this dsh profile cannot call a model' }, 409);
      running.get(body.sessionId)?.abort();
      const mine = new AbortController();
      running.set(body.sessionId, mine);
      const signal = request.signal === undefined ? mine.signal : AbortSignal.any([mine.signal, request.signal]);
      try {
        const info = await service.resolveModelInfo?.(body.provider, body.model, signal);
        const controls = callControls(body.effort ?? store.read().improve.effort, info);
        const prepared = await service.prepareCall({ provider: body.provider, model: body.model, ...controls }, signal);
        const brief = await briefOf(ctx, body);
        const text = await collect(prepared, improvePromptText(body.text, brief), signal);
        if (text.trim() === '') return json({ error: 'the model gave no text' }, 502);
        return json({ text: text.trim(), provider: body.provider, model: body.model, effort: controls.reasoningEffort ?? null });
      } catch (error) {
        if (mine.signal.aborted) return json({ error: 'a newer improvement replaced this one' }, 409);
        return json({ error: String(error?.message ?? error) }, 502);
      } finally {
        if (running.get(body.sessionId) === mine) running.delete(body.sessionId);
      }
    },
  });
  return { running };
}

/** The project brief for one Improve call, read only when the chat has a folder. */
async function briefOf(ctx, body) {
  try {
    const dir = await projectDirOf(ctx, body);
    return dir === undefined ? '' : projectBrief(dir);
  } catch {
    return '';
  }
}

/** Stream one prepared model call to its text. */
async function collect(prepared, prompt, signal) {
  let text = '';
  const stream = prepared.stream({
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    maxTokens: IMPROVE_MAX_TOKENS,
    signal,
  });
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta') text += chunk.text;
    if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
      throw new Error(chunk.reason.failure?.message ?? 'the model call failed');
    }
  }
  return text;
}

/** `POST /api/widgets.queue-move` — move one of your own queued messages in dsh's own inbox, with its attachments. */
export function installQueueMove(ctx, busy = new Set()) {
  ctx.connection.fetch.register({
    path: QUEUE_MOVE_PATH, methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
      const { sessionId, itemId, to, before } = body ?? {};
      if (!isText(sessionId, 200) || !isText(itemId, 512) || !Number.isSafeInteger(to) || to < 0 || !Array.isArray(before)) return json({ error: 'bad request' }, 400);
      if (busy.has(sessionId)) return json({ error: 'a queue change in this chat is already running' }, 409);
      busy.add(sessionId);
      try {
        const found = await ctx.sessionController.resolveAgent(sessionId);
        if ('error' in found) return json({ error: 'this chat is not available' }, 409);
        const inbox = found.agent.inbox;
        if (inbox?.splice === undefined || !Array.isArray(inbox.nextTurn)) return json({ error: 'this dsh cannot move queued messages' }, 409);
        const ids = inbox.nextTurn.map((message) => message.id);
        const planned = mergeQueueOrder(ids, itemId, to, before);
        if (planned.error !== undefined) return json({ error: planned.error }, 409);
        if (planned.moved === false) return json({ moved: false });
        // One splice over the rows between the two places, in their new order: one log event, the same ids, and each
        // message keeps its own content (an attachment travels with its message).
        const from = ids.indexOf(itemId);
        const target = ids.indexOf(before[to]);
        const lo = Math.min(from, target);
        const hi = Math.max(from, target);
        const queue = inbox.nextTurn;
        const range = queue.slice(lo, hi + 1);
        if (!range.every((message) => message.source?.kind === 'user')) return json({ error: 'only your own queued messages can move' }, 409);
        const byId = new Map(range.map((message) => [message.id, message]));
        const reordered = planned.order.slice(lo, hi + 1).map((id) => byId.get(id));
        if (reordered.some((message) => message === undefined)) return json({ error: 'the queue changed' }, 409);
        inbox.splice('next-turn', lo, range.length, reordered);
        return json({ moved: true, order: inbox.nextTurn.map((message) => message.id) });
      } catch (error) {
        return json({ error: String(error?.message ?? error) }, 500);
      } finally { busy.delete(sessionId); }
    },
  });
}

/** `POST /api/widgets.queue-edit` — give one of your own queued messages new text, images and files in place. */
export function installQueueEdit(ctx, busy = new Set()) {
  ctx.connection.fetch.register({
    path: QUEUE_EDIT_PATH, methods: ['POST'], requestBody: 'buffered',
    fetch: async (request) => {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
      const { sessionId, itemId, content } = body ?? {};
      if (!isText(sessionId, 200) || !isText(itemId, 512) || !editContentOk(content)) return json({ error: 'bad request' }, 400);
      if (busy.has(sessionId)) return json({ error: 'a queue change in this chat is already running' }, 409);
      busy.add(sessionId);
      try {
        const found = await ctx.sessionController.resolveAgent(sessionId);
        if ('error' in found) return json({ error: 'this chat is not available' }, 409);
        const inbox = found.agent.inbox;
        if (inbox?.replace === undefined || !Array.isArray(inbox.nextTurn)) return json({ error: 'this dsh cannot edit queued messages' }, 409);
        const message = inbox.nextTurn.find((item) => item.id === itemId);
        const gone = () => json({ error: 'this message is not in the queue any more, or it changed' }, 409);
        if (message === undefined) return gone();
        if (body.seen !== undefined && JSON.stringify(body.seen) !== JSON.stringify(seenOf(message.content))) return gone();
        if (message.source?.kind !== 'user') return json({ error: 'only your own queued messages can be edited' }, 409);
        // Kept attachments: the message's own blocks, in the order the client asked for them.
        const own = new Map();
        for (const block of message.content) {
          const id = block?.attachment?.attachmentId;
          if ((block.type === 'image' || block.type === 'file') && typeof id === 'string') {
            own.set(`${block.type}:${id}`, [...(own.get(`${block.type}:${id}`) ?? []), block]);
          }
        }
        const uploads = ctx.get?.('fileUploads');
        const { agent } = found;
        const blocks = [];
        for (const part of content) {
          if (part.type === 'text') { blocks.push({ type: 'text', text: part.text }); continue; }
          if (part.attachmentId !== undefined) {
            const block = own.get(`${part.type}:${part.attachmentId}`)?.shift();
            if (block === undefined) return json({ error: 'an attachment is not in this message any more' }, 409);
            blocks.push(block);
            continue;
          }
          if (part.receiptId !== undefined) {
            if (uploads?.resolve === undefined) return json({ error: 'this dsh cannot add files to a queued message' }, 409);
            const resolved = uploads.resolve(agent, part.receiptId);
            if (resolved === undefined) return json({ error: 'a new file is not uploaded for this chat: add it again' }, 409);
            blocks.push(resolved);
            continue;
          }
          // A new image: this build leaves the bytes to dsh's own composer, which admits them per model.
          return json({ error: 'this dsh build cannot add images to a queued message: send it instead' }, 409);
        }
        const replaced = inbox.replace(itemId, blocks);
        if (replaced === false) return gone();
        const edited = inbox.nextTurn.find((item) => item.id === itemId) ?? message;
        return json({ edited: true, seen: seenOf(edited.content) });
      } catch (error) {
        return json({ error: String(error?.message ?? error) }, 500);
      } finally { busy.delete(sessionId); }
    },
  });
}

/* ----------------------------------------------------------------------------------------------------------------- apply */

export function apply(ctx) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  const queueBusy = new Set();
  const settings = installSettings(ctx, home);
  installModels(ctx);
  installImprove(ctx, home);
  installBranchTarget(ctx, home);
  const tree = installBranchTree(ctx, home);
  installQueueMove(ctx, queueBusy);
  installQueueEdit(ctx, queueBusy);
  // The branch-folder sweep only runs while the widget is on, and only when dsh's own registry can take a folder.
  const sweep = ctx.timer?.interval?.(() => { tree.sweep().catch(() => {}); }, 30000);
  return {
    store: settings.store,
    sweep: tree.sweep,
    dispose: () => { if (typeof sweep === 'function') sweep(); },
  };
}