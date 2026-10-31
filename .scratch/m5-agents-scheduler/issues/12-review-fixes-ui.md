# 12: M5 评审修复（界面）

**Blocked by:** 01–10 与 lead 修复（均已合入）

**Status:** ready-for-agent

输入：[Spec 评审](../review-spec.md)（H1–H9、J1–J10）与 [Standards 评审](../review-standards.md)（H1–H8、L1–L9、T1–T2、S1–S11）。两份重叠项按下表合并；Lead 已接受的偏离（各票 Comments）不要回退。每项（纯文档除外）先写能捕获它的失败测试并确认先红，**每完成一项就提交**。涉及权限、预算或授权的项附对手用例。

**Write scope:** `apps/desktop/src/renderer/`、`apps/desktop/e2e/`、`packages/ui/src/`、`packages/i18n/src/`、相关 `docs/subsystems/*.md` 的界面一节。不改 server 与 agent（票 11）；需要的协议、事件或宿主通知标签常量由票 11 提供，若票 11 尚未合入，先按评审中的约定实现并在票 Comments 写明依赖，合并 main 后对齐。

必须修复：
1. **时间线中的原文气泡（Spec 点名项 = Standards L4）**：`<scheduled_task …>` 与 `<agent-notification …>` 不显示为用户气泡；定时任务的 Run 显示为一行"定时任务 <名字>"（与 schedule_fire 行一致），子代理通知显示为紧凑的通知行。使用票 11 收拢的宿主通知标签常量。
2. **交接停在"正在创建新会话"（Spec H6 = Standards L5 的界面部分）**：收到失败的 handoff 条目或进度时离开 creating，显示错误与重试或关闭（ui.md:34）。
3. **Stop 按钮在主题切换后显示为灰色（Spec / Standards L8）**：确认是否为 outline 按钮的 hover 没有 `@media (hover: hover)` 守卫或 `transition-colors` 过渡；按 ui-design-system.md 修复，并在 Browser Mode 中断言切换主题后的计算颜色。
4. **通知点击打开会话的跨通道用例（Spec J10 的界面部分）**：main → preload → renderer 的 openSession 路径补一个 E2E 或集成用例。
5. **i18n**：票 11 新增的 reason（handed-off）与错误码（worktree-removed 等）的 zh / en 文案。
6. **测试（Standards T2）**：handoff-store.test.ts:70、83 的固定 sleep 改为等待可观察状态。

完成时在评审文件末尾"处理结果"中补本票的项（与票 11 写在同一节，各自标票号）。完成前 git merge main，运行 typecheck、lint、format:check（逐项退出码 0）与取锁的全量 pnpm run test；UI 改动在 Electron 中检查明暗主题与 390 px。

## Comments
- 2026-10-31 lead：已把票 12 提出的三项约定写入票 11 的 Comments，请票 11 按此对齐；合入时由 lead 核对两边一致。
- 2026-10-31 lead：票 11 已在分支 m5/11-review-fixes-runtime 提交 244ba1f，宿主输入标签收为 `packages/agent/src/entries/host-input.ts`，经 `@coko/agent/entries` 导出：`JOB_NOTIFICATION_TAG`（'<job-notification>'）、`AGENT_NOTIFICATION_TAG`（'<agent-notification'）、`HOOK_CONTEXT_TAG`（'<hook-context>'）、`SCHEDULED_TASK_TAG`（**'<scheduled_task'，带 <**，与约定中的 'scheduled_task' 不同）、`HOST_NOTIFICATION_KINDS`、`isHostNotificationText(text)`、`isHostBlockText(text)`（通知或 hook-context，用于时间线过滤）、`hookContextText(ctx)`。旧的 `entries/job-notification.ts` 已删除；`AGENT_NOTIFICATION_TAG` 不再从 agents/index.ts 导出。renderer 的时间线过滤请用 `isHostBlockText`，本地临时常量按上述值写（尤其 SCHEDULED_TASK_TAG 带 <）；票 11 合入后 git merge main 改为导入，删除本地定义。
- 2026-10-31 票 12 实施者：
  - 覆盖：1 时间线宿主输入（59dec7b）；2 交接失败界面（79af322、f2ca434）；3 主题切换的过渡（a8ab471）；4 openSession 跨通道 E2E（ac46b4a）；5 i18n（71ecb45）；6 handoff-store.test.ts 固定 sleep（79af322）；文档 handoff.md、schedules.md、subagents.md 的界面一节（031515a）；两份评审文件末尾"处理结果 / 票 12"。
  - 先红与变异：timeline 2 例先红；handoff-store 失败分支变异后 2 例红；对话框 3 例先红；theme-switch 先红（切换后读到旧主题颜色）；openSession E2E 通道名改错后失败；goal-card 的 handed-off 文案先红。
  - 依赖票 11（合入后对齐）：(a) timeline.ts 的 `AGENT_NOTIFICATION_TAG`、`SCHEDULED_TASK_TAG` 为本地常量（值与 entries/host-input.ts 相同，含 <），改为从 `@coko/agent/entries` 导入并删除本地定义；`JOB_NOTIFICATION_TAG` 与 `HOOK_CONTEXT_TAG` 同样改为导入。agent 通知块按"紧接 agent_notification 条目"判断，不用无位置的 `isHostBlockText`：用户自己输入的同样文本仍显示（对手用例）。(b) 失败的 handoff 条目在 renderer 中经 `Value.Check(SessionEntry)`，协议的 HandoffPayload 收录 `status: 'failed'`、`error` 且 targetSessionId 可省略之前会被丢弃；store 用例以注入条目覆盖，推送用例 `skipIf` 到协议支持为止，届时自动运行。(c) goal-card 用例显式列出 `handed-off`，协议的 GOAL_REASON_CODES 收录后重复无害。
  - 越出写范围：无（`packages/ui/src/lib/theme.ts` 与 index.ts 导出 `applyTheme` 在 packages/ui/src 内）。
  - Electron 检查：运行中的 Stop 在 dark/light 各切换两次后计算背景等于 --primary（截图明暗正常）；390 px 下 scrollWidth 390，暂停与停止可达。未改动的观察：390 px 时输入区占位符逐词换行。
  - 未单独测试：侧栏新建 worktree 会话的 `worktree-removed` 映射（只加一行映射与文案）。
