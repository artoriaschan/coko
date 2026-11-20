# 05: 审阅卡上查看并切换执行权限

**What to build:** 用户审阅计划时能看到批准后将以哪个 Permission Mode 执行，并能在审阅卡上直接改。批准后同一个 Run 立刻继续，这是用户在执行开始前收紧或放宽权限的唯一时机。见 [规格](../spec.md) 的“阶段一：界面”。

**User stories:** 23、24

**Blocked by:** 04

**Status:** ready-for-agent

Closed: true

- [x] 审阅卡标出当前的 Permission Mode，作为批准后的执行权限
- [x] 审阅卡内放入现有的模式菜单组件，不另做一套；选择“完全访问权限”仍先确认风险
- [x] 审阅等待期间切换 Permission Mode 后批准：后续调用按新模式判定（Sidecar 集成测试，分别覆盖收紧与放宽）
- [x] 审阅等待期间切换模式不使计划的审批请求消失或重新判定
- [x] 切换失败时审阅卡保留原显示并提示，审批请求仍可回答
- [x] 右栏编辑不合格时不能批准的规则不变
- [x] renderer 浏览器测试覆盖显示、切换与风险确认；共用 setup 对遗留模态层的断言照常通过
- [x] 文档：Plan Mode 的界面节与桌面工作台；`pnpm run check:docs` 通过

## Comments

### 2026-11-20 实施完成（未关闭）

- **交付。** renderer：`PlanReviewPanel` 增加 `permissionMode` 与 `onPermissionModeChange`，两者都给出时在按钮行左侧显示 `role="group"`（名称 `plan.review.permission`，“执行权限” / “Runs with”）与现有 `ModePicker`（同一组件，未改动；选择完全访问权限仍先经 `PermissionRiskDialog` 确认），回答发出后菜单禁用；`approval-panel.tsx` 的 `PlanApproval` 从 chat store 取 `pendingMode ?? sessionPermissionMode(entries)` 与现有 `setPermissionMode`，与输入区的模式菜单同一来源与动作，因此失败时撤回为原模式并经现有失败通道提示（`permissions` → “权限设置没有保存”）。i18n：`plan.review.permission`。服务端无改动：审阅等待中切换模式后批准按新模式判定、kind plan 不重新判定的行为票 04 已具备，本票补集成测试。
- **测试。** `plan.browser.test.tsx` 新增 `plan-review-permission`（经 `ApprovalPanel` 渲染，fixture chat）3 例：标出执行权限并切换、模式条目到达后审阅仍在且批准不带 mode；完全访问权限先确认风险（取消不切换、确认后切换）；切换失败保留原显示且仍可批准。用例都等菜单与对话框关闭后结束，共用 setup 对遗留模态层的断言照常通过。`tests/integration/sidecar-plan.test.ts` 新增 2 例（共用 `approveAfterSwitch`；放宽 default → accept-edits：批准后写入不询问；收紧 accept-edits → default：批准后写入询问），都断言切换后没有 `approval_decision`、仍在规划中、批准 204、T7 结果、同一个 Run 继续、文件写入。新增测试在接线前先跑过：浏览器 3 例因找不到卡上的模式菜单失败；集成 2 例在接线前即通过（服务端行为来自票 04，属验收用例）。
- **与设计稿的偏离。** 设计稿“各票主要触及的文件”列出 `conversation-pane.tsx` 与 `mode-picker.tsx`，实际都未改：审阅卡由 `PlanApproval`（已从 store 读取条目与回答动作）直接取模式与切换动作，`ModePicker` 原样复用。失败“提示”沿用现有失败通道的 Toast，浏览器用例只断言卡片撤回为原模式且仍可回答（fixture chat 不接 `onFailure`），报告失败由 `chat-store-permissions.test.ts` 现有用例覆盖。
- **文档。** `docs/subsystems/plan-mode.md`（描述、界面节的审阅卡、验证节）；`docs/subsystems/workbench.md`（输入区接管段落）。

### 验证（2026-11-20）

- `pnpm run typecheck` 通过；`pnpm run check:docs` 通过（436 个文件 0 个问题）。
- renderer Browser Mode：`pnpm exec vitest run --project desktop-renderer apps/desktop/src/renderer/features/conversation/{plan,business-timeline,approval-panel}.browser.test.tsx`：3 个文件 36 例通过（`plan.browser.test.tsx` 18 例）。
- 集成与单元：`pnpm exec vitest run packages/i18n apps/desktop/src/renderer/stores/chat-store-permissions.test.ts tests/integration/sidecar-plan.test.ts`：4 个文件 32 例通过（`sidecar-plan` 10 例，含新增 2 例，真实 Sidecar，darwin）。
- 视觉：在 Browser Mode 中临时截图检查了亮色、暗色、390px 宽与菜单展开（截图代码已撤回）；窄宽度下“批准并执行”换到下一行（flex-wrap），未在真实 Electron 中检查。
- 未运行：Electron E2E（`apps/desktop/e2e/plan.e2e.test.ts`，属票 08）；真实指针与原生层未验证；非 darwin 平台。

### 关闭（2026-11-20）

已合入集成分支 `feat/plan-lifecycle`（最终 HEAD ecfcbde8，含代码审查修复）。
