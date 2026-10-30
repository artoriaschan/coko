# 06: 后台任务视图：标题栏入口、右栏 Jobs tab、Job chip 与通知行

**What to build:** 见 [规格](../spec.md) "界面"一节的后台任务：会话标题栏"后台任务"按钮（running 数徽标，`header-actions.ts` 的 jobs 一行改为可用）；右栏 Jobs tab（`tabs.ts` 的 jobs 一行改为可用）：列表（状态点、标签、时长、退出码）、选中项输出（`GET /api/jobs/:id/output` 分页 + WS `job_output` 追加，anser 渲染 SGR，局部横向滚动，跟随尾部，停止按钮）；后台 bash 工具卡的 Job chip（点击打开该 Job）；`job_notification` 时间线紧凑行。只改 renderer。

**User stories:** 13

**Blocked by:** 04

**Status:** ready-for-agent

**Write scope:** `apps/desktop/src/renderer/features/right-panel/{jobs-tab.tsx（新）,tabs.ts（jobs 一行）}`、`features/conversation/{job-row.tsx,tool-cards.tsx,header-actions.ts（jobs 一行）,jobs-button.tsx（新）}`、`stores/jobs-store.ts`（新）、`packages/i18n/src/dictionaries/domains/jobs.ts`、`apps/desktop/src/renderer/**/jobs*.browser.test.tsx`（新）、`apps/desktop/e2e/jobs.e2e.test.ts`（新）、`docs/subsystems/jobs.md`（界面一节）

- [x] Browser Mode：输出组件渲染 ANSI 颜色、长行横向滚动不撑开面板、跟随尾部在用户上滚后暂停；列表 key 为 jobId
- [x] E2E（真实 Sidecar + faux）：Agent 启动后台 Job → 标题栏徽标为 1 → 打开 Jobs tab 看到实时输出 → 点停止 → 状态变为 killed、徽标消失；Job chip 打开对应 Job；通知行出现在时间线
- [x] E2E：重新打开会话后列表与输出从接口恢复（不依赖已收到的 WS 帧）
- [x] 明暗主题、键盘可达（停止按钮、tab 切换）、窄窗口（390 px）下面板可用；截图检查结果写在 Comments
- [x] 本票不新增注入点或读取根（Comments 写明）；`scripts/browser-deps.test.ts` 通过（anser 若需深层导入，两份 browser 配置同步）
- [x] jobs.md 界面一节；`check:docs` 通过

## Comments
- 2026-10-30 lead：来自票 07——时间线中"尚未送达"的气泡与 dock 的 Queue 卡重复显示待送达指令。Queue 卡为唯一呈现，本票删除时间线中的该气泡并更新相关测试（越出写范围，已授权：apps/desktop/src/renderer/features/conversation/timeline-view.tsx 与其测试）。
- 2026-10-30 lead：来自票 04——列表接口为 SessionJobsResponse { jobs }，路径见 jobPaths；WS job_output 的偏移等于日志文件的字节偏移，可直接用于增量追加。
- 2026-10-30 implementer（m4/06-jobs-view）：
  - **覆盖的验收。** 全部 6 项。Browser Mode：`jobs-tab.browser.test.tsx`（9 例：SGR 红色与 destructive 同色、OSC 不显示；2000 字符长行在 300 px 面板内横向滚动、面板宽度不变；跟随尾部、上滚后暂停、"跟随最新输出"恢复；列表的状态 / 时长 / 退出码与 key 为 jobId（前插新项后已有行 DOM 节点不变）；键盘 Enter 停止；缺省选中项结束后不跳走；store 重叠丢弃、缺口补齐、末尾一页从行首开始、加载更早的输出）、`jobs-timeline.browser.test.tsx`（2 例：Job chip 与通知行、通知文本不进入用户气泡；追加指令不再在时间线显示）。E2E `apps/desktop/e2e/jobs.e2e.test.ts`（2 例，真实 Electron + Sidecar + faux）：两个后台 Job → 徽标 2 → Jobs tab 实时输出且颜色为 destructive → 键盘停止 → killed、徽标 1 → Job chip 打开 alpha → 390 px 窗口（用例内放开 minWidth 520）下停止按钮在视口内、无整页横向滚动 → 停止 → 徽标消失 → 下一条消息前出现一条通知行（两个 Job）、用户气泡只有用户文本；重启应用后重新打开会话，列表 completed / 退出码 0 与输出 `step 1…build-done` 从接口恢复。
  - **负向确认。** 时间线通知过滤：还原 `timeline.ts` 后 `timeline.test.ts` 新用例失败（1 failed / 7 passed），恢复后通过。缺省选中固定：去掉 select 后新 browser 用例失败，恢复后 9/9。E2E 首次运行正是因选中项跳到另一个运行中 Job 而失败，据此修复并加了回归用例。
  - **截图检查**（临时脚本，未提交）：明 / 暗主题 1280 px 与 390 px。列表行截断、状态点、停止按钮、红色输出在两种主题下可读；390 px 时右栏为浮层，输出在区内横向滚动。已知限制：16 色只映射到现有语义 token（绿 success、黄 warning 在亮色背景上对比度偏低，未新增 token）；256 色与 truecolor 按默认前景显示。
  - **注入点与读取根。** 本票只改 renderer，不新增注入点、读取根或输出通道（只消费已有的 HTTP 接口与 WS 帧，已由 `secrets-gate-jobs.test.ts` 覆盖），不涉及文件路径，符号链接用例不适用。`scripts/browser-deps.test.ts` 通过（anser 不是深层导入）。
  - **越出 Write scope 的改动：**
    - `apps/desktop/src/renderer/features/conversation/timeline.ts` 与 `timeline.test.ts`："02 独占"的文件，02 已合入。送达通知的 `<job-notification>` 文本块原本会显示为用户气泡；过滤这类文本块，只有通知的消息不成气泡（+7 行与 1 个用例）。
    - `apps/desktop/vitest.browser.config.ts`：`optimizeDeps.include` 加 `'anser'`（CommonJS，运行中被发现会触发预构建并重载测试页面，首次运行已出现）。只加 desktop 一份，packages/ui 不依赖 anser。
    - `apps/desktop/e2e/run-control.e2e.test.ts`：Lead 已授权删除时间线中的待送达气泡；该 E2E 的待送达定位改为 Queue 卡（`[data-slot="queue-card"] [data-queued]`），用例名与注释同步。
    - `timeline-view.tsx` 的 `steering` 分支返回 null（Lead 已授权）；`timeline.ts` 中的 steering 项保留（chat-store 测试使用），i18n `conversation.steeringPending` 已不使用，未删除（`dictionaries/{en,zh}.ts` 只有 02 改）。
  - **文档影响。** `docs/subsystems/jobs.md` 增加"界面"一节与验证条目，开头说明改为 PTY 与 job_input 尚未实现（票 05 也会改这一句，合并时取两者）。`docs/README.md` 当前行为中 jobs.md 一行建议由 Lead 合并时补"、后台任务视图"（不在本票范围）。
  - **供后续票。** `stores/jobs-store.ts` 导出 `jobsStore` / `createJobsStore` / `httpJobsBackend`；`features/conversation/jobs-button.tsx` 导出 `JobsStoreProvider`、`useSessionJobs`、`JobStatusDot`、`formatJobDuration`。`jobsStore.getState().open(sessionId, jobId)` 选中并打开右栏 Jobs tab（经标题栏按钮的 openRequests）。PTY Job（票 05）的 kind `pty` 在列表中同样显示，输出按原始 SGR 渲染。
