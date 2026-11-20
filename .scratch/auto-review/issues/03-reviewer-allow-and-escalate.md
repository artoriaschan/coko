# 03: Reviewer 放行与转交

**What to build:** 在“自动审查”下，原本要出审批卡的调用先发一次审查请求。Reviewer 放行时调用直接执行，工具卡标出“已由自动审查允许”并可展开查看理由；Reviewer 不放行时出现与现在相同的审批卡。拒绝规则、询问规则、Protected Path、越出可写根、Escalation、计划审阅、Hook 的决定与定时任务的创建都不经 Reviewer。本票的审查输入只含用户消息与待审调用，分区、上限与其余来源在 05 完成；转交理由与失败原因的展示在 04 完成，本票中失败按转交处理并出普通审批卡。

**User stories:** 12–19、21、23、26–37、59、65、66。

**Blocked by:** 02

**Status:** ready-for-agent

- [x] 权限 gate 有 Reviewer 端口；没有端口时行为与 02 交付后相同
- [x] 只在以下条件同时成立时调用 Reviewer：模式为 `auto-review`、最终结论是来自判定第 7 步的询问、PermissionRequest Hook 没有决定、权限类不是 automation
- [x] Reviewer 放行：依次提交审批请求与回答者为 Reviewer、带理由、scope 为 once 的允许决定，不进入等待表，随后执行
- [x] Reviewer 转交或审查失败：出现普通的待审批请求，带原有的建议规则；用户允许、带反馈拒绝、无反馈拒绝的语义与现状相同
- [x] Reviewer 不能使调用被拒绝
- [x] 审批决定条目按设计稿升版（回答者增加 Reviewer、可选理由），旧版本读取正常
- [x] 审查请求使用 Session 当前模型、不带工具、输出上限与超时取自设计稿，系统提示为设计稿中的固定审查提示
- [x] 审查请求记为带 runId、purpose 为 `review` 的模型请求，出现在追踪中
- [x] 审查放行的命令仍在 workspace-write 沙箱中运行
- [x] 同一批的多个调用按现有顺序逐个审查
- [x] 工具卡在 Reviewer 放行后标题行显示“已由自动审查允许”，展开可读理由
- [x] 集成测试（faux 审查应答为放行）：没有等待中的审批请求，条目顺序为请求、Reviewer 的允许决定、执行
- [x] 集成测试（faux 审查应答为转交）：出现待审批请求，允许后执行，拒绝后与现有拒绝语义相同
- [x] 送审范围的集成测试：MCP 工具调用、Workspace 外的读取、带 Worktree 隔离的 Subagent 派发都有审查请求
- [x] 不送审的集成测试：允许规则覆盖的命令、Workspace 内读取、可写根内编辑没有审查请求；`schedule_create` 直接出审批请求
- [x] Hook 顺序的集成测试：PermissionRequest Hook 给出 allow 或 deny 时没有审查请求，没有决定时有；PreToolUse Hook 的强制询问不经审查
- [x] 对手用例（faux 审查应答恒为放行）：拒绝规则拒绝；询问规则、`.git` 内写入、越出可写根的写入、Escalation、计划审阅都出现审批请求，且请求明细日志中没有对应的审查请求
- [x] 对手用例：审查放行的越界写入命令被 Seatbelt 拒绝（darwin；其他平台按现有约定跳过）
- [x] gate 的运行时级测试：端口的放行、转交、抛错三种结果；没有端口时不变
- [x] renderer 的 Browser Mode 测试覆盖工具卡的放行标注与理由

## Comments

- 2026-11-20 实施完成（分支 worktree-agent-a64f97b9666a09c0f，基于 feat/auto-review 28516790）。
  - 端口：`ReviewerPort` / `ReviewRequest` / `ReviewOutcome` / `ReviewFailureCode` 按设计稿第 2 节定义在 `policy/gate.ts` 并经 `@coko/agent` 导出；gate 记录本 Run 的调用（`priorCalls`）、external 工具带描述；`RuntimePermissions.reviewer`、`PermissionRun.runId`、gate 选项 `runId`。
  - gate：调用条件为设计稿第 3 节的六项；放行经 `broker.recordReviewerAllowed`（请求 + `by: reviewer` 的 once 允许带理由）；转交、失败与端口抛错都走现有 `askTool`（请求不带 `review`，属票 04）；signal 中止时不提交审批条目。结果生效前的复核与 `reviewStarted` 未做（票 07）。
  - `policy/review.ts`：固定提示全文、`parseReviewOutput`、`buildReviewInput`（本票只放用户消息与待审调用；分类规则同 `runAuthority`，Run 触发方式取自全部条目以免压缩丢掉 run_start；`UNATTENDED_TRIGGERS` 已导出）。
  - `apps/server/src/application/session-reviews.ts`：根 Session 模型、条目（子 Session 另读根条目）、脱敏、请求前检查（`budget`）、15 秒超时、`model_request { purpose: review, runId }`、解析；在 `SessionService` 构造并交给 `SessionRuns`（不在 `runtime/layers.ts`，见报告）。
  - 条目：`approval_decision` v4（`by` 增加 reviewer、可选 `reason`）；`model_request.purpose` 增加 review（v1 扩展）；追踪 `approvalBy` 增加 reviewer；trajectory 用途名“自动审查 / Auto review”。
  - 界面：工具卡标题行“已由自动审查允许 / Allowed by auto review”，展开在参数之前显示“自动审查理由”与全文。
  - 票 02 的 `sidecar-permissions` auto-review 用例改为以 faux 转交应答驱动（原用例的审查请求会取走下一条对话回复）。
- 运行的验证（darwin）：
  - `pnpm exec vitest run packages/agent/src/policy/gate-review.test.ts packages/agent/src/policy/review.test.ts packages/agent/src/session-entries/session-entries.test.ts`：新增用例全部通过。
  - `pnpm exec vitest run tests/integration/sidecar-auto-review.test.ts`：8/8 通过（含 darwin 的 Seatbelt 用例）。
  - `pnpm exec vitest run tests/integration/{sidecar-permissions,sidecar-hooks,sidecar-plan,sidecar-handoff,sidecar-skills,headless,headless-approvals,sidecar-trace,sidecar-titles}.test.ts`：93/93 通过。
  - `pnpm exec vitest run --project agent --project protocol --project i18n --project server --project desktop`：2389 通过、11 失败；其中 10 个在基线（同文件、恢复为 feat/auto-review 源码）上同样失败，`dev-reload.test.ts` 为负载下偶发，单独复跑 3 次均通过。
  - `pnpm exec vitest run --project desktop-renderer apps/desktop/src/renderer/features/conversation/`：338 通过、9 失败（file-tool-details 5、terminal-details 4），基线上同样 9 个失败；新增的放行标注用例通过。
  - `pnpm typecheck`、`pnpm lint`：通过。

