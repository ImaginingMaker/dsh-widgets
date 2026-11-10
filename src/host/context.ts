/**
 * The slice of a dsh Host Context this plugin touches. Declared locally so the plugin does not depend on a package whose
 * version moves independently of the running dsh; every member is optional except the route registrar, and each use site
 * narrows it.
 */

/** The shape dsh's `connection.fetch.register` takes. */
export interface RouteRegistration {
  readonly path: string;
  readonly methods: readonly ('GET' | 'POST')[];
  readonly requestBody: 'buffered';
  readonly fetch: (request: Request) => Promise<Response> | Response;
}

export interface SpawnHandle {
  readonly done: Promise<{ readonly exitCode: number | null }>;
  readonly collected: {
    readonly stdout?: { readonly readFrom: (offset: number) => { readonly text: string } };
    readonly stderr?: { readonly readFrom: (offset: number) => { readonly text: string } };
  };
}

export interface SubprocessService {
  resolveExecutable(command: string, env?: Record<string, string>, signal?: AbortSignal): Promise<string>;
  spawn(spec: {
    readonly argv: readonly string[];
    readonly cwd: string;
    readonly stdio: unknown;
    readonly graceMs: number;
    readonly signal?: AbortSignal;
    readonly env: Record<string, string>;
  }): SpawnHandle;
}

/** The model metadata this plugin reads; the rest of dsh's `LlmResolvedModelInfo` is ignored. */
export interface ResolvedModelInfo {
  readonly reasoning?: { readonly efforts?: readonly unknown[]; readonly defaultEffort?: unknown };
  /** What the model can take. An unknown value is treated as "not known", never as "no images". */
  readonly inputModalities?: readonly string[];
}

/** One image dsh admitted for a prompt: the reference its adapters read, in place of raw bytes. */
export interface AdmittedImage {
  readonly type: 'image';
  readonly attachment: { readonly attachmentId: string; readonly mediaType: string };
}

/** The content block the model turns read. */
export type PromptBlock = { readonly type: 'text'; readonly text: string } | AdmittedImage;

/** The attachment service, reduced to the one call this plugin makes. */
export interface AttachmentService {
  admitPromptContent?(images: readonly { readonly type: 'image'; readonly mediaType: string; readonly data: string; readonly name?: string }[]): Promise<readonly AdmittedImage[]>;
}

export interface PreparedCall {
  /** The config dsh resolved at prepare time; it must travel back into `stream`, or the dispatch is refused. */
  readonly config?: Record<string, unknown>;
  stream(options: {
    readonly system?: string;
    readonly messages: readonly { readonly role: 'user'; readonly content: readonly PromptBlock[] }[];
    readonly maxTokens?: number;
    readonly signal?: AbortSignal;
  }): AsyncIterable<{
    readonly type: string;
    readonly text?: string;
    /** Sent once, before the terminal finish; the handoff records it to show where the time went. */
    readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly reasoningTokens?: number; readonly totalTokens?: number };
    readonly reason?: { readonly kind?: string; readonly failure?: { readonly message?: string } };
  }>;
}

export interface LlmService {
  listProviders(): readonly { readonly id: string; readonly name?: string }[];
  listModels?(provider: string): Promise<readonly { readonly id: string; readonly name?: string; readonly inputModalities?: readonly string[] }[]>;
  resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<ResolvedModelInfo>;
  prepareCall?(config: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string; readonly maxTokens?: number }, signal?: AbortSignal): Promise<PreparedCall>;
}

/** One model-visible message part, as much of it as the handoff reader needs. */
export interface SurfaceMessagePart {
  readonly type?: string;
  readonly text?: string;
}

/** One committed session event, narrowed to the fields the handoff transcript reads. */
export interface SurfaceEventLike {
  readonly type?: string;
  readonly data?: {
    readonly content?: readonly SurfaceMessagePart[];
    readonly source?: { readonly kind?: string };
    readonly message?: { readonly content?: readonly SurfaceMessagePart[] };
    readonly name?: string;
    readonly arguments?: string;
  };
}

/** One immutable session cut from dsh's session query service. */
export interface SessionObservationLike {
  readonly header?: { readonly id?: string; readonly cwd?: string; readonly agentPreset?: string };
  readonly events?: readonly SurfaceEventLike[];
  readonly projections?: { readonly values?: Record<string, unknown> };
}

/** The session-query face this plugin uses to read durable history. */
export interface SessionQueryService {
  observeSession?(sessionId: string, options?: { readonly signal?: AbortSignal; readonly projectionMode?: 'all' | 'none' }): Promise<SessionObservationLike>;
  readTitle?(sessionId: string, signal?: AbortSignal): Promise<{ readonly title?: { readonly text?: string } } | undefined>;
}

export interface InboxMessage {
  readonly id: string;
  readonly source?: { readonly kind?: string };
  readonly content: readonly {
    readonly type?: string;
    readonly text?: string;
    readonly attachment?: { readonly attachmentId?: string };
  }[];
}

export interface Inbox {
  readonly nextTurn?: readonly InboxMessage[];
  splice?(target: string, start: number, count: number, inserted: readonly InboxMessage[]): unknown;
  replace?(id: string, content: readonly unknown[]): boolean | undefined;
}

export interface Agent {
  readonly inbox?: Inbox;
  readonly session?: unknown;
}

export interface WorkspaceEntry {
  readonly id?: string;
  readonly workspaceId?: string;
  readonly path: string;
  readonly title?: string;
}

export interface WorkspaceRegistry {
  list(): readonly WorkspaceEntry[];
  create?(path: string, title?: string): Promise<WorkspaceEntry>;
  resolveByPath?(path: string): Promise<WorkspaceEntry | undefined>;
  archiveSession?(sessionId: string, options?: { readonly stopActivity?: boolean }): Promise<void>;
}

/** The `agent/pre-step` waterfall: reject a step, or replace the messages that enter it. */
export interface PreStepPayload {
  readonly agent?: { readonly id?: unknown };
  readonly messages?: readonly unknown[];
  readonly turn?: number;
  readonly step?: number;
  readonly signal?: AbortSignal;
}

export type PreStepDecision =
  | { readonly kind: 'reject' }
  | { readonly kind: 'enter'; readonly messages: readonly unknown[]; readonly startsRequestSeries?: true };

export interface HostContext {
  on(
    event: 'agent/pre-step',
    listener: (payload: PreStepPayload, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>,
    prepend?: boolean,
  ): void;
  readonly connection: { readonly fetch: { register(route: RouteRegistration): (() => void) | undefined } };
  get(name: string): unknown;
  readonly subprocess: SubprocessService;
  readonly sessionController?: {
    resolveAgent(sessionId: string): Promise<{ readonly agent: Agent } | { readonly error: unknown }>;
    /** The model a session is currently set to. Reading it here is what makes "same as the chat" mean the chat. */
    readonly agents?: { selectionFor?(agent: Agent): { readonly current?: { readonly provider?: string; readonly model?: string } } | undefined };
    /** Create a session in the same workspace (or cwd) as the one being handed off. */
    create?(request: { readonly workspaceId?: string; readonly cwd?: string; readonly agentPreset?: string }): Promise<{ readonly sessionId: string }>;
    /** Send one prompt into a freshly created session. */
    prompt?(request: {
      readonly requestId: string;
      readonly sessionId: string;
      readonly mode: 'queue' | 'steer';
      readonly content: readonly { readonly type: 'text'; readonly text: string }[];
    }, signal?: AbortSignal): Promise<unknown>;
    /** Give the new session a stable handoff title; best effort. */
    rename?(request: { readonly sessionId: string; readonly title: string }): Promise<unknown>;
  };
  readonly sessions?: { readonly list?: { getSnapshot(): { readonly byId?: Record<string, { readonly cwd?: string }> } } };
  readonly timer?: { interval(callback: () => void, delay: number): () => void };
}

/**
 * One optional cordis service. A service this plugin does not declare in `inject` must never be read directly — cordis
 * throws "cannot get property X without inject" — and a profile may lack it altogether, so every optional read goes
 * through here.
 */
export function service<T>(ctx: HostContext, name: string): T | undefined {
  try {
    return ctx.get(name) as T | undefined;
  } catch {
    return undefined;
  }
}

export const json = (value: unknown, status = 200): Response =>
  Response.json(value, { status, headers: { 'cache-control': 'no-store' } });