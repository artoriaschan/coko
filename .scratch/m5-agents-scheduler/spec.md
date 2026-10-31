# M5 多代理与调度：规格

Status: ready-for-agent
Spec status: delivered（2026-10-31，main 95825aa；真实模型与非 darwin 平台未验证，遗留项见地图 Carry-overs）
Map: [Coko 桌面应用](../desktop-app/map.md) · [里程碑划分](../desktop-app/issues/06-grill-milestone-route.md) · 讨论：[grilling.md](grilling.md) · 实施须知：[implementer-brief.md](implementer-brief.md)

## Problem Statement

M4 之后 Agent 能逐轮推进一个 Goal，但所有工作都挤在一个上下文里：调研、实现与复查互相占用 Token，无法把一段独立的调查交给另一个代理并只拿回结论。用户没有办法在工具调用前后挂上自己的检查（例如禁止某类命令、提交前跑格式化、把通知转发到别处），只能逐条写权限规则。Agent 不能"明早 9 点再检查一次构建"或"每 30 分钟看一下队列"。长会话要换个干净的上下文继续时，只能 Fork（复制全部历史）或手动复制粘贴。多个会话在同一个仓库目录里同时改文件会互相踩踏，没有 git worktree 隔离。M4 评审留下的坏味道（三份 HTTP helper、三份每 Session 锁等）会在 M5 新增的服务中继续复制；手动 /compact 不经预算检查。

## Solution

交付外部 Hooks（10 个事件、command 型、并行执行与 deny > ask > allow 聚合、allow 不越过规则、项目 Hook 逐条批准且只收紧，见 [ADR 0013](../../docs/adr/0013-external-hooks-tighten-only.md)）；Subagents（内置 general / explore 与 Markdown 自定义，子 Session 中独立上下文，工具与模型配置，权限取根当前模式与定义的较窄者，前台 / 后台派发、等待、取消与汇总，审批在父会话中回答，用量计入根 Goal，见 [ADR 0014](../../docs/adr/0014-subagents-as-child-sessions.md)）；定时任务（一次性、间隔、cron，原 Session 投递，至多一次，只补最近一次，运行准入，桌面通知，见 [ADR 0015](../../docs/adr/0015-schedules-at-most-once-latest-catch-up.md)）；Handoff（模型写交接摘要，新 Session 中作为草稿，可选新 worktree）；Worktree（Session 创建时绑定，`.coko-worktrees/<name>`，宿主执行 git，只在干净时由用户移除，子代理可隔离，见 [ADR 0016](../../docs/adr/0016-session-cwd-fixed-worktrees.md)）。界面：子代理卡片与右栏 Agents tab、审批冒泡、Schedules tab、设置的 Hooks / Agents / 定时任务 / 通知分区、侧栏 worktree 菜单、Handoff 对话框。第一张票收敛 M4 遗留，第二张票预建全部共享 seam。术语见 [GLOSSARY](../../GLOSSARY.md)。带 owner 与认领的 Task 不在 M5（随 M6 Agent Teams，见 [grilling G](grilling.md#第-1-轮根节点)）。

## User Stories

**Hooks**

1. As a 用户, I want 配置在工具调用前运行的命令，拒绝或要求确认某些调用, so that 我能用自己的脚本守住危险操作。
2. As a 用户, I want Hook 的放行永远越不过我的拒绝 / 询问规则、受保护路径、沙箱提权与计划审阅, so that 一个脚本不能替我批准越界操作。
3. As a 用户, I want 仓库里的 Hook 只有我按完整命令批准后才运行，改动后须重新批准，而且不能放宽或关闭我自己的 Hook, so that 克隆一个仓库不会执行陌生命令。
4. As a 用户, I want 在提交、Run 结束、压缩与通知时运行 Hook（拒绝提交、要求继续、追加摘要要求、转发通知）, so that 我能接入格式化、检查与外部通知。
5. As a 用户, I want 在设置中编辑 Hook、看到已加载的 Hook 与诊断，并在时间线看到 Hook 阻止或出错的记录, so that 我知道 Hook 做了什么。

**Subagents**

6. As a 用户, I want Agent 把调研或独立子任务派给子代理，子代理用独立上下文工作、只把结论交回, so that 主会话的上下文不被细节占满。
7. As a 用户, I want 用 Markdown 文件定义自己的子代理（角色、工具、模型、权限上限），并有内置的 general 与 explore, so that 我能复用专门的角色。
8. As a 用户, I want 子代理的权限永远不宽于主会话，我收紧主会话的模式后子代理立即收紧, so that 委派不会成为越权通道。
9. As a 用户, I want 子代理需要审批时在主会话中看到并回答，不在前台时收到系统通知, so that 子代理不会无声地卡住或被自动拒绝。
10. As a 用户, I want 子代理的 Token、费用、时间与工具调用计入 Goal 预算, so that "交给子代理"不会绕过上限。
11. As a 用户, I want 在时间线看到子代理卡片与进度、在右栏查看其完整过程并停止它, so that 我能检查和控制它。
12. As a 用户, I want 子代理可以在隔离的 worktree 中改代码，没有改动时自动清理, so that 它不会弄乱我的工作区。

**定时任务**

13. As a 用户, I want 让 Agent（或我自己）设定一次性、固定间隔或 cron 定时任务，到期时在原会话中执行, so that 周期性检查不需要我盯着。
14. As a 用户, I want 应用关闭或睡眠后再打开时每个任务只补跑最近一次、绝不重复投递, so that 不会一下子开出几十个 Run。
15. As a 用户, I want 定时触发的 Run 不能创建新的定时任务或 Goal、不恢复暂停的 Goal、预算耗尽时跳过, so that 无人值守时不会扩大花费或权限。
16. As a 用户, I want 定时任务结束或等待审批、后台子代理结束时收到系统通知，并能在设置中关闭, so that 我在别的窗口也知道。
17. As a 用户, I want 查看、新建、编辑、暂停、删除定时任务及其投递历史（单个会话与全部会话）, so that 我能管理它们。

**Handoff 与 Worktree**

18. As a 用户, I want 把当前会话交接到一个新会话（可选新的 worktree），交接摘要作为草稿让我修改后发送, so that 我能在干净的上下文中继续。
19. As a 用户, I want 在新的 worktree 中新建会话、在侧栏看到它的分支，并在干净时移除 worktree, so that 并行的会话互不干扰。

**结构**

20. As a 开发者, I want M4 评审遗留的重复与坏味道在 M5 新服务落地之前收敛，手动 /compact 同样经过预算检查, so that 新代码不再复制旧问题。

## Implementation Decisions

讨论记录：[grilling.md](grilling.md)，全部按常设指示采纳。

### Session Entry 与事件（票 02 预先声明 schema；"实现"列为写入方）

| kind / 事件 | payload 要点 | 实现 |
| --- | --- | --- |
| `hook_run` v1 | `event`、`hookId`、`source: global / project`、`command`（脱敏）、`outcome: blocked / asked / allowed / denied / context / continued / stopped / timeout / error / invalid-output`、`exitCode?`、`durationMs`、`message?`（≤ 2 KB） | 03、06 |
| `approval_decision` v2 | 增加 `by?: user / hook`；v1 → v2 原样迁移 | 02（03 写 hook） |
| `agent_start` v1 | `agentId`（= 子 Session id）、`agentType`、`description`、`background`、`toolCallId`、`goalId?`、`isolation? { worktreeId, path, branch }` | 07 |
| `agent_end` v1 | `agentId`、`status: completed / failed / cancelled / max-turns / interrupted`、`usage { turns, toolCalls, tokens, cost, durationMs }`、`resultChars`、`worktree? { kept, path, branch }` | 07 |
| `agent_notification` v1 | `agentIds`；紧接在送达通知的 user message 之前 | 07 |
| `subagent_origin` v1 | 子 Session 首条：`parentSessionId`、`parentRunId`、`toolCallId`、`definition { name, source: builtin / user / project, tools, model?, permissionMode?, maxTurns }` | 07 |
| `schedule_fire` v1 | `scheduleId`、`occurrence`（毫秒）、`status: started / skipped`、`reason?`（`disabled` / `child-session` / `workspace-missing` / `worktree-removed` / `model-not-configured` / `budget` / `start-failed`）、`missed?`、`runId?` | 05 |
| `handoff` v1 | 源 Session：`targetSessionId`、`instructions`、`summary`、`target: current / worktree`、`usage?` | 10 |
| `handoff_origin` v1 | 目标 Session 首条：`sessionId`、`seq` | 10 |
| `run_start` v3 | `trigger` 增加 `schedule` / `subagent` / `handoff`；`schedule? { scheduleId, occurrence }`；v2 → v3 原样迁移 | 02 |
| `RunError.code` | 增加 `hook_stopped`、`max_turns` | 02 |
| progress `agent_update` | `agentId`、`status`、`activity?`（最近一次工具调用的名字与 ≤ 120 字符摘要，已脱敏） | 07 |
| progress `schedule_update` | Schedule 的公开快照（列表实时更新） | 05 |

新 kind 入库与推送前经 `redactSecretsDeep`。Fork 与 Handoff 都不复制以上新 kind。

### 迁移 v8（票 02，packages/session）

- `sessions` 增加 `parent_session_id TEXT REFERENCES sessions(id)`、`worktree_id TEXT REFERENCES worktrees(id)`，索引 `sessions_by_parent`。
- 新表 `worktrees`（`id`、`workspace_id`、`name`、`path` UNIQUE、`branch`、`base_commit`、`repo_root`、`status: active / removed`、`created_by: user / subagent`、`created_at`、`removed_at?`；STRICT）。
- 新表 `schedules`（`id`、`session_id`、`title`、`prompt`、`rule`（JSON 文本）、`status: active / paused / inactive`、`next_at?`、`last_occurrence?`、`revision`、`created_at`、`updated_at`；STRICT；索引 `next_at`）。
- 重建 `host_processes`，`kind` 增加 `hook`、`git`（登记行按原样复制）。
- store：`sessions.create({ parentSessionId?, worktreeId? })`；`listSessions` 缺省不含子 Session，`listChildren(parentId)`；`store.worktrees { create, get, list(workspaceId), markRemoved }`；`store.schedules { create, update(id, revision, patch), delete, list({ sessionId? }), due(now), recordFire(id, occurrence, entry) }`，`recordFire` 在一个事务中更新 `last_occurrence` / `next_at` 并追加 `schedule_fire` 条目。契约测试在 SQLite 与内存实现上通过。

### Hooks（agent `extensions/hooks/`，server `application/hooks.ts`、`context/hooks.ts`、`adapters/hook-runner.ts`、`routes/hooks.ts`）

**配置。** 形状与 claude-code 相同：`{ [event]: [{ matcher?, hooks: [{ type: 'command', command, if?, timeout? }] }] }`。全局在设置键 `hooks`；项目在 `<cwd>/.coko/settings.json` 的 `hooks` 键（与已有项目设置同一文件、同一读取时机）。能力开关 `hooks.enabled`（缺省 true，只在全局；项目中的 `hooks.enabled` 以 `project-cannot-grant` 忽略）。诊断：`unsupported-hook-type`、`unknown-event`、`invalid-matcher`、`invalid-if`、`invalid-value`。`hookId` 为来源 + 事件 + 位置；`digest` 为 event、matcher、if、command、timeout 的摘要。

**项目 Hook 批准。** 未批准的项目 Hook 不运行；批准按 Workspace 与 digest 保存（设置键 `hooks.approvals.<workspaceId>`），改动后 digest 变化须重新批准。worktree 会话读该 worktree 的项目文件，按其 Workspace 的批准判定。

**事件**（输入的公共字段：`session_id`、`cwd`、`permission_mode`、`hook_event_name`；子 Session 另有 `parent_session_id`、`agent_type`）：

| 事件 | 时机 | matcher 对象 | 额外输入 | exit 2 | JSON 输出 |
| --- | --- | --- | --- | --- | --- |
| PreToolUse | 权限 gate 内、`decide` 之前 | 工具注册名或其规则组名（不区分大小写） | `tool_name`、`tool_input`、`tool_use_id` | 拒绝，stderr 为原因 | `permissionDecision: allow / deny / ask`、`permissionDecisionReason` |
| PostToolUse / PostToolUseFailure | 结果脱敏之后、提交之前 | 同上 | 另有 `tool_response` | stderr 追加到结果末尾 `<hook-feedback>` | `additionalContext` 同样追加 |
| PermissionRequest | 判定为 ask 且来自第 7 步、卡片出现之前 | 同上 | 同 PreToolUse | 拒绝 | `decision { behavior: allow / deny, message? }` |
| UserPromptSubmit | trigger submit 的输入展开之后、提交之前 | — | `prompt` | 拒绝提交：HTTP 400 `hook-blocked`（原因 ≤ 2 KB），不提交 user message | `decision: block`、`additionalContext`（作为 user message 中单独标注的文本块） |
| Stop | 根 Session 的 Run 正常结束之前 | — | `stop_hook_active` | stderr 作为 user message 送达、Run 继续 | `decision: block` + `reason` 同 |
| SubagentStart | 子 Session 第一个 Run 开始前 | 子代理类型 | `agent_type`、`agent_id` | 无阻断 | `additionalContext` 并入子代理首条消息 |
| SubagentStop | 子 Session 的 Run 正常结束之前 | 子代理类型 | `stop_hook_active`、`agent_type`、`agent_id` | 同 Stop（作用于子代理） | 同 |
| PreCompact | 手动与自动压缩之前（溢出恢复不触发） | `manual` / `auto` | `trigger`、`custom_instructions` | 手动：400 `hook-blocked`；自动：跳过本次压缩，请求照常 | stdout 文本追加为摘要要求（≤ 4 000 字符） |
| Notification | Coko 发出桌面通知时（不论是否显示） | 通知类别 | `notification_type`、`title`、`message` | 无阻断 | 忽略 |

Stop / SubagentStop 的继续每个 Run 至多 3 次，之后忽略并记 warn；继续同样受 Goal 预算与 `max-turns` 检查。通用输出：`continue: false`（任一）→ 本批完成后停止，`run_end { status: paused, error: { code: hook_stopped, message: stopReason } }`；`systemMessage` 只显示给用户（`hook_run.message`）。

**PreToolUse 与判定的组合**（ADR 0013）：Hook 聚合决定 H（deny > ask > allow，项目 Hook 的 allow 不参与）与 `decide` 的结果 P（票 02 让 `decide` 返回来源步骤）：

| 条件（按顺序） | 结果 |
| --- | --- |
| H = deny | 拒绝：`Blocked by hook: <reason>`，Run 继续 |
| P = deny | 拒绝（按规则） |
| P 来自第 2–4 步，或调用为提权或 plan-exit | 询问（H 的 allow 无效） |
| H = ask | 询问，没有建议规则 |
| H = allow | 允许（与允许规则同位） |
| 其余 | 按 P |

最终为第 7 步的询问时运行 PermissionRequest：deny → 拒绝；allow → 允许并提交 `approval_request` 与 `approval_decision { by: hook }`；其余出卡片。`if` 用权限规则语法与匹配器（Bash 复合命令任一子命令命中即匹配）。

**执行**（`adapters/hook-runner.ts`）：`/bin/bash -c <command>`，cwd 为 Session 工作目录，独立进程组，登记 `kind: hook`；环境为 Sidecar 基础环境加 `COKO_PROJECT_DIR`、`COKO_SESSION_ID`、`COKO_HOOK_EVENT`，不注入 Secret；stdin 写一行 JSON 后关闭；stdout / stderr 各 ≤ 64 KB；超时（缺省 60 秒，Notification 10 秒，上限 600 秒）对进程组 SIGTERM，2 秒后 SIGKILL。不经 Seatbelt。同一事件的匹配 Hook 并行。超时、非 0 非 2、exit 0 而 stdout 不是合法 JSON（PreCompact 除外）→ 没有决定。输入中的 `tool_input`、`tool_response`、`prompt` 是已提交（已脱敏）的值。

**记录。** 只有有结果的执行（阻断、询问、放行、追加上下文、继续、停止、超时、出错、非法输出）提交 `hook_run`；没有决定的成功执行只记 debug 日志。追加给模型的文本（additionalContext、stderr）合计 ≤ 10 000 字符并按值脱敏。

**HTTP。** `GET /api/hooks?sessionId=` → `{ enabled, global: { hooks, revision, diagnostics }, project?: { path, entries: [{ hookId, event, matcher?, if?, command, timeout?, digest, approved }], diagnostics } }`；`PUT /api/hooks { hooks, expectedRevision }`（不合 schema 400，revision 409）；`POST /api/hooks/approvals { workspaceId, digest }`（204；digest 不在当前项目文件中 409 `digest-mismatch`）。

### 子代理（agent `agents/`，server `application/subagents.ts`、`context/subagents.ts`、`routes/agents.ts`）

**定义。** 内置 `general`、`explore`；用户 `~/.coko/agents/*.md`、项目 `<cwd>/.coko/agents/*.md`，同名 project > user > builtin。frontmatter 与诊断见 [grilling C2](grilling.md#第-2-轮)。项目定义经符号链接指出 Workspace 时不加载（`agent-outside-workspace`）。每个 Run 开始时按 mtime 读取。`agents.enabled` 能力开关（缺省 true，项目可关）。

**工具**（权限类见下）：

- `agent { description, prompt, subagent_type?, model?, run_in_background?, isolation?: 'worktree' }`：创建子 Session（同 Workspace；isolation 时经 WorktreeService 创建 worktree 并绑定），提交父级 `agent_start` 与子级 `subagent_origin`，运行 SubagentStart Hook，以 `trigger: subagent` 开始子 Run。前台：等待子 Run 结束，结果 `<agent-result agent-id status turns tool-calls tokens cost duration-ms>文本</agent-result>`（最后一条非空 assistant 文本，≤ 50 000 字符，超出截断并注明子 Session id），提交 `agent_end`；父 Run 被停止时 abort 子 Run（`cancelled`）。后台：立即返回 `Started subagent <id> (<type>): <description>. Wait with agent_wait.`，结束时提交 `agent_end` 与通知 `<agent-notification>`（id、类型、状态、摘要，结果 ≤ 2 KB 时内联），与 Job 通知相同的送达、挂起与不唤醒规则；模型已用 `agent_wait` 读到终态的不通知。同一批的多个 `agent` 调用并行。
- `agent_wait { agent_ids?, timeout_ms? }`：缺省 30 000、上限 600 000 ms，结束、超时或追加指令到达时返回各自状态与结果；不给 id 时列出本 Session 的子代理。
- `agent_cancel { agent_id }`：abort 子 Run，等待 `agent_end`。
- `agent_wait`、`agent_cancel` 只在本 Session 有子代理时注册。

**子 Session。** `parent_session_id` 为父 Session；不在 `GET /api/sessions` 列表中；`POST …/messages` 409 `child-session`；审批照常可答。工具 = 父级本 Run 可用工具 ∩ 定义 `tools` − `disallowed-tools` − 固定排除集（`agent`、`agent_wait`、`agent_cancel`、`get_goal`、`create_goal`、`update_goal`、`exit_plan_mode`、`schedule_*`、`job_output`、`job_list`、`job_kill`、`job_input`、`memory_write`、`memory_delete`）；bash 的 `run_in_background` / `tty` 在子 Session 中为参数错误。system sections 照常（指令、Skills、Memory），另注入 `<subagent>`（类型、角色正文、交回结论的要求）；没有 `<goal>`。模型：参数 > 定义 > 父 Session 当前模型，不在 Model Catalog 中为错误结果。`max-turns`（缺省 50）在子 Run 的 `beforeRequest` 计数，耗尽 `run_end { error: { code: max_turns } }`、`agent_end { status: max-turns }`。

**有效权限。** 子 Session 每次判定时：模式 = min(根 Session 当前模式（plan 按 read-only）, 定义 `permission-mode`)，序为 read-only < default < accept-edits < full-access；规则 = 根 Session 的 Session 规则 + 全局 + Workspace + project；"本会话总是允许"写入根 Session；可写根按子 Session 的 cwd。

**预算与取消。** 派发它的父 Run 属于 Goal G 时，子 Session 的全部 Run 计入 G（`goalUsage(..., { children })`，不计轮次）；子 Run 的 `beforeRequest` 与工具调用前检查 G 的五维（含其他子 Session 的已用）。设了 `maxCost` 而子代理模型未定价时 `agent` 为错误结果。每个根 Session 同时至多 4 个 running 子代理（第 5 个为错误结果）。停止父 Run 只 abort 前台子代理；取消 G：停止 G 的 Run 派发的全部子代理，`cleanup.agentsStopped`。

**isolation worktree。** plan / read-only 下为错误结果；子 Session 结束时 HEAD 仍为 base 且干净 → 移除 worktree 并删除分支；否则保留，`agent_end.worktree { kept: true, path, branch }`，结果末尾注明。

**重启。** 子 Session 的 Run 按现有中断恢复；父 Session 的恢复钩子为没有 `agent_end` 的子代理提交 `agent_end { status: interrupted }`；父级被中断的 `agent` 调用不进入结果确认，结果为 `Subagent interrupted by a restart; partial results are in child session <id>.`。

**HTTP。** `GET /api/sessions/:id/agents` → `[{ agentId, agentType, description, status, background, startedAt, endedAt?, usage?, worktree? }]`；`POST /api/sessions/:id/agents/:agentId/cancel`（204；已结束 409 `agent-not-running`）；`GET /api/agents/definitions?workspaceId=` → `{ definitions: [{ name, source, description, tools?, model?, permissionMode?, maxTurns, path? }], diagnostics }`。Session DTO 增加 `parentSessionId?`；父 Session 的 `activity` 在任一 running 子代理等待审批时为 `awaiting-approval`。

### 定时任务与通知（agent `tasks/schedules/`，server `application/schedules.ts`、`context/schedules.ts`、`adapters/clock.ts`、`application/notifications.ts`、`routes/schedules.ts`，desktop `main/notifications.ts`）

**规则。** 协议 `ScheduleRule`：`{ kind: 'after', seconds }`、`{ kind: 'at', at }`（RFC 3339 带偏移，须在将来）、`{ kind: 'every', seconds }`（≥ 60，按创建时刻对齐）、`{ kind: 'cron', expression, timeZone }`（五段 Vixie：分 0–59、时 0–23、日 1–31、月 1–12、周 0–7（0 与 7 为周日），每段 `*`、值、`a-b`、`*/n`、`a-b/n` 与逗号列表；日与周都不是 `*` 时任一匹配即可；不存在的本地时刻跳过、重复的取较早一次；时区须为 IANA 名或 UTC）。`next_at` 存 UTC 毫秒。每 Session 至多 20 个 active。

**定时器。** 一个 `setTimeout` 指向最早的 `next_at`，另每 30 秒复查；任何变更后重算。时钟经 `ClockPort { now(), setTimer }`，测试构建 `COKO_TEST_CLOCK=1` 时为可控时钟。

**投递。** 到期：准入（下条）→ `recordFire(started)` → 以 `trigger: schedule`、`schedule { scheduleId, occurrence }` 开始 Run，输入 `<scheduled_task schedule-id="…" title="…" occurrence="ISO">prompt</scheduled_task>`（不经命令展开；pendingInput 照常合并在前）。Session 有 Run 进行中：挂起，该 Run 的 `run_end` 后投递；同一任务至多挂起一次。错过多次（启动扫描、睡眠）只投递最近一次，`missed: n`。一次性任务投递后 inactive。没能开始 Run 时追加 `schedule_fire { status: skipped, reason: start-failed }`。

**准入。** 依次：`schedules.enabled`（有效值）→ Session 存在且不是子 Session → 工作目录存在（worktree removed 时 `worktree-removed`）→ 模型已配置 → Session 有非终态、非 paused 的 Goal 且任一维度已耗尽时 `budget`。跳过时 `schedule_fire { status: skipped, reason }`，重复任务照常计算下一次。

**授权。** `runAuthority` 对 `trigger: schedule`（以及 `subagent`、`handoff`）为 none：不能 create / edit / pause / resume Goal；`schedule_create` / `schedule_update` 在 `trigger: schedule` 的 Run 与子 Session 中为错误结果 `schedule-not-allowed`。prompt 原文送达，`/goal resume` 等不展开为动作。

**工具。** `schedule_create { title（≤ 120）, prompt（≤ 8 000）, after_seconds | at | every_seconds | cron + time_zone }`（恰好一个）、`schedule_list`、`schedule_update { id, title?, prompt?, <rule>?, status?: active | paused }`、`schedule_delete { id }`；只作用于本 Session 的任务。prompt 与 title 入库前按值替换登记的 Secret。

**HTTP。** `GET /api/schedules?sessionId=`（省略为全部）→ `Schedule[]`（`id`、`sessionId`、`title`、`prompt`、`rule`、`status`、`nextAt?`、`lastOccurrence?`、`lastFire? { status, reason?, runId? }`、`revision`）；`POST /api/sessions/:id/schedules { title, prompt, rule }` → 201；`PATCH /api/schedules/:id { revision, title?, prompt?, rule?, status? }`（409 `revision-conflict`）；`DELETE /api/schedules/:id` → 204。测试构建另有 `POST /api/test/clock { advanceMs } | { setMs }`。

**通知。** `NotificationService.notify({ kind, sessionId, title, body })`：读取设置键 `notifications`（`{ enabled, scheduleRunEnded, approvalWaiting, agentFinished }`，缺省全开），触发 Notification Hook（票 06 订阅），并经控制通道发 `notify` 给 main；main 在窗口不在前台时显示 Electron `Notification`，点击聚焦窗口并经 preload 的 `onOpenSession` 打开会话；测试构建记日志 `notification shown`（不显示）。类别：`schedule-run-ended`（`trigger: schedule` 的 Run 结束）、`approval-waiting`（`trigger: schedule` 的 Run 或后台子代理提交 `approval_request`）、`agent-finished`（后台子代理结束）。

### Handoff（agent `agents/handoff.ts`，server `application/handoff.ts`、`context/handoff.ts`、`routes/handoff.ts`）

- **入口。** 内置命令 `/handoff <下一步目标>`（目标为当前目录）与 `POST /api/sessions/:id/handoff { instructions, target: { kind: 'current' } | { kind: 'new-worktree', name? } | { kind: 'worktree', worktreeId } }` → 202 `{ runId }`。Session 有 Run 进行中 409 `run-in-progress`；子 Session 409 `child-session`；没有用户消息 400 `nothing-to-hand-off`。
- **摘要。** `trigger: handoff` 的 Run 只发一次摘要请求（票 02 的运行时摘要模式：有效上下文 + 指令，不注册工具），经请求前检查（Goal 预算），提示要求 `## Context`（决定与做法）、`## Files`、`## Open items`（含 Goal、Todo、Job、子代理与定时任务的状态）、`## Task`（来自 instructions），≤ 12 000 字符。停止或失败时不创建目标。
- **目标。** Run 正常结束后：按 target 创建（或取）worktree 与目标 Session（同 Workspace、模型、推理档位，复制 `permission_mode` 与 Session 规则），目标首条 `handoff_origin`；源 Session 以同一 runId 提交 `handoff { targetSessionId, … usage }`（`goalUsage` 计入该 usage）。
- **草稿。** renderer 收到 `handoff` 条目后切到目标会话，把 summary 写入目标会话的输入区草稿（不提交）。
- **不继承。** Goal、Todo、Plan、Job、子代理、定时任务、Checkpoint；源 Session 不变，时间线显示"已交接到 <标题>"。

### Worktree（server `application/worktrees.ts`、`adapters/git.ts`、`routes/worktrees.ts`）

- **创建。** `POST /api/workspaces/:id/worktrees { name? }` → 201 `Worktree { id, workspaceId, name, path, branch, baseCommit, status, createdBy, sessionCount }`。步骤：`git rev-parse --show-toplevel` 取仓库根（不是 git 仓库 400 `not-a-git-repo`）；name 校验（400 `invalid-name`）；`.coko-worktrees` 及祖先 lstat 不是符号链接、真实路径在仓库根下（否则 400 `unsafe-worktree-path`）；首次时向 `git rev-parse --git-common-dir` 的 `info/exclude` 追加 `/.coko-worktrees/`；`git worktree add -b coko/<name> <path> HEAD`（分支或路径已存在 409 `worktree-exists`）；记录 `base_commit`。
- **会话绑定。** `POST /api/sessions { workspaceId, worktreeId? }`；Session DTO 增加 `worktree? { id, name, branch, status }`。工作目录 = worktree 路径 + Workspace 相对仓库根的路径（票 02 的 `SessionCwd` seam，票 04 实现）；指令、项目设置、项目 Hook 与 MCP、Skills、子代理定义都从这个目录读取；批准与 Workspace 作用域规则仍按 Workspace。
- **状态。** `GET /api/sessions/:id/git-status` → `{ repo: boolean, branch?, dirtyFiles }`（Handoff 对话框用）。
- **移除。** `DELETE /api/worktrees/:id`：绑定的会话有 Run、running 子代理、running Job 或 active 定时任务时 409 `worktree-busy { reasons }`；`git status --porcelain` 非空 409 `worktree-dirty { files }`；否则 `git worktree remove <path>`，分支保留，`status: removed`。绑定 removed worktree 的会话：提交 409 `worktree-removed`，读取照常。启动恢复把路径已不存在的 active worktree 标为 removed。
- **供子代理。** `createForSubagent(workspaceId, sessionId)`、`removeIfUnchanged(id)`（HEAD = base 且干净时 `git worktree remove` 与 `git branch -d`）。
- **git 执行。** argv、`GIT_TERMINAL_PROMPT=0`、`LC_ALL=C`、超时 60 秒、登记 `kind: git`；输出只记日志摘要。

### 权限类（扩展 [M4 的权限类](../../docs/subsystems/permissions.md#模式)）

| 权限类 | 工具 | 模式放行 |
| --- | --- | --- |
| agent（新） | `agent`（规则组名 `Agent`，内容为子代理类型） | 所有模式；`isolation` 时只有 full-access 放行（plan / read-only 下工具返回错误结果，其余询问） |
| automation（新） | `schedule_create`、`schedule_update`（规则组名 `Schedule`） | 只有 full-access |
| context-read（已有） | 另加 `agent_wait`、`schedule_list` | 所有模式 |
| session-state（已有） | 另加 `agent_cancel`、`schedule_delete` | 所有模式 |

拒绝与询问规则对所有类照常生效；Hook 的位置见上文"组合"表。

### 界面

- **Hooks（03、06）。** 工具卡在被 Hook 拦截时标注"被 Hook 阻止"与命令（03）；`hook_run` 为时间线紧凑行（03 建，06 补其余事件）；设置 → Hooks 分区（06）：能力开关、全局 JSON 编辑（mono Textarea，保存前校验，行内诊断，revision 冲突时读回）、当前会话目录的项目 Hook（完整命令、批准按钮、已批准 / 待批准 / 已改动）、按事件分组的已加载清单。
- **子代理（08）。** `agent` 工具卡：类型、描述、状态、一行进度（`agent_update.activity`）、结束后用量、后台 chip；`agent_notification` 紧凑行；标题栏"子代理"按钮（running 数）；右栏 Agents tab：列表（状态点、类型、描述、时长、用量、worktree）与选中项的只读时间线（复用 TimelineView）、停止按钮；审批冒泡：父会话输入区按时间顺序接管最早的待审批请求（父或其 running 子代理），卡片标"来自子代理 <类型> · <描述>"，回答发往子 Session；设置 → Agents 分区：内置、用户、项目定义及诊断，只读，注明在文件中编辑。
- **定时任务与通知（09）。** 标题栏"定时任务"按钮（active 数）；右栏 Schedules tab：列表（标题、规则的本地化描述、下次时间与时区、状态、最近结果）、新建 / 编辑（类型切换：一次（日期时间）/ 间隔（分钟）/ cron（表达式 + 时区下拉，缺省本机时区，实时显示接下来 3 次时间））、暂停 / 恢复 / 删除（确认）、投递历史（`schedule_fire` 条目）；`schedule_fire` 紧凑行；设置 → 定时任务（全部会话，跳转、暂停、删除）；设置 → 通知（总开关与三类开关）。
- **Worktree（04）。** 侧栏 Workspace 组菜单"在新 worktree 中新建会话"（名称可选）；会话行与标题栏显示分支 chip；worktree 已移除的会话显示只读提示；Workspace 菜单"worktree…"列出 worktree 与"移除"（确认框；busy / dirty 时显示原因与文件数）。
- **Handoff（10）。** 标题栏"交接"操作打开对话框：下一步目标、目标（当前目录 / 新 worktree（名称）/ 已有 worktree）、源有未提交改动时的提示；提交后显示进行中，可停止；完成后切到目标会话、草稿为摘要；时间线 `handoff` 行（源）与 `handoff_origin` 行（目标，可跳回源）。
- 新 kind 在对应票交付前不渲染、不报错。

### 预构建（票 01，除四项外行为不变）

- **B1** `client/api.ts` 导出 `requestJson(schema, method, path, body?)`，`jobs-store`、`goal-store` 复用（错误体按 `ErrorResponse` 校验）。
- **B2** server `application/keyed-mutex.ts` 的 `KeyedMutex.run(key, task)`（尾部清理），`goals.ts` 的 `#gate` / `#locked` 与 `session-permissions.ts` 的锁改用它。
- **B3** server `application/errors.ts` 导出 `errorMessage(error)`，替换 `goals.ts`、`jobs.ts`、`processes.ts`、`layers.ts` 的同类局部函数；`JOB_NOTIFICATION_TAG` 从 `@coko/agent/entries` 导出，`goal-driver.ts` 与 renderer `timeline.ts` 引用。
- **B4** `planning/exit-plan-mode.ts` 与 `protocol/planning.ts` 的守卫测试（同一组输入结果相等）；`protocol/permissions.ts` 引用 `PLAN_MAX_CHARS`。
- **B5** `goals/state.ts` 的 `formatCost` 改名 `costText`；`application/permissions.ts` 去掉 `PermissionMode` / `PermissionModeSchema` 别名，直接用 `StandardPermissionMode`。
- **B6** `GOAL_BUDGET_DIMENSIONS` 描述表成为维度映射的唯一来源（limit / used / 模型可见名 / 格式化）；协议 `GoalReason.code` 为已知字面量联合加 `Type.String()` 兜底；renderer goal-card 读描述表的键。
- **B7** `GoalService` 构造时注入 `hub` 与窄接口 `GoalRunHost { activeRunId, stopAfterBatch, startRun, modelPriced, isRunning, abort, pause }`，删除 `attach()`；`JobService` 删除 `hub` 转手 getter，同样注入（`layers.ts` 相应改装配）。
- **B8** `modelPriced` 移到 `session-models.ts`。
- **B9** `ProcessTarget { pid, pgid? }` 与 `signalTarget(target, signal)` 导出，`processes.ts`、`adapters/processes.ts`、`adapters/pty.ts` 复用。
- **B10** 保留 `goalUsage` 的 `children`（M5 票 07 接入）；goal.md 只把它写成接口说明（"子 Session 的汇总由子代理接入"），不写成当前行为；票 07 接入后改写。
- **B11（行为）** GoalCard 只在 `goal`、`run_end`、`compaction`、带 usage 的 assistant 条目到达时重读用量，同一帧内合并为一次。
- **B12（行为）** `session-permissions.ts` 找不到待审阅记录时抛 `AppError('internal')`，不新建 revision。
- **B15（行为）** Goal 卡：已定价模型且没有 `maxCost` 时在预算区显示"未设费用上限"提示；`create_goal` 描述要求长任务设 `max_cost`。
- **text-warning** `mcp-section.tsx`、`rewind-dialog.tsx`、`context-ring.tsx` 中作文字的 `text-warning` 改为 `text-warning-text`（图标保留），browser 测试按计算样式断言两种主题下对比度 ≥ 4.5:1。
- **/compact（行为）** 手动压缩的 Run 在发出摘要请求前经同一 `beforeRequest`；Goal 运行中且预算耗尽时不发请求、Run 以 `paused` + `budget_exhausted` 结束、Goal 进入 budget-exhausted。goal.md 删除"手动 /compact 不经这项检查"。

### 运行时与装配 seam（票 02）

- **运行时（engine，只有 02 改）。** `RunInput.trigger` 增加 `schedule` / `subagent` / `handoff`、`RunInput.schedule?`；摘要模式：`trigger: handoff` 一次请求、无工具、结果文本在 `RunResult.summary`（提示由调用方给出），经 `beforeRequest`；`RuntimeContext.beforeCompact?({ trigger, instructions }) → { block: reason } | { instructions } | void`（自动压缩被 block 时跳过本次；溢出恢复不调用）；`RuntimeContext.onStop?(info) → { continue: TextContent[] } | void`（Run 正常结束前，返回 continue 时以该 user message 再请求一次；每 Run 上限 3 由运行时执行）；`RunError.code` 增加 `hook_stopped`、`max_turns`；`stopAfterBatch` 接受这两个 code。
- **判定（policy，02 → 03）。** `decide` 返回 `{ decision, step: 'deny-rule' | 'ask-rule' | 'protected' | 'outside-writable' | 'mode' | 'allow-rule' | 'default' }`；gate 接受 `PermissionHookPort { preToolUse(call) → HookVerdict, permissionRequest(call) → HookVerdict }`（缺省无），组合表在 gate 中由 03 实现；权限类 `agent`、`automation` 的模式放行。
- **贡献（server context/types，只有 02 改）。** `ContextScope` 增加 `parentSessionId?`、`subagent? { name, tools, permissionMode?, maxTurns }`、`worktreeId?`；`ContextContribution` 增加 `permissionHooks?(scope) → PermissionHookPort`、`observeHooks?(scope)`（排在 secretRedactionHook 之后，收到已脱敏的结果）、`beforeSubmit?(scope, text) → { reject: string } | { context: string } | void`、`beforeCompact?`、`onStop?`、`filterTools?(tools, scope)`；`RunRequest` 增加 `schedule`、`subagent`、`handoff` 三种 trigger。`session-runs.ts` 组合并转交这些 seam；`SessionCwd.resolve(session) → cwd`（02 返回 Workspace 路径，04 实现 worktree）。
- **Session（02）。** `SessionService.create({ workspaceId, worktreeId?, parentSessionId? })`、列表过滤、DTO 字段；`session-permissions.ts` 的 `PermissionScopeResolver { rootSessionId(id), modeCap(id) }`（02 缺省为自身、无上限，07 实现）。
- **服务存根（02 建，各票实现）。** server `application/{hooks,subagents,schedules,worktrees,handoff,notifications}.ts`、`context/{hooks,subagents,schedules,handoff}.ts` 空贡献、`routes/{hooks,agents,schedules,worktrees,handoff}.ts` 空 router、`adapters/{hook-runner,git}.ts` 存根与 `adapters/clock.ts`（02 完整实现，含测试时钟与 `/api/test/clock`），均在 `runtime/layers.ts` 装配；关闭顺序：停止 HTTP → 停止定时器 → 中断 Run（含子 Run）→ 关闭 Job → 关闭上下文贡献 → 终止登记进程 → 关闭存储。`recovery.ts` 增加 subagents、worktrees 的恢复钩子（空实现）。agent `extensions/hooks/`、`agents/{definitions,tools,handoff}.ts`、`tasks/schedules/` 的类型与空 barrel。
- **协议（02）。** 新领域文件 `protocol/src/{hooks,agents,schedules,worktrees,handoff}.ts` 的 DTO、路径与错误码（`hook-blocked`、`child-session`、`agent-not-running`、`schedule-not-allowed`、`not-a-git-repo`、`invalid-name`、`unsafe-worktree-path`、`worktree-exists`、`worktree-busy`、`worktree-dirty`、`worktree-removed`、`nothing-to-hand-off`、`digest-mismatch`）；控制消息 `notify`。
- **配置（02 → 03）。** `config/schema.ts` 增加 `hooks.enabled`、`agents.enabled`、`schedules.enabled`（项目文件中 `agents.enabled`、`schedules.enabled` 只有 false 生效；`hooks.enabled` 以 `project-cannot-grant` 忽略）；`hooks` 键的解析在 03。
- **内置命令（02）。** `handoff` 占位（实现前 400 `bad-request`）。
- **desktop（02）。** preload `onOpenSession(listener)`，renderer app 订阅后打开会话；main `control-channel` 收到 `notify` 时调用 `main/notifications.ts`（02 建存根，05 实现）。renderer 容器：`right-panel/tabs.ts` 增加 agents、schedules 占位；`header-actions.ts` 增加 agents、schedules、handoff 占位；`settings/sections.ts` 增加 agents、schedules、notifications 占位（hooks 已有）；时间线对新 kind 的分发与空组件 `hook-row`、`agent-notification-row`、`schedule-fire-row`、`handoff-row`；`chat-store` 的 `subscribeSession(sessionId)` 供 Agents tab 订阅子 Session。
- **i18n（02）。** 分域 `hooks`、`agents`、`schedules`、`worktrees`、`handoff`、`notifications`。
- **harness（02）。** 测试时钟辅助（`advanceClock(ms)`）；faux 回复的 `match`（最后一条 user message 或 system prompt 含该子串时取用，其余按顺序）；git 夹具（`createGitWorkspace()`：临时仓库、临时 HOME、`GIT_CONFIG_GLOBAL=/dev/null`、固定 author 与提交时间，Sidecar 继承同一环境）；Hook 夹具 `tests/fixtures/hooks/hook.mjs`（参数：`--record <file>` 写入 stdin、`--exit <n>`、`--stdout <json>`、`--stderr <text>`、`--sleep <ms>`、`--ignore-term`）；秘密总闸 harness 的落盘扫描接受额外目录（Hook 记录文件）；`notification shown` 日志的读取辅助。

### 共享装配点与所有者（M5 期间）

"A → B"表示按票的顺序修改，前一票合入后下一票才动；没有列出的票不改。票 01 是预构建，可以改其 Write scope 内的任何文件（含下列"只有 02 改"中的 `runtime/layers.ts` 与 `engine/compaction-driver.ts`）；下列约束从票 02 起生效。

- **只有 02 改：** `packages/protocol/src/{index,entries,ws,runs,http,errors,control}.ts`；`packages/agent/src/{index.ts,package.json}`、`session-entries/`（全部）、`tools/registry.ts`、`instructions/commands/builtin.ts`、`engine/`、`config/schema.ts`、`agents/{index,fork}.ts`；`packages/session/src/`；`packages/i18n/src/dictionaries.ts` 与 `dictionaries/{en,zh}.ts`；server `application/index.ts`、`application/context/{index,types}.ts`、`application/sessions.ts`、`application/recovery.ts`、`runtime/layers.ts`、`http/routes/index.ts`、`http/app.ts`、`adapters/{clock,faux}.ts`；desktop `src/preload/`、`src/main/{index,control-channel}.ts`、renderer `stores/chat-store.ts`、`features/conversation/{timeline,timeline-view}.*`、`features/right-panel/right-panel.tsx`、`app/`；`tests/integration/{sidecar-harness,secrets-gate-harness}.ts`、`tests/fixtures/hooks/`、`apps/desktop/e2e/harness.ts`。
- **按顺序：**
  - `apps/server/src/application/session-runs.ts`：01 → 02 → 07。`session-models.ts`：01。`session-permissions.ts`：01 → 02 → 07。`application/permissions.ts`：01 → 02。
  - `packages/agent/src/policy/{decide,gate}.ts`：02 → 03。`packages/agent/src/goals/`：01 → 02（runAuthority 的新 trigger、`goalUsage` 计入 `handoff.usage`）。
  - `application/goals.ts`：01 → 07。`goal-driver.ts`、`application/jobs.ts`、`processes.ts`、`adapters/{processes,pty}.ts`、`application/errors.ts`、`keyed-mutex.ts`（新）、`client/api.ts`、`stores/{jobs,goal}-store.ts`、`dock/goal-card.tsx`：01。
  - `application/context/compaction.ts`：01 → 06。`packages/agent/src/config/merge.ts`、`application/config.ts`：03。
  - 领域文件：`extensions/hooks/`、`protocol/hooks.ts`、`application/hooks.ts`、`context/hooks.ts`、`routes/hooks.ts`：02 → 03 → 06；`adapters/hook-runner.ts`：02 → 03。`application/worktrees.ts`、`adapters/git.ts`、`routes/worktrees.ts`、`protocol/worktrees.ts`：02 → 04。`tasks/schedules/`、`protocol/schedules.ts`、`application/{schedules,notifications}.ts`、`context/schedules.ts`、`routes/schedules.ts`、`main/notifications.ts`：02 → 05。`agents/{definitions,tools}.ts`、`protocol/agents.ts`、`application/subagents.ts`、`context/subagents.ts`、`routes/agents.ts`：02 → 07（08 只读取）。`agents/handoff.ts`、`protocol/handoff.ts`、`application/handoff.ts`、`context/handoff.ts`、`routes/handoff.ts`：02 → 10。
  - i18n `dictionaries/domains/`：`hooks.ts` 02 → 03 → 06；`worktrees.ts` 02 → 04；`schedules.ts` 02 → 05 → 09；`notifications.ts` 02 → 09；`agents.ts` 02 → 07 → 08；`handoff.ts` 02 → 10。
  - renderer：`right-panel/tabs.ts`、`header-actions.ts`、`settings/sections.ts` 由 02 建立占位，06 / 08 / 09 / 10 各只把自己的一行改为可用（同 M4 注册表）。`features/conversation/tool-cards.tsx`：03 → 08。`conversation-pane.tsx`：02 → 04 → 08。`hook-row.tsx`、`stores/hooks-store.ts`：03 → 06；`features/settings/hooks-section.tsx`：06。`features/sidebar/`、`stores/worktrees-store.ts`、`worktree-chip.tsx`：04。`agent-card.tsx`、`agent-notification-row.tsx`、`right-panel/agents-tab.tsx`、`agents-button.tsx`、`approval-panel.tsx`、`stores/agents-store.ts`、`settings/agents-section.tsx`：08。`right-panel/schedules-tab.tsx`、`schedule-fire-row.tsx`、`schedules-button.tsx`、`stores/schedules-store.ts`、`settings/{schedules,notifications}-section.tsx`：09。`handoff-dialog.tsx`、`handoff-row.tsx`、`stores/handoff-store.ts`、composer 草稿存储模块的跨会话写入导出：10。
  - 测试夹具：`tests/fixtures/agents/`（定义文件）：07。
- **文档：** `packages/agent/README.md`、`apps/server/README.md`：01 → 02 → 08（08 汇总 M5 全部变化，其余票把要点写进 Comments；08 之后合入的票由 Lead 合并）；`packages/session/README.md`：02；`docs/tech-stack/architecture.md`：02（应用层新服务一句）；`docs/tech-stack/agent-runtime.md`：不改；`docs/TECH_STACK.md`：04（系统 git）；`docs/subsystems/permissions.md`：02 → 03 → 07；`configuration.md`：02 → 03；`goal.md`：01 → 07；`recovery.md`：02 → 07；新子系统页 `hooks.md`（03 → 06）、`worktrees.md`（04）、`schedules.md`（05 → 09）、`subagents.md`（07 → 08）、`handoff.md`（10）；`context.md`：05（`<scheduled_task>`）、06（Hook 追加的上下文）、07（`<subagent>`）各追加一段，由 Lead 合并冲突；`docs/README.md` 当前行为每票只增自己的一行；ADR：0013（03 → 06，06 改 implemented）、0014（07 → 08，08 改 implemented）、0015（05 → 09，09 改 implemented）、0016（04 → 07，07 改 implemented）、0003（02 补 v8 表）、0012（02 补 hook / git 类别；03、04 的证据写进 Comments 由 Lead 合并）、0005 与 0008（03 补 Hook 的实施记录）；`docs/adr/README.md` 的 implementation 列随改 implemented 的票同步。

## Testing Decisions

- 好的测试只断言外部事实：协议响应与事件、faux requestLog 中实际发给模型的 system sections 与消息、重新读回的条目与表行、Hook 夹具记录的 stdin、文件与进程是否存在、git 仓库的实际状态（`git worktree list`、分支）、窗口中实际渲染与交互、`notification shown` 日志。
- 测试接口（由高到低）：
  1. **Sidecar 协议**（主接口）：`ELECTRON_RUN_AS_NODE=1` 启动真实 Sidecar，临时 `COKO_HOME`、Workspace（需要时为 git 夹具）、faux 脚本（带 `match`）、测试时钟。覆盖：每个 Hook 事件的阻断与输出、组合表每一行、并行聚合、超时与非法输出、项目 Hook 批准与改动、Hook 进程登记与超时终止；子代理的前台 / 后台 / 并行、工具交集与固定排除、有效模式（含根切换）、审批在父会话回答、预算汇入与耗尽、`max-turns`、取消传播、SIGKILL 后中断、isolation worktree 的保留与自动移除；定时任务的四种规则到期、挂起、补跑最近一次、记录后崩溃不重投、准入跳过原因、授权限制、通知；Handoff 的摘要、目标创建、继承、预算、停止；worktree 的创建、cwd、exclude、grep 不列出、符号链接拒绝、busy / dirty / removed。
  2. **packages/agent**：Hook 配置解析与诊断、matcher 与 if、组合表与聚合；子代理定义解析、工具交集、有效模式；cron 解析、下次时间（含 Asia/Shanghai、America/New_York 的 DST 跳过与重复）、补跑计算；`runAuthority` 新 trigger；`goalUsage` 的 handoff usage 与子 Session；表驱动。
  3. **packages/session**：迁移 v8（v7 库升级、备份、STRICT、host_processes 行保留）、`worktrees` / `schedules` 仓库与 `recordFire` 的事务（SQLite 与内存）。
  4. **Electron E2E**：Hooks 设置分区（编辑、诊断、批准）、Agents tab 与审批冒泡、Schedules tab（新建 cron、下次时间、暂停）、worktree 菜单与分支 chip、Handoff 对话框到草稿；明暗主题与键盘操作。
- **对手用例**（M4 复盘，每张预算 / 权限 / 沙箱票必有）：见 [grilling H1](grilling.md#第-5-轮交付) 与各票验收。
- **秘密总闸**：新增 `secrets-gate-{hooks,subagents,schedules,handoff,notifications}.test.ts`，均扫描 faux requestLog；hooks 另扫描 Hook 夹具记录的 stdin 文件；notifications 扫描 `notify` 控制消息与日志。
- **符号链接越界**：`.coko/agents` 中指向 Workspace 外的定义不加载（07）；`.coko-worktrees` 为符号链接时拒绝创建、worktree 会话读取主 checkout 须审批（04）；其余票在 Comments 写明不新增读取根的理由。
- 进程测试用真实子进程；Hook 超时用忽略 SIGTERM 的夹具断言 2 秒后 SIGKILL 与登记行删除。等待用可观察条件，不用固定 sleep；定时任务用测试时钟，不等真实时间。
- 真实模型：具备凭据时跑一条派发 explore 子代理并汇总的真实对话，否则报告未验证。

## Out of Scope

- 带 owner / 认领 / 锁的 Task、共享任务板、TaskCreated / TaskCompleted / TeammateIdle Hook（M6 Agent Teams）。
- Hook：prompt / http / agent 型、`updatedInput` / `updatedPermissions`、async Hook、SessionStart / SessionEnd 等未列出的事件、Plugins 声明的 Hook（M6）。
- 子代理：继续对话（send_message）、嵌套派发、独立进程或 ACP 等外部后端、项目定义中的 MCP Server 与 Hook、删除或归档父 Session 时处理子 Session、继承父级历史的分叉式子代理。
- 定时任务：应用关闭期间投递（launchd 等）、抖动与自动过期、daily / weekly 选择器、"等审批"之外的无人值守审批策略、按定时任务单独设预算、定时恢复 Goal。
- Worktree：会话中途切换目录、模型可调用的 worktree 工具、强制移除、非 git 版本控制、自动清理用户创建的 worktree、复制未提交改动、sparse checkout。
- Handoff：自动发送草稿、交接 Job 或子代理。
- 发布构建的产物 E2E、签名与公证（M6）。

## Further Notes

- **最大风险：票 07（子代理核心）。** 它同时触及权限（有效模式）、预算（汇入根 Goal）、审批（冒泡的服务端部分）、恢复（中断）、取消与 worktree；票 02 先把这些 seam 与单元测试预建好，07 只填实现。07 的 Comments 须逐条记录与 ADR 0014 的对应关系。
- **组合后的工具定义体积。** M4 票 09 合入后自动压缩阈值用例因工具定义变多而确定性失败。M5 新增 `agent` 与 `schedule_*` 常驻工具；`agent_wait` / `agent_cancel` 按需注册，工具 description 保持短。Lead 在 05、07 合入后复核 `sidecar-compaction`，需要时只调整该用例的窗口（不改阈值算法）。
- **时间正确性。** cron 与时区的下次时间在 agent 层表驱动覆盖 DST；集成测试只用测试时钟。睡眠唤醒以 30 秒复查覆盖，未在真实睡眠中验证（记为未验证）。
- **Hook 执行任意命令。** 项目 Hook 的批准 UI 必须显示完整命令；Hook 不经 Seatbelt，与已批准的 MCP stdio Server 处于同一信任级别。
- 并行窗口只派发写范围不重叠的票：{03, 04, 05}、{06, 07, 09, 10}、{08, 09, 10}；01、02 串行。每票合入前做该票 diff 的轻量 Spec 评审，里程碑末做两轴全量评审。
