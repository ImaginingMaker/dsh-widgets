/**
 * Types shared by both halves. Nothing here may import `node:*` or a React module: this file is compiled into the
 * browser bundle as well as the Host half.
 */

/** Every widget, in Settings order. `WidgetId` is the single source of that list's type. */
export const WIDGETS = ['branchTarget', 'branchTree', 'planToggle', 'queueReorder', 'queueEdit', 'improvePrompt'] as const;

export type WidgetId = (typeof WIDGETS)[number];

/** These do nothing until the user switches them on. */
export const OFF_BY_DEFAULT: readonly WidgetId[] = ['branchTree'];

/** The five ways a chat can start. A target is exactly one of these, which is what keeps a branch and a worktree apart. */
export const MODES = ['current', 'branch', 'worktree', 'existing-branch', 'existing-worktree'] as const;

export type TargetMode = (typeof MODES)[number];

/**
 * A stored target. `branchName` is only meaningful for `branch` and `worktree`; `existingBranch` only for
 * `existing-branch`; `worktreePath` only for `existing-worktree`. The union makes the invalid combinations unrepresentable.
 */
export type Target =
  | { readonly mode: 'current' }
  | { readonly mode: 'branch'; readonly branchName?: string }
  | { readonly mode: 'worktree'; readonly branchName?: string }
  | { readonly mode: 'existing-branch'; readonly existingBranch: string }
  | { readonly mode: 'existing-worktree'; readonly worktreePath: string };

/** Where a chat will start, as the Host answers it. */
export interface TargetResult {
  readonly cwd: string;
  readonly branch: string | null;
  readonly mode: TargetMode;
  readonly worktree?: string;
}

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

/** One model route. */
export interface ModelRoute {
  readonly provider: string;
  readonly model: string;
}

/** The settings every widget starts from. `improve.model === null` follows the chat's own model. */
export interface Settings {
  readonly on: Record<WidgetId, boolean>;
  readonly branchTarget: { readonly mode: TargetMode };
  readonly improve: { readonly model: ModelRoute | null; readonly effort: string | null };
}

/** What a switch change may touch. */
export type SettingsPatch =
  | { readonly kind: 'switch'; readonly id: WidgetId; readonly on: boolean }
  | { readonly kind: 'improve'; readonly patch: { readonly model?: ModelRoute | null; readonly effort?: string | null } }
  | { readonly kind: 'mode'; readonly mode: TargetMode };

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