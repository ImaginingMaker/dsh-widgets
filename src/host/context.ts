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
}

export interface PreparedCall {
  stream(options: {
    readonly messages: readonly { readonly role: 'user'; readonly content: readonly { readonly type: 'text'; readonly text: string }[] }[];
    readonly maxTokens?: number;
    readonly signal?: AbortSignal;
  }): AsyncIterable<{ readonly type: string; readonly text?: string; readonly reason?: { readonly kind?: string; readonly failure?: { readonly message?: string } } }>;
}

export interface LlmService {
  listProviders(): readonly { readonly id: string; readonly name?: string }[];
  listModels?(provider: string): Promise<readonly { readonly id: string; readonly name?: string; readonly inputModalities?: readonly string[] }[]>;
  resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<ResolvedModelInfo>;
  prepareCall?(config: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }, signal?: AbortSignal): Promise<PreparedCall>;
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
}

export interface WorkspaceRegistry {
  list(): readonly WorkspaceEntry[];
  create?(path: string, title?: string): Promise<WorkspaceEntry>;
}

export interface HostContext {
  readonly connection: { readonly fetch: { register(route: RouteRegistration): (() => void) | undefined } };
  get(name: string): unknown;
  readonly subprocess: SubprocessService;
  readonly sessionController?: {
    resolveAgent(sessionId: string): Promise<{ readonly agent: Agent } | { readonly error: unknown }>;
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