import type { SurfaceEventLike, SurfaceMessagePart } from './context.js';

/** How much of the session history one handoff reads, and how large its model answer may become. */
export const HANDOFF_TRANSCRIPT_MAX = 24_000;
export const HANDOFF_MESSAGES_MAX = 80;
/** Of the transcript budget, this much is reserved for the human's own messages when the tail is all assistant text. */
export const HANDOFF_HUMAN_RESERVE = 2_000;
export const HANDOFF_SUMMARY_MAX = 8_000;
export const HANDOFF_MAX_TOKENS = 4_000;
export const HANDOFF_TIMEOUT_MS = 120_000;

/** The languages the handoff templates are written in. Other sessions use the English template and its mirror rule. */
export type HandoffLanguage = 'zh' | 'en';

/** How many recent user messages the language detector reads. */
export const HANDOFF_LANGUAGE_MESSAGES = 8;

/** The project and session facts the handoff prompt states explicitly. */
export interface HandoffMeta {
  readonly cwd: string;
  readonly workspaceTitle?: string;
  readonly sessionId: string;
  readonly sessionTitle?: string;
  readonly planActive?: boolean;
}

const textOf = (content: readonly SurfaceMessagePart[] | undefined): string =>
  (content ?? [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`);

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu;
const KANA_OR_HANGUL = /[\u3040-\u30ff\uac00-\ud7af]/u;
const LATIN = /[A-Za-z]/g;

/**
 * Whether one `user/message` is the human speaking.
 *
 * dsh also records its own narration as user messages — time samples, runtime-context snapshots, the skill catalogue,
 * plan-mode notices, background-job settlements. Those are English far more often than the human is, so counting them as
 * "the user's language" turned Chinese conversations into English handoffs, and putting them in the transcript spent the
 * 24k budget on text nobody asked to hand off. The human's own turn is the one with `source.kind === 'user'` (a message
 * recorded before dsh tagged sources has none at all).
 */
const isHumanVoice = (event: SurfaceEventLike): boolean => {
  const kind = event?.data?.source?.kind;
  return kind === undefined || kind === 'user';
};

/** Code, commands and URLs are not evidence of the human's language; remove them before counting. */
const stripCode = (text: string): string => text
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/`[^`\n]*`/g, ' ')
  .replace(/https?:\/\/\S+/g, ' ');

const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

/**
 * The language the handoff should be written in: the language of the human, not of the model or of the plugin UI.
 *
 * The most recent natural-language user message wins. A code-only message is skipped, so a final `npm test` does not
 * turn a Chinese conversation into an English handoff. Kana/Hangul sessions use the English template's mirror rule
 * rather than being mistaken for Chinese; sessions with no readable user text fall back to the session title, then English.
 */
export function detectHandoffLanguage(
  events: readonly SurfaceEventLike[] | undefined,
  sessionTitle?: string,
): HandoffLanguage {
  const texts: string[] = [];
  for (const event of events ?? []) {
    if (event?.type !== 'user/message') continue;
    if (!isHumanVoice(event)) continue;
    const text = textOf(event.data?.content);
    if (text !== '') texts.push(text);
  }

  for (const raw of texts.slice(-HANDOFF_LANGUAGE_MESSAGES).reverse()) {
    const text = stripCode(raw);
    if (KANA_OR_HANGUL.test(text)) return 'en';
    const cjk = count(text, CJK);
    const latin = count(text, LATIN);
    if (cjk >= 2 && cjk * 2 >= latin) return 'zh';
    if (latin >= 2 && cjk === 0) return 'en';
    // A code-only or symbol-only message carries no language signal; keep looking at earlier user messages.
  }

  const title = sessionTitle?.trim();
  if (title !== undefined && title !== '') {
    if (KANA_OR_HANGUL.test(title)) return 'en';
    if (count(title, CJK) >= 2) return 'zh';
    if (count(title, LATIN) > 0) return 'en';
  }
  return 'en';
}

/**
 * The durable conversation as a bounded handoff transcript.
 *
 * User and assistant text is the material; tool calls and results are reduced to one short line each because a handoff
 * needs the shape of what was done, not every byte a tool printed. Only the human's own messages count as user text — the
 * harness's narration (time samples, runtime snapshots, skill catalogues, mode notices) is not the task. Older entries are
 * dropped explicitly rather than silently.
 */
export function handoffTranscript(events: readonly SurfaceEventLike[] | undefined): string {
  const lines: TranscriptLine[] = [];
  for (const event of events ?? []) {
    const type = event?.type;
    const data = event?.data;
    if (type === 'user/message') {
      if (!isHumanVoice(event)) continue;
      const text = textOf(data?.content);
      if (text !== '') lines.push({ label: 'user', rendered: `[user]\n${text}` });
      continue;
    }
    if (type === 'assistant/message') {
      const text = textOf(data?.message?.content);
      if (text !== '') lines.push({ label: 'assistant', rendered: `[assistant]\n${text}` });
      continue;
    }
    if (type === 'tool/call') {
      const name = typeof data?.name === 'string' ? data.name : 'tool';
      const args = typeof data?.arguments === 'string' ? clip(data.arguments, 240) : '';
      lines.push({ label: 'tool', rendered: `[tool] ${name}${args === '' ? '' : ` ${args}`}` });
      continue;
    }
    if (type === 'tool/result') {
      const text = textOf(data?.message?.content);
      if (text !== '') lines.push({ label: 'tool result', rendered: `[tool result]\n${clip(text, 400)}` });
    }
  }

  if (lines.length === 0) return '';
  let omitted = false;
  let kept = lines;
  if (kept.length > HANDOFF_MESSAGES_MAX) {
    kept = kept.slice(-HANDOFF_MESSAGES_MAX);
    omitted = true;
  }

  const rendered = kept.map(renderLine);
  const joined = rendered.join('\n\n');
  let tailLines = kept;
  if (joined.length > HANDOFF_TRANSCRIPT_MAX) {
    // A long turn of assistant and tool text can fill the whole tail. Walk back from the end so the tail fits, leaving
    // room for the human's own messages that this tail would otherwise cut away.
    const tailMax = HANDOFF_TRANSCRIPT_MAX - HANDOFF_HUMAN_RESERVE;
    let at = kept.length;
    let used = 0;
    while (at > 0) {
      const size = rendered[at - 1].length + (used === 0 ? 0 : 2);
      if (used + size > tailMax) break;
      used += size;
      at -= 1;
    }
    tailLines = kept.slice(at);
    omitted = true;
  }

  // Reserve the human's most recent messages when the kept tail does not carry them: the task statement is generally the
  // oldest thing in a long session, and it is the one line a handoff cannot do without.
  const inTail = new Set(tailLines);
  const reserved: string[] = [];
  let reservedChars = 0;
  for (let index = lines.length - 1; index >= 0 && reservedChars < HANDOFF_HUMAN_RESERVE; index -= 1) {
    const line = lines[index];
    if (line.label !== 'user' || inTail.has(line)) continue;
    const room = HANDOFF_HUMAN_RESERVE - reservedChars;
    const value = renderLine(line);
    const fitted = value.length > room ? clip(value, room) : value;
    reserved.unshift(fitted);
    reservedChars += fitted.length + 2;
  }

  // One message longer than the whole budget is clipped rather than dropped to the reserve.
  const tail = tailLines.length === 0
    ? clip(renderLine(kept[kept.length - 1]), HANDOFF_TRANSCRIPT_MAX)
    : tailLines.map(renderLine).join('\n\n');
  if (reserved.length === 0) return omitted ? `${OMITTED}\n\n${tail}` : tail;
  return `${OMITTED}\n\n${reserved.join('\n\n')}\n\n(messages between these and the following transcript omitted)\n\n${tail}`;
}

/** One rendered line of the handoff transcript, plus who produced it (used to reserve the human's own messages). */
interface TranscriptLine {
  readonly label: 'user' | 'assistant' | 'tool' | 'tool result';
  readonly rendered: string;
}

const renderLine = (line: TranscriptLine): string => line.rendered;

const OMITTED = '(earlier messages omitted)';

/** Whether the session's plan projection says plan mode is active. */
export const planActiveOf = (projections: { readonly values?: Record<string, unknown> } | undefined): boolean => {
  const plan = projections?.values?.plan as { readonly active?: unknown } | undefined;
  return plan?.active === true;
};

/** The system prompt for the handoff call, matched to the detected session language. */
export const handoffSystem = (language: HandoffLanguage): string => (language === 'zh'
  ? '你负责为下一个 agent 会话撰写简洁、事实准确的中文交接说明。代码、文件路径、命令和专有名词保留原文。'
  : 'You write a concise, factual handoff note for the next agent session in the same natural language as the user\'s messages. Preserve code, file paths, commands and proper nouns.');

/** The instruction that turns a transcript into a structured handoff note. */
export function handoffSummaryPrompt(meta: HandoffMeta, transcript: string, language: HandoffLanguage = 'en'): string {
  if (language === 'zh') {
    return [
      '你在为下一个 agent 会话准备一份交接说明。阅读下面的会话记录，写一份新的同事可以直接接手的 Markdown 交接。',
      '交接正文必须使用中文；代码、文件路径、命令、错误信息和专有名词保留原文。',
      '只写记录支持的事实；不要编造文件、命令或测试结果；记录不足时明确写出未知项。',
      '不要只罗列已完成事项，也不要用 todo 状态代替计划。',
      '必须区分：已完成、进行中、未验证、阻塞；不要声称未验证的内容已经验证。',
      '必须包含以下小节：',
      '## 项目与目标',
      '## 当前状态',
      '## 已完成的工作',
      '## 关键决策与约束',
      '## 当前计划与下一步',
      '## 风险、未验证项与待确认问题',
      '## 继续工作的验收条件',
      '当前计划与下一步必须写成具体可执行动作，并给出验收条件；控制在约 1000 字以内。',
      '只输出交接正文，不要前后缀。',
      '',
      `<project>${meta.cwd}</project>`,
      ...(meta.workspaceTitle === undefined ? [] : [`<workspace>${meta.workspaceTitle}</workspace>`]),
      `<session>${meta.sessionTitle ?? meta.sessionId}</session>`,
      ...(meta.planActive === true ? ['<plan-mode>上一个会话处于计划模式。</plan-mode>'] : []),
      '',
      '<transcript>',
      transcript,
      '</transcript>',
    ].join('\n');
  }
  return [
    'You are preparing a handoff note for the next agent session. Read the transcript below and write a Markdown handoff a new colleague can continue from.',
    'Write the handoff in the same natural language as the user\'s messages. If that language is not English, keep it and translate the section headings accordingly. Preserve code, file paths, commands, error strings and proper nouns.',
    'State only what the transcript supports; never invent files, commands or test results. When something is unknown, say so.',
    'Do not merely list completed items, and do not use todo status as the plan.',
    'Distinguish completed, in progress, unverified and blocked work; never claim unverified content was verified.',
    'Use exactly these sections (translated into the session language when needed):',
    '## Project and goal',
    '## Current state',
    '## Completed work',
    '## Decisions and constraints',
    '## Current plan and next steps',
    '## Risks, unverified items and open questions',
    '## Acceptance checks for continuing',
    'The current plan and next steps must be concrete actions with acceptance checks. Keep it to roughly 1000 words.',
    'Return the handoff only, with no preamble or code fence.',
    '',
    `<project>${meta.cwd}</project>`,
    ...(meta.workspaceTitle === undefined ? [] : [`<workspace>${meta.workspaceTitle}</workspace>`]),
    `<session>${meta.sessionTitle ?? meta.sessionId}</session>`,
    ...(meta.planActive === true ? ['<plan-mode>The previous session was in plan mode.</plan-mode>'] : []),
    '',
    '<transcript>',
    transcript,
    '</transcript>',
  ].join('\n');
}

/** The user message the new session receives: the handoff, its project, and the explicit continuation contract. */
export function handoffContinuation(summary: string, meta: HandoffMeta, language: HandoffLanguage = 'en'): string {
  const note = clip(summary.trim(), HANDOFF_SUMMARY_MAX);
  if (language === 'zh') {
    return [
      '你正在接手上一个会话。下面的交接说明是上个会话任务历史的权威摘要；在开始任何工作之前先完整读懂它。',
      '请使用中文继续。',
      '',
      `<project>${meta.cwd}</project>`,
      ...(meta.workspaceTitle === undefined ? [] : [`<workspace>${meta.workspaceTitle}</workspace>`]),
      `<previous-session>${meta.sessionTitle ?? meta.sessionId}</previous-session>`,
      ...(meta.planActive === true ? ['<plan-mode>上个会话处于计划模式。继续以计划的方式工作。</plan-mode>'] : []),
      '',
      '<handoff>',
      note,
      '</handoff>',
      '',
      '请立即按以下要求准备继续：',
      '1. 把上面的 handoff 当作上个会话的任务历史，不要要求用户重新复述。',
      '2. 先复述当前项目、任务状态和已有计划，确认你已经理解。',
      '3. 继续拓展计划：补齐下一步、开放问题与验收条件；在用户明确批准之前不要开始实现。',
      '4. 不要重复已经完成的工作；交接信息不足时先向用户提问，不要猜测。',
    ].join('\n');
  }
  return [
    'You are taking over from another session. The handoff note below is the authoritative summary of the previous session\'s task history; read it completely before doing anything else.',
    'Continue in the language of the handoff. If the handoff is not in English, keep using its language.',
    '',
    `<project>${meta.cwd}</project>`,
    ...(meta.workspaceTitle === undefined ? [] : [`<workspace>${meta.workspaceTitle}</workspace>`]),
    `<previous-session>${meta.sessionTitle ?? meta.sessionId}</previous-session>`,
    ...(meta.planActive === true ? ['<plan-mode>The previous session was in plan mode. Continue in that planning posture.</plan-mode>'] : []),
    '',
    '<handoff>',
    note,
    '</handoff>',
    '',
    'Prepare to continue now:',
    '1. Treat this handoff as the previous session\'s task history; do not ask the user to repeat it.',
    '2. First restate the project, the current task state and the existing plan so the user can confirm you understand.',
    '3. Continue expanding the plan: add the next concrete steps, open questions and acceptance checks. Do not start implementing until the user explicitly approves.',
    '4. Do not repeat completed work. If the handoff is insufficient, ask the user instead of guessing.',
  ].join('\n');
}

/**
 * A Chinese section heading as models actually write it: any heading level, optional bold markers, optional numbering.
 *
 * This is deliberately tolerant. The strict `## 项目与目标` form once rejected `### 项目与目标`, `## **项目与目标**` and
 * `## 1. 项目与目标`, and every rejection cost a whole second generation of the same note.
 */
const CHINESE_HEADING = /^ {0,3}#{2,6}[ \t]*(?:\*\*|__)?[ \t]*(?:\d+[.、)）][ \t]*)?(?:\*\*|__)?[ \t]*(?:项目与目标|当前计划与下一步|已完成的工作)/m;

/** Whether a generated handoff actually uses the target language. English is not hard-failed because it also carries other languages. */
export const handoffLanguageOk = (text: string, language: HandoffLanguage): boolean => {
  if (text.trim() === '') return false;
  if (language !== 'zh') return true;
  return count(text, CJK) >= 8 && CHINESE_HEADING.test(text);
};

/** One corrective instruction used when a Chinese session produced a non-Chinese handoff. */
export const handoffLanguageRepairPrompt = (previous: string, language: HandoffLanguage): string => {
  if (language === 'zh') {
    return [
      '上一份交接没有使用中文。请保持以下交接的事实、结构、代码、路径和命令原文，用中文重写。',
      '仍然必须包含以下小节：## 项目与目标、## 当前状态、## 已完成的工作、## 关键决策与约束、## 当前计划与下一步、## 风险、未验证项与待确认问题、## 继续工作的验收条件。',
      '不要添加新事实。只输出重写后的交接，不要解释。',
      '',
      '<previous>',
      clip(previous.trim(), HANDOFF_SUMMARY_MAX),
      '</previous>',
    ].join('\n');
  }
  return [
    'The previous handoff did not use the session language. Keep its facts, structure, code, paths and commands, and rewrite it in the same natural language as the user\'s messages.',
    'Keep the seven sections. Do not add new facts. Return the rewritten handoff only.',
    '',
    '<previous>',
    clip(previous.trim(), HANDOFF_SUMMARY_MAX),
    '</previous>',
  ].join('\n');
};

/** An existing handoff title prefix, so handing off a handoff does not stack `交接 — 交接 — …`. */
const EXISTING_PREFIX = /^\s*(?:handoff|交接)\s*[—–-]\s*/i;

/** A stable display title for the new session, derived from the old session and project. */
export const handoffTitle = (meta: HandoffMeta, language: HandoffLanguage = 'en'): string => {
  const prefix = language === 'zh' ? '交接' : 'Handoff';
  let name = meta.sessionTitle?.trim() ?? '';
  while (EXISTING_PREFIX.test(name)) name = name.replace(EXISTING_PREFIX, '').trim();
  if (name !== '') return `${prefix} — ${clip(name, 80)}`;
  const project = meta.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? 'project';
  return `${prefix} — ${project}`;
};