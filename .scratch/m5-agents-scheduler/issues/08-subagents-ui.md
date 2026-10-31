# 08: 子代理界面：agent 卡片、Agents tab、审批冒泡、标题栏按钮与 Agents 设置分区

**What to build:** 见 [规格](../spec.md)"界面 · 子代理"：`agent` 工具卡（类型、描述、状态、一行进度、用量、后台 chip）、`agent_notification` 紧凑行、标题栏"子代理"按钮、右栏 Agents tab（列表与只读子时间线、停止）、父会话输入区的审批冒泡（最早的待审批请求来自父或 running 子代理，卡片标出来源，回答发往子 Session）、设置 → Agents 分区（定义与诊断，只读）；汇总 M5 的 agent 与 server README。

**User stories:** 9（界面）, 11, 7（设置）

**Blocked by:** 07

**Status:** ready-for-agent

**Write scope:** renderer `features/conversation/{tool-cards,agent-card（新）,agent-notification-row,agents-button（新）,approval-panel,conversation-pane}.tsx`、`features/conversation/header-actions.ts`（只改 agents 一行）、`features/right-panel/{agents-tab.tsx（新）,tabs.ts（只改 agents 一行）}`、`features/settings/{agents-section.tsx（新）,sections.ts（只改 agents 一行）}`、`stores/agents-store.ts`（新）、`packages/i18n/src/dictionaries/domains/agents.ts`、就近测试、`apps/desktop/e2e/subagents.e2e.test.ts`（新）、`docs/subsystems/subagents.md`（界面一节）、`docs/adr/0014-subagents-as-child-sessions.md`、`packages/agent/README.md`、`apps/server/README.md`

- [x] browser：agent 卡在 running / completed / failed / cancelled / max-turns / interrupted 下的显示（zh / en）；进度行随 `agent_update` 更新；用量与后台 chip
- [x] browser：审批冒泡——父与两个子代理各有一个待审批请求时按时间顺序接管，卡片标出"来自子代理 <类型> · <描述>"，回答请求的 sessionId 为子 Session；父会话输入区草稿不丢
- [x] E2E（真实 Electron + Sidecar + faux）：派发前台 explore → 卡片进度 → 结果；打开 Agents tab 看到子时间线；后台子代理的停止按钮使其 `agent_end cancelled`；子代理的写入审批在父会话中允许后继续；标题栏按钮的 running 数
- [x] E2E：设置 → Agents 列出 general、explore 与 `COKO_HOME/agents`、项目 `.coko/agents` 中的定义，诊断可展开，注明在文件中编辑
- [x] 界面验收：明暗主题、390 px 窗口、键盘可达（Tab 到停止按钮、Enter 打开子时间线）；子时间线只读（没有输入区）
- [x] 秘密：不新增通道（只读条目与已有接口，Comments 写明）；符号链接不适用
- [x] README 汇总 M5 全部导出与服务（各票 Comments 中的要点）；subagents.md 界面一节；ADR 0014 改 implemented（README 索引同步）；`check:docs` 通过

## Comments
- 2026-10-31 lead：来自票 09——main 进程的文件日志（logtape rotating file sink）按 8 KB 或"相隔 5 秒的下一条记录"写出，运行中轮询 harness 的 notificationsShown（或其他读 desktop.jsonl 的辅助）读不到刚记的行。断言桌面通知或 main 日志时，在应用退出（dispose 写出缓冲）之后读取，或等待界面可观察状态；不要靠加长等待。另：main 上的桌面通知转发由票 09 修复，合入前在你的分支上看不到通知是这个原因。
- 2026-10-31 lead：运行全量 `pnpm run test` 前取得全量测试锁 `/tmp/coko-full-test.lock`（做法见 implementer-brief 的"全量测试锁"一节）；只跑单个文件不需要。之前多个 worktree 的全量互相重叠，负载到 20–40，真实进程与 Browser Mode 用例大面积超时。
- 2026-10-31 implementer（08）：完成记录。
  - **覆盖的验收**（7 项勾选）。browser：`features/conversation/agent-card.browser.test.tsx`（4：六种状态的状态名与卡片状态（en）、zh、进度随 `agent_update` 更新再换成用量、后台 chip、保留的 worktree、派发失败、"在右栏查看"与通知行的打开请求）；`approval-bubbling.browser.test.tsx`（1：整个 App，父会话与两个 running 子代理各一个请求按 createdAt 依次接管，子代理卡片标"From subagent <类型> · <描述>"，回答发往 child-a / child-b、父请求经当前会话，草稿 "keep this draft" 保留）；`features/right-panel/agents-tab.browser.test.tsx`（2：列表、缺省选中运行中、只读子时间线无输入区、Tab 到停止 + Enter、Enter 选中另一个打开其时间线、标题栏按钮 running 数与打开请求）；`features/settings/agents-section.browser.test.tsx`（3）；`stores/agents-store.test.ts`（5）。E2E `apps/desktop/e2e/subagents.e2e.test.ts`（1，真实 Electron + Sidecar + faux）：前台 explore 运行中进度 `read · {"path":"notes.txt"}` 与标题栏 running=1 → 完成用量与结果；Agents tab 的子时间线有 read 工具卡与结论、面板中没有 textbox；general 的 write 审批在父会话输入区接管并标来源，允许后 out.txt 内容正确；后台子代理在 Agents tab 中键盘 Tab → Enter 停止，tab / 卡片为 cancelled、running=0；明暗主题下进度行与列表次行对比度 ≥ 4.5；390 px 窗口停止按钮在视口内、无整页横向滚动；设置 → Agents 列出 explore / general（builtin）、reviewer（COKO_HOME）、writer（项目）及展开的 invalid-frontmatter 诊断。
  - **负向确认（变异，均已还原）**：store 去掉"较早列表不覆盖结束状态"→ 对应用例失败（第一次写法未触发该分支，已改写用例后确认先红）；conversation-pane 不让子代理请求接管 → bubbling 用例失败于 req-p ≠ req-a；子代理请求改经当前会话回答 → childAnswers 为空失败。
  - **界面检查**：在 Electron 中看过截图（明 / 暗 1280 px、明 / 暗 390 px、设置分区）。据此修正：进度行只有工具活动用等宽字体；列表次行截断时 title 给出全文。明色截图中停止按钮呈灰色，截图在切换主题之后立即拍摄，390 px 明色截图中正常，判断为颜色过渡中途，未另行验证。
  - **秘密与符号链接**：不新增通道。界面只读已入库的条目（agent_start / agent_end / agent_notification、子 Session 条目）与已有接口（`/api/sessions/:id/agents`、cancel、`/api/agents/definitions`、子 Session 的 approvals），这些在票 07 的 `secrets-gate-subagents` 中已扫描；没有新的读取根。
  - **越出 Write scope 的最小改动**：(1) `features/conversation/agents-button.tsx`（新，按票头"agents-button（新）"放共用接线：store context、useSessionAgents、记录派生、状态点、用量文案与按钮）。(2) 就近测试 `approval-bubbling.browser.test.tsx`、`agent-card.browser.test.tsx`、`agents-tab.browser.test.tsx`、`agents-section.browser.test.tsx`、`stores/agents-store.test.ts`。(3) 注册表固定值的测试：`dock/dock.browser.test.tsx`、`settings/sections.browser.test.tsx`（agents 改为可用；"M5 尚未交付的占位"用例改为"M5 的注册表行都已交付"）。(4) `right-panel/tabs.ts`、`header-actions.ts` 删除不再使用的 `Unavailable` 占位（全部行可用后 oxlint no-unused-vars 报错），不只是 agents 一行。(5) `docs/README.md` 子代理一行补"界面"；`docs/adr/README.md` 0014 改 implemented。
  - **设计取舍**：标题栏"子代理"按钮与后台任务按钮一样，会话有子代理时才显示，不给 MenuItem（只显示状态并打开 tab，按票 10 的说明留在标题栏）。子时间线过滤掉 run-usage 行（RunUsageRow 按当前会话的条目汇总，会显示父会话的数据）。主题经根元素的 dark 类读取（右栏 tab 的 props 没有主题，right-panel.tsx 只有 02 改）。
  - **README 汇总**：agent README 增"M5 领域"一段（hooks / agents / schedules / handoff 的导出与 entries 子路径新增的导出），改正 goalUsage children"没有调用方"；server README 把"M5 服务是存根"改为五个服务、路由、贡献与秘密总闸，增加三个测试变量、关闭顺序中的定时器与子 Run、M5 测试入口。票 10 的 renderer draft-store 导出不在两个 README 的范围，未写入。
  - **留给 Lead / 其他所有者**：`docs/adr/0012-host-process-registry.md:41` 仍写"登记 hook / git 的执行器尚未交付"；`docs/subsystems/todo.md:42` 仍写"Goal 卡尚未交付"；ADR 0015 实施记录中"界面未交付"是带日期的历史记录，保留。均不属本票。
  - **未验证**：真实模型（无凭据）；非 darwin 平台。

  - **运行的命令（main c9a88f4 已包含，git merge main 无新提交）**：`pnpm run typecheck` 0（第一次为 2：approval-bubbling 测试中替换 fixture 的 answerApproval 的参数类型，修正后 0）；`pnpm run lint` 0；`pnpm run format:check` 0；`pnpm run check:docs` 0（181 文件 0 问题）；取全量测试锁后 `pnpm run test` test=0（309 个测试文件全部通过；2520 通过、1 跳过（既有的真实模型用例）），开始时负载约 4，结束时约 10，日志中没有 Unhandled。E2E `subagents.e2e.test.ts` 单独 1/1。
- 2026-10-31 lead：评审后合入 main（2142f77）。接受越界：agents-button.tsx、就近测试、两个注册表测试的固定值、删除 tabs.ts 与 header-actions.ts 中已无用的 Unavailable 占位、docs/README 一行、ADR 索引 0014。lead 更新了实施者指出的两处过时内容：ADR 0012 第 41 行（hook / git 执行器已交付）与 todo.md 第 41–42 行（Goal 卡已交付、时间线不再有待送达气泡）。浅色主题切换后 Stop 按钮一度显示为灰色——实施者判断为颜色过渡，未确认，记入 M5 评审。main 上在全量测试锁内复核：install、typecheck、lint、format:check 退出 0；全量 test 309 文件 2520 通过、1 跳过（真实模型），无页面重载、无未处理错误，运行期间没有其他全量重叠；check:docs 181 文件 0 问题。worktree 已清理。

Closed: true
