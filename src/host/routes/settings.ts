import { SETTINGS_PATH } from '../../shared/routes.js';
import { applyPatch, parseSettingsPatch } from '../../shared/settings.js';
import type { HostContext } from '../context.js';
import { json } from '../context.js';
import { sharedStore, settingsFileOf } from '../store.js';
import type { SettingsStore } from '../store.js';

/** `GET /api/widgets.settings` / `POST` — the switches and the Improve prompt settings. */
export function installSettings(ctx: HostContext, home: string): { store: SettingsStore } {
  const store = sharedStore(settingsFileOf(home));
  ctx.connection.fetch.register({
    path: SETTINGS_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      if (request.method === 'POST') {
        let body: unknown;
        try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
        const parsed = parseSettingsPatch(body);
        if ('error' in parsed) return json({ error: parsed.error }, 400);
        const patch = parsed.patch;
        const next = await store.write((current) => applyPatch(current, patch));
        return json(next);
      }
      return json(store.read());
    },
  });
  return { store };
}