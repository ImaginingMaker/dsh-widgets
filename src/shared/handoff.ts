/** The project the handed-off session belongs to. `workspaceId` is present when the host resolved one. */
export interface HandoffProject {
  readonly cwd?: string;
  readonly workspaceId?: string;
  readonly title?: string;
}

/**
 * Where one handoff is in its life.
 *
 * `running` outlives the page that started it, `done` survives a switch to another session and back, `failed` keeps the
 * reason so the composer can offer a retry.
 */
export type HandoffState = 'idle' | 'running' | 'done' | 'failed';

/**
 * Where the seconds went. The model call dominates, so the phases are recorded separately: a slow handoff can then be
 * read as "the model took 48 s" rather than guessed at.
 */
export interface HandoffTimings {
  readonly totalMs: number;
  /** Reading the durable history. Overlaps preparation, so this is not additive with it. */
  readonly readMs: number;
  /** Resolving the route, the model metadata and the prepared call. Overlaps the read. */
  readonly prepareMs: number;
  readonly modelMs: number;
  readonly repairMs?: number;
  readonly createMs: number;
  readonly promptMs: number;
  readonly transcriptChars: number;
  readonly outputChars: number;
  readonly reasoningChars: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  /** The reasoning effort actually sent, when the model declares a ladder. */
  readonly effort?: string;
  readonly repaired: boolean;
}

/**
 * The state of one session's handoff, as both halves exchange it.
 *
 * The note itself is not part of the stored state: a handoff that finished while its page was closed only needs the id of
 * the session it created, so the composer can offer to open it.
 */
export interface HandoffStatus {
  readonly status: HandoffState;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  /** The session the handoff created. */
  readonly newSessionId?: string;
  /** The title given to that session, for the "open it" label. */
  readonly title?: string;
  readonly project?: HandoffProject;
  readonly error?: string;
  readonly timings?: HandoffTimings;
}

/** The Host's answer to one handoff: the new session it created and the note it sent there. */
export interface HandoffResult extends HandoffStatus {
  readonly status: 'done';
  /** Kept beside `newSessionId` so an older client keeps working. */
  readonly sessionId: string;
  readonly handoff: string;
  readonly project: HandoffProject;
}