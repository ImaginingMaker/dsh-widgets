import { QUEUE_EDIT_PATH, QUEUE_MOVE_PATH } from '../../shared/routes.js';
import { editContentOk, mergeQueueOrder, seenOf } from '../../shared/queue.js';
import type { QueueBlock } from '../../shared/queue.js';
import type { Agent, HostContext, Inbox, InboxMessage } from '../context.js';
import { json, service } from '../context.js';

const isText = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

/** Resolve the chat's agent, or the reason the queue cannot be touched. */
async function agentOf(ctx: HostContext, sessionId: string): Promise<{ agent: Agent; inbox: Inbox } | { error: Response }> {
  const found = await ctx.sessionController?.resolveAgent(sessionId);
  if (found === undefined || 'error' in found) return { error: json({ error: 'this chat is not available' }, 409) };
  const inbox = found.agent.inbox;
  if (inbox === undefined) return { error: json({ error: 'this dsh cannot change queued messages' }, 409) };
  return { agent: found.agent, inbox };
}

/** `POST /api/widgets.queue-move` — move one of your own queued messages in dsh's own inbox, with its attachments. */
export function installQueueMove(ctx: HostContext, busy = new Set<string>()): void {
  ctx.connection.fetch.register({
    path: QUEUE_MOVE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      let body: Record<string, unknown>;
      try { body = (await request.json()) as Record<string, unknown>; } catch { return json({ error: 'bad request' }, 400); }

      const { sessionId, itemId, to, before } = body;
      if (!isText(sessionId, 200) || !isText(itemId, 512) || !Number.isSafeInteger(to) || (to as number) < 0 || !Array.isArray(before)) {
        return json({ error: 'bad request' }, 400);
      }
      if (busy.has(sessionId)) return json({ error: 'a queue change in this chat is already running' }, 409);

      busy.add(sessionId);
      try {
        const found = await agentOf(ctx, sessionId);
        if ('error' in found) return found.error;
        const { inbox } = found;
        const queue = inbox.nextTurn;
        if (queue === undefined || inbox.splice === undefined) return json({ error: 'this dsh cannot move queued messages' }, 409);

        const ids = queue.map((message) => message.id);
        const planned = mergeQueueOrder(ids, itemId, to as number, before as string[]);
        if ('error' in planned) return json({ error: planned.error }, 409);
        if (!planned.moved) return json({ moved: false });

        // One splice over the rows between the two places, in their new order: one log event, the same ids, and each
        // message keeps its own content (an attachment travels with its message).
        const from = ids.indexOf(itemId);
        const target = ids.indexOf((before as string[])[to as number]);
        const lo = Math.min(from, target);
        const hi = Math.max(from, target);
        const range = queue.slice(lo, hi + 1);
        if (!range.every((message) => message.source?.kind === 'user')) {
          return json({ error: 'only your own queued messages can move' }, 409);
        }
        const byId = new Map(range.map((message) => [message.id, message]));
        const reordered = planned.order.slice(lo, hi + 1).map((id) => byId.get(id));
        if (reordered.some((message) => message === undefined)) return json({ error: 'the queue changed' }, 409);

        inbox.splice('next-turn', lo, range.length, reordered as InboxMessage[]);
        return json({ moved: true, order: (inbox.nextTurn ?? []).map((message) => message.id) });
      } catch (error) {
        return json({ error: String((error as Error)?.message ?? error) }, 500);
      } finally {
        busy.delete(sessionId);
      }
    },
  });
}

/**
 * `POST /api/widgets.queue-edit` — give one of your own queued messages new text, images and files in place. The message
 * keeps its id and its place; `seen` refuses an edit whose message changed on another device meanwhile.
 */
export function installQueueEdit(ctx: HostContext, busy = new Set<string>()): void {
  ctx.connection.fetch.register({
    path: QUEUE_EDIT_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      let body: Record<string, unknown>;
      try { body = (await request.json()) as Record<string, unknown>; } catch { return json({ error: 'bad request' }, 400); }

      const { sessionId, itemId, content } = body;
      if (!isText(sessionId, 200) || !isText(itemId, 512) || !editContentOk(content)) return json({ error: 'bad request' }, 400);

      const uploads = service<{ resolve?(agent: Agent, id: string): unknown }>(ctx, 'fileUploads');
      const needsUploads = content.some((part) => part.type === 'file' && 'receiptId' in part);
      if (needsUploads && uploads?.resolve === undefined) return json({ error: 'this dsh cannot add files to a queued message' }, 409);
      if (busy.has(sessionId)) return json({ error: 'a queue change in this chat is already running' }, 409);

      busy.add(sessionId);
      try {
        const found = await agentOf(ctx, sessionId);
        if ('error' in found) return found.error;
        const { agent, inbox } = found;
        if (inbox.replace === undefined || inbox.nextTurn === undefined) return json({ error: 'this dsh cannot edit queued messages' }, 409);

        const message = inbox.nextTurn.find((item) => item.id === itemId);
        const gone = () => json({ error: 'this message is not in the queue any more, or it changed' }, 409);
        if (message === undefined) return gone();
        if (body.seen !== undefined && JSON.stringify(body.seen) !== JSON.stringify(seenOf(message.content as QueueBlock[]))) return gone();
        if (message.source?.kind !== 'user') return json({ error: 'only your own queued messages can be edited' }, 409);

        // Kept attachments: the message's own blocks, in the order the client asked for them.
        const own = new Map<string, QueueBlock[]>();
        for (const block of (message.content ?? []) as QueueBlock[]) {
          const id = block?.attachment?.attachmentId;
          if ((block.type === 'image' || block.type === 'file') && typeof id === 'string') {
            const key = `${block.type}:${id}`;
            own.set(key, [...(own.get(key) ?? []), block]);
          }
        }

        const blocks: unknown[] = [];
        for (const part of content) {
          if (part.type === 'text') { blocks.push({ type: 'text', text: part.text }); continue; }
          if ('attachmentId' in part) {
            const kept = own.get(`${part.type}:${part.attachmentId}`)?.shift();
            if (kept === undefined) return json({ error: 'an attachment is not in this message any more' }, 409);
            blocks.push(kept);
            continue;
          }
          if ('receiptId' in part) {
            const resolved = uploads?.resolve?.(agent, part.receiptId);
            if (resolved === undefined) return json({ error: 'a new file is not uploaded for this chat: add it again' }, 409);
            blocks.push(resolved);
            continue;
          }
          // A new image: this build leaves the bytes to dsh's own composer, which admits them per model.
          return json({ error: 'this dsh build cannot add images to a queued message: send it instead' }, 409);
        }

        // dsh's Inbox.replace takes a whole message, not just its content: give the old one back with the new blocks,
        // so id, source and place survive. Passing the blocks alone replaces the message with an id-less fragment.
        const replaced = inbox.replace(itemId, { ...message, content: blocks as InboxMessage['content'] });
        if (replaced === false) return gone();
        const edited = inbox.nextTurn.find((item) => item.id === itemId) ?? message;
        return json({ edited: true, seen: seenOf(edited.content as QueueBlock[]) });
      } catch (error) {
        return json({ error: String((error as Error)?.message ?? error) }, 500);
      } finally {
        busy.delete(sessionId);
      }
    },
  });
}