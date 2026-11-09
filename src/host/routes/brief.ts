import { BRIEF_PATH } from '../../shared/routes.js';
import { clipBrief, briefPrompt } from '../../shared/brief.js';
import type { BriefView, ModelRoute } from '../../shared/types.js';
import { callControls } from '../../shared/reasoning.js';
import type { HostContext, LlmService } from '../context.js';
import { json, service } from '../context.js';
import { briefRunner, briefStore, briefMaterial, signatureOf } from '../briefStore.js';
import type { BriefRecord } from '../briefStore.js';
import { projectDirOf } from '../project.js';
import { sharedStore, settingsFileOf } from '../store.js';

export const BRIEF_MAX_TOKENS = 1600;

const isText = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

/** The route a model call uses: the shared analysis model, else dsh's own default. */
export function analysisRoute(ctx: HostContext, home: string): ModelRoute | undefined {
  const fromSettings = sharedStore(settingsFileOf(home)).read().analysis.model;
  if (fromSettings !== null) return fromSettings;
  const defaults = service<{ currentSelection(): { provider?: string; model?: string } }>(ctx, 'agentDefaultModel');
  const selection = (() => { try { return defaults?.currentSelection(); } catch { return undefined; } })();
  return isText(selection?.provider, 200) && isText(selection?.model, 200)
    ? { provider: selection.provider, model: selection.model }
    : undefined;
}

/** One model call that turns the project material into a short summary, already clipped to the hard cap. */
async function complete(ctx: HostContext, home: string, material: string, signal: AbortSignal): Promise<{ text: string; model: string }> {
  const llm = service<LlmService>(ctx, 'llm');
  if (llm?.prepareCall === undefined) throw new Error('this dsh profile cannot call a model');
  const route = analysisRoute(ctx, home);
  if (route === undefined) throw new Error('no model is configured for this plugin');

  const settings = sharedStore(settingsFileOf(home)).read();
  const info = await llm.resolveModelInfo?.(route.provider, route.model, signal);
  const controls = callControls(settings.analysis.effort, info);
  const prepared = await llm.prepareCall({ ...route, ...controls, maxTokens: BRIEF_MAX_TOKENS }, signal);

  let text = '';
  // The resolved config travels back into `stream`: dsh rejects a dispatch whose options differ from what it prepared.
  for await (const chunk of prepared.stream({
    ...prepared.config,
    messages: [{ role: 'user', content: [{ type: 'text', text: briefPrompt(material, settings.language) }] }],
    signal,
  })) {
    if (chunk?.type === 'text-delta') text += chunk.text ?? '';
    if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
      throw new Error(chunk.reason.failure?.message ?? 'the model call failed');
    }
  }
  return { text: clipBrief(text), model: `${route.provider}/${route.model}` };
}

const viewOf = (record: BriefRecord | undefined, cwd: string | undefined): BriefView => (record === undefined
  ? { status: 'idle', ...(cwd === undefined ? {} : { cwd }) }
  : {
    status: record.status,
    ...(record.text === undefined ? {} : { text: record.text }),
    ...(record.error === undefined ? {} : { error: record.error }),
    ...(cwd === undefined ? {} : { cwd }),
  });

export interface BriefInstaller {
  readonly store: ReturnType<typeof briefStore>;
  readonly runner: ReturnType<typeof briefRunner>;
}

/**
 * `GET /api/widgets.project-brief?sessionId=` — the state of this project's summary, starting one quietly when there is
 * nothing fresh to show. `POST {sessionId, retry?}` forces a new read.
 *
 * The answer never waits for the model: a page that opens while the read is still running gets `analyzing`, and a chat
 * sent meanwhile simply goes without the summary.
 */
export function installBrief(ctx: HostContext, home: string): BriefInstaller {
  const store = briefStore(`${home}/storages/dsh-widgets/project-briefs.json`);
  const runner = briefRunner({
    store,
    signatureOf: (dir) => signatureOf(ctx.subprocess, dir),
    material: (dir) => briefMaterial(dir),
    complete: (prompt, signal) => complete(ctx, home, prompt, signal),
  });

  ctx.connection.fetch.register({
    path: BRIEF_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      let sessionId: string | undefined;
      let cwd: string | undefined;
      let retry = false;

      if (request.method === 'GET') {
        const url = new URL(request.url);
        sessionId = url.searchParams.get('sessionId') ?? undefined;
        cwd = url.searchParams.get('cwd') ?? undefined;
        retry = url.searchParams.get('retry') === '1';
      } else {
        let body: Record<string, unknown>;
        try { body = (await request.json()) as Record<string, unknown>; } catch { return json({ error: 'bad request' }, 400); }
        if (!isText(body.sessionId, 200)) return json({ error: 'bad request' }, 400);
        sessionId = body.sessionId;
        cwd = typeof body.cwd === 'string' ? body.cwd : undefined;
        retry = body.retry === true;
      }

      if (sharedStore(settingsFileOf(home)).read().on.projectBrief !== true) {
        // Off means off: no folder read, no model call, and the composer draws nothing.
        return json({ status: 'idle' });
      }

      const dir = await projectDirOf(ctx, { sessionId, cwd });
      if (dir === undefined) return json({ error: 'this chat has no project folder' }, 400);
      const { record } = await runner.ensure(dir, retry);
      return json(viewOf(record, dir));
    },
  });

  return { store, runner };
}

export { briefPrompt, clipBrief };
export type { BriefRecord };