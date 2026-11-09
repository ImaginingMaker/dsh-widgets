import { closeSync, constants as fsConstants, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/** How much of one file the project brief keeps. */
export const BRIEF_FILE_MAX = 4000;
/** How much of the draft the Improve prompt route accepts. */
export const IMPROVE_INPUT_MAX = 8000;

/** Whether `candidate` is `project` or lives inside it, comparing resolved paths on this platform. */
export function isInsideProject(project: string, candidate: string): boolean {
  if (typeof project !== 'string' || typeof candidate !== 'string') return false;
  const base = project.endsWith(sep) ? project.slice(0, -sep.length) : project;
  return candidate === base || candidate.startsWith(`${base}${sep}`);
}

/**
 * The first `maxBytes` of one regular file inside `dir`, or undefined. The path is resolved first and must stay inside
 * `dir`, and the file is opened with `O_NOFOLLOW | O_NONBLOCK`, so a swapped-in symlink or a FIFO cannot escape or block.
 */
export function readInside(dir: string, name: string, maxBytes = BRIEF_FILE_MAX): string | undefined {
  let real: string;
  try { real = realpathSync(join(dir, name)); } catch { return undefined; }
  if (!isInsideProject(dir, real)) return undefined;
  try { if (!statSync(real).isFile()) return undefined; } catch { return undefined; }
  let fd: number;
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

/** How deep the project tree goes, and how many entries it names before it admits to being partial. */
export const TREE_DEPTH = 3;
export const TREE_MAX_ENTRIES = 400;

/** Directories that are never worth reading: they are either huge, generated, or this plugin's own worktrees. */
const TREE_SKIP = new Set(['node_modules', '.git', '.worktrees']);

/** A file name as it may appear in a prompt: one line, no control characters, bounded. */
const cleanName = (name: string): string => name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) || '?';

export interface TreeOptions {
  readonly depth?: number;
  readonly maxEntries?: number;
}

/**
 * The file hierarchy of a project, `depth` levels deep.
 *
 * This is the plugin's whole opinion about what a project is: it reports structure and lets the model conclude. It never
 * follows a symbolic link (no cycles, no escaping the project), skips the directories that are never informative, and says
 * so when it stops early instead of passing off a partial tree as complete.
 */
export function projectTree(dir: string, options: TreeOptions = {}): string[] {
  const depth = Math.max(1, Math.min(8, options.depth ?? TREE_DEPTH));
  const maxEntries = Math.max(1, options.maxEntries ?? TREE_MAX_ENTRIES);
  const lines: string[] = [];
  let seen = 0;
  let truncated = false;

  const walk = (current: string, level: number): void => {
    if (truncated) return;
    let entries: { name: string; isDirectory(): boolean }[];
    try {
      entries = readdirSync(current, { withFileTypes: true }) as unknown as { name: string; isDirectory(): boolean }[];
    } catch {
      return;
    }
    // Directories first, then files, each by name: the same project always reads the same way.
    const sorted = entries
      .filter((entry) => entry.name !== '' && !TREE_SKIP.has(entry.name))
      .sort((left, right) => {
        const byKind = Number(right.isDirectory()) - Number(left.isDirectory());
        return byKind === 0 ? left.name.localeCompare(right.name) : byKind;
      });
    for (const entry of sorted) {
      if (seen >= maxEntries) { truncated = true; return; }
      seen += 1;
      const isDirectory = entry.isDirectory();
      lines.push(`${'  '.repeat(level)}${cleanName(entry.name)}${isDirectory ? '/' : ''}`);
      if (isDirectory && level + 1 < depth) walk(join(current, entry.name), level + 1);
    }
  };

  walk(dir, 0);
  if (truncated) lines.push('… (more entries omitted)');
  return lines;
}

/** The three documents a project usually carries, if it carries them at all. */
export function projectDocuments(dir: string, maxPerFile = BRIEF_FILE_MAX): string {
  return ['AGENTS.md', 'README.md', 'package.json']
    .map((entry) => {
      const text = readInside(dir, entry, maxPerFile);
      return text === undefined || text.trim() === '' ? undefined : `<${entry}>\n${text.trim()}\n</${entry}>`;
    })
    .filter((part): part is string => part !== undefined)
    .join('\n\n');
}

/**
 * Everything one analysis is told about a project: its file hierarchy, plus whatever the three usual documents say.
 *
 * The tree is the material — every project has one — so a folder with no README is analysed like any other rather than
 * being declared unreadable. Only a folder with nothing in it at all produces nothing.
 */
export function projectBrief(dir: string, maxPerFile = BRIEF_FILE_MAX): string {
  const tree = projectTree(dir);
  const documents = projectDocuments(dir, maxPerFile);
  return [tree.length === 0 ? '' : `<tree>\n${tree.join('\n')}\n</tree>`, documents]
    .filter((part) => part !== '')
    .join('\n\n');
}

export const improveInputOk = (text: unknown): text is string =>
  typeof text === 'string' && text.trim() !== '' && text.length <= IMPROVE_INPUT_MAX;

/** The Improve prompt request: the draft first, then what the project is, then the shape the answer must have. */
export function improvePromptText(draft: string, brief: string): string {
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