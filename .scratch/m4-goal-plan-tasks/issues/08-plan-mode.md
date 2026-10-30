# 08: Plan Mode：plan 权限模式、exit_plan_mode 与审阅、恢复进入前的模式

**What to build:** 见 [规格](../spec.md) "Plan Mode"一节与 [ADR 0005](../../../docs/adr/0005-permission-mode-and-sandbox.md)："PermissionMode 增加 `plan`"（protocol 与 agent，判定的模式放行与 read-only 相同、沙箱 read-only）；`permission_mode` v2 的 `prior`；`approval_request` / `approval_decision` 的 `plan` kind 与 `editedPlan`、`mode`；agent `planning/`（`<plan_mode>` 与 `<approved_plan>` 文本、exit_plan_mode 校验、回答的条目序列）；`plan` 条目；server `context/plan.ts`（`/plan` 与 `/plan off` 动作、工具注册、system sections）、`session-permissions.ts`（prior 的记录与恢复、plan 审批的回答）；renderer：模式菜单"规划"（Shift+Tab 不含）、Plan chip（composer 槽）、右栏 Plan tab（`tabs.ts` 的 plan 一行）、审阅接管 composer、时间线计划卡。

**User stories:** 7, 8, 9

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/planning/`、`packages/agent/src/policy/{decide,gate,sandbox}.ts`、`packages/agent/src/session-entries/{planning,permissions}.ts`、`packages/protocol/src/{planning,permissions}.ts`、`apps/server/src/application/context/plan.ts`、`apps/server/src/application/session-permissions.ts`、`apps/desktop/src/renderer/features/conversation/{plan-chip,plan-card,plan-review-panel（新）,mode-picker,approval-panel}.tsx`、`features/right-panel/{plan-tab.tsx（新）,tabs.ts（plan 一行）}`、`packages/i18n/src/dictionaries/domains/plan.ts`、`tests/integration/{sidecar-plan,secrets-gate-plan}.test.ts`（新）、`apps/desktop/src/renderer/**/plan*.browser.test.tsx`（新）、`apps/desktop/e2e/plan.e2e.test.ts`（新）、`docs/subsystems/plan-mode.md`（新）、`docs/subsystems/permissions.md`、`docs/subsystems/context.md`（`<approved_plan>` 一段）、`docs/adr/0005-permission-mode-and-sandbox.md`

- [ ] `decide.test.ts`：plan × 各工具类型与 read-only 相同；plan-exit 在 plan 中询问；`permission_mode` v1 读回为 v2
- [ ] 集成：`/plan 调研 X` → permission_mode plan（prior = default）→ requestLog 含 `<plan_mode>` 与 exit_plan_mode → write 出现审批、bash 写 Workspace 被 Seatbelt 拒绝 → exit_plan_mode → plan proposed + approval_request kind plan
- [ ] 集成：带 editedPlan 批准 → plan approved（新 revision）、permission_mode default、toolResult 含编辑后的文本、Run 继续；带反馈拒绝 → plan rejected 与反馈、Run 继续；`mode: full-access` 400；`/plan off` 回到 prior；从 accept-edits 进入后批准回到 accept-edits
- [ ] 集成：压缩把已批准计划摘要掉后，requestLog 含 `<approved_plan>`；分叉 plan 模式的 Session 时新 Session 仍为 plan（permission_mode 被复制），但没有 plan 条目
- [ ] 秘密总闸 `secrets-gate-plan.test.ts`：计划含登记 Secret 时 plan 条目、审批卡 payload、WS 与 requestLog（含 `<approved_plan>`）中没有明文
- [ ] E2E：模式菜单选"规划"、Plan chip 出现且 × 退出；提交计划后右栏自动打开一次；在右栏编辑后"批准并执行"，模式恢复且时间线有计划卡；"继续规划"带反馈
- [ ] 不适用项：本票不读取文件（Comments 写明）
- [ ] plan-mode.md 建立并可达（导航行写在 Comments）；permissions.md 写 plan 模式、plan-exit 与审批 kind；ADR 0005 补实施记录；`check:docs` 通过

## Comments
