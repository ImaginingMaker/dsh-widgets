import { TARGET_INTENT_PATH } from '../../shared/routes.js';
import { parseTarget } from '../../shared/branch.js';
import type { Target } from '../../shared/types.js';
import type { HostContext } from '../context.js';
import { json } from '../context.js';
import { projectDirOf } from '../project.js';
import { sharedStore, settingsFileOf } from '../store.js';
import { listTargets } from '../target.js';

const isText = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

/** What the composer picked, waiting to be applied at the chat's first step. */
export interface PendingIntent {
  readonly target: Target;
  readonly text?: string;
  readonly at: number;
}

/** Intents live in memory: they describe a chat that is about to start, not something worth persisting. */
export const intents = new Map<string, PendingIntent>();

export const INTENT_TTL_MS = 30 * 60 * 1000;

/**
 * `POST /api/widgets.target-intent` — remember the target a new chat was started with, so the first step can act on it.
 * Nothing is created here: this is the "user expressed an intention" half, and the git half happens at the first step.
 */
export function installTargetIntent(ctx: HostContext, home: string): void {
  ctx.connection.fetch.register({
    path: TARGET_INTENT_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      let body: Record<string, unknown>;
      try { body = (await request.json()) as Record<string, unknown>; } catch { return json({ error: 'bad request' }, 400); }
      const { sessionId } = body;
      if (!isText(sessionId, 200)) return json({ error: 'bad request' }, 400);

      const parsed = parseTarget(body);
      if ('error' in parsed) return json({ error: parsed.error }, 400);

      // `current` is the default: it records nothing, which is what makes the default a true no-op.
      if (parsed.target.mode === 'current') {
        intents.delete(sessionId);
        return json({ mode: 'current', stored: false });
      }

      const dir = await projectDirOf(ctx, { sessionId, cwd: body.cwd });
      if (dir === undefined) return json({ error: 'this chat has no project folder' }, 400);

      const settings = sharedStore(settingsFileOf(home)).read();
      intents.set(sessionId, {
        target: parsed.target,
        ...(typeof body.text === 'string' ? { text: body.text } : {}),
        at: Date.now(),
      });
      return json({ mode: parsed.target.mode, stored: true, ...(settings.branchTarget.mode === parsed.target.mode ? {} : {}) });
    },
  });
}

/** Drop intents that were never used, so a chat that was abandoned does not surprise a later one. */
export function pruneIntents(now = Date.now()): number {
  let removed = 0;
  for (const [sessionId, intent] of intents) {
    if (now - intent.at > INTENT_TTL_MS) {
      intents.delete(sessionId);
      removed += 1;
    }
  }
  return removed;
}

export { listTargets };