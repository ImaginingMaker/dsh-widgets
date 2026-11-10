import { noteMessage, hasNote, briefNote } from './notes.js';
import type { BriefRecord } from './briefStore.js';
import { briefSignature } from '../shared/brief.js';
import type { LanguageSetting } from '../shared/types.js';
import type { HostContext } from './context.js';
import { projectDirOf } from './project.js';
import type { SettingsStore } from './store.js';
import { signatureOf } from './briefStore.js';

/** One chat is prepared once; a second step must not repeat the notes. */
const handled = new Set<string>();
export const HANDLED_MAX = 2000;

export interface PreStepDeps {
  readonly store: SettingsStore;
  readonly briefOf: (dir: string) => Promise<{ record?: BriefRecord; signature: string }>;
  readonly language: () => LanguageSetting;
  readonly log?: (message: string) => void;
}

/** The prefix the chat's first request carries. */
export interface Preparation {
  readonly note?: string;
}

/**
 * The one place a chat is prepared: the project summary gathered ahead of time, if it is fresh and switched on.
 *
 * It is a *prompt*: nothing about the task is scripted here, and a chat whose summary is missing or stale is exactly the
 * chat dsh would have run.
 */
export async function prepareChat(
  ctx: HostContext,
  deps: PreStepDeps,
  sessionId: string,
): Promise<Preparation> {
  const settings = deps.store.read();
  const dir = await projectDirOf(ctx, { sessionId });
  const notes: string[] = [];

  if (settings.on.projectBrief === true && dir !== undefined) {
    const { record, signature } = await deps.briefOf(dir);
    // Only a summary that was made from the project as it is now, and that is finished, may open the chat. A read still in
    // flight is never waited for: the task starts either way.
    if (record !== undefined && record.status === 'ready' && record.text !== undefined && record.text.trim() !== '' && record.signature === signature) {
      // The summary and the hierarchy it was made from travel together.
      notes.push(briefNote(record.text, record.tree, deps.language()));
    }
  }

  const note = notes.filter((entry) => entry !== '').join('\n\n');
  return note === '' ? {} : { note };
}

/**
 * Register the hook. It answers the step unchanged whenever there is nothing to say, so a chat with no project summary is
 * exactly the chat dsh would have run.
 */
export function installPreStep(ctx: HostContext, deps: PreStepDeps): void {
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind !== 'enter') return decision;
    const sessionId = String(payload?.agent?.id ?? '');
    if (sessionId === '' || handled.has(sessionId)) return decision;
    try {
      const preparation = await prepareChat(ctx, deps, sessionId);
      if (handled.size > HANDLED_MAX) handled.clear();
      handled.add(sessionId);
      if (preparation.note === undefined) return decision;
      return { ...decision, messages: [noteMessage(preparation.note), ...decision.messages] };
    } catch (error) {
      deps.log?.(`dsh-widgets: could not prepare the chat: ${String((error as Error)?.message ?? error)}`);
      handled.add(sessionId);
      return decision;
    }
  }, true);
}

/** Tests only: forget which chats were prepared. */
export const resetPrepared = (): void => { handled.clear(); };

export { hasNote, briefSignature };