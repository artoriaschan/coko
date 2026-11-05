# 01: 运行时重建后保留基础提示

**What to build:** 会话的第一条已提交消息是工具声明（只带 toolsAdded 或 toolsRemoved、正文为空的 system 消息）时，重启 Sidecar 或重建运行时之后，发给模型的请求仍以基础提示和本 Run 的 system sections 开头，已提交的工具声明照常回放。现在 pi 只在恢复的对话不以 system 消息开头时插入开头的系统消息，Coko 替换开头系统消息时也跳过这种情况，所以请求会缺少基础提示。工具集在构造运行时与第一个 Run 之间发生变化，第一个 Run 就会把工具声明提交在用户消息之前；现有代码在构造时先放入贡献的工具来避开这种情况，按需加载会让这类变化更常见。这一结论来自读代码，尚未复现：本票先复现，再修复，并留下回归测试。

**规格场景:** [spec](../spec.md) 的 AC-09 依赖本票（重启后的请求仍带基础提示）；对应 TS-14 的恢复前提。

**设计依据:** [design.md](../design.md) 第 6 节“实施时需确认”的第 2 项。

**文档影响:** 修复改变开头系统消息的构成规则时，同步 [上下文管理](../../../docs/subsystems/context.md) 中的相应说明；否则无。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Closed:** true

- [x] 先用测试复现：构造第一条已提交消息为工具声明的会话，重建运行时后发出请求，记录请求缺少基础提示的事实。在产品路径上无法复现时，记录尝试过的路径与原因，并保留 agent 层的复现测试。
- [x] 修复后，上述会话的请求以基础提示与本 Run 的 system sections 开头；已提交的工具声明照常回放，回放得到的工具集与运行时的执行集合一致。
- [x] 恢复的对话不以 system 消息开头时，以及以带正文的 system 消息开头时，行为与修复前相同。
- [x] 回归测试断言实际发给模型的请求，不只检查运行时内部状态；优先使用真实 Sidecar 重启，做不到时在 Comments 说明理由。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05：已实现。`system-message.ts` 在恢复的首条 system 消息仅含工具增减且无正文时，前置不提交的基础提示；本 Run 的 system sections 继续更新这条提示，原工具声明保持顺序回放。带正文的历史 system 消息不变。
- TDD：通过真实 AgentRuntime 的构造、注册工具、Run、提交消息及重建接口，在构造与首次 Run 之间增加 `late_tool`，得到首条已提交 `toolsAdded` 消息。修复前，模型适配器实际收到的首条提示为空（有/无 system sections 两例均失败）；修复后两例通过且真实工具处理函数执行。补充 `toolsRemoved` 的空字符串/空文本块格式（空文本块先红后绿）、无开头 system 和已有正文 system 的兼容行为，共 6 例。
- Sidecar 接缝限制：检查 `session-runs.ts` 的 `#createRuntime` 与每 Run 装配路径，当前产品在构造前先放入贡献工具，HTTP 没有直接提交任意 Session Entry 的入口；没有用写数据库或强制竞态来制造状态。本票因此按验收允许保留 Agent 层的公开运行接口复现，不声称已验证该异常条目下的真实 Sidecar 重启。额外运行现有真实 Sidecar `sidecar-context-seam.test.ts`，验证正常基础提示、环境与工具运行路径。
- 验证：`rtk pnpm run test packages/agent/src/engine/system-message-rebuild.test.ts`：6/6 通过（退出 0）；`rtk pnpm run test tests/integration/sidecar-context-seam.test.ts`：1/1 通过（退出 0）。`rtk pnpm run typecheck` 退出 0；`rtk pnpm run check:docs` 检查 396 个 Markdown、0 个问题（退出 0），`rtk git diff --check` 与定向 oxlint 均退出 0。真实 Provider、桌面窗口、构建产物与 CI 未验证。
- 基线问题：`rtk pnpm run test packages/agent/src/engine/context-seam.test.ts` 原有 7 例中 5 通过、2 失败（退出 1），均为 `RunInput` 中假定 `message:assistant` 排在 `model_request` 前的顺序断言。临时换回 `HEAD` 原版 `system-message.ts` 后同命令仍是同样 2 例失败，已恢复修复文件；本票不修改这些无关断言。
- 文档：在正式 `docs/subsystems/context.md` 的“系统消息与环境”原地说明恢复规则，任务设计同步复现状态；从 AGENTS → 文档导航 → 正文读回，现有归属、引用方向和状态保持有效。
