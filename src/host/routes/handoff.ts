import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HANDOFF_PATH } from '../../shared/routes.js';
import type { HandoffResult, HandoffStatus, HandoffTimings } from '../../shared/handoff.js';
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
import { handoffFileOf, handoffStore, handoffViewOf } from '../handoffStore.js';
import { projectDirFor } from '../project.js';
import { sharedStore, settingsFileOf } from '../store.js';
import { analysisRoute } from './brief.js';

const isText = (value: unknown, max = 4096): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

/** One answer to one handoff request, kept as plain data so several callers can each build a fresh Response. */
interface Outcome {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** A refusal this plugin decided on, as opposed to a failure that escaped. */
class Refusal extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** What one model call produced, beside the text the handoff actually uses. */
interface Collected {
  readonly text: string;
  readonly reasoningChars: number;
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly reasoningTokens?: number };
}

/**
 * Stream one prepared handoff call to its text, counting what the timing record needs.
 *
 * Reasoning deltas are counted rather than kept: they never enter the note, but they explain a slow handoff.
 */
async function collect(prepared: PreparedCall, system: string, prompt: string, signal: AbortSignal): Promise<Collected> {
  let text = '';
  let reasoningChars = 0;
  let usage: Collected['usage'];
  const stream = prepared.stream({
    ...prepared.config,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    signal,
  });
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta') text += chunk.text ?? '';
    if (chunk?.type === 'reasoning-delta') reasoningChars += (chunk.text ?? '').length;
    if (chunk?.type === 'usage' && chunk.usage !== undefined) {
      const { inputTokens, outputTokens, reasoningTokens } = chunk.usage;
      usage = { ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }), ...(reasoningTokens === undefined ? {} : { reasoningTokens }) };
    }
    if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
      throw new Error(chunk.reason.failure?.message ?? 'the model call failed');
    }
  }
  return { text: text.trim(), reasoningChars, ...(usage === undefined ? {} : { usage }) };
}

const titleOf = async (query: SessionQueryService, sessionId: string, signal: AbortSignal): Promise<string | undefined> => {
  try {
    return (await query.readTitle?.(sessionId, signal))?.title?.text;
  } catch {
    return undefined;
  }
};

/** Which capability this dsh is missing, if any, before a handoff may start. */
function capabilityError(ctx: HostContext): string | undefined {
  const controller = ctx.sessionController;
  if (controller?.create === undefined || controller.prompt === undefined) return 'this dsh cannot create a new session';
  if (service<SessionQueryService>(ctx, 'sessionQuery')?.observeSession === undefined) return 'this dsh cannot read the session history';
  if (service<LlmService>(ctx, 'llm')?.prepareCall === undefined) return 'this dsh profile cannot call a model';
  return undefined;
}

/**
 * `GET|POST /api/widgets.handoff` — one click moves the current task to a new session in the same project.
 *
 * The job is owned by the Host, not by the request: switching to another session (or closing the tab) cancels only the
 * waiting, so a click that has already started finishes and can be recovered from `GET` when the user comes back.
 *
 * The Host reads the durable session surface, asks the plugin's analysis model for a structured handoff, creates a new
 * session in the current workspace (or cwd), and sends the continuation prompt there. The note exists only in memory and
 * a system temporary file; the project directory is never written to.
 */
export function installHandoff(ctx: HostContext, home: string): void {
  const store = sharedStore(settingsFileOf(home));
  const records = handoffStore(handoffFileOf(home));
  const running = new Map<string, { readonly startedAt: number; readonly promise: Promise<Outcome> }>();

  /** Write the final state of one job, so a page that comes back can say what happened. */
  const remember = async (sessionId: string, startedAt: number, outcome: Outcome): Promise<void> => {
    const finishedAt = Date.now();
    if (outcome.status === 200) {
      const body = outcome.body as unknown as Partial<HandoffResult>;
      await records.set(sessionId, {
        status: 'done',
        startedAt,
        finishedAt,
        pid: process.pid,
        ...(isText(body.sessionId, 400) ? { newSessionId: body.sessionId } : {}),
        ...(isText(body.title, 400) ? { title: body.title } : {}),
        ...(body.project === undefined ? {} : { project: body.project }),
        ...(body.timings === undefined ? {} : { timings: body.timings }),
      }).catch(() => {});
      return;
    }
    if (outcome.status >= 500) {
      await records.set(sessionId, {
        status: 'failed', startedAt, finishedAt, pid: process.pid, error: String(outcome.body.error ?? 'the handoff failed'),
      }).catch(() => {});
      return;
    }
    // A refusal (no history, no project, no model) is not a handoff that failed; nothing stays remembered.
    await records.remove(sessionId).catch(() => {});
  };

  const execute = async (sessionId: string, signal: AbortSignal, startedAt: number): Promise<Outcome> => {
    let created: string | undefined;
    let tempFile: string | undefined;
    let transcriptChars = 0;
    let modelMs = 0;
    let repairMs = 0;
    let createMs = 0;
    let promptMs = 0;
    try {
      const settings = store.read();
      const query = service<SessionQueryService>(ctx, 'sessionQuery') as SessionQueryService;
      const llm = service<LlmService>(ctx, 'llm') as LlmService;
      const controller = ctx.sessionController as NonNullable<HostContext['sessionController']>;

      // Preparation and the history read are independent: start both, and let the slower one hide the other.
      const readStart = Date.now();
      const read = (async () => {
        const value = await query.observeSession!(sessionId, { signal, projectionMode: 'all' });
        return { value, ms: Date.now() - readStart };
      })();
      const titlePromise = titleOf(query, sessionId, signal);
      const agent = await controller.resolveAgent(sessionId).catch(() => undefined);
      const found = agent !== undefined && 'agent' in agent ? agent.agent as Agent : undefined;
      const route = analysisRoute(ctx, home, found);
      if (route === undefined) throw new Refusal(409, 'no model is configured for this plugin');
      const prepareStart = Date.now();
      const prepare = (async () => {
        const info = await llm.resolveModelInfo?.(route.provider, route.model, signal);
        const controls = callControls(settings.analysis.effort, info);
        const prepared = await llm.prepareCall!({ ...route, ...controls, maxTokens: HANDOFF_MAX_TOKENS }, signal);
        return { prepared, effort: controls.reasoningEffort, ms: Date.now() - prepareStart };
      })();
      const dirPromise = projectDirFor(ctx, { sessionId, agent: found }).catch(() => undefined);

      // A refusal below leaves these in flight; their rejections are already handled so nothing escapes unhandled.
      void read.catch(() => {});
      void prepare.catch(() => {});

      const observed = await read;
      const observation: SessionObservationLike = observed.value;
      const readMsOf = observed.ms;
      const transcript = handoffTranscript(observation.events);
      transcriptChars = transcript.length;
      if (transcript.trim() === '') throw new Refusal(409, 'this session has no task history to hand off');
      const [dirFromAgent, sessionTitle, prep] = await Promise.all([dirPromise, titlePromise, prepare]);
      const dir = isText(dirFromAgent, 4096) ? dirFromAgent : observation.header?.cwd;
      if (!isText(dir, 4096)) throw new Refusal(409, 'this chat has no project folder');

      const registry = service<WorkspaceRegistry>(ctx, 'workspaceRegistry');
      const workspace = registry?.resolveByPath === undefined ? undefined : await registry.resolveByPath(dir).catch(() => undefined);
      const language = detectHandoffLanguage(observation.events, sessionTitle);
      const meta: HandoffMeta = {
        cwd: dir,
        ...(workspace?.title === undefined ? {} : { workspaceTitle: workspace.title }),
        sessionId,
        ...(sessionTitle === undefined ? {} : { sessionTitle }),
        planActive: planActiveOf(observation.projections),
      };

      const system = handoffSystem(language);
      const prompt = handoffSummaryPrompt(meta, transcript, language);
      const modelStart = Date.now();
      const first = await collect(prep.prepared, system, prompt, signal);
      modelMs = Date.now() - modelStart;
      if (first.text === '') throw new Refusal(502, 'the model gave no handoff text');

      // A Chinese session must not receive an English handoff. Retry once with a corrective prompt; English is left
      // permissive because the English template also carries other session languages.
      let handoff = first.text;
      let repaired = false;
      let reasoningChars = first.reasoningChars;
      let usage = first.usage;
      if (!handoffLanguageOk(handoff, language)) {
        const repairStart = Date.now();
        const again = await llm.prepareCall!({ ...route, ...(prep.effort === undefined ? {} : { reasoningEffort: prep.effort }), maxTokens: HANDOFF_MAX_TOKENS }, signal);
        const second = await collect(again, system, handoffLanguageRepairPrompt(handoff, language), signal);
        repairMs = Date.now() - repairStart;
        repaired = true;
        reasoningChars += second.reasoningChars;
        if (!handoffLanguageOk(second.text, language)) {
          throw new Refusal(502, 'the model did not return a Chinese handoff');
        }
        handoff = second.text;
        usage = second.usage ?? usage;
      }

      // A system temporary file, never a project file. It is deleted after the prompt is sent.
      const temp = join(tmpdir(), `dsh-widgets-handoff-${randomUUID()}.md`);
      try { writeFileSync(temp, `${handoff}\n`, { mode: 0o600 }); tempFile = temp; } catch { /* the note is in memory */ }

      const createStart = Date.now();
      const newSession = registry !== undefined && workspace !== undefined
        ? await controller.create!({ workspaceId: workspace.id })
        : await controller.create!({ cwd: dir });
      created = newSession.sessionId;
      createMs = Date.now() - createStart;

      const title = handoffTitle(meta, language);
      const continuation = handoffContinuation(handoff, meta, language);
      const promptStart = Date.now();
      const promptPromise = controller.prompt!({
        requestId: randomUUID(),
        sessionId: created,
        mode: 'queue',
        content: [{ type: 'text', text: continuation }],
      }, signal).then(() => { promptMs = Date.now() - promptStart; });
      // The title and the prompt do not depend on each other; the title is best effort, the prompt is not.
      const renamePromise = controller.rename === undefined
        ? Promise.resolve()
        : controller.rename({ sessionId: created, title }).catch(() => undefined);
      await Promise.all([promptPromise, renamePromise]);

      const timings: HandoffTimings = {
        totalMs: Date.now() - startedAt,
        readMs: readMsOf,
        prepareMs: prep.ms,
        modelMs,
        ...(repaired ? { repairMs } : {}),
        createMs,
        promptMs,
        transcriptChars,
        outputChars: handoff.length,
        reasoningChars,
        ...(usage?.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
        ...(usage?.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
        ...(usage?.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
        ...(prep.effort === undefined ? {} : { effort: prep.effort }),
        repaired,
      };
      const result: HandoffResult = {
        status: 'done',
        sessionId: created,
        newSessionId: created,
        title,
        handoff,
        project: {
          cwd: dir,
          ...(workspace === undefined ? {} : { workspaceId: workspace.id }),
          ...(workspace?.title === undefined ? {} : { title: workspace.title }),
        },
        startedAt,
        finishedAt: Date.now(),
        timings,
      };
      return { status: 200, body: result as unknown as Record<string, unknown> };
    } catch (error) {
      // A handoff that could not send its prompt leaves a blank session; archive it rather than making the user clean up.
      if (created !== undefined) {
        const registry = service<WorkspaceRegistry>(ctx, 'workspaceRegistry');
        if (registry?.archiveSession !== undefined) {
          await registry.archiveSession(created, { stopActivity: true }).catch(() => undefined);
        }
      }
      const failure = error instanceof Refusal
        ? error
        : new Refusal(502, signal.aborted ? 'the handoff timed out' : String((error as Error)?.message ?? error));
      return {
        status: failure.status,
        body: {
          error: failure.message === '' ? 'the handoff failed' : failure.message,
          ...(modelMs === 0 ? {} : { modelMs }),
        },
      };
    } finally {
      if (tempFile !== undefined) {
        try { unlinkSync(tempFile); } catch { /* already gone */ }
      }
    }
  };

  const start = (sessionId: string): Promise<Outcome> => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('the handoff timed out')), HANDOFF_TIMEOUT_MS);
    // A pending timer must not keep a short-lived process (the tests) alive.
    timer.unref?.();
    // The request's own abort is deliberately not part of this signal: leaving the session must not kill its handoff.
    const entry: { startedAt: number; promise: Promise<Outcome> } = {
      startedAt,
      promise: Promise.resolve<Outcome>({ status: 500, body: { error: 'the handoff did not start' } }),
    };
    running.set(sessionId, entry);
    void records.set(sessionId, { status: 'running', startedAt, pid: process.pid }).catch(() => {});
    entry.promise = execute(sessionId, controller.signal, startedAt)
      .then(async (outcome) => { await remember(sessionId, startedAt, outcome); return outcome; })
      .finally(() => {
        clearTimeout(timer);
        if (running.get(sessionId) === entry) running.delete(sessionId);
      });
    return entry.promise;
  };

  ctx.connection.fetch.register({
    path: HANDOFF_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      if (request.method === 'GET') {
        const sessionId = new URL(request.url).searchParams.get('sessionId');
        if (!isText(sessionId, 200)) return json({ error: 'bad request' }, 400);
        const job = running.get(sessionId);
        if (job !== undefined) return json({ status: 'running', startedAt: job.startedAt } satisfies HandoffStatus);
        return json(handoffViewOf(records.get(sessionId)));
      }

      let body: Record<string, unknown>;
      try { body = (await request.json()) as Record<string, unknown>; } catch { return json({ error: 'bad request' }, 400); }
      const sessionId = body.sessionId;
      if (!isText(sessionId, 200)) return json({ error: 'bad request' }, 400);

      if (body.dismiss === true) {
        // Dismissing a running handoff would orphan the job; only a settled one may be forgotten.
        if (running.has(sessionId)) return json({ error: 'this handoff is still running' }, 409);
        await records.remove(sessionId).catch(() => {});
        return json({ status: 'idle' } satisfies HandoffStatus);
      }

      const missing = capabilityError(ctx);
      if (missing !== undefined) return json({ error: missing }, 409);

      // A second click while the first runs joins it: one model call, one new session.
      const outcome = await (running.get(sessionId)?.promise ?? start(sessionId));
      return json(outcome.body, outcome.status);
    },
  });
}
