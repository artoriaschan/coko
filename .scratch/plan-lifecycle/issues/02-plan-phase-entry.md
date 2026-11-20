# 02: 计划阶段成为“是否在规划”的唯一来源

**What to build:** 预重构，用户可见行为不变。新增记录 Session 计划阶段的条目；现有的进入、退出与批准路径在改变 Permission Mode 的同时记录计划阶段；提交工具的注册、`<plan_mode>` 的注入、“调用时是否仍在规划”与“本次规划的起点”改为读取计划阶段。经协议可以读到 Session 的计划阶段与活动的 Plan。完成后，后面的票可以逐步把约束和入口从 `plan` 模式上挪走，每一步全仓保持通过。见 [规格](../spec.md) 的“两个阶段共用的数据形状”与设计稿（01 票产出）。

**User stories:** 20（读取部分）；支撑 22、30

**Blocked by:** 01

**Status:** ready-for-agent

Closed: true

- [x] 新增计划阶段条目，payload 含“无”“规划中”“执行中”（带 planId）；agent 与 protocol 两侧 schema 编译期比对一致；renderer 收到新 kind 不报错
- [x] `plan` 条目的 schema 增加已完成（带完成报告）与已放弃两个状态；现有条目照常读取，本票不写入这两个状态
- [x] 现有每条进入路径（切换接口设为 `plan`、`/plan`、首次发送带 `plan`）提交“规划中”；已在规划中时不重复提交
- [x] 现有每条退出路径（`/plan off`、Plan chip、从 `plan` 选择其他模式、批准计划）提交“无”；不在规划中时不提交
- [x] `exit_plan_mode` 的注册、`<plan_mode>` 的注入、调用时“是否仍在规划”、planId 与 revision 的派生起点都读取计划阶段；faux 请求日志中的 section、工具集与条目顺序同改动前（新增的计划阶段条目除外）
- [x] 分叉与交接：源在规划中时，新 Session 同时得到 `plan` 模式与“规划中”的计划阶段，两者一致
- [x] 计划阶段的回放口径本票与 Permission Mode 相同，回退行为不变（改为跟随回退在 06）
- [x] Session 计划接口的读取：返回当前阶段与活动的 Plan（规划中且有待审阅的计划时为它，否则为空）；未知 Session 的错误码与同类接口一致
- [x] 审计序列包含计划阶段的转换
- [x] 现有 Plan Mode 的集成测试、判定测试、界面测试与端到端用例不改断言即通过；新增断言覆盖阶段读回、条目顺序与分叉后的阶段
- [x] 确认会话数据诊断的类型筛选是否需要处理新 kind
- [x] 已知的过渡状态：升级前已停在 `plan` 模式的 Session 没有计划阶段条目，本票之后它不再注入 `<plan_mode>`，判定仍按 `plan` 模式；由 07 的读取迁移收尾。写入本票的评论
- [x] 文档：Plan Mode 当前行为文档补充计划阶段条目与读取接口，协议与包 README 中的条目清单同步；`pnpm run check:docs` 通过

## Comments

### 2026-11-20 实施完成（未关闭）

- **交付。** `plan_phase` v1 与 `plan` v2（agent `session-entries/planning.ts`、protocol `planning.ts`，`entry-payloads.ts` 编译期比对通过）；浏览器安全的 `planPhaseOf` / `activePlanOf`（`packages/agent/src/entries/plan-phase.ts`，经 `@coko/agent/entries` 导出）；`nextPlanRef` 以 `plan_phase { planning }` 为起点，completed / abandoned 之后新建 planId；`SessionPermissions` 的状态增加 `phase`（按原始条目回放，与 Permission Mode 同一口径），`setMode` 进入时在 `permission_mode` 之后提交 `planning`、退出时在 `permission_mode` 之前提交 `none`，已在该阶段时不提交；`SessionService.create` 以 `plan` 创建时（含首次发送）补提交 `planning`；批准沿用 `setMode`，顺序为 approved → `plan_phase none` → `permission_mode` → 工具结果；`PlanHost.mode` 改为 `phase`，`exit_plan_mode` 注册、`<plan_mode>` 注入与 `PlanReview.active()` 读计划阶段；`GET /api/sessions/:id/plan`（`routes/plans.ts`，`SessionPlanResponse`、`planPaths`）；审计 `plan_phase` 事件；分叉按过渡口径（与被复制的 `permission_mode` 同一范围）追加 `plan_phase { planning }`，交接在源当前规划中时追加。
- **会话数据诊断的类型筛选。** 已核对 `session-diagnostics/type-filter.ts`：按类型字符串包含匹配、类型来自已加载条目，新 kind 自动可筛，不需要处理。
- **与设计稿的偏离。**
  1. i18n `plan.status.completed` / `plan.status.abandoned`（中英，文字照设计稿 §11.3）提前在本票加入：renderer 的计划卡与 Plan 页以 `plan.status.${status}` 取文案，`PlanStatus` 扩大后不加键则 `tsc -b` 失败。票 10、11 不需要再加这两个键。
  2. `PlanActionRequest` 未在本票加入协议（读取在 02、动作在 04，按 §8.1 的分票留给 04）。
  3. `planPhaseOf` / `activePlanOf` 返回 `entries/plan-phase.ts` 内定义的结构类型 `PlanPhaseState` / `PlanState`（与 `plan_phase`、`plan` v2 同形），不导入 `session-entries/`：`@coko/agent/entries` 的导入守卫不允许 entries/ 依赖它。
  4. `session-entries.test.ts` 的 kind 清单在基线上缺 `tool_load`（基线即失败），本票顺带补上。
  5. 审计事件同步写入 `docs/subsystems/tracing.md` 的审计表（设计稿的文档列未列出）。
- **验证。** `pnpm run typecheck` 通过；`pnpm exec vitest run` 选中的单元测试 10 个文件 155 例通过（planning、session-entries、fork、handoff、observability/trace、entries、server session-permissions、protocol readme、i18n 两个）；集成测试 7 个文件 25 例通过（sidecar-plan、secrets-gate-plan、sidecar-handoff、sidecar-permissions、sidecar-trace、sidecar-state-update-fork、sidecar-subagents-permissions）；Browser Mode `plan.browser.test.tsx` 15 例通过；`pnpm run check:docs` 通过。Electron E2E（`apps/desktop/e2e/plan.e2e.test.ts`）未运行。

### 过渡状态（02 → 07）

升级前已停在 `plan` 模式的 Session 没有 `plan_phase` 条目：本票之后它的 Run 不再注入 `<plan_mode>`、不注册 `exit_plan_mode`（`exit_plan_mode` 调用返回 `Not in plan mode: …`），判定仍按 `plan` 模式（与 read-only 相同）。对它再执行 `/plan` 或切换接口设为 `plan` 时只补提交 `plan_phase { planning }`（模式已是 plan，不提交 `permission_mode`），之后恢复规划。由票 07 的读取迁移收尾。

### 关闭（2026-11-20）

已合入集成分支 `feat/plan-lifecycle`（最终 HEAD ecfcbde8，含代码审查修复）。
