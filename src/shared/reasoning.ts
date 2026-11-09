import type { CallControls, ReasoningOptions } from './types.js';

/**
 * The effort id that means "do not ask for reasoning". The local model configuration spells it `off: null`, and dsh's
 * own convention is that an `off` effort sends no `reasoningEffort` at all.
 */
export const OFF_EFFORT = 'off';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isText = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

/** The part of `LlmResolvedModelInfo` this plugin reads. */
export interface ModelInfoLike {
  readonly reasoning?: {
    readonly efforts?: readonly unknown[];
    readonly defaultEffort?: unknown;
  };
}

/**
 * The reasoning efforts this Mac's model configuration declares for one model, as `llm.resolveModelInfo` reports them.
 * The list is the configuration's own list — never a fixed ladder — so a model configured with `off/low/medium/high`
 * offers those four, and a model configured with none offers nothing.
 */
export function reasoningOptions(modelInfo: ModelInfoLike | undefined | null): ReasoningOptions {
  const reasoning = isPlainObject(modelInfo) && isPlainObject(modelInfo.reasoning) ? modelInfo.reasoning : undefined;
  const declared = Array.isArray(reasoning?.efforts) ? (reasoning.efforts as unknown[]) : [];
  const seen = new Set<string>();
  const efforts: { id: string; name: string; description?: string }[] = [];
  for (const entry of declared) {
    if (!isPlainObject(entry) || !isText(entry.id, 64) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const item: { id: string; name: string; description?: string } = {
      id: entry.id,
      name: isText(entry.name, 200) ? entry.name : entry.id,
    };
    if (isText(entry.description, 500)) item.description = entry.description;
    efforts.push(item);
  }
  const defaultEffort = isText(reasoning?.defaultEffort, 64) ? reasoning.defaultEffort : undefined;
  return { supported: efforts.length > 0, efforts, ...(defaultEffort === undefined ? {} : { defaultEffort }) };
}

/**
 * The request controls for one model call. An effort the model does not declare is replaced by the model's own default,
 * because dsh rejects an unsupported explicit effort before any provider call rather than clamping it. `off` and
 * "nothing chosen" both send no `reasoningEffort`, which is exactly what the configuration's `off: null` means.
 */
export function callControls(effort: string | null | undefined, modelInfo: ModelInfoLike | undefined | null): CallControls {
  const { efforts, defaultEffort } = reasoningOptions(modelInfo);
  if (efforts.length === 0) return {};
  const ids = efforts.map((entry) => entry.id);
  const wanted = isText(effort, 64) && ids.includes(effort) ? effort : defaultEffort;
  if (wanted === undefined || wanted === OFF_EFFORT || !ids.includes(wanted)) return {};
  return { reasoningEffort: wanted };
}