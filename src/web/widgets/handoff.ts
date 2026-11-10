import React from 'react';
import { HANDOFF_PATH } from '../../shared/routes.js';
import type { HandoffResult, HandoffStatus, HandoffTimings } from '../../shared/handoff.js';
import { hostJson, postJson } from '../kernel/hostJson.js';
import type { SlotBase } from '../slot.js';

/** One handoff includes a model summary plus session creation; give it more room than one Improve call. */
export const HANDOFF_TIMEOUT_MS = 120_000;
/** How often the composer asks whether a handoff it did not start has finished. */
export const HANDOFF_POLL_MS = 1_000;
/** Give up polling after this long; the state then stays whatever the Host last said. */
export const HANDOFF_POLL_MAX = 150_000;

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

const secondsOf = (timings: HandoffTimings | undefined): string | undefined => {
  if (timings === undefined || !Number.isFinite(timings.totalMs) || timings.totalMs < 0) return undefined;
  return (timings.totalMs / 1000).toFixed(1);
};

/**
 * One click hands this session to a new session in the same project.
 *
 * The Host owns the whole operation: it reads the durable history, writes the handoff, creates the session in the same
 * workspace and sends the continuation prompt. This component reports progress, reacts to success/failure, and navigates
 * once the new session exists.
 *
 * It also *recovers* the operation. A handoff outlives the page that started it, so on mount — and after switching back
 * from another session — the component asks the Host what became of this session's handoff: still running, done (with the
 * new session's id, so it can be opened), or failed (with its reason, so it can be retried).
 */
export function HandoffButton({ sessionId, openSession, notify, t }: HandoffButtonProps): React.ReactElement {
  const [view, setView] = React.useState<HandoffStatus>({ status: 'idle' });
  const alive = React.useRef(true);
  const request = React.useRef<AbortController | undefined>(undefined);
  /** What this mounted widget has seen, so recovering a finished handoff does not announce it twice. */
  const seen = React.useRef<{ running: boolean; announced?: string }>({ running: false });
  // The injection is re-created when the session changes; reading it through a ref keeps `refresh` stable.
  const latest = React.useRef({ sessionId, notify, t });
  latest.current = { sessionId, notify, t };

  React.useEffect(() => () => {
    alive.current = false;
    request.current?.abort();
  }, []);

  const refresh = React.useCallback(async (): Promise<void> => {
    const { sessionId: id, notify: say, t: tr } = latest.current;
    if (id === undefined) return;
    try {
      const value = await hostJson<HandoffStatus>(`${HANDOFF_PATH}?${new URLSearchParams({ sessionId: id }).toString()}`);
      if (!alive.current) return;
      setView(value);
      if (value.status === 'running') seen.current.running = true;
      // A handoff this page did not start still deserves one notice when it lands.
      if (value.status === 'done' && seen.current.running && value.newSessionId !== undefined && seen.current.announced !== value.newSessionId) {
        seen.current.announced = value.newSessionId;
        say?.('info', tr('handoff.done'));
      }
    } catch { /* the last known state stands */ }
  }, []);

  // Recovery: ask once per session, then let the poll below take over while a handoff runs.
  React.useEffect(() => {
    seen.current = { running: false };
    setView({ status: 'idle' });
    if (sessionId !== undefined) void refresh();
  }, [sessionId, refresh]);

  React.useEffect(() => {
    if (view.status !== 'running') return undefined;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > HANDOFF_POLL_MAX) { clearInterval(timer); return; }
      void refresh();
    }, HANDOFF_POLL_MS);
    return () => clearInterval(timer);
  }, [view.status, refresh]);

  const run = async (): Promise<void> => {
    const { sessionId: id, notify: say, t: tr } = latest.current;
    if (view.status === 'running') return;
    if (id === undefined) { say?.('warn', tr('handoff.empty')); return; }
    seen.current = { running: true, ...(view.newSessionId === undefined ? {} : { announced: view.newSessionId }) };
    setView({ status: 'running', startedAt: Date.now() });
    const controller = new AbortController();
    request.current = controller;
    let guardTimer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<never>((_, reject) => {
      guardTimer = setTimeout(() => {
        controller.abort();
        reject(new Error(tr('handoff.timedOut')));
      }, HANDOFF_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([postJson<HandoffResult>(HANDOFF_PATH, { sessionId: id }, controller.signal), guard]);
      if (!alive.current) return;
      setView({ ...result, status: 'done', newSessionId: result.sessionId, finishedAt: result.finishedAt ?? Date.now() });
      seen.current.announced = result.sessionId;
      say?.('info', tr('handoff.done'));
      try {
        await openSession?.(result.sessionId);
      } catch {
        say?.('error', tr('handoff.openFailed', { sessionId: result.sessionId }));
      }
    } catch (failure) {
      if (!alive.current) return;
      const message = String((failure as Error)?.message ?? failure);
      setView({ status: 'failed', error: message });
      say?.('error', tr('handoff.failed', { error: message }));
    } finally {
      if (guardTimer !== undefined) clearTimeout(guardTimer);
      if (request.current === controller) request.current = undefined;
    }
  };

  const open = async (): Promise<void> => {
    const target = view.newSessionId;
    if (target === undefined) return;
    try {
      await openSession?.(target);
    } catch {
      notify?.('error', t('handoff.openFailed', { sessionId: target }));
    }
  };

  const dismiss = async (): Promise<void> => {
    const id = latest.current.sessionId;
    if (id !== undefined) {
      try { await postJson(HANDOFF_PATH, { sessionId: id, dismiss: true }); } catch { /* keep it on screen */ }
    }
    if (alive.current) setView({ status: 'idle' });
  };

  /** A host-side error arrives in English; the two the user can meet have their own words. */
  const messageOf = (error: string | undefined): string => {
    if (error === 'the previous handoff was interrupted') return t('handoff.interrupted');
    if (error === 'the handoff timed out') return t('handoff.timedOut');
    return error ?? '';
  };

  const busy = view.status === 'running';
  const elapsed = busy && view.startedAt !== undefined ? Math.max(0, Math.round((Date.now() - view.startedAt) / 1000)) : undefined;
  const seconds = secondsOf(view.timings);
  const error = view.status === 'failed' ? messageOf(view.error) : undefined;

  if (view.status === 'done') {
    const label = `${t('handoff.completed')}${seconds === undefined ? '' : ` · ${t('handoff.seconds', { seconds })}`}`;
    return React.createElement('span', {
      'data-dsh-widgets-handoff-wrap': '',
      'data-dsh-widgets-handoff-state': 'done',
      style: { display: 'inline-flex', alignItems: 'center', gap: 2 },
    },
    React.createElement('button', {
      type: 'button',
      className: 'dw-handoff-done',
      'data-dsh-widgets-handoff': '',
      'data-dsh-widgets-handoff-open': '',
      title: view.title === undefined ? t('handoff.open') : `${t('handoff.open')} · ${view.title}`,
      'aria-label': t('handoff.open'),
      onClick: () => open(),
    }, label),
    React.createElement('button', {
      type: 'button',
      className: 'dw-btn dw-handoff-dismiss',
      'data-dsh-widgets-handoff-dismiss': '',
      'aria-label': t('handoff.dismiss'),
      title: t('handoff.dismiss'),
      onClick: () => dismiss(),
    }, '×'));
  }

  const title = busy
    ? (elapsed === undefined ? t('handoff.working') : t('handoff.elapsed', { seconds: String(elapsed) }))
    : error === undefined ? t('handoff.title') : t('handoff.failed', { error });

  return React.createElement('span', {
    'data-dsh-widgets-handoff-wrap': '',
    'data-dsh-widgets-handoff-state': busy ? 'running' : error === undefined ? 'idle' : 'failed',
    style: { display: 'inline-flex', alignItems: 'center', gap: 2 },
  },
  React.createElement('button', {
    type: 'button',
    className: 'dw-btn',
    title,
    'aria-label': title,
    'aria-busy': busy,
    'data-dsh-widgets-handoff': '',
    'data-dsh-widgets-handoff-working': busy ? '' : undefined,
    disabled: busy || sessionId === undefined,
    onClick: () => run(),
  }, React.createElement(HandoffIcon)),
  error === undefined ? null : React.createElement('span', { role: 'alert', className: 'dw-error' }, error));
}