# 05: 定时任务核心：规则与 cron、定时器与补跑、投递与去重、运行准入、工具与 HTTP、桌面通知

**What to build:** 见 [规格](../spec.md)"定时任务与通知"与 [ADR 0015](../../../docs/adr/0015-schedules-at-most-once-latest-catch-up.md)：agent `tasks/schedules/`（规则校验、cron 解析与下次时间（时区、DST）、补跑计算、四个工具与 `schedule-not-allowed`）；server `ScheduleService`（定时器与 30 秒复查、启动扫描、准入、`recordFire` 后开始 `trigger: schedule` 的 Run、挂起与至多一次、`schedule_update` 进度）、`context/schedules.ts`（工具注册、`<scheduled_task>` 输入、授权）、`routes/schedules.ts`；`NotificationService` 与 main `notifications.ts`（Electron Notification、点击打开会话、测试构建日志）。界面归票 09。

**User stories:** 13, 14, 15, 16（服务端与 main）

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/tasks/schedules/`、`packages/protocol/src/schedules.ts`、`apps/server/src/application/{schedules,notifications}.ts`、`application/context/schedules.ts`、`http/routes/schedules.ts`、`apps/desktop/src/main/notifications.ts`、`packages/i18n/src/dictionaries/domains/schedules.ts`、就近测试、`tests/integration/{sidecar-schedules,sidecar-schedules-restart,sidecar-notifications,secrets-gate-schedules,secrets-gate-notifications}.test.ts`（新）、`apps/desktop/src/main/notifications.test.ts`（新）、`docs/subsystems/schedules.md`（新）、`docs/subsystems/context.md`（`<scheduled_task>` 一段）、`docs/adr/0015-schedules-at-most-once-latest-catch-up.md`

- [x] agent 表驱动：cron 每段语法与拒绝项、日 / 周的"任一匹配"、Asia/Shanghai 与 America/New_York 的下次时间（含 DST 跳过与重复取较早）、every 的对齐、at 必须在将来、补跑只取最近一次并计 missed
- [x] 集成（测试时钟）：after / at / every / cron 各自到期开始 `trigger: schedule` 的 Run，faux requestLog 中 user message 为 `<scheduled_task …>prompt</scheduled_task>`；一次性任务之后 inactive；暂停后不投递、恢复后按下一次
- [x] 集成：Run 进行中到期 → 挂起，Run 结束后投递一次；挂起期间又到期两次 → 仍只投递一次
- [x] 集成 `sidecar-schedules-restart`：停机跨越 5 个发生次后启动只投递 1 次且 `missed: 4`；在 `recordFire` 之后、run_start 之前 SIGKILL（测试钩子挂起点）→ 重启后该发生次不再投递（至多一次）
- [x] 集成：准入跳过原因各一例（`disabled`、`workspace-missing`、`model-not-configured`、`budget`），跳过后重复任务照常计算下一次
- [x] **对手用例（权限 / 预算）**：scheduled Run 中模型调用 `schedule_create` 与 `create_goal` 为错误结果、没有新任务与 Goal；prompt 为 `/goal resume` 时 paused 的 Goal 仍为 paused；用户在普通消息中写 `<scheduled_task …>` 不使该 Run 成为 schedule 触发（run_start trigger 仍为 submit）；read-only 与 plan 下 `schedule_create` 询问、full-access 放行、`Schedule` 拒绝规则在 full-access 下生效
- [x] HTTP：列表（按 Session 与全部）、创建、PATCH 的 revision 冲突、删除；每 Session 第 21 个 active 400
- [x] 通知：scheduled Run 结束、scheduled Run 等待审批时 Sidecar 发 `notify` 控制消息（集成测试断言）；设置 `notifications.enabled: false` 时不发；main 单元测试：窗口在前台时不显示、不在前台时显示、点击调用 `onOpenSession`；测试构建记 `notification shown`
- [x] 秘密总闸：`secrets-gate-schedules`（prompt / title 含 Secret：表行、条目、HTTP、WS、requestLog 中的 `<scheduled_task>`）、`secrets-gate-notifications`（通知 body 与日志）
- [x] 符号链接：不适用（不读取文件，Comments 写明）
- [x] schedules.md 建立并可达；context.md 一段；ADR 0015 补本票证据；`check:docs` 通过

## Comments

### 实施者（票 05）

**提交（m5/05-schedules-core）：** 7b83def agent 规则 / cron / 工具；9a37633 server ScheduleService、路由、通知与 main；be44a59、f886cd2 集成测试；c1c24ed 秘密总闸；2e224b0 文档；c22091d 合入 main（dc33c83）；c630d0e、0c0e1a7 测试修正。

**逐项：**

- agent：`packages/agent/src/tasks/schedules/schedules.test.ts` 85 例（cron 每段语法与 20 个拒绝项、日 / 周任一匹配、Asia/Shanghai 与 America/New_York 的下次时间含 DST 跳过与重复取较早、时区校验、every 对齐、at 须在将来、补跑最近一次与 missed 含 10 000 封顶、工具参数与授权）。先红：首次运行 15 例失败，其中 1 例为真缺陷（夏令时结束那一小时 02:00 EST 被跳过：偏移只在 ±3 小时探测），修正后通过。变异：重复时刻取任意一次 → 3 例失败；日 / 周改为"且" → 1 例失败；均已还原。
- `tests/integration/sidecar-schedules.test.ts` 11 例：四种规则（requestLog 中 `<scheduled_task …>prompt</scheduled_task>`、run_start 的 trigger 与 schedule、一次性 inactive、lastFire.runId、schedule_update 进度）；暂停 / 恢复（另一 Session 的哨兵证明暂停期间的扫描已执行；恢复后按原对齐，不补）；挂起（挂起期间到期 3 次，只投递一次 missed: 2）；准入 disabled（项目设置）/ workspace-missing / budget / model-not-configured；对手用例 4 例；HTTP；通知。变异：去掉 schedule-not-allowed 守卫 → 对手用例失败；去掉 budget 准入 → 准入用例失败；均已还原。
- `tests/integration/sidecar-schedules-restart.test.ts` 2 例：停机跨越 5 个发生次 → 1 次 missed: 4；recordFire 后 SIGKILL → 不重投、下一次照常。变异：started 时不推进 next_at → SIGKILL 用例失败，已还原。
- 通知：`notify` 控制消息的断言在 sidecar-schedules 的"通知"用例中（schedule-run-ended、approval-waiting、设置关闭后不发并记日志）；没有另建 `sidecar-notifications.test.ts`。main：`apps/desktop/src/main/notifications.test.ts` 4 例（前台不显示、不在前台显示且点击调用 openSession、关闭释放引用、测试构建只记 notification shown）。
- 秘密总闸：`secrets-gate-schedules`（独立模式 COKO_SECRET_*；HTTP 与模型 schedule_create 两条来源；表行、schedule_fire 行、HTTP、WS、requestLog 的 `<scheduled_task>`、库与日志）；`secrets-gate-notifications`（IPC 模式 secret.store，secret_probe 先解密，title 含 Secret；notify 控制消息、全部控制消息、日志与 stderr）。两者都先断言通道被驱动、带 `[REDACTED:secret]`。
- 符号链接：不适用。定时任务不读取文件、不新增读取根；`<scheduled_task>` 是新注入点，已由 secrets-gate-schedules 扫描 faux requestLog；`notify` 外发通道由 secrets-gate-notifications 扫描。
- 文档：新建 `docs/subsystems/schedules.md`（docs/README.md 当前行为导航加一行）；context.md 增"定时任务的 `<scheduled_task>` 输入"一节；ADR 0015 增实施记录，implementation not-started → partial（界面未交付；adr/README 的 implementation 列同步，合入 main 时与 0016 的 partial 冲突已解决）。`pnpm run check:docs` 177 文件 0 问题。

**设计说明（Lead 请过目）：**

- 间隔任务的对齐点取 ClockPort 时间（任务已知的 next_at / last_occurrence），不用表的 created_at（墙上时间，测试时钟下不同）。规则改为 every 时以此刻为新对齐点；恢复时沿用原对齐。cron 恢复时取此刻之后的下一次（暂停期间不补）。
- 挂起只在内存（不记录、不推进 next_at）；挂起期间重启，由启动扫描投递一次，仍满足至多一次。挂起的任务在 run_end 后经 setImmediate 排入扫描队列（不在 onRunEnd 中直接开始 Run，避免与其他领域的 Run 结束处理交错）。
- Run 没能开始（与用户提交竞争）时追加第二条 `schedule_fire { skipped, start-failed }`（规格如此）。lastFire.runId 由 run_start.schedule 派生，schedule_fire 中不写 runId（记录在开始 Run 之前）。
- 通知文案为英文（Sidecar 无 i18n）；被设置关闭时记 info 日志 `notification not sent: disabled in settings`（测试据此断言）。删除任务不推送 schedule_update（快照没有"已删除"状态），客户端重读列表；票 09 若需要可另议。
- 第 21 个 active 与恢复超限均 400 bad-request（details.limit）。

**越出 Write scope 的改动（请裁决）：**

- `packages/agent/src/tasks/index.ts`：一行 `export * from './schedules/index.ts'`（schedules/ 目录此前不存在，包入口经 tasks barrel 导出）。
- `apps/server/src/runtime/layers.ts`（只有 02 改）：ScheduleService 与 NotificationService、时钟移到 AssemblyLive（定时任务贡献需要读取服务），`lateSessionRuns` 增 `ScheduleRunHost`，`createContributions` 传 `schedules`。与票 04 的改动自动合并，无语义冲突。
- `apps/server/src/application/context/types.ts`（只有 02 改）：`ContextContributionOptions.schedules?` 一行。
- `apps/server/src/config.ts`：测试钩子 `COKO_TEST_CLOCK_START`（测试时钟起点，重启扫描用）与 `COKO_TEST_HOLD_SCHEDULE_FIRE`（recordFire 后挂起）；打包发布构建按既有 TEST_HOOK_ENV 规则忽略。
- `apps/desktop/src/main/index.ts`（只有 02 改）：导入 Electron `Notification`，向 `handleNotify` 传 `show`（显示与 click / close 回调）。
- `apps/server/src/application/notifications.ts` 在写范围内；`docs/README.md` 导航一行与 `docs/adr/README.md` 的 0015 列。
- `tests/integration/sidecar-todo.test.ts`："read-only 模式不询问；压缩后 `<todo_list>` 仍在"一例的 contextWindow 60 000 → 64 000。原因（读实际值确认）：常驻的 schedule_* 工具定义使第 3 条消息触发自动压缩，随后 `/compact` 400 nothing-to-compact；单独运行同样失败（确定性，非负载）。只改该用例窗口，不改阈值算法（规格 Further Notes 预期由 Lead 在 05、07 合入后复核，这里先行调整以使全量通过）。`sidecar-compaction` 未受影响。

**需要 Lead 合并时处理：** `packages/agent/README.md`、`apps/server/README.md` 的要点（由票 08 汇总）：agent `tasks/schedules/`（cron、规则、补跑、四个工具、schedulesAllowed、scheduledTaskText）；server `ScheduleService`（ScheduleRunHost、定时器与 30 秒复查、准入、recordFire 后开始 Run、挂起、通知）、`NotificationService` 的发出方、两个测试钩子变量。

**最终验证（2026-10-31 04:3x，main dc33c83 已合入；等其他 vitest run 结束后后台运行）：** worktree 中 `pnpm run test`：272 个测试文件全部通过，2224 例（2223 通过、1 跳过为既有的真实模型用例），test=0，日志中没有 Unhandled；含 28 个 desktop-e2e 文件与 `package-smoke.e2e.test.ts`（3 例）。第一次全量（04:27）1 个确定性失败即上述 sidecar-todo，按实际值调整后全量通过。另：`pnpm run lint`、`format:check` 退出 0；`check:docs` 0 问题；`scripts/browser-deps.test.ts` 与 `scripts/source-references.test.ts` 4 例通过。`tsc -b` 只有一个错误，来自 main 上票 04 的 `apps/desktop/e2e/worktrees.e2e.test.ts(110,52)`（`env.GIT_CONFIG_GLOBAL` 为 `string | undefined`），本票未改该文件，已另行告知 Lead。

**未验证：** 真实模型（无凭据）；Electron 中真实桌面通知的显示与点击（main 单元测试以替身覆盖，测试构建只记日志）；真实睡眠唤醒（30 秒复查）；`worktree-removed` 跳过原因没有集成用例（准入代码有此分支，票 04 已合入，可由票 09 或后续补）。
