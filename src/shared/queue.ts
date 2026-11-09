/** One content block of a queued message, as much of it as this plugin reads or writes. */
export interface QueueBlock {
  readonly type?: string;
  readonly text?: string;
  readonly attachment?: { readonly attachmentId?: string };
}

/** One queued message, as much of it as this plugin reads. */
export interface QueuedMessage {
  readonly id: string;
  readonly source?: { readonly kind?: string };
  readonly content?: readonly QueueBlock[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isText = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

/** What the user sees of one queued message: its text and attachment ids, in order. */
export const seenOf = (content: readonly QueueBlock[] | undefined): [string | null, string | undefined][] =>
  (Array.isArray(content) ? content : []).map((block) => (block?.type === 'text'
    ? ['text', block.text]
    : [block?.type ?? null, block?.attachment?.attachmentId]));

/** One part of an in-place edit, as the browser sends it. */
export type EditPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image' | 'file'; readonly attachmentId: string }
  | { readonly type: 'image'; readonly mediaType: string; readonly data: string; readonly name?: string }
  | { readonly type: 'file'; readonly receiptId: string };

export function isEditPart(part: unknown): part is EditPart {
  if (!isPlainObject(part)) return false;
  const keys = Object.keys(part);
  if (part.type === 'text' && keys.length === 2 && typeof part.text === 'string' && part.text.length <= 1e6) return true;
  if ((part.type === 'image' || part.type === 'file') && keys.length === 2 && isText(part.attachmentId, 512)) return true;
  if (part.type === 'image' && keys.every((key) => ['type', 'mediaType', 'data', 'name'].includes(key))
    && isText(part.mediaType, 64) && isText(part.data, 400e6) && (part.name === undefined || isText(part.name, 1024))) return true;
  if (part.type === 'file' && keys.length === 2 && isText(part.receiptId, 128)) return true;
  return false;
}

/** An edit body: a non-empty list of known parts, at least one of them not blank text. */
export function editContentOk(content: unknown): content is readonly EditPart[] {
  return Array.isArray(content) && content.length > 0 && content.length <= 100
    && content.every(isEditPart) && content.some((part) => part.type !== 'text' || part.text.trim() !== '');
}

/** The result of planning one move: the new order, or the reason it is refused. */
export type MovePlan =
  | { readonly moved: true; readonly order: readonly string[] }
  | { readonly moved: false; readonly order: readonly string[] }
  | { readonly error: string };

/**
 * The queue order after moving one row to index `to` of `before`, the ids the user saw. `before` must still be a
 * consistent view of the queue, so a message that started sending meanwhile is refused instead of silently reordering
 * the wrong row.
 */
export function mergeQueueOrder(ids: readonly string[], itemId: string, to: number, before: readonly string[]): MovePlan {
  if (!Array.isArray(ids) || !Array.isArray(before) || !before.every((id) => typeof id === 'string')) return { error: 'bad request' };
  if (typeof itemId !== 'string' || !Number.isSafeInteger(to) || to < 0) return { error: 'bad request' };
  if (to >= before.length) return { error: 'the queue changed' };
  const seen = ids.filter((id) => before.includes(id));
  if (seen.length !== before.length || seen.some((id, index) => id !== before[index])) return { error: 'the queue changed' };
  const from = ids.indexOf(itemId);
  const target = ids.indexOf(before[to]);
  if (from === -1 || target === -1) return { error: 'the queue changed' };
  if (from === target) return { moved: false, order: ids };
  const order = [...ids];
  const [moved] = order.splice(from, 1);
  order.splice(target, 0, moved);
  return { moved: true, order };
}