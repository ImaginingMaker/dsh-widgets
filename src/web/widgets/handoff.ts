import React from 'react';
import { HANDOFF_PATH } from '../../shared/routes.js';
import type { HandoffResult } from '../../shared/handoff.js';
import { postJson } from '../kernel/hostJson.js';
import type { SlotBase } from '../slot.js';

/** One handoff includes a model summary plus session creation; give it more room than one Improve call. */
export const HANDOFF_TIMEOUT_MS = 120_000;

/**
 * A session moving to another: two composer boxes joined by a right arrow. Like every composer control it draws no box
 * of its own and inherits currentColor, so it sits beside the project-brief dot and the Improve wand.
 */
const HandoffIcon = (): React.ReactElement => React.createElement('svg', {
  viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none', 'aria-hidden': true,
},
React.createElement('rect', {
  x: 1.4, y: 3.2, width: 5.4, height: 9.6, rx: 1.4,
  stroke: 'currentColor', strokeWidth: 1.1,
}),
React.createElement('path', {
  d: 'M2.9 5.4h2.4M2.9 7.4h1.6',
  stroke: 'currentColor', strokeWidth: 0.95, strokeLinecap: 'round',
}),
React.createElement('path', {
  d: 'M7.4 8h4.9M10.4 5.9 12.6 8l-2.2 2.1',
  stroke: 'currentColor', strokeWidth: 1.15, strokeLinecap: 'round', strokeLinejoin: 'round',
}),
React.createElement('path', {
  d: 'M14.4 3.8v8.4',
  stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round',
}));

export interface HandoffButtonProps extends SlotBase {
  readonly sessionId?: string;
  /** Switch the UI to the session the Host created; best-effort, the prompt is already sent. */
  readonly openSession?: (sessionId: string) => Promise<void> | void;
}

/**
 * One click hands this session to a new session in the same project.
 *
 * The Host owns the whole operation: it reads the durable history, writes the handoff, creates the session in the same
 * workspace and sends the continuation prompt. This component only reports progress, reacts to success/failure, and
 * navigates once the new session exists.
 */
export function HandoffButton({ sessionId, openSession, notify, t }: HandoffButtonProps): React.ReactElement {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const alive = React.useRef(true);
  const request = React.useRef<AbortController | undefined>(undefined);

  React.useEffect(() => () => {
    alive.current = false;
    request.current?.abort();
  }, []);

  const run = async (): Promise<void> => {
    if (busy) return;
    if (sessionId === undefined) { notify?.('warn', t('handoff.empty')); return; }
    setBusy(true);
    setError(undefined);
    const controller = new AbortController();
    request.current = controller;
    let guardTimer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<never>((_, reject) => {
      guardTimer = setTimeout(() => {
        controller.abort();
        reject(new Error(t('handoff.failed', { error: 'timed out' })));
      }, HANDOFF_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([postJson<HandoffResult>(HANDOFF_PATH, { sessionId }, controller.signal), guard]);
      if (!alive.current) return;
      notify?.('info', t('handoff.done'));
      try {
        await openSession?.(result.sessionId);
      } catch {
        notify?.('error', t('handoff.openFailed', { sessionId: result.sessionId }));
      }
    } catch (failure) {
      if (!alive.current) return;
      const message = String((failure as Error)?.message ?? failure);
      setError(message);
      notify?.('error', t('handoff.failed', { error: message }));
    } finally {
      if (guardTimer !== undefined) clearTimeout(guardTimer);
      if (request.current === controller) request.current = undefined;
      if (alive.current) setBusy(false);
    }
  };

  return React.createElement('span', { 'data-dsh-widgets-handoff-wrap': '', style: { display: 'inline-flex', alignItems: 'center', gap: 2 } },
    React.createElement('button', {
      type: 'button',
      className: 'dw-btn',
      title: busy ? t('handoff.working') : t('handoff.title'),
      'aria-label': busy ? t('handoff.working') : t('handoff.title'),
      'aria-busy': busy,
      'data-dsh-widgets-handoff': '',
      'data-dsh-widgets-handoff-working': busy ? '' : undefined,
      disabled: busy || sessionId === undefined,
      onClick: run,
    }, React.createElement(HandoffIcon)),
    error === undefined ? null : React.createElement('span', { role: 'alert', className: 'dw-error' }, error));
}