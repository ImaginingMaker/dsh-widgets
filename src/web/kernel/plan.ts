/** `/plan` at the very start (so `/planning` is not the command) plus at most one following space or tab. */
export const PLAN_PREFIX = /^\/plan(?=$|\s)[ \t]?/;

export interface PlanEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Shift+Tab edit: drop a leading `/plan` command, otherwise prepend one. */
export function planToggle(draft: string): PlanEdit {
  const match = PLAN_PREFIX.exec(draft);
  return match === null ? { start: 0, end: 0, text: '/plan ' } : { start: 0, end: match[0].length, text: '' };
}

/**
 * What Shift+Tab should do.
 *
 * dsh's own `plan` command is `Enter or leave plan mode`: `/plan` with no argument switches the session into plan mode,
 * `/plan off` leaves it. So a chat that already exists is toggled through that command — writing `/plan` into the draft
 * would only put text in the box and leave the mode chip dark.
 *
 * A brand-new chat has no agent yet, so no command can run. There the only honest option is the draft prefix: the message
 * that gets sent starts with `/plan` and the host enters plan mode for it.
 */
export type PlanKeyAction =
  | { readonly kind: 'command'; readonly line: '/plan' | '/plan off' }
  | { readonly kind: 'prefix' };

export function planKeyAction(input: { readonly planActive: boolean; readonly hasSession: boolean }): PlanKeyAction {
  if (input.planActive) return { kind: 'command', line: '/plan off' };
  if (input.hasSession) return { kind: 'command', line: '/plan' };
  return { kind: 'prefix' };
}

/** Shift+Tab on every platform, and nothing else. */
export const isPlanKey = (event: KeyboardEvent): boolean =>
  event.key === 'Tab' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
