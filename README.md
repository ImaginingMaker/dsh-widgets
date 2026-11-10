# dsh-widgets

Small, independent widgets for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) UI.

Each widget has its own switch in **Settings → Widgets**. Switching one off removes everything it added. Nothing here
opens a port, starts a server, or calls a model without a click.

**English** · 中文（见下方 [中文说明](#中文说明)）

---

## Install

**Desktop app:** Settings → Plugins → **Add plugin** → enter `dsh-widgets` → **Enable now**.

**Web / CLI profile:**

```sh
dsh plugin --profile web add dsh-widgets
```

Then restart dsh.

Requires dsh ≥ 0.2.2-rc.1. MIT licensed. **No runtime dependencies** — the published package contains only built files.

---

## The widgets

| Widget | What it does | Default |
|---|---|---|
| [Shift+Tab plan mode](#shifttab-plan-mode) | `Shift+Tab` turns plan mode on, and off again, through dsh's own command. | on |
| [Queue drag-and-drop](#queue-drag-and-drop) | Reorder queued messages by drag, or by the arrow keys. | on |
| [Edit queued message in place](#edit-queued-message-in-place) | Change a queued message's text before it is sent. | on |
| [Improve prompt](#improve-prompt) | One model call rewrites your draft, with a model and a reasoning effort you choose. | on |
| [Hand off to a new session](#hand-off-to-a-new-session) | One click summarises this session and continues it in a new session in the same project. | on |
| [Project brief](#project-brief) | A quiet summary of the project, gathered before the first task and handed to it. | **off** |

Each widget's internal id — the key in `storages/dsh-widgets/settings.json`, and what to quote in an issue — is
`planToggle`, `queueReorder`, `queueEdit`, `improvePrompt`, `handoff` and `projectBrief`.

---

### Shift+Tab plan mode

`Shift+Tab` turns plan mode on, and off again when it is already on — by running dsh's own command, so the composer's
plan chip lights up immediately and nothing is written into your draft.

That is what dsh's `plan` command is: `Enter or leave plan mode`. `/plan` with no argument enters it, `/plan off` leaves
it, `/plan <text>` enters it and sends that text.

The one exception is a chat that has not started yet: there is no agent to command, so `Shift+Tab` writes `/plan ` at the
head of the draft instead, and the message you send is the one that starts the plan-mode turn. `/planning` is not the
command and is left alone.

Alt, Ctrl and Meta are not intercepted, a repeated key and an IME composition are ignored, and an open `/` menu keeps
`Shift+Tab` for itself.

### Queue drag-and-drop

Queued messages appear as a strip above the composer, one row each, with a grip. Drag a row onto another to reorder, or
focus the grip and press `↑` / `↓`. `Esc` ends a drag.

Only your own messages move: a goal round or a question reply in the range keeps its place. The move goes through the
Host, so a message keeps its images and files. If the queue changed since you looked — a message started sending — the
move is refused rather than applied to the wrong row.

### Edit queued message in place

Double-click a queued message (or click **Edit**) to change its text before it is sent. `Enter` saves, `Esc` cancels,
`Shift+Enter` adds a line. The message keeps its id and its place in the queue.

An edit carries what you saw of the message, so a change made on another device meanwhile is not overwritten — the save
is refused instead. Attachments you keep stay attached; this build does not add new images from the queue strip.

### Improve prompt

The magic wand next to the composer rewrites your draft as a clearer prompt: the goal first, numbered steps when there
are several parts, and the check that should pass. It reads the draft and a short, read-only description of the project
(its file hierarchy, plus `AGENTS.md`, `README.md` and `package.json`). The rewrite **replaces the draft and is never
sent** — read it, edit it, then press Enter. **↺** puts the original back in one step; **↻** then restores the rewrite.
Both disappear once the message is sent: there is no draft left to put back.

**Images are part of the draft.** If you staged screenshots in the composer, they travel with the text — the model reads
the whole of what you put in the box, not just the words. The plugin asks dsh to serialize exactly the attachments the
composer holds, and dsh's own admission turns them into the references its adapters read. A model that declares it cannot
take images is refused in words ("pick a vision model in Settings → Widgets, or remove them") instead of quietly
optimising the text alone. If the composer's images cannot be read, the draft is left unchanged and the failure is shown;
this build never falls back to a silent text-only rewrite.

**While it runs, the composer is locked.** The wand pulses, and dsh's own composer block makes the editor and send button
inert, so the text the model is rewriting cannot change under it. Everything is restored when the call settles, including
on failure — and a call that hangs is cut off after a minute rather than leaving the box locked for the session.

**The model is yours to choose, once.** Settings → Widgets has a single **Model** setting — **Same as the chat**, or any
model this Mac has configured — and Improve prompt, Project brief and Handoff use it. There is one answer to "which model
does this plugin call".

**"Same as the chat" really means the chat.** The client cannot see which model a conversation is set to, so it sends no
route at all and the Host resolves it in this order: the model pinned here, then the chat's own model, then dsh's default.
The wand is therefore never greyed out for want of a model it could not see; if nothing can be resolved, the click reports
why.

**The reasoning ladder comes from your own model configuration — not from a fixed list.** dsh's model configuration
declares, per model:

```yaml
reasoningEfforts:
  off: null
  low: low
  medium: medium
  high: high
```

The menu shows exactly those entries, in that order, for the model you picked. A model with no `reasoningEfforts` shows
**"This model declares no reasoning effort"** and no menu, and no `reasoningEffort` is sent.

- `off` is a level like any other: it is sent as the effort, and the adapter turns its empty API value into a request with
  no reasoning field. Dropping the level instead would let dsh apply the adapter's default and keep thinking.
- A model with no `off` entry cannot have its reasoning turned off; the menu offers only what it declares.
- An effort that is not in the model's own list falls back to the model's declared default rather than being clamped or
  guessed, because dsh rejects an unsupported explicit effort before any provider call.

One improvement per chat at a time: a newer click replaces the older call, which answers `409` instead of holding the
composer.

### Project brief

**Off by default.** Switch it on and the first task in a project opens with a short summary of that project.

One quiet model call is given the project's **file hierarchy, three levels deep**, plus any `AGENTS.md`, `README.md` and
`package.json` it finds. The plugin states no opinion about what makes a project analysable — a folder of repositories, a
project with no README, a single file: the hierarchy is the material, and the model draws the conclusion. It writes at
most **500 characters**: what the project is and its stack, how to run it and its tests, what it expects of someone making
changes, and the traps to avoid.

The task that follows is told **both** — the summary and the hierarchy it was made from — because a short description loses
what the agent needs most (where the code lives, which units exist) and the tree costs a fraction of rediscovering it.

- **It never waits.** A read in flight is not waited for: if you send before it finishes, the task simply goes without the
  summary. A read that fails is skipped the same way.
- **One read per project**, keyed by its real path and a fingerprint of `HEAD`, the hierarchy and the documents' size and
  mtime. A summary made from an older shape of the project is rebuilt on the next task; an unchanged one is reused, so the
  model is not called again.
- **The composer shows it**: a spinner while reading, a dot when ready, and a warning dot when it failed — its tooltip
  carries the reason, and a click tries again. A ready dot opens the summary in a small popover with a **Re-analyse**
  button; clicking anywhere else or pressing Escape closes it. Nothing is written into the composer, and a folder with
  nothing in it shows nothing at all. Switching the widget off removes the icon and stops every read.
- It costs one model call per project change, not per chat.

---

### Hand off to a new session

The handoff icon sits between the project-brief dot and the Improve wand. One click asks the analysis model for a
structured handoff of this session (project and goal, current state, completed work, decisions, current plan and next
steps, risks/unverified items, acceptance checks), creates a new session **in the same project** — same workspace/cwd as
this one — and sends the handoff there as the first message. The new session is told to treat it as the previous
session's task history, to restate the project and plan, and to continue expanding the plan before implementing anything.

**The handoff follows the language of the conversation, not the UI.** A Chinese conversation produces a Chinese handoff,
an English conversation an English one, even when Settings → Widgets is pinned to the other language. Code, file paths,
commands and proper nouns stay verbatim. Other languages use the English template with an explicit "keep the user's
language" rule, so the handoff itself can stay in that language. The detector reads the last eight user messages, ignores
code blocks, inline code and URLs, and follows the most recent natural-language message (the session title is only a
fallback). For a Chinese conversation the Host also verifies that the generated note really is Chinese; a non-Chinese
answer is retried once with a corrective prompt, and a second failure is reported instead of sending the wrong language.

The handoff is never written into the project. It is generated in memory and may be mirrored to a system temporary file
while the new session is created; that file is deleted once the prompt is accepted. Only durable, committed session
history is summarised — if a turn is still running, its uncommitted text is not included, and the new session is told to
verify the current state first.

If the project has no registered workspace, the new session is created with the same cwd instead, so it still inherits the
project. The plugin then switches to the new session automatically; if navigation is unavailable, it reports the new
session id rather than losing it.

## Settings

**Settings → Widgets** has one row per widget with a switch. Above the rows sit two choices that apply to the whole plugin:

- **Language** — **Same as dsh**, English or 中文. Pinning one decides what the plugin speaks regardless of the app's own
  language, which is how a Chinese panel can sit in an English app (and how the tests check it).
- **Model** — **Same as the chat**, or any model this Mac has configured, plus its reasoning effort. There is exactly one
  model setting: Improve prompt, Project brief and Handoff all use it, so the plugin cannot call different models by
  accident.

Rows also carry their own controls: the model and effort live under **Improve prompt**, next to the widget that shares them.

Search filters the rows by name and description, ignoring case and accents.

All six switches live in one file, `storages/dsh-widgets/settings.json` under the dsh home, written owner-only and
atomically (a temp file, then a rename), so a reader never sees half a file and one broken write cannot lock you out —
a missing or unreadable file reads as the defaults.

## Privacy and calls

- **No network call** is made at start, and nothing is sent anywhere by this plugin.
- **Improve prompt** calls the model only when you click the wand.
- **Handoff** calls the model only when you click the handoff icon; the note stays in the new session's prompt and is not
  written into the project.
- **Project brief** calls it once per project shape, from the hierarchy it read, and caches the result.

## Limits

- The only git command this plugin runs is `git rev-parse HEAD`, to notice that a project changed. Ignored files
  (`node_modules/`, `.env`) are never read for a summary.
- The queue strip owns its own rows; it does not graft controls onto dsh's markup, so a dsh update cannot leave a
  half-drawn handle behind. The trade-off is that it is a separate strip rather than handles inside dsh's own rows.
- This build does not add new images to a queued message.

## Compatibility

dsh ≥ 0.2.0-rc.2, Node ≥ 22. Tested against dsh's published Client and Host service contracts — slot names
(`conversation.input.right`, `conversation.input.dock`, `settings.section`), the `llm` model/effort API, and
`connection.fetch.register`.

## Development

The plugin is TypeScript. Two halves, two compilers, one command:

```sh
npm install
npm run typecheck   # tsc over the Host half, then over the browser half (DOM lib, no node:)
npm run build       # dist/index.js (tsc) + dist/web/client.js (esbuild)
npm test            # builds, then runs the unit suite against dist/
npm run e2e         # builds, then drives a real dsh in a real browser
```

### Why two builds

dsh loads a plugin's two halves in two different ways, and each one constrains the build:

| Half | What dsh does with it | How it is built |
|---|---|---|
| Host | imports `package.json` `main` as an ES module | `tsc -p tsconfig.build.json` → `dist/` |
| Client | evaluates **one script** that calls `window.__ModuleLoader__.load({ id, factory })` | esbuild → `dist/web/client.js`, wrapped in that call |

The browser half cannot be a normal ES module: dsh hands the factory its own `require` for `react`, and a second copy of
React would break hooks across the two trees. So `react` stays external and the bundle is CommonJS text inside the loader
call. `build.web.mjs` checks the result — the registered id, the wrapper, and that no `node:` module leaked into it — so a
broken bundle fails the build instead of failing silently at runtime.

A cordis service this plugin does not declare in `inject` must never be read directly: cordis throws
`cannot get property "X" without inject`. Every optional service (`llm`, `timer`, `workspaceRegistry`, `remote`, …) is read
through a guard, so a profile that lacks one still loads every widget it can.

### Layout

```
src/
├── shared/     pure, no node:, no React — compiled into both halves
│   ├── types.ts  settings.ts  reasoning.ts  queue.ts  brief.ts  routes.ts  styles.ts
├── host/       node: allowed, no DOM
│   ├── index.ts  store.ts  files.ts  git.ts  project.ts
│   └── routes/   settings, models, improve, queue, brief, plan
└── web/        DOM only, no node:
    ├── index.ts  slot.ts
    ├── kernel/   i18n, settingsStore, modelStore, hostJson, queueApi, plan, safe
    └── widgets/  planToggle, queue, improve, briefStatus, settings
```

`src/shared` is the contract between the halves: if it needs `node:fs` or `document`, it belongs in one of the others.

### Tests

The suite is plain `node --test` with no test framework:

| File | Covers |
|---|---|
| `test/meta.test.mjs` | manifest, bundle patch, CI, README, both languages, the build pipeline |
| `test/settings.test.mjs` | defaults, narrowing, atomic owner-only writes, serialized writes, every patch shape |
| `test/reasoning.test.mjs` | efforts read from the model configuration, and what is actually sent |
| `test/improve.test.mjs` | the prompt, safe file reads, the route, superseding, failures |
| `test/queue.test.mjs` | the ordering rule and both queue routes |
| `test/client-plan.test.mjs` | the built bundle's `PlanToggle` against a fake DOM |
| `test/client-widgets.test.mjs` | the built bundle's components: queue, wand, brief icon, settings |

The client tests run **`dist/web/client.js`**, not the sources — so they also prove the loader wrapper and the externals
are right. They stub `window.__ModuleLoader__`, React and the DOM; they do not prove anything about how dsh renders.

### End-to-end (the real environment)

That is what `npm run e2e` is for. It is not a mock:

- installs the plugin into a **throwaway `DSH_HOME`** (your own profile is untouched),
- spawns the real `dsh` CLI with `--profile web --port … --no-open`,
- opens the app in **real Chrome** through Playwright, using the access token dsh prints,
- serves a fake OpenAI-compatible model, so no provider is called,
- and asserts on what actually happens:

```
✓ dsh started and rendered with dsh-widgets loaded
✓ Settings → 小组件 shows six rows, in Chinese
✓ a switch writes storages/dsh-widgets/settings.json
✓ the reasoning ladder comes from the model configuration, and off is a level of it
✓ the Improve prompt icon has no border and no background of its own
✓ the project brief is read in the background and reports itself ready
✓ the brief panel closes from outside and from Escape, and its action looks like a button
✓ the wand is pressable, pulses and locks the composer, then rewrites the draft with the image
✓ undo/redo work, sending clears them, and the first task opens with the summary plus hierarchy
✓ the Handoff icon creates and switches to a same-project session with the plan-continuation prompt
✓ Shift+Tab turns plan mode on through dsh's own command: the next request carries the policy, the draft stays empty
```

This is the check that found the defects the unit tests could not: a host half that asked cordis for `timer` without
declaring it, a client half that did the same for `remote` and `slots`, a browser page opened without dsh's access token,
a prepared model call dispatched without its resolved config, and a wand that was disabled for want of a model the client
could never see. CI runs it on Node 24 alongside the unit matrix.

## License

MIT. See [LICENSE](LICENSE).

---

## 中文说明

这是 DeepSeek Harness（dsh）的一组**小而独立**的界面组件。每个组件在 **设置 → 小组件** 里都有自己的开关，
关掉即移除它添加的一切。不开放任何端口、不启动服务、不在没有点击的情况下调用模型。

### 安装

桌面端：设置 → 插件 → **添加插件** → 输入 `dsh-widgets` → **立即启用**。

命令行：

```sh
dsh plugin --profile web add dsh-widgets
```

然后重启 dsh。需要 dsh ≥ 0.2.2-rc.1，MIT 许可，**无运行时依赖** —— 发布包里只有构建产物。

### 六个组件

**Shift+Tab 计划模式** —— 在草稿最前面加上 `/plan `，再按一次移除。这正是 dsh 自己识别的格式（`/plan` 后接
空格、制表符或行尾）；`/planning` 不会被误判。只改前缀，草稿其余内容、文件 chip 与附件保持不变，光标移到末尾。
已在计划模式时，Shift+Tab 通过 dsh 自己的 `/plan off` 退出。Alt / Ctrl / Meta 不拦截，长按重复与输入法组合会被忽略。

**队列拖拽排序** —— 输入框上方每条队列消息带一个手柄，拖到另一条上即可换位，或聚焦手柄后按 `↑` / `↓`，`Esc` 结束。
只有你自己的消息能移动（目标轮次、提问回复保持原位）。移动经 Host 处理，因此图片与文件会跟着消息走；
若队列在你查看之后发生了变化，移动会被拒绝，而不是作用到错的行上。

**就地编辑队列消息** —— 双击（或点 **编辑**）在发送前修改文字。`Enter` 保存、`Esc` 取消、`Shift+Enter` 换行。
消息保持原有 id 与队列位置。保存时带上你所看到的内容，因此不会覆盖另一台设备同时做的修改——不一致时直接拒绝。

**提示词优化** —— 输入框旁的魔法棒把草稿改写为更清晰的提示词：目标在前，多步骤时用编号，并给出应当通过的检查。
它读取草稿与项目的一份只读摘要（目录层级，加上 `AGENTS.md`、`README.md`、`package.json`）。改写结果
**只替换草稿、不会发送**，读一遍、改一改，再按 Enter；**↺** 一步还原，**↻** 再恢复优化后的提示词。
消息发出后两者都消失——没有草稿可还原了。

**图片也算草稿的一部分。** 输入框里放进去的截图会跟着文字一起送进模型：它读的是你放进框里的全部内容，不只是
文字。插件让 dsh 序列化输入框当前持有的附件，再由 dsh 自己的准入机制转成适配器读取的引用。若模型声明不支持
图片，会被明确拒绝（「请在 设置 → 小组件 里换一个支持图片的模型，或移除图片」），而不是悄悄只优化文字。

**优化期间输入框被锁定。** 魔法棒的图标闪烁，编辑器变灰并停止接受输入，避免模型正在改写的文字被改动。请求结束
（包括失败）后一切恢复；卡住的请求会在一分钟后中止，不会让输入框一直锁着。

**交接并新建会话** —— 交接图标位于项目基本信息圆点与优化魔法棒之间。点击后，用分析模型生成当前会话的结构化交接
（项目与目标、当前状态、已完成工作、关键决策、当前计划与下一步、风险与未验证项、继续工作的验收条件），在
**同一个项目**（同一 workspace/cwd）里创建新会话，并把交接作为新会话的第一条消息自动发送。新会话被明确要求：
把交接当作上个会话的任务历史、先复述项目与计划、继续拓展 plan，并在用户批准前不要开始实现。

**交接正文跟随会话语言，而不是界面语言。** 中文会话生成中文交接，英文会话生成英文交接；即使 Settings → Widgets
固定为另一种语言也不会改变。代码、文件路径、命令和专有名词保留原文。其他语言使用英文模板并明确要求模型保持用户
原语言。检测会读取最近 8 条用户消息，忽略代码块、行内代码和 URL，并以最近一条自然语言消息为准（会话标题只作兜底）。
中文会话还会检查生成结果是否真的是中文；不是则用修正提示重试一次，仍失败会明确报错，而不是把错误语言的交接发给
新会话。

交接内容不会写入项目：它在内存中生成，创建新会话期间可能写入系统临时文件，消息被接受后立即删除。只汇总已提交的
会话历史；如果当前回合仍在运行，未提交的文字不会被包含，新会话会先核对当前状态。项目没有注册 workspace 时，用
相同 cwd 创建新会话，仍然继承项目信息。创建后自动切换到新会话；导航不可用时提示新会话 id，不会丢失。

**推理档位来自你自己的模型配置，不是写死的清单。** dsh 的模型配置里每个模型可以声明：

```yaml
reasoningEfforts:
  off: null
  low: low
  medium: medium
  high: high
```

设置面板的下拉会**按你所选模型**真实拥有的档位列出这些项。没有 `reasoningEfforts` 的模型显示
「该模型未配置推理档位」，不显示下拉，也不会发送任何 `reasoningEffort`。

- `off` 表示**什么都不发**——请求里不带 `reasoningEffort`，这正是 dsh 表达「关闭」的方式。
- 没有 `off` 项的模型无法关掉推理，下拉只提供它声明的档位。
- 模型不认识的档位会回退到它声明的默认值，而不是被钳制或猜测——dsh 会在发起请求前拒绝不支持的显式档位。

同一会话同时只有一次优化：再点一次会替换掉旧请求，旧请求返回 `409`，不会锁住输入框。

### 设置与隐私

六个开关都保存在 dsh 主目录下的 `storages/dsh-widgets/settings.json`，仅本人可读，原子写入（先写临时文件再
重命名），因此读方不会读到半个文件，一次坏写入也不会把人锁在设置之外——文件缺失或损坏都按默认值读取。

本插件**不发起任何网络请求**；「提示词优化」只在你点击魔法棒时调用模型；「交接并新建会话」只在你点击交接图标时
调用模型，交接内容只进入新会话的提示词，不写入项目；「项目基本信息」只在你打开该组件时调用一次模型，并按键入了
目录树的指纹缓存。

### 已知限制

- 本插件唯一执行的 git 命令是 `git rev-parse HEAD`，用来发现项目已变化；被忽略的文件（`node_modules/`、`.env`）
  永远不会被读取来生成摘要。
- 队列条自成一列，不去改写 dsh 自身的 DOM：好处是 dsh 升级不会留下画了一半的手柄，代价是它是独立的一条，
  而不是嵌在 dsh 自己的行里。
- 本版本不支持从队列条新增图片。

### 开发与测试

插件用 TypeScript 编写，两半两套构建，一条命令：

```sh
npm install
npm run typecheck   # 先检查 Host 半，再用 DOM 库检查浏览器半（不含 node:）
npm run build       # dist/index.js（tsc）+ dist/web/client.js（esbuild）
npm test            # 先构建，再对 dist/ 跑单元测试
npm run e2e         # 先构建，再在真实 dsh 与真实浏览器里跑端到端
```

**为什么要两套构建**：dsh 加载两半的方式不同——Host 半按 ES 模块 `import`，浏览器半则是**一个脚本**调用
`window.__ModuleLoader__.load({ id, factory })`。浏览器半不能是普通 ES 模块：dsh 通过 `require` 把自己那份
`react` 交给 factory，再打一份 React 会让两棵树的 hooks 互相打架，所以 `react` 保持 external，产物是包在 loader
调用里的 CommonJS 文本。`build.web.mjs` 会校验产物（注册的 id、包裹结构、没有 `node:` 泄漏），坏包在构建期
就失败，而不是运行时静默不加载。

**cordis 的 inject 规则**：插件没有在 `inject` 里声明的服务，**不能直接读**——会抛
`cannot get property "X" without inject`。本插件把每个可选服务（`llm`、`timer`、`workspaceRegistry`、`remote` …）
都走受保护的读取，所以某个 profile 缺某个服务时，其余小组件照常加载。

**单元测试**（`node --test`，无测试框架）对 **`dist/` 里的产物**运行——客户端测试跑的是
`dist/web/client.js`，因此顺带验证了 loader 包裹与 externals 是否正确。但它们是假 `window.__ModuleLoader__`、
假 React、假 DOM：**不证明 dsh 会怎么渲染**。

**真机测试**（`npm run e2e`）才是证明：

- 把插件装进**一次性 `DSH_HOME`**（不碰你自己的 profile）；
- 用真实 `dsh` CLI 起 `--profile web --port … --no-open`；
- 用 Playwright 打开**真实 Chrome**，走 dsh 打印的 access token；
- 起一个假的 OpenAI 兼容模型，不调用任何真实供应商；
- 断言真实发生的事情：设置面板六行、开关真的写进 `storages/dsh-widgets/settings.json`、没有 `reasoningEfforts`
  的模型不显示档位菜单、有 `off/low/high` 的模型下拉恰好那三项、
  Shift+Tab 在真实 composer 里写入并移除 `/plan `。

**它抓到过三个单元测试抓不到的真实缺陷**：Host 半未声明 `timer` 就读它、客户端半同样未声明 `remote` 与 `slots`、
以及页面没有带 dsh 的 access token 打开。CI 在 Node 24 上把它和单元矩阵一起跑。

### 许可

MIT，见 [LICENSE](LICENSE)。