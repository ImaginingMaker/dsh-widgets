import React from 'react';
import { BRANCH_TARGET_PATH, TARGET_INTENT_PATH } from '../../shared/routes.js';
import { MODES } from '../../shared/types.js';
import type { TargetInfo, TargetMode } from '../../shared/types.js';
import { targetLabel } from '../../shared/targetNote.js';
import { hostJson, postJson } from '../kernel/hostJson.js';
import type { Translate } from '../kernel/i18n.js';
import type { LanguageSetting } from '../../shared/types.js';

export interface TargetState extends TargetInfo {
  readonly locked: boolean;
  readonly pending?: TargetMode;
}

export const MODE_LABEL: Record<TargetMode, string> = {
  current: 'branch.current',
  branch: 'branch.branch',
  worktree: 'branch.worktree',
  'existing-branch': 'branch.existingBranch',
  'existing-worktree': 'branch.existingWorktree',
};

const BranchIcon = (): React.ReactElement => React.createElement('svg', {
  viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', 'aria-hidden': true,
}, React.createElement('path', {
  d: 'M4.5 2.5v11M4.5 8.5c0-3 6-1.5 6-4.5M10.5 2.5v2.2',
  stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round',
}));
const Chevron = (): React.ReactElement => React.createElement('svg', {
  viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', 'aria-hidden': true,
}, React.createElement('path', { d: 'm4 6 4 4 4-4', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }));

export interface TargetChipProps {
  readonly sessionId?: string;
  readonly projectPath?: string;
  readonly language: LanguageSetting;
  readonly t: Translate;
  readonly notify?: (level: 'info' | 'warn' | 'error', text: string) => void;
  /** `picker` on the New Session row, `badge` above the composer once a chat has started. */
  readonly variant: 'picker' | 'badge';
}

/**
 * Where the next task runs.
 *
 * On the New Session row it is a chip that opens five mutually exclusive targets; picking one records the intent and
 * nothing else — the worktree comes into being at the chat's first step, and the branch itself is the agent's job.
 *
 * Once the chat has sent something it turns into a read-only badge: the choice was made at the start and is not offered
 * again, which is also what stops a mid-conversation switch from silently moving the work.
 */
export function TargetChip({ sessionId, projectPath, language, t, notify, variant }: TargetChipProps): React.ReactElement | null {
  const [state, setState] = React.useState<TargetState | undefined>(undefined);
  const [mode, setMode] = React.useState<TargetMode>('current');
  const [branchName, setBranchName] = React.useState('');
  const [existingBranch, setExistingBranch] = React.useState('');
  const [worktreePath, setWorktreePath] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);

  const load = React.useCallback(async () => {
    try {
      const query: Record<string, string> = sessionId === undefined ? { cwd: projectPath ?? '' } : { sessionId };
      const value = await hostJson<TargetState>(`${BRANCH_TARGET_PATH}?${new URLSearchParams(query)}`);
      setState(value);
      setMode(value.pending ?? value.mode ?? 'current');
      setExistingBranch(typeof value.branch === 'string' ? value.branch : '');
      setWorktreePath(value.worktrees?.[0]?.path ?? '');
      setError(undefined);
    } catch (failure) {
      setError(String((failure as Error)?.message ?? failure));
    }
  }, [sessionId, projectPath]);

  React.useEffect(() => { void load(); }, [load]);

  /** Record the choice. There is no "create" button: picking a target is the whole interaction. */
  const commit = async (next: { mode: TargetMode; branchName?: string; existingBranch?: string; worktreePath?: string }): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const body: Record<string, unknown> = { mode: next.mode };
      if (sessionId !== undefined) body.sessionId = sessionId; else body.cwd = projectPath;
      if (next.branchName !== undefined && next.branchName !== '') body.branchName = next.branchName;
      if (next.existingBranch !== undefined) body.existingBranch = next.existingBranch;
      if (next.worktreePath !== undefined) body.worktreePath = next.worktreePath;
      await postJson(TARGET_INTENT_PATH, body);
      setMode(next.mode);
      setOpen(false);
    } catch (failure) {
      const message = String((failure as Error)?.message ?? failure);
      setError(message);
      notify?.('error', t('branch.failed', { error: message }));
    } finally {
      setBusy(false);
    }
  };

  if (state === undefined) return null;
  // The badge has nothing to say about the default: only a chat that was started somewhere else needs a marker.
  if (variant === 'badge' && !state.locked) return null;
  if (variant === 'badge' && mode === 'current' && state.pending === undefined) return null;

  const base = state.branch ?? undefined;
  const label = targetLabel({
    mode,
    base,
    ...(branchName === '' ? {} : { branchName }),
    ...(existingBranch === '' ? {} : { existingBranch }),
    ...(worktreePath === '' ? {} : { worktreePath }),
  }, language);

  const chip = (interactive: boolean): React.ReactElement => React.createElement(interactive ? 'button' : 'span', {
    className: 'dw-chip',
    'data-dsh-widgets-target': variant,
    ...(interactive
      ? { type: 'button' as const, 'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-label': `${t('branch.chipTitle')}: ${label}`, onClick: () => setOpen(!open) }
      : { 'data-readonly': 'true', title: t('branch.readonly'), role: 'status' }),
  },
  React.createElement(BranchIcon),
  React.createElement('span', { className: 'dw-chip-label' }, label),
  interactive ? React.createElement(Chevron) : null);

  if (variant === 'badge' || state.locked) return chip(false);

  return React.createElement('span', { style: { position: 'relative', display: 'inline-flex' } },
    chip(true),
    open ? React.createElement('div', { role: 'dialog', 'data-dsh-widgets-target-panel': '', className: 'dw-panel', style: { top: 28, left: 0 } },
      React.createElement('div', { style: { fontWeight: 500, paddingBottom: 4 } }, t('branch.chipTitle')),
      state.repo === false ? React.createElement('div', { role: 'status', style: { fontSize: 12 } }, t('branch.notRepo')) : null,
      React.createElement('select', {
        className: 'dw-field', 'data-dsh-widgets-mode': '', value: mode,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
          const next = event.target.value as TargetMode;
          if (next === 'existing-branch') void commit({ mode: next, existingBranch: state.branch ?? state.branches[0] ?? '' });
          else if (next === 'existing-worktree') void commit({ mode: next, worktreePath: state.worktrees[0]?.path ?? '' });
          else void commit({ mode: next });
        },
      }, MODES.map((id) => React.createElement('option', { key: id, value: id }, t(MODE_LABEL[id])))),
      mode === 'branch' || mode === 'worktree'
        ? React.createElement('input', {
          type: 'text', className: 'dw-field', 'data-dsh-widgets-branch-name': '',
          value: branchName, placeholder: t('branch.nameHint'),
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => setBranchName(event.target.value),
          onBlur: () => { if (branchName.trim() !== '') void commit({ mode, branchName: branchName.trim() }); },
          onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key === 'Enter') { event.preventDefault(); if (branchName.trim() !== '') void commit({ mode, branchName: branchName.trim() }); }
          },
        })
        : null,
      mode === 'existing-branch'
        ? React.createElement('select', {
          className: 'dw-field', 'data-dsh-widgets-existing-branch': '', value: existingBranch,
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void commit({ mode, existingBranch: event.target.value }),
        }, state.branches.length === 0
          ? [React.createElement('option', { key: '', value: '' }, t('branch.none'))]
          : state.branches.map((branch) => React.createElement('option', { key: branch, value: branch }, branch)))
        : null,
      mode === 'existing-worktree'
        ? React.createElement('select', {
          className: 'dw-field', 'data-dsh-widgets-existing-worktree': '', value: worktreePath,
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void commit({ mode, worktreePath: event.target.value }),
        }, state.worktrees.length === 0
          ? [React.createElement('option', { key: '', value: '' }, t('branch.none'))]
          : state.worktrees.map((entry) => React.createElement('option', { key: entry.path, value: entry.path }, `${entry.branch ?? '?'} — ${entry.path}`)))
        : null,
      busy ? React.createElement('div', { role: 'status', style: { fontSize: 12 } }, t('branch.busy')) : null,
      error === undefined ? null : React.createElement('div', { role: 'alert', className: 'dw-error' }, error))
      : null);
}