# 06: Goal、定时任务与预算

**What to build:** 审查的花费看得见、管得住：审查请求的 Token 与费用计入所属 Run 的用量和 Goal Budget；Goal Budget 耗尽后不再发出审查请求，改为问用户。Goal Round 与定时任务的 Run 在“自动审查”下同样经审查，被转交的调用照常等用户。

**User stories:** 52–56。

**Blocked by:** 03

**Status:** ready-for-agent

Closed: true

- [x] 审查请求的用量计入该 Run 的用量汇总与 Session 的费用合计
- [x] 审查请求的 Token 与费用计入 Goal Budget，不计入 Goal 的轮次与工具调用数
- [x] 发出审查请求前经与对话请求相同的请求前检查
- [x] 检查不通过时不发审查请求，出现带预算代码的待审批请求；Run 之后按现有规则因预算暂停
- [x] 失败与被取消的审查请求中已报告的用量同样计入
- [x] Goal Round 在该模式下：Reviewer 放行的调用执行；被转交的调用等待用户，Goal 的等待状态与现有审批等待相同
- [x] 定时任务的 Run 在该模式下经审查；定时 Run 中 `schedule_create` 的现有限制不变
- [x] 集成测试：带 Token 或费用上限的 Goal 中，审查请求的用量使预算读数增加；预算耗尽后请求明细日志中没有新的审查请求
- [x] 集成测试：Goal Round 中被转交的调用使 Session 进入等待审批，允许后 Goal 继续
- [x] 集成测试：定时任务触发的 Run 中未被规则覆盖的命令有审查请求

## Comments

- 2026-11-20 实施（基于 feat/auto-review 32c2e00f）：票 03 已把请求前检查接到审查请求，本票补验证，并补了一处缺口：取消或超时的审查请求原先按零用量记录（与 Provider 的结果竞速时丢弃了部分响应），现在按最后一次部分响应记已报告的用量（`session-reviews.ts`）。
  - 测试：`tests/integration/sidecar-auto-review.test.ts` 新增“Goal、定时任务与预算”三例（带 Token 上限且有价格的 Goal：失败审查的用量计入 Goal Token 与费用、追踪的 Run 与 Session 合计，不计轮次与工具调用；耗尽后无新审查请求、待审批请求出现且调用未执行、允许后执行并以 paused + budget_exhausted 结束；Goal Round 的放行与转交、awaiting-approval 且 Goal 仍 running、允许后 complete；定时 Run 的审查请求、user_messages 为空、schedule_create 不送审且允许后仍为 schedule-not-allowed）；新增 `apps/server/src/application/session-reviews.test.ts`（取消、超时两例）。
  - 未断言：预算失败的待审批请求上的 `review: { outcome: 'failed', code: 'budget' }`（依赖票 04 的 approval_request v2），留给票 10 补齐。
  - 运行：`pnpm exec vitest run tests/integration/sidecar-auto-review.test.ts apps/server/src/application/session-reviews.test.ts` 2 文件 13 例全部通过；`pnpm typecheck` 通过；`pnpm lint` 通过。突变检查：把审查的 beforeRequest 换成恒放行时预算用例失败（审查请求为 2 条）。

### 关闭（2026-11-20）

已合入集成分支 `feat/auto-review`（最终 HEAD c8633a1d，含两轴代码评审的修复）。
