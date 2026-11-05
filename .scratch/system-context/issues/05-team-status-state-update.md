# 05: 团队状态改为 State Update

**What to build:** teammate 的子 Session 中，`<team>` section 只保留自己的名字、lead 与任务板规则，在多个 Run 之间逐字不变；其他成员的状态与任务板上的当前任务以 team State Update 在 teammate 的 Run 开头送达，变化才送。见 [规格](../spec.md) 的“teams section”与“State Update 的内容”。

**User stories:** 3、13、29（团队部分）

**Blocked by:** 01

**Status:** ready-for-agent

- [x] requestLog：teams section 只含名字、lead 与任务板规则
- [x] teammate 的 Run 开头有 team State Update（其他未解散成员的状态、任务板上的当前任务，至多 30 行）；成员状态或任务变化后下一个 Run 送达新值，不变不送
- [x] 同一 teammate 的多个 Run 首次请求 sections 逐字相同
- [x] 任务标题中的已登记 Secret 是标记
- [x] 文档：Agent Teams 的 `<team>` 节；`check:docs` 通过

Closed: true

## Comments

2026-11-05：基于集成分支 `bf5a5e8d` 实现。`<team>` 只含 teammate 身份、lead 与固定任务/消息规则；`TeamService.stateValue` 从根 Session 条目与成员运行状态派生 `{ members, tasks }`，仅 teammate 的上下文贡献 `team` 值。成员不含自己或已解散者，任务保留 id、revision、标题、状态、ready、owner 与依赖；任务描述与写入范围仍通过 task_list 读取。动态值按 01 的配对/规划规则送达，标题在渲染之前已脱敏。浏览器安全的 `entries/team-text.ts` 把正文限制为 30 行（成员行、任务标题行与超出计数也计入），多行任务标题在正文中折为一行。

TDD 接缝沿用规格已确认的真实 Sidecar + faux requestLog。新增 `sidecar-team-state-updates.test.ts` 先因第二轮 system section 携带新增任务、与第一轮不相等而失败，最小实现后通过。该用例连续驱动五个 lead Run 与五个 alice Run，覆盖任务变化送达、值不变不送、另一成员 running 与解散后下一轮送达、全部 sections 逐字稳定、31 项任务的更新正文恰为 30 行、State Update 在团队消息之前、根 Session 没有 team 更新、登记 Secret 在条目和实际 requestLog 中为标记。

验证：`pnpm install --frozen-lockfile` 退出 0。`pnpm run test packages/agent/src/agents/teams/teams.test.ts packages/agent/src/entries/state-updates.test.ts packages/agent/src/entries/entries.test.ts apps/server/src/application/teams.test.ts tests/integration/sidecar-teams.test.ts tests/integration/sidecar-teams-tasks.test.ts tests/integration/secrets-gate-teams.test.ts tests/integration/sidecar-team-state-updates.test.ts`：8 文件、71 例通过；补充 Secret 总闸中真实 `state_update` 值的断言后，`pnpm run test tests/integration/secrets-gate-teams.test.ts`：1 例通过。`pnpm run typecheck`、相关 TS 的 oxlint、`pnpm run check:docs`（360 文件，0 问题）与 `git diff --check` 均退出 0。

文档影响：团队当前契约归 `docs/subsystems/teams.md`，同步上下文管理的团队节；正文与导航仍为 active，路径不变。搜索“其他未解散成员的状态”“任务板的使用要求与当前任务”“<team> section”后修正当前正文和 Secret 用例注释；规格/设计保留目标描述，grilling 与既有已关闭票保留历史。按 AGENTS → docs/README → teams/context 读回，语义、引用方向、生命周期、当前入口与历史保留均通过，无新增目录或反向任务引用。

限制：真实 Provider、提示缓存、Electron UI、构建产物与 CI 未运行；用户已确认真实凭据缺失时按规格记录未验证并继续。本票不触及基础提示默认版本。
