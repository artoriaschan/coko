---
kind: reference
description: "当前的启动恢复与结果确认契约：何时扫描、被中断 Run 的判定分类、write / edit 的结果探测、confirmation_request / confirmation_answer 条目与回答路由、待确认时的 409、activity 与界面。修改恢复判定、执行记录、工具的 probeOutcome 或中断相关界面前查阅。"
lifecycle: active
---

# 启动恢复与结果确认

本文说明 Sidecar 崩溃或被强杀后，重启时如何识别被中断的 Run、如何为没有结果的工具调用补齐记录，以及结果不明的副作用如何交给用户确认。恢复只读取已提交的条目与当前文件状态，不自动续跑，也不重跑任何调用（[Agent 运行时约定](../tech-stack/agent-runtime.md)）。执行记录（`tool_exec`）与幂等键见 [@coko/agent](../../packages/agent/README.md#执行记录与幂等键)。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/session/src/sqlite/recovery.ts` | `store.recovery`：`listUnfinishedRuns()`（有 `run_start` 而没有其后同 runId 的 `run_end`）、`listLatestEntries(kind)`；经迁移 v2 的索引 `session_entries(session_id, kind, seq)` |
| `packages/agent/src/recovery/plan.ts` | `planRecovery(entries, { runId, tool, cwd })` → 要补提交的条目；`confirmationResult`、`RECOVERY_TEXT`（模型可见文本）。`unansweredConfirmations` 在 `@coko/agent/entries`（与 renderer 共用） |
| `packages/agent/src/tools/types.ts` | 工具契约的 `probeOutcome(args, cwd)` → `applied` / `not-applied` / `unknown` |
| `packages/agent/src/tools/builtin/write.ts`、`edit.ts` | 内置的结果探测 |
| `apps/server/src/application/recovery.ts` | `SessionRecovery`：启动扫描、恢复失败的重试、`answerConfirmation()`、"有未回答的结果确认"的单一来源；`SessionService`（`sessions.ts`）转交 `recover()` 与 `answerConfirmation()`，待确认时拒绝开始 Run 并派生 `activity` |
| `apps/server/src/runtime/layers.ts` | 在打开存储之后、开始监听之前调用 `recover(store.recovery)` |
| `packages/ui/src/approval/confirmation-card.tsx`、`apps/desktop/src/renderer/features/conversation/confirmation-panel.tsx` | 结果确认卡 |

## 何时扫描

Sidecar 装配时，在 SQLite 存储打开（含迁移）之后、HTTP 开始监听之前运行一次启动扫描，因此第一个请求看到的已是恢复后的状态。正常关闭（`shutdown` 消息、IPC 断开、SIGTERM、SIGINT）会中断 Run 并等它提交 `run_end { status: 'aborted' }`，这些 Run 不进入恢复。只有进程在 Run 进行中退出（崩溃、SIGKILL、断电）时才留下没有 `run_end` 的 Run。

Session 恢复之前，子代理先为被中断的父 Run 中仍在等待结果的前台 `agent` 调用补 `agent_end { status: interrupted }` 与中断说明的结果（指向子 Session），这些调用因此不进入结果确认，子代理也不重跑。Session 恢复之后按顺序调用领域的恢复钩子：子代理（为其余没有 `agent_end` 的子代理补记 interrupted）、worktree（把路径已不存在的 active worktree 标为 removed）、后台任务（补记 `job_end lost`）、Goal（暂停未结束的 Goal）。见 [子代理](subagents.md#重启)。

扫描对每个这样的 Run 调用 `planRecovery`，把结果在一个事务内提交，并记 warn `interrupted run recovered { sessionId, runId, entries, confirmations }`。单个 Session 失败记 error `run recovery failed`，不阻止启动；该 Session 在恢复成功之前，`POST …/messages`、`…/retry`、`…/continue`、`…/rewind`、`…/fork` 返回 409 `recovery-failed`（未配对的调用会破坏模型请求，补齐的条目也会排在新 Run 之后），activity 显示 interrupted，界面提示"未能恢复这个会话"；每次这些操作先重试恢复，成功后照常处理；查询本身失败时按 `recovery-failed` fatal。扫描结束后，从每个 Session 最后一条 `run_end` 建立 activity，未打开过的 Session 在列表中也显示 interrupted / paused / awaiting-confirmation。

## 判定分类

`planRecovery` 只看该 Run（按 runId）的条目，按 toolCallId 关联 assistant 消息中的调用、`toolResult`、`tool_exec` 与审批条目，不依赖条目相邻或先后（同批调用的 `file_backup` 可能排在前一个调用的 `tool_exec` 之前）。对每个没有 toolResult 的调用，按调用顺序：

| 情况 | 提交 |
| --- | --- |
| 审批请求没有决定（且没有 `tool_exec`） | `approval_decision { outcome: 'expired' }` 与错误结果 `Not run: … approval request expired …` |
| 没有 `tool_exec`，工具 effect 为 read | 错误结果 `Interrupted: … no side effects, so you can retry it.`（read 不提交执行记录，可能已在运行） |
| 没有 `tool_exec`，其余（含已批准未执行、未注册的工具） | 错误结果 `Not run: … It had no effect.` |
| 有 `tool_exec`，`probeOutcome` 为 applied | 成功结果 `Applied: … the current state shows that it took effect. Its output was lost.` |
| 有 `tool_exec`，`probeOutcome` 为 not-applied | 错误结果 `Not applied: …` |
| 有 `tool_exec`，没有探测、探测为 unknown、探测抛错或参数不合 schema | `confirmation_request { toolCallId }`，不补结果 |

最后提交 `run_end { status: 'interrupted' }`。全部条目带被中断 Run 的 runId。模型请求进行中被杀（没有 assistant 消息）时只有 `run_end`。

**结果探测。** 探测在恢复时读取当前文件，不改动任何内容；参数先经工具的 `prepareArguments` 与 schema 校验。

- write：内容与参数逐字节相同为 applied；文件不存在为 not-applied（write 总会创建文件）；内容不同（可能只写了一部分，或原有内容）为 unknown。
- edit：只能按"旧 → 新"套用（与执行时相同的唯一、不重叠匹配）为 not-applied；只能按"新 → 旧"反向套用为 applied；两个方向都成立（例如新文本包含旧文本）、都不成立或文件不可读为 unknown。含删除（新文本为空）的调用不做反向套用。
- bash 与宿主工具没有探测，总是交给用户确认。

**团队。** teammate 与子代理的子 Session 同样按上表处理；被中断的 teammate 在根 Session 补记 `agent_end { status: interrupted }`，名册中为 idle，isolation worktree 保留到解散（一次性子代理的按 `removeIfUnchanged` 回收）。重启后 teammate 与已结束的子代理仍可经 `send_message` 开始新 Run（子 Session 等待结果确认时为 `agent-not-reachable`，回答后可以）；排队的团队消息与挂起给 lead 的通知只在进程内，不保留。见 [Agent Teams](teams.md#重启)。

## 结果确认

`POST /api/sessions/:id/confirmations/:toolCallId`（`runPaths.sessionConfirmation`），body `{ answer: 'applied' | 'not-applied' | 'unknown' }`。成功 204：`confirmation_answer { toolCallId, answer }` 与补齐的 toolResult 在一个事务内提交（runId 为被中断的 Run）。answer 不合 schema 400；该调用没有待回答的确认（不存在或已回答）404 `not-found`；Session 不存在 404。

| answer | toolResult |
| --- | --- |
| applied | 成功：`Applied (confirmed by the user): … its output was lost.` |
| not-applied | 错误：`Not applied (confirmed by the user): …` |
| unknown | 错误：`Outcome unknown: … Before relying on it or running it again, check the current state.` |

存在未回答的确认时，`POST …/messages`、`…/retry`、`…/continue` 返回 409 `confirmation-pending`（待确认状态只有一个来源：`SessionService` 中由条目派生的集合，启动扫描建立，提交 `confirmation_*` 条目时更新）：未配对的调用会使模型请求不合法。全部回答后，上一 Run 仍为 interrupted，`continue` 开始 `run_start { trigger: 'continue' }` 的新 Run，模型上下文含补齐的结果。回答时若该 Session 已有空闲的运行时，它被丢弃并在下次开始 Run 时从条目重建。等待中的审批不复活：继续后模型重新发起的调用按当时的模式与规则重新判定。

## activity 与界面

- **activity**：没有 Run 时，有未回答的确认为 `awaiting-confirmation`，否则按最后一条 `run_end`（`interrupted` / `paused` / `idle`）。renderer 对已打开的会话按条目派生同样的值。
- **确认卡**：没有 Run 且有待确认时，最早的一项接管输入区（输入区保持挂载并隐藏，草稿不丢），显示中断的命令或路径与三个回答（已生效 / 未生效 / 不确定，让 Coko 核实）。三个回答没有默认项，Enter 与 Esc 不代替用户作答；同一调用只回答一次，失败后可重答，404 后不再重发。
- **中断横幅**：上一 Run 为 interrupted 且没有待确认时，输入区上方显示"上次运行已中断"；带"继续"：对话末尾是用户消息或工具结果时调用 `continue`；以 assistant 文本结束时（运行时的 continue 不能从 assistant 消息开始）"继续"提交一条本地化的"继续"用户消息，开始普通的新 Run。时间线在该 Run 末尾显示"已中断"，补齐结果的工具卡按结果显示完成或失败。
- **侧栏**：会话按最后记录时间排序，不显示运行、审批或中断徽标，也不按这些状态上浮；审批、结果确认与中断仍在当前对话内展示。

## 配置与限制

- 迁移 v2 之前（M1 库）的 Run 没有 `run_start`，崩溃留下的旧 Run 不会被识别。
- 恢复补的 write / edit 结果不提交 `file_change`；回退代码时这些路径的当前内容无从比对，不标为在 Agent 之外改动过（[ADR 0006](../adr/0006-file-checkpoints-and-rewind.md)）。
- 有未回答的确认时，回退与分叉同样返回 409 `confirmation-pending`。
- 仅测试（打包的发布构建不读取，见 [apps/server README](../../apps/server/README.md)）：`COKO_TEST_TOOLS=1` 且 `COKO_TEST_HOLD_AFTER_TOOL=<工具名>` 时，该工具执行完、其后的 afterToolCall hook（checkpoint 的 `file_change`）之后挂起，toolResult 不提交，供集成测试在"已执行、未记录结果"处强杀 Sidecar。

## 验证与相关设计

- `packages/session/src/sqlite/recovery.test.ts`：v1 库迁移到当前版本、v2 库迁移到 3（备份、索引、数据可读）；`listUnfinishedRuns` 与 `listLatestEntries`（读取迁移）。
- `packages/session/src/sqlite/migrate-v9.test.ts`：v8 库升级到 9（`.backup-v8-*` 0600、原数据与登记行可读、`plugins` 为 STRICT、可登记 `lsp` 进程、`memories_fts` 随写入同步）；库版本 9 起子进程登记的 kind 增加 `lsp`，启动的孤儿清理同样覆盖它。
- `packages/agent/src/recovery/plan.test.ts`：真实内置工具与临时 Workspace 上的每种分类、write 与 edit 的探测（含新文本包含旧文本）、乱序与其他 Run 的条目、未注册工具与探测失败、确认结果文本。
- `tests/integration/sidecar-recovery.test.ts`：真实 Sidecar 上 bash 执行中 SIGKILL 后的确认、409、回答与继续的上下文；等待审批时 SIGKILL 后 expired；write 执行后、toolResult 前被杀时探测为已生效；正常关闭不产生 interrupted；v1 库启动迁移到当前版本（9）。以已提交条目与文件同步，不用固定 sleep。`secrets-gate.test.ts` 驱动崩溃恢复与确认通道。
- `apps/server/src/application/sessions-recovery.test.ts`：恢复失败的 Session 以 `recovery-failed` 拒绝 Run、继续、回退与分叉，重试成功后补齐 `run_end`。
- `apps/desktop/src/renderer/stores/chat-store-recovery.test.ts`（含以 assistant 文本结束时的"继续"）、`packages/ui/src/approval/confirmation-card.browser.test.tsx`、`apps/desktop/e2e/recovery.e2e.test.ts`（真实 Electron 中 SIGKILL Sidecar，supervisor 重启后确认卡、回答、横幅与继续）。
- `tests/integration/sidecar-teams-restart.test.ts`：teammate 运行中 SIGKILL 后为 idle、可以再接收消息、排队的消息不保留。
- 存储与迁移的决定见 [ADR 0003](../adr/0003-settings-and-sessions-in-sqlite.md)。

## 延伸阅读

- [权限判定与审批](permissions.md)：审批请求的状态，expired 由本流程提交。
- [apps/server README](../../apps/server/README.md)：协议总览与关闭顺序。
- [@coko/session](../../packages/session/README.md)：恢复查询与迁移。
