/** Every route this plugin serves, in one place: both halves import it, so a path cannot drift between them. */
export const SETTINGS_PATH = '/api/widgets.settings';
export const MODELS_PATH = '/api/widgets.models';
export const IMPROVE_PATH = '/api/widgets.improve';
export const BRANCH_TARGET_PATH = '/api/widgets.branch-target';
export const BRANCH_TREE_PATH = '/api/widgets.branch-tree';
export const QUEUE_MOVE_PATH = '/api/widgets.queue-move';
export const QUEUE_EDIT_PATH = '/api/widgets.queue-edit';

/** How often the branch-folder sweep runs while Branches in the workspace tree is on. */
export const BRANCH_TREE_SWEEP_MS = 30_000;

/** The folder under `<project>/.worktrees/` where new worktrees are made. */
export const WORKTREES_DIR = '.worktrees';