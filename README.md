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
| [Branch per chat](#branch-per-chat) | Start a task on the current branch, a new branch, a new worktree, or one that already exists. | on |
| [Branches in the workspace tree](#branches-in-the-workspace-tree) | Each branch folder under `.worktrees/` becomes a project in the sidebar. | **off** |
| [Shift+Tab plan mode](#shifttab-plan-mode) | `Shift+Tab` puts `/plan` at the start of the draft, or leaves plan mode. | on |
| [Queue drag-and-drop](#queue-drag-and-drop) | Reorder queued messages by drag, or by the arrow keys. | on |
| [Edit queued message in place](#edit-queued-message-in-place) | Change a queued message's text before it is sent. | on |
| [Improve prompt](#improve-prompt) | One model call rewrites your draft, with a model and a reasoning effort you choose. | on |
| [Project brief](#project-brief) | A quiet summary of the project, gathered before the first task and handed to it. | **off** |

Each widget's internal id — the key in `storages/dsh-widgets/settings.json`, and what to quote in an issue — is
`branchTarget`, `branchTree`, `planToggle`, `queueReorder`, `queueEdit`, `improvePrompt` and `projectBrief`.

---

### Branch per chat

On the New Session row, beside the workspace and mode controls, a chip shows the branch the next task will run on.
Picking a target only records it — the work is described to the agent, not scripted around it.

Once the chat has sent a message the chip becomes a read-only marker: the choice is made at the start and is not offered
again, so a mid-conversation click cannot silently move work to another branch.

Five targets, and exactly one of them is in force at a time:

| Target | Where the chat runs | Branch |
|---|---|---|
| **Current branch** (default) | The project folder | The branch it is already on — **no git command runs at all** |
| **New branch…** | The project folder | A new branch cut from the current branch |
| **New worktree…** | `<project>/.worktrees/<slug>` | A new branch cut from the current branch, owned by that worktree |
| **An existing branch** | The project folder | That branch, checked out |
| **An existing worktree** | That folder | The branch the worktree already has |

**A branch and a worktree are mutually exclusive.** A target is a single choice: a `branch` target carries no checkout
path, and a `worktree` target always creates its own branch. A request that asks for both is refused with a `400` before
git is touched. This is enforced in `parseTarget` and covered by the tests.

**Branch names are deterministic and offline.** No model call is made to name a branch, so the same message always
proposes the same name: `feat/…`, or `fix/…` when the message reads like a bug report. A name already taken gets `-2`,
`-3`. A message without ASCII letters (for example Chinese) becomes `feat/change`. You can type a name instead.

**How it is carried out.** The plugin does not run `git switch` or `git worktree add` for a branch: it tells the agent
where the task belongs, and the agent uses its own tools. A dirty tree, an existing branch or a refused checkout is
therefore handled in the conversation, with your approvals, instead of by a script that cannot see it.

The single exception is a new worktree, because the chat's working directory is a property of the session and no prompt can
change it: the folder is created at the first step and the chat is moved into it, so its file tools really work there. If
that move is not available, the note tells the agent to use absolute paths inside the worktree instead.

**Refused, with a reason:** a folder that is not a repository, a repository with no commit yet, a branch that already
exists, and a worktree folder that already exists. Nothing is overwritten.

### Branches in the workspace tree

**Off by default, and off means inert.** While it is off, the plugin does not read `.worktrees/`, does not add a project,
and the route answers `{ "on": false, "folders": {} }`.

Switched on: each folder directly under `<project>/.worktrees/` is registered as a project in dsh's own workspace list,
by folder name. The sweep runs at start and every 30 s, and creating a project is idempotent — a folder already known is
left alone. A folder that disappears stops being reported; its project is **not** deleted, so chats are never lost.

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
(its `AGENTS.md`, `README.md` and `package.json`). The rewrite **replaces the draft and is never sent** — read it, edit
it, then press Enter. **↺** puts the original back in one step.

**The model is yours to choose, once.** Settings → Widgets has a single **Model** setting — **Same as the chat**, or any
model this Mac has configured — and both Improve prompt and Project brief use it. There is one answer to "which model does
this plugin call".

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

One quiet model call reads the same three files the plugin already trusts — `AGENTS.md`, `README.md`, `package.json` —
and, for a folder that documents nothing at its own root (a workspace of repositories, say), a plain listing of what is
there. It writes at most **500 characters**: what the project is and its stack, how to run it and its tests, what those files
require of someone making changes, and the traps to avoid. The summary becomes the first thing the task is told.

- **It never waits.** A read in flight is not waited for: if you send before it finishes, the task simply goes without the
  summary. A read that fails is skipped the same way.
- **One read per project**, keyed by its real path and a fingerprint of `HEAD` plus the files' size and mtime. A summary
  made from an older state of the project is rebuilt on the next task; an unchanged one is reused, so the model is not
  called again.
- **The composer shows it**: a spinner while reading, a dot when ready (its tooltip is the summary), and a warning dot
  when it failed — its tooltip carries the reason, and a click tries again. Nothing is written into the composer, and a
  folder with nothing in it shows nothing at all. Switching the widget off removes the icon and stops every read.
- It costs one model call per project change, not per chat.

---

## Settings

**Settings → Widgets** has one row per widget with a switch. Above the rows sit two choices that apply to the whole plugin:

- **Language** — **Same as dsh**, English or 中文. Pinning one decides what the plugin speaks regardless of the app's own
  language, which is how a Chinese panel can sit in an English app (and how the tests check it).
- **Model** — **Same as the chat**, or any model this Mac has configured, plus its reasoning effort. There is exactly one
  model setting: Improve prompt and Project brief both use it, so the plugin cannot call two different models by accident.

Rows also carry their own controls: **Branch per chat** has the default target for a new task; the model and effort live
under **Improve prompt**, next to the widget that shares them.

Search filters the rows by name and description, ignoring case and accents.

All six switches live in one file, `storages/dsh-widgets/settings.json` under the dsh home, written owner-only and
atomically (a temp file, then a rename), so a reader never sees half a file and one broken write cannot lock you out —
a missing or unreadable file reads as the defaults.

## Privacy and calls

- **No network call** is made at start, and nothing is sent anywhere by this plugin.
- **Improve prompt** calls the model only when you click the wand.
- **Branch per chat** runs git only when you press **Start there**, and never for the default target.
- **Branches in the workspace tree** writes to dsh's own workspace list, and only while it is switched on.

## Limits

- Branch names are ASCII. A message that is entirely non-ASCII becomes `feat/change`; type a name to be specific.
- A worktree is created under `<project>/.worktrees/`; a folder of the same name is never overwritten.
- Ignored files (`node_modules/`, `.env`) are **not** copied into a new worktree. Install dependencies there, or start
  the work in the project folder.
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
│   ├── types.ts  settings.ts  reasoning.ts  branch.ts  queue.ts  routes.ts
├── host/       node: allowed, no DOM
│   ├── index.ts  store.ts  files.ts  git.ts  project.ts
│   └── routes/   settings, models, branchTarget, branchTree, improve, queue
└── web/        DOM only, no node:
    ├── index.ts  slot.ts
    ├── kernel/   i18n, settingsStore, modelStore, hostJson, queueApi, plan, safe
    └── widgets/  planToggle, queue, improve, branchTarget, settings
```

`src/shared` is the contract between the halves: if it needs `node:fs` or `document`, it belongs in one of the others.

### Tests

The suite is plain `node --test` with no test framework:

| File | Covers |
|---|---|
| `test/meta.test.mjs` | manifest, bundle patch, CI, README, both languages, the build pipeline |
| `test/settings.test.mjs` | defaults, narrowing, atomic owner-only writes, serialized writes, every patch shape |
| `test/branch-target.test.mjs` | name rules, the five modes, **mutual exclusion**, and real git in a temporary repository |
| `test/branch-tree.test.mjs` | inert while off, idempotent while on, non-destructive on removal |
| `test/reasoning.test.mjs` | efforts read from the model configuration, and what is actually sent |
| `test/improve.test.mjs` | the prompt, safe file reads, the route, superseding, failures |
| `test/queue.test.mjs` | the ordering rule and both queue routes |
| `test/client-plan.test.mjs` | the built bundle's `PlanToggle` against a fake DOM |
| `test/client-widgets.test.mjs` | the built bundle's components: queue, picker, wand, settings |

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
✓ Settings → Widgets shows the six rows
✓ a switch writes storages/dsh-widgets/settings.json
✓ a model without reasoningEfforts offers no effort menu
✓ the reasoning ladder is read from the model configuration, and the choice is saved
✓ the target picker is in the composer with all five modes, defaulting to the current branch
✓ a new worktree created a real branch and checkout, and left the project folder alone
✓ Shift+Tab writes and removes the /plan prefix in the real composer
```

This is the check that found three real defects the unit tests could not: a host half that asked cordis for `timer`
without declaring it, a client half that did the same for `remote` and `slots`, and a browser page opened without dsh's
access token. CI runs it on Node 24 alongside the unit matrix.

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

**按会话使用分支** —— 输入框上方显示「开始于：`分支名`」。在你按下 **在这里开始** 之前，不会创建任何东西。
五个目标，任何时候只有一个生效：

| 目标 | 会话目录 | 分支 |
|---|---|---|
| **当前分支**（默认） | 项目文件夹 | 它当前所在的分支 —— **完全不执行任何 git 命令** |
| **新建分支…** | 项目文件夹 | 从当前分支切出新分支 |
| **新建 worktree…** | `<项目>/.worktrees/<slug>` | 从当前分支切出新分支，由该 worktree 独占 |
| **已有分支** | 项目文件夹 | 检出该分支 |
| **已有 worktree** | 该目录 | 该 worktree 已绑定的分支 |

**分支与 worktree 互斥**：目标是单值选择。`branch` 目标不带 worktree 路径，`worktree` 目标必然自己创建新分支；
同时要求两者的请求会在触碰 git 之前被 `400` 拒绝。这一不变量由 `parseTarget` 强制，并有测试覆盖。

分支名**确定且离线**生成（不为此调用模型）：`feat/…`，消息读起来像缺陷时用 `fix/…`；重名加 `-2`、`-3`；
纯中文消息会得到 `feat/change`；也可以自己输入名字。

**工作区树中的分支目录** —— **默认关闭，关闭时完全惰性**：不读 `.worktrees/`、不添加项目、路由返回空。
开启后，`<项目>/.worktrees/` 下的每个目录会按目录名注册为 dsh 自己的项目，启动时与每 30 秒扫描一次，
重复执行不会重复添加；目录消失只是不再上报，**不会删除项目**，聊天不会丢失。

**Shift+Tab 计划模式** —— 在草稿最前面加上 `/plan `，再按一次移除。这正是 dsh 自己识别的格式（`/plan` 后接
空格、制表符或行尾）；`/planning` 不会被误判。只改前缀，草稿其余内容、文件 chip 与附件保持不变，光标移到末尾。
已在计划模式时，Shift+Tab 通过 dsh 自己的 `/plan off` 退出。Alt / Ctrl / Meta 不拦截，长按重复与输入法组合会被忽略。

**队列拖拽排序** —— 输入框上方每条队列消息带一个手柄，拖到另一条上即可换位，或聚焦手柄后按 `↑` / `↓`，`Esc` 结束。
只有你自己的消息能移动（目标轮次、提问回复保持原位）。移动经 Host 处理，因此图片与文件会跟着消息走；
若队列在你查看之后发生了变化，移动会被拒绝，而不是作用到错的行上。

**就地编辑队列消息** —— 双击（或点 **编辑**）在发送前修改文字。`Enter` 保存、`Esc` 取消、`Shift+Enter` 换行。
消息保持原有 id 与队列位置。保存时带上你所看到的内容，因此不会覆盖另一台设备同时做的修改——不一致时直接拒绝。

**提示词优化** —— 输入框旁的魔法棒把草稿改写为更清晰的提示词：目标在前，多步骤时用编号，并给出应当通过的检查。
它读取草稿与项目的一份只读摘要（`AGENTS.md`、`README.md`、`package.json`）。改写结果**只替换草稿、不会发送**，
读一遍、改一改，再按 Enter；**↺** 一步还原。

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

本插件**不发起任何网络请求**；「提示词优化」只在你点击魔法棒时调用模型；「按会话使用分支」只在你按下
**在这里开始** 时执行 git，默认目标下完全不执行；「工作区树中的分支目录」只在开启时写入 dsh 自己的项目列表。

### 已知限制

- 分支名为 ASCII；纯非 ASCII 消息会得到 `feat/change`，需要更明确就自己输入名字。
- worktree 建在 `<项目>/.worktrees/` 下，同名目录绝不覆盖。
- 被忽略的文件（`node_modules/`、`.env`）**不会**复制进新 worktree；请在该目录安装依赖后再继续。
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
  的模型不显示档位菜单、有 `off/low/high` 的模型下拉恰好那三项、新建 worktree 真的在磁盘上建出目录与分支、
  Shift+Tab 在真实 composer 里写入并移除 `/plan `。

**它抓到过三个单元测试抓不到的真实缺陷**：Host 半未声明 `timer` 就读它、客户端半同样未声明 `remote` 与 `slots`、
以及页面没有带 dsh 的 access token 打开。CI 在 Node 24 上把它和单元矩阵一起跑。

### 许可

MIT，见 [LICENSE](LICENSE)。