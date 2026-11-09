import { SETTINGS_PATH } from '../../shared/routes.js';
import { defaultOn } from '../../shared/settings.js';
import type { Settings, WidgetId } from '../../shared/types.js';
import { hostJson, postJson } from './hostJson.js';
import type { Sender } from './hostJson.js';
import { OFF_BY_DEFAULT } from '../../shared/types.js';

/** The settings as the panel sees them: the Host's answer, plus whether it has arrived and why it might not have. */
export interface SettingsView extends Settings {
  readonly ready: boolean;
  readonly error?: string;
}

const EMPTY: SettingsView = {
  ready: false,
  on: { branchTarget: defaultOn('branchTarget'), branchTree: false, planToggle: true, queueReorder: true, queueEdit: true, improvePrompt: true },
  branchTarget: { mode: 'current' },
  improve: { model: null, effort: null },
};

/** Whether a widget is on. Off-by-default widgets stay off until the stored value says otherwise. */
export const isOn = (settings: Settings | SettingsView | undefined, id: WidgetId): boolean =>
  (OFF_BY_DEFAULT.includes(id) ? settings?.on?.[id] === true : settings?.on?.[id] !== false);

/** The queue strip is one panel that serves two switches. */
export const queueOn = (settings: Settings | SettingsView | undefined): boolean =>
  isOn(settings, 'queueReorder') || isOn(settings, 'queueEdit');

/**
 * The switches and the Improve prompt settings, from the Host half — one source of truth for every window, so a switch
 * set on one device is not a different value on another.
 */
export function createSettings(): Sender<SettingsView> & { save(body: unknown): Promise<SettingsView> } {
  let state: SettingsView = EMPTY;
  const listeners = new Set<() => void>();
  const emit = (): void => { for (const listener of [...listeners]) listener(); };
  let busy = false;

  const adopt = (value: Partial<Settings>): void => {
    state = {
      ...EMPTY,
      ...value,
      on: { ...EMPTY.on, ...(value.on ?? {}) },
      branchTarget: value.branchTarget ?? EMPTY.branchTarget,
      improve: value.improve ?? EMPTY.improve,
      ready: true,
      error: undefined,
    };
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async load() {
      try {
        adopt(await hostJson<Settings>(SETTINGS_PATH));
      } catch (error) {
        state = { ...state, ready: true, error: String((error as Error)?.message ?? error) };
      }
      emit();
      return state;
    },
    async save(body) {
      if (busy) return state;
      busy = true;
      try {
        adopt(await postJson<Settings>(SETTINGS_PATH, body));
      } catch (error) {
        state = { ...state, error: String((error as Error)?.message ?? error) };
      } finally {
        busy = false;
      }
      emit();
      return state;
    },
  };
}