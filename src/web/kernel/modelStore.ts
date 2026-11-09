import { MODELS_PATH } from '../../shared/routes.js';
import type { ModelCatalogue, ReasoningOptions } from '../../shared/types.js';
import { hostJson } from './hostJson.js';
import type { Sender } from './hostJson.js';

export interface ModelView extends Partial<ModelCatalogue> {
  readonly providers: ModelCatalogue['providers'];
  readonly reasoning: Record<string, ReasoningOptions>;
  readonly error?: string;
}

const EMPTY: ModelView = { providers: [], reasoning: {} };

const keyOf = (provider: string, model: string): string => `${provider}\u0000${model}`;

/**
 * The model list from this Mac's configuration, plus one model's reasoning efforts on demand. The effort list is read
 * per model and cached: it is a property of the configuration, not of a chat.
 */
export function createModels(): Sender<ModelView> & { reasoningOf(provider: string, model: string): Promise<ReasoningOptions> } {
  let state: ModelView = EMPTY;
  const listeners = new Set<() => void>();
  const emit = (): void => { for (const listener of [...listeners]) listener(); };

  return {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async load() {
      try {
        const value = await hostJson<ModelCatalogue>(MODELS_PATH);
        state = { ...state, providers: Array.isArray(value?.providers) ? value.providers : [], error: undefined };
      } catch (error) {
        state = { ...state, error: String((error as Error)?.message ?? error) };
      }
      emit();
      return state;
    },
    async reasoningOf(provider, model) {
      const key = keyOf(provider, model);
      const cached = state.reasoning[key];
      if (cached !== undefined) return cached;
      let reasoning: ReasoningOptions = { supported: false, efforts: [] };
      try {
        const query = new URLSearchParams({ provider, model });
        const value = await hostJson<{ reasoning?: ReasoningOptions }>(`${MODELS_PATH}?${query}`);
        if (value?.reasoning !== undefined) reasoning = value.reasoning;
      } catch { /* an unreadable route reads as "no efforts" */ }
      state = { ...state, reasoning: { ...state.reasoning, [key]: reasoning } };
      emit();
      return reasoning;
    },
  };
}