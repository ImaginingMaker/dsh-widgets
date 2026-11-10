import type { LanguageSetting } from '../../shared/types.js';

/** The two languages this plugin ships. Any other UI language falls back to English. */
export type Language = 'en' | 'zh';

export const languageOf = (active: string | undefined): Language =>
  (String(active ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en');

/** The language the plugin actually speaks: a pinned choice wins, `auto` follows dsh. */
export const resolveLanguage = (setting: LanguageSetting | undefined, active: string | undefined): Language =>
  (setting === 'en' || setting === 'zh' ? setting : languageOf(active));

const DICTIONARY: Record<Language, Record<string, string>> = {
  en: {
    'widget.planToggle': 'Shift+Tab plan mode',
    'widget.planToggle.desc': 'Shift+Tab turns plan mode on, and off again when it is on. In a chat that has not started yet it writes /plan at the head of the draft instead.',
    'widget.improvePrompt': 'Improve prompt',
    'widget.improvePrompt.desc': 'A magic wand that rewrites your draft as a clearer prompt, using the model and reasoning effort chosen above.',
    'widget.handoff': 'Hand off to a new session',
    'widget.handoff.desc': 'Summarises this session as a handoff, creates a new session in the same project, and sends the handoff there so it can continue. The handoff is not written into the project.',
    'widget.projectBrief': 'Project brief',
    'widget.projectBrief.desc': 'Off by default. On the first task in a project, one quiet model call summarises the project (what it is, how to test it, what AGENTS.md and the README require) in at most 500 characters, and that summary opens the task. If it is not ready by the time you send, it is skipped, not waited for.',

    'settings.nav': 'Widgets',
    'settings.intro': 'Turn individual widgets on or off. Changes apply at once on this device.',
    'settings.search': 'Search widgets',
    'settings.searchEmpty': 'No matching widget.',
    'settings.model': 'Model',
    'settings.modelChat': 'Same as the chat',
    'settings.modelShared': 'Used by Improve prompt, Project brief and Handoff.',
    'settings.thinking': 'Reasoning',
    'settings.thinkingDefault': 'Model default',
    'settings.thinkingNone': 'This model declares no reasoning effort',
    'settings.thinkingFollowsChat': 'The chat\'s own model decides the effort',
    'settings.language': 'Language',
    'settings.languageAuto': 'Same as dsh',
    'settings.loadFailed': 'The settings could not be read: {error}',
    'settings.retry': 'Retry',


    'improve.title': 'Improve prompt',
    'improve.working': 'Optimising the prompt…',
    'improve.undo': 'Undo improvement',
    'improve.redo': 'Restore the improved prompt',
    'improve.imagesFailed': 'The images in the draft could not be read; the draft was left unchanged.',
    'improve.timeout': 'The optimisation timed out.',
    'improve.failed': 'Could not improve: {error}',
    'improve.empty': 'Type something first',

    'handoff.title': 'Hand off to a new session',
    'handoff.working': 'Preparing the handoff…',
    'handoff.done': 'Handoff sent. Continuing in a new session.',
    'handoff.failed': 'Could not hand off: {error}',
    'handoff.empty': 'This session has no task to hand off yet',
    'handoff.openFailed': 'The handoff was sent to a new session ({sessionId}), but it could not be opened automatically.',
    'handoff.completed': 'Handoff done',
    'handoff.open': 'Open the new session',
    'handoff.dismiss': 'Forget this handoff',
    'handoff.seconds': '{seconds}s',
    'handoff.elapsed': 'Preparing the handoff… {seconds}s',
    'handoff.interrupted': 'The previous handoff was interrupted',
    'handoff.timedOut': 'The handoff timed out',

    'brief.analyzing': 'Reading this project…',
    'brief.ready': 'Project brief ready',
    'brief.failed': 'Could not read this project: {error}',
    'brief.retry': 'Try again',
    'brief.reanalyze': 'Read the project again',
    'brief.preview': 'What the task will open with',
  },
  zh: {
    'widget.planToggle': 'Shift+Tab 计划模式',
    'widget.planToggle.desc': 'Shift+Tab 打开计划模式，已在计划模式时则关闭。尚未开始的会话里改为在草稿开头写入 /plan。',
    'widget.improvePrompt': '提示词优化',
    'widget.improvePrompt.desc': '用魔法棒把草稿改写为更清晰的提示词，使用上面选定的模型与推理档位。',
    'widget.handoff': '交接并新建会话',
    'widget.handoff.desc': '把当前会话整理成交接内容，在同一项目里创建新会话并自动发送交接任务，让新会话继续工作。交接内容不会写入项目。',
    'widget.projectBrief': '项目基本信息',
    'widget.projectBrief.desc': '默认关闭。项目里的第一次任务开始时，用一次静默的模型调用把项目概况（是什么、怎么跑测试、AGENTS.md 与 README 的要求）汇总成不超过 500 字，并用作该任务的背景。若在你发送时还没完成，则跳过，不等待。',

    'settings.nav': '小组件',
    'settings.intro': '逐个开启或关闭小组件。更改会立即在本设备生效。',
    'settings.search': '搜索小组件',
    'settings.searchEmpty': '没有匹配的小组件。',
    'settings.model': '模型',
    'settings.modelChat': '跟随会话模型',
    'settings.modelShared': '提示词优化、项目基本信息与交接共用这个模型。',
    'settings.thinking': '推理档位',
    'settings.thinkingDefault': '模型默认',
    'settings.thinkingNone': '该模型未配置推理档位',
    'settings.thinkingFollowsChat': '由该会话自己的模型决定档位',
    'settings.language': '语言',
    'settings.languageAuto': '跟随 dsh',
    'settings.loadFailed': '无法读取设置：{error}',
    'settings.retry': '重试',


    'improve.title': '提示词优化',
    'improve.working': '正在优化提示词…',
    'improve.undo': '撤销优化',
    'improve.redo': '恢复优化后的提示词',
    'improve.imagesFailed': '无法读取草稿中的图片，草稿未改动。',
    'improve.timeout': '优化超时。',
    'improve.failed': '优化失败：{error}',
    'improve.empty': '请先输入内容',

    'handoff.title': '交接并新建会话',
    'handoff.working': '正在整理交接内容…',
    'handoff.done': '交接已发送，已在新会话中继续。',
    'handoff.failed': '交接失败：{error}',
    'handoff.empty': '当前会话还没有可交接的任务',
    'handoff.openFailed': '交接已发送到新会话（{sessionId}），但自动切换失败。',
    'handoff.completed': '交接完成',
    'handoff.open': '打开新会话',
    'handoff.dismiss': '清除交接记录',
    'handoff.seconds': '{seconds} 秒',
    'handoff.elapsed': '正在整理交接内容… {seconds} 秒',
    'handoff.interrupted': '上一次交接被中断了',
    'handoff.timedOut': '交接超时',

    'brief.analyzing': '正在阅读本项目…',
    'brief.ready': '项目基本信息已就绪',
    'brief.failed': '无法阅读本项目：{error}',
    'brief.retry': '重试',
    'brief.reanalyze': '重新分析该项目',
    'brief.preview': '任务开始时将带上这段背景',
  },
};

export type Translate = (key: string, vars?: Record<string, string>) => string;

/** A translator for one language; `{name}` placeholders are filled from `vars`. */
export function translatorFor(language: Language): Translate {
  const pack = DICTIONARY[language] ?? DICTIONARY.en;
  return (key, vars) => {
    const text = pack[key] ?? DICTIONARY.en[key] ?? key;
    return vars === undefined ? text : text.replace(/\{(\w+)\}/g, (whole, name) => (vars[name] === undefined ? whole : String(vars[name])));
  };
}

/** Case- and accent-insensitive search over the Settings rows. */
export const fold = (text: unknown): string =>
  String(text ?? '').toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

export function matchesQuery(query: string, ...texts: unknown[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const haystack = fold(texts.join(' '));
  return words.every((word) => haystack.includes(word));
}