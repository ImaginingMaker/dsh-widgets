import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HANDOFF_PATH } from '../../shared/routes.js';
import type { HandoffResult } from '../../shared/handoff.js';
import { callControls } from '../../shared/reasoning.js';
import type {
  Agent, HostContext, LlmService, PreparedCall, SessionObservationLike, SessionQueryService, WorkspaceRegistry,
} from '../context.js';
import { json, service } from '../context.js';
import {
  detectHandoffLanguage, handoffContinuation, handoffLanguageOk, handoffLanguageRepairPrompt, handoffSummaryPrompt,
  handoffSystem, handoffTitle, handoffTranscript, planActiveOf, HANDOFF_MAX_TOKENS, HANDOFF_TIMEOUT_MS,
} from '../handoff.js';
import type { HandoffMeta } from '../handoff.js';
import { projectDirOf } from '../project.js';
import { sharedStore, settingsFileOf } from '../store.js';
import { analysisRoute } from './brief.js';

const isText = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

/** Stream one prepared handoff call to its text. */
async function collect(prepared: PreparedCall, system: string, prompt: string, signal: AbortSignal): Promise<string> {
  let text = '';
  const stream = prepared.stream({
    ...prepared.config,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    signal,
  });
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta') text += chunk.text ?? '';
    if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
      throw new Error(chunk.reason.failure?.message ?? 'the model call failed');
    }
  }
  return text.trim();
}

const titleOf = async (query: SessionQueryService, sessionId: string, signal: AbortSignal): Promise<string | undefined> => {
  try {
    return (await query.readTitle?.(sessionId, signal))?.title?.text;
  } catch {
    return undefined;
  }
};

/**
 * `POST /api/widgets.handoff` `{sessionId}` — one click moves the current task to a new session in the same project.
 *
 * The Host reads the durable session surface, asks the plugin's analysis model for a structured handoff, creates a new
 * session in the current workspace (or cwd), and sends the continuation prompt there. The note exists only in memory and
 * a system temporary file; the project directory is never written to.
 */
export function installHandoff(ctx: HostContext, home: string): void {
  const store = sharedStore(settingsFileOf(home));
  const running = new Map<string, AbortController>();

  ctx.connection.fetch.register({
    path: HANDOFF_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      let body: Record<string, unknown>;
      try { body = (await request.json()) as Record<string, unknown>; } catch { return json({ error: 'bad request' }, 400); }
      const sessionId = body.sessionId;
      if (!isText(sessionId, 200)) return json({ error: 'bad request' }, 400);

      const sessionController = ctx.sessionController;
      if (sessionController?.create === undefined || sessionController.prompt === undefined) {
        return json({ error: 'this dsh cannot create a new session' }, 409);
      }
      const query = service<SessionQueryService>(ctx, 'sessionQuery');
      if (query?.observeSession === undefined) return json({ error: 'this dsh cannot read the session history' }, 409);
      const llm = service<LlmService>(ctx, 'llm');
      if (llm?.prepareCall === undefined) return json({ error: 'this dsh profile cannot call a model' }, 409);

      running.get(sessionId)?.abort();
      const mine = new AbortController();
      running.set(sessionId, mine);
      const signal = request.signal === undefined ? mine.signal : AbortSignal.any([mine.signal, request.signal]);
      const timed = AbortSignal.any([signal, AbortSignal.timeout(HANDOFF_TIMEOUT_MS)]);
      let tempFile: string | undefined;
      let created: string | undefined;

      try {
        const observation: SessionObservationLike = await query.observeSession(sessionId, { signal: timed, projectionMode: 'all' });
        const transcript = handoffTranscript(observation.events);
        if (transcript.trim() === '') return json({ error: 'this session has no task history to hand off' }, 409);

        const dir = await projectDirOf(ctx, { sessionId }).catch(() => undefined) ?? observation.header?.cwd;
        if (!isText(dir, 4096)) return json({ error: 'this chat has no project folder' }, 409);
        const registry = service<WorkspaceRegistry>(ctx, 'workspaceRegistry');
        const workspace = registry?.resolveByPath === undefined ? undefined : await registry.resolveByPath(dir).catch(() => undefined);
        const sessionTitle = await titleOf(query, sessionId, timed);
        const language = detectHandoffLanguage(observation.events, sessionTitle);
        const meta: HandoffMeta = {
          cwd: dir,
          ...(workspace?.title === undefined ? {} : { workspaceTitle: workspace.title }),
          sessionId,
          ...(sessionTitle === undefined ? {} : { sessionTitle }),
          planActive: planActiveOf(observation.projections),
        };

        const found = ctx.sessionController === undefined
          ? undefined
          : await ctx.sessionController.resolveAgent(sessionId).catch(() => undefined);
        const agent = found === undefined || !('agent' in found) ? undefined : found.agent as Agent;
        const route = analysisRoute(ctx, home, agent);
        if (route === undefined) return json({ error: 'no model is configured for this plugin' }, 409);

        const settings = store.read();
        const info = await llm.resolveModelInfo?.(route.provider, route.model, timed);
        const controls = callControls(settings.analysis.effort, info);
        const prepared = await llm.prepareCall({ ...route, ...controls, maxTokens: HANDOFF_MAX_TOKENS }, timed);
        const summary = await collect(prepared, handoffSystem(language), handoffSummaryPrompt(meta, transcript, language), timed);
        if (summary === '') return json({ error: 'the model gave no handoff text' }, 502);

        // A Chinese session must not receive an English handoff. Retry once with a corrective prompt; English is left
        // permissive because the English template also carries other session languages.
        let handoff = summary;
        if (!handoffLanguageOk(handoff, language)) {
          const repaired = await llm.prepareCall({ ...route, ...controls, maxTokens: HANDOFF_MAX_TOKENS }, timed);
          handoff = await collect(repaired, handoffSystem(language), handoffLanguageRepairPrompt(summary, language), timed);
          if (!handoffLanguageOk(handoff, language)) {
            return json({ error: 'the model did not return a Chinese handoff' }, 502);
          }
        }

        // A system temporary file, never a project file. It is deleted after the prompt is sent.
        const temp = join(tmpdir(), `dsh-widgets-handoff-${randomUUID()}.md`);
        try { writeFileSync(temp, `${handoff}\n`, { mode: 0o600 }); tempFile = temp; } catch { /* the note is in memory */ }

        const newSession = registry !== undefined && workspace !== undefined
          ? await sessionController.create({ workspaceId: workspace.id })
          : await sessionController.create({ cwd: dir });
        created = newSession.sessionId;
        if (sessionController.rename !== undefined) {
          await sessionController.rename({ sessionId: created, title: handoffTitle(meta, language) }).catch(() => undefined);
        }

        const continuation = handoffContinuation(handoff, meta, language);
        await sessionController.prompt({
          requestId: randomUUID(),
          sessionId: created,
          mode: 'queue',
          content: [{ type: 'text', text: continuation }],
        }, timed);

        const result: HandoffResult = {
          sessionId: created,
          handoff,
          project: {
            cwd: dir,
            ...(workspace === undefined ? {} : { workspaceId: workspace.id }),
            ...(workspace?.title === undefined ? {} : { title: workspace.title }),
          },
        };
        return json(result);
      } catch (error) {
        // A handoff that could not send its prompt leaves a blank session; archive it rather than making the user clean up.
        if (created !== undefined) {
          const registry = service<WorkspaceRegistry>(ctx, 'workspaceRegistry');
          if (registry?.archiveSession !== undefined) {
            await registry.archiveSession(created, { stopActivity: true }).catch(() => undefined);
          }
        }
        if (mine.signal.aborted) return json({ error: 'a newer handoff replaced this one' }, 409);
        const message = String((error as Error)?.message ?? error);
        return json({ error: message === '' ? 'the handoff failed' : message }, 502);
      } finally {
        if (tempFile !== undefined) {
          try { unlinkSync(tempFile); } catch { /* already gone */ }
        }
        if (running.get(sessionId) === mine) running.delete(sessionId);
      }
    },
  });
}