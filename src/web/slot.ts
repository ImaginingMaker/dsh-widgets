/**
 * The prop shapes dsh's slot system hands a component. Declared here so the widgets read like they are typed against
 * dsh, without depending on a package whose version moves independently of the running app.
 */
import type { Translate } from './kernel/i18n.js';

export type UseStore = <T>(selector: (state: T) => unknown) => any;

export interface InputState {
  readonly draft: string;
}

export interface InputActions {
  insertText(text: string, spec: { start: number; end: number; draftRev?: number }): boolean;
  captureInsertion(): { start: number; end: number; draftRev?: number };
  setDraft(text: string): void;
}

export interface Notify {
  (level: 'info' | 'warn' | 'error', text: string): void;
}

/** What every slot occupant can count on. */
export interface SlotBase {
  readonly t: Translate;
  readonly notify?: Notify;
}

export interface ComposerProps extends SlotBase {
  readonly useInput: (selector: (state: InputState | undefined) => string) => string;
  readonly inputActions?: InputActions;
  readonly useProjection?: (name: string) => { readonly active?: boolean; readonly pending?: boolean } | undefined;
  readonly sessionId?: string;
}

export interface QueueProps extends SlotBase {
  readonly sessionId: string;
  readonly useProjection: (name: string) => readonly unknown[] | undefined;
  readonly settings: unknown;
}