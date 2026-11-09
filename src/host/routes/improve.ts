import { IMPROVE_PATH } from '../../shared/routes.js';
import { callControls } from '../../shared/reasoning.js';
import type { HostContext, LlmService, PreparedCall } from '../context.js';
import { json, service } from '../context.js';
import { improveInputOk, improvePromptText, projectBrief } from '../files.js';
import { projectDirOf } from '../project.js';
import { sharedStore, settingsFileOf } from '../store.js';

export const IMPROVE_MAX_TOKENS = 16_000;

const isText = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

/** Stream one prepared model call to its text. */
async function collect(prepared: PreparedCall, prompt: string, signal: AbortSignal): Promise<string> {
  let text = '';
  const stream = prepared.stream({
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    maxTokens: IMPROVE_MAX_TOKENS,
    signal,
  });
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta') text += chunk.text ?? '';
    if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
      throw new Error(chunk.reason.failure?.message ?? 'the model call failed');
    }
  }
  return text;
}

/**
 * `POST /api/widgets.improve` — one model call that rewrites the draft. One improvement per chat at a time: a newer ask
 * aborts the older call, which answers 409 rather than locking the composer.
 */
export function installImprove(ctx: HostContext, home: string): void {
  const store = sharedStore(settingsFileOf(home));
  const running = new Map<string, AbortController>();

  ctx.connection.fetch.register({
    path: IMPROVE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      let body: Record<string, unknown>;
      try { body = (await request.json()) as Record<string, unknown>; } catch { return json({ error: 'bad request' }, 400); }

      const { sessionId, text, provider, model } = body;
      if (!isText(sessionId, 200) || !improveInputOk(text)) return json({ error: 'bad request' }, 400);
      if (!isText(provider, 200) || !isText(model, 200)) return json({ error: 'bad request' }, 400);

      const llm = service<LlmService>(ctx, 'llm');
      if (llm?.prepareCall === undefined) return json({ error: 'this dsh profile cannot call a model' }, 409);

      running.get(sessionId)?.abort();
      const mine = new AbortController();
      running.set(sessionId, mine);
      const signal = request.signal === undefined ? mine.signal : AbortSignal.any([mine.signal, request.signal]);

      try {
        const info = await llm.resolveModelInfo?.(provider, model, signal);
        const requested = typeof body.effort === 'string' ? body.effort : store.read().improve.effort;
        const controls = callControls(requested, info);
        const prepared = await llm.prepareCall({ provider, model, ...controls }, signal);

        const dir = await projectDirOf(ctx, { sessionId: body.sessionId }).catch(() => undefined);
        const brief = dir === undefined ? '' : projectBrief(dir);

        const improved = await collect(prepared, improvePromptText(text, brief), signal);
        if (improved.trim() === '') return json({ error: 'the model gave no text' }, 502);
        return json({ text: improved.trim(), provider, model, effort: controls.reasoningEffort ?? null });
      } catch (error) {
        if (mine.signal.aborted) return json({ error: 'a newer improvement replaced this one' }, 409);
        return json({ error: String((error as Error)?.message ?? error) }, 502);
      } finally {
        if (running.get(sessionId) === mine) running.delete(sessionId);
      }
    },
  });
}