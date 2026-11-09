import React from 'react';
import { IMPROVE_PATH } from '../../shared/routes.js';
import type { SettingsView } from '../kernel/settingsStore.js';
import { postJson } from '../kernel/hostJson.js';
import type { ComposerProps, DraftImage, InputActions } from '../slot.js';

/** How long one optimisation may take before the composer is handed back. */
export const IMPROVE_TIMEOUT_MS = 60_000;

/** The composer element dsh renders; the plugin only ever reads it, to mark it while a call is in flight. */
const BUSY_ATTR = 'data-dsh-widgets-busy';

/**
 * A sparkle wand, drawn to sit beside dsh's own composer icons: no border, no fill, one stroke weight, currentColor.
 * Three separate marks read as "polish this" rather than as a tool with a handle.
 */
const SparkleIcon = (): React.ReactElement => React.createElement('svg', {
  viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', 'aria-hidden': true,
},
React.createElement('path', {
  d: 'M9.6 2.1 10.7 4.9 13.5 6 10.7 7.1 9.6 9.9 8.5 7.1 5.7 6 8.5 4.9 9.6 2.1Z',
  stroke: 'currentColor', strokeWidth: 1.15, strokeLinejoin: 'round',
}),
React.createElement('path', {
  d: 'M3.9 9.2 4.5 10.6 5.9 11.2 4.5 11.8 3.9 13.2 3.3 11.8 1.9 11.2 3.3 10.6 3.9 9.2Z',
  stroke: 'currentColor', strokeWidth: 1.05, strokeLinejoin: 'round',
}),
React.createElement('path', {
  d: 'M5.3 1.9v2.2M4.2 3h2.2M12.4 11.2v1.6M11.6 12h1.6',
  stroke: 'currentColor', strokeWidth: 1.05, strokeLinecap: 'round',
}));

export interface ImproveButtonProps extends ComposerProps {
  readonly inputActions?: InputActions;
  /** The live settings store: the model and effort are read at click time, not at mount time. */
  readonly store?: { getSnapshot(): SettingsView };
  /**
   * Turns the composer's staged images into wire parts, so the model sees what the user attached, not only what they
   * typed. Absent or failing, the draft is still improved — just as text.
   */
  readonly serializeAttachments?: (ids: readonly string[]) => Promise<readonly DraftImage[]>;
}

/**
 * One model call rewrites the draft, which is replaced but never sent. The model comes from the plugin's single analysis
 * setting — read when the wand is pressed, so a choice made since the chat opened still applies.
 */
export function ImproveButton({ sessionId, useInput, inputActions, store, serializeAttachments, notify, t }: ImproveButtonProps): React.ReactElement {
  const draft = useInput((state) => (state === undefined ? '' : state.draft));
  const attachmentIds = useInput((state) => (state === undefined ? [] : (state.attachmentIds ?? [])));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [undone, setUndone] = React.useState<string | undefined>(undefined);

  const live = React.useRef({ draft, attachmentIds });
  live.current = { draft, attachmentIds };

  /**
   * The undo is for a draft that is still there. Once the message is sent — or the box is cleared — there is nothing to
   * put back, and a button that silently refills a sent chat is worse than no button at all.
   */
  React.useEffect(() => {
    if (draft.trim() === '' && undone !== undefined) setUndone(undefined);
  }, [draft, undone]);

  /**
   * While the call runs the composer itself is locked: the editor is dimmed and stops taking input, so the text the model
   * is rewriting cannot change under it. Everything is restored when the call settles, including on failure.
   */
  React.useEffect(() => {
    if (!busy) return undefined;
    const seat = (() => {
      try { return document.querySelector('[data-composer-seat]') as HTMLElement | null; } catch { return null; }
    })();
    if (seat?.setAttribute !== undefined) seat.setAttribute(BUSY_ATTR, '');
    const swallow = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Tab' || event.key.startsWith('Arrow') === true) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const swallowInput = (event: Event): void => { event.preventDefault(); event.stopPropagation(); };
    seat?.addEventListener?.('keydown', swallow, true);
    seat?.addEventListener?.('beforeinput', swallowInput, true);
    seat?.addEventListener?.('paste', swallowInput, true);
    seat?.addEventListener?.('drop', swallowInput, true);
    return () => {
      seat?.removeAttribute?.(BUSY_ATTR);
      seat?.removeEventListener?.('keydown', swallow, true);
      seat?.removeEventListener?.('beforeinput', swallowInput, true);
      seat?.removeEventListener?.('paste', swallowInput, true);
      seat?.removeEventListener?.('drop', swallowInput, true);
    };
  }, [busy]);

  /** The images staged in the composer, as wire parts. A failure here costs the images, never the optimisation. */
  const images = async (ids: readonly string[]): Promise<readonly DraftImage[]> => {
    if (ids.length === 0 || serializeAttachments === undefined) return [];
    try {
      return await serializeAttachments(ids);
    } catch {
      notify?.('warn', t('improve.imagesSkipped'));
      return [];
    }
  };

  const run = async (): Promise<void> => {
    if (busy) return;
    const current = live.current;
    if (current.draft.trim() === '') { notify?.('warn', t('improve.empty')); return; }
    setBusy(true);
    setError(undefined);
    // A hung call must not leave the composer locked for the rest of the session. The timer is cleared on every exit,
    // or a page that finished optimising would keep a pending timer alive for a minute.
    let guardTimer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<never>((_, reject) => {
      guardTimer = setTimeout(() => reject(new Error(t('improve.timeout'))), IMPROVE_TIMEOUT_MS);
    });
    try {
      const settings = store?.getSnapshot();
      const chosen = settings?.analysis?.model ?? null;
      const attached = await images(current.attachmentIds ?? []);
      const body: Record<string, unknown> = {
        sessionId,
        text: current.draft,
        // Only a model pinned for this plugin travels; "same as the chat" is resolved by the Host, which can see it.
        provider: chosen?.provider,
        model: chosen?.model,
      };
      if (attached.length > 0) body.attachments = attached;
      const effort = settings?.analysis?.effort;
      if (effort !== null && effort !== undefined) body.effort = effort;
      const value = await Promise.race([postJson<{ text: string }>(IMPROVE_PATH, body), guard]);
      setUndone(current.draft);
      inputActions?.setDraft(value.text);
    } catch (failure) {
      const message = String((failure as Error)?.message ?? failure);
      setError(message);
      notify?.('error', t('improve.failed', { error: message }));
    } finally {
      if (guardTimer !== undefined) clearTimeout(guardTimer);
      setBusy(false);
    }
  };

  return React.createElement('span', { 'data-dsh-widgets-improve': '', style: { display: 'inline-flex', alignItems: 'center', gap: 2 } },
    React.createElement('button', {
      type: 'button',
      className: 'dw-btn',
      title: t('improve.title'),
      'aria-label': t('improve.title'),
      'aria-busy': busy,
      'data-dsh-widgets-wand': '',
      'data-dsh-widgets-working': busy ? '' : undefined,
      // A dead button is worse than a failed request: if no model can be resolved the Host says so, in words, when the
      // user clicks. Nothing here may depend on the client being able to see the chat's model.
      disabled: busy,
      onClick: run,
    }, React.createElement(SparkleIcon)),
    undone === undefined ? null : React.createElement('button', {
      type: 'button',
      className: 'dw-btn',
      title: t('improve.undo'),
      // The undo belongs to a draft; a sent chat has none.
      'data-dsh-widgets-undo-draft': '',
      'aria-label': t('improve.undo'),
      'data-dsh-widgets-undo': '',
      onClick: () => { inputActions?.setDraft(undone); setUndone(undefined); },
    }, '↺'),
    error === undefined ? null : React.createElement('span', { role: 'alert', className: 'dw-error' }, error));
}