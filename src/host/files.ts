import { closeSync, constants as fsConstants, openSync, readSync, realpathSync, statSync } from 'node:fs';
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

/** A short, read-only description of the project for the Improve prompt call. */
export function projectBrief(dir: string, maxPerFile = BRIEF_FILE_MAX): string {
  return ['AGENTS.md', 'README.md', 'package.json']
    .map((entry) => {
      const text = readInside(dir, entry, maxPerFile);
      return text === undefined || text.trim() === '' ? undefined : `<${entry}>\n${text.trim()}\n</${entry}>`;
    })
    .filter((part): part is string => part !== undefined)
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