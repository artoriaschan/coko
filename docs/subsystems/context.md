---
kind: reference
description: "当前的上下文管理契约：@ File Reference 的语法、展开与上限、Read 拒绝规则、文件候选接口、@ 文件菜单与引用 chip、输入区草稿的持久化，上下文用量（估算、阈值、接口与上下文环）、时间裁剪、压缩（自动、溢出、/compact、熔断、摘要结构、回退与分叉、界面），以及内置遍历与 ripgrep 共同的忽略来源。修改引用展开、文件候选、composer、用量、裁剪与压缩或 walk / grep / find 的忽略规则前查阅。"
lifecycle: active
---

# 上下文管理

本文说明 Coko 当前如何把用户显式引用的文件放进模型上下文、输入区草稿如何保存、上下文用量如何估算与显示、较旧的工具输出何时被裁剪，以及文件遍历遵守哪些忽略来源。目前覆盖 [File Reference](../../GLOSSARY.md)、草稿持久化、上下文用量、时间裁剪、压缩与忽略规则。命令展开排在 File Reference 之前，见 [命令](commands.md)；规则的判定见 [权限判定与审批](permissions.md)。

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
| `apps/desktop/src/renderer/stores/context-store.ts`、`features/conversation/context-ring.tsx` | 用量的读取与底栏的环、卡片；压缩进度（`trackCompaction`）与熔断暂停标记 |
| `packages/agent/src/context/compaction/` | `planCompaction`（切点、要摘要的消息、文件与 Skill 汇总）、`summaryRequest` / `formatCompactionSummary`（摘要提示）、`estimateCompactedTokens`、`createCompactionBreaker` |
| `packages/agent/src/engine/compaction-driver.ts`、`runtime.ts` | `compaction` 选项：请求前的自动压缩、溢出后压缩并重试、`compact()`（trigger compact 的 Run）、熔断状态（编排在 driver，运行时只接线） |
| `packages/agent/src/agents/fork.ts` | 分叉时复制最后一个 compaction 与其保留的消息 |
| `apps/server/src/application/context/compaction.ts`、`session-runs.ts`、`sessions.ts` | `/compact` 动作；运行时的 `compaction` 接线（`session-runs.ts`）与 `compactionPaused`（`sessions.ts`） |
| `apps/desktop/src/renderer/features/conversation/compaction-divider.tsx`、`composer.tsx` | 时间线的压缩分隔条；输入区上方的压缩状态行 |

## File Reference

### 语法

- `@path` 或 `@"path with space"`。`@` 必须在开头或空白之后，所以 `user@example.com`、`(@a.ts)`、`看看@a.ts` 都不是引用。
- 未加引号的路径在空白或中文全角标点（，。；：！？、）】」』》）处结束，结尾的 `. , ; : ! ? ' " ) ] } >` 不属于路径。加引号的路径原样保留。
- 路径相对 Workspace；也接受绝对路径与 `~/`。以 `/` 结尾或指向目录时按目录处理。
- 不存在的路径不产生块，`@someone` 这类提及原样留在文本中。同一个文件（按真实路径）只附一次。

### 展开

提交的文本与 Run 进行中的追加指令经上下文装配展开，顺序是命令、File Reference，所以模板展开后的文本中的引用同样生效。每个引用在同一条 user message 中追加一个文本块，块以 `<file_reference path="…">` 开头、`</file_reference>` 结尾；第一个块是原文。没有引用时 user message 只有原文。块不是独立的条目 kind。块中已登记 Secret 与 Credential 的明文在生成时替换为标记（与 read 工具的结果相同，见 [按值脱敏](mcp.md#secret-的来源)），用户自己写的原文不变。

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

窗口过小时各值取 0。例如 128k / maxTokens 16 384 → 阈值 98 616、预警 78 616；400k / 128k → 350 000、330 000；1M / 32k → 930 000、910 000。[压缩](#压缩)复用这里的阈值。

### 估算

- tokens = 最后一次有效的 assistant usage（input + cacheRead + cacheWrite + output，跳过出错、中止与为 0 的回复）加其后消息的 chars/4（向上取整）；最后一条就是该回复时 `estimated` 为 false。
- 分项一律 chars/4：`system`（基础系统提示）、`instructions`、`skills`、`memory`（各贡献 `report()` 的字符数，与注入的 system section 相同）、`tools`（基础工具与本作用域贡献工具的 name、description、parameters 的 JSON）、`messages`（有效对话记录，已应用回退与时间裁剪）。没有 usage，或时间裁剪会改变下一次请求而 usage 已不代表它，或最后一次 usage 早于最后一个有效的压缩（它量的是被摘要替代的历史）时，tokens 为分项之和，`estimated` 为 true。
- 字符计法沿用 pi coding-agent：文本与思考按长度，工具调用按名字加参数 JSON，图片按 4800 字符。
- 每条 assistant 消息提交后 Sidecar 发 progress `context_usage { tokens, contextWindow }`，位于该 assistant 条目之后。

### 接口

`GET /api/sessions/:id/context` 与还没有 Session 的草稿 `GET /api/workspaces/:id/context`（没有消息，按缺省模型）→ `ContextUsageResponse`：`{ contextWindow, threshold, warning, tokens, estimated, breakdown, instructions: { path, scope, chars, truncated }[], diagnostics, autoCompact: { enabled, paused } }`。不存在时 404；没有可用模型时窗口、阈值与预警为 0。`instructions` 是本作用域加载的用户级与项目级指令文件（截断的标出），`diagnostics` 汇总指令、Skills 与 MCP（配置与结果诊断）的诊断；`autoCompact.enabled` 为有效配置 `context.autoCompact`，`paused` 为该 Session 的自动压缩是否已熔断（见 [熔断](#触发与熔断)；草稿恒为 false）。取值与 Run 开始时相同（会连接应当连接的 MCP Server），不改条目。

### 上下文环

- 输入区底栏、模型选择之后显示环与百分比（占 contextWindow，向下取整）。tokens 达到预警线为 warning 色，达到阈值为 destructive 色；没有窗口或读取失败时只画轨道，名称为"上下文用量"。环固定宽度、不收缩，窄输入区中先收缩模式与模型选择。
- 作用域（会话或草稿）变化、会话中每条 assistant 条目提交、Run 结束、每次压缩结束（成功或失败）与打开卡片时重新读取；较早发出的请求晚到时丢弃。
- `autoCompact.paused` 为 true 时环之前显示暂停标记（`data-slot="auto-compact-paused"`，warning 色），名称与 Tooltip 提示可以输入 `/compact` 手动压缩。
- 点击（或 Enter / 空格）打开 HoverCard（`role="dialog"`，名称"上下文"）；只悬停不打开，以免布局变化把环移到静止的指针下时卡片遮住输入区上方的横幅。指针离开环与卡片、外部点击或 Esc 关闭。内容：用量与是否含估算、阈值与预警（或自动压缩已关闭 / 已暂停）、六个分项、指令文件（作用域与截断）与诊断。Esc 关闭后焦点留在环上。

## 时间裁剪

- 开关为有效配置 `context.trimOldToolResults`（默认开启，项目可关闭）。经上下文装配的 `transformMessages` 只改发给模型的请求，条目与对话记录不变；Sidecar 记 debug `old tool results trimmed { cleared }`。
- 裁剪点：assistant 之后第一条间隔超过 60 分钟的非 assistant 消息（用户隔了很久才发消息，或工具结果隔了很久才到），以及请求时 now 距最后一条 assistant 超过 60 分钟时的末尾。每个裁剪点之前的 toolResult 除最近 5 个外，超过 2KB（UTF-8）的内容替换为 `[Old tool result content cleared]`。
- 裁剪点只由消息时间戳决定，同一 Run 的后续请求与之后的 Run 得到相同的前缀，提示缓存只在已冷时失效一次。时钟可注入（`usageContribution({ now })`）。
- 与规格的差异：规格只写了"距最后一条 assistant 超过 60 分钟"一个触发点。只用这一个点时，用户隔了很久发消息的那一轮裁剪了较早结果，下一轮（缓存热、不再满足条件）又恢复原文，请求前缀反复变化；所以历史中每个超过 60 分钟的间隔也是裁剪点。代价是某个旧间隔之前的较早大段结果始终被替换，即使当前缓存是热的。

## 压缩

较早的对话被结构化摘要替代；条目不删除，时间线仍显示之前的消息。开关为有效配置 `context.autoCompact`（默认开启，项目可关闭），只影响自动与溢出压缩，`/compact` 总可用。

### 触发与熔断

| 触发 | 时机 | 失败时 |
| --- | --- | --- |
| `auto` | 每次模型请求之前（pi `prepareRequest`），估算 tokens 达到[阈值](#预算)。内存中的估算可能用了压缩之前的 usage，越过阈值时再按条目复核（`estimateCompactedTokens`，加系统消息的 chars/4） | 发 `compaction_failed`，Run 用原上下文继续 |
| `overflow` | 请求以上下文溢出失败（pi-ai `isContextOverflow`）：压缩一次再重试一次；每个 Run 至多一次 | 以原模型错误结束 |
| `manual` | `/compact [指示]`：一个 `run_start { trigger: compact }` 的 Run，只提交 `compaction` 与 `run_end`；指示追加为摘要的额外要求。没有可摘要的较早内容时 400 `bad-request`（`details.reason: nothing-to-compact`），不开始 Run；检查与开始之间的竞态中 Run 同样以 `model_error`（`Nothing to compact…`）结束 | Run 以 `error`（`model_error`）结束，不可重试 |

- 熔断：一个 Session 连续 3 次自动或溢出压缩失败后不再自动压缩（运行时内存；Sidecar 重启或任何一次成功的压缩后复位，手动失败不计入暂停）。`compaction_failed.consecutiveFailures` 为任何触发方式的连续失败数。用量接口的 `autoCompact.paused` 来自 `SessionService.compactionPaused`。
- 停止：压缩中 `POST …/abort` 停止摘要请求，不提交 `compaction` 条目，也不发 `compaction_failed`；Run 以 aborted 结束。
- progress：`compaction_start { trigger }`、`compaction_end { trigger, tokensBefore, tokensAfter }`、`compaction_failed { trigger, message, consecutiveFailures }`。Sidecar 另记 info `manual compaction started`（只记是否带指示）。

### 切点

从最后一个有效 compaction 保留的部分起（没有时从头），对 user、assistant 与 toolResult 消息从尾部累加 chars/4 到 20 000 tokens；越过的位置之后最近的 user 或 assistant 消息开始处为切点（firstKeptSeq），不拆开 toolCall 与 toolResult；最后的工具结果本身就超过预算时保留它的调用。出错或中止的回复与 system 消息（工具声明的变化）不作为切点、不进入摘要。切点落在第一条消息或尾部不足 20 000 时没有可摘要的内容，不压缩。

### 摘要请求

- Session 当前模型、没有工具、`maxTokens` 20 000（不超过模型上限）、不写提示缓存，经与对话请求相同的重试。系统提示要求只输出摘要、不接着对话、不调用工具；唯一一条 user 消息是 `<conversation>` 中序列化的文本：`[User]`、`[Assistant]`、`[Assistant tool calls]: name(k=v)`、`[Tool result]`（每个截断到 2000 字符），思考省略。`<file_reference>` 与 `<instruction_file>` 块缩为一行 `[file reference attached: <path>]` / `[instruction file attached: <path>]`，图片写为 `[image omitted]`，用户自己写的文本逐字保留。
- 输入上限：整个请求文本不超过 (窗口 − 摘要输出上限) × 4 个字符。超出时从最早处省略，先省略工具结果，再省略消息，开头注明 `[N earlier messages omitted to fit the summary request]`；只剩一条仍超出时截掉它的中间。摘要请求因此不会自身溢出而反复触发熔断。
- 结构固定为 `## Goal`、`## Constraints & Preferences`、`## User Messages`（逐条，安全相关约束原文保留，不把 assistant 的话当成用户的）、`## Files and Code`、`## Errors and Fixes`、`## Key Decisions`、`## Progress`（Done / In Progress / Blocked）、`## Pending Tasks`、`## Current Work`、`## Next Step`（须与最近的明确请求一致）。已有摘要时用增量更新提示，上次摘要在 `<previous-summary>` 中。
- 回复出错、被截断（`length`）、含工具调用或为空都算失败。成功时摘要正文之后追加 `<read-files>`、`<modified-files>`（从被摘要的 read / write / edit 调用与上次的列表汇总，改过的不再列为只读）与 `<invoked-skills>`（skill 调用与 Skill 来源的命令），只列路径与名字，不重读内容。
- 摘要文本与其他模型输出一样，入库与推送前替换已登记的明文（[按值脱敏](mcp.md#secret-的来源)）；`compaction_failed.message` 与手动压缩失败的 `run_end.error.message` 和其他模型错误文本一样经脱敏后推送与入库。

### 条目与模型上下文

- `compaction { summary, firstKeptSeq, tokensBefore, tokensAfter, trigger, readFiles, modifiedFiles, invokedSkills? }` 在压缩时提交（自动压缩位于本轮 user message 或工具结果之后、下一条 assistant 之前）。之后的模型上下文为开头的系统消息、合成摘要消息（user，`The conversation history before this point was compacted…<summary>…</summary>`）与 firstKeptSeq 及之后的有效消息（`modelContext`）；运行时按条目重建对话记录，去掉出错的回复。`tokensBefore` 为压缩前的估算，`tokensAfter` 为重建后的 chars/4 估算。
- 嵌套指令的"已加载"从上下文中的 toolResult 块派生，压缩移除这些块后下次触及该目录时重新加载。
- 回退到压缩之前的消息时，compaction 落在被回退区间内而不生效，原历史恢复。分叉复制目标之前最后一个 compaction 保留的消息与权限条目；compaction 条目紧接 `fork_origin`、排在复制的条目之前，`firstKeptSeq` 为新 Session 中第一条复制的消息（新 Session 从 seq 1 编号）。新 Session 的模型上下文与原 Session 在目标处相同；被摘要替代的消息不复制。之后在分叉中回退到任一复制的消息时 compaction 不在被回退的区间内，摘要仍是模型上下文的开头（分叉中没有原历史可以恢复）。估算时复制的消息（没有 runId）的 usage 不当作压缩之后的 usage。

### 界面

- 时间线：`compaction` 条目显示为分隔条（`data-slot="compaction-divider"`，`data-trigger`）"已压缩上下文 · 约节省 N tokens"（N = tokensBefore − tokensAfter），展开显示摘要（Markdown）；之前的消息照常显示。trigger compact 的 Run 进行中不显示"生成中"，失败不提供重试。
- 输入区：当前会话收到 `compaction_start` 后，输入框上方显示状态行"正在压缩上下文…"与"停止压缩"（即停止当前 Run）；`compaction_end`、`compaction_failed`、`run_end` 或重连时清除。
- 失败时每次一个 Toast，第 3 次自动失败的 Toast 改为提示自动压缩已暂停并给出 `/compact`；暂停标记见[上下文环](#上下文环)。

### 压缩后的 `<todo_list>`

`<todo_list>` system section 每个 Run 开始时从该 Session 最新的 `todo_list` 条目生成，不依赖对话消息：压缩把 todo_write 的调用与结果摘要掉之后，有未完成项时 section 照常注入，模型仍看到当前表。见 [Todo List](todo.md#注入)。

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
- `tests/integration/secrets-gate-references.test.ts`：引用块中的登记 Secret 在 user message 条目、faux requestLog、推送、库与日志中都是标记。
- `tests/integration/sidecar-references.test.ts`：真实 Sidecar 上的 user message 块与 faux requestLog、project 作用域的 Read 拒绝规则、命令与引用的顺序、`GET /api/workspaces/:id/files`。
- `packages/ui/src/composer/file-reference-node.browser.test.tsx`：节点的插入与整体删除、序列化、EditorState JSON 往返与拒绝、目录 Tab、onDraftChange。
- `apps/desktop/src/renderer/stores/draft-store.test.ts`、`features/conversation/timeline.test.ts`：草稿的键、防抖与损坏处理；引用 chip 的派生。
- `apps/desktop/e2e/references-drafts.e2e.test.ts`：Electron 中的 @ 菜单与 chip、草稿在切换会话与重启后保留、提交后清除、损坏的草稿。
- `packages/agent/src/context/usage/usage.test.ts`：128k、400k、1M 窗口的阈值与预警、估算（有 / 无 usage、跳过出错与中止的回复）、时间裁剪（59 分钟不裁、61 分钟裁、保留最近 5 个、2KB 以下保留、输入不变、后续请求前缀稳定）。`apps/server/src/application/context/usage.test.ts`：注入时钟与 `context.trimOldToolResults` 开关。
- `tests/integration/sidecar-context.test.ts`：草稿与会话的用量接口（分项、指令文件与截断、Skills 诊断、404）、Run 后 tokens 等于 faux usage（加其后 toolResult 的 chars/4）、`context_usage` 在 assistant 条目之后。`tests/integration/secrets-gate-context.test.ts`：用量响应在秘密总闸的扫描范围内。
- `packages/agent/src/context/compaction/compaction.test.ts`：切点表驱动（不拆调用对、只有最近内容时不压缩、出错回复与被回退的压缩）、增量更新与指示、文件与 Skill 汇总、压缩后不信任旧 usage、熔断计数与复位；附加文件块缩为路径、摘要输入超过上限时从最早处省略。`packages/agent/src/engine/compaction.test.ts`：被摘要内容超过窗口时摘要请求的输入受限、压缩成功。`packages/agent/src/checkpoints/rewind.test.ts`：分叉中 compaction 的位置与 `firstKeptSeq`、分叉后回退到第一条保留的消息、复制消息的 usage 不用于估算。`packages/agent/src/engine/compaction.test.ts`：运行时的自动、关闭、溢出、熔断与手动复位、手动压缩中停止。`packages/agent/src/checkpoints/rewind.test.ts`：经过压缩的分叉。
- `tests/integration/sidecar-compaction.test.ts`：真实 Sidecar（faux 60k 窗口）的自动压缩条目与 requestLog（摘要请求无工具、节标题、下一次请求）、回退到压缩之前、压缩后分叉的请求一致、`/compact` 的服务端动作路径与指示、没有可摘要内容时 400、压缩中停止、熔断与用量接口 `paused`、溢出后压缩并重试。`tests/integration/secrets-gate-compaction.test.ts`：摘要请求的错误回显 Credential 时 `compaction_failed`、`run_end`、日志与库中没有明文。
- `apps/desktop/src/renderer/features/conversation/timeline.test.ts`、`composer.browser.test.tsx`、`stores/context-store.test.ts`：分隔条与节省数、compact Run 的错误不可重试；状态行与停止；进度跟踪。`apps/desktop/e2e/compaction.e2e.test.ts`：Electron 中的失败 Toast、熔断暂停标记、`/compact` 状态行、分隔条与摘要展开、之前的消息仍在。
- `packages/agent/src/testing/grep-contract.ts`（内置 grep 与 `apps/server/src/adapters/ripgrep.test.ts` 都运行）：临时 HOME 下的 `.git/info/exclude`、`core.excludesFile`、XDG 缺省文件与没有这些文件时；`tools/builtin/walk.test.ts`：find 与文件候选、嵌套仓库与 worktree。
- `apps/desktop/src/renderer/features/conversation/context-ring.browser.test.tsx`、`stores/context-store.test.ts`：环的档位与颜色、HoverCard 内容、Esc 与焦点、390px 宽输入区不重叠；读取与过期请求。`apps/desktop/e2e/context.e2e.test.ts`：Electron 中的百分比、越过预警线变色、卡片的分项与指令文件、Esc、最窄窗口。

## 延伸阅读

- [命令](commands.md)：输入展开的前一步与 typeahead 的通用规则。
- [权限判定与审批](permissions.md)：Read 拒绝规则与作用域。
- [界面约定](../tech-stack/ui.md)：composer 与草稿的技术约定。
- [指令文件](instructions.md)：用量接口中指令文件与截断的来源。
