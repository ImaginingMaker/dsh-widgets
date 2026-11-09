import { MODELS_PATH } from '../../shared/routes.js';
import { reasoningOptions } from '../../shared/reasoning.js';
import type { HostContext, LlmService } from '../context.js';
import { json, service } from '../context.js';

/**
 * `GET /api/widgets.models` — the providers and models this Mac's configuration declares; with `provider` and `model` it
 * adds that model's own reasoning efforts, read from `llm.resolveModelInfo` rather than from a fixed list.
 */
export function installModels(ctx: HostContext): void {
  ctx.connection.fetch.register({
    path: MODELS_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      const llm = service<LlmService>(ctx, 'llm');
      if (llm?.listProviders === undefined) return json({ error: 'this dsh profile has no model service' }, 409);

      const url = new URL(request.url);
      const provider = url.searchParams.get('provider');
      const model = url.searchParams.get('model');

      if (provider !== null && model !== null) {
        try {
          const info = await llm.resolveModelInfo?.(provider, model, request.signal);
          return json({ provider, model, reasoning: reasoningOptions(info) });
        } catch (error) {
          // A route the configuration still lists but the adapter no longer serves: no efforts, and the panel stays usable.
          return json({
            provider,
            model,
            reasoning: { supported: false, efforts: [] },
            error: String((error as Error)?.message ?? error),
          });
        }
      }

      const providers = [];
      for (const entry of llm.listProviders()) {
        let models: readonly { id?: unknown; name?: unknown; inputModalities?: unknown }[] = [];
        try { models = (await llm.listModels?.(entry.id)) ?? []; } catch { models = []; }
        providers.push({
          id: entry.id,
          name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : entry.id,
          models: models
            .filter((item) => typeof item?.id === 'string' && item.id !== '')
            .map((item) => ({
              id: item.id as string,
              name: typeof item.name === 'string' && item.name !== '' ? item.name : (item.id as string),
              ...(Array.isArray(item.inputModalities) ? { inputModalities: item.inputModalities } : {}),
            })),
        });
      }
      return json({ providers });
    },
  });
}