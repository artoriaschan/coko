---
kind: decision
description: "每个 Session 至多一个当前 Goal，其全部变更记为带完整快照与 revision 的 Session Entry，预算用量从条目派生；完成只能按创建时记录的成功条件与证据判定；自动推进（Goal Round）的授权只在当前 Sidecar 进程内有效，重启后未结束的 Goal 记为暂停。修改 Goal 存储、推进、预算口径或重启恢复时回看。"
status: accepted
implementation: implemented
lifecycle: active
category: architecture
---

# Goal 状态记为 Session Entry，自动推进不跨进程保留

## 上下文

M4 引入 Goal：用户给出一个跨多个 Run 的目标，Agent 在无人值守时逐轮推进，直到完成、预算耗尽或需要人介入。[Agent 执行约定](../tech-stack/agent-runtime.md#goal-机制) 要求目标记录、九种状态、单写者推进、多维预算、按预先记录的条件判定完成、持久化恢复与停止传播。

需要长期记录的取舍有三处：Goal 状态存在哪里；进程重启后是否自动继续推进；模型一次正常结束能否算作完成。参考项目 deepseek-harness 的 goal 包把 Goal 记为会话日志中的完整快照事件（compare-and-set），自动推进的"已布防"标志只在进程内存中，会话恢复或分叉后必须由人重新恢复；它只有轮次上限，没有 Token、费用与时间预算，也没有独立的完成判定。claude-code 没有 Goal。

用户于 2026-10-28 的常设指示要求讨论问题采用推荐方案并优先沿用参考项目；本决定于 2026-10-30 规划 M4 时按该指示采纳，未经用户逐条确认。

## 决定

- **一个 Session 至多一个当前 Goal。** 未进入终态（完成、取消）的 Goal 存在时不能创建新 Goal。Goal 不随分叉复制，回退对话不改变 Goal 状态。
- **状态即条目。** Goal 的每次变更（创建、编辑、状态转换、证据、清理结果）提交一条 `goal` Session Entry，payload 是变更后的完整快照并带递增的 revision；更新须给出当前 revision，过期时拒绝。重启、压缩与回放都从最后一条有效的 `goal` 条目重建。不另建 goals 表。
- **预算用量从条目派生。** 轮次、工具调用、Token、费用与时间由 Goal 关联的 Run 的已提交条目（`run_start`、assistant 消息的 usage、toolResult、`compaction` 的 usage、`run_end`）计算，不另存计数器；子代理的用量在 M5 以同一口径汇入。
- **完成按记录的条件判定。** 创建时至少记录一条成功条件。模型标记完成时必须为每条条件给出证据，引用的工具调用必须是本 Session 中存在且未出错的结果；模型一次正常结束只表示该轮结束。用户可以直接把 Goal 标为完成或取消。
- **自动推进的授权只在进程内有效。** Goal Round 由 Sidecar 内的推进器在 Session 空闲时发起，同一 Session 串行，按 (Goal、revision、轮次) 去重。Sidecar 启动恢复时，处于运行或等待中的 Goal 提交一条变为"暂停（原因：重启）"的 `goal` 条目；不会自动继续，由用户恢复。

## 理由与备选方案

- **单独的 goals 表。** 便于跨 Session 查询，但与 Session Entry 形成两份事实，Goal 变更与其触发的条目（例如 `run_start`）不能在同一回放中排序；Session 级的 Goal 状态本就只在 Session 内读取。若以后需要跨 Session 的 Goal 列表，可以从 `goal` 条目建派生索引。
- **持久保存"已布防"并在重启后自动继续。** 无人值守时 Sidecar 崩溃重启（含 supervisor 的自动重启）会立即继续消耗预算，崩溃若由 Goal 本身引起还会形成循环。与中断的 Run 不自动重跑（[启动恢复](../subsystems/recovery.md)）一致，重启后由人决定。
- **只在内存中保存布防标志、持久状态仍为"运行中"**（deepseek-harness 的做法）。界面需要同时表达持久状态与进程内标志，用户看到"运行中"却不在推进；改为在恢复时显式提交"暂停（重启）"，状态与行为一致，代价是重启后多一条条目。
- **模型结束即完成，或由独立评估器判定。** 前者把"本轮说完了"当成"目标达成"；后者需要额外的模型调用与策略，参考项目也未提供。记录条件与证据是可检查的折中：证据仍由模型给出，但必须落在已提交的工具结果上。

## 后果与验证

- 每次 Goal 变更多一条条目；时间线需要把它们显示为紧凑的状态行。预算计算随条目数线性增长，Run 开始与每次模型请求前各计算一次；需要时可在运行时内存中增量缓存，但以条目为准。
- 未定价模型的费用无法计算：设置了费用上限的 Goal 在未定价模型上不运行，以"阻塞（费用无法计算）"停下。
- 需要重新审视的条件：出现跨 Session 的 Goal 需求；Scheduler（M5）需要在无人值守时自动恢复 Goal。M5 规划时决定定时任务不恢复暂停的 Goal（[ADR 0015](0015-schedules-at-most-once-latest-catch-up.md)），该条件未触发，本决定不变。
- implementation 变为 implemented 前需要：真实 Sidecar 集成测试覆盖 Goal 的创建与逐轮推进、revision 冲突、预算各维度耗尽、完成证据校验、SIGKILL 后重启为暂停且不自动推进、取消时停止 Run 与后台任务并记录清理结果。

## 实施记录

- 2026-10-30 Goal 核心（快照与 revision、转换表、授权、完成证据、轮次上限、推进与去重、wait_jobs、取消的停止传播、重启后暂停）已实现，当前行为见 [Goal](../subsystems/goal.md)。证据：`packages/agent/src/goals/goals.test.ts`（转换表、授权、证据、revision）、`tests/integration/sidecar-goal.test.ts`（创建与逐轮推进、revision 冲突、轮次耗尽、证据拒绝与接受、取消清理）、`tests/integration/sidecar-goal-restart.test.ts`（SIGKILL 后暂停且 30 秒内不推进）。其余预算维度当时尚未实现。
- 2026-10-30 五维预算已实现：用量由 `packages/agent/src/goals/budget.ts` 的 `goalUsage` 从 `run_start`、assistant usage、toolResult、`compaction.usage`（compaction v2）与 `run_end` 派生，不另存计数器；检查点为 Goal Round 开始前、每次模型请求前与每次工具调用前；未定价模型遇到费用上限时 blocked（`cost-unpriced`），价格来自 Model Catalog 的 `price`。当前行为见 [Goal 的预算](../subsystems/goal.md#预算)。证据：`packages/agent/src/goals/budget.test.ts`（口径与子 Session 汇总）、`tests/integration/sidecar-goal-budget.test.ts`（每一维耗尽与恢复、超出的工具调用不执行、未定价时不发请求）、`tests/integration/sidecar-model-price.test.ts`（价格与 usage.cost）。连同上一条的 Goal 核心证据，"后果与验证"列出的条件均已满足，implementation 改为 implemented。

## 来源与后继

- 参考实现：deepseek-harness `packages/goal`（goal 服务、round driver、goal 工具与命令）。本页已提炼所需结论。
- 能力归属见 [Agent 执行约定](../tech-stack/agent-runtime.md#goal-机制)；存储边界见 [ADR 0003](0003-settings-and-sessions-in-sqlite.md)。
