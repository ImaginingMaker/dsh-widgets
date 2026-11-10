import React from 'react';
import { queueApi } from '../kernel/queueApi.js';
import { isOn } from '../kernel/settingsStore.js';
import type { SettingsView } from '../kernel/settingsStore.js';
import { seenOf } from '../../shared/queue.js';
import type { QueueProps } from '../slot.js';


export interface QueuedRow {
  readonly id: string;
  readonly source?: { readonly kind?: string };
  readonly content?: readonly {
    readonly type?: string;
    readonly text?: string;
    readonly attachment?: { readonly attachmentId?: string };
  }[];
}

const rowText = (message: QueuedRow): string =>
  (Array.isArray(message.content) ? message.content : [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text ?? '')
    .join(' ');

const ownMessage = (message: QueuedRow): boolean => message?.source?.kind === 'user';

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

/** dsh's inbox projection, of which this strip reads the pending turns. */
interface InboxProjection {
  readonly 'next-turn'?: readonly QueuedRow[];
}

/**
 * The queue strip: one row per queued message with a drag grip and the arrow keys. Both switches show the same strip;
 * each one only adds its own affordance, so turning one off leaves the other working.
 *
 * The queue is `inbox['next-turn']` in dsh's projection store, not a projection of its own: `useProjection` addresses
 * whole projection values by key, so asking it for `next-turn` returns undefined and the strip never appears.
 */
export function QueuePanel({ sessionId, useProjection, settings, notify, t }: QueuePanelProps): React.ReactElement | null {
  const inbox = useProjection('inbox') as unknown as InboxProjection | undefined;
  const queue = inbox?.['next-turn'];
  const rows = Array.isArray(queue) ? queue : [];
  const reorderOn = isOn(settings as SettingsView, 'queueReorder');
  const editOn = isOn(settings as SettingsView, 'queueEdit');

  const [dragging, setDragging] = React.useState<number | null>(null);
  const [over, setOver] = React.useState<number | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draftText, setDraftText] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  if (!reorderOn && !editOn) return null;
  // One queued message still needs the strip when it is yours: its edit is what the second switch offers. With nothing
  // queued there is no row to act on, and a lone row nobody can edit or move would only duplicate dsh's own queue.
  const reorderable = rows.length > 1;
  const hasOwn = rows.some(ownMessage);
  if (!(editOn && hasOwn) && !(reorderOn && reorderable && hasOwn)) return null;

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
    // Keep every attachment the message already had, in its original place. The edit box only changes the text; a
    // message with an image or file must not lose it just because the user fixed a typo.
    const content: unknown[] = [];
    let replaced = false;
    for (const block of message.content ?? []) {
      if (block?.type === 'text') {
        if (!replaced) { content.push({ type: 'text', text: draftText }); replaced = true; }
        continue;
      }
      if ((block?.type === 'image' || block?.type === 'file') && typeof block.attachment?.attachmentId === 'string') {
        content.push({ type: block.type, attachmentId: block.attachment.attachmentId });
      }
    }
    if (!replaced) content.unshift({ type: 'text', text: draftText });
    setBusy(true);
    try {
      await api.edit(itemId, content, seenOf(message.content));
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
        reorderOn && reorderable && mine
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
        reorderOn && reorderable && mine
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