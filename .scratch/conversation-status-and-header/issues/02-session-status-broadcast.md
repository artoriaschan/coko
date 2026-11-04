# 02: 会话运行状态实时广播，计入后台 Subagent 与 Teammate

**What to build:** 侧栏为列表中的所有 Session 实时显示“执行中”，包括当前窗口从未打开过的 Session。例如，定时任务或 Goal 在一个没打开过的 Session 中开始 Run 时，该行立即出现转圈。父 Run 结束后，只要后台 Subagent 或 Teammate 还在运行，转圈就保留，可访问名称为“后台运行中”。空闲等待消息的 Teammate 和 Background Job 不算“执行中”。较旧的列表快照不会覆盖较新的状态，重连或重启后不残留转圈。

**规格场景:** [spec](../spec.md) 的 AC-13、AC-14、AC-17，以及 AC-16 中后台运行的部分；对应 RUN-01、RUN-05。

**设计依据:** [design.md](../design.md)。

**文档影响:** 在所属子系统说明中写入 WebSocket 消息与 Session DTO 字段；projects 当前行为说明补充后台 Subagent 与 Teammate 的规则。

**Blocked by:** 01 — 侧栏“执行中”转圈（转圈界面和集中的“执行中”判断）

**Status:** ready-for-agent

**Closed:** true

- [x] 一个没有订阅某 Session 的连接，在该 Session 的 Run 开始和结束时依次收到 `session_status`：先是 running 为 true，然后为 false。值不变时不发送。
- [x] 父 Run 结束、后台 Subagent 仍在运行时，状态为 `{ running: false, agentsRunning: true }`；Subagent 结束后变为 `{ false, false }`。Teammate 的 Run 结束、进入空闲后，`agentsRunning` 变为 false；它收到消息开始新的 Run 时，再变为 true。
- [x] Background Job（包括常驻进程）不会让 Session 进入“执行中”。
- [x] 列表接口和详情接口的 `agentsRunning` 与广播按同一规则计算；没有这个字段时视为 false。
- [x] 列表快照加载期间收到的广播，以及接口返回的 DTO 写入列表时，较新的值都不会被较旧的值覆盖。重连后状态与服务端一致；应用重启后没有“执行中”。
- [x] 侧栏以 `running` 或 `agentsRunning` 为真作为“执行中”。可访问名称：Run 正在执行时为“运行中”；只有后台 Subagent 或 Teammate 在运行时为“后台运行中”。收起的项目按同样的规则处理。
- [x] renderer 对消息的严格校验接受新的消息类型；headless 和现有的使用方不受影响。
- [x] 真实 Sidecar 协议集成测试覆盖上述序列，并锁住 design 中的三处时序：`run_start` 之前运行时已是运行中；`run_end` 之前已清除运行中；Subagent 的状态在 `agent_update` 之前已更新。
- [x] renderer store 测试覆盖列表加载与广播交错的情况。E2E 在未打开的 Session 中运行后台 Subagent，检查侧栏转圈出现，结束后消失。
- [x] 同步修改 WebSocket 消息与 DTO 字段的说明，以及 projects 中的后台规则。实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-04：用户回复“确认”，确认 9 票及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。撤回前按 design 写的实现草稿保存在 [session-status-broadcast.patch](../reference/session-status-broadcast.patch)，只通过了类型检查，没有测试。可以作为起点，但采用前要对照当前基线重新核对，不能当作已完成的实现。

- 2026-11-04 实施完成（基线 `db87d09b`）：新增全局 `session_status` 与 DTO `agentsRunning`；Hub 在进度送达后通知观察者，SessionService 按根 Session 同步重算、去重，删除 Session 时清除缓存。列表 store 用递增修订号抵御旧快照与接口 DTO，侧栏复用一处执行中判定并区分“运行中”/“后台运行中”。没有改动排序或持久化格式。
- TDD：`pnpm run test tests/integration/sidecar-session-status.test.ts` 首次 1 项失败，收到空广播；实现后通过。额外负向控制临时移除 chat-store 广播写入，`pnpm run test apps/desktop/src/renderer/stores/chat-store.test.ts -t 'global Session status'` 精确 2 项失败（缺少后台状态），恢复后通过；负向样例已撤销。
- 检查（均退出 0）：`pnpm run test tests/integration/sidecar-session-status.test.ts apps/desktop/src/renderer/stores/chat-store.test.ts apps/server/src/application/hub.test.ts packages/protocol/src/readme.test.ts`，4 文件 / 34 项；`pnpm run test tests/integration/sidecar-subagents.test.ts tests/integration/sidecar-teams.test.ts tests/integration/sidecar-titles.test.ts`，3 文件 / 23 项；`pnpm run test apps/desktop/src/renderer/features/sidebar/sidebar-activity.browser.test.tsx`，1 文件 / 5 项；`pnpm run test apps/desktop/e2e/session-status.e2e.test.ts`，真实 Electron 1 文件 / 1 项；`pnpm run typecheck`；`pnpm run check:docs`，319 Markdown / 0 问题。变更 TS/TSX 的 oxfmt、oxlint 与 `git diff --check` 通过。
- 协议场景：从未订阅的连接收到根 Run start/end；后台子代理等待审批、取消、存活子代理期间重启；Teammate 两个受文件闸门控制的 Run 与中间 idle；Background Job 完成不触发执行中或重复空闲广播；列表与详情口径一致。精确状态序列锁住运行时 start/end 与子代理更新的时序，Hub 用例验证进度先送达订阅者、观察者再同步执行及单连接发送失败隔离。
- 文档影响：`packages/protocol/README.md` 增补全局消息、可选字段、重连与修订号；`docs/subsystems/projects.md` 更新后台运行与实时列表规则。已从 AGENTS → docs 导航回读，现有正文归属、引用方向与生命周期一致，没有正式文档反向依赖任务材料。
- 限制：上述 Electron 与 Browser Mode 是静默自动化；整体明暗主题/zh/en/390px 联合验收与 agent-browser 由 09 负责。未运行真实模型、全仓测试、CI、发布产物或原生窗口层；没有推送或发布。
