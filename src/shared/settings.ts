import { MODES, OFF_BY_DEFAULT, WIDGETS } from './types.js';
import type { Settings, SettingsPatch, TargetMode, WidgetId } from './types.js';

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
    branchTarget: { mode: 'current' },
    improve: { model: null, effort: null },
  };
}

const isMode = (value: unknown): value is TargetMode =>
  typeof value === 'string' && (MODES as readonly string[]).includes(value);

/**
 * A stored value narrowed to the shape this plugin writes: unknown keys go, wrong types fall back to the default, so a
 * hand-edited or half-written file still yields a usable Settings.
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
  let mode: TargetMode = next.branchTarget.mode;
  if (isPlainObject(source.branchTarget) && isMode(source.branchTarget.mode)) mode = source.branchTarget.mode;
  let model = next.improve.model;
  let effort = next.improve.effort;
  if (isPlainObject(source.improve)) {
    const stored = source.improve.model;
    if (isPlainObject(stored) && isText(stored.provider, 200) && isText(stored.model, 200)) {
      model = { provider: stored.provider, model: stored.model };
    }
    const storedEffort = source.improve.effort;
    if (typeof storedEffort === 'string' && storedEffort !== '' && storedEffort.length <= 64) effort = storedEffort;
  }
  return { on, branchTarget: { mode }, improve: { model, effort } };
}

/** The result of reading one patch off the wire: the patch, or the reason it is refused. */
export type PatchResult = { patch: SettingsPatch } | { error: 'bad request' };

/** What a switch change may touch: `{id, on}`, `{improve: {...}}` or `{branchTarget: {mode}}`. */
export function parseSettingsPatch(body: unknown): PatchResult {
  if (!isPlainObject(body)) return { error: 'bad request' };
  const keys = Object.keys(body);

  if (keys.length === 2 && keys.includes('id') && keys.includes('on')) {
    if (!isWidget(body.id) || typeof body.on !== 'boolean') return { error: 'bad request' };
    return { patch: { kind: 'switch', id: body.id, on: body.on } };
  }

  if (keys.length === 1 && keys.includes('improve')) {
    const patch = body.improve;
    if (!isPlainObject(patch)) return { error: 'bad request' };
    const allowed = ['model', 'effort'];
    if (!Object.keys(patch).every((key) => allowed.includes(key))) return { error: 'bad request' };
    if (patch.model !== undefined && patch.model !== null) {
      if (!isPlainObject(patch.model) || !isText(patch.model.provider, 200) || !isText(patch.model.model, 200)) {
        return { error: 'bad request' };
      }
    }
    if (patch.effort !== undefined && patch.effort !== null) {
      if (typeof patch.effort !== 'string' || patch.effort === '' || patch.effort.length > 64) return { error: 'bad request' };
    }
    const result: { model?: { provider: string; model: string } | null; effort?: string | null } = {};
    if (patch.model !== undefined) {
      result.model = patch.model === null ? null : { provider: (patch.model as { provider: string }).provider, model: (patch.model as { model: string }).model };
    }
    if (patch.effort !== undefined) result.effort = patch.effort as string | null;
    return { patch: { kind: 'improve', patch: result } };
  }

  if (keys.length === 1 && keys.includes('branchTarget')) {
    const branchTarget = body.branchTarget;
    if (!isPlainObject(branchTarget) || Object.keys(branchTarget).length !== 1) return { error: 'bad request' };
    if (!isMode(branchTarget.mode)) return { error: 'bad request' };
    return { patch: { kind: 'mode', mode: branchTarget.mode } };
  }

  return { error: 'bad request' };
}

/** Apply one patch to a Settings value. Pure, so the route and the tests share exactly one implementation. */
export function applyPatch(current: Settings, patch: SettingsPatch): Settings {
  switch (patch.kind) {
    case 'switch':
      return { ...current, on: { ...current.on, [patch.id]: patch.on } };
    case 'mode':
      return { ...current, branchTarget: { mode: patch.mode } };
    case 'improve': {
      const model = patch.patch.model === undefined ? current.improve.model : patch.patch.model;
      const effort = patch.patch.effort === undefined ? current.improve.effort : patch.patch.effort;
      return { ...current, improve: { model, effort } };
    }
  }
}