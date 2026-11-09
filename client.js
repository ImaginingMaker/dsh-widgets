/**
 * dsh-widgets — Client half.
 *
 * Six small widgets, each with its own switch in Settings → Widgets. Switching one off disposes exactly what that panel
 * registered (slot occupants, listeners, styles), and the settings section is the only place that writes a switch.
 *
 * Nothing here edits dsh's own markup: every control rides a published slot, so a dsh update cannot leave a half-drawn
 * control behind.
 */
window.__ModuleLoader__.load({
  id: 'dsh-widgets',
  factory(require) {
    const React = require('react');
    let primitives = {};
    try { primitives = require('@deepseek-ai/dsh-client-ui-primitives') ?? {}; } catch { primitives = {}; }

    /* -------------------------------------------------------------------------------------------------------- strings */

    /** English and Chinese only. Any other UI language is shown in English. */
    const STRINGS = {
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

    const languageOf = (active) => (String(active ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
    /** A translator for one UI language; `{name}` placeholders are filled from `vars`. */
    function translatorFor(active) {
      const pack = STRINGS[languageOf(active)] ?? STRINGS.en;
      return (key, vars) => {
        const text = pack[key] ?? STRINGS.en[key] ?? key;
        return vars === undefined ? text : text.replace(/\{(\w+)\}/g, (whole, name) => (vars[name] === undefined ? whole : String(vars[name])));
      };
    }

    /* ----------------------------------------------------------------------------------------------------------- api */

    const SETTINGS_ROUTE = '/api/widgets.settings';
    const MODELS_ROUTE = '/api/widgets.models';
    const IMPROVE_ROUTE = '/api/widgets.improve';
    const TARGET_ROUTE = '/api/widgets.branch-target';
    const MOVE_ROUTE = '/api/widgets.queue-move';
    const EDIT_ROUTE = '/api/widgets.queue-edit';

    /** One JSON call to this plugin's Host half; a non-2xx answer becomes an Error carrying the Host's message. */
    async function hostJson(url, init) {
      const response = await fetch(url, init);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
      return data;
    }

    const postJson = (url, body) => hostJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    /** The switches and the Improve prompt settings. The Host half is the one source of truth for every window. */
    function createSettings(fetchJson = hostJson) {
      let state = { ready: false, on: {}, branchTarget: { mode: 'current' }, improve: { model: null, effort: null }, error: undefined };
      const listeners = new Set();
      const emit = () => { for (const listener of [...listeners]) listener(); };
      let busy = false;
      const adopt = (value) => {
        state = {
          ...value,
          on: value?.on ?? {},
          branchTarget: value?.branchTarget ?? { mode: 'current' },
          improve: value?.improve ?? { model: null, effort: null },
          ready: true,
          error: undefined,
        };
      };
      return {
        getSnapshot: () => state,
        subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        async load() {
          try { adopt(await fetchJson(SETTINGS_ROUTE)); } catch (error) { state = { ...state, ready: true, error: String(error?.message ?? error) }; }
          emit();
          return state;
        },
        async save(body) {
          if (busy) return state;
          busy = true;
          try { adopt(await postJson(SETTINGS_ROUTE, body)); } catch (error) { state = { ...state, error: String(error?.message ?? error) }; } finally { busy = false; }
          emit();
          return state;
        },
      };
    }

    /** Branches in the workspace tree is the one widget that stays off until the user asks for it. */
    const OFF_BY_DEFAULT = ['branchTree'];
    const isOn = (settings, id) => (OFF_BY_DEFAULT.includes(id) ? settings?.on?.[id] === true : settings?.on?.[id] !== false);
    /** The queue strip is one panel that serves two switches. */
    const queueOn = (settings) => isOn(settings, 'queueReorder') || isOn(settings, 'queueEdit');

    /** The model list from this Mac's configuration, plus one model's reasoning efforts on demand. */
    function createModels(fetchJson = hostJson) {
      let state = { providers: [], reasoning: {}, error: undefined };
      const listeners = new Set();
      const emit = () => { for (const listener of [...listeners]) listener(); };
      return {
        getSnapshot: () => state,
        subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        async load() {
          try {
            const value = await fetchJson(MODELS_ROUTE);
            state = { ...state, providers: Array.isArray(value?.providers) ? value.providers : [], error: undefined };
          } catch (error) { state = { ...state, error: String(error?.message ?? error) }; }
          emit();
          return state;
        },
        /** The efforts one model declares, from the local configuration. Cached per route. */
        async reasoningOf(provider, model) {
          const key = `${provider}\u0000${model}`;
          if (state.reasoning[key] !== undefined) return state.reasoning[key];
          let reasoning = { supported: false, efforts: [] };
          try {
            const value = await fetchJson(`${MODELS_ROUTE}?${new URLSearchParams({ provider, model })}`);
            if (value?.reasoning !== undefined) reasoning = value.reasoning;
          } catch { /* an unreadable route reads as "no efforts" */ }
          state = { ...state, reasoning: { ...state.reasoning, [key]: reasoning } };
          emit();
          return reasoning;
        },
      };
    }

    /* ---------------------------------------------------------------------------------------------------- plan mode */

    /** `/plan` at the very start (so `/planning` is not the command) plus at most one following space or tab. */
    const PLAN_PREFIX = /^\/plan(?=$|\s)[ \t]?/;
    /** Shift+Tab edit: drop a leading `/plan` command, otherwise prepend one. */
    function planToggle(draft) {
      const match = PLAN_PREFIX.exec(draft);
      return match === null ? { start: 0, end: 0, text: '/plan ' } : { start: 0, end: match[0].length, text: '' };
    }
    /** Shift+Tab on every platform, and nothing else. */
    const isPlanKey = (event) => event.key === 'Tab' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;

    /** Shift+Tab toggles the draft's `/plan` prefix, or leaves plan mode through dsh's own `/plan off`. */
    function PlanToggle({ useInput, inputActions, useProjection, exitPlanMode, notify }) {
      const draft = useInput((state) => (state === undefined ? '' : state.draft));
      const plan = typeof useProjection === 'function' ? useProjection('plan') : undefined;
      const planOn = plan !== undefined && (plan.pending ? !plan.active : plan.active);
      const live = React.useRef(null);
      live.current = { draft, inputActions, planOn, exitPlanMode, notify };
      const anchor = React.useRef(null);

      React.useEffect(() => {
        const seat = anchor.current === null ? null : anchor.current.closest('[data-composer-seat]');
        if (seat === null) return undefined;
        const onKeyDown = (event) => {
          if (!isPlanKey(event)) return;
          const input = event.target instanceof Element ? event.target.closest('[data-composer-input]') : null;
          if (input === null || !input.isContentEditable || input.closest('[data-composer-seat]') !== seat) return;
          if (seat.querySelector('[data-trigger-menu]') !== null) return; // Shift+Tab closes an open slash menu
          event.preventDefault();
          event.stopPropagation();
          const current = live.current;
          if (event.repeat || event.isComposing || event.keyCode === 229) return;
          if (current.planOn && current.exitPlanMode !== undefined) {
            current.exitPlanMode().then(
              (failure) => { if (failure !== null && current.notify !== undefined) current.notify('error', failure); },
              (reason) => { if (current.notify !== undefined) current.notify('error', reason instanceof Error ? reason.message : String(reason)); },
            );
            return;
          }
          if (current.inputActions === undefined) return;
          const { start, end, text } = planToggle(current.draft);
          // Only the prefix is edited, so the rest of the draft, its file chips and its attachments stay intact.
          if (!current.inputActions.insertText(text, { ...current.inputActions.captureInsertion(), start, end })) return;
          requestAnimationFrame(() => {
            if (!input.isConnected) return;
            const range = document.createRange();
            range.selectNodeContents(input);
            range.collapse(false);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
          });
        };
        seat.addEventListener('keydown', onKeyDown, true);
        return () => { seat.removeEventListener('keydown', onKeyDown, true); };
      }, []);

      return React.createElement('span', { ref: anchor, hidden: true, 'data-dsh-widgets-plan': '', 'aria-hidden': true });
    }

    /* --------------------------------------------------------------------------------------------------------- queue */

    const rowText = (message) => (Array.isArray(message?.content) ? message.content : [])
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join(' ');
    const ownMessage = (message) => message?.source?.kind === 'user';
    const seenOf = (content) => (Array.isArray(content) ? content : [])
      .map((block) => (block?.type === 'text' ? ['text', block.text] : [block?.type ?? null, block?.attachment?.attachmentId ?? null]));

    const QUEUE_CSS = '.dw-queue{display:flex;flex-direction:column;gap:2px;padding:4px 8px;font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}'
      + '.dw-queue-row{display:flex;align-items:center;gap:6px;min-height:22px;border-radius:var(--dsw-radius-sm,6px);padding:1px 4px}'
      + '.dw-queue-over{outline:1px dashed var(--dsw-alias-state-business-primary,#3b6cf6)}'
      + '.dw-grip{cursor:grab;border:0;background:none;color:inherit;font:inherit;padding:0 2px}'
      + '.dw-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.dw-arrows{display:inline-flex;gap:2px}'
      + '.dw-btn{border:0;background:none;color:inherit;font:inherit;cursor:pointer;padding:0 4px;opacity:.8}'
      + '.dw-btn:disabled{opacity:.35;cursor:default}'
      + '.dw-edit{flex:1;display:flex;gap:4px;align-items:flex-start}'
      + '.dw-input{flex:1;font:inherit;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:4px;padding:2px 4px}';

    /**
     * The queue strip: one row per queued message with a drag grip and the arrow keys. Both switches show the same strip;
     * each one only adds its own affordance, so turning one off leaves the other working.
     */
    function QueuePanel({ sessionId, useProjection, settings, notify, t }) {
      const queue = useProjection('next-turn');
      const rows = Array.isArray(queue) ? queue : [];
      const reorderOn = isOn(settings, 'queueReorder');
      const editOn = isOn(settings, 'queueEdit');
      const [dragging, setDragging] = React.useState(null);
      const [over, setOver] = React.useState(null);
      const [editing, setEditing] = React.useState(null);
      const [draftText, setDraftText] = React.useState('');
      const [busy, setBusy] = React.useState(false);

      if (!reorderOn && !editOn) return null;
      if (rows.length < 2 && editing === null) return null;
      const before = rows.map((message) => message.id);

      /** Move one row: the Host route first (it carries attachments too); a refusal is shown, never guessed around. */
      const move = async (itemId, to) => {
        if (busy) return;
        setBusy(true);
        try {
          await postJson(MOVE_ROUTE, { sessionId, itemId, to, before });
        } catch {
          notify?.('error', t('queue.failed'));
        } finally { setBusy(false); }
      };

      const step = (index, delta) => {
        const to = index + delta;
        if (to < 0 || to >= rows.length) return;
        if (!ownMessage(rows[index])) return;
        move(rows[index].id, to);
      };

      const saveEdit = async (itemId) => {
        if (busy) return;
        const message = rows.find((item) => item.id === itemId);
        if (message === undefined) return;
        setBusy(true);
        try {
          await postJson(EDIT_ROUTE, { sessionId, itemId, content: [{ type: 'text', text: draftText }], seen: seenOf(message.content) });
          setEditing(null);
        } catch {
          notify?.('error', t('queue.failed'));
        } finally { setBusy(false); }
      };

      return React.createElement(React.Fragment, null,
        React.createElement('style', null, QUEUE_CSS),
        React.createElement('div', { 'data-dsh-widgets-queue': '', className: 'dw-queue', role: 'list', 'aria-label': t('queue.title') },
          ...rows.map((message, index) => {
            const mine = ownMessage(message);
            const isEditing = editing === message.id;
            return React.createElement('div', {
              key: message.id,
              role: 'listitem',
              className: `dw-queue-row${over === index && dragging !== index ? ' dw-queue-over' : ''}`,
              'data-dsh-widgets-queue-row': message.id,
              onDragOver: (event) => { if (dragging === null || !mine) return; event.preventDefault(); setOver(index); },
              onDrop: (event) => {
                event.preventDefault();
                const from = dragging;
                setDragging(null); setOver(null);
                if (from === null || from === index) return;
                move(rows[from].id, index);
              },
            },
            reorderOn && mine
              ? React.createElement('button', {
                type: 'button', className: 'dw-grip', 'data-dsh-widgets-grip': '', title: t('queue.grip'), 'aria-label': t('queue.grip'),
                draggable: true, disabled: busy,
                onDragStart: () => setDragging(index),
                onDragEnd: () => { setDragging(null); setOver(null); },
                onKeyDown: (event) => {
                  if (event.key === 'ArrowUp') { event.preventDefault(); step(index, -1); }
                  if (event.key === 'ArrowDown') { event.preventDefault(); step(index, 1); }
                },
              }, '⠿')
              : null,
            isEditing
              ? React.createElement('span', { className: 'dw-edit' },
                React.createElement('textarea', {
                  className: 'dw-input', value: draftText, rows: 2, autoFocus: true, 'data-dsh-widgets-edit': '',
                  onChange: (event) => setDraftText(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); saveEdit(message.id); }
                    if (event.key === 'Escape') { event.preventDefault(); setEditing(null); }
                  },
                }),
                React.createElement('button', { type: 'button', className: 'dw-btn', disabled: busy, onClick: () => saveEdit(message.id) }, t('queue.save')),
                React.createElement('button', { type: 'button', className: 'dw-btn', onClick: () => setEditing(null) }, t('queue.cancel')))
              : React.createElement('span', {
                className: 'dw-text', title: rowText(message),
                onDoubleClick: () => { if (!editOn || !mine) return; setEditing(message.id); setDraftText(rowText(message)); },
              }, rowText(message)),
            reorderOn && mine
              ? React.createElement('span', { className: 'dw-arrows' },
                React.createElement('button', { type: 'button', className: 'dw-btn', disabled: busy || index === 0, 'aria-label': t('queue.moveUp'), onClick: () => step(index, -1) }, '↑'),
                React.createElement('button', { type: 'button', className: 'dw-btn', disabled: busy || index === rows.length - 1, 'aria-label': t('queue.moveDown'), onClick: () => step(index, 1) }, '↓'))
              : null,
            editOn && mine && !isEditing
              ? React.createElement('button', { type: 'button', className: 'dw-btn', 'data-dsh-widgets-edit-open': '', onClick: () => { setEditing(message.id); setDraftText(rowText(message)); } }, t('queue.edit'))
              : null);
          })));
    }

    /* ------------------------------------------------------------------------------------------------ improve prompt */

    const WandIcon = () => React.createElement('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true },
      React.createElement('path', {
        d: 'M9.5 2.5 11 1l1.5 1.5L11 4 9.5 2.5ZM3 13l6.5-6.5 1 1L4 14l-1-1Zm7.5-6.5L12 5l1 1-1.5 1.5-1-1Z',
        fill: 'currentColor',
      }));

    /** The magic wand: one model call rewrites the draft, which is replaced but never sent. */
    function ImproveButton({ sessionId, useInput, inputActions, store, chatProvider, chatModel, notify, t }) {
      const draft = useInput((state) => (state === undefined ? '' : state.draft));
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(undefined);
      const [undone, setUndone] = React.useState(undefined);
      const live = React.useRef(null);
      live.current = { draft, chatProvider, chatModel };

      const run = async () => {
        if (busy) return;
        const current = live.current;
        if (current.draft.trim() === '') { notify?.('warn', t('improve.empty')); return; }
        setBusy(true); setError(undefined);
        try {
          // Read the settings now, not when the panel mounted: a model or an effort chosen since then is the one used.
          const settings = store?.getSnapshot?.() ?? {};
          const chosen = settings.improve?.model ?? null;
          const body = {
            sessionId, text: current.draft,
            provider: chosen?.provider ?? current.chatProvider,
            model: chosen?.model ?? current.chatModel,
          };
          if (settings.improve?.effort !== null && settings.improve?.effort !== undefined) body.effort = settings.improve.effort;
          const value = await postJson(IMPROVE_ROUTE, body);
          setUndone(current.draft);
          inputActions?.setDraft?.(value.text);
        } catch (failure) {
          const message = String(failure?.message ?? failure);
          setError(message);
          notify?.('error', t('improve.failed', { error: message }));
        } finally { setBusy(false); }
      };

      return React.createElement('span', { 'data-dsh-widgets-improve': '', style: { display: 'inline-flex', alignItems: 'center', gap: 2 } },
        React.createElement('button', {
          type: 'button', className: 'dw-btn', title: t('improve.title'), 'aria-label': t('improve.title'),
          'aria-busy': busy, 'data-dsh-widgets-wand': '', disabled: busy || chatProvider === undefined || chatModel === undefined,
          onClick: run,
        }, React.createElement(WandIcon)),
        undone === undefined ? null : React.createElement('button', {
          type: 'button', className: 'dw-btn', title: t('improve.undo'), 'aria-label': t('improve.undo'), 'data-dsh-widgets-undo': '',
          onClick: () => { inputActions?.setDraft?.(undone); setUndone(undefined); },
        }, '↺'),
        error === undefined ? null : React.createElement('span', { role: 'alert', style: { fontSize: 11, color: 'var(--dsw-alias-state-warn-label,#b25000)' } }, error));
    }

    /* ----------------------------------------------------------------------------------------------- branch target */

    const MODE_LABEL = {
      current: 'branch.current', branch: 'branch.branch', worktree: 'branch.worktree',
      'existing-branch': 'branch.existingBranch', 'existing-worktree': 'branch.existingWorktree',
    };
    const MODE_ORDER = ['current', 'branch', 'worktree', 'existing-branch', 'existing-worktree'];

    const PANEL_STYLE = {
      position: 'absolute', zIndex: 40, padding: 12, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 4,
      borderRadius: 'var(--dsw-radius-md,8px)', border: '.5px solid var(--dsw-alias-border-l2,#ccc)',
      background: 'var(--dsw-alias-bg-layer-1,#fff)', color: 'var(--dsw-alias-label-primary,inherit)',
      boxShadow: 'var(--dsw-elevation-soft,0 4px 16px rgba(0,0,0,.16))',
    };
    const FIELD_STYLE = {
      font: 'inherit', fontSize: 12, padding: '3px 6px', borderRadius: 6,
      border: '.5px solid var(--dsw-alias-border-l2,#ccc)', background: 'transparent', color: 'inherit',
    };

    /**
     * The target picker. Nothing is created until Start there, which is what makes the default a true no-op: on the
     * current branch the Host runs no git at all.
     */
    function BranchTargetButton({ sessionId, projectPath, startIn, t, notify }) {
      const [open, setOpen] = React.useState(false);
      const [info, setInfo] = React.useState(undefined);
      const [mode, setMode] = React.useState('current');
      const [branchName, setBranchName] = React.useState('');
      const [existingBranch, setExistingBranch] = React.useState('');
      const [worktreePath, setWorktreePath] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(undefined);

      const load = async () => {
        try {
          const query = sessionId === undefined ? { cwd: projectPath ?? '' } : { sessionId };
          const value = await hostJson(`${TARGET_ROUTE}?${new URLSearchParams(query)}`);
          setInfo(value);
          setMode(value.mode ?? 'current');
          setExistingBranch(typeof value.branch === 'string' ? value.branch : '');
          setWorktreePath(value.worktrees?.[0]?.path ?? '');
        } catch (failure) { setError(String(failure?.message ?? failure)); }
      };

      const start = async () => {
        if (busy) return;
        setBusy(true); setError(undefined);
        try {
          const body = { mode };
          if (sessionId !== undefined) body.sessionId = sessionId; else body.cwd = projectPath;
          if ((mode === 'branch' || mode === 'worktree') && branchName.trim() !== '') body.branchName = branchName.trim();
          if (mode === 'existing-branch') body.existingBranch = existingBranch;
          if (mode === 'existing-worktree') body.worktreePath = worktreePath;
          const value = await postJson(TARGET_ROUTE, body);
          setOpen(false);
          startIn?.(value);
        } catch (failure) {
          const message = String(failure?.message ?? failure);
          setError(message);
          notify?.('error', t('branch.failed', { error: message }));
        } finally { setBusy(false); }
      };

      const label = typeof info?.branch === 'string' ? `${t('branch.title')}: ${info.branch}` : t('branch.title');

      return React.createElement('span', { 'data-dsh-widgets-branch': '', style: { display: 'inline-flex', alignItems: 'center', gap: 6, position: 'relative' } },
        React.createElement('button', {
          type: 'button', className: 'dw-btn', 'aria-haspopup': 'dialog', 'aria-expanded': open, disabled: busy,
          'data-dsh-widgets-branch-open': '', onClick: () => { if (!open) load(); setOpen(!open); },
        }, label),
        open ? React.createElement('div', { role: 'dialog', 'data-dsh-widgets-branch-panel': '', style: PANEL_STYLE },
          React.createElement('div', { style: { fontWeight: 500, paddingBottom: 4 } }, t('branch.title')),
          info?.repo === false ? React.createElement('div', { role: 'status', style: { fontSize: 12 } }, t('branch.notRepo')) : null,
          React.createElement('select', {
            'data-dsh-widgets-mode': '', value: mode, style: FIELD_STYLE,
            onChange: (event) => setMode(event.target.value),
          }, MODE_ORDER.map((id) => React.createElement('option', { key: id, value: id }, t(MODE_LABEL[id])))),
          mode === 'branch' || mode === 'worktree'
            ? React.createElement('input', {
              type: 'text', value: branchName, placeholder: t('branch.nameHint'), style: FIELD_STYLE,
              'data-dsh-widgets-branch-name': '', onChange: (event) => setBranchName(event.target.value),
            })
            : null,
          mode === 'existing-branch'
            ? React.createElement('select', {
              value: existingBranch, style: FIELD_STYLE, 'data-dsh-widgets-existing-branch': '',
              onChange: (event) => setExistingBranch(event.target.value),
            }, (info?.branches ?? []).length === 0
              ? [React.createElement('option', { key: '', value: '' }, t('branch.none'))]
              : (info.branches ?? []).map((branch) => React.createElement('option', { key: branch, value: branch }, branch)))
            : null,
          mode === 'existing-worktree'
            ? React.createElement('select', {
              value: worktreePath, style: FIELD_STYLE, 'data-dsh-widgets-existing-worktree': '',
              onChange: (event) => setWorktreePath(event.target.value),
            }, (info?.worktrees ?? []).length === 0
              ? [React.createElement('option', { key: '', value: '' }, t('branch.none'))]
              : (info.worktrees ?? []).map((entry) => React.createElement('option', { key: entry.path, value: entry.path }, `${entry.branch ?? '?'} — ${entry.path}`)))
            : null,
          React.createElement('div', { style: { display: 'flex', gap: 6, paddingTop: 6 } },
            React.createElement('button', { type: 'button', className: 'dw-btn', 'data-dsh-widgets-branch-start': '', disabled: busy, onClick: start }, busy ? t('branch.busy') : t('branch.start')),
            React.createElement('button', { type: 'button', className: 'dw-btn', onClick: () => setOpen(false) }, t('branch.cancel'))),
          error === undefined ? null : React.createElement('div', { role: 'alert', style: { fontSize: 12 } }, error))
          : null);
    }

    /* ------------------------------------------------------------------------------------------------------- settings */

    const fold = (text) => String(text ?? '').toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    const matchesQuery = (query, ...texts) => {
      const words = fold(query).split(/\s+/).filter(Boolean);
      const haystack = fold(texts.join(' '));
      return words.every((word) => haystack.includes(word));
    };

    const ROW_STYLE = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '14px 0', borderBottom: '.5px solid var(--dsw-alias-border-l2)' };
    const SWITCH_LABEL = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' };

    function Switch({ on, onChange, label }) {
      return React.createElement('button', {
        type: 'button', role: 'switch', 'aria-checked': on, 'aria-label': label,
        'data-dsh-widgets-switch': '', onClick: () => onChange(!on),
        style: { position: 'relative', width: 38, height: 22, flexShrink: 0, borderRadius: 11, border: 0, cursor: 'pointer', padding: 0,
          background: on ? 'var(--dsw-alias-state-business-primary,#3b6cf6)' : 'var(--dsw-alias-interactive-bg-hover,#d5d5d9)' },
      }, React.createElement('span', { style: { position: 'absolute', top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: 8, background: '#fff' } }));
    }

    const SETTINGS_IDS = ['branchTarget', 'branchTree', 'planToggle', 'queueReorder', 'queueEdit', 'improvePrompt'];

    /** Settings → Widgets: one row per switch, plus the model and the reasoning effort the Improve prompt call uses. */
    function WidgetSettings({ store, models, locale }) {
      const settings = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
      const catalogue = React.useSyncExternalStore(models.subscribe, models.getSnapshot, models.getSnapshot);
      const [query, setQuery] = React.useState('');
      const t = translatorFor(locale?.getSnapshot?.().active);
      const improve = settings.improve ?? { model: null, effort: null };
      const chosen = improve.model ?? null;

      // The reasoning efforts of the model this call would use, from the local configuration; re-read when it changes.
      const [reasoning, setReasoning] = React.useState({ supported: false, efforts: [] });
      const key = chosen === null ? '' : `${chosen.provider}/${chosen.model}`;
      React.useEffect(() => {
        let live = true;
        if (chosen === null) { setReasoning({ supported: false, efforts: [] }); return undefined; }
        models.reasoningOf(chosen.provider, chosen.model).then((value) => { if (live) setReasoning(value ?? { supported: false, efforts: [] }); });
        return () => { live = false; };
      }, [key, models]);

      const ids = SETTINGS_IDS.filter((id) => matchesQuery(query, t(`widget.${id}`), t(`widget.${id}.desc`), id));
      const modelValue = chosen === null ? '' : JSON.stringify([chosen.provider, chosen.model]);

      const modelMenu = React.createElement('select', {
        'data-dsh-widgets-improve-model': '', value: modelValue, style: FIELD_STYLE,
        onChange: (event) => {
          const value = event.target.value;
          const model = value === '' ? null : (() => { const [provider, id] = JSON.parse(value); return { provider, model: id }; })();
          store.save({ improve: { model, effort: null } });
        },
      },
      React.createElement('option', { value: '' }, t('settings.modelChat')),
      ...(catalogue.providers ?? []).map((provider) => React.createElement('optgroup', { key: provider.id, label: provider.name },
        ...(provider.models ?? []).map((model) => React.createElement('option', { key: `${provider.id}/${model.id}`, value: JSON.stringify([provider.id, model.id]) }, model.name)))));

      const effortMenu = reasoning.supported
        ? React.createElement('select', {
          'data-dsh-widgets-improve-effort': '', value: improve.effort ?? '', style: FIELD_STYLE,
          onChange: (event) => store.save({ improve: { effort: event.target.value === '' ? null : event.target.value } }),
        },
        React.createElement('option', { value: '' }, t('settings.thinkingDefault')),
        ...(reasoning.efforts ?? []).map((entry) => React.createElement('option', { key: entry.id, value: entry.id, title: entry.description }, entry.name)))
        : React.createElement('span', { role: 'status', 'data-dsh-widgets-effort-none': '', style: SWITCH_LABEL }, t('settings.thinkingNone'));

      return React.createElement('div', { 'data-dsh-widgets-settings': '' },
        React.createElement('div', { style: { ...SWITCH_LABEL, lineHeight: '18px', paddingBottom: 6 } }, t('settings.intro')),
        settings.error === undefined ? null : React.createElement('div', { role: 'alert', style: { fontSize: 12, paddingBottom: 6 } }, t('settings.loadFailed', { error: settings.error })),
        React.createElement('input', {
          type: 'search', value: query, placeholder: t('settings.search'), 'aria-label': t('settings.search'),
          'data-dsh-widgets-search': '', onChange: (event) => setQuery(event.target.value),
          style: { ...FIELD_STYLE, padding: '5px 8px', marginBottom: 6, width: '100%', boxSizing: 'border-box' },
        }),
        ids.length === 0 ? React.createElement('div', { role: 'status', style: { fontSize: 13, padding: '20px 0', textAlign: 'center' } }, t('settings.searchEmpty')) : null,
        ...ids.map((id) => React.createElement('div', { key: id, style: ROW_STYLE, 'data-dsh-widgets-row': id },
          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
            React.createElement('div', { style: { fontSize: 14, lineHeight: '20px' } }, t(`widget.${id}`)),
            React.createElement('div', { style: { ...SWITCH_LABEL, marginTop: 4, lineHeight: '18px' } }, t(`widget.${id}.desc`)),
            id === 'improvePrompt' && isOn(settings, id)
              ? React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 } },
                React.createElement('span', { style: SWITCH_LABEL }, t('settings.model')), modelMenu,
                React.createElement('span', { style: SWITCH_LABEL }, t('settings.thinking')), effortMenu)
              : null,
            id === 'branchTarget' && isOn(settings, id)
              ? React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 } },
                React.createElement('span', { style: SWITCH_LABEL }, t('settings.mode')),
                React.createElement('select', {
                  'data-dsh-widgets-default-mode': '', value: settings.branchTarget?.mode ?? 'current', style: FIELD_STYLE,
                  onChange: (event) => store.save({ branchTarget: { mode: event.target.value } }),
                }, MODE_ORDER.map((mode) => React.createElement('option', { key: mode, value: mode }, t(MODE_LABEL[mode])))))
              : null),
          React.createElement(Switch, { 'data-dsh-widgets-switch': '', on: isOn(settings, id), label: t(`widget.${id}`), onChange: (next) => store.save({ id, on: next }) }))));
    }

    /* ---------------------------------------------------------------------------------------------------------- apply */

    return {
      name: 'dsh-widgets',
      apply(ctx) {
        const settings = createSettings();
        const models = createModels();
        const language = () => ctx.locale?.getSnapshot?.().active;
        const t = () => translatorFor(language());

        /** The chat's project folder, for the branch picker. */
        const projectPathOf = (sessionId) => {
          try { return ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd; } catch { return undefined; }
        };

        /** Open a chat in the folder a target produced. */
        const startIn = async (value) => {
          try {
            const workspaces = ctx.get?.('workspaces');
            const uiWorkspace = ctx.get?.('uiWorkspace');
            const known = (workspaces?.list?.() ?? []).find((workspace) => workspace.path === value.cwd);
            const id = known?.id ?? (await workspaces.create({ path: value.cwd }))?.workspaceId;
            if (id !== undefined) uiWorkspace?.startSession?.(id);
          } catch { /* the folder is in the picker on the next try */ }
        };

        const notifyFor = (sessionId) => (level, text) => {
          try { const actx = ctx.sessions.scope(sessionId); actx.get('conversation').input.for(actx).notify(level, text); } catch { /* best effort */ }
        };

        /** One panel per switch (or pair of switches); `on` decides whether its slot occupants exist right now. */
        const panels = [
          {
            id: 'planToggle',
            on: (state) => isOn(state, 'planToggle'),
            setup: () => [ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
              name: 'conversation.input.right',
              id: 'widgets-plan-toggle',
              order: 999,
              inject: (sessionId) => ({
                exitPlanMode: ctx.remote?.commands === undefined ? undefined : async () => {
                  const result = await ctx.remote.commands.execute(sessionId, '/plan off', []);
                  if (!result.ok) return `${result.error.message} (${result.error.code})`;
                  return result.value === undefined ? 'unknown command: /plan off' : null;
                },
                notify: notifyFor(sessionId),
              }),
            }, PlanToggle))],
          },
          {
            id: 'queue',
            on: (state) => queueOn(state),
            setup: () => [ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
              name: 'conversation.input.dock',
              id: 'widgets-queue',
              order: 21,
              inject: (sessionId) => ({ sessionId, notify: notifyFor(sessionId), t: t() }),
            }, (props) => React.createElement(QueuePanel, {
              ...props,
              settings: React.useSyncExternalStore(settings.subscribe, settings.getSnapshot, settings.getSnapshot),
            })))],
          },
          {
            id: 'improvePrompt',
            on: (state) => isOn(state, 'improvePrompt'),
            setup: () => [ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
              name: 'conversation.input.right',
              id: 'widgets-improve',
              order: 997,
              inject: (sessionId) => {
                let selection;
                try { selection = ctx.sessions.scope(sessionId)?.get('conversation')?.selection?.getSnapshot?.()?.current; } catch { selection = undefined; }
                return {
                  sessionId,
                  store: settings,
                  chatProvider: selection?.provider,
                  chatModel: selection?.model,
                  notify: notifyFor(sessionId),
                  t: t(),
                };
              },
            }, ImproveButton))],
          },
          {
            id: 'branchTarget',
            on: (state) => isOn(state, 'branchTarget'),
            setup: () => [ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
              name: 'conversation.input.right',
              id: 'widgets-branch-target',
              order: 996,
              inject: (sessionId) => ({ sessionId, projectPath: projectPathOf(sessionId), startIn, t: t(), notify: notifyFor(sessionId) }),
            }, BranchTargetButton))],
          },
          // Branches in the workspace tree does its work in the Host half; this half adds nothing to the page.
          { id: 'branchTree', on: (state) => isOn(state, 'branchTree'), setup: () => [] },
        ];

        const applyPanels = () => {
          const state = settings.getSnapshot();
          for (const panel of panels) {
            const wants = panel.on(state);
            if (wants && panel.off === null) {
              const disposers = panel.setup();
              panel.off = () => { for (const disposer of disposers.reverse()) disposer?.(); };
            } else if (!wants && panel.off !== null) {
              panel.off(); panel.off = null;
            }
          }
        };
        for (const panel of panels) panel.off = null;
        applyPanels();
        const offSettings = settings.subscribe(applyPanels);
        settings.load();
        models.load();

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'widgets',
          order: 90,
          label: () => translatorFor(language())('settings.nav'),
          inject: () => ({ store: settings, models, locale: ctx.locale }),
        }, WidgetSettings));

        if (ctx.effect !== undefined) {
          ctx.effect(() => () => {
            offSettings();
            for (const panel of panels) if (panel.off !== null) { panel.off(); panel.off = null; }
          }, 'dsh-widgets: widgets');
        }
      },
    };
  },
});