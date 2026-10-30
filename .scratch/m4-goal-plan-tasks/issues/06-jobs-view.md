# 06: 后台任务视图：标题栏入口、右栏 Jobs tab、Job chip 与通知行

**What to build:** 见 [规格](../spec.md) "界面"一节的后台任务：会话标题栏"后台任务"按钮（running 数徽标，`header-actions.ts` 的 jobs 一行改为可用）；右栏 Jobs tab（`tabs.ts` 的 jobs 一行改为可用）：列表（状态点、标签、时长、退出码）、选中项输出（`GET /api/jobs/:id/output` 分页 + WS `job_output` 追加，anser 渲染 SGR，局部横向滚动，跟随尾部，停止按钮）；后台 bash 工具卡的 Job chip（点击打开该 Job）；`job_notification` 时间线紧凑行。只改 renderer。

**User stories:** 13

**Blocked by:** 04

**Status:** ready-for-agent

**Write scope:** `apps/desktop/src/renderer/features/right-panel/{jobs-tab.tsx（新）,tabs.ts（jobs 一行）}`、`features/conversation/{job-row.tsx,tool-cards.tsx,header-actions.ts（jobs 一行）,jobs-button.tsx（新）}`、`stores/jobs-store.ts`（新）、`packages/i18n/src/dictionaries/domains/jobs.ts`、`apps/desktop/src/renderer/**/jobs*.browser.test.tsx`（新）、`apps/desktop/e2e/jobs.e2e.test.ts`（新）、`docs/subsystems/jobs.md`（界面一节）

- [ ] Browser Mode：输出组件渲染 ANSI 颜色、长行横向滚动不撑开面板、跟随尾部在用户上滚后暂停；列表 key 为 jobId
- [ ] E2E（真实 Sidecar + faux）：Agent 启动后台 Job → 标题栏徽标为 1 → 打开 Jobs tab 看到实时输出 → 点停止 → 状态变为 killed、徽标消失；Job chip 打开对应 Job；通知行出现在时间线
- [ ] E2E：重新打开会话后列表与输出从接口恢复（不依赖已收到的 WS 帧）
- [ ] 明暗主题、键盘可达（停止按钮、tab 切换）、窄窗口（390 px）下面板可用；截图检查结果写在 Comments
- [ ] 本票不新增注入点或读取根（Comments 写明）；`scripts/browser-deps.test.ts` 通过（anser 若需深层导入，两份 browser 配置同步）
- [ ] jobs.md 界面一节；`check:docs` 通过

## Comments
