# 11: M5 评审修复（运行时：server 与 agent）

**Blocked by:** 01–10 与 lead 修复（均已合入）

**Status:** ready-for-agent

输入：[Spec 评审](../review-spec.md)（H1–H9、J1–J10）与 [Standards 评审](../review-standards.md)（H1–H8、L1–L9、T1–T2、S1–S11）。两份重叠项按下表合并；Lead 已接受的偏离（各票 Comments）不要回退。每项（纯文档除外）先写能捕获它的失败测试并确认先红，**每完成一项就提交**。涉及权限、预算或授权的项附对手用例。

**Write scope:** `packages/agent/src/`（goals、agents、policy/gate.ts、recovery、engine）、`packages/protocol/src/`（新的 reason 或错误码）、`apps/server/src/`（application、routes、adapters、runtime/layers.ts）、`apps/desktop/src/main/`（sidecar-process.ts）、`tests/integration/`、相关 `docs/subsystems/*.md`、ADR 0011/0014/0015/0016 的实施记录与 README。不改 `apps/desktop/src/renderer/`（票 12）。

必须修复（按优先级）：
1. **通知的授权（Spec H1+H2 = Standards H1）**：agent_notification 与 job_notification 同样是宿主通知——Goal Round 与 continue 中送达时 runAuthority 不因它变为 user；未送达而退回的 `<agent-notification` 不算用户追加指令。把宿主通知标签收为一处常量（Standards S 类"标签常量散落"的根源），renderer 由票 12 用同一常量。
2. **重启后的后台子代理（Spec H5 = Standards L3）**：agent_start 与 toolResult 之间（以及 agent_start 之前）崩溃时，恢复给出的结果不得是"没有副作用、可以重试"；写明子代理可能已改动文件、给出子 Session id，按 ADR 0014 与 agent-runtime.md:17/115 处理；孤儿子 Session 标为 interrupted、isolation worktree 按 removeIfUnchanged 回收。
3. **worktree 会话的作用域（Spec H3、H4 = Standards L7）**：没有 isolation 的子 Session 继承父级的 worktreeId；worktree 会话的项目 deny / ask 规则、恢复探测、checkpoint 回退边界按会话工作目录取（Workspace 为仓库子目录时同样）；MCP 池键包含 cwd。
4. **交接目标创建失败（Spec H6 = Standards L5）**：摘要之后目标创建失败时提交一条失败的 handoff 条目（带 usage，使 Goal 计入摘要用量），并经 progress 让界面离开 creating（界面部分归票 12，本票提供协议与事件）。
5. **plan / read-only 下的 isolation（Spec H7 = Standards L2）**：在 gate 中直接拒绝，不先询问。
6. **派发失败的清理（Standards H3）**：派发失败时回收 isolation worktree 与 #isolated 规则，#live 不残留 running。
7. **定时任务的预算准入（Spec J2 = Standards H2）**：计入子代理用量（与 Goal 预算同一口径）。
8. **agent_wait 的首次可用（Spec H9）**。
9. **子代理通知的测试（Spec H8）**：approval-waiting 与 agent-finished 通知跨控制通道、在 main 侧观察（参照票 09 的 schedules.e2e 做法，日志在应用退出后读取）。
10. **控制通道穷尽（Spec J10 = Standards L9）**：sidecar-process.ts 的 switch 与 isDetachedProgress 加 never 穷尽检查。
11. **新路由直接访问存储（Standards H7）**：agents / worktrees / hooks 路由经 application 服务。
12. **测试（Standards T1、T2）**：hook-runner.test.ts 的真实进程给 describe 显式预算并清理 mkdtemp；handoff.test.ts 的固定 sleep 改为等待可观察状态。

Lead 裁决的 judgement 项：
- **交接后的源 Goal（Spec J1 = Standards L1）**：源 Session 的 running Goal 在交接完成后进入 paused，reason 新增 `handed-off`（协议、i18n 由票 12 补文案键之外的部分在本票）。waiting-input 的 Goal 不被定时任务、交接或子代理的 Run 唤醒，只由用户的输入唤醒。
- **创建会话绑定已移除的 worktree（Spec J5 = Standards L6）**：在唯一的会话创建入口返回 409 `worktree-removed`；三条创建路径（Standards H6）收到同一入口。
- **max-turns 在自动压缩后重新计数（J6）**：改为按 Run 累计，不因压缩重置。
- **stop 在 admit 期间到达（J7）**：admit 之后再检查一次 run.aborted。
- 其余 judgement（J3、J4、J8、J9、Standards H4、H5、H8）与 S 类坏味道：评审文件末尾"处理结果"逐项写处理或不处理的理由；收益高且改动小的可以做。

完成时：两份评审文件末尾追加"处理结果"（编号 → 处理 → 测试），同步 ADR 与 subsystems 文档。完成前 git merge main，运行 typecheck、lint、format:check（逐项退出码 0）与取锁的全量 pnpm run test。

## Comments
- 2026-10-31 lead：票 11 与票 12 的约定（票 12 已按此实现界面，票 11 请按此对齐；不同时在本票 Comments 写明，lead 合入时协调）：(1) 交接失败——源 Session 提交 kind `handoff` 的条目，payload `status: 'failed'`、`error: { code: string, message?: string }`，`usage` 与 `summary` 照常写入，失败条目可省略 `targetSessionId`；不新增 progress 类型，renderer 只按条目判断。(2) 宿主通知标签——从 `@coko/agent/entries` 导出 `AGENT_NOTIFICATION_TAG`（'<agent-notification'）与 `SCHEDULED_TASK_TAG`（'scheduled_task'），收为一处常量，agent 与 server 同样使用。(3) Goal 暂停原因 `handed-off` 与错误码 `worktree-removed`：协议与 server 在票 11，zh / en 文案在票 12。
- 2026-10-31 lead：已把 244ba1f 的导出转告票 12（含 SCHEDULED_TASK_TAG 现在带 <）。
- 2026-10-31 lead：接受 034f8e5 的 `handoff_failed` 条目（替代约定中的 handoff + status failed），已转告票 12。请确认 forkEntries / handoffTargetEntries 不复制 `handoff_failed`、entries 的 kind 列表与 Assert<Equal> 同步、secrets-gate-handoff 覆盖失败条目的 summary。
- 2026-10-31 lead：**票 12 已合入 main（c837d2a）**，main 上全量通过。合并 main 时请注意：(1) `packages/i18n/src/dictionaries/domains/goal.ts` 中 zh / en 的 `handed-off` 文案已由票 12 加在 main 上（71ecb45），合并时保留一份，不要重复键；文案以 main 为准。(2) 票 12 的实施者已结束，renderer 与 `handoff_failed` 的对齐改由本票完成（越出写范围，已授权，只做对齐所需的最小改动）：`apps/desktop/src/renderer/stores/handoff-store.ts` 改为处理 `handoff_failed` 条目、删除按 `status: 'failed'` 判断的分支；`handoff-store.test.ts:143` 的 `skipIf` 用例改为构造 `handoff_failed` 条目并去掉 skipIf，确认它实际运行并通过；`features/conversation/timeline.ts` 显示 `handoff_failed`（失败的交接一行），并把本地的 `AGENT_NOTIFICATION_TAG`、`SCHEDULED_TASK_TAG` 等常量改为从 `@coko/agent/entries` 导入（agent 通知仍按"紧接 agent_notification 条目"的位置判断，不改用 isHostBlockText——票 12 的取舍，lead 接受）；chat-store 的 kind 列表同步。完成报告中写明这几项。
