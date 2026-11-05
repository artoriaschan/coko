# 02: continue 时送达 State Update

**What to build:** 用户继续一个暂停或中断的 Run 时，如果之后状态有变化，模型先看到一条只含 State Update 块的 user message，再接着做；没有变化时 continue 与现在相同。这条消息不算用户的输入。见 [规格](../spec.md)“何时送达”中的 continue，以及 [设计](../design.md)“Run 开始”中 continue 的处理。

**User stories:** 21、28

**Blocked by:** 01

**Status:** ready-for-agent

- [x] Sidecar 集成测试（faux）：Run 在写过 Todo 后暂停；continue 先提交 `state_update` 条目与只含块的 user message，第一次请求的最后一条消息是它
- [x] 没有要送达的项：continue 的 requestLog 与条目与现在相同
- [x] 继续一个 Goal Round 的 Run：只含块的 user message 不使授权变为 user
- [x] 时间线：只含块的 user message 不成气泡
- [x] 以工具结果结尾与以 user message 结尾的 Run 在 faux 下都能继续；真实 Provider 是否验证写入 Comments
- [x] 文档：上下文管理中 continue 的送达；`check:docs` 通过


Closed: true

## Comments

2026-11-05：基于集成分支 b2408675 实施，已合入后续 Goal 与压缩实现（集成 b5c92fda）。continue 仍校验上一 Run 为 paused/interrupted 且末尾为 user/toolResult；在 Run 开始调用 stateUpdates，变化时先提交状态条目、再以只含块的 user message 调用 prompt，没有变化时沿用 agent.continue，不增加消息或条目。只含配对 State Update 的输入不升级 Goal 工具授权，也不在 Run 结束时唤醒 waiting-input；混合消息中的真实用户原文继续按原有规则处理。

TDD：新增真实 Sidecar 场景首先因 continue 缺少 state_update/user 条目失败，实现后通过；Goal Round 的纯状态 continue 随后复现 waiting-input 被误唤醒为 running（revision 3），增加按条目配对和内容判断的唤醒守卫后通过。新 3 例覆盖工具结果末尾的 Todo 变化、无变化不新增消息、Goal Round 的 pause 工具被拒、waiting-input 不被宿主状态唤醒，以及 UserPromptSubmit Hook 在首次请求前暂停后、UI 编辑 Goal，继续请求在原 user message 后追加状态 user message。工具交叠使用 release 文件屏障，Goal 结束判定通过共享锁下的拒绝过期动作等待，不靠固定 sleep。

验证命令与范围：

- `pnpm install --frozen-lockfile`：退出 0。
- `pnpm run test tests/integration/sidecar-state-update-continue.test.ts tests/integration/sidecar-compaction.test.ts packages/agent/src/engine/run-control.test.ts packages/agent/src/engine/state-updates.test.ts apps/server/src/application/goals-wake.test.ts apps/desktop/src/renderer/features/conversation/timeline.test.ts`：首轮 6 文件 49 例，45 通过、4 失败。4 个失败均为 run-control 的旧 model_request/assistant 顺序预期；父代理在集成 b5c92fda 复现同样的 4 失败/7 通过。只修正该文件完整顺序预期（model_request 先提交），保留请求与工具结果断言后，`pnpm run test packages/agent/src/engine/run-control.test.ts`：11 例通过。其余 5 文件 38 例通过，包含纯状态消息不成时间线气泡的既有派生接缝。
- `pnpm run test tests/integration/sidecar-goal.test.ts`：13 例通过，确认正常用户提交仍唤醒 Goal，既有 Goal 与授权行为保持成立。
- 最后一次屏障调整后 `pnpm run test tests/integration/sidecar-state-update-continue.test.ts`：3 例通过。上述相关集合合计 7 文件 62 例通过。
- `pnpm run typecheck`、`pnpm run check:docs`：退出 0；文档检查 360 文件、0 问题。相关 4 个 TS 文件 oxlint 与 oxfmt --check 通过；`git diff --check` 退出 0。

文档影响：continue 的当前装配与消息位置 → `docs/subsystems/context.md` 原地增加；waiting-input 的唤醒例外 → `docs/subsystems/goal.md` 同步；运行时 continue 与 stateUpdates 接缝 → `packages/agent/README.md` 同步。搜索这些正文与 recovery/headless、规格和票中的 continue/State Update 消费者，recovery/headless 的通用说明仍准确，无需改动；从 AGENTS → docs/README → 正文读回，路径、语义、归属、引用方向、生命周期、当前入口与历史保留均通过，无导航新入口需要补充。

限制：测试在真实 Sidecar（Electron 内置 Node）上以 faux 模型验证 user→user 与 toolResult→user 的请求链路，未验证三种真实 Provider 协议。按用户选择，无真实凭据时继续实现并明确未验证；未启动可见 Electron、未跑产物或 CI，不声称真实模型或 UI 验收通过。
