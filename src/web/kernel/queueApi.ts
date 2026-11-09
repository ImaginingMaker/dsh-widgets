import { postJson } from './hostJson.js';
import { QUEUE_EDIT_PATH, QUEUE_MOVE_PATH } from '../../shared/routes.js';


/** The queue calls one strip makes, bound to one chat and to the queue the user saw. */
export function queueApi(sessionId: string, before: readonly string[]) {
  return {
    move: (itemId: string, to: number): Promise<unknown> =>
      postJson(QUEUE_MOVE_PATH, { sessionId, itemId, to, before }),
    edit: (itemId: string, text: string, seen: unknown): Promise<unknown> =>
      postJson(QUEUE_EDIT_PATH, { sessionId, itemId, content: [{ type: 'text', text }], seen }),
  };
}