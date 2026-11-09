import React from 'react';
import { isPlanKey, planKeyAction, planToggle } from '../kernel/plan.js';
import type { ComposerProps } from '../slot.js';

export interface PlanToggleProps extends ComposerProps {
  /** Turns plan mode on or off for this chat; answers a failure to show, or null. */
  readonly togglePlan?: (on: boolean) => Promise<string | null>;
}

/**
 * Shift+Tab toggles plan mode.
 *
 * A chat that already exists is toggled through dsh's own `plan` command — `/plan` enters the mode, `/plan off` leaves it —
 * so the composer's plan chip lights up straight away and the model never sees a stray `/plan` in the draft.
 *
 * A chat that has not started yet has no agent to command, so there the key falls back to writing `/plan ` at the head of
 * the draft: that message is the one that starts the plan-mode turn.
 */
export function PlanToggle({ useInput, inputActions, useProjection, togglePlan, notify }: PlanToggleProps): React.ReactElement {
  const draft = useInput((state) => (state === undefined ? '' : state.draft));
  const plan = typeof useProjection === 'function' ? useProjection('plan') : undefined;
  // The same effective target as dsh's own plan chip: a pending switch flips the folded host value.
  const planOn = plan !== undefined && (plan.pending === true ? plan.active !== true : plan.active === true);
  const hasSession = plan !== undefined;

  const live = React.useRef({ draft, inputActions, planOn, hasSession, togglePlan, notify });
  live.current = { draft, inputActions, planOn, hasSession, togglePlan, notify };
  const anchor = React.useRef<HTMLSpanElement | null>(null);

  React.useEffect(() => {
    const seat = anchor.current === null ? null : anchor.current.closest('[data-composer-seat]');
    if (seat === null) return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isPlanKey(event)) return;
      const target = event.target;
      const input = target instanceof Element ? target.closest<HTMLElement>('[data-composer-input]') : null;
      if (input === null || !input.isContentEditable || input.closest('[data-composer-seat]') !== seat) return;
      // Shift+Tab closes dsh's own slash menu; the menu keeps the key.
      if (seat.querySelector('[data-trigger-menu]') !== null) return;
      event.preventDefault();
      event.stopPropagation();

      const current = live.current;
      if (event.repeat || event.isComposing || event.keyCode === 229) return;

      const action = planKeyAction({ planActive: current.planOn, hasSession: current.hasSession });

      const insertPrefix = (): boolean => {
        if (current.inputActions === undefined) return false;
        const { start, end, text } = planToggle(current.draft);
        // Only the prefix is edited, so the rest of the draft, its file chips and its attachments stay intact.
        if (!current.inputActions.insertText(text, { ...current.inputActions.captureInsertion(), start, end })) return false;
        requestAnimationFrame(() => {
          if (!input.isConnected) return;
          const range = document.createRange();
          range.selectNodeContents(input);
          range.collapse(false);
          const selection = window.getSelection();
          if (selection === null) return;
          selection.removeAllRanges();
          selection.addRange(range);
        });
        return true;
      };

      if (action.kind === 'prefix' || current.togglePlan === undefined) {
        insertPrefix();
        return;
      }

      // A chat with no agent behind it cannot be toggled. That is not an error the user should read: it means this message
      // is the one that starts plan mode, so the draft prefix is the right fallback.
      current.togglePlan(action.line === '/plan off').then(
        (failure) => {
          if (failure === null) return;
          if (!insertPrefix()) current.notify?.('error', failure);
        },
        (reason: unknown) => {
          const message = reason instanceof Error ? reason.message : String(reason);
          if (!insertPrefix()) current.notify?.('error', message);
        },
      );
    };

    const listener = onKeyDown as unknown as EventListener;
    seat.addEventListener('keydown', listener, true);
    return () => { seat.removeEventListener('keydown', listener, true); };
    // The seat is looked up once per mount, exactly as the native listener is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return React.createElement('span', { ref: anchor, hidden: true, 'data-dsh-widgets-plan': '', 'aria-hidden': true });
}