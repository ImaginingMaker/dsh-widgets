import React from 'react';
import { IMPROVE_PATH } from '../../shared/routes.js';
import type { SettingsView } from '../kernel/settingsStore.js';
import { postJson } from '../kernel/hostJson.js';
import type { ComposerProps, InputActions } from '../slot.js';

const WandIcon = (): React.ReactElement => React.createElement('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true },
  React.createElement('path', {
    d: 'M9.5 2.5 11 1l1.5 1.5L11 4 9.5 2.5ZM3 13l6.5-6.5 1 1L4 14l-1-1Zm7.5-6.5L12 5l1 1-1.5 1.5-1-1Z',
    fill: 'currentColor',
  }));

export interface ImproveButtonProps extends ComposerProps {
  readonly inputActions?: InputActions;
  /** The live settings store: the model and effort are read at click time, not at mount time. */
  readonly store?: { getSnapshot(): SettingsView };
  readonly chatProvider?: string;
  readonly chatModel?: string;
}

/**
 * The magic wand: one model call rewrites the draft, which is replaced but never sent. The model and the reasoning effort
 * come from the user's settings, read when the wand is pressed so a choice made since the chat opened still applies.
 */
export function ImproveButton({ sessionId, useInput, inputActions, store, chatProvider, chatModel, notify, t }: ImproveButtonProps): React.ReactElement {
  const draft = useInput((state) => (state === undefined ? '' : state.draft));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [undone, setUndone] = React.useState<string | undefined>(undefined);

  const live = React.useRef({ draft, chatProvider, chatModel });
  live.current = { draft, chatProvider, chatModel };

  const run = async (): Promise<void> => {
    if (busy) return;
    const current = live.current;
    if (current.draft.trim() === '') { notify?.('warn', t('improve.empty')); return; }
    setBusy(true);
    setError(undefined);
    try {
      const settings = store?.getSnapshot();
      const chosen = settings?.improve?.model ?? null;
      const body: Record<string, unknown> = {
        sessionId,
        text: current.draft,
        provider: chosen?.provider ?? current.chatProvider,
        model: chosen?.model ?? current.chatModel,
      };
      const effort = settings?.improve?.effort;
      if (effort !== null && effort !== undefined) body.effort = effort;
      const value = await postJson<{ text: string }>(IMPROVE_PATH, body);
      setUndone(current.draft);
      inputActions?.setDraft(value.text);
    } catch (failure) {
      const message = String((failure as Error)?.message ?? failure);
      setError(message);
      notify?.('error', t('improve.failed', { error: message }));
    } finally {
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
      disabled: busy || chatProvider === undefined || chatModel === undefined,
      onClick: run,
    }, React.createElement(WandIcon)),
    undone === undefined ? null : React.createElement('button', {
      type: 'button',
      className: 'dw-btn',
      title: t('improve.undo'),
      'aria-label': t('improve.undo'),
      'data-dsh-widgets-undo': '',
      onClick: () => { inputActions?.setDraft(undone); setUndone(undefined); },
    }, '↺'),
    error === undefined ? null : React.createElement('span', { role: 'alert', style: { fontSize: 11, color: 'var(--dsw-alias-state-warn-label,#b25000)' } }, error));
}