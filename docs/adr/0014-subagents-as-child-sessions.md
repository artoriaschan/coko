---
kind: decision
description: "子代理是同一 Sidecar 中带父 Session 的子 Session；有效权限模式在每次判定时取根 Session 当前模式与定义模式的较窄者，规则取根 Session 的规则；审批等待用户或 Hook，不自动拒绝；子 Session 的用量计入派发它的 Run 所属的 Goal。修改子代理的执行、权限、审批、预算或恢复时回看。"
status: accepted
implementation: not-started
lifecycle: active
category: architecture
---

# 子代理是同一 Sidecar 中的子 Session

## 上下文

M5 让 Agent 把一段工作派发给子代理：子代理有独立的上下文、角色、工具与模型，结束后把结论交回父级。[Agent 执行约定](../tech-stack/agent-runtime.md) 要求子代理的权限不宽于父级、取消按归属传播、Goal 预算累计子代理的消耗。参考项目的做法不同：pi 的示例为每个子代理启动独立的 pi 进程；deepseek-harness 在进程内创建持久化的子 Session；claude-code 在进程内运行子代理、转录单独存放，后台（异步）子代理遇到审批时直接自动拒绝，另有把审批冒泡到父终端的模式。

需要长期记录的取舍：子代理在哪里运行；"不宽于父级"如何计算；没有人看着时审批怎么办；用量算在哪里。用户于 2026-10-28 的常设指示要求讨论问题采用推荐方案并优先沿用参考项目；本决定于 2026-10-31 规划 M5 时按该指示采纳，未经用户逐条确认。

## 决定

- **子 Session。** 每次派发在同一 Sidecar 中创建一个带父 Session 的子 Session，其条目、Run、审批、执行记录与启动恢复复用现有 Session 机制，经同一权限判定、命令沙箱、进程登记与秘密脱敏。子 Session 不出现在会话列表中，可从父会话打开查看，不能直接提交消息。深度为 1：子代理不能再派发子代理，也不能创建 Goal、定时任务或后台任务。
- **权限取较窄者，每次判定时计算。** 子 Session 的有效模式是根 Session 当前模式与定义中的模式中较窄的一个（plan 按 read-only），规则为根 Session 的 Session 规则加全局、Workspace 与项目规则；子 Session 不保存自己的规则，"本会话总是允许"写入根 Session。根 Session 中途收紧模式时，子代理的下一次调用即按新模式判定。
- **审批等待，不自动拒绝。** 子代理的审批请求同时出现在子 Session 与父会话中，由用户或 PermissionRequest Hook 回答；窗口不在前台时发桌面通知。前台子代理等待期间父级的派发调用一起等待。
- **用量计入根 Goal。** 派发子代理的 Run 属于某个 Goal 时，子 Session 全部 Run 的工具调用、Token、费用与时间计入该 Goal（不计轮次），子 Run 的请求前与工具调用前同样检查该 Goal 的预算。
- **重启。** 子 Session 的 Run 按中断恢复处理，不自动重跑；父级为未结束的子代理记"已中断"，父级的派发调用不进入结果确认，结果指向子 Session 中的部分结果。

## 理由与备选方案

- **独立进程（pi 示例）。** 隔离更彻底，但要为子进程另建凭据传递、权限与沙箱的装配、IPC 与孤儿清理；子代理的用量不在同一库中，Goal 预算无法按同一口径派生。
- **派发时快照父级模式。** 实现简单，但父级在子代理运行中切到 read-only 后，子代理仍按旧模式写入，"不宽于父级"只在开始的一刻成立。
- **无人看着时自动拒绝（claude-code 的异步子代理）。** 避免卡住，但无人值守的子代理与定时任务会因每次询问而做不成事，且模型会尝试绕路；Coko 的每个子 Session 都可以打开回答，等待本身不花 Token，需要免审批的用户可写允许规则或 PermissionRequest Hook。代价是后台子代理可能长时间停在等待中，其等待时间计入 Goal 的时间预算。
- **子代理用量只计入子 Session、不计入 Goal。** Goal 的费用上限会被"把工作交给子代理"绕过。

## 后果与验证

- 子 Session 是普通 Session：库中多出不在列表中的 Session 行，删除或归档父 Session 时须处理子 Session（不在 M5）。并行子代理的数量有上限。
- implementation 变为 implemented 前需要：真实 Sidecar 集成测试覆盖子 Session 的独立上下文与工具交集、根 Session 切到 read-only 后子代理的下一次写入被拒、定义的模式不能放宽、子代理不能派发子代理或创建 Goal 与定时任务、审批在父会话中可回答且没有自动拒绝、子代理用量使根 Goal 预算耗尽后父子都停止、停止与取消的传播、SIGKILL 后重启记为中断且不重跑。

## 来源与后继

- 参考实现：claude-code 社区还原版 `packages/builtin-tools/src/tools/AgentTool`；deepseek-harness `packages/subagent`；pi v1.4.0 `packages/coding-agent/examples/extensions/subagent`。本页已提炼所需结论。
- 判定与沙箱见 [ADR 0005](0005-permission-mode-and-sandbox.md)；Goal 预算口径见 [ADR 0011](0011-goal-state-as-session-entries.md)；子代理定义文件见 [ADR 0009](0009-user-authored-resources-as-files.md)。
