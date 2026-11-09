import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { applyPatch, defaultSettings, sanitizeSettings } from '../shared/settings.js';
import type { Settings, SettingsPatch } from '../shared/types.js';

export interface SettingsStore {
  /** Never throws: a missing, unreadable or broken file reads as the defaults. */
  read(): Settings;
  /** Serialized through a promise chain; a temp file plus a rename, owner-only. */
  write(mutate: SettingsPatch | ((current: Settings) => Settings)): Promise<Settings>;
}

/**
 * One settings file. `read()` never throws, so one bad write cannot lock the user out of Settings. `write()` serializes
 * through a promise chain, writes a temp file and renames it (a reader never sees half a file), and keeps the file
 * owner-only.
 */
export function settingsStore(file: string): SettingsStore {
  let tail: Promise<unknown> = Promise.resolve();
  const read = (): Settings => {
    try {
      return sanitizeSettings(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      return defaultSettings();
    }
  };
  const write = (mutate: SettingsPatch | ((current: Settings) => Settings)): Promise<Settings> => {
    const run = tail.then(() => {
      const current = read();
      const next = sanitizeSettings(typeof mutate === 'function' ? mutate(current) : applyPatch(current, mutate));
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      try { chmodSync(temp, 0o600); } catch { /* filesystems without modes */ }
      renameSync(temp, file);
      return next;
    });
    tail = run.catch(() => {});
    return run;
  };
  return { read, write };
}

/**
 * One store per file. Four installers read the same settings file, and a second queue for the same file would let two
 * writes interleave; sharing the store keeps every write serialized.
 */
const stores = new Map<string, SettingsStore>();

export function sharedStore(file: string): SettingsStore {
  let store = stores.get(file);
  if (store === undefined) {
    store = settingsStore(file);
    stores.set(file, store);
  }
  return store;
}

/** The one settings file of this plugin under a dsh home. */
export const settingsFileOf = (home: string): string => `${home}/storages/dsh-widgets/settings.json`;