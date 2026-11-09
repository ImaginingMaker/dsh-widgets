import type { LanguageSetting } from './types.js';

/** The hard cap the summary must respect, in characters. */
export const BRIEF_MAX = 500;

/**
 * The instruction that produces a project summary.
 *
 * The plugin's material is a file hierarchy — every project has one, documented or not — plus whatever the usual documents
 * say. The judgement is the model's: it decides what the project is from the structure, rather than the plugin deciding
 * whether the project is analysable from the presence of a filename.
 */
export function briefPrompt(brief: string, language: LanguageSetting = 'auto'): string {
  const zh = language === 'zh';
  const rules = zh
    ? [
      `你在为一次编码任务准备项目背景。下面给出一个项目的文件层级结构（可能还附带 README / AGENTS.md / package.json）。`,
      `据此推断这个项目是什么，写一段不超过 ${BRIEF_MAX} 个汉字的说明。`,
      '只写结构能支持的事实，不要编造文件、脚本或依赖；结构不足时给出你最有把握的判断，不要拒绝分析。',
      '尽量覆盖：1) 项目是什么、用什么技术栈；2) 怎么运行、怎么跑测试；3) 对改动者的要求或约定；',
      '4) 最容易踩的坑（目录约定、生成物、看起来不该动的文件）。',
      '直接输出这段说明，不要标题、不要 Markdown 代码块、不要前后缀。',
    ]
    : [
      'You are preparing context for a coding task. Below is the file hierarchy of a project (possibly with its README,',
      'AGENTS.md or package.json). Infer what the project is from that structure and write at most',
      `${BRIEF_MAX} characters.`,
      'State only what the structure supports; never invent files, scripts or dependencies. If the structure is thin, give',
      'your best-judgement reading rather than declining.',
      'Prefer to cover: 1) what the project is and its stack; 2) how to run it and how to run its tests; 3) what the project',
      'expects of someone making changes; 4) the traps to avoid (directory conventions, generated files, files not to touch).',
      'Answer with that text only: no heading, no code fence, no preamble.',
    ];
  return [...rules, '', '<material>', brief, '</material>'].join('\n');
}

/**
 * A cheap, stable hash of a text, used to fold a file hierarchy into a fingerprint. Not cryptographic: it only has to
 * notice that a project's shape changed.
 */
export function textHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  return (hash >>> 0).toString(36);
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