import { IMPROVE_PATH } from '../../shared/routes.js';
import { callControls } from '../../shared/reasoning.js';
import type { AttachmentService, HostContext, LlmService, PreparedCall, PromptBlock } from '../context.js';
import { json, service } from '../context.js';
import { improveInputOk, improvePromptText, projectBrief } from '../files.js';
import { projectDirOf } from '../project.js';
import { sharedStore, settingsFileOf } from '../store.js';
import { analysisRoute } from './brief.js';

export const IMPROVE_MAX_TOKENS = 16_000;
/** How many images one optimisation may carry, and how large each may be once base64-encoded. */
export const IMPROVE_IMAGES_MAX = 8;
export const IMPROVE_IMAGE_CHARS_MAX = 11 * 1024 * 1024;

/** The media types dsh's own image admission accepts. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** One image the composer staged, as the client serialized it. */
export interface ImproveImage {
  readonly type: 'image';
  readonly mediaType: string;
  readonly data: string;
  readonly name?: string;
}

/** The `attachments` field, narrowed: anything else is a 400 rather than a quiet text-only optimisation. */
function readImages(value: unknown): ImproveImage[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > IMPROVE_IMAGES_MAX) return undefined;
  const images: ImproveImage[] = [];
  for (const part of value) {
    if (part === null || typeof part !== 'object') return undefined;
    const { type, mediaType, data, name } = part as Record<string, unknown>;
    if (type !== 'image' || typeof mediaType !== 'string' || !IMAGE_TYPES.has(mediaType)) return undefined;
    if (typeof data !== 'string' || data === '' || data.length > IMPROVE_IMAGE_CHARS_MAX) return undefined;
    images.push({
      type: 'image',
      mediaType,
      data,
      ...(typeof name === 'string' && name !== '' ? { name: name.slice(0, 200) } : {}),
    });
  }
  return images;
}

const isText = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

export const IMPROVE_SYSTEM = 'Rewrite the draft as a clearer prompt for a coding agent. Answer with the prompt only.';

/**
 * Stream one prepared model call to its text.
 *
 * dsh refuses a dispatch whose options differ from the config it resolved at prepare time, so the resolved config travels
 * back into `stream` alongside the messages.
 */
async function collect(prepared: PreparedCall, content: readonly PromptBlock[], signal: AbortSignal): Promise<string> {
  let text = '';
  const stream = prepared.stream({
    ...prepared.config,
    system: IMPROVE_SYSTEM,
    messages: [{ role: 'user', content }],
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
      const images = readImages(body.attachments);
      if (images === undefined) return json({ error: 'bad request' }, 400);

      const llm = service<LlmService>(ctx, 'llm');
      if (llm?.prepareCall === undefined) return json({ error: 'this dsh profile cannot call a model' }, 409);

      running.get(sessionId)?.abort();
      const mine = new AbortController();
      running.set(sessionId, mine);
      const signal = request.signal === undefined ? mine.signal : AbortSignal.any([mine.signal, request.signal]);

      try {
        const settings = store.read();
        // An explicit route wins; otherwise the shared setting, the chat's own model, then dsh's default — the order
        // `analysisRoute` documents. The client sends a route only when the user pinned a model for this plugin.
        const found = await ctx.sessionController?.resolveAgent(sessionId).catch(() => undefined);
        const agent = found === undefined || !('agent' in found) ? undefined : found.agent;
        const route = (isText(body.provider, 200) && isText(body.model, 200))
          ? { provider: body.provider, model: body.model }
          : analysisRoute(ctx, home, agent);
        if (route === undefined) return json({ error: 'no model is configured for this plugin' }, 409);

        const info = await llm.resolveModelInfo?.(route.provider, route.model, signal);

        // An image the model cannot take is refused in words: silently optimising the text alone would look like it worked.
        const admitted: PromptBlock[] = [];
        if (images.length > 0) {
          if (Array.isArray(info?.inputModalities) && !info.inputModalities.includes('image')) {
            return json({ error: `model "${route.model}" does not take images; pick a vision model in Settings → Widgets, or remove them` }, 409);
          }
          const attachments = service<AttachmentService>(ctx, 'attachments');
          if (attachments?.admitPromptContent === undefined) return json({ error: 'this dsh cannot send images to a model' }, 409);
          try {
            admitted.push(...await attachments.admitPromptContent(images));
          } catch (error) {
            return json({ error: String((error as Error)?.message ?? error) }, 400);
          }
        }

        const requested = typeof body.effort === 'string' ? body.effort : settings.analysis.effort;
        const controls = callControls(requested, info);
        const prepared = await llm.prepareCall({ ...route, ...controls, maxTokens: IMPROVE_MAX_TOKENS }, signal);

        const dir = await projectDirOf(ctx, { sessionId }).catch(() => undefined);
        const brief = dir === undefined ? '' : projectBrief(dir);

        // The images travel with the text: the model reads the whole of what the user put in the box.
        const content: PromptBlock[] = [{ type: 'text', text: improvePromptText(text, brief, images.length) }, ...admitted];
        const improved = await collect(prepared, content, signal);
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