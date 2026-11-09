import React from 'react';
import { queueApi } from '../kernel/queueApi.js';
import { isOn } from '../kernel/settingsStore.js';
import type { SettingsView } from '../kernel/settingsStore.js';
import type { QueueProps } from '../slot.js';


export interface QueuedRow {
  readonly id: string;
  readonly source?: { readonly kind?: string };
  readonly content?: readonly { readonly type?: string; readonly text?: string }[];
}

const rowText = (message: QueuedRow): string =>
  (Array.isArray(message.content) ? message.content : [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text ?? '')
    .join(' ');

const ownMessage = (message: QueuedRow): boolean => message?.source?.kind === 'user';

const seenOf = (content: QueuedRow['content']): [string | null, string | undefined][] =>
  (Array.isArray(content) ? content : []).map((block) => (block?.type === 'text'
    ? ['text', block.text]
    : [block?.type ?? null, undefined]));

const CSS = '.dw-queue{display:flex;flex-direction:column;gap:2px;padding:4px 8px;font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}'
  + '.dw-queue-row{display:flex;align-items:center;gap:6px;min-height:22px;border-radius:var(--dsw-radius-sm,6px);padding:1px 4px}'
  + '.dw-queue-over{outline:1px dashed var(--dsw-alias-state-business-primary,#3b6cf6)}'
  + '.dw-grip{cursor:grab;border:0;background:none;color:inherit;font:inherit;padding:0 2px}'
  + '.dw-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  + '.dw-arrows{display:inline-flex;gap:2px}'
  + '.dw-btn{border:0;background:none;color:inherit;font:inherit;cursor:pointer;padding:0 4px;opacity:.8}'
  + '.dw-btn:disabled{opacity:.35;cursor:default}'
  + '.dw-edit{flex:1;display:flex;gap:4px;align-items:flex-start}'
  + '.dw-input{flex:1;font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:4px;padding:2px 4px}';

export interface QueuePanelProps extends QueueProps {
  readonly settings: SettingsView | { readonly on?: Record<string, boolean> };
}

/**
 * The queue strip: one row per queued message with a drag grip and the arrow keys. Both switches show the same strip;
 * each one only adds its own affordance, so turning one off leaves the other working.
 */
export function QueuePanel({ sessionId, useProjection, settings, notify, t }: QueuePanelProps): React.ReactElement | null {
  const queue = useProjection('next-turn') as readonly QueuedRow[] | undefined;
  const rows = Array.isArray(queue) ? queue : [];
  const reorderOn = isOn(settings as SettingsView, 'queueReorder');
  const editOn = isOn(settings as SettingsView, 'queueEdit');

  const [dragging, setDragging] = React.useState<number | null>(null);
  const [over, setOver] = React.useState<number | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draftText, setDraftText] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  if (!reorderOn && !editOn) return null;
  if (rows.length < 2 && editing === null) return null;

  const before = rows.map((message) => message.id);
  const api = queueApi(sessionId, before);

  /** Move one row: the Host route first (it carries attachments too); a refusal is shown, never guessed around. */
  const move = async (itemId: string, to: number): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await api.move(itemId, to);
    } catch {
      notify?.('error', t('queue.failed'));
    } finally {
      setBusy(false);
    }
  };

  const step = (index: number, delta: number): void => {
    const to = index + delta;
    if (to < 0 || to >= rows.length) return;
    if (!ownMessage(rows[index])) return;
    void move(rows[index].id, to);
  };

  const saveEdit = async (itemId: string): Promise<void> => {
    if (busy) return;
    const message = rows.find((item) => item.id === itemId);
    if (message === undefined) return;
    setBusy(true);
    try {
      await api.edit(itemId, draftText, seenOf(message.content));
      setEditing(null);
    } catch {
      notify?.('error', t('queue.failed'));
    } finally {
      setBusy(false);
    }
  };

  return React.createElement(React.Fragment, null,
    React.createElement('style', null, CSS),
    React.createElement('div', { 'data-dsh-widgets-queue': '', className: 'dw-queue', role: 'list', 'aria-label': t('queue.title') },
      ...rows.map((message, index) => {
        const mine = ownMessage(message);
        const isEditing = editing === message.id;
        return React.createElement('div', {
          key: message.id,
          role: 'listitem',
          className: `dw-queue-row${over === index && dragging !== index ? ' dw-queue-over' : ''}`,
          'data-dsh-widgets-queue-row': message.id,
          onDragOver: (event: React.DragEvent) => { if (dragging === null || !mine) return; event.preventDefault(); setOver(index); },
          onDrop: (event: React.DragEvent) => {
            event.preventDefault();
            const from = dragging;
            setDragging(null);
            setOver(null);
            if (from === null || from === index) return;
            void move(rows[from].id, index);
          },
        },
        reorderOn && mine
          ? React.createElement('button', {
            type: 'button',
            className: 'dw-grip',
            'data-dsh-widgets-grip': '',
            title: t('queue.grip'),
            'aria-label': t('queue.grip'),
            draggable: true,
            disabled: busy,
            onDragStart: () => setDragging(index),
            onDragEnd: () => { setDragging(null); setOver(null); },
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key === 'ArrowUp') { event.preventDefault(); step(index, -1); }
              if (event.key === 'ArrowDown') { event.preventDefault(); step(index, 1); }
            },
          }, '⠿')
          : null,
        isEditing
          ? React.createElement('span', { className: 'dw-edit' },
            React.createElement('textarea', {
              className: 'dw-input',
              value: draftText,
              rows: 2,
              autoFocus: true,
              'data-dsh-widgets-edit': '',
              onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setDraftText(event.target.value),
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void saveEdit(message.id); }
                if (event.key === 'Escape') { event.preventDefault(); setEditing(null); }
              },
            }),
            React.createElement('button', { type: 'button', className: 'dw-btn', disabled: busy, onClick: () => void saveEdit(message.id) }, t('queue.save')),
            React.createElement('button', { type: 'button', className: 'dw-btn', onClick: () => setEditing(null) }, t('queue.cancel')))
          : React.createElement('span', {
            className: 'dw-text',
            title: rowText(message),
            onDoubleClick: () => { if (!editOn || !mine) return; setEditing(message.id); setDraftText(rowText(message)); },
          }, rowText(message)),
        reorderOn && mine
          ? React.createElement('span', { className: 'dw-arrows' },
            React.createElement('button', {
              type: 'button', className: 'dw-btn', disabled: busy || index === 0, 'aria-label': t('queue.moveUp'),
              onClick: () => step(index, -1),
            }, '↑'),
            React.createElement('button', {
              type: 'button', className: 'dw-btn', disabled: busy || index === rows.length - 1, 'aria-label': t('queue.moveDown'),
              onClick: () => step(index, 1),
            }, '↓'))
          : null,
        editOn && mine && !isEditing
          ? React.createElement('button', {
            type: 'button', className: 'dw-btn', 'data-dsh-widgets-edit-open': '',
            onClick: () => { setEditing(message.id); setDraftText(rowText(message)); },
          }, t('queue.edit'))
          : null);
      })));
}