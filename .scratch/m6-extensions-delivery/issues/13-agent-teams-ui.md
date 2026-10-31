# 13: 团队界面：Team tab（名册、任务板、成员时间线）、标题栏按钮、消息与任务行、工具卡

**What to build:** 见 [规格](../spec.md)"Agent Teams"与 [grilling C9](../grilling.md#第-4-轮)：renderer `team-store`（`GET /api/sessions/:id/team` 与 `team_update`）、右栏 Team tab（注册表 `team` 一行改为可用）、标题栏"团队"按钮（running 成员数，`header-actions` 一行）、`team-message-row` 与 `team-task-row`（03 的空组件填实）、`send_message` / `task_*` 工具卡；成员时间线复用 Agents tab 的 TimelineView 并经 02 的 `subscribeSession` 订阅与释放。参考 DSH `client-ui-agent-team`。

**User stories:** 9

**Blocked by:** 06

**Status:** ready-for-agent

**Write scope:** renderer `features/right-panel/{team-tab.tsx,tabs.ts（只改 team 一行）}`、`features/conversation/{team-button.tsx,team-task-row.tsx,team-message-row.tsx,header-actions.ts（只改 team 一行）,tool-cards.tsx（只追加 team 分支）}`、`stores/team-store.ts`（新）、`packages/i18n/src/dictionaries/domains/teams.ts`、就近测试、`apps/desktop/e2e/teams.e2e.test.ts`（新）、`docs/subsystems/teams.md`（界面一节）、`docs/adr/0018-agent-teams-in-root-session.md`（改 implemented）、`docs/adr/README.md`（0018 一行）

**跨票接口：** 读取 06 写入的 `TeamSnapshot`、`team_task`、`team_message`（形状见规格，不改）；子 Session 订阅用 02 的 `subscribeSession(sessionId): () => void`，卸载时 release。

- [ ] Browser Mode：名册的状态点与活动、任务板分组与"可认领"、重叠警告、阻塞关系；`team_message` 行显示发送方 → 接收方与 summary（不显示 `<team-message` 原文）；选中成员后订阅、切走后释放（订阅计数断言）
- [ ] E2E（真实 Electron 与 Sidecar，faux）：lead 创建两个 teammate、建任务、各自认领与完成 → Team tab 实时显示名册与任务状态变化；标题栏按钮的 running 数；点成员看到其只读时间线；teammate 的审批在父会话输入区出现并可回答（复用 M5 冒泡）；明暗主题与键盘操作
- [ ] teams.md 界面一节；ADR 0018 改 implemented（链接 06 与本票证据），README 索引同步；`check:docs` 通过

## Comments
