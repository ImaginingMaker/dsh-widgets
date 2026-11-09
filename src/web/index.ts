/**
 * dsh-widgets — Client half.
 *
 * Seven small widgets, each with its own switch in Settings → Widgets. Switching one off disposes exactly what it
 * registered.
 *
 * Two rules this file exists to keep:
 *
 * 1. Every optional service is read through `read()`. cordis throws `cannot get property "X" without inject` for a
 *    service a plugin did not declare, and one missing service must not stop the rest of the panel from loading.
 * 2. Nothing edits dsh's own markup. Every control rides a published slot, so a dsh update cannot leave half a control
 *    behind.
 */
import React from 'react';
import type { BriefView, LanguageSetting } from '../shared/types.js';
import { translatorFor, resolveLanguage } from './kernel/i18n.js';
import type { Language } from './kernel/i18n.js';
import type { Translate } from './kernel/i18n.js';
import { createModels } from './kernel/modelStore.js';
import { read } from './kernel/safe.js';
import { createSettings, isOn, queueOn } from './kernel/settingsStore.js';
import type { SettingsView } from './kernel/settingsStore.js';
import { ensureStyles } from '../shared/styles.js';
import { PLAN_PATH } from '../shared/routes.js';
import { postJson } from './kernel/hostJson.js';
import { BriefStatus } from './widgets/briefStatus.js';
import { ImproveButton } from './widgets/improve.js';
import { PlanToggle } from './widgets/planToggle.js';
import { QueuePanel } from './widgets/queue.js';
import type { QueuedRow } from './widgets/queue.js';
import { WidgetSettings } from './widgets/settings.js';

/** The slice of a dsh Client Context this plugin uses. */
interface ClientContext {
  readonly slots: {
    inject(name: string, callback: () => unknown): () => void;
    register(options: Record<string, unknown>, Component: (props: never) => unknown): () => void;
  };
  readonly locale?: { getSnapshot(): { active?: string } };
  readonly sessions?: {
    list: { getSnapshot(): { byId?: Record<string, { cwd?: string }> } };
    scope(id: string): { get(name: string): { input: { for(ctx: unknown): { notify(level: string, text: string): void } }; selection?: { getSnapshot(): { current?: { provider?: string; model?: string } } } } } | undefined;
  };
  readonly remote?: { commands?: { execute(sessionId: string, line: string, args: readonly unknown[]): Promise<{ ok: boolean; value?: unknown; error?: { message: string; code: string } }> } };
  get?(name: string): unknown;
  effect?(callback: () => () => void, label: string): void;
}

interface Panel {
  readonly id: string;
  readonly on: (settings: SettingsView) => boolean;
  setup: () => (() => void)[];
  off: (() => void) | null;
}

export const name = 'dsh-widgets';

/**
 * cordis activates a plugin only once the services it declares are present. `slots` is what this half cannot work without;
 * `locale` is declared too, because the plugin speaks the app's language. Everything else is read defensively — and plan
 * mode is toggled through this plugin's own Host route, because a client half cannot reach dsh's command registry.
 */
export const inject = ['slots', 'locale'];

const notifyFor = (ctx: ClientContext, sessionId: string) => (level: 'info' | 'warn' | 'error', text: string): void => {
  try {
    const scope = read(() => ctx.sessions?.scope(sessionId));
    scope?.get('conversation').input.for(scope).notify(level, text);
  } catch { /* a notice is best effort */ }
};

export function apply(ctx: ClientContext): void {
  try {
    applyInner(ctx);
  } catch (error) {
    // dsh reports only "entry did not activate"; the reason belongs in the console.
    console.error('dsh-widgets: the client half failed to activate', error);
    throw error;
  }
}

function applyInner(ctx: ClientContext): void {
  const settings = createSettings();
  const models = createModels();
  const language = (): Language => resolveLanguage(settings.getSnapshot().language, read(() => ctx.locale?.getSnapshot().active));
  const t = (): Translate => translatorFor(language());
  /**
   * Toggle plan mode for one chat through the Host, which is the only half that can reach dsh's command registry.
   *
   * A client plugin cannot run a slash command in this dsh version (the remotes face has no `commands`), and the Host
   * route is restricted to the two plan lines rather than being a general command runner.
   */
  const togglePlan = (sessionId: string) => async (on: boolean): Promise<string | null> => {
    try {
      await postJson(PLAN_PATH, { sessionId, line: on ? '/plan off' : '/plan' });
      return null;
    } catch (error) {
      return String((error as Error)?.message ?? error);
    }
  };

  const panels: Panel[] = [
    {
      id: 'planToggle',
      on: (state) => isOn(state, 'planToggle'),
      setup: () => [ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'widgets-plan-toggle',
        order: 999,
        inject: (sessionId: string) => ({ togglePlan: togglePlan(sessionId), notify: notifyFor(ctx, sessionId) }),
      }, PlanToggle))],
      off: null,
    },
    {
      id: 'queue',
      on: queueOn,
      setup: () => [ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'widgets-queue',
        order: 21,
        inject: (sessionId: string) => ({ sessionId, notify: notifyFor(ctx, sessionId), t: t() }),
      }, (props: { sessionId: string; useProjection(name: string): readonly QueuedRow[] | undefined; notify?: (level: 'info' | 'warn' | 'error', text: string) => void; t: Translate }) => React.createElement(QueuePanel, {
        ...props,
        settings: React.useSyncExternalStore(settings.subscribe, settings.getSnapshot),
      })))],
      off: null,
    },
    {
      id: 'improvePrompt',
      on: (state) => isOn(state, 'improvePrompt'),
      setup: () => [ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'widgets-improve',
        order: 997,
        inject: (sessionId: string) => ({ sessionId, store: settings, notify: notifyFor(ctx, sessionId), t: t() }),
      }, ImproveButton))],
      off: null,
    },
    {
      id: 'projectBrief',
      on: (state) => isOn(state, 'projectBrief'),
      setup: () => [ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'widgets-brief',
        order: 995,
        inject: (sessionId: string) => ({ sessionId, t: t(), notify: notifyFor(ctx, sessionId) }),
      }, BriefStatus))],
      off: null,
    },
  ];

  const applyPanels = (): void => {
    const state = settings.getSnapshot();
    for (const panel of panels) {
      const wants = panel.on(state);
      if (wants && panel.off === null) {
        const disposers = panel.setup();
        panel.off = () => { for (const disposer of disposers.reverse()) disposer?.(); };
      } else if (!wants && panel.off !== null) {
        panel.off();
        panel.off = null;
      }
    }
  };

  // One stylesheet for every widget, installed once: a class that only exists while one component renders leaves the
  // others looking like bare browser buttons.
  const dropStyles = ensureStyles(read(() => (globalThis as unknown as { document?: never }).document));

  applyPanels();
  const offSettings = settings.subscribe(applyPanels);
  void models.load();

  // The section is registered once the switches are known, because its nav label is computed when the settings panel
  // builds its list: registering before the load answers would freeze the label in whatever language dsh started with,
  // ignoring a language the user pinned for this plugin.
  let dropSection: (() => void) | undefined;
  void settings.load().then(() => {
    dropSection = ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'widgets',
      order: 90,
      label: () => t()('settings.nav'),
      inject: () => ({ store: settings, models, locale: read(() => ctx.locale) }),
    }, WidgetSettings));
  });

  ctx.effect?.(() => () => {
    offSettings();
    dropStyles();
    dropSection?.();
    for (const panel of panels) {
      if (panel.off !== null) {
        panel.off();
        panel.off = null;
      }
    }
  }, 'dsh-widgets: widgets');

  void (undefined as unknown as BriefView);
}