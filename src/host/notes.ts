import { randomUUID } from 'node:crypto';
import type { LanguageSetting } from '../shared/types.js';

/** The source kind of a note this plugin adds to the model's view. */
export const NOTE_SOURCE = 'dsh-widgets-note';

export interface InjectedMessage {
  readonly id: string;
  readonly role: 'user';
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly source: { readonly kind: string; readonly form: 'snapshot' };
}

/**
 * One note as a model-visible user message. The shape is dsh's own: the same fields the host writes for a `/compact`
 * continuation, with a source kind that marks it as coming from this plugin rather than from the person typing.
 */
export function noteMessage(text: string): InjectedMessage {
  return Object.freeze({
    id: randomUUID(),
    role: 'user' as const,
    content: Object.freeze([Object.freeze({ type: 'text' as const, text })]),
    source: Object.freeze({ kind: NOTE_SOURCE, form: 'snapshot' as const }),
  });
}

/** How much of the file hierarchy one note carries: the summary is the point, the tree is the evidence for it. */
export const NOTE_TREE_LINES = 80;
export const NOTE_TREE_CHARS = 4000;

/** The file hierarchy as it appears in a note: bounded, with the cut made visible. */
export function clipTree(tree: string, lines = NOTE_TREE_LINES, maxChars = NOTE_TREE_CHARS): string {
  const kept = tree.split('\n').filter((line) => line !== '').slice(0, lines);
  let text = kept.join('\n');
  let truncated = false;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    const lastLine = text.lastIndexOf('\n');
    if (lastLine > 0) text = text.slice(0, lastLine);
    truncated = true;
  }
  const originalLines = tree.split('\n').filter((line) => line !== '');
  const complete = !truncated && kept.length === originalLines.length && text.length <= maxChars;
  return complete ? text : `${text}\n… (more entries omitted)`;
}

/**
 * One note carrying both the summary and the file hierarchy it was made from.
 *
 * The tree travels with the summary because a short description loses information the agent needs — where the code lives,
 * what the top-level units are — and the tree costs a fraction of what re-discovering it costs.
 */
export function briefNote(text: string, tree: string | undefined, language: LanguageSetting): string {
  const clipped = tree === undefined ? '' : clipTree(tree);
  const header = language === 'zh'
    ? '本项目的背景（由插件在任务开始前整理，供你参考）：'
    : 'Background on this project (gathered by a plugin before the task started):';
  const conclusion = language === 'zh' ? '结论' : 'summary';
  const structure = language === 'zh' ? '目录结构' : 'file hierarchy';
  const parts = [`${header}\n\n<${conclusion}>\n${text}\n</${conclusion}>`];
  if (clipped !== '') parts.push(`<${structure}>\n${clipped}\n</${structure}>`);
  return parts.join('\n\n');
}

/** True when one of these messages is already in the chat, so a note is never added twice. */
export const hasNote = (events: readonly { readonly type?: string; readonly data?: { readonly source?: { readonly kind?: string } } }[]): boolean =>
  events.some((event) => event?.type === 'user/message' && event.data?.source?.kind === NOTE_SOURCE);