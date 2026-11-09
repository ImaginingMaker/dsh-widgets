import React from 'react';
import { BRIEF_PATH } from '../../shared/routes.js';
import type { BriefView } from '../../shared/types.js';
import { hostJson, postJson } from '../kernel/hostJson.js';
import type { Translate } from '../kernel/i18n.js';

/** How often the composer asks whether the quiet read has finished. */
export const BRIEF_POLL_MS = 1500;
/** Give up polling after this long; the icon then keeps whatever the Host last said. */
export const BRIEF_POLL_MAX = 60_000;

const BookIcon = ({ spinning }: { readonly spinning: boolean }): React.ReactElement => React.createElement('svg', {
  viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', 'aria-hidden': true,
  className: spinning ? 'dw-brief-spin' : undefined,
}, React.createElement('path', {
  d: spinning ? 'M8 1.8a6.2 6.2 0 1 1-6.2 6.2' : 'M2.5 3.2h4a1.5 1.5 0 0 1 1.5 1.5v8.1a1.2 1.2 0 0 0-1.2-1.2H2.5V3.2Zm11 0h-4A1.5 1.5 0 0 0 8 4.7v8.1a1.2 1.2 0 0 1 1.2-1.2h4.3V3.2Z',
  stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round', strokeLinecap: 'round',
}));

/** A small circular arrow: enough to read "this does something" without a second label. */
const RetryIcon = (): React.ReactElement => React.createElement('svg', {
  viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', 'aria-hidden': true,
}, React.createElement('path', {
  d: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.4v2.8h-2.8',
  stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
}));

const Dot = ({ tone }: { readonly tone: 'ready' | 'failed' }): React.ReactElement => React.createElement('span', {
  className: 'dw-brief-dot',
  style: { background: tone === 'failed' ? 'var(--dsw-alias-state-warn-label, #b25000)' : 'var(--dsw-alias-state-success-label, #2f8f4e)' },
});

export interface BriefStatusProps {
  readonly sessionId?: string;
  readonly t: Translate;
  readonly notify?: (level: 'info' | 'warn' | 'error', text: string) => void;
}

/**
 * The quiet project read, shown as one small control beside the composer.
 *
 * It is deliberately unobtrusive: while the read runs it spins, when it lands it shows a dot whose tooltip is the summary,
 * and when it fails it shows why and offers a retry. It never blocks sending — a chat that goes out before the read
 * finishes simply goes without the summary.
 */
export function BriefStatus({ sessionId, t, notify }: BriefStatusProps): React.ReactElement | null {
  const [view, setView] = React.useState<BriefView | undefined>(undefined);
  const [open, setOpen] = React.useState(false);
  const alive = React.useRef(true);
  React.useEffect(() => () => { alive.current = false; }, []);

  const ask = React.useCallback(async (retry: boolean): Promise<void> => {
    if (sessionId === undefined) return;
    try {
      const value = retry
        ? await postJson<BriefView>(BRIEF_PATH, { sessionId, retry: true })
        : await hostJson<BriefView>(`${BRIEF_PATH}?${new URLSearchParams({ sessionId })}`);
      if (alive.current) setView(value);
    } catch (failure) {
      if (alive.current) setView({ status: 'failed', error: String((failure as Error)?.message ?? failure) });
    }
  }, [sessionId]);

  React.useEffect(() => { void ask(false); }, [ask]);

  // A popover that only closes by pressing its own trigger is a trap. Clicking anywhere else, or Escape, closes it — and
  // the check is against the DOM, not a ref, so it keeps working when the panel is rendered outside this subtree.
  React.useEffect(() => {
    if (!open) return undefined;
    const inside = (target: unknown): boolean => {
      const element = target as { closest?(selector: string): unknown } | null;
      if (element?.closest === undefined) return false;
      try { return element.closest('.dw-brief') !== null; } catch { return false; }
    };
    const onPointer = (event: { target?: unknown }): void => { if (!inside(event.target)) setOpen(false); };
    const onKey = (event: { key?: string }): void => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Poll only while a read is in flight, and stop on its own so an abandoned page does not keep asking.
  const status = view?.status;
  React.useEffect(() => {
    if (status !== 'analyzing') return undefined;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > BRIEF_POLL_MAX) { clearInterval(timer); return; }
      void ask(false);
    }, BRIEF_POLL_MS);
    return () => clearInterval(timer);
  }, [status, ask]);

  if (view === undefined || view.status === 'idle') return null;

  const label = view.status === 'analyzing' ? t('brief.analyzing')
    : view.status === 'ready' ? t('brief.ready')
      : t('brief.failed', { error: view.error ?? '' });

  return React.createElement('span', { className: 'dw-brief', style: { position: 'relative' } },
    React.createElement('button', {
      type: 'button', className: 'dw-btn', 'data-dsh-widgets-brief': view.status,
      title: view.status === 'failed' ? `${label} — ${t('brief.retry')}` : label,
      'aria-label': label, 'aria-busy': view.status === 'analyzing',
      'aria-expanded': view.status === 'ready' ? open : undefined,
      'aria-haspopup': view.status === 'ready' ? 'dialog' : undefined,
      onClick: () => {
        if (view.status === 'failed') { void ask(true); return; }
        setOpen(!open);
      },
    },
    view.status === 'analyzing' ? React.createElement(BookIcon, { spinning: true })
      : view.status === 'ready' ? React.createElement(Dot, { tone: 'ready' })
        : React.createElement(Dot, { tone: 'failed' })),
    view.status === 'ready' && open
      ? React.createElement('div', {
        role: 'dialog', 'data-dsh-widgets-brief-panel': '', className: 'dw-panel',
        'aria-label': t('brief.ready'), style: { bottom: 28, right: 0, width: 340, maxWidth: '80vw' },
      },
      React.createElement('div', { className: 'dw-panel-head' }, t('brief.preview')),
      React.createElement('div', { className: 'dw-panel-body' }, view.text ?? ''),
      React.createElement('button', {
        type: 'button', className: 'dw-action', 'data-dsh-widgets-reanalyze': '',
        onClick: () => { setOpen(false); void ask(true); },
      }, React.createElement(RetryIcon), t('brief.reanalyze')))
      : null,
  );
}