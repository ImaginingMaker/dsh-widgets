import React from 'react';
import { BRANCH_TARGET_PATH } from '../../shared/routes.js';
import { MODES } from '../../shared/types.js';
import type { TargetInfo, TargetMode, TargetResult } from '../../shared/types.js';
import { hostJson, postJson } from '../kernel/hostJson.js';
import type { SlotBase } from '../slot.js';

export const MODE_LABEL: Record<TargetMode, string> = {
  current: 'branch.current',
  branch: 'branch.branch',
  worktree: 'branch.worktree',
  'existing-branch': 'branch.existingBranch',
  'existing-worktree': 'branch.existingWorktree',
};

const PANEL_STYLE: React.CSSProperties = {
  position: 'absolute', zIndex: 40, padding: 12, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 4,
  borderRadius: 'var(--dsw-radius-md,8px)', border: '.5px solid var(--dsw-alias-border-l2,#ccc)',
  background: 'var(--dsw-alias-bg-layer-1,#fff)', color: 'var(--dsw-alias-label-primary,inherit)',
  boxShadow: 'var(--dsw-elevation-soft,0 4px 16px rgba(0,0,0,.16))',
};

const FIELD_STYLE: React.CSSProperties = {
  font: 'inherit', fontSize: 12, padding: '3px 6px', borderRadius: 6,
  border: '.5px solid var(--dsw-alias-border-l2,#ccc)', background: 'transparent', color: 'inherit',
};

export interface BranchTargetButtonProps extends SlotBase {
  readonly sessionId?: string;
  readonly projectPath?: string;
  readonly startIn?: (target: TargetResult) => void;
}

/**
 * The target picker. Nothing is created until **Start there**, which is what makes the default a true no-op: on the
 * current branch the Host runs no git at all.
 */
export function BranchTargetButton({ sessionId, projectPath, startIn, t, notify }: BranchTargetButtonProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [info, setInfo] = React.useState<TargetInfo | undefined>(undefined);
  const [mode, setMode] = React.useState<TargetMode>('current');
  const [branchName, setBranchName] = React.useState('');
  const [existingBranch, setExistingBranch] = React.useState('');
  const [worktreePath, setWorktreePath] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);

  const load = async (): Promise<void> => {
    try {
      const query: Record<string, string> = sessionId === undefined ? { cwd: projectPath ?? '' } : { sessionId };
      const value = await hostJson<TargetInfo>(`${BRANCH_TARGET_PATH}?${new URLSearchParams(query)}`);
      setInfo(value);
      setMode(value.mode ?? 'current');
      setExistingBranch(typeof value.branch === 'string' ? value.branch : '');
      setWorktreePath(value.worktrees?.[0]?.path ?? '');
    } catch (failure) {
      setError(String((failure as Error)?.message ?? failure));
    }
  };

  const start = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const body: Record<string, unknown> = { mode };
      if (sessionId !== undefined) body.sessionId = sessionId; else body.cwd = projectPath;
      if ((mode === 'branch' || mode === 'worktree') && branchName.trim() !== '') body.branchName = branchName.trim();
      if (mode === 'existing-branch') body.existingBranch = existingBranch;
      if (mode === 'existing-worktree') body.worktreePath = worktreePath;
      const value = await postJson<TargetResult>(BRANCH_TARGET_PATH, body);
      setOpen(false);
      startIn?.(value);
    } catch (failure) {
      const message = String((failure as Error)?.message ?? failure);
      setError(message);
      notify?.('error', t('branch.failed', { error: message }));
    } finally {
      setBusy(false);
    }
  };

  const label = typeof info?.branch === 'string' ? `${t('branch.title')}: ${info.branch}` : t('branch.title');
  const worktrees = info?.worktrees ?? [];
  const branches = info?.branches ?? [];

  return React.createElement('span', { 'data-dsh-widgets-branch': '', style: { display: 'inline-flex', alignItems: 'center', gap: 6, position: 'relative' } },
    React.createElement('button', {
      type: 'button', className: 'dw-btn', 'aria-haspopup': 'dialog', 'aria-expanded': open, disabled: busy,
      'data-dsh-widgets-branch-open': '', onClick: () => { if (!open) return load().then(() => setOpen(true)); setOpen(false); return undefined; },
    }, label),
    open ? React.createElement('div', { role: 'dialog', 'data-dsh-widgets-branch-panel': '', style: PANEL_STYLE },
      React.createElement('div', { style: { fontWeight: 500, paddingBottom: 4 } }, t('branch.title')),
      info?.repo === false ? React.createElement('div', { role: 'status', style: { fontSize: 12 } }, t('branch.notRepo')) : null,
      React.createElement('select', {
        'data-dsh-widgets-mode': '', value: mode, style: FIELD_STYLE,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setMode(event.target.value as TargetMode),
      }, MODES.map((id) => React.createElement('option', { key: id, value: id }, t(MODE_LABEL[id])))),
      mode === 'branch' || mode === 'worktree'
        ? React.createElement('input', {
          type: 'text', value: branchName, placeholder: t('branch.nameHint'), style: FIELD_STYLE,
          'data-dsh-widgets-branch-name': '', onChange: (event: React.ChangeEvent<HTMLInputElement>) => setBranchName(event.target.value),
        })
        : null,
      mode === 'existing-branch'
        ? React.createElement('select', {
          value: existingBranch, style: FIELD_STYLE, 'data-dsh-widgets-existing-branch': '',
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setExistingBranch(event.target.value),
        }, branches.length === 0
          ? [React.createElement('option', { key: '', value: '' }, t('branch.none'))]
          : branches.map((branch) => React.createElement('option', { key: branch, value: branch }, branch)))
        : null,
      mode === 'existing-worktree'
        ? React.createElement('select', {
          value: worktreePath, style: FIELD_STYLE, 'data-dsh-widgets-existing-worktree': '',
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setWorktreePath(event.target.value),
        }, worktrees.length === 0
          ? [React.createElement('option', { key: '', value: '' }, t('branch.none'))]
          : worktrees.map((entry) => React.createElement('option', { key: entry.path, value: entry.path }, `${entry.branch ?? '?'} — ${entry.path}`)))
        : null,
      React.createElement('div', { style: { display: 'flex', gap: 6, paddingTop: 6 } },
        React.createElement('button', {
          type: 'button', className: 'dw-btn', 'data-dsh-widgets-branch-start': '', disabled: busy, onClick: start,
        }, busy ? t('branch.busy') : t('branch.start')),
        React.createElement('button', { type: 'button', className: 'dw-btn', onClick: () => setOpen(false) }, t('branch.cancel'))),
      error === undefined ? null : React.createElement('div', { role: 'alert', style: { fontSize: 12 } }, error))
      : null);
}