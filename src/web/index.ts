/**
 * dsh-widgets — Client half.
 *
 * Four small widgets, each with its own switch in Settings → Widgets. Switching one off disposes exactly what it
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
import type { BriefView } from '../shared/types.js';
import type { DraftImage } from './slot.js';
import { translatorFor, resolveLanguage } from './kernel/i18n.js';
import type { Language } from './kernel/i18n.js';
import type { Translate } from './kernel/i18n.js';
import { createModels } from './kernel/modelStore.js';
import { read } from './kernel/safe.js';
import { createSettings, isOn } from './kernel/settingsStore.js';
import type { SettingsView } from './kernel/settingsStore.js';
import { ensureStyles } from '../shared/styles.js';
import { PLAN_PATH } from '../shared/routes.js';
import { postJson } from './kernel/hostJson.js';
import { BriefStatus } from './widgets/briefStatus.js';
import { HandoffButton } from './widgets/handoff.js';
import { ImproveButton } from './widgets/improve.js';
import { PlanToggle } from './widgets/planToggle.js';
import { WidgetSettings } from './widgets/settings.js';

/** One conversation service face: the pieces this plugin uses, all optional. */
interface ConversationFace {
  readonly input?: { for(ctx: unknown): { notify(level: string, text: string): void } };
  serializeDraftAttachments?(values: readonly string[]): Promise<{ attachments: readonly unknown[] }>;
  readonly blocks?: {
    set(sessionId: string, block: { readonly reason: string } | undefined): void;
    storeFor?(sessionId: string): { getSnapshot(): { readonly reason: string } | undefined };
  };
}

/** The slice of a dsh Client Context this plugin uses. */
interface ClientContext {
  readonly slots: {
    inject(name: string, callback: () => unknown): () => void;
    register(options: Record<string, unknown>, Component: (props: never) => unknown): () => void;
  };
  readonly locale?: { getSnapshot(): { active?: string } };
  readonly sessions?: {
    list: { getSnapshot(): { byId?: Record<string, { cwd?: string }> } };
    scope(id: string): { get?(name: string): unknown } | undefined;
    refresh?(): Promise<void>;
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
 * cordis activates a plugin only once the services it declares are present. `slots` is what this half cannot work without,
 * `sessions` is how it reaches the composer's images and the per-session conversation service, and `locale` is declared
 * too because the plugin speaks the app's language. Everything else is read defensively — and plan mode is toggled
 * through this plugin's own Host route, because a client half cannot reach dsh's command registry.
 */
export const inject = ['slots', 'sessions', 'locale'];

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

  /** The session-scoped conversation service, when this dsh exposes it. */
  const conversationOf = (sessionId: string): ConversationFace | undefined => read(() => {
    const scope = ctx.sessions?.scope(sessionId);
    return scope?.get?.('conversation') as ConversationFace | undefined;
  });

  const notifyFor = (sessionId: string) => (level: 'info' | 'warn' | 'error', text: string): void => {
    try {
      const scope = ctx.sessions?.scope(sessionId);
      const conversation = scope?.get?.('conversation') as ConversationFace | undefined;
      conversation?.input?.for(scope)?.notify(level, text);
    } catch { /* a notice is best effort */ }
  };

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

  /**
   * The composer's staged images, serialized for the wire. dsh keeps the browser objects, so this is the one way a plugin
   * can see what the user attached; without it an optimisation would only ever read the text. A missing serializer is an
   * error, never a quiet text-only rewrite.
   */
  const serializeAttachments = (sessionId: string) => async (ids: readonly string[]): Promise<readonly DraftImage[]> => {
    if (ids.length === 0) return [];
    const conversation = conversationOf(sessionId);
    if (conversation?.serializeDraftAttachments === undefined) throw new Error('this dsh cannot read composer attachments');
    const { attachments } = await conversation.serializeDraftAttachments(ids);
    return (attachments ?? []).filter((part): part is DraftImage => {
      const value = part as { type?: unknown; mediaType?: unknown; data?: unknown };
      return value.type === 'image' && typeof value.mediaType === 'string' && typeof value.data === 'string';
    });
  };

  /**
   * Raise dsh's own composer block while one call is in flight. The block disables the editor, send button and IME at
   * the source. An already-raised block belongs to someone else, so it is left alone; the release only clears ours.
   */
  const lockComposer = (sessionId: string) => (reason: string): (() => void) | undefined => {
    const blocks = conversationOf(sessionId)?.blocks;
    if (blocks?.set === undefined) return undefined;
    const store = blocks.storeFor?.(sessionId);
    const current = store?.getSnapshot?.();
    if (current !== undefined) return () => {};
    const block = { reason };
    try { blocks.set(sessionId, block); } catch { return undefined; }
    return () => {
      try {
        if (store !== undefined && store.getSnapshot?.() !== block) return;
        blocks.set(sessionId, undefined);
      } catch { /* best effort */ }
    };
  };

  /**
   * Open the session the Host created. The Host created it, so the client list is refreshed first; then the workspace
   * navigation service selects it. If navigation is unavailable the caller reports the new id instead of losing it.
   */
  const openSession = async (target: string): Promise<void> => {
    try { await ctx.sessions?.refresh?.(); } catch { /* refresh is best effort */ }
    const workspace = read(() => ctx.get?.('uiWorkspace') as { openSession?(sessionId: string): void } | undefined);
    if (workspace?.openSession === undefined) throw new Error('workspace navigation is unavailable');
    workspace.openSession(target);
  };

  const panels: Panel[] = [
    {
      id: 'planToggle',
      on: (state) => isOn(state, 'planToggle'),
      setup: () => [ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'widgets-plan-toggle',
        order: 999,
        inject: (sessionId: string) => ({ togglePlan: togglePlan(sessionId), notify: notifyFor(sessionId) }),
      }, PlanToggle))],
      off: null,
    },
    {
      id: 'improvePrompt',
      on: (state) => isOn(state, 'improvePrompt'),
      setup: () => [ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'widgets-improve',
        order: 997,
        inject: (sessionId: string) => ({
          sessionId,
          store: settings,
          serializeAttachments: serializeAttachments(sessionId),
          lockComposer: lockComposer(sessionId),
          notify: notifyFor(sessionId),
          t: t(),
        }),
      }, ImproveButton))],
      off: null,
    },
    {
      id: 'handoff',
      on: (state) => isOn(state, 'handoff'),
      setup: () => [ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'widgets-handoff',
        order: 996,
        inject: (sessionId: string) => ({ sessionId, openSession, notify: notifyFor(sessionId), t: t() }),
      }, HandoffButton))],
      off: null,
    },
    {
      id: 'projectBrief',
      on: (state) => isOn(state, 'projectBrief'),
      setup: () => [ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'widgets-brief',
        order: 995,
        inject: (sessionId: string) => ({ sessionId, t: t(), notify: notifyFor(sessionId) }),
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