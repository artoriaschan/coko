---
kind: reference
description: "当前的 Plan Mode 契约：plan 权限模式（判定与 read-only 相同、命令只读沙箱）、进入与退出（/plan、权限选择、Plan chip）与 prior、<plan_mode> 与 <approved_plan> 注入、exit_plan_mode 的校验与审阅（kind plan 的审批、editedPlan 与 mode）、plan 条目、界面（审阅卡、右栏 Plan tab、计划卡）。修改规划模式、计划提交或审阅界面前查阅。"
lifecycle: active
---

# Plan Mode

Plan Mode 让 Agent 先调研与设计、由用户审阅计划后再动手。它是第五种 Permission Mode `plan`（决定见 [ADR 0005](../adr/0005-permission-mode-and-sandbox.md)）：判定与 read-only 相同，命令在只读沙箱中运行；Agent 用 `exit_plan_mode` 提交以 `#` 标题开头的 Markdown 计划，用户批准（可先编辑）后回到进入规划前的模式，或带反馈让它继续规划。模型可调用的"进入规划"工具、计划写入 Workspace 文件与语义化授权不在当前范围。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/planning/` | `<plan_mode>` 与 `<approved_plan>` 文本（`prompt.ts`）；`createExitPlanModeTool(review)`、`PlanReview`、计划校验与模型可见文本（`exit-plan-mode.ts`）；条目派生 `nextPlanRef`、`latestPlan`、`approvedPlanToReinject`（`state.ts`） |
| `packages/agent/src/policy/decide.ts`、`sandbox.ts`、`gate.ts` | plan 的模式放行与沙箱档位；plan-exit 总询问；权限 hook 在询问前提交 proposed 的计划并以 kind plan 等待审阅 |
| `packages/agent/src/session-entries/{planning,permissions}.ts`、`packages/protocol/src/{planning,permissions}.ts` | `plan` 条目、`permission_mode` v2 的 `prior`、`approval_request` 的 kind plan、`AnswerApprovalRequest` 的 `editedPlan` 与 `mode`、`planMarkdownProblem` / `planTitle` |
| `apps/server/src/application/context/plan.ts` | 上下文贡献：plan 模式的 Run 注册 `exit_plan_mode` 并注入 `<plan_mode>`；`<approved_plan>`；`/plan` 动作 |
| `apps/server/src/application/session-permissions.ts` | prior 的记录与恢复、计划审阅（提交 plan 条目、批准时的编辑与模式） |
| `apps/desktop/src/renderer/features/conversation/{plan-review-panel,plan-chip,plan-card,mode-picker,approval-panel}.tsx`、`features/right-panel/plan-tab.tsx` | 审阅卡、Plan chip、计划卡、三项权限菜单、右栏 Plan tab |

## 模式与进入退出

- **判定。** 模式放行与 read-only 相同：Workspace 与额外读取根内的 read 组、context-read、session-state 放行；写入、bash、MCP、memory-write 照常询问。命令沙箱为 read-only，可写根为空，已批准的命令也不能写 Workspace。进入 plan 之前在较宽档位启动的 PTY Job 不接受 `job_input`（见 [PTY 与 stdin](execution.md#pty-与-stdin)）；非 PTY 的后台 Job 已在运行，切换模式不改变它的沙箱。判定顺序与规则不变，见 [权限判定与审批](permissions.md#模式)。
- **进入。** `PUT /api/sessions/:id/permission-mode { mode: 'plan' }` 或 `/plan [消息]`：提交 `permission_mode { mode: 'plan', prior }`，prior 为当时的模式；已处于 plan 时不再提交，prior 不变。`/plan 消息` 在切换后把消息作为普通提交（202 `{ runId }`），没有消息时 204。Shift+Tab 循环不含 plan，从 plan 按 Shift+Tab 回到 read-only。
- **退出。** `/plan off` 与 Plan chip 的 × 回到 prior（没有记录时 default），不在 plan 时不提交；从 plan 选择其他模式即退出，不经审阅。`/plan` 在 Run 进行中以 `run-in-progress` 拒绝（模式菜单与 chip 照常可用）。
- **状态。** `SessionPermissionsResponse` 在 plan 模式时带 `prior`；默认模式（`permissions.defaultMode`）只能是四档之一。分叉复制 `permission_mode` 条目，plan 模式的 Session 分叉后仍为 plan；`plan` 条目不随分叉复制。

## 注入

- plan 模式开始的 Run 注入 system section `<plan_mode>`（只调研与设计、不改动 Workspace、用 exit_plan_mode 提交以 # 标题开头的完整计划），并注册 `exit_plan_mode`（权限类 plan-exit）。section 与工具在 Run 开始时取值：Run 中批准后模式已恢复，本 Run 剩余的请求仍带 `<plan_mode>`；批准的结果写明 plan 模式已结束、忽略之前的 `<plan_mode>`，同一 Run 中再调用 `exit_plan_mode` 时不审阅，直接返回错误结果 `Not in plan mode: …`。
- 最新的 approved 计划早于最后一个有效 compaction 的 `firstKeptSeq`（已被摘要掉）时，之后每个 Run 注入 `<approved_plan>`（正文至多 16 000 字符，超出截断并注明总长度）。与模式无关。section 顺序见 [上下文管理](context.md#压缩后的-approved_plan)。

## 提交与审阅

`exit_plan_mode { plan }`：plan 至多 64 000 字符，去掉开头空白后必须以 `#`–`######` 加空白开头的标题行开始，否则参数错误（`Invalid plan: …`），不提交条目也不询问。权限类 plan-exit 任何模式都询问，允许规则不生效，拒绝规则生效。

条目顺序：

1. `plan { planId, revision, markdown, status: 'proposed' }`：本次规划（最近一次进入 plan 之后）已有未批准的计划时沿用其 planId、revision 加一，否则新 planId、revision 1。
2. `approval_request { kind: 'plan', toolName: 'exit_plan_mode', subject: <标题>, planId, revision, suggestions: [] }`，等待回答。kind plan 的请求不随模式或规则变更重新判定。
3. 回答（`POST /api/sessions/:id/approvals/:requestId`）：
   - 批准 `{ decision: 'allow', editedPlan?, mode? }`：`mode` 缺省为 prior（不在 plan 时为当前模式），可以是 `read-only`、`default` 或 `accept-edits`，不能宽于 prior（顺序 read-only < default < accept-edits < full-access，否则 400），批准只能回到进入规划前的模式或用户选择的较窄模式；`editedPlan` 规则同上；scope 只能是 once。不合格时 400，请求保持等待。之后 `approval_decision` → `tool_exec` → `plan { status: 'approved' }`（editedPlan 与原文不同时 revision 加一）→ `permission_mode { mode }` → toolResult `The user approved the plan. Plan mode has ended: ignore the earlier <plan_mode> instructions. Proceed under <mode>.` 加空行与最终计划，Run 继续。Goal Round 中的审阅使 Goal 进入 waiting-input（`plan-review`），见 [Goal](goal.md#阶段与转换)。 待批准的请求没有对应的审阅记录（propose 总在询问之前登记，正常走不到）时以 500 `internal` 拒绝，不放行、不提交新 revision 的 `plan` 条目。
   - 带反馈拒绝 `{ decision: 'deny', feedback }`：`approval_decision` → `plan { status: 'rejected', feedback }` → 错误结果 `The user did not approve the plan and said:\n<feedback>\n\nKeep planning: …`，Run 继续规划，模式仍为 plan。
   - 无反馈拒绝：`plan { status: 'rejected' }`，其余与普通拒绝相同（本批结束后 aborted）。
   - 停止或暂停：请求 cancelled，计划保持 proposed。
4. `editedPlan` 与 `mode` 用于 kind tool 或 escalation 的请求时 400。

`plan` 条目与审批卡的 subject 入库与推送前替换登记明文（与其他非用户 payload 相同，见 [MCP](mcp.md#secret-的来源) 的按值脱敏）；toolResult 中的计划经 Secret 替换 hook。

## 界面

- **模式菜单**：输入区只列出 default / accept-edits / full-access；plan 时按钮显示 prior，三项均不勾选，任意选择可直接退出。通过 `/plan` 或协议进入计划模式；进入和执行权限不变。
- **Plan chip**：plan 时在权限右侧显示 0.5px × 16px 分隔线与中性的“计划”胶囊。胶囊 H28、圆弧 R14，灯泡与关闭图标共用 24px 槽，hover 或键盘聚焦显示圆形关闭图标，标签位置和右侧至少 12px 内边距不变。关闭按钮有可访问名称和 Tooltip，无快捷键提示。点击后等待协议接受，恢复 prior（缺失时 default），返回编辑区焦点；退出失败保留状态并反馈，文字草稿与其他配置不改变。发送清空编辑器不会关闭计划状态。
- **审阅卡**：kind plan 的待审批请求接管输入区（`data-slot="plan-review"`）：标题、修订、正文预览、"已编辑"标记；主按钮"批准并执行"（标出将恢复的模式，`data-restores`）与下拉"批准并允许编辑"（mode accept-edits；只在将恢复的模式为 full-access、accept-edits 更窄时给出）；"继续规划"展开反馈输入，"发送反馈"为带反馈拒绝；"在右栏查看"打开右栏 Plan tab。新请求出现时自动打开右栏一次（按 requestId，renderer 内存）。右栏中的编辑不合格时不能批准。
- **右栏 Plan tab**：选中修订（缺省最新）的静态 Markdown、修订下拉（每个 planId 每个 revision 一项，最新在前）、状态与拒绝反馈；正在审阅的修订有"编辑"（mono Textarea）与"撤销编辑"。草稿在 renderer 内存，按 Session、planId 与 revision 保存，随批准作为 `editedPlan` 提交。
- **时间线计划卡**（`data-slot="plan-card"`）：标题、修订、状态与反馈；proposed 条目在同一计划有后续条目后不再显示；主会话中点击切到既有右栏 Plan tab；子会话、回退历史及只读上下文中，点击展开当前记录的只读 Markdown 快照，不误开主会话的最新计划。后续修订仅按当前渲染 Session 的条目判断，不读取活动父会话。计划卡沿用对话详情的 13px/20px 字体、R16 轻量表面与 10px/14px 内边距，反馈完整换行。计划审阅仍接管既有输入区，状态机和审批契约不变。

## 验证

- `packages/agent/src/policy/decide.test.ts`：plan × 各工具类型与 read-only 相同、session-state 放行、plan-exit 询问且允许规则不生效、`permission_mode` v1 → v2；`sandbox.test.ts`：plan → read-only。`packages/agent/src/planning/planning.test.ts`：planId / revision 派生、`<approved_plan>` 的判定与截断、计划校验，以及运行时上的审阅闭环（批准、带反馈与无反馈拒绝、参数错误不询问）。
- `tests/integration/sidecar-plan.test.ts`：真实 Sidecar 上 `/plan` 进入与 prior、`<plan_mode>`、写入询问、命令被只读沙箱拒绝（darwin；其他平台 fail-closed）、提交与审阅、回答校验（`mode: full-access` 与宽于 prior 的模式 400）、编辑后批准的新 revision、带反馈继续规划、从 accept-edits 进入后批准回到 accept-edits、批准后同一 Run 的 `exit_plan_mode` 不再审阅、`/plan off`、压缩后的 `<approved_plan>`、分叉。`secrets-gate-plan.test.ts`：plan 条目、审批卡、结果、WS 与 `<approved_plan>` 中没有登记明文。
- `apps/desktop/src/renderer/features/conversation/plan.browser.test.tsx`（审阅卡、只在更窄时给出的"批准并允许编辑"、右栏 Plan tab、chip 与模式菜单在同一文件中依次渲染；共用 setup 断言没有遗留的模态层）；`apps/desktop/e2e/plan.e2e.test.ts`：`/plan` 进入、chip 关闭并从协议读回 prior、提交后右栏自动打开、继续规划、右栏编辑后批准并执行、模式恢复与计划卡。

## 延伸阅读

- [权限判定与审批](permissions.md)：模式表、权限类与审批状态。
- [上下文管理](context.md)：system section 顺序与压缩。
- [ADR 0005](../adr/0005-permission-mode-and-sandbox.md)：模式同时决定审批范围与沙箱档位。
