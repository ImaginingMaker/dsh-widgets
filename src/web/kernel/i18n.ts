/** The two languages this plugin ships. Any other UI language falls back to English. */
export type Language = 'en' | 'zh';

export const languageOf = (active: string | undefined): Language =>
  (String(active ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en');

const DICTIONARY: Record<Language, Record<string, string>> = {
  en: {
    'widget.branchTarget': 'Branch per chat',
    'widget.branchTarget.desc': 'Start a task on the current branch, on a new branch, in a new worktree, or on a branch or worktree that already exists. Nothing is created until you choose: the default is the current branch.',
    'widget.branchTree': 'Branches in the workspace tree',
    'widget.branchTree.desc': 'Off by default. When on, each branch folder under .worktrees/ is added to the workspace list as a project. When off, nothing is read and nothing is added.',
    'widget.planToggle': 'Shift+Tab plan mode',
    'widget.planToggle.desc': 'Shift+Tab puts /plan at the start of the draft, or leaves plan mode when the chat is already in it.',
    'widget.queueReorder': 'Queue drag-and-drop',
    'widget.queueReorder.desc': 'Drag a queued message by its grip, or focus the grip and press the up and down keys, to change the order they will be sent in.',
    'widget.queueEdit': 'Edit queued message in place',
    'widget.queueEdit.desc': 'Double-click a queued message to change its text before it is sent. Enter saves, Esc cancels.',
    'widget.improvePrompt': 'Improve prompt',
    'widget.improvePrompt.desc': 'A magic wand that rewrites your draft as a clearer prompt. The model and the reasoning effort come from this Mac\'s own model configuration.',
    'settings.nav': 'Widgets',
    'settings.intro': 'Turn individual widgets on or off. Changes apply at once on this device.',
    'settings.search': 'Search widgets',
    'settings.searchEmpty': 'No matching widget.',
    'settings.model': 'Model',
    'settings.modelChat': 'Same as the chat',
    'settings.thinking': 'Reasoning',
    'settings.thinkingDefault': 'Model default',
    'settings.thinkingNone': 'This model declares no reasoning effort',
    'settings.mode': 'Default target for a new task',
    'settings.loadFailed': 'The settings could not be read: {error}',
    'branch.title': 'Start on',
    'branch.current': 'Current branch',
    'branch.branch': 'New branch…',
    'branch.worktree': 'New worktree…',
    'branch.existingBranch': 'An existing branch',
    'branch.existingWorktree': 'An existing worktree',
    'branch.none': 'Nothing found',
    'branch.notRepo': 'This folder is not a git repository with a commit',
    'branch.busy': 'Preparing…',
    'branch.failed': 'Could not start there: {error}',
    'branch.nameHint': 'Branch name (empty: from your message)',
    'branch.start': 'Start there',
    'branch.cancel': 'Cancel',
    'queue.title': 'Queue',
    'queue.moveUp': 'Move up',
    'queue.moveDown': 'Move down',
    'queue.edit': 'Edit',
    'queue.save': 'Save',
    'queue.cancel': 'Cancel',
    'queue.grip': 'Drag to reorder',
    'queue.failed': 'The queue changed, or the move was refused',
    'improve.title': 'Improve prompt',
    'improve.undo': 'Undo improvement',
    'improve.failed': 'Could not improve: {error}',
    'improve.empty': 'Type something first',
  },
  zh: {
    'widget.branchTarget': '按会话使用分支',
    'widget.branchTarget.desc': '在一个任务上选择：当前分支、新建分支、新建 worktree，或已有的分支与 worktree。没有选择之前不会创建任何东西，默认停留在当前分支。',
    'widget.branchTree': '工作区树中的分支目录',
    'widget.branchTree.desc': '默认关闭。开启后，.worktrees/ 下的每个分支目录会作为项目加入工作区列表；关闭时不读取、不添加任何东西。',
    'widget.planToggle': 'Shift+Tab 计划模式',
    'widget.planToggle.desc': 'Shift+Tab 在草稿开头加上 /plan；已在计划模式时则退出计划模式。',
    'widget.queueReorder': '队列拖拽排序',
    'widget.queueReorder.desc': '拖动队列消息左侧的手柄，或聚焦手柄后按上下方向键，改变它们的发送顺序。',
    'widget.queueEdit': '就地编辑队列消息',
    'widget.queueEdit.desc': '双击队列中的消息即可在发送前修改文字。Enter 保存，Esc 取消。',
    'widget.improvePrompt': '提示词优化',
    'widget.improvePrompt.desc': '用魔法棒把草稿改写为更清晰的提示词。模型与推理档位来自本机的模型配置。',
    'settings.nav': '小组件',
    'settings.intro': '逐个开启或关闭小组件。更改会立即在本设备生效。',
    'settings.search': '搜索小组件',
    'settings.searchEmpty': '没有匹配的小组件。',
    'settings.model': '模型',
    'settings.modelChat': '跟随会话模型',
    'settings.thinking': '推理档位',
    'settings.thinkingDefault': '模型默认',
    'settings.thinkingNone': '该模型未配置推理档位',
    'settings.mode': '新任务的默认目标',
    'settings.loadFailed': '无法读取设置：{error}',
    'branch.title': '开始于',
    'branch.current': '当前分支',
    'branch.branch': '新建分支…',
    'branch.worktree': '新建 worktree…',
    'branch.existingBranch': '已有分支',
    'branch.existingWorktree': '已有 worktree',
    'branch.none': '没有找到',
    'branch.notRepo': '该目录不是有提交的 git 仓库',
    'branch.busy': '正在准备…',
    'branch.failed': '无法在该目标上开始：{error}',
    'branch.nameHint': '分支名（留空则由首条消息生成）',
    'branch.start': '在这里开始',
    'branch.cancel': '取消',
    'queue.title': '队列',
    'queue.moveUp': '上移',
    'queue.moveDown': '下移',
    'queue.edit': '编辑',
    'queue.save': '保存',
    'queue.cancel': '取消',
    'queue.grip': '拖动以重新排序',
    'queue.failed': '队列已变化，或移动被拒绝',
    'improve.title': '提示词优化',
    'improve.undo': '撤销优化',
    'improve.failed': '优化失败：{error}',
    'improve.empty': '请先输入内容',
  },
};

export type Translate = (key: string, vars?: Record<string, string>) => string;

/** A translator for one UI language; `{name}` placeholders are filled from `vars`. */
export function translatorFor(active: string | undefined): Translate {
  const pack = DICTIONARY[languageOf(active)];
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