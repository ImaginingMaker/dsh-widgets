import { IMPROVE_PATH } from '../../shared/routes.js';
import { callControls } from '../../shared/reasoning.js';
import type { HostContext, LlmService, PreparedCall } from '../context.js';
import { json, service } from '../context.js';
import { improveInputOk, improvePromptText, projectBrief } from '../files.js';
import { projectDirOf } from '../project.js';
import { sharedStore, settingsFileOf } from '../store.js';
import { analysisRoute } from './brief.js';

export const IMPROVE_MAX_TOKENS = 16_000;

const isText = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

export const IMPROVE_SYSTEM = 'Rewrite the draft as a clearer prompt for a coding agent. Answer with the prompt only.';

/**
 * Stream one prepared model call to its text.
 *
 * dsh refuses a dispatch whose options differ from the config it resolved at prepare time, so the resolved config travels
 * back into `stream` alongside the messages.
 */
async function collect(prepared: PreparedCall, prompt: string, signal: AbortSignal): Promise<string> {
  let text = '';
  const stream = prepared.stream({
    ...prepared.config,
    system: IMPROVE_SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
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
 * `POST /api/widgets.improve` — one model call that rewrites the draft. The model is the plugin's single analysis model,
 * the same one Project brief uses, so there is one answer to "which model does this plugin call".
 *
 * One improvement per chat at a time: a newer ask aborts the older call, which answers 409 rather than locking the composer.
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

      const { sessionId, text } = body;
      if (!isText(sessionId, 200) || !improveInputOk(text)) return json({ error: 'bad request' }, 400);

      const llm = service<LlmService>(ctx, 'llm');
      if (llm?.prepareCall === undefined) return json({ error: 'this dsh profile cannot call a model' }, 409);

      running.get(sessionId)?.abort();
      const mine = new AbortController();
      running.set(sessionId, mine);
      const signal = request.signal === undefined ? mine.signal : AbortSignal.any([mine.signal, request.signal]);

      try {
        const settings = store.read();
        // The chat may name its own route (it follows the chat's model); otherwise the shared analysis model decides.
        const route = (isText(body.provider, 200) && isText(body.model, 200))
          ? { provider: body.provider, model: body.model }
          : analysisRoute(ctx, home);
        if (route === undefined) return json({ error: 'no model is configured for this plugin' }, 409);

        const info = await llm.resolveModelInfo?.(route.provider, route.model, signal);
        const requested = typeof body.effort === 'string' ? body.effort : settings.analysis.effort;
        const controls = callControls(requested, info);
        const prepared = await llm.prepareCall({ ...route, ...controls, maxTokens: IMPROVE_MAX_TOKENS }, signal);

        const dir = await projectDirOf(ctx, { sessionId }).catch(() => undefined);
        const brief = dir === undefined ? '' : projectBrief(dir);

        const improved = await collect(prepared, improvePromptText(text, brief), signal);
        if (improved.trim() === '') return json({ error: 'the model gave no text' }, 502);
        return json({ text: improved.trim(), provider: route.provider, model: route.model, effort: controls.reasoningEffort ?? null });
      } catch (error) {
        if (mine.signal.aborted) return json({ error: 'a newer improvement replaced this one' }, 409);
        return json({ error: String((error as Error)?.message ?? error) }, 502);
      } finally {
        if (running.get(sessionId) === mine) running.delete(sessionId);
      }
    },
  });
}