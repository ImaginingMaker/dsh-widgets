import { noteMessage, hasNote, briefNote } from './notes.js';
import type { BriefRecord } from './briefStore.js';
import { briefSignature } from '../shared/brief.js';
import { targetNote } from '../shared/targetNote.js';
import type { LanguageSetting, Target } from '../shared/types.js';
import type { HostContext } from './context.js';
import { createWorktree, currentBranch, worktreeList } from './git.js';
import { projectDirOf } from './project.js';
import type { SettingsStore } from './store.js';
import { intents } from './routes/targetIntent.js';
import { signatureOf } from './briefStore.js';

/** One chat is prepared once; a second step must not repeat the notes. */
const handled = new Set<string>();
export const HANDLED_MAX = 2000;

export interface PreStepDeps {
  readonly store: SettingsStore;
  readonly briefOf: (dir: string) => Promise<{ record?: BriefRecord; signature: string }>;
  readonly language: () => LanguageSetting;
  readonly log?: (message: string) => void;
}

/** The prefix the chat's first request carries, and where the chat actually ended up. */
export interface Preparation {
  readonly note?: string;
  readonly cwd?: string;
}

/**
 * The one place a chat is prepared: the target the composer asked for, and the project summary gathered ahead of time.
 *
 * Both are *prompts*. Nothing about the task is scripted here — creating a worktree is the single exception, and only
 * because the chat's working directory is a session property a prompt cannot change.
 */
export async function prepareChat(
  ctx: HostContext,
  deps: PreStepDeps,
  sessionId: string,
  signal?: AbortSignal,
): Promise<Preparation> {
  const settings = deps.store.read();
  const dir = await projectDirOf(ctx, { sessionId });
  const notes: string[] = [];
  let cwd: string | undefined;
  const language = deps.language();

  const intent = intents.get(sessionId);
  if (intent !== undefined) {
    intents.delete(sessionId);
    const target: Target = intent.target;
    if (target.mode === 'worktree' && dir !== undefined) {
      const created = await createWorktree(ctx.subprocess, dir, { ...(target.branchName === undefined ? {} : { branchName: target.branchName }), ...(intent.text === undefined ? {} : { text: intent.text }) }, signal);
      if ('ok' in created) {
        const moved = await moveSession(ctx, sessionId, created.ok.path, signal);
        cwd = moved ? created.ok.path : dir;
        notes.push(targetNote({ mode: 'worktree', branchName: created.ok.branch, worktreePath: created.ok.path, moved }, language));
      } else {
        deps.log?.(`dsh-widgets: could not create the worktree: ${created.error}`);
        notes.push(
          language === 'zh'
            ? `本会话原本要在新的 worktree 中工作，但创建失败：${created.error}。请先在项目目录继续，并把这件事告诉我。`
            : `This chat was meant to work in a new worktree, but creating it failed: ${created.error}. Carry on in the project folder and say so.`,
        );
      }
    } else if (target.mode === 'worktree') {
      notes.push(targetNote({ mode: 'worktree', branchName: target.branchName, worktreePath: 'the project\'s .worktrees folder' }, language));
    } else if (target.mode === 'existing-worktree') {
      const moved = dir === undefined ? false : await moveSession(ctx, sessionId, target.worktreePath, signal);
      cwd = moved ? target.worktreePath : dir;
      notes.push(targetNote({ mode: 'existing-worktree', worktreePath: target.worktreePath, moved }, language));
    } else if (target.mode === 'branch' && dir !== undefined) {
      const base = (await currentBranch(ctx.subprocess, dir, signal)) ?? null;
      notes.push(targetNote({ mode: 'branch', base, branchName: target.branchName ?? undefined }, language));
    } else if (target.mode === 'existing-branch') {
      notes.push(targetNote({ mode: 'existing-branch', existingBranch: target.existingBranch }, language));
    }
  }

  if (settings.on.projectBrief === true && dir !== undefined) {
    const { record, signature } = await deps.briefOf(dir);
    // Only a summary that was made from the project as it is now, and that is finished, may open the chat. A read still in
    // flight is never waited for: the task starts either way.
    if (record !== undefined && record.status === 'ready' && record.text !== undefined && record.text !== '' && record.signature === signature) {
      // The summary and the hierarchy it was made from travel together.
      notes.push(briefNote(record.text, record.tree, deps.language()));
    }
  }

  const note = notes.filter((entry) => entry !== '').join('\n\n');
  return { ...(note === '' ? {} : { note }), ...(cwd === undefined ? {} : { cwd }) };
}

/** Move the whole chat into another folder, so its file tools work there. Answers whether it moved. */
async function moveSession(ctx: HostContext, sessionId: string, path: string, signal?: AbortSignal): Promise<boolean> {
  const working = (() => {
    try { return ctx.get('workingDirectory') as { set?(agent: unknown, path: string, signal?: AbortSignal): Promise<string> } | undefined; } catch { return undefined; }
  })();
  if (working?.set === undefined) return false;
  try {
    const found = await ctx.sessionController?.resolveAgent(sessionId);
    if (found === undefined || 'error' in found) return false;
    await working.set(found.agent, path, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Register the hook. It answers the step unchanged whenever there is nothing to say, so a chat with the default target and
 * no project summary is exactly the chat dsh would have run.
 */
export function installPreStep(ctx: HostContext, deps: PreStepDeps): void {
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind !== 'enter') return decision;
    const sessionId = String(payload?.agent?.id ?? '');
    if (sessionId === '' || handled.has(sessionId)) return decision;
    try {
      const preparation = await prepareChat(ctx, deps, sessionId, payload.signal);
      if (handled.size > HANDLED_MAX) handled.clear();
      handled.add(sessionId);
      if (preparation.note === undefined) return decision;
      return { ...decision, messages: [noteMessage(preparation.note), ...decision.messages] };
    } catch (error) {
      deps.log?.(`dsh-widgets: could not prepare the chat: ${String((error as Error)?.message ?? error)}`);
      handled.add(sessionId);
      return decision;
    }
  }, true);
}

/** Tests only: forget which chats were prepared. */
export const resetPrepared = (): void => { handled.clear(); };

export { hasNote, briefSignature, worktreeList };