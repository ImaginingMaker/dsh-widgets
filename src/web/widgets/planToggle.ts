import React from 'react';
import { isPlanKey, planToggle } from '../kernel/plan.js';
import type { ComposerProps } from '../slot.js';

export interface PlanToggleProps extends ComposerProps {
  /** Leaves plan mode through dsh's own `/plan off`; answers a failure to show, or null. */
  readonly exitPlanMode?: () => Promise<string | null>;
}

/**
 * Shift+Tab toggles the draft's `/plan` prefix, or leaves plan mode through dsh's own command. It rides the composer's
 * right slot because, unlike the dock, that slot also renders on a blank chat.
 */
export function PlanToggle({ useInput, inputActions, useProjection, exitPlanMode, notify }: PlanToggleProps): React.ReactElement {
  const draft = useInput((state) => (state === undefined ? '' : state.draft));
  const plan = typeof useProjection === 'function' ? useProjection('plan') : undefined;
  // The same effective target as dsh's own plan chip: a pending switch flips the folded host value.
  const planOn = plan !== undefined && (plan.pending ? !plan.active : plan.active);

  const live = React.useRef({ draft, inputActions, planOn, exitPlanMode, notify });
  live.current = { draft, inputActions, planOn, exitPlanMode, notify };
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

      if (current.planOn && current.exitPlanMode !== undefined) {
        current.exitPlanMode().then(
          (failure) => { if (failure !== null) current.notify?.('error', failure); },
          (reason: unknown) => current.notify?.('error', reason instanceof Error ? reason.message : String(reason)),
        );
        return;
      }
      if (current.inputActions === undefined) return;

      const { start, end, text } = planToggle(current.draft);
      // Only the prefix is edited, so the rest of the draft, its file chips and its attachments stay intact.
      if (!current.inputActions.insertText(text, { ...current.inputActions.captureInsertion(), start, end })) return;

      // Lexical commits the edit and its caret asynchronously; move the caret after that commit.
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
    };

    const listener = onKeyDown as unknown as EventListener;
    seat.addEventListener('keydown', listener, true);
    return () => { seat.removeEventListener('keydown', listener, true); };
    // The seat is looked up once per mount, exactly as the native listener is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return React.createElement('span', { ref: anchor, hidden: true, 'data-dsh-widgets-plan': '', 'aria-hidden': true });
}