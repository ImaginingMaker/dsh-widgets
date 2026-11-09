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

/** Shift+Tab on every platform, and nothing else. */
export const isPlanKey = (event: KeyboardEvent): boolean =>
  event.key === 'Tab' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;