import { LANGUAGES, OFF_BY_DEFAULT, WIDGETS } from './types.js';
import type { LanguageSetting, Settings, SettingsPatch, WidgetId } from './types.js';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isText = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

export const isWidget = (value: unknown): value is WidgetId =>
  typeof value === 'string' && (WIDGETS as readonly string[]).includes(value);

/** The default value of one switch: off only for `OFF_BY_DEFAULT`. */
export const defaultOn = (id: WidgetId): boolean => !OFF_BY_DEFAULT.includes(id);

/** The settings every widget starts from. */
export function defaultSettings(): Settings {
  return {
    on: Object.fromEntries(WIDGETS.map((id) => [id, defaultOn(id)])) as Record<WidgetId, boolean>,
    analysis: { model: null, effort: null },
    language: 'auto',
  };
}

const isLanguage = (value: unknown): value is LanguageSetting =>
  typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);

const routeOf = (value: unknown) => {
  if (!isPlainObject(value) || !isText(value.provider, 200) || !isText(value.model, 200)) return undefined;
  return { provider: value.provider, model: value.model };
};

/**
 * A stored value narrowed to the shape this plugin writes: unknown keys go, wrong types fall back to the default, so a
 * hand-edited or half-written file still yields a usable Settings. The `improve` key of 0.2.x is read as `analysis`, so
 * an upgrade keeps the model the user picked.
 */
export function sanitizeSettings(value: unknown): Settings {
  const next = defaultSettings();
  const source = isPlainObject(value) ? value : {};

  const on: Record<WidgetId, boolean> = { ...next.on };
  if (isPlainObject(source.on)) {
    for (const id of WIDGETS) {
      const stored = source.on[id];
      if (typeof stored === 'boolean') on[id] = stored;
    }
  }

  const analysisSource = isPlainObject(source.analysis) ? source.analysis : (isPlainObject(source.improve) ? source.improve : {});
  let model = next.analysis.model;
  let effort = next.analysis.effort;
  const storedModel = routeOf(analysisSource.model);
  if (storedModel !== undefined) model = storedModel;
  const storedEffort = analysisSource.effort;
  if (typeof storedEffort === 'string' && storedEffort !== '' && storedEffort.length <= 64) effort = storedEffort;

  const language: LanguageSetting = isLanguage(source.language) ? source.language : next.language;

  return { on, analysis: { model, effort }, language };
}

/** The result of reading one patch off the wire: the patch, or the reason it is refused. */
export type PatchResult = { patch: SettingsPatch } | { error: 'bad request' };

/**
 * What a change may touch: `{id, on}`, `{analysis: {...}}` or `{language}`.
 */
export function parseSettingsPatch(body: unknown): PatchResult {
  if (!isPlainObject(body)) return { error: 'bad request' };
  const keys = Object.keys(body);

  if (keys.length === 2 && keys.includes('id') && keys.includes('on')) {
    if (!isWidget(body.id) || typeof body.on !== 'boolean') return { error: 'bad request' };
    return { patch: { kind: 'switch', id: body.id, on: body.on } };
  }

  if (keys.length === 1 && keys.includes('analysis')) {
    const patch = body.analysis;
    if (!isPlainObject(patch)) return { error: 'bad request' };
    if (!Object.keys(patch).every((key) => key === 'model' || key === 'effort')) return { error: 'bad request' };
    const result: { model?: { provider: string; model: string } | null; effort?: string | null } = {};
    if (patch.model !== undefined) {
      if (patch.model === null) result.model = null;
      else {
        const route = routeOf(patch.model);
        if (route === undefined) return { error: 'bad request' };
        result.model = route;
      }
    }
    if (patch.effort !== undefined) {
      if (patch.effort === null) result.effort = null;
      else if (typeof patch.effort === 'string' && patch.effort !== '' && patch.effort.length <= 64) result.effort = patch.effort;
      else return { error: 'bad request' };
    }
    return { patch: { kind: 'analysis', patch: result } };
  }

  if (keys.length === 1 && keys.includes('language')) {
    if (!isLanguage(body.language)) return { error: 'bad request' };
    return { patch: { kind: 'language', language: body.language } };
  }

  return { error: 'bad request' };
}

/** Apply one patch to a Settings value. Pure, so the route and the tests share exactly one implementation. */
export function applyPatch(current: Settings, patch: SettingsPatch): Settings {
  switch (patch.kind) {
    case 'switch':
      return { ...current, on: { ...current.on, [patch.id]: patch.on } };
    case 'language':
      return { ...current, language: patch.language };
    case 'analysis': {
      const model = patch.patch.model === undefined ? current.analysis.model : patch.patch.model;
      const effort = patch.patch.effort === undefined ? current.analysis.effort : patch.patch.effort;
      return { ...current, analysis: { model, effort } };
    }
  }
}