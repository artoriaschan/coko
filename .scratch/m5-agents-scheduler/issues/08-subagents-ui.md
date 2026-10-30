# 08: 子代理界面：agent 卡片、Agents tab、审批冒泡、标题栏按钮与 Agents 设置分区

**What to build:** 见 [规格](../spec.md)"界面 · 子代理"：`agent` 工具卡（类型、描述、状态、一行进度、用量、后台 chip）、`agent_notification` 紧凑行、标题栏"子代理"按钮、右栏 Agents tab（列表与只读子时间线、停止）、父会话输入区的审批冒泡（最早的待审批请求来自父或 running 子代理，卡片标出来源，回答发往子 Session）、设置 → Agents 分区（定义与诊断，只读）；汇总 M5 的 agent 与 server README。

**User stories:** 9（界面）, 11, 7（设置）

**Blocked by:** 07

**Status:** ready-for-agent

**Write scope:** renderer `features/conversation/{tool-cards,agent-card（新）,agent-notification-row,agents-button（新）,approval-panel,conversation-pane}.tsx`、`features/conversation/header-actions.ts`（只改 agents 一行）、`features/right-panel/{agents-tab.tsx（新）,tabs.ts（只改 agents 一行）}`、`features/settings/{agents-section.tsx（新）,sections.ts（只改 agents 一行）}`、`stores/agents-store.ts`（新）、`packages/i18n/src/dictionaries/domains/agents.ts`、就近测试、`apps/desktop/e2e/subagents.e2e.test.ts`（新）、`docs/subsystems/subagents.md`（界面一节）、`docs/adr/0014-subagents-as-child-sessions.md`、`packages/agent/README.md`、`apps/server/README.md`

- [ ] browser：agent 卡在 running / completed / failed / cancelled / max-turns / interrupted 下的显示（zh / en）；进度行随 `agent_update` 更新；用量与后台 chip
- [ ] browser：审批冒泡——父与两个子代理各有一个待审批请求时按时间顺序接管，卡片标出"来自子代理 <类型> · <描述>"，回答请求的 sessionId 为子 Session；父会话输入区草稿不丢
- [ ] E2E（真实 Electron + Sidecar + faux）：派发前台 explore → 卡片进度 → 结果；打开 Agents tab 看到子时间线；后台子代理的停止按钮使其 `agent_end cancelled`；子代理的写入审批在父会话中允许后继续；标题栏按钮的 running 数
- [ ] E2E：设置 → Agents 列出 general、explore 与 `COKO_HOME/agents`、项目 `.coko/agents` 中的定义，诊断可展开，注明在文件中编辑
- [ ] 界面验收：明暗主题、390 px 窗口、键盘可达（Tab 到停止按钮、Enter 打开子时间线）；子时间线只读（没有输入区）
- [ ] 秘密：不新增通道（只读条目与已有接口，Comments 写明）；符号链接不适用
- [ ] README 汇总 M5 全部导出与服务（各票 Comments 中的要点）；subagents.md 界面一节；ADR 0014 改 implemented（README 索引同步）；`check:docs` 通过

## Comments
