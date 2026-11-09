import { PLAN_PATH } from '../../shared/routes.js';
import type { Agent, HostContext } from '../context.js';
import { json, service } from '../context.js';

/**
 * The only command lines this plugin may run on the user's behalf.
 *
 * A general "run any slash command" route would be a hole: the client would be able to drive anything the command registry
 * exposes. Plan mode is the one toggle Shift+Tab needs, so the allowlist is exactly its two forms.
 */
export const PLAN_LINES = ['/plan', '/plan off'] as const;

export type PlanLine = (typeof PLAN_LINES)[number];

const isPlanLine = (value: unknown): value is PlanLine =>
  typeof value === 'string' && (PLAN_LINES as readonly string[]).includes(value);

export interface CommandRunner {
  execute(agent: Agent, line: string, attachments: readonly unknown[], signal?: AbortSignal): Promise<{ readonly result: { readonly kind: string; readonly text?: string } } | undefined>;
}

/**
 * `POST /api/widgets.plan` `{sessionId, line}` — toggle plan mode for one chat through dsh's own `plan` command.
 *
 * It runs on the Host because a client plugin cannot reach the command registry, and because the command must act on the
 * live agent rather than on whatever the page happens to believe.
 */
export function installPlan(ctx: HostContext): void {
  ctx.connection.fetch.register({
    path: PLAN_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      let body: Record<string, unknown>;
      try { body = (await request.json()) as Record<string, unknown>; } catch { return json({ error: 'bad request' }, 400); }
      const { sessionId, line } = body;
      if (typeof sessionId !== 'string' || sessionId === '' || sessionId.length > 200) return json({ error: 'bad request' }, 400);
      if (!isPlanLine(line)) return json({ error: 'bad request' }, 400);

      const commands = service<CommandRunner>(ctx, 'commands');
      if (commands?.execute === undefined) return json({ error: 'this dsh cannot run commands from a plugin' }, 409);

      const found = await ctx.sessionController?.resolveAgent(sessionId);
      if (found === undefined || 'error' in found) return json({ error: 'this chat is not available' }, 409);

      const execution = await commands.execute(found.agent, line, [], request.signal);
      if (execution === undefined) return json({ error: 'this dsh has no plan command' }, 409);
      const result = execution.result;
      if (result.kind === 'error') return json({ error: result.text ?? 'the command was refused', ok: false }, 409);
      return json({ ok: true, text: result.text ?? null });
    },
  });
}
