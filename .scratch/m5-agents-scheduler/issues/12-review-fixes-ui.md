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
