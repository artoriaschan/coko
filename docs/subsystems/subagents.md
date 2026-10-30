---
kind: reference
description: "当前的子代理（Subagent）契约：定义文件与诊断、agent / agent_wait / agent_cancel、子 Session、工具交集与有效权限、审批、预算汇入 Goal、并行上限与取消、后台通知、isolation worktree、重启中断与 HTTP 接口。修改子代理的派发、权限、审批、预算、恢复或接口前查阅。"
lifecycle: active
---

# 子代理

本文说明 Coko 当前如何把一段独立工作派发给子代理：子代理在同一 Sidecar 的子 Session 中以独立上下文运行，只把结论交回父 Session。决定与备选方案见 [ADR 0014](../adr/0014-subagents-as-child-sessions.md)；权限类见 [权限判定与审批](permissions.md)；预算口径见 [Goal](goal.md)；worktree 的创建与移除见 [Worktree](worktrees.md)。界面（`agent` 工具卡、右栏 Agents tab、审批冒泡、设置分区）尚未交付。

## 结构入口

- `packages/agent/src/agents/definitions.ts`：内置定义、frontmatter 解析与诊断、加载顺序、工具交集（`subagentTools`）与有效模式（`effectiveSubagentMode`）。
- `packages/agent/src/agents/tools.ts`：三个工具、`<agent-result>` 与 `<agent-notification>` 的文本。
- `apps/server/src/application/subagents.ts`：`SubagentService`（派发、等待、取消、通知、恢复，也是子 Session 的权限作用域）。
- `apps/server/src/application/context/subagents.ts`：工具注册、`<subagent>`、`filterTools`、max-turns 检查、SubagentStop。
- `apps/server/src/http/routes/agents.ts`：HTTP 接口。

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
- `agent_wait`、`agent_cancel` 只在本 Session 有过子代理时注册；子 Session 中三个工具都不注册。

派发失败（未知类型、模型不在 Catalog、并行上限、预算、隔离）时 `agent` 为错误结果，不创建子 Session。结果与通知中的状态与用量只来自宿主的 `agent_end`；子代理文本中的 `<agent-result` / `<agent-notification` 标签被转义。模型给出的 description 与 prompt 在派发时按值替换登记的 Secret（子 Session 的首条 user message、标题与通知不再经过替换）。

## 子 Session

子 Session 的 `parent_session_id` 为父 Session；首条条目为 `subagent_origin`（来源、定义、工具表），父 Session 依次有 `agent_start`（与派发它的调用同一 Run）与 `agent_end`。子 Session 不在 `GET /api/sessions` 中；提交、追加指令、重试、继续、切换模式与修改 Session 规则都返回 409 `child-session`；审批照常可答。

- **上下文。** 子 Run 以 `trigger: subagent` 开始，首条 user message 为 prompt（SubagentStart Hook 的 additionalContext 作为其后的 `<hook-context>` 块）。system sections 照常（指令、Skills、Memory），另有 `<subagent type="…">`（角色正文与交回结论的要求），没有 `<goal>`。
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

后台子代理结束时提交 `agent_end` 并发 `agent-finished` 桌面通知。模型没有用 `agent_wait` 读到终态时送达 `<agent-notification agent-id agent-type status>`（摘要；结果 ≤ 2 048 字符时内联在 `<result>` 中，否则提示用 agent_wait）：父 Session 有 Run 时作为追加指令（前置 `agent_notification` 条目），没有时挂起，合并到下一个 Run 的 user message 开头；作为追加指令却没有送达的，Run 结束后挂起。通知不唤醒空闲的 Session。

## isolation worktree

`isolation: 'worktree'` 时经 WorktreeService 的 `createForSubagent` 在 `.coko-worktrees/` 创建 worktree 并绑定子 Session。判定：只有 full-access 直接放行，其余模式询问；plan / read-only 下询问允许后工具为错误结果，不创建 worktree。子 Session 结束时 HEAD 仍为 base 且工作区干净则移除 worktree 并删除分支；否则保留，`agent_end.worktree { kept: true, path, branch }`，结果末尾注明。保留的 worktree 在父 Session 中加一条不入库的询问规则 `Read(<path>)`：父 Session 读取其中文件须审批（启动恢复时重新登记仍 active 的）。

## 重启

子 Session 的 Run 按现有中断恢复处理，不自动重跑。Session 恢复之前，被中断的父 Run 中仍在等待的前台 `agent` 调用先补 `agent_end { status: interrupted }` 与结果 `Subagent interrupted by a restart; partial results are in child session <id>.`，因此不进入结果确认；Session 恢复之后，其余没有 `agent_end` 的子代理（后台）补记 interrupted。正常关闭时 Run 被中断，子 Run 以 cancelled 结束。

## HTTP

- `GET /api/sessions/:id/agents` → `[{ agentId, agentType, description, status, background, startedAt, endedAt?, usage?, worktree? }]`（由 `agent_start` / `agent_end` 与进程内状态派生）。
- `POST /api/sessions/:id/agents/:agentId/cancel` → 204；已结束或不是该 Session 的子代理 409 `agent-not-running`。
- `GET /api/agents/definitions?workspaceId=` → `{ definitions, diagnostics }`（Workspace 目录的定义）。
- Session DTO 的 `parentSessionId` 只出现在子 Session 上；进度 `agent_update { agentId, status, activity? }` 发给父 Session（activity 为最近一次工具调用的名字与 ≤ 120 字符的脱敏摘要）。

## 已知限制

- 子代理的进程内状态（定义、根 Session、等待者）不跨重启保留；重启后的子 Session 按 parentSessionId 取根 Session 的权限，工具只去掉固定排除集。
- plan / read-only 下 isolation 先询问再返回错误结果（判定在工具执行之前）。
- 删除或归档父 Session 时不处理子 Session；子代理不能继续对话。

## 验证

- `packages/agent/src/agents/definitions.test.ts`：每种诊断、同名覆盖与符号链接、工具交集、有效模式、结果截断与标签转义、通知内联。
- `tests/integration/sidecar-subagents.test.ts`：前台独立上下文、并行、后台的送达与挂起、agent_wait、cancel 与第 5 个、列表与 409、GET …/agents 与定义、max-turns 与伪造的结果标签。
- `tests/integration/sidecar-subagents-permissions.test.ts`：审批在子 Session 回答、规则写入根、PermissionRequest Hook、定义不能放宽、根切到 read-only、工具表与固定排除、`Agent(general)` 拒绝。
- `tests/integration/sidecar-subagents-budget.test.ts`、`sidecar-subagents-cancel.test.ts`、`sidecar-subagents-restart.test.ts`、`sidecar-subagents-isolation.test.ts`、`secrets-gate-subagents.test.ts`。

## 延伸阅读

- [Goal](goal.md)：子 Session 用量的汇入与预算检查点。
- [启动恢复](recovery.md)：被中断的 Run 与领域恢复钩子的顺序。
- [外部 Hook](hooks.md)：SubagentStart / SubagentStop 之外的事件。
