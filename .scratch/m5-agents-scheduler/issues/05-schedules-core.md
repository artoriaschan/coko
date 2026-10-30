# 05: 定时任务核心：规则与 cron、定时器与补跑、投递与去重、运行准入、工具与 HTTP、桌面通知

**What to build:** 见 [规格](../spec.md)"定时任务与通知"与 [ADR 0015](../../../docs/adr/0015-schedules-at-most-once-latest-catch-up.md)：agent `tasks/schedules/`（规则校验、cron 解析与下次时间（时区、DST）、补跑计算、四个工具与 `schedule-not-allowed`）；server `ScheduleService`（定时器与 30 秒复查、启动扫描、准入、`recordFire` 后开始 `trigger: schedule` 的 Run、挂起与至多一次、`schedule_update` 进度）、`context/schedules.ts`（工具注册、`<scheduled_task>` 输入、授权）、`routes/schedules.ts`；`NotificationService` 与 main `notifications.ts`（Electron Notification、点击打开会话、测试构建日志）。界面归票 09。

**User stories:** 13, 14, 15, 16（服务端与 main）

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/tasks/schedules/`、`packages/protocol/src/schedules.ts`、`apps/server/src/application/{schedules,notifications}.ts`、`application/context/schedules.ts`、`http/routes/schedules.ts`、`apps/desktop/src/main/notifications.ts`、`packages/i18n/src/dictionaries/domains/schedules.ts`、就近测试、`tests/integration/{sidecar-schedules,sidecar-schedules-restart,sidecar-notifications,secrets-gate-schedules,secrets-gate-notifications}.test.ts`（新）、`apps/desktop/src/main/notifications.test.ts`（新）、`docs/subsystems/schedules.md`（新）、`docs/subsystems/context.md`（`<scheduled_task>` 一段）、`docs/adr/0015-schedules-at-most-once-latest-catch-up.md`

- [ ] agent 表驱动：cron 每段语法与拒绝项、日 / 周的"任一匹配"、Asia/Shanghai 与 America/New_York 的下次时间（含 DST 跳过与重复取较早）、every 的对齐、at 必须在将来、补跑只取最近一次并计 missed
- [ ] 集成（测试时钟）：after / at / every / cron 各自到期开始 `trigger: schedule` 的 Run，faux requestLog 中 user message 为 `<scheduled_task …>prompt</scheduled_task>`；一次性任务之后 inactive；暂停后不投递、恢复后按下一次
- [ ] 集成：Run 进行中到期 → 挂起，Run 结束后投递一次；挂起期间又到期两次 → 仍只投递一次
- [ ] 集成 `sidecar-schedules-restart`：停机跨越 5 个发生次后启动只投递 1 次且 `missed: 4`；在 `recordFire` 之后、run_start 之前 SIGKILL（测试钩子挂起点）→ 重启后该发生次不再投递（至多一次）
- [ ] 集成：准入跳过原因各一例（`disabled`、`workspace-missing`、`model-not-configured`、`budget`），跳过后重复任务照常计算下一次
- [ ] **对手用例（权限 / 预算）**：scheduled Run 中模型调用 `schedule_create` 与 `create_goal` 为错误结果、没有新任务与 Goal；prompt 为 `/goal resume` 时 paused 的 Goal 仍为 paused；用户在普通消息中写 `<scheduled_task …>` 不使该 Run 成为 schedule 触发（run_start trigger 仍为 submit）；read-only 与 plan 下 `schedule_create` 询问、full-access 放行、`Schedule` 拒绝规则在 full-access 下生效
- [ ] HTTP：列表（按 Session 与全部）、创建、PATCH 的 revision 冲突、删除；每 Session 第 21 个 active 400
- [ ] 通知：scheduled Run 结束、scheduled Run 等待审批时 Sidecar 发 `notify` 控制消息（集成测试断言）；设置 `notifications.enabled: false` 时不发；main 单元测试：窗口在前台时不显示、不在前台时显示、点击调用 `onOpenSession`；测试构建记 `notification shown`
- [ ] 秘密总闸：`secrets-gate-schedules`（prompt / title 含 Secret：表行、条目、HTTP、WS、requestLog 中的 `<scheduled_task>`）、`secrets-gate-notifications`（通知 body 与日志）
- [ ] 符号链接：不适用（不读取文件，Comments 写明）
- [ ] schedules.md 建立并可达；context.md 一段；ADR 0015 补本票证据；`check:docs` 通过

## Comments
