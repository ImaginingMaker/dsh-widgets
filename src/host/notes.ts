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

/** The header a project summary is introduced with. */
export function briefNote(text: string, language: LanguageSetting): string {
  return language === 'zh'
    ? `本项目的背景（由插件在任务开始前整理，供你参考）：\n\n${text}`
    : `Background on this project (gathered by a plugin before the task started):\n\n${text}`;
}

/** True when one of these messages is already in the chat, so a note is never added twice. */
export const hasNote = (events: readonly { readonly type?: string; readonly data?: { readonly source?: { readonly kind?: string } } }[]): boolean =>
  events.some((event) => event?.type === 'user/message' && event.data?.source?.kind === NOTE_SOURCE);