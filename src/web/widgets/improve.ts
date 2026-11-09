import React from 'react';
import { IMPROVE_PATH } from '../../shared/routes.js';
import type { SettingsView } from '../kernel/settingsStore.js';
import { postJson } from '../kernel/hostJson.js';
import type { ComposerProps, InputActions } from '../slot.js';

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
  readonly chatProvider?: string;
  readonly chatModel?: string;
}

/**
 * One model call rewrites the draft, which is replaced but never sent. The model comes from the plugin's single analysis
 * setting — read when the wand is pressed, so a choice made since the chat opened still applies.
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
      const chosen = settings?.analysis?.model ?? null;
      const body: Record<string, unknown> = {
        sessionId,
        text: current.draft,
        provider: chosen?.provider ?? current.chatProvider,
        model: chosen?.model ?? current.chatModel,
      };
      const effort = settings?.analysis?.effort;
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
    }, React.createElement(SparkleIcon)),
    undone === undefined ? null : React.createElement('button', {
      type: 'button',
      className: 'dw-btn',
      title: t('improve.undo'),
      'aria-label': t('improve.undo'),
      'data-dsh-widgets-undo': '',
      onClick: () => { inputActions?.setDraft(undone); setUndone(undefined); },
    }, '↺'),
    error === undefined ? null : React.createElement('span', { role: 'alert', className: 'dw-error' }, error));
}