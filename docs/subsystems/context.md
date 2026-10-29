---
kind: reference
description: "当前的上下文管理契约：@ File Reference 的语法、展开与上限、Read 拒绝规则、文件候选接口、@ 文件菜单与引用 chip、输入区草稿的持久化，上下文用量（估算、阈值、接口与上下文环）、时间裁剪，以及内置遍历与 ripgrep 共同的忽略来源。修改引用展开、文件候选、composer、用量与裁剪或 walk / grep / find 的忽略规则前查阅。"
lifecycle: active
---

# 上下文管理

本文说明 Coko 当前如何把用户显式引用的文件放进模型上下文、输入区草稿如何保存、上下文用量如何估算与显示、较旧的工具输出何时被裁剪，以及文件遍历遵守哪些忽略来源。目前覆盖 [File Reference](../../GLOSSARY.md)、草稿持久化、上下文用量、时间裁剪与忽略规则；压缩尚未实现。命令展开排在 File Reference 之前，见 [命令](commands.md)；规则的判定见 [权限判定与审批](permissions.md)。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/context/references/parse.ts` | `parseFileReferences`、`formatFileReferenceToken`：`@path` / `@"path"` 的语法 |
| `packages/agent/src/context/references/expand.ts` | `expandFileReferences`：读取、截断、上限与说明文本，生成 `<file_reference>` 块 |
| `packages/agent/src/context/references/search.ts` | `searchWorkspaceFiles`：@ 菜单的候选（复用 `tools/builtin/walk.ts`） |
| `packages/protocol/src/files.ts` | 块的开标签（`formatFileReferenceOpen`、识别函数 `fileReferencePath`）、`WorkspaceFilesResponse`、`filePaths` |
| `apps/server/src/application/context/references.ts` | 引用贡献的 `expandInput`（读取 `ContextScope.permissionRules`） |
| `apps/server/src/http/routes/files.ts` | `GET /api/workspaces/:id/files` |
| `packages/ui/src/composer/file-reference-node.ts` | composer 的 File Reference 节点 |
| `apps/desktop/src/renderer/features/conversation/file-menu.tsx` | @ 文件菜单 |
| `apps/desktop/src/renderer/stores/draft-store.ts`、`features/conversation/composer.tsx` | 草稿的存储与载入 |
| `apps/desktop/src/renderer/features/conversation/timeline.ts`、`timeline-view.tsx` | 用户消息的引用 chip |
| `packages/agent/src/context/usage/` | `contextBudget`（有效窗口、阈值、预警线）、`estimateContextTokens` / `estimateMessageChars`、`trimOldToolResults` |
| `packages/agent/src/tools/builtin/walk.ts` | `walkTree` 与 `globalExcludesFile`：内置 grep / find 与 @ 文件候选共用的遍历与忽略来源 |
| `packages/protocol/src/context.ts`、`instructions.ts` | `ContextUsageResponse`、`contextUsageLevel`、`contextUsagePercent`、`contextPaths`；已加载指令文件 `LoadedInstructionFile` |
| `apps/server/src/application/context/usage.ts` | 时间裁剪的 `transformMessages`；`contextUsage` 汇总各贡献的 `report()` |
| `apps/server/src/http/routes/context.ts` | `GET /api/sessions/:id/context`、`GET /api/workspaces/:id/context` |
| `packages/ui/src/context-ring/`、`components/hover-card.tsx` | 上下文环与 HoverCard |
| `apps/desktop/src/renderer/stores/context-store.ts`、`features/conversation/context-ring.tsx` | 用量的读取与底栏的环、卡片 |

## File Reference

### 语法

- `@path` 或 `@"path with space"`。`@` 必须在开头或空白之后，所以 `user@example.com`、`(@a.ts)`、`看看@a.ts` 都不是引用。
- 未加引号的路径在空白或中文全角标点（，。；：！？、）】」』》）处结束，结尾的 `. , ; : ! ? ' " ) ] } >` 不属于路径。加引号的路径原样保留。
- 路径相对 Workspace；也接受绝对路径与 `~/`。以 `/` 结尾或指向目录时按目录处理。
- 不存在的路径不产生块，`@someone` 这类提及原样留在文本中。同一个文件（按真实路径）只附一次。

### 展开

提交的文本与 Run 进行中的追加指令经上下文装配展开，顺序是命令、File Reference，所以模板展开后的文本中的引用同样生效。每个引用在同一条 user message 中追加一个文本块，块以 `<file_reference path="…">` 开头、`</file_reference>` 结尾；第一个块是原文。没有引用时 user message 只有原文。块不是独立的条目 kind。

| 情形 | 块的内容 |
| --- | --- |
| Workspace 内的文件 | 文件内容，按 read 截断：2000 行或 50KB，截断时注明显示的行与 `offset` |
| Workspace 内的目录 | ls 式列表：按名字排序、目录带 `/`，最多 200 项（注明未显示的数量）；被拒绝的项不列出并注明数量 |
| Read 拒绝规则覆盖 | `[Not attached: denied by permission rules.]` |
| Workspace 外（含经符号链接指向外部） | `[Not attached: the path is outside the Workspace.]` |
| 二进制（开头 8000 字节中有 NUL） | `[Not attached: binary file.]` |
| 第 11 个及之后的引用 | `[Not attached: at most 10 file references per message.]` |
| 合计内容已达 200KB | `[Not attached: file references in this message exceed 200KB in total.]`；接近上限的那个文件按剩余额度截断 |

开标签的 path：Workspace 内为相对路径（`/` 分隔，目录以 `/` 结尾），其外为输入的原文；按 XML 属性转义 `& " < >`。

### 权限

用户显式引用视为对该文件的读取授权：询问规则与模式不适用，Read 拒绝规则仍生效。生效的规则与运行时判定相同（Session、全局、Workspace 与 project 作用域），在展开时取用，由 SessionService 经 `ContextScope.permissionRules` 给出。不带内容的 Read 拒绝规则拒绝全部引用；带内容的按路径模式，对解析后的路径与真实路径都判定。

### 日志

Sidecar 记 `file references attached`：引用数、各状态的数量与截断数，不记路径与内容。

## 文件候选接口

`GET /api/workspaces/:id/files?query=&limit=` → `{ files: { path, kind: 'file' | 'directory' }[] }`。

- 遍历与内置 find / grep 相同，遵守下文 [忽略规则](#忽略规则)；只看前 20 000 项。
- 匹配不区分大小写，档位依次为路径前缀、文件名前缀、包含、子序列；同档按深度、再按路径排序。空查询按深度列出。以 `/` 结尾的查询列出该目录之下的项，不含目录本身。
- `limit` 为 1–50，缺省 50；不合法时 400，Workspace 不存在时 404。结果不按 Read 拒绝规则过滤（引用时才判定）。

## 界面

- **@ 文件菜单**：在词首（开头或空白之后）输入 `@` 时打开，查询为 `@` 之后、光标之前的非空白文本。每次查询变化向 Sidecar 请求候选，新结果到达前先显示上一次结果中按子序列匹配的项。Enter 或指针选择插入 File Reference 节点并跟一个空格；目录上按 Tab 把 token 替换为 `@目录/` 并继续列出其中的项。键盘、Esc、输入法与定位规则与 / 命令菜单相同（见 [命令](commands.md#界面)）。
- **File Reference 节点**：token 模式的文本节点，以小号链接色 chip 显示，作为整体选中与删除，不能在其中输入。文本即序列化形式 `@path`（含空白、全角标点或会被当作结尾标点的字符时为 `@"path"`），因此提交的文本就是 Sidecar 解析的语法。
- **引用 chip**：时间线中，用户消息的 `<file_reference>` 块不进入气泡文本，按出现顺序显示为气泡下方的文件或目录 chip；文件内容只发给模型。

## 草稿

- composer 的内容以 Lexical EditorState JSON 存 renderer 的 `localStorage`：会话为 `coko.draft.<sessionId>`，还没有会话的 Workspace 草稿为 `coko.draft.workspace.<workspaceId>`。用户编辑后 300 ms 防抖写入；切换会话与窗口关闭（`pagehide` / `beforeunload`）前立即写入；内容为空时删除该键。
- 切换会话或草稿时载入目标的草稿，撤销历史随之清空。读出的值不是 JSON、不是 EditorState 形状或含未知节点（例如 File Reference 节点没有 path）时删除该键、记 renderer warn `draft discarded`，输入区为空。
- 提交被接受后编辑区清空，草稿随之删除。提交等待期间切换到新会话（草稿发送时创建会话）时，编辑区内容不被替换，随作用域带到新键；提交被接受后提交时所属的键也被删除。
- composer 是纯文本编辑器，File Reference 是其中唯一的非文本节点，因此不需要 Markdown 导入导出。

## 上下文用量

### 预算

| 值 | 计算 |
| --- | --- |
| 有效窗口 | contextWindow − min(maxTokens, 20 000) |
| 自动压缩阈值 | 有效窗口 − buffer；buffer 按 contextWindow：≥ 800k 为 50 000，≥ 400k 为 30 000，其余 13 000 |
| 预警线 | 阈值 − 20 000 |

窗口过小时各值取 0。例如 128k / maxTokens 16 384 → 阈值 98 616、预警 78 616；400k / 128k → 350 000、330 000；1M / 32k → 930 000、910 000。压缩（尚未实现）复用这里的阈值。

### 估算

- tokens = 最后一次有效的 assistant usage（input + cacheRead + cacheWrite + output，跳过出错、中止与为 0 的回复）加其后消息的 chars/4（向上取整）；最后一条就是该回复时 `estimated` 为 false。
- 分项一律 chars/4：`system`（基础系统提示）、`instructions`、`skills`、`memory`（各贡献 `report()` 的字符数，与注入的 system section 相同）、`tools`（基础工具与本作用域贡献工具的 name、description、parameters 的 JSON）、`messages`（有效对话记录，已应用回退与时间裁剪）。没有 usage，或时间裁剪会改变下一次请求而 usage 已不代表它时，tokens 为分项之和，`estimated` 为 true。
- 字符计法沿用 pi coding-agent：文本与思考按长度，工具调用按名字加参数 JSON，图片按 4800 字符。
- 每条 assistant 消息提交后 Sidecar 发 progress `context_usage { tokens, contextWindow }`，位于该 assistant 条目之后。

### 接口

`GET /api/sessions/:id/context` 与还没有 Session 的草稿 `GET /api/workspaces/:id/context`（没有消息，按缺省模型）→ `ContextUsageResponse`：`{ contextWindow, threshold, warning, tokens, estimated, breakdown, instructions: { path, scope, chars, truncated }[], diagnostics, autoCompact: { enabled, paused } }`。不存在时 404；没有可用模型时窗口、阈值与预警为 0。`instructions` 是本作用域加载的用户级与项目级指令文件（截断的标出），`diagnostics` 汇总指令、Skills 与 MCP（配置与结果诊断）的诊断；`autoCompact.enabled` 为有效配置 `context.autoCompact`，`paused` 目前恒为 false。取值与 Run 开始时相同（会连接应当连接的 MCP Server），不改条目。

### 上下文环

- 输入区底栏、模型选择之后显示环与百分比（占 contextWindow，向下取整）。tokens 达到预警线为 warning 色，达到阈值为 destructive 色；没有窗口或读取失败时只画轨道，名称为"上下文用量"。环固定宽度、不收缩，窄输入区中先收缩模式与模型选择。
- 作用域（会话或草稿）变化、会话中每条 assistant 条目提交、Run 结束与打开卡片时重新读取；较早发出的请求晚到时丢弃。
- 悬停或点击打开 HoverCard（`role="dialog"`，名称"上下文"）：用量与是否含估算、阈值与预警（或自动压缩已关闭 / 已暂停）、六个分项、指令文件（作用域与截断）与诊断。Esc 关闭，焦点留在环上。

## 时间裁剪

- 开关为有效配置 `context.trimOldToolResults`（默认开启，项目可关闭）。经上下文装配的 `transformMessages` 只改发给模型的请求，条目与对话记录不变；Sidecar 记 debug `old tool results trimmed { cleared }`。
- 裁剪点：assistant 之后第一条间隔超过 60 分钟的非 assistant 消息（用户隔了很久才发消息，或工具结果隔了很久才到），以及请求时 now 距最后一条 assistant 超过 60 分钟时的末尾。每个裁剪点之前的 toolResult 除最近 5 个外，超过 2KB（UTF-8）的内容替换为 `[Old tool result content cleared]`。
- 裁剪点只由消息时间戳决定，同一 Run 的后续请求与之后的 Run 得到相同的前缀，提示缓存只在已冷时失效一次。时钟可注入（`usageContribution({ now })`）。

## 忽略规则

内置 grep、find 与 @ 文件候选共用 `walkTree`，桌面端的 ripgrep grep 用 `--no-require-git` 读取同样的来源，两者结果一致（同一组契约用例）：

| 来源 | 作用范围 |
| --- | --- |
| 各目录的 `.gitignore`、`.ignore`、`.rgignore` | 遍历中的目录与搜索目录的祖先（直到含 `.git` 的仓库根）；也在非 git 目录生效 |
| 仓库的 `.git/info/exclude` | 搜索目录所在仓库，以及遍历中遇到的嵌套仓库；`.git` 为文件（worktree、submodule）时读 `gitdir` 指向目录的 `commondir` |
| 全局 excludes | `core.excludesFile`：先读 `~/.gitconfig`，没有再读 `$XDG_CONFIG_HOME/git/config`（未设时 `~/.config/git/config`），不跟随 include，`~` 展开；没有该设置时读 `$XDG_CONFIG_HOME/git/ignore`（`~/.config/git/ignore`）。模式相对搜索目录匹配 |

优先级从低到高：全局 excludes、`info/exclude`、ignore 文件（`!` 模式可反转更低来源的忽略）。始终包含隐藏文件、排除 `.git`、不跟随符号链接。

## 验证

- `packages/agent/src/context/references/parse.test.ts`、`expand.test.ts`、`search.test.ts`：语法（引号、标点、邮箱等不误判）；截断、目录上限、10 个 / 200KB、拒绝规则、Workspace 外与二进制的说明；候选的忽略规则、排序与上限。
- `tests/integration/sidecar-references.test.ts`：真实 Sidecar 上的 user message 块与 faux requestLog、project 作用域的 Read 拒绝规则、命令与引用的顺序、`GET /api/workspaces/:id/files`。
- `packages/ui/src/composer/file-reference-node.browser.test.tsx`：节点的插入与整体删除、序列化、EditorState JSON 往返与拒绝、目录 Tab、onDraftChange。
- `apps/desktop/src/renderer/stores/draft-store.test.ts`、`features/conversation/timeline.test.ts`：草稿的键、防抖与损坏处理；引用 chip 的派生。
- `apps/desktop/e2e/references-drafts.e2e.test.ts`：Electron 中的 @ 菜单与 chip、草稿在切换会话与重启后保留、提交后清除、损坏的草稿。
- `packages/agent/src/context/usage/usage.test.ts`：128k、400k、1M 窗口的阈值与预警、估算（有 / 无 usage、跳过出错与中止的回复）、时间裁剪（59 分钟不裁、61 分钟裁、保留最近 5 个、2KB 以下保留、输入不变、后续请求前缀稳定）。`apps/server/src/application/context/usage.test.ts`：注入时钟与 `context.trimOldToolResults` 开关。
- `tests/integration/sidecar-context.test.ts`：草稿与会话的用量接口（分项、指令文件与截断、Skills 诊断、404）、Run 后 tokens 等于 faux usage（加其后 toolResult 的 chars/4）、`context_usage` 在 assistant 条目之后。`tests/integration/secrets-gate-context.test.ts`：用量响应在秘密总闸的扫描范围内。
- `packages/agent/src/testing/grep-contract.ts`（内置 grep 与 `apps/server/src/adapters/ripgrep.test.ts` 都运行）：临时 HOME 下的 `.git/info/exclude`、`core.excludesFile`、XDG 缺省文件与没有这些文件时；`tools/builtin/walk.test.ts`：find 与文件候选、嵌套仓库与 worktree。
- `apps/desktop/src/renderer/features/conversation/context-ring.browser.test.tsx`、`stores/context-store.test.ts`：环的档位与颜色、HoverCard 内容、Esc 与焦点、390px 宽输入区不重叠；读取与过期请求。`apps/desktop/e2e/context.e2e.test.ts`：Electron 中的百分比、越过预警线变色、卡片的分项与指令文件、Esc、最窄窗口。

## 延伸阅读

- [命令](commands.md)：输入展开的前一步与 typeahead 的通用规则。
- [权限判定与审批](permissions.md)：Read 拒绝规则与作用域。
- [界面约定](../tech-stack/ui.md)：composer 与草稿的技术约定。
- [指令文件](instructions.md)：用量接口中指令文件与截断的来源。
