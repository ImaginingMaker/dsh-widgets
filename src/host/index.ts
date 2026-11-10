/**
 * dsh-widgets — Host half.
 *
 * Everything that must outlive a page load or must run outside the browser: the switches and their settings, the model
 * catalogue and the reasoning efforts this Mac's own configuration declares, the one model call behind Improve prompt and
 * Project brief, and toggling plan mode through dsh's own command.
 *
 * Nothing here opens a port, starts a server, or calls a model without a click — except Project brief, which is off by
 * default and says so.
 */
import { homedir } from 'node:os';
import type { LanguageSetting } from '../shared/types.js';
import { briefStore, signatureOf } from './briefStore.js';
import type { HostContext } from './context.js';
import { installBrief } from './routes/brief.js';
import { installHandoff } from './routes/handoff.js';
import { installImprove } from './routes/improve.js';
import { installModels } from './routes/models.js';
import { installPlan } from './routes/plan.js';
import { installSettings } from './routes/settings.js';
import { installPreStep } from './preStep.js';
import { projectDirOf } from './project.js';
import type { SettingsStore } from './store.js';

export const name = 'dsh-widgets';
export const inject = ['connection', 'subprocess', 'sessionQuery', 'sessionController'];

export interface HostHandle {
  readonly store: SettingsStore;
}

export function apply(ctx: HostContext): HostHandle {
  const home = process.env.DSH_HOME ?? `${homedir()}/.dsh`;

  const { store } = installSettings(ctx, home);
  installModels(ctx);
  installImprove(ctx, home);
  installHandoff(ctx, home);
  installPlan(ctx);
  const brief = installBrief(ctx, home);

  // The one hook that prepares a chat: the project summary gathered in advance.
  installPreStep(ctx, {
    store,
    language: (): LanguageSetting => store.read().language,
    briefOf: async (dir) => ({ record: brief.store.get(dir), signature: await signatureOf(ctx.subprocess, dir) }),
    log: (message) => { try { console.warn(message); } catch { /* no console */ } },
  });

  return { store };
}

/**
 * The brief material the pre-step reads, so a summary is only used when it was made from the project as it is now. Exposed
 * because the hook must not block: it reads the cached record and compares signatures synchronously.
 */
export { briefStore, signatureOf, projectDirOf };
export * from './context.js';
export * from './store.js';
export * from './files.js';
export * from './git.js';
export * from './project.js';
export * from './notes.js';
export * from './preStep.js';
export * from './briefStore.js';
export * from './handoffStore.js';
export * from '../shared/types.js';
export * from '../shared/routes.js';
export * from '../shared/settings.js';
export * from '../shared/reasoning.js';
export * from '../shared/brief.js';
export * from '../shared/handoff.js';
export * from '../shared/styles.js';
export { installSettings } from './routes/settings.js';
export { installModels } from './routes/models.js';
export { installImprove, IMPROVE_MAX_TOKENS } from './routes/improve.js';
export { installHandoff } from './routes/handoff.js';
export { detectHandoffLanguage, handoffLanguageOk, handoffLanguageRepairPrompt, handoffSystem, handoffTranscript, handoffSummaryPrompt, handoffContinuation, handoffTitle, HANDOFF_MAX_TOKENS } from './handoff.js';
export { installBrief, analysisRoute, BRIEF_MAX_TOKENS } from './routes/brief.js';
export { installPlan, PLAN_LINES } from './routes/plan.js';