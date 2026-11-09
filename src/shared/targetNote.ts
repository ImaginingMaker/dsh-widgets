import type { LanguageSetting, TargetMode } from './types.js';

/** What the Host knows when it writes the note that starts a chat on a chosen target. */
export interface NoteContext {
  readonly mode: TargetMode;
  /** The branch the project folder was on when the target was applied. */
  readonly base?: string | null;
  readonly branchName?: string;
  readonly existingBranch?: string;
  readonly worktreePath?: string;
  /** True when the session's own working directory was moved into the worktree. */
  readonly moved?: boolean;
}

const en = {
  branch: (base: string, name: string) =>
    `This session works on the new branch \`${name}\`, cut from \`${base}\` before any file was touched.\n`
    + 'Do not switch to another branch. If the branch cannot be created, say why and stop instead of working around it.',
  worktreeMoved: (name: string, path: string) =>
    `This session works in the new worktree \`${path}\`, on the new branch \`${name}\` cut from the project folder.\n`
    + 'Every edit belongs in that folder. Do not switch branches, and do not edit the main checkout.',
  worktreeElsewhere: (name: string, path: string) =>
    `This session must work in the new worktree \`${path}\`, on the new branch \`${name}\` cut from the project folder.\n`
    + `Write every file with an absolute path inside \`${path}\`, never into the main checkout.`
    + ' Do not switch branches.',
  existingBranch: (name: string) =>
    `This session works on the existing branch \`${name}\`. If the project folder is on another branch, switch to it first.`,
  existingWorktree: (name: string, path: string) =>
    `This session works in the existing worktree \`${path}\`${name === '' ? '' : ` on branch \`${name}\``}.\n`
    + `Write every file with an absolute path inside \`${path}\`.`,
};

const zh = {
  branch: (base: string, name: string) =>
    `本会话使用从 \`${base}\` 切出的新分支 \`${name}\`（在改动任何文件之前就已创建）。\n`
    + '不要切换到其它分支；如果分支创建失败，请说明原因后停下，不要绕过。',
  worktreeMoved: (name: string, path: string) =>
    `本会话在新的 worktree \`${path}\` 中工作，分支为从项目目录切出的 \`${name}\`。\n`
    + '所有改动都写在那个目录里；不要切换分支，也不要修改主检出目录。',
  worktreeElsewhere: (name: string, path: string) =>
    `本会话应当在新 worktree \`${path}\` 中工作，分支为从项目目录切出的 \`${name}\`。\n`
    + `所有文件都用 \`${path}\` 内的绝对路径写入，不要写进主检出目录；不要切换分支。`,
  existingBranch: (name: string) =>
    `本会话在已有分支 \`${name}\` 上工作。如果项目目录不在该分支，请先切换过去。`,
  existingWorktree: (name: string, path: string) =>
    `本会话在已有 worktree \`${path}\`${name === '' ? '' : `（分支 \`${name}\`）`}中工作。\n`
    + `所有文件都用 \`${path}\` 内的绝对路径写入。`,
};

const packOf = (language: LanguageSetting) => (language === 'zh' ? zh : en);

/**
 * The instruction a chat starts with, or an empty string for `current` — the default target must add nothing at all.
 *
 * This is the whole of "Branch per chat" now: the plugin states the intent and the agent carries it out with its own
 * tools, so a dirty tree, an existing branch or a failed checkout is handled by the agent (and its approvals) rather
 * than by a script that cannot see the conversation.
 */
export function targetNote(context: NoteContext, language: LanguageSetting = 'auto'): string {
  const pack = packOf(language);
  switch (context.mode) {
    case 'current':
      return '';
    case 'branch':
      return context.base == null || context.base === '' || context.branchName === undefined
        ? ''
        : pack.branch(context.base, context.branchName);
    case 'worktree':
      return context.branchName === undefined || context.worktreePath === undefined
        ? ''
        : context.moved === true
          ? pack.worktreeMoved(context.branchName, context.worktreePath)
          : pack.worktreeElsewhere(context.branchName, context.worktreePath);
    case 'existing-branch':
      return context.existingBranch === undefined ? '' : pack.existingBranch(context.existingBranch);
    case 'existing-worktree':
      return context.worktreePath === undefined
        ? ''
        : pack.existingWorktree(context.existingBranch ?? '', context.worktreePath);
  }
}

/** A one-line description of a target for the composer chip, so the chip and the note never disagree. */
export function targetLabel(context: NoteContext, language: LanguageSetting = 'auto'): string {
  const zhText = language === 'zh';
  switch (context.mode) {
    case 'current': return context.base ?? (zhText ? '当前分支' : 'current branch');
    case 'branch': return context.branchName ?? (zhText ? '新建分支' : 'new branch');
    case 'worktree': return context.branchName ?? (zhText ? '新建 worktree' : 'new worktree');
    case 'existing-branch': return context.existingBranch ?? (zhText ? '已有分支' : 'existing branch');
    case 'existing-worktree': return context.worktreePath ?? (zhText ? '已有 worktree' : 'existing worktree');
  }
}