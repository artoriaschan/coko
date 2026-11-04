# 02: 会话运行状态实时广播，计入后台 Subagent 与 Teammate

**What to build:** 侧栏为列表中的所有 Session 实时显示“执行中”，包括当前窗口从未打开过的 Session。例如，定时任务或 Goal 在一个没打开过的 Session 中开始 Run 时，该行立即出现转圈。父 Run 结束后，只要后台 Subagent 或 Teammate 还在运行，转圈就保留，可访问名称为“后台运行中”。空闲等待消息的 Teammate 和 Background Job 不算“执行中”。较旧的列表快照不会覆盖较新的状态，重连或重启后不残留转圈。

**规格场景:** [spec](../spec.md) 的 AC-13、AC-14、AC-17，以及 AC-16 中后台运行的部分；对应 RUN-01、RUN-05。

**设计依据:** [design.md](../design.md)。

**文档影响:** 在所属子系统说明中写入 WebSocket 消息与 Session DTO 字段；projects 当前行为说明补充后台 Subagent 与 Teammate 的规则。

**Blocked by:** 01 — 侧栏“执行中”转圈（转圈界面和集中的“执行中”判断）

**Status:** ready-for-agent

- [ ] 一个没有订阅某 Session 的连接，在该 Session 的 Run 开始和结束时依次收到 `session_status`：先是 running 为 true，然后为 false。值不变时不发送。
- [ ] 父 Run 结束、后台 Subagent 仍在运行时，状态为 `{ running: false, agentsRunning: true }`；Subagent 结束后变为 `{ false, false }`。Teammate 的 Run 结束、进入空闲后，`agentsRunning` 变为 false；它收到消息开始新的 Run 时，再变为 true。
- [ ] Background Job（包括常驻进程）不会让 Session 进入“执行中”。
- [ ] 列表接口和详情接口的 `agentsRunning` 与广播按同一规则计算；没有这个字段时视为 false。
- [ ] 列表快照加载期间收到的广播，以及接口返回的 DTO 写入列表时，较新的值都不会被较旧的值覆盖。重连后状态与服务端一致；应用重启后没有“执行中”。
- [ ] 侧栏以 `running` 或 `agentsRunning` 为真作为“执行中”。可访问名称：Run 正在执行时为“运行中”；只有后台 Subagent 或 Teammate 在运行时为“后台运行中”。收起的项目按同样的规则处理。
- [ ] renderer 对消息的严格校验接受新的消息类型；headless 和现有的使用方不受影响。
- [ ] 真实 Sidecar 协议集成测试覆盖上述序列，并锁住 design 中的三处时序：`run_start` 之前运行时已是运行中；`run_end` 之前已清除运行中；Subagent 的状态在 `agent_update` 之前已更新。
- [ ] renderer store 测试覆盖列表加载与广播交错的情况。E2E 在未打开的 Session 中运行后台 Subagent，检查侧栏转圈出现，结束后消失。
- [ ] 同步修改 WebSocket 消息与 DTO 字段的说明，以及 projects 中的后台规则。实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-04：用户回复“确认”，确认 9 票及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。撤回前按 design 写的实现草稿保存在 [session-status-broadcast.patch](../reference/session-status-broadcast.patch)，只通过了类型检查，没有测试。可以作为起点，但采用前要对照当前基线重新核对，不能当作已完成的实现。
