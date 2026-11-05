# 04: Goal 进度改为 State Update

**What to build:** Goal 进行中，开头的系统消息只保留 Goal 的定义（目标、约束、成功条件、预算上限与工具说明），在各轮之间逐字不变；revision、阶段与原因、各维度已用量与轮次以 goal State Update 送达。用户在界面里暂停、编辑或取消 Goal 后，下一个 Run 看到新的阶段与 revision；Goal 结束时送一次清空。模型用 State Update 中的 revision 调用 update_goal，不必先调用 get_goal。见 [规格](../spec.md) 的“goal section”与“State Update 的内容”。

**User stories:** 2、7、8、9、10（Goal 部分）

**Blocked by:** 01

**Status:** ready-for-agent

- [x] requestLog：goal section 只含 id、目标、约束、成功条件、预算上限与工具说明；工具说明以最近一条 goal State Update 的 revision 为准
- [x] Goal 连续推进多轮：各轮首次请求的 sections 逐字相同；每轮 user message 开头有 goal State Update（revision、阶段、已用 / 上限、轮次），排在 `<goal_round>` 之前
- [x] 界面暂停、编辑、取消后的下一个 Run 送达新值；完成或取消后送一次清空，goal section 消失
- [x] faux 脚本以 State Update 中的 revision 调用 update_goal 成功
- [x] 重启后 goal State Update 的值与 `GET /api/sessions/:id/goal` 一致（Goal 状态仍从 goal 条目重建）
- [x] 子 Session 没有 goal State Update
- [x] 文档：Goal 的注入节；`check:docs` 通过


Closed: true

## Comments

2026-11-05：已实现 Goal 的稳定定义与动态进度拆分。`goalSection` 只含 id、目标、约束、成功条件、预算上限与工具说明；`goalStateValue` 给出 `{ id, revision, phase, reason?, usage, budget }`，usage 总含 rounds，其余只含已设预算维度。根 Session 的上下文贡献读取真实领域条目和与 GET Goal 相同的累计用量，子 Session 不贡献 goal；终结后由现有规划器送达一次清空。状态仍从 `goal` 条目重建。

TDD：先修改真实 Sidecar 连续两轮的请求断言，观察缺少 goal State Update 的预期失败，然后接通实现后通过。faux 脚本中的 update_goal 使用已送达值中的 revision 1 完成，无 get_goal 调用；两轮首次请求的全部 system sections 相同，动态轮次分别为 1 与 2。新增 Sidecar 场景覆盖 HTTP 暂停、编辑、完成/取消后的下一次送达与单次清空；Goal Round 派发的子 Session 不继承根 Goal 定义或进度；SIGKILL 重启后 paused/restarted 的 State Update 与 GET Goal 的字段和用量一致。

检查：`pnpm install --frozen-lockfile` 退出 0。`pnpm run test packages/agent/src/goals/goals.test.ts packages/agent/src/goals/budget.test.ts packages/agent/src/goals/dimensions.test.ts tests/integration/sidecar-goal.test.ts tests/integration/sidecar-goal-budget.test.ts tests/integration/sidecar-goal-restart.test.ts tests/integration/secrets-gate-goal.test.ts apps/server/src/application/goal-driver.test.ts`：8 文件 238 例通过；`pnpm run typecheck` 退出 0；所改 9 个 TS 文件 oxlint 退出 0。格式检查发现 3 个测试文件的排版并已用 oxfmt 修正。文档检查结果与最终合并后核验见下方补记。

文档影响：Goal 注入/授权/预算说明 → `docs/subsystems/goal.md` 原地更新；压缩后的 Goal → `docs/subsystems/context.md` 区分定义与动态值；公开文本接口 → agent README；上层导航摘要 → docs README。同批修正测试中的旧 `<goal>` 用量行期待，Secret 总闸纳入 state_update 原始持久条目。从 AGENTS → docs README → Goal/context/agent README 读回，生命周期、归属、引用方向、现有入口均保持有效，历史 ADR 与讨论原文保留。

限制：使用 Electron Node 中的真实 Sidecar 与 faux 模型，只验证送达链路和模型可见请求，不证明真实模型按新提示采取行为或提示缓存命中。无真实 Provider 凭据，按用户确认记为未验证；可见 Electron UI、构建产物和 CI 未运行。压缩后补发与 continue 分属 03、02，本票不宣称完成其验收。

最终文档/格式检查：`pnpm run check:docs` 为 360 文件、0 问题；所改 9 个 TS 文件 `oxfmt --check` 通过，`git diff --check` 退出 0。

合并 05 团队状态后：保留 Todo、Goal 与 team 的文档说明；`pnpm run typecheck`、`pnpm run check:docs`（360 文件 0 问题）、`git diff --check` 通过。`pnpm run test packages/agent/src/entries/state-updates.test.ts tests/integration/sidecar-goal.test.ts tests/integration/sidecar-team-state-updates.test.ts` 为 3 文件 23 例通过。
