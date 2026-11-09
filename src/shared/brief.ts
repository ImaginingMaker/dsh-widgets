import type { LanguageSetting } from './types.js';

/** The hard cap the summary must respect, in characters. */
export const BRIEF_MAX = 500;

/** The instruction that produces a project summary from the files this plugin already reads. */
export function briefPrompt(brief: string, language: LanguageSetting = 'auto'): string {
  const zh = language === 'zh';
  const rules = zh
    ? [
      `你在为一次编码任务准备项目背景。根据下面的项目资料，写一段不超过 ${BRIEF_MAX} 个汉字的说明。`,
      '只写资料里能支持的事实，不要编造文件、脚本或依赖。',
      '必须覆盖：1) 项目是什么、用什么技术栈；2) 如何运行与如何跑测试；3) AGENTS.md 与 README 里对执行任务的要求；',
      '4) 执行任务时最容易踩的坑（例如必须遵守的目录约定、生成物、禁止改动的文件）。',
      '直接输出这段说明，不要标题、不要 Markdown 代码块、不要前后缀。',
    ]
    : [
      `You are preparing context for a coding task. From the project material below, write at most ${BRIEF_MAX} characters.`,
      'State only what the material supports; never invent files, scripts or dependencies.',
      'Cover: 1) what the project is and its stack; 2) how to run it and how to run its tests; 3) what AGENTS.md and the README',
      'require of someone making changes; 4) the traps to avoid (directory conventions, generated files, files not to touch).',
      'Answer with that text only: no heading, no code fence, no preamble.',
    ];
  return [...rules, '', '<material>', brief, '</material>'].join('\n');
}

/**
 * The model's answer pressed into a summary: whitespace collapsed, code fences and a leading title dropped, and the
 * hard cap applied on a character boundary (never mid-surrogate). An empty answer stays empty, which the caller treats
 * as a failure rather than as a summary of nothing.
 */
export function clipBrief(text: string, max = BRIEF_MAX): string {
  const cleaned = String(text ?? '')
    .replace(/```[a-zA-Z0-9]*\n?/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/^#{1,6}\s+.*\n+/u, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (cleaned === '') return '';
  const characters = [...cleaned];
  if (characters.length <= max) return cleaned;
  return `${characters.slice(0, max - 1).join('').trimEnd()}…`;
}

/**
 * A fingerprint of what the summary was made from. `HEAD` and the two files' size and mtime are enough to notice the
 * project changing, and cheap enough to recompute whenever a chat opens.
 */
export function briefSignature(parts: {
  readonly head?: string | null;
  readonly files?: readonly { readonly name: string; readonly size: number; readonly mtimeMs: number }[];
}): string {
  const files = (parts.files ?? [])
    .map((file) => `${file.name}:${file.size}:${Math.round(file.mtimeMs)}`)
    .sort()
    .join('|');
  return `${parts.head ?? ''}#${files}`;
}