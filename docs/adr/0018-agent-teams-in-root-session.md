---
kind: decision
description: "Agent Teams 在一个根 Session 中进行：teammate 是根 Session 下具名、可继续对话的子 Session；共享任务板是根 Session 的条目，变更以 revision 做 compare-and-set，认领即独占，不做文件锁；成员之间的消息是宿主注入的输入，不带用户权限。修改团队成员、消息送达、任务板或其并发控制时回看。"
status: accepted
implementation: partial
lifecycle: active
category: architecture
---

# Agent Teams 在根 Session 中进行，任务板以 compare-and-set 协调

## 上下文

[Agent 执行约定](../tech-stack/agent-runtime.md) 的 Agent Teams 一行要求共享任务、消息、依赖协调与结果整合，Task / Todo 一行要求负责人。M4 与 M5 把带 owner、认领与锁的 Task 推迟到 Agent Teams：此前只有一个执行者，认领没有并发方。M5 的子代理是同一 Sidecar 中的子 Session（[ADR 0014](0014-subagents-as-child-sessions.md)），一次性派发、结果交回父级。参考项目的做法不同：claude-code 有显式的 TeamCreate、按名字的 SendMessage，以及带 owner 与 blockedBy 的 Task 工具；deepseek-harness 以隐式的根 Session 为 Lead，teammate 名字不可改，消息经目标收件箱的 Steer 送达、空闲时开始新一轮，任务为完整快照加 revision 的 compare-and-set，写入范围只给重叠警告、不加锁。

需要长期记录的取舍：teammate 是什么；任务板存在哪里、怎样防止两个成员同时认领；成员之间的消息有什么权限。用户于 2026-10-28 的常设指示要求讨论问题采用推荐方案并优先沿用参考项目；本决定于 2026-10-31 规划 M6 时按该指示采纳，未经用户逐条确认。

## 决定

- **团队即根 Session。** 没有独立的团队实体；团队 id 是根 Session 的 id，根 Session 的 Agent 是 lead。teammate 是根 Session 下带名字的子 Session，沿用 ADR 0014 的全部规则（有效权限取根当前模式与定义的较窄者、审批在父会话中回答、用量计入触发它的根 Run 所属的 Goal、取消与重启），区别只在于它在 Run 结束后保留、可以再接收消息，并能使用消息与任务工具。teammate 不能再派发子代理。已结束的一次性子代理也可以接收消息继续对话。
- **任务板是根 Session 的条目。** 每次变更提交完整快照（id、revision、标题、描述、状态、owner、blockedBy、写入范围、变更者），当前板由条目派生。每次变更必须带调用者看到的 revision，不一致即拒绝；认领要求任务未被认领且前置任务全部完成，认领后只有 owner（或 lead）能完成或释放它。写入范围只用于提示重叠，不阻止写入、不参与权限判定。需要隔离修改的 teammate 使用自己的 worktree（[ADR 0016](0016-session-cwd-fixed-worktrees.md)）。
- **消息是宿主注入的输入。** 成员之间的消息以宿主标签包装、前置专门的条目送达目标：运行中作为追加指令，空闲的 teammate 开始一个新 Run，lead 空闲且没有活动 Goal 时挂起到下一个 Run、不唤醒。这些消息在 Goal 的授权判定中没有用户权限，也不算作用户的追加指令。
- **Hook。** TaskCreated、TaskCompleted 与 TeammateIdle 沿用 claude-code 的语义：exit 2 阻止创建、阻止完成、让 teammate 继续工作；与其他 Hook 一样只能收紧（[ADR 0013](0013-external-hooks-tighten-only.md)）。

## 理由与备选方案

- **独立的团队实体与 TeamCreate（claude-code）。** 多一种生命周期需要创建、解散与恢复，而一个根 Session 同时只有一个团队；以根 Session 为团队，名册、任务与消息都能从它与子 Session 的条目派生，Fork 与 Handoff 不复制它们。
- **任务存宿主表（与定时任务相同，ADR 0015）。** 定时任务需要启动时跨全部 Session 扫描，任务板只在一个根 Session 内读写；存为条目与 Goal（[ADR 0011](0011-goal-state-as-session-entries.md)）一致，回放与审计不需要另一个来源。
- **文件锁或按写入范围拒绝写入。** 能阻止两个 teammate 改同一个文件，但锁要跨进程崩溃释放、要与命令的写入对应，bash 的写入无法事先归属到路径；参考实现都没有文件锁。隔离写入用 worktree，同一 checkout 中的重叠由警告与 lead 的分配处理。
- **消息带发送者的权限（把 lead 的消息当作用户消息）。** lead 的文本来自模型，模型的输出可能来自它读到的文件；按用户输入授权会让任何能影响模型输出的内容创建或放宽 Goal。

## 后果与验证

- 同一 checkout 中两个 teammate 仍可能改到同一文件，只有警告；teammate 与子代理共用并行上限，超出时消息排队而不是失败。排队的消息不跨进程保留。
- implementation 变为 implemented 前需要：真实 Sidecar 集成测试覆盖具名 teammate 的创建与解散、消息在运行中与空闲时的送达、lead 空闲时不被唤醒、消息不授予 Goal 权限（runAuthority）且不算用户追加指令、两个成员以同一 revision 认领时只有一个成功、前置未完成时不能认领、teammate 不能指派他人、三个 Hook 的 exit 2 语义、teammate 的 worktree 与解散时的回收、teammate 用量计入 Goal、重启后空闲的 teammate 仍可接收消息、已结束的子代理经消息继续；界面中名册、任务板与消息行。

## 实施记录

- 2026-11-01，Agent Teams 核心（服务端）：具名 teammate 的创建与解散、消息在运行中与空闲时的送达与 lead 空闲时不唤醒、消息不授予 Goal 权限且不算用户追加指令、任务板的 compare-and-set 与认领规则、三个 Hook 的 exit 2 语义、teammate 的 worktree 与解散时的回收、按触发 Run 的 Goal 预算、重启后空闲的 teammate 仍可接收消息、已结束的子代理经消息继续已实现，当前行为见 [Agent Teams](../subsystems/teams.md)。证据：`tests/integration/sidecar-teams.test.ts`、`sidecar-teams-tasks.test.ts`、`sidecar-teams-hooks.test.ts`、`sidecar-teams-budget.test.ts`、`sidecar-teams-restart.test.ts`、`secrets-gate-teams.test.ts`、`apps/server/src/application/teams.test.ts`、`packages/agent/src/agents/teams/teams.test.ts`。与决定的细化：预算归属记在子 Session 的 `run_start.subagent.triggerRunId`（run_start v4），teammate 之间的消息沿用发送方当前 Run 的触发 Run；排队的消息只在进程内。界面（名册、任务板与消息行）尚未交付，implementation 为 partial。

## 来源与后继

- 参考实现：claude-code 社区还原版 `packages/builtin-tools/src/tools/{TeamCreateTool,SendMessageTool,TaskCreateTool,TaskUpdateTool}` 与 `src/utils/hooks.ts` 的 TeammateIdle / TaskCreated / TaskCompleted；deepseek-harness `packages/experimental/agent-team` 与 `docs/subsystems/agent-team.md`。本页已提炼所需结论。
- 子代理的基础规则见 [ADR 0014](0014-subagents-as-child-sessions.md)。
