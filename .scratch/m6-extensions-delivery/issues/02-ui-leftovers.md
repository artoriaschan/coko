# 02: 界面遗留：S8 / S9 / T5、子代理通知的 Electron E2E、390 px 占位符

**What to build:** 见 [规格](../spec.md)"预构建：界面遗留"：用 `key` 重置对话框代替镜像状态的 effect，"条目计数变化即 load"提成一个 hook（S8）；`subscribeSession` 返回 release 并按引用计数退订，审批冒泡在 cleanup 中释放（S9）；main 的通知模块改为实例（T5）；子代理的 `agent-finished` 与 `approval-waiting` 通知在真实 Electron 中显示（接收侧用例）；390 px 宽时输入区占位符不逐词换行。

**User stories:** 20

**Blocked by:** —（与 01 并行）

**Status:** ready-for-agent

**Write scope:** `apps/desktop/src/renderer/`（`stores/chat-store.ts` 的 `subscribeSession`、`features/right-panel/schedules-tab.tsx`、`features/sidebar/worktrees.tsx`、`features/conversation/{agents-button,schedules-button,approval-panel,composer}.tsx`、新 hook 文件 `features/conversation/use-reload-on-entry-count.ts`、`settings/mcp-section.tsx` 不改）、`apps/desktop/src/main/{notifications,index}.ts`、`apps/desktop/e2e/subagent-notifications.e2e.test.ts`（新）、就近测试、`packages/ui/src/`（只在占位符样式需要共享组件改动时）、`docs/subsystems/subagents.md` 的"验证"一行（与 01 冲突时由 Lead 合并）

**跨票接口（与 01 定死）：** 01 给 `RunError.code` 增加 `hook_blocked`；本票不依赖它，时间线照常显示 `error.message`，不新增按 code 的文案。本票定义 `subscribeSession(sessionId: string): () => void`：同一 sessionId 多次订阅只建立一次 WS 订阅，最后一个 release 后退订；票 13 的 Team tab 按此使用。本票不改 `apps/server/`、`packages/agent`、`packages/protocol`。

- [x] 现有测试只改期望即通过（逐条写进 Comments）
- [x] **S8** 打开定时任务编辑对话框、提交失败、切到另一个任务再打开：提交状态为初始（Browser Mode）；worktree 移除对话框同样；两个按钮共用 `useReloadOnEntryCount`
- [x] **S9** chat-store 测试：两次订阅一次退订后仍收到事件，第二次退订后不再收到且 WS 发送了 unsubscribe；审批冒泡的组件卸载后子 Session 的订阅被释放（先红）
- [x] **T5** `createNotifier()` 的两个实例互不影响；main 只创建一个；原测试不再依赖前后差值
- [x] **E2E（接收侧）** 真实 Electron 与 Sidecar：后台子代理等待审批时 desktop.jsonl 有 `notification shown { kind: approval-waiting }`，回答后结束时有 `agent-finished`
- [x] **390 px** Browser Mode 在 390 px 视口：占位符元素高度等于一行行高、文本以省略号截断；明暗主题对比度 ≥ 4.5:1
- [x] `check:docs` 通过

## Comments
- 2026-10-31 lead：实施者报告的全量失败（sidecar-jobs.test.ts:289，job_end 缺 signal: SIGTERM）是 apps/server 的间歇性缺陷，与本票无关：#finish 只在进程退出带 signal 时写 signal，进程以退出码 143 结束时就缺。由 m6/fix-job-kill-signal 修复（lead 另起实施者）。本票不用改；若全量只剩这一例失败，照实报告并注明，lead 合入修复后在 main 上复核。
- 2026-10-31 实施者（m6/02-ui-leftovers）：
  - **T5**（f50b47c）。`main/notifications.ts` 改为 `createNotifier(host): { notify, liveCount }`，`live` 是实例字段；`main/index.ts` 只创建一个，notify 控制消息调用 `notifier.notify`。删除 `handleNotify` 与 `liveNotifications`（仓库中没有其他引用）。`notifications.test.ts` 每例创建自己的实例，断言绝对值（不再用前后差值），新增"两个实例各自持有引用，互不影响"。先红：改测试后 5/5 失败（createNotifier is not a function）。
  - **S9**（e305d5d）。`subscribeSession(sessionId): () => void`（跨票接口形状不变）：按会话引用计数，同一会话多次订阅只发一次 WS subscribe；最后一个 release 发 `unsubscribe`、结束等待中的订阅并移除该会话的对话记录（之后的条目被忽略，重连不再订阅它，再次 subscribeSession 从 afterSeq 0 重新订阅）。openSession 与草稿首条消息打开的会话被固定，release 不退订它们。release 幂等。`useChildApproval` 以排序后的 id 作为稳定键，按差集只释放离开的、只订阅新加入的（仍在的不先退订再订阅），卸载时全部释放；`AgentTimeline`（agents-tab.tsx）的 effect 返回 release。chat-store.test.ts 新增 2 例（引用计数与 unsubscribe、打开的会话不被退订），approval-bubbling.browser 新增 1 例（子代理 B 结束 → 只退订 child-b；卸载 → child-a 也退订、对话记录移除）。先红：chat-store 3 例 "is not a function"；冒泡用例在旧实现下 `[]` ≠ `['child-b']`；第一版"cleanup 全部释放再订阅"使仍在的 child-a 被退订，用例失败于 `['child-a','child-b']`，改为差集后通过。
  - **S8**（1afe3a7、ea79a62、6c7ce87）。删除三处镜像状态的 effect：`DeleteScheduleDialog` 与 `RemoveWorktreeDialog` 的 `setSubmitting(false)`，由父组件 `key={x?.id}` 重新挂载（schedules-tab 与 settings/schedules-section 两处调用都加了 key）；`CreateWorktreeDialog` 的打开时重置改为每次从菜单打开时递增的 key（关闭动画期间保持同一实例）。`ScheduleFormDialog` 已经只在 open 时渲染表单，没有镜像 effect，未改。新 hook `features/conversation/use-reload-on-entry-count.ts`：`useReloadOnEntryCount(sessionId, kind | kind[], load)`。规格写的是 `(kind, load)`；hook 要知道看哪个会话，所以加了 sessionId 参数，属于本票内部接口，没有其他票使用。agents-button 用 `['agent_start','agent_end']`，schedules-button 用 `'schedule_fire'`。原 agents 的计数是"记录数 + 已结束数"，等于这两种条目的条目数，行为相同。测试：schedules-tab.browser +2（编辑保存失败后关闭、再编辑另一个：没有上次的错误、字段为该任务、保存可用；删除提交中 Escape 关闭、再删另一个：按钮为 Delete 且可用），新文件 sidebar/worktrees.browser.test.tsx（2：新建失败后取消再打开，名称为空、没有错误；移除提交中关闭确认、再移除另一个，按钮可用），新文件 use-reload-on-entry-count.browser.test.tsx（1）。负向确认：只删 effect、不加 key 时三例都失败（20 s 内等不到初始状态）；hook 计数改为"所有 kind"时失败于 `['s-1','s-1']` ≠ `['s-1']`，effect 依赖去掉计数时失败于 `['s-1']` ≠ `['s-1','s-1']`。（第一版 hook 测试在变异下仍通过：几条条目在同一次渲染中到达；改为每条条目后等渲染再断言。）
  - **E2E 接收侧**（61e6016）。新文件 `apps/desktop/e2e/subagent-notifications.e2e.test.ts`：真实 Electron + Sidecar + faux，后台 general 子代理写文件 → 父会话输入区接管审批 → 允许 → 子代理 completed、out.txt 内容正确；有序退出后读 desktop.jsonl：`notification shown` 依次为 `approval-waiting`、`agent-finished`，sessionId 都是父 Session，标题为 "Subagent is waiting for approval" / "Subagent completed"。断言窗口 `isFocused()` 为 false（后台模式）。负向确认：main 的 notify 处理不调用 notifier 时，用例失败于 `[]`。
  - **390 px**（c3612d4）。原因：`packages/ui` 的 ComposerEditor 占位符为 `absolute left-3`，没有右边界，在约 81 px 宽的编辑区中按词换行（截图为两行 "Give Coko / a task"）。改为 `right-3 left-3 truncate`，加 `data-slot="composer-placeholder"`；全文仍在 aria-placeholder 中。app.browser.test.tsx 新增两例（light / dark，App 在 390×700）：占位符高度等于一行行高、`white-space: nowrap`、`text-overflow: ellipsis`、`overflow: hidden`、确实溢出且不越出编辑区，对比度 ≥ 4.5:1。renderApp 加了可选 theme。先红：修复前两例失败于 2 行。看过明暗两张 390 px 截图：一行 "Give C…"。观察：390 px 下编辑区只有约 81 px，截断后剩很少的字；要显示更多需要给编辑区更多宽度（输入区控件布局），不在本票。
  - **现有测试只改期望**：`notifications.test.ts`（handleNotify → createNotifier，差值 → 绝对值）；`chat-store.test.ts` 的"subscribeSession 订阅子 Session…"（`await done` → 同步断言，返回 release 并释放）。其余现有测试未改，照常通过。
  - **命令与结果**：typecheck 0、lint 0、format:check 0、check:docs 0（207 文件）。相关集：desktop renderer Browser Mode conversation/right-panel/sidebar/settings 32 文件 189 通过；stores 18 文件 98 通过；app.browser 23 通过；packages/ui composer 20 通过、guards 40 通过；E2E subagents、schedules、worktrees、approvals、subagent-notifications 5 文件 8 通过。全量见下条。
  - **全量 `pnpm run test`（取锁）**：本分支两次 test=1，318 文件中 1 个失败，2573 通过、1 跳过；两次都是 `tests/integration/sidecar-jobs.test.ts`「job_kill 使进程组退出…」:289，job_end 有 `status: killed` 与 exitCode，缺 `signal: SIGTERM`。本分支没有改 apps/server、packages/agent、tests/。该文件单独 3/3 通过；自加 12 个 CPU 忙循环再跑该用例 3/3 通过（exitCode 143、signal SIGTERM）。同一 worktree 切到 main（b4d2137）取锁全量 test=0（315 文件、2563 通过、1 跳过）。判断：job_kill 时 shell 以退出码 143 结束而不是被信号终止时，job_end 不带 signal；在全量负载下出现，属于 apps/server 的 jobs / processes（票 01 的范围之外也不在本票）。第三次全量（含 6c7ce87，取锁，开始时负载 9.3）test=0：318 文件全部通过，2575 通过、1 跳过（真实模型），无页面重载、无未处理错误。该 sidecar-jobs 用例在全量负载下不稳定，建议 Lead 另行跟踪。
  - **不适用项**：本票不新增输出通道、读取根或宿主注入的消息种类（通知的 kind 与文本在 M5 已有，本票只在接收侧断言），所以没有新增 secrets-gate 用例与符号链接用例；不新增依赖。
  - **越出 Write scope**：`features/right-panel/agents-tab.tsx`（AgentTimeline 返回 release，否则子时间线的订阅仍不释放）、`features/settings/schedules-section.tsx`（DeleteScheduleDialog 的另一个调用方加 key）、`app/app.browser.test.tsx`（390 px 用例，需要整个 App 的输入区控件才能复现）。都在 `apps/desktop/src/renderer/` 内。`packages/ui/src/composer/composer-editor.tsx` 在"占位符样式需要共享组件改动时"的允许范围内。
  - **文档**：`docs/subsystems/subagents.md` 的"验证"一行补充冒泡用例的订阅释放与新 E2E。没有导航行或导出需要 Lead 合并。
