# 02: 界面遗留：S8 / S9 / T5、子代理通知的 Electron E2E、390 px 占位符

**What to build:** 见 [规格](../spec.md)"预构建：界面遗留"：用 `key` 重置对话框代替镜像状态的 effect，"条目计数变化即 load"提成一个 hook（S8）；`subscribeSession` 返回 release 并按引用计数退订，审批冒泡在 cleanup 中释放（S9）；main 的通知模块改为实例（T5）；子代理的 `agent-finished` 与 `approval-waiting` 通知在真实 Electron 中显示（接收侧用例）；390 px 宽时输入区占位符不逐词换行。

**User stories:** 20

**Blocked by:** —（与 01 并行）

**Status:** ready-for-agent

**Write scope:** `apps/desktop/src/renderer/`（`stores/chat-store.ts` 的 `subscribeSession`、`features/right-panel/schedules-tab.tsx`、`features/sidebar/worktrees.tsx`、`features/conversation/{agents-button,schedules-button,approval-panel,composer}.tsx`、新 hook 文件 `features/conversation/use-reload-on-entry-count.ts`、`settings/mcp-section.tsx` 不改）、`apps/desktop/src/main/{notifications,index}.ts`、`apps/desktop/e2e/subagent-notifications.e2e.test.ts`（新）、就近测试、`packages/ui/src/`（只在占位符样式需要共享组件改动时）、`docs/subsystems/subagents.md` 的"验证"一行（与 01 冲突时由 Lead 合并）

**跨票接口（与 01 定死）：** 01 给 `RunError.code` 增加 `hook_blocked`；本票不依赖它，时间线照常显示 `error.message`，不新增按 code 的文案。本票定义 `subscribeSession(sessionId: string): () => void`：同一 sessionId 多次订阅只建立一次 WS 订阅，最后一个 release 后退订；票 13 的 Team tab 按此使用。本票不改 `apps/server/`、`packages/agent`、`packages/protocol`。

- [ ] 现有测试只改期望即通过（逐条写进 Comments）
- [ ] **S8** 打开定时任务编辑对话框、提交失败、切到另一个任务再打开：提交状态为初始（Browser Mode）；worktree 移除对话框同样；两个按钮共用 `useReloadOnEntryCount`
- [ ] **S9** chat-store 测试：两次订阅一次退订后仍收到事件，第二次退订后不再收到且 WS 发送了 unsubscribe；审批冒泡的组件卸载后子 Session 的订阅被释放（先红）
- [ ] **T5** `createNotifier()` 的两个实例互不影响；main 只创建一个；原测试不再依赖前后差值
- [ ] **E2E（接收侧）** 真实 Electron 与 Sidecar：后台子代理等待审批时 desktop.jsonl 有 `notification shown { kind: approval-waiting }`，回答后结束时有 `agent-finished`
- [ ] **390 px** Browser Mode 在 390 px 视口：占位符元素高度等于一行行高、文本以省略号截断；明暗主题对比度 ≥ 4.5:1
- [ ] `check:docs` 通过

## Comments
