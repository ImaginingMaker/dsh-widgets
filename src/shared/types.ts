/**
 * Types shared by both halves. Nothing here may import `node:*` or a React module: this file is compiled into the
 * browser bundle as well as the Host half.
 */

/** Every widget, in Settings order. `WidgetId` is the single source of that list's type. */
export const WIDGETS = [
  'branchTarget',
  'branchTree',
  'planToggle',
  'queueReorder',
  'queueEdit',
  'improvePrompt',
  'projectBrief',
] as const;

export type WidgetId = (typeof WIDGETS)[number];

/** These do nothing until the user switches them on. */
export const OFF_BY_DEFAULT: readonly WidgetId[] = ['branchTree', 'projectBrief'];

/** The five ways a chat can start. A target is exactly one of these, which is what keeps a branch and a worktree apart. */
export const MODES = ['current', 'branch', 'worktree', 'existing-branch', 'existing-worktree'] as const;

export type TargetMode = (typeof MODES)[number];

/**
 * A target the user picked. `branchName` is only meaningful for `branch` and `worktree`; `existingBranch` only for
 * `existing-branch`; `worktreePath` only for `existing-worktree`. The union makes the invalid combinations unrepresentable.
 */
export type Target =
  | { readonly mode: 'current' }
  | { readonly mode: 'branch'; readonly branchName?: string }
  | { readonly mode: 'worktree'; readonly branchName?: string }
  | { readonly mode: 'existing-branch'; readonly existingBranch: string }
  | { readonly mode: 'existing-worktree'; readonly worktreePath: string };

/** What the picker needs to draw itself. */
export interface TargetInfo {
  readonly cwd: string;
  readonly repo: boolean;
  readonly branch: string | null;
  readonly branches: readonly string[];
  readonly worktrees: readonly { path: string; branch: string | null }[];
  readonly mode: TargetMode;
  readonly reason?: string;
}

/** Where a target was actually applied, as the Host answers it. */
export interface TargetResult {
  readonly cwd: string;
  readonly branch: string | null;
  readonly mode: TargetMode;
  readonly worktree?: string;
}

/** One model route. */
export interface ModelRoute {
  readonly provider: string;
  readonly model: string;
}

/** The UI language: follow dsh, or pin one of the two this plugin ships. */
export const LANGUAGES = ['auto', 'en', 'zh'] as const;

export type LanguageSetting = (typeof LANGUAGES)[number];

/**
 * The settings every widget starts from.
 *
 * `analysis` is deliberately one object: the model that rewrites a draft and the model that summarises a project are the
 * same choice, made once, so the user cannot end up with two different answers to "which model does this plugin use".
 */
export interface Settings {
  readonly on: Record<WidgetId, boolean>;
  readonly branchTarget: { readonly mode: TargetMode };
  readonly analysis: { readonly model: ModelRoute | null; readonly effort: string | null };
  readonly language: LanguageSetting;
}

/** What a switch or a field change may touch. */
export type SettingsPatch =
  | { readonly kind: 'switch'; readonly id: WidgetId; readonly on: boolean }
  | { readonly kind: 'analysis'; readonly patch: { readonly model?: ModelRoute | null; readonly effort?: string | null } }
  | { readonly kind: 'mode'; readonly mode: TargetMode }
  | { readonly kind: 'language'; readonly language: LanguageSetting };

/** One provider and its models, as dsh's model configuration reports them. */
export interface ModelCatalogue {
  readonly providers: readonly {
    readonly id: string;
    readonly name: string;
    readonly models: readonly { readonly id: string; readonly name: string; readonly inputModalities?: readonly string[] }[];
  }[];
}

/** The reasoning ladder one model declares. `supported: false` means the configuration declares none. */
export interface ReasoningOptions {
  readonly supported: boolean;
  readonly efforts: readonly { readonly id: string; readonly name: string; readonly description?: string }[];
  readonly defaultEffort?: string;
}

/** The controls a model call carries. An empty object is "send nothing". */
export interface CallControls {
  readonly reasoningEffort?: string;
}

/** How far a project summary has got. */
export type BriefStatus = 'idle' | 'analyzing' | 'ready' | 'failed';

/** What the composer's status icon draws. */
export interface BriefView {
  readonly status: BriefStatus;
  /** The summary, only when `ready`. */
  readonly text?: string;
  /** Why it failed, only when `failed`. */
  readonly error?: string;
  /** The project the state belongs to, so a stale answer for another folder is ignored. */
  readonly cwd?: string;
}