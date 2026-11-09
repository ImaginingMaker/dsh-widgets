/**
 * dsh-widgets — Client half.
 *
 * Six small widgets, each with its own switch in Settings → Widgets. Switching one off disposes exactly what that panel
 * registered, and the settings section is the only place that writes a switch.
 *
 * Nothing here edits dsh's own markup: every control rides a published slot, so a dsh update cannot leave a half-drawn
 * control behind.
 */
import React from 'react';
import { MODELS_PATH, SETTINGS_PATH } from '../shared/routes.js';
import type { TargetResult } from '../shared/types.js';
import { hostJson } from './kernel/hostJson.js';
import { translatorFor } from './kernel/i18n.js';
import { createModels } from './kernel/modelStore.js';
import { read } from './kernel/safe.js';
import { createSettings, isOn, queueOn } from './kernel/settingsStore.js';
import type { SettingsView } from './kernel/settingsStore.js';
import { BranchTargetButton } from './widgets/branchTarget.js';
import { ImproveButton } from './widgets/improve.js';
import { PlanToggle } from './widgets/planToggle.js';
import { QueuePanel } from './widgets/queue.js';
import type { QueuedRow } from './widgets/queue.js';
import { WidgetSettings } from './widgets/settings.js';

void MODELS_PATH;
void SETTINGS_PATH;

/** The slice of a dsh Client Context this plugin uses. */
interface ClientContext {
  readonly slots: {
    inject(name: string, callback: () => unknown): () => void;
    register(options: Record<string, unknown>, Component: (props: never) => unknown): () => void;
  };
  readonly locale?: { getSnapshot(): { active?: string } };
  readonly sessions?: {
    list: { getSnapshot(): { byId?: Record<string, { cwd?: string }> } };
    scope(id: string): { get(name: string): { input: { for(ctx: unknown): { notify(level: string, text: string): void } } } } | undefined;
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

/** The chat's own model, for a chat that has not picked one in Settings. */
function chatModelOf(ctx: ClientContext, sessionId: string): { provider?: string; model?: string } {
  try {
    const scope = read(() => ctx.sessions?.scope(sessionId)) as { get(name: string): Record<string, unknown> } | undefined;
    const conversation = scope?.get('conversation') as { selection?: { getSnapshot(): { current?: { provider?: string; model?: string } } } } | undefined;
    return conversation?.selection?.getSnapshot().current ?? {};
  } catch {
    return {};
  }
}

const notifyFor = (ctx: ClientContext, sessionId: string) => (level: 'info' | 'warn' | 'error', text: string): void => {
  try {
    const scope = read(() => ctx.sessions?.scope(sessionId));
    scope?.get('conversation').input.for(scope).notify(level, text);
  } catch { /* a notice is best effort */ }
};

export const name = 'dsh-widgets';

/**
 * cordis activates a plugin only once the services it declares are present. `slots` is the one this half cannot work
 * without; locale, sessions and remote are read defensively, so a build or profile without them still loads the panel.
 */
export const inject = ['slots'];

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
  const language = (): string | undefined => read(() => ctx.locale?.getSnapshot().active);
  const t = () => translatorFor(language());

  const commands = read(() => ctx.remote?.commands);

  const projectPathOf = (sessionId: string): string | undefined => {
    return read(() => ctx.sessions?.list.getSnapshot().byId?.[sessionId]?.cwd);
  };

  /** Open a chat in the folder a target produced. */
  const startIn = async (value: TargetResult): Promise<void> => {
    try {
      const workspaces = read(() => ctx.get?.('workspaces')) as { list?: () => readonly { id?: string; workspaceId?: string; path: string }[]; create?: (input: { path: string }) => Promise<{ id?: string; workspaceId?: string }> } | undefined;
      const uiWorkspace = read(() => ctx.get?.('uiWorkspace')) as { startSession?: (id: string) => void } | undefined;
      const known = (workspaces?.list?.() ?? []).find((workspace) => workspace.path === value.cwd);
      const created = known === undefined && workspaces?.create !== undefined ? await workspaces.create({ path: value.cwd }) : undefined;
      const id = known?.workspaceId ?? known?.id ?? created?.workspaceId ?? created?.id;
      if (id !== undefined) uiWorkspace?.startSession?.(id);
    } catch { /* the folder is in the picker on the next try */ }
  };

  const panels: Panel[] = [
    {
      id: 'planToggle',
      on: (state) => isOn(state, 'planToggle'),
      setup: () => [ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'widgets-plan-toggle',
        order: 999,
        inject: (sessionId: string) => ({
          exitPlanMode: commands === undefined ? undefined : async () => {
            const result = await commands.execute(sessionId, '/plan off', []);
            if (!result.ok) return `${result.error?.message} (${result.error?.code})`;
            return result.value === undefined ? 'unknown command: /plan off' : null;
          },
          notify: notifyFor(ctx, sessionId),
        }),
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
      }, (props: { sessionId: string; useProjection(name: string): readonly QueuedRow[] | undefined; notify?: (level: 'info' | 'warn' | 'error', text: string) => void; t: ReturnType<typeof translatorFor> }) => React.createElement(QueuePanel, {
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
        inject: (sessionId: string) => {
          const chat = chatModelOf(ctx, sessionId);
          return {
            sessionId,
            store: settings,
            chatProvider: chat.provider,
            chatModel: chat.model,
            notify: notifyFor(ctx, sessionId),
            t: t(),
          };
        },
      }, ImproveButton))],
      off: null,
    },
    {
      id: 'branchTarget',
      on: (state) => isOn(state, 'branchTarget'),
      setup: () => [ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'widgets-branch-target',
        order: 996,
        inject: (sessionId: string) => ({
          sessionId,
          projectPath: projectPathOf(sessionId),
          startIn,
          t: t(),
          notify: notifyFor(ctx, sessionId),
        }),
      }, BranchTargetButton))],
      off: null,
    },
    // Branches in the workspace tree does its work in the Host half; this half adds nothing to the page.
    { id: 'branchTree', on: (state) => isOn(state, 'branchTree'), setup: () => [], off: null },
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

  applyPanels();
  const offSettings = settings.subscribe(applyPanels);
  void settings.load();
  void models.load();

  // The stores travel through `inject`, so the panel is the component itself and a test can hand it its own stores.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'widgets',
    order: 90,
    label: () => translatorFor(language())('settings.nav'),
    inject: () => ({ store: settings, models, locale: read(() => ctx.locale) }),
  }, WidgetSettings));

  ctx.effect?.(() => () => {
    offSettings();
    for (const panel of panels) {
      if (panel.off !== null) {
        panel.off();
        panel.off = null;
      }
    }
  }, 'dsh-widgets: widgets');

  void hostJson;
}