/**
 * The prop shapes dsh's slot system hands a component. Declared here so the widgets read like they are typed against
 * dsh, without depending on a package whose version moves independently of the running app.
 */
import type { Translate } from './kernel/i18n.js';

export type UseStore = <T>(selector: (state: T) => unknown) => any;

export interface InputState {
  /** The editor's clipboard-text projection: what the user typed, with chips expanded. */
  readonly draft: string;
  /** Runtime-only ids of the images and files staged in the composer; dsh keeps the browser objects itself. */
  readonly attachmentIds?: readonly string[];
  /** Monotonic editor revision: a send or an edit changes it, even when the text happens to read the same. */
  readonly draftRev?: number;
  /** The submit plane. `plain` is the only phase in which the composer accepts new input. */
  readonly phase?: string;
}

/** One image the composer staged, serialized for the wire: base64 bytes and the media type dsh accepted. */
export interface DraftImage {
  readonly type: 'image';
  readonly mediaType: string;
  readonly data: string;
  readonly name?: string;
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
  readonly useInput: <T>(selector: (state: InputState | undefined) => T) => T;
  readonly inputActions?: InputActions;
  readonly useProjection?: (name: string) => { readonly active?: boolean; readonly pending?: boolean } | undefined;
  readonly sessionId?: string;
}

/** One `conversation.input.right` occupant that can stop the composer through dsh's own block registry. */
export interface ComposerLock {
  /** Raise the block; answers the release, or undefined when this dsh cannot block the composer. */
  (reason: string): (() => void) | undefined;
}
