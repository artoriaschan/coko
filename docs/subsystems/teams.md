---
kind: reference
description: "当前的 Agent Teams 契约：具名 teammate 的创建与解散、send_message 的送达与排队、子代理继续对话、共享任务板（team_task、revision 的 compare-and-set、认领规则、重叠警告）、TaskCreated / TaskCompleted / TeammateIdle、worktree、Goal 预算归属、重启与 GET /api/sessions/:id/team，以及团队界面（标题栏按钮、Team tab、时间线的消息与任务行、工具卡）。修改团队成员、消息、任务板、团队 Hook、其接口或界面前查阅。"
lifecycle: active
---

# Agent Teams

本文说明 Coko 当前如何让一个会话的 Agent（lead）带领几个具名的 teammate 协作：teammate 是根 Session 下可以继续对话的子 Session，成员之间以消息沟通，在根 Session 的共享任务板上认领任务。团队没有独立实体，团队 id 就是根 Session 的 id。决定与备选方案见 [ADR 0018](../adr/0018-agent-teams-in-root-session.md)；teammate 沿用的子代理规则（有效权限、审批、工具交集、取消）见 [子代理](subagents.md)。界面见 [界面](#界面)。

## 结构入口

- `packages/agent/src/agents/teams/`：名字校验（`names.ts`）、由条目派生的名册（`roster.ts`）、任务板状态机与重叠警告（`board.ts`）、`<team>` section 文本（`section.ts`），以及 `send_message`、`task_create`、`task_update`、`task_list` 四个工具（`tools.ts`，经宿主实现的 `TeamPort` 访问名册与提交）。条目 payload 在 `session-entries/teams.ts`；送达文本 `teamMessageText` 与宿主标签在 `entries/host-input.ts`。
- `apps/server/src/application/teams.ts`：`TeamService`：快照、`team_update`、消息的目标解析、任务变更（同一根 Session 经 `KeyedMutex` 串行）与 TaskCreated / TaskCompleted。
- `apps/server/src/application/subagents.ts`：teammate 的派发（`agent { name }`）、消息送达（追加指令、开始新 Run 或排队）、继续对话、解散；`subagent-notifications.ts`：给 lead 的消息与空闲通知的挂起；`subagent-recovery.ts`：`agent_start` v2 的记录、解散时的 worktree 回收。
- `apps/server/src/application/hooks.ts`：`taskEvent`、`teammateIdle`。`application/context/teams.ts`：工具注册与 `<team>`。`http/routes/teams.ts`：HTTP 接口。
- `apps/desktop/src/renderer/stores/team-store.ts`：按根 Session 的 `TeamSnapshot`（读取加 `team_update`）。`features/conversation/team-button.tsx`：store 的接线、成员状态点与标题栏按钮；`team-message-row.tsx`、`team-task-row.tsx`：时间线的紧凑行；`tool-cards.tsx` 的 `send_message` / `task_*` 分支。`features/right-panel/team-tab.tsx`：Team tab。

## teammate

- **创建。** `agent { description, prompt, subagent_type?, name, isolation? }`：带 `name` 时创建 teammate，总在后台运行（与 `run_in_background: false` 同用为错误结果）。需要 `agents.enabled` 与 `teams.enabled`（缺省 true，项目文件只能关闭）。名字为 `[a-z][a-z0-9-]{0,31}`、不能是 `lead`，在根 Session 未解散的成员中唯一，否则为错误结果 `invalid-name` / `teammate-exists`；未解散的 teammate 至多 8 个（`team-full`）。根 Session 的 `agent_start` v2 带 `name`、`teammate: true` 与 `triggerRunId`（派发它的根 Run）。结果为 `Started teammate <name> (<agentId>, <type>): <description>. Message it with send_message; you are notified when it goes idle.`。
- **工具与上下文。** 子代理的工具交集之外另有 `send_message` 与 `task_*`；没有 `agent`（深度 1）。system sections 最后另有 `<team name="…">`：自己的名字、lead 与其他未解散成员的状态、任务板的使用要求与当前任务（至多 30 行）。
- **空闲通知。** teammate 的每个 Run 结束时，lead 收到与后台子代理相同的 `<agent-notification>`（lead 有 Run 时作为追加指令，没有时挂起到下一个 Run，不唤醒）。
- **解散。** `agent_cancel { agent_id }`（agentId 或成员名）对 teammate 为解散：运行中先 abort 并等该 Run 结束，提交 `agent_end { status: dismissed }`，丢弃排队给它的消息。重启后不在进程内的 teammate 同样可以解散。之后发给它的消息为 `agent-not-reachable`。
- **名册状态。** 由根 Session 的 `agent_start` v2 与每个成员最后一条 `agent_end` 派生，加上进程内的运行状态：running、idle（completed、max-turns、cancelled 或 interrupted 之后）、failed、dismissed。

## 消息

`send_message { to, message, summary? }`（权限类 team，所有模式放行）：正文 1–8 000 字符，summary ≤ 120 字符，两者入库前按值替换登记的 Secret。`to` 为成员名、`lead`、`*`（广播给除自己以外的全部成员，每个目标一条、同一个 messageId）或已结束的一次性子代理的 agentId；发给自己为 `invalid-argument`。结果为 `Sent to <to> (message <id>).`（广播时列出各成员名）。

目标 Session 依次提交 `team_message { messageId, from, to, summary? }` 与一条 user message `<team-message from="<发送者>" message-id="<id>">正文</team-message>`（属性值经 XML 转义，正文原样）：

- **运行中的目标**：作为追加指令在当前步骤后送达（同一个 Run）。
- **空闲的 teammate 或已结束的子代理**：以 `trigger: subagent` 开始新 Run，输入为该消息；`run_start.subagent.triggerRunId` 为发送方的触发 Run（lead 发出时为 lead 当前的 Run）。
- **lead**：与后台子代理的通知相同，Run 进行中为追加指令（Goal Round 中照常送达），空闲时挂起到下一个 Run 的 user message 开头，不唤醒。作为追加指令却没有送达的，Run 结束后挂起。
- **等待结果确认的目标**：子 Session 有未回答的结果确认（重启时工具执行中被中断，见 [启动恢复](recovery.md#结果确认)）时不能开始 Run，`send_message` 为 `agent-not-reachable`，目标的状态不变；用户在该子 Session 回答确认后可以再发。
- **并发上限**：teammate 与子代理共用每个根 Session 至多 4 个 running；已满时消息排队（不是错误），有成员结束或解散后按顺序送达。排队的消息只在进程内，不跨重启保留。

**授权。** `team_message` 在 `HOST_NOTIFICATION_KINDS` 中：这些消息不授予用户权限（Goal Round 或 continue 中送达"create a goal"或 `/goal resume` 时，`create_goal` 与 `update_goal` 的 edit / pause / resume 仍为 not-authorized），Run 结束时退回的 `<team-message>` 文本不算用户的追加指令、不让 Goal 停住。时间线只按 `team_message` 条目确定的位置去掉其后的包装块；用户自己输入的同样文本照常显示。

**继续对话。** lead 可以给已结束的一次性子代理发消息（`to` 为 agentId）：completed、max-turns、failed 的子代理开始新 Run，结束时父级收到 `agent_notification`（后台语义）；cancelled、interrupted 与 dismissed 的为 `agent-not-reachable`；teammate 不能继续一次性子代理。重启之后（子代理不在进程内）同样可以继续：定义与工具表从子 Session 的 `subagent_origin` 恢复。

## 任务板

任务是根 Session 的 `team_task` v1 条目，每次变更提交完整快照 `{ taskId: 't<n>', revision, subject（≤ 200）, description（≤ 4 000）, status, owner?, blockedBy, writeScopes, by }`；当前板为每个任务最后一条快照。标题与描述入库前按值替换登记的 Secret。错误结果的文本以错误码开头：

| 工具 | 规则 | 错误码 |
| --- | --- | --- |
| `task_create { subject, description?, blocked_by?, write_scopes? }` | 新任务为 `t<最大编号+1>`、pending、无 owner；非删除任务至多 100 个 | `team-task-limit` |
| | `blocked_by` 引用须存在且未删除 | `task-not-found` |
| `task_update { id, expected_revision, status?, owner?, subject?, description?, blocked_by?, write_scopes? }` | `expected_revision` 不等于当前 revision | `stale-revision`（文本带当前快照的 JSON） |
| | 认领（`status: in_progress`）要求当前 pending、没有 owner（或已是自己）、前置全部 completed（或已删除） | `task-not-claimable`（原因 `owned`、`blocked`、`not-pending`） |
| | teammate 只能把 owner 设为自己或清空自己的；lead 可以指派任何未解散成员 | `not-owner`；非成员为 `invalid-argument` |
| | 完成只能由 owner 或 lead；owner 清空自己的或设回 pending 为释放 | `not-owner` |
| | `blocked_by` 不能成环 | `cycle` |
| | 已删除的任务（认领为 `not-pending`） | `task-not-found` |
| `task_list {}` | 每项快照加 `ready`（pending 且前置全部完成），以及 `warnings` | — |

同一根 Session 的变更经 `KeyedMutex(rootSessionId)` 串行：读取条目、计划与提交都在锁内，两个成员用同一 revision 认领时只有一个成功。`writeScopes` 为 Workspace 相对路径前缀（拒绝绝对路径与 `..`）；两个 in_progress 任务的前缀重叠时给 `write-scope-overlap` 警告，不阻止写入、不改变权限判定。根 Session 的名册或任务板变化时推送进度 `team_update { team: TeamSnapshot }`。

## 工具注册与权限

`send_message` 与 `task_*` 的权限类为 team（规则组名 `Team`，所有模式放行）。根 Session 在有过子代理或 teammate 之后注册它们（与 `agent_wait` 相同，第一次派发后同一个 Run 的下一次请求即可用）；teammate 的子 Session 中总是注册；一次性子代理的子 Session 中没有。`agent` 带 `name` 时权限类仍为 agent。

## Hook

团队事件经 [外部 Hook](hooks.md#团队事件) 的通用入口运行，没有 matcher，项目 Hook 照常只在批准后运行：

- **TaskCreated**：在 `task_create` 提交之前；exit 2 或 `decision: block` 时为错误结果（原因为 stderr 或 reason），不提交条目。
- **TaskCompleted**：在任务变为 completed 之前；阻止时任务保持原状态，原因在结果中。
- **TeammateIdle**：teammate 的 Run 正常结束之前、SubagentStop 之后（SubagentStop 要求继续时不运行）；exit 2 时 stderr 作为 user message 送达、Run 继续，与 SubagentStop 共用每 Run 3 次的继续上限，之后的 block 被忽略。

stdin 在公共字段之外：TaskCreated / TaskCompleted 为 `task_id`、`task_subject`、`task_description`、`teammate_name`（发起者，lead 为 `lead`）、`team_name`（根 Session id）；TeammateIdle 为 `teammate_name`、`team_name`。

## worktree

`agent { name, isolation: 'worktree' }` 按 [子代理](subagents.md#isolation-worktree) 的规则创建 worktree（plan / read-only 拒绝，其余非 full-access 询问），并在 teammate 存在期间保留：teammate 的 Run 结束不回收，它还会收到消息。解散时 HEAD 仍为 base 且工作区干净则移除 worktree 与分支，否则保留并写在 `agent_end.worktree`。父 Session 读写保留的 worktree 须审批（不入库的询问规则，重启后重新登记）。不带 isolation 的 teammate 继承父级的工作目录。

## 预算

子 Session 的每个 Run 按 `run_start.subagent.triggerRunId` 归属 Goal：触发它的根 Run 属于 Goal G 时计入 G（不计轮次）。派发记录派发它的根 Run；lead 发出的消息记录 lead 当前的 Run；teammate 之间的消息沿用发送方当前 Run 的触发 Run。没有 Goal 的根 Run 触发的 Run 不计入之后创建的 Goal。没有 triggerRunId 的旧条目按派发它的 `agent_start` 所在 Run 整体归属（ADR 0014 的口径）。G 耗尽时 teammate 在下一次请求前停止，lead 在下一个检查点停止，G 进入 budget-exhausted。

## 重启

teammate 的子 Session 按 [启动恢复](recovery.md) 的中断恢复处理：被中断的 teammate 在根 Session 补记 `agent_end { status: interrupted }`，名册中为 idle，worktree 保留到解散。重启后 teammate 仍可接收消息并开始新 Run（工具执行中被中断、等待结果确认的，回答确认之后）（定义与工具表从 `subagent_origin` 恢复）。排队的消息与挂起给 lead 的消息不保留。

## HTTP

- `GET /api/sessions/:id/team` → `TeamSnapshot { members: [{ agentId, name, status, activity?, usage, worktree? }], tasks: [TeamTaskView], warnings }`；子 Session id 时返回其根的快照；Session 不存在为 404。`activity` 只在 running 时出现（最近一次工具调用的名字与脱敏摘要）。
- 用户不能直接给 teammate 发消息：子 Session 的提交仍为 409 `child-session`。

## 界面

- **数据。** renderer 按根 Session 读取 `GET /api/sessions/:id/team`，`team_update` 到达时整体替换快照；读取期间到达的 `team_update` 不被较早的响应覆盖，读取失败保留已有快照。打开会话与 `agent_start`、`agent_end`、`team_task` 条目数变化时（含重连后补发）重新读取。运行中成员的活动优先取 `agent_update.activity`（快照只在名册或任务变化时推送）。
- **标题栏"团队"按钮。** 会话有 teammate 时显示，徽标为 running 成员数（没有时不显示徽标，无障碍名称为"团队（n 个运行中）"）；点击打开或聚焦右栏 Team 页面。只显示状态，在任何主区宽度下都直接留在标题栏。
- **Team tab：名册。** 每个成员一行：状态点（running / idle / dismissed / failed，带状态名）、名字，次行为状态 · 当前活动（运行中，工具名 · 摘要）或用量（轮次、工具调用、Token、时长），保留的 worktree 显示分支。
- **Team tab：任务板。** 按待处理、进行中、已完成分组（已删除的不显示），每项为编号、标题、owner；pending、前置全部完成且没有 owner 的标"可认领"；有未完成前置任务时显示"等待 t…"。`writeScopes` 重叠时板顶有警告（列出任务编号），重叠的任务带"范围重叠"标记。
- **Team tab：成员时间线。** 点名册中的成员（键盘 Enter）在任务板下方打开其只读时间线：订阅该成员的子 Session（不切换当前会话），复用 TimelineView，没有输入区与消息动作，底部注明不能直接给成员发消息、需经 lead 转达。切到另一成员或关闭（标题行的关闭按钮）时释放订阅；缺省不选中成员。
- **时间线的紧凑行。** `team_message`：发送方 → 接收方（无障碍名称"lead 发给 alice"）与 summary；送达它的 `<team-message …>` 块按真实宿主前置条目与 messageId / from 配对，不成为用户气泡；展开行可读完整正文和消息编号。批量送达的每条消息保留自己的正文，原有用户文字仍在原位置显示。`team_task`（根 Session）：按快照判断"创建 / 认领 / 完成 / 删除 / 更新了任务"，带变更者、编号与完整标题，展开可核对真实描述、状态、owner、依赖、写入范围与快照。
- **工具卡。** `send_message`：标题"发送消息"，摘要为接收方 · summary，明细为发出的正文与结果；`task_create`：摘要为标题；`task_update`：摘要为编号 · 新状态（或 owner）；`task_list`：明细为结果。成功与错误都由用户手动展开，原始参数与完整结果保持可检查；展开不重新执行工具。
- **审批。** teammate 是子代理：它的待审批请求按 [子代理的审批冒泡](subagents.md#界面) 接管父会话输入区，卡片标出"来自子代理 <类型> · <描述>"。

## 已知限制

- 同一 checkout 中两个 teammate 仍可能改到同一文件，只有警告；需要隔离的使用 worktree。
- 排队的消息不跨进程保留；重启后 lead 只能从名册看到成员状态并重新发送。
- 时间线的任务行只由变更后的快照判断动作，指派他人与修改标题都显示为"更新了任务"。teammate 同时出现在 Agents tab（作为子代理）与 Team tab 中。

## 验证

- `packages/agent/src/agents/teams/teams.test.ts`：认领的三种原因、CAS 的 stale、teammate 指派他人、完成者、释放、删除、blockedBy 环与引用、100 项上限、重叠警告、名字校验、名册与可达性、`<team>` 文本（表驱动）。`packages/agent/src/goals/budget.test.ts`：按 triggerRunId 归属。
- `apps/server/src/application/teams.test.ts`：两次认领的读取交叠（deferred）时只有一个成功、另一个 stale-revision 带快照（去掉 `KeyedMutex` 时两个都成功）。
- `tests/integration/sidecar-teams.test.ts`：创建（`agent_start.name`、`<team>`、trigger subagent 与 triggerRunId）、空闲通知与 lead 不被唤醒、消息唤醒 teammate、运行中的 steering、teammate 给空闲 lead 的消息挂起到下一个 Run、广播、`teammate-exists` 与 `team-full`、子代理继续对话（含重启后）与 `agent-not-reachable`、并发上限时排队；时间线经 renderer 的 `buildTimeline` 读回条目。
- `tests/integration/sidecar-teams-tasks.test.ts`、`sidecar-teams-hooks.test.ts`、`sidecar-teams-budget.test.ts`（预算，以及 Goal Round 中的消息不授权）、`sidecar-teams-restart.test.ts`（SIGKILL 与 git 夹具的 worktree）、`secrets-gate-teams.test.ts`。
- 界面：`apps/desktop/src/renderer/stores/team-store.test.ts`（快照替换与较早响应的丢弃、订阅计数）、`features/right-panel/team-tab.browser.test.tsx`（名册、任务板分组与可认领、阻塞、重叠警告、`team_update`、按钮的 running 数、选中成员的订阅与释放）、`features/conversation/team-rows.browser.test.tsx`（消息行不显示包装原文、用户输入的同样文本照常显示、任务行、工具卡）；`apps/desktop/e2e/teams.e2e.test.ts`（真实 Electron 与 Sidecar：两个 teammate 认领与完成时 Team tab 与按钮实时变化、teammate 的写入审批在父会话中允许、成员只读时间线、明暗主题与键盘）。
- Goal 的用户输入判断：`apps/server/src/application/goal-driver.test.ts`（只有团队消息时 `hasUserSteering` 为 false）；runAuthority：`packages/agent/src/goals/goals.test.ts` 的 `team_message` 行。

## 延伸阅读

- [子代理](subagents.md)：teammate 沿用的派发、权限、审批与取消规则。
- [外部 Hook](hooks.md)：团队事件之外的 Hook 与继续上限。
- [Goal](goal.md#预算)：预算检查点与授权。
- [Worktree](worktrees.md)：worktree 的创建与移除检查。
