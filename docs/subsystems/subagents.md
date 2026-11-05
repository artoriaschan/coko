---
kind: reference
description: "当前的子代理（Subagent）契约：定义文件与诊断、agent / agent_wait / agent_cancel、子 Session、工具交集与有效权限、审批、预算汇入 Goal、并行上限与取消、后台通知、isolation worktree、重启中断、HTTP 接口与界面（工具卡、Agents tab、审批冒泡、设置分区）。修改子代理的派发、权限、审批、预算、恢复、接口或界面前查阅。"
lifecycle: active
---

# 子代理

本文说明 Coko 当前如何把一段独立工作派发给子代理：子代理在同一 Sidecar 的子 Session 中以独立上下文运行，只把结论交回父 Session。决定与备选方案见 [ADR 0014](../adr/0014-subagents-as-child-sessions.md)；权限类见 [权限判定与审批](permissions.md)；预算口径见 [Goal](goal.md)；worktree 的创建与移除见 [Worktree](worktrees.md)。界面见下文 [界面](#界面)。

## 结构入口

- `packages/agent/src/agents/definitions.ts`：内置定义、frontmatter 解析与诊断、加载顺序、工具交集（`subagentTools`）与有效模式（`effectiveSubagentMode`）。
- `packages/agent/src/agents/tools.ts`：三个工具、`<agent-result>` 与 `<agent-notification>` 的文本。
- `apps/server/src/application/subagents.ts`：`SubagentService`（派发、等待、取消，也是子 Session 的权限作用域）；`subagent-notifications.ts`（`agent_update` 进度、桌面通知、结束通知的送达与挂起、`agent_wait`）；`subagent-recovery.ts`（`subagent_origin` / `agent_start` / `agent_end` 的记录、用量、isolation worktree 的回收与询问规则、启动恢复）。SubagentStart / SubagentStop 的输出由 `HookService.subagentStart` / `subagentStop` 解释（`redactText`，≤ 10 000 字符）。
- `apps/server/src/application/context/subagents.ts`：工具注册、`<subagent>`、`filterTools`、max-turns 检查、SubagentStop。
- `apps/server/src/http/routes/agents.ts`：HTTP 接口。
- renderer：`stores/agents-store.ts`（列表、`agent_update` 合并、停止、子 Session 的审批回答、定义）、`features/conversation/{agents-button,agent-card,agent-notification-row,approval-panel}.tsx`、`features/right-panel/agents-tab.tsx`、`features/settings/agents-section.tsx`。

## 定义

内置 `general`（父级全部可用工具）与 `explore`（read、grep、find、ls、bash，`permission-mode: read-only`，只调研并给出文件与行号）。用户定义在 `~/.coko/agents/*.md`，项目定义在 Session 工作目录的 `.coko/agents/*.md`；同名时 project > user > builtin，被覆盖的一方记 `shadowed`。每次派发与列出时按目录现读，文件内容按 mtime 与大小缓存。能力开关 `agents.enabled`（缺省 true，项目文件只能关闭）。

frontmatter 字段：`name`（必填，`[a-z0-9-]{1,64}`）、`description`（必填）、`tools` 与 `disallowed-tools`（逗号分隔或列表）、`model`（`inherit` 或 `<providerId>/<modelId>`）、`thinking`、`permission-mode`（read-only / default / accept-edits / full-access）、`max-turns`（1–200，缺省 50）；正文为角色提示。诊断（source `agents`）：

| 代码 | 时机 | 结果 |
| --- | --- | --- |
| `invalid-frontmatter` | YAML 不合法、缺必填字段、name 格式、tools 形状、permission-mode / max-turns / thinking 不合法、同一目录重名 | 不加载（不猜测更宽的值） |
| `unknown-tool` | 工具名不是宿主已知的工具 | 忽略该项 |
| `unknown-model` | 模型不在 Model Catalog 中 | 回到 inherit |
| `shadowed` | 被更高优先级的同名定义覆盖 | 被覆盖者不生效 |
| `agent-outside-workspace` | 项目定义（或 `.coko/agents` 目录本身）的真实路径不在工作目录之内 | 不加载 |
| `read-failed` | 读取失败 | 不加载 |

## 工具

- `agent { description, prompt, subagent_type?, model?, run_in_background?, isolation?: 'worktree' }`：权限类 agent，规则组名 `Agent`、内容为子代理类型。同一批的多个调用并行（调度中按 read 共享执行槽；判定只看权限类）。前台等待子 Run 结束，结果为 `<agent-result agent-id status turns tool-calls tokens cost duration-ms>文本</agent-result>`：文本为子 Session 最后一条非空 assistant 文本，超过 50 000 字符截断并注明子 Session；状态不是 completed 时为错误结果。后台立即返回 `Started subagent <id> (<type>): <description>. Wait with agent_wait.`。
- `agent_wait { agent_ids?, timeout_ms? }`（context-read，缺省 30 000 ms，上限 600 000 ms）：子代理结束、超时或追加指令到达时返回各自状态与结果；不给 id 时等待本 Session 全部 running 的子代理（没有时列出全部）。
- `agent_cancel { agent_id }`（session-state）：abort 子 Run 并等待 `agent_end`。
- `agent_wait`、`agent_cancel` 只在本 Session 有过子代理时注册；第一次派发之后在同一个 Run 的下一次请求就注册（`agent_start` 之后宿主重新取工具，变化以 toolsAdded 告知模型）。子 Session 中三个工具都不注册。没有 isolation 的子 Session 继承父 Session 的 worktree（工作目录与父级相同）。

派发失败（未知类型、模型不在 Catalog、并行上限、预算、隔离）时 `agent` 为错误结果，不创建子 Session。结果与通知中的状态与用量只来自宿主的 `agent_end`；子代理文本中的 `<agent-result` / `<agent-notification` 标签被转义。模型给出的 description 与 prompt 在派发时按值替换登记的 Secret（子 Session 的首条 user message、标题与通知不再经过替换）。

## 子 Session

子 Session 的 `parent_session_id` 为父 Session；首条条目为 `subagent_origin`（来源、定义、工具表），父 Session 依次有 `agent_start`（与派发它的调用同一 Run）与 `agent_end`。子 Session 不在 `GET /api/sessions` 中；提交、追加指令、重试、继续、切换模式与修改 Session 规则都返回 409 `child-session`；审批照常可答。

- **上下文。** 子 Run 以 `trigger: subagent` 开始，首条 user message 先放该子 Session 需要送达的 State Update（包括首轮日期），再放 prompt；SubagentStart Hook 的 additionalContext 作为 prompt 之后的 `<hook-context>` 块。子 Session 不接收根 Goal 的 State Update。system sections 照常（环境、指令、Skills、Memory），另有 `<subagent type="…">`（角色正文与交回结论的要求），没有 `<goal>`。
- **工具。** 派发时父级本 Run 可用工具 ∩ 定义 `tools` − `disallowed-tools` − 固定排除集（`agent`、`agent_wait`、`agent_cancel`、Goal 的三个工具、`exit_plan_mode`、`schedule_*`、`job_*`、`memory_write`、`memory_delete`）。开头的系统消息只列这些工具。子 Session 没有后台任务入口：bash 的 `run_in_background` 失败。
- **模型。** 参数 > 定义 > 父 Session 当前模型。
- **轮次。** 每次子 Run 的模型请求前计数已有的 assistant 消息，达到 `max-turns` 时不发出请求，`run_end { status: paused, error: { code: max_turns } }`、`agent_end { status: max-turns }`。
- **SubagentStop。** 子 Run 正常结束前运行（matcher 为子代理类型，输入有 `agent_type`、`agent_id`、`stop_hook_active`、`parent_session_id`）；block 时以原因再请求一次，每 Run 至多 3 次。

## 有效权限与审批

子 Session 没有自己的模式与规则：每次判定时取根 Session 当前的状态。模式 = min(根当前模式（plan 按 read-only）, 定义 `permission-mode`)，序为 read-only < default < accept-edits < full-access；规则为根 Session 的 Session 规则加全局、Workspace 与 project 规则。根中途切换模式时子级的待审批请求重新判定，下一次调用按新模式。可写根与沙箱按子 Session 的工作目录。

审批在子 Session 中等待，不自动拒绝；经 `POST /api/sessions/<child>/approvals/<id>` 回答，PermissionRequest Hook 可代答。"本会话总是允许"把规则写入根 Session。任一 running 子代理等待审批时父 Session 的 `activity` 为 `awaiting-approval`；后台子代理提交 `approval_request` 时发 `approval-waiting` 通知。

## 预算、并行与取消

派发它的父 Run 属于 Goal G 时，`agent_start.goalId` 为 G，子 Session 的全部 Run 计入 G（`goalUsage(..., { children })`，不计轮次）。子 Run 的每次请求前与工具调用前检查 G 的五维（含其他子 Session 的已用）；耗尽时子 Run 停止（`agent_end failed`），父级在下一个检查点停止，G 进入 budget-exhausted。G 设了 `maxCost` 而子代理模型未定价时 `agent` 为错误结果。创建 Goal 的那个 Run 不属于 Goal（与 Goal 的口径相同），它派发的子代理不计入。

每个根 Session 同时至多 4 个 running 子代理，第 5 个为错误结果。停止父 Run 只 abort 前台子代理（`agent_end cancelled`），后台继续。取消 G 先停止 G 的 Run 派发的全部 running 子代理，记入 `cleanup.agentsStopped`。

## 后台通知

后台子代理等待审批时发 `approval-waiting`、结束时提交 `agent_end` 并发 `agent-finished` 桌面通知（经控制通道的 `notify`）。通知文本是宿主通知：Goal Round 与 continue 中送达时不授予用户权限（`runAuthority`），Run 结束时退回的通知不算用户的追加指令（标签见 `@coko/agent/entries` 的 host-input）。模型没有用 `agent_wait` 读到终态时送达 `<agent-notification agent-id agent-type status>`（摘要；结果 ≤ 2 048 字符时内联在 `<result>` 中，否则提示用 agent_wait）：父 Session 有 Run 时作为追加指令（前置 `agent_notification` 条目），没有时挂起，合并到下一个 Run 的 user message 开头；作为追加指令却没有送达的，Run 结束后挂起。通知不唤醒空闲的 Session。

## 团队与继续对话

`agent` 带 `name` 时创建 teammate：后台运行、Run 结束后保留，可以经 `send_message` 再接收消息，另有 `send_message` 与 `task_*` 工具和 `<team>` section；`agent_cancel` 对 teammate 为解散（`agent_end { status: dismissed }`），isolation worktree 保留到解散。lead 也可以用 `send_message { to: <agentId> }` 继续已结束（completed、max-turns、failed）的一次性子代理：在其子 Session 开始新 Run，结束时父级收到 `agent_notification`；cancelled、interrupted 与 dismissed 的为 `agent-not-reachable`。消息送达时已有 4 个 running 则排队。子 Session 的 Run 记录 `run_start.subagent.triggerRunId`，预算按它归属 Goal（没有它的旧条目按 `agent_start` 所在 Run）。规则见 [Agent Teams](teams.md)。

## isolation worktree

`isolation: 'worktree'` 时经 WorktreeService 的 `createForSubagent` 在 `.coko-worktrees/` 创建 worktree 并绑定子 Session。判定：plan / read-only 下 gate 直接给出错误结果（`isolation: worktree is not available in <mode> mode`，在 Hook 与规则的拒绝之后、询问之前），不询问、不创建 worktree；full-access 直接放行，其余模式询问。派发没有完成（子 Session 或条目提交失败）时没有改动的 worktree 被回收、询问规则去掉，不残留 running 的子代理。子 Session 结束时 HEAD 仍为 base 且工作区干净则移除 worktree 并删除分支；否则保留，`agent_end.worktree { kept: true, path, branch }`，结果末尾注明。保留的 worktree 在父 Session 中加两条不入库的询问规则 `Read(<path>)` 与 `Edit(<path>)`（Edit 规则组覆盖 write 与 edit）：父 Session 在任何模式下读取、写入或编辑其中的文件都须审批（启动恢复时重新登记仍 active 的；worktree 移除时去掉）。bash 不受这些规则保护：父 Session 的命令可以读写该目录（受模式与沙箱限制）。

## 重启

子 Session 的 Run 按现有中断恢复处理，不自动重跑。Session 恢复之前，被中断的父 Run 中没有结果的 `agent` 调用（前台与后台）先补 `agent_end { status: interrupted }` 与结果 `Subagent interrupted by a restart; partial results are in child session <id>. It may have changed files before it stopped: …`，因此不进入结果确认，也不得到 read 工具"没有副作用、可以重试"的文本。崩溃在 `agent_start` 之前、子 Session 已创建时，从子 Session 的 `subagent_origin` 补记 `agent_start`；子 Session 还没创建时结果说明子代理没有开始。被中断的子代理的 isolation worktree 按 `removeIfUnchanged` 回收（有改动时保留并记在 `agent_end.worktree`）；子代理派发时创建、还没有子 Session 绑定的 worktree 由 WorktreeService 的启动恢复同样回收。Session 恢复之后，其余没有 `agent_end` 的子代理（后台）补记 interrupted。正常关闭时 Run 被中断，子 Run 以 cancelled 结束。

## HTTP

- `GET /api/sessions/:id/agents` → `[{ agentId, agentType, description, status, background, startedAt, endedAt?, usage?, worktree? }]`（由 `agent_start` / `agent_end` 与进程内状态派生）。
- `POST /api/sessions/:id/agents/:agentId/cancel` → 204；已结束或不是该 Session 的子代理 409 `agent-not-running`。
- `GET /api/agents/definitions?workspaceId=` → `{ definitions, diagnostics }`（Workspace 目录的定义）。
- Session DTO 的 `parentSessionId` 只出现在子 Session 上；进度 `agent_update { agentId, status, activity? }` 发给父 Session（activity 为最近一次工具调用的名字与 ≤ 120 字符的脱敏摘要）。

## 界面

- **`agent` 工具卡。** 标题为"子代理 <类型>"，摘要为描述，状态取 `agent_end`（没有时取 `agent_update` 合并的列表，有 `agent_start` 时为运行中）：running / completed / failed / cancelled（已停止）/ max-turns（达到轮次上限）/ interrupted。卡片沿用对话工具的紧凑摘要行，默认收起并由用户手动展开：运行中显示一行进度（`agent_update.activity` 的工具名与摘要；后台为"已在后台运行"，还没有工具调用时为"正在启动…"），结束后显示轮次、工具调用、Token 与时长；后台子代理在标题行有"后台"标记，保留的 worktree 显示分支。明细采用结构化详情表面，显示结果文本（`<agent-result>` 的正文；后台的启动文本不冒充最终结果）与"在侧边栏查看"；“输入 / 输出”保留完整真实参数、结果块与结构化输出。主时间线的查看按钮打开现有 Trace，子 Session 不提供没有对应追踪入口的按钮。状态与用量不读结果文本中的标签。派发失败（没有 `agent_start`）时按工具调用的错误显示，不提供打开入口。
- **Session 归属。** 工具卡和通知行只使用时间线调用方显式传入的 Session 身份与条目，不读取当前激活的父 Session；派发记录同时核对调用与 Run。父子时间线的开合互不影响，显式收起整轮才重置内部详情。子时间线没有重试、回退、分叉与提交操作，审批仍由原父会话冒泡路径回答。
- **`agent_notification` 行。** 紧凑行"子代理已结束"，每个子代理一项（状态点、类型 · 描述、状态），点击打开或聚焦右栏 Agents 页面。紧随其后、送达通知的 user message 中的 `<agent-notification …>` 文本块不显示为用户气泡（只有通知的消息不成气泡，同一消息中的用户文字照常显示）；不在 `agent_notification` 条目之后的同样文本照常显示。
- **标题栏"子代理"按钮。** 会话有子代理时显示，徽标为 running 数；点击打开或聚焦右栏 Agents 页面。工具卡与通知行的打开请求经过同一入口。按钮只显示状态，在任何主区宽度下都直接留在标题栏。
- **右栏 Agents tab。** 列表（状态点、类型、描述，次行为状态 · 用量或已运行时长 · 后台，保留的 worktree 分支）；缺省选中最近派发的运行中子代理，选中后固定。选中项的明细订阅子 Session（不切换当前会话），以 TimelineView 显示只读时间线（没有输入区与消息动作，底部注明只读），运行中时有"停止"（`POST …/agents/:agentId/cancel`，已结束视为成功）。键盘：列表项 Enter 选中并打开其时间线，Tab 到达停止按钮。
- **审批冒泡。** 父会话订阅其 running 子代理的子 Session；父会话与这些子 Session 中最早的待审批请求（按条目 `createdAt`）接管父会话输入区。来自子代理的卡片标出"来自子代理 <类型> · <描述>"，回答发往子 Session 的 `POST /api/sessions/<child>/approvals/<id>`（同一请求只发送一次）；"总是允许"照常写入根 Session。输入区在接管期间保持挂载，草稿不丢。
- **设置 → Agents。** 按当前会话（或草稿）的 Workspace 读取 `GET /api/agents/definitions`，按来源（内置、用户、项目）分组列出名称、描述、工具、模型、权限上限、轮次上限与文件路径；诊断折叠在"诊断（n）"中，可展开。只读，注明在 `~/.coko/agents/*.md` 与会话目录的 `.coko/agents/*.md` 中编辑。没有会话时只说明位置。

## 已知限制

- 子代理的进程内状态（定义、根 Session、等待者）不跨重启保留；重启后的子 Session 按 parentSessionId 取根 Session 的权限，工具只去掉固定排除集。
- 删除或归档父 Session 时不处理子 Session。
- 界面只为 running 的子代理订阅子 Session 以冒泡审批；已结束的子代理不会再有待审批请求。Agents tab 的子时间线不显示 Run 用量行（用量在列表中）。

## 验证

- `packages/agent/src/agents/definitions.test.ts`：每种诊断、同名覆盖与符号链接、工具交集、有效模式、结果截断与标签转义、通知内联。
- `tests/integration/sidecar-subagents.test.ts`：前台独立上下文、并行、后台的送达与挂起、agent_wait（含第一次派发的同一个 Run）、approval-waiting 与 agent-finished 的 notify、cancel 与第 5 个、列表与 409、GET …/agents 与定义、max-turns 与伪造的结果标签。max-turns 按本 Run 已提交的 assistant 条目计数（自动压缩不重置）。
- `apps/server/src/application/subagents-recovery.test.ts`、`subagents-dispatch.test.ts`：重启时后台与 agent_start 之前的调用、派发失败的清理、max-turns 的计数。
- `tests/integration/sidecar-subagents-permissions.test.ts`：审批在子 Session 回答、规则写入根、PermissionRequest Hook、定义不能放宽、根切到 read-only、工具表与固定排除、`Agent(general)` 拒绝。
- `tests/integration/sidecar-subagents-budget.test.ts`、`sidecar-subagents-cancel.test.ts`、`sidecar-subagents-restart.test.ts`、`sidecar-subagents-isolation.test.ts`、`secrets-gate-subagents.test.ts`。
- 界面：`apps/desktop/src/renderer/stores/agents-store.test.ts`（进度合并、较早的列表不覆盖结束状态、停止的 409、审批只回答一次）；Browser Mode 的 `features/conversation/agent-card.browser.test.tsx`（六种状态的中英文、进度随 `agent_update` 更新、用量、后台 chip、worktree、派发失败与打开请求）、`approval-bubbling.browser.test.tsx`（父会话与两个子代理的请求按时间顺序接管、来源标注、回答发往子 Session、草稿不丢；子代理结束或界面卸载后释放子 Session 的订阅）、`features/right-panel/agents-tab.browser.test.tsx`（列表、只读子时间线、键盘停止与选中、标题栏按钮）、`features/settings/agents-section.browser.test.tsx`；Electron E2E `apps/desktop/e2e/subagents.e2e.test.ts`（真实 Sidecar 与 faux：前台进度与结果、子时间线、写入审批在父会话中允许、后台子代理键盘停止为 cancelled、标题栏 running 数、明暗主题对比度与 390 px、设置 → Agents 的内置 / COKO_HOME / 项目定义与诊断）；`apps/desktop/e2e/subagent-notifications.e2e.test.ts`（接收侧：后台子代理等待审批时 desktop.jsonl 有 `notification shown { kind: approval-waiting }`，回答后结束时有 `agent-finished`，都属于父 Session）。

## 延伸阅读

- [Goal](goal.md)：子 Session 用量的汇入与预算检查点。
- [启动恢复](recovery.md)：被中断的 Run 与领域恢复钩子的顺序。
- [外部 Hook](hooks.md)：SubagentStart / SubagentStop 之外的事件。
- [Agent Teams](teams.md)：具名 teammate、消息、任务板与继续对话。
