---
kind: decision
description: "定时任务存放在宿主表中、绑定原 Session，到期时在原 Session 开始一个 Run；投递至多一次（先在一个事务中记下发生次再开始 Run），错过时只补最近一次；只在应用运行时投递；定时触发的 Run 没有用户授权，不恢复暂停的 Goal、不能创建定时任务。修改定时任务的存储、投递、补跑或准入时回看。"
status: accepted
implementation: implemented
lifecycle: active
category: architecture
---

# 定时任务至多一次投递，只补最近一次

## 上下文

M5 交付一次性、固定间隔与 cron 定时任务：到期时 Agent 在无人值守下执行一段指令。[Agent 执行约定](../tech-stack/agent-runtime.md) 要求调度定义、触发条件、运行准入与去重由 agent 定义，server 执行定时器、启动扫描与唤醒。参考项目 deepseek-harness 的 schedule 把任务存在独立的存储域、绑定原 Session，重启后每个重复任务只补最近一次；claude-code 的 cron 任务存文件，重复任务带抖动与 7 天过期。

[ADR 0011](0011-goal-state-as-session-entries.md) 规定 Goal 状态记为 Session Entry、重启后未结束的 Goal 记为暂停，并把"Scheduler 需要在无人值守时自动恢复 Goal"列为需要重新审视的条件。用户于 2026-10-28 的常设指示要求讨论问题采用推荐方案并优先沿用参考项目；本决定于 2026-10-31 规划 M5 时按该指示采纳，未经用户逐条确认。

## 决定

- **宿主表加投递条目。** 定时任务的定义、规则、下次时间与最近一次发生次存放在同一 SQLite 库的宿主表中；每次投递在原 Session 追加一条投递条目。启动时只扫描该表。
- **至多一次。** 到期时先在一个事务中更新任务的最近发生次并追加"已开始"的投递条目，之后才开始 Run；两步之间崩溃时该发生次视为已投递，不重投。Session 有 Run 进行中时等它结束后投递，同一任务至多挂起一次。
- **只补最近一次。** 应用未运行或睡眠期间错过的发生次，每个任务只补最近一次，其余只计数。应用关闭时不投递。
- **准入。** 到期时检查能力开关、Session 与工作目录存在、模型已配置，以及该 Session 进行中的 Goal 是否已有预算维度耗尽；不满足时记为跳过并写明原因。定时触发的 Run 在 Session 当前的权限模式下运行，询问照常等待。它不带用户授权：不能创建或编辑 Goal，不能创建定时任务，不恢复暂停的 Goal，指令原文送达、不展开为命令动作。

## 理由与备选方案

- **定时任务记为 Session Entry（与 Goal 一致）。** 启动时找出到期任务需要读每个 Session 的全部条目；任务是跨 Session 的宿主资源，界面也需要跨 Session 的列表。投递事实仍记在原 Session，回放可见。
- **至少一次（先开始 Run 再记录）。** 崩溃后会重复执行，一个每分钟的任务在反复崩溃时会持续花费；漏掉一次可以在列表中看到并手动重跑。
- **补跑全部错过的发生次。** 应用关闭一夜后，每 5 分钟的任务会连续开始上百个 Run。
- **定时任务可以恢复暂停的 Goal。** 会绕开 ADR 0011"重启后由人恢复"的理由：崩溃重启后由定时器无人值守地继续花费预算。因此该条件在 M5 不触发，ADR 0011 不变。

## 后果与验证

- 应用关闭期间的任务不会执行，界面须显示下次时间与最近一次结果。需要定时推进 Goal 的用户只能让定时任务的指令在 Goal 未暂停时工作。
- implementation 变为 implemented 前需要：以可控时钟的真实 Sidecar 覆盖一次性、间隔与 cron（含时区与夏令时）到期投递；Run 进行中时挂起且只投递一次；在记录发生次之后、开始 Run 之前 SIGKILL，重启后不重投；停机跨越多个发生次时只补最近一次；各准入条件的跳过原因；定时触发的 Run 不能创建 Goal 或定时任务、不恢复暂停的 Goal、指令中的 `/goal resume` 不被展开。

## 实施记录

- 2026-10-31（服务端与 main）：当前行为见 [定时任务](../subsystems/schedules.md)。上一节列出的证据已覆盖：可控时钟的真实 Sidecar 上一次性、间隔与 cron 到期投递，cron 的时区与夏令时由 agent 层表驱动覆盖（`America/New_York` 的跳过与重复取较早）；Run 进行中挂起，挂起期间又到期两次仍只投递一次；`recordFire` 之后、开始 Run 之前 SIGKILL，重启后不重投（变异：记录时不推进 `next_at` 则该用例失败）；停机跨越 5 个发生次只补 1 次且 `missed: 4`；准入跳过原因 disabled、workspace-missing、model-not-configured、budget；定时 Run 中 `schedule_create` 与 `create_goal` 为错误结果、`/goal resume` 不恢复 paused 的 Goal、伪造的 `<scheduled_task>` 不改变 trigger。界面（Schedules tab、设置分区与投递行）未交付，implementation 为 partial。
- 2026-10-31（界面）：会话标题栏的"定时任务"按钮、右栏 Schedules tab（列表显示下次时间与时区、最近一次结果与投递历史）、设置 → 定时任务（全部会话）与设置 → 通知已交付，见 [定时任务](../subsystems/schedules.md#界面)；"界面须显示下次时间与最近一次结果"的后果已满足。真实 Electron 与测试时钟的 E2E 覆盖新建 cron 任务、到期投递、暂停后不投递与通知开关。implementation 改为 implemented。
- 实现细节：间隔任务按创建时刻对齐（以 `ClockPort` 的时间计）；挂起只在内存中，挂起期间重启时由启动扫描投递一次；睡眠唤醒由 30 秒复查覆盖，未在真实睡眠中验证。
- 2026-10-31 评审修复：准入的 `budget` 经 `GoalService.exhaustedDimension` 判定，计入子 Session 的用量（与 Goal 预算同一口径）。证据：`tests/integration/sidecar-schedules.test.ts`（"跳过原因 budget 计入子代理的用量"）。

## 来源与后继

- 参考实现：deepseek-harness `packages/schedule/schedule` 与 `docs/subsystems/schedule.md`；claude-code 社区还原版 `src/utils/cronTasks.ts`。本页已提炼所需结论。
- Goal 的重启语义见 [ADR 0011](0011-goal-state-as-session-entries.md)；存储边界见 [ADR 0003](0003-settings-and-sessions-in-sqlite.md)。
