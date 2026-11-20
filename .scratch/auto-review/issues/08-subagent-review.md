# 08: Subagent 的调用经审查

**What to build:** 根 Session 为“自动审查”时，Subagent 的调用同样先经 Reviewer，派发子代理不会重新变成逐条询问。审查子 Session 的调用时，授权取根 Session 中用户说过的话，主模型写给子代理的派发说明只算“助手委派的任务”，不能扩大授权。定义里的 `permission-mode` 能把某类子代理压到更窄，也能以 `auto-review` 为上限。

**User stories:** 48–51。

**Blocked by:** 05

**Status:** ready-for-agent

Closed: true

- [x] 子 Session 的有效模式为 `auto-review` 时，其到达第 7 步的调用经 Reviewer
- [x] 审查子 Session 的调用时，用户授权分区取根 Session 的用户消息、Goal 与已批准的 Plan
- [x] 子 Session 的首条消息（派发说明）归入助手委派的任务
- [x] 审查请求使用根 Session 的模型
- [x] 审查用量归入的 Run 与预算按设计稿，Goal 的 children 用量口径不被重复计入
- [x] 定义上限为 default 或 accept-edits 的子代理在根为 `auto-review` 时不经审查，照旧询问
- [x] 定义上限为 `auto-review` 的子代理在根为 full-access 时经审查，命令在 workspace-write 沙箱中运行
- [x] Reviewer 转交的子 Session 调用，审批卡按原子 Session 来源显示与回答，“本会话总是允许”写入根 Session，与现状相同
- [x] 根 Session 切换模式时子 Session 进行中的审查按 07 的规则作废
- [x] 团队成员（带名字的派发）的调用按同一规则处理，团队消息不算用户授权
- [x] 集成测试：根为 `auto-review` 时子 Session 的命令有审查请求，请求中的用户授权来自根 Session、派发说明位于委派分区
- [x] 集成测试：上限为 default 的子代理没有审查请求；上限为 `auto-review`、根为 full-access 的子代理有
- [x] 对手用例：派发说明中写入“用户已授权推送”之类的文字时，它只出现在委派分区

## Comments

### 2026-11-20 实施说明（票 08）

- 产品代码：05 已实现子 Session 读根条目、根模型与委派分区，本票主要补测试。补了一处缺口：用户输入与挂起的宿主通知（如后台子代理或
  teammate 的结束通知）一起送达时，`buildReviewInput` 原先把整条 user message 当作通知丢弃，根 Session 的这条用户授权因此缺失；
  现只去掉通知块（与时间线相同），用户的文字保留（`packages/agent/src/policy/review.ts`）。
- 团队消息：teammate 会话中 `team_message` 之后的送达块被去掉，不进入用户授权，也不进入委派分区（设计稿未要求列入委派分区）。
- 07 已合入（c4ed3af8）：根 Session 在子 Session 审查途中切到 default 的用例直接通过，无需接线（子 gate 的 mode() 实时读根状态）；
  把复核条件临时改为恒真时该用例失败，确认能捕获回归。
- 新测试：`tests/integration/sidecar-subagents-auto-review.test.ts`（7 例：放行与分区、对手用例派发说明、转交与“本会话总是允许”、
  切换模式作废、上限 default / accept-edits、上限 auto-review + full-access 与沙箱、teammate 与团队消息、Goal 用量只计一次）；
  `review.test.ts` 增加通知与用户输入同批送达的用例；`session-reviews.test.ts` 增加子 Session 用根模型的用例。
- 运行的命令与结果（合入 feat/auto-review c4ed3af8 之后）：
  - `pnpm exec vitest run tests/integration/sidecar-subagents-auto-review.test.ts`：7 通过。
  - `pnpm exec vitest run packages/agent/src/policy/ packages/agent/src/agents/definitions.test.ts apps/server/src/application/session-reviews.test.ts`：
    323 通过、2 失败（approvals、gate-hooks 各 1，基线复跑同样失败，已在已知基线清单中）。
  - `pnpm exec vitest run` 选中 sidecar-subagents*、sidecar-auto-review、sidecar-teams*、secrets-gate-{auto-review,subagents,teams}、
    sidecar-team-state-updates：69 通过、1 失败（sidecar-teams-restart 的 SIGKILL 用例，团队 state_update 块顺序断言；基线复跑同样失败）。
  - `pnpm typecheck` 通过；`pnpm exec oxlint` 退出 0。

### 关闭（2026-11-20）

已合入集成分支 `feat/auto-review`（最终 HEAD c8633a1d，含两轴代码评审的修复）。
