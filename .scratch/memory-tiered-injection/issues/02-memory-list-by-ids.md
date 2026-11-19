# 02: memory_list 按 id 读取

**What to build:** 模型知道某条记忆的 id 时可以直接读出它的全文。`memory_list` 增加可选参数 `ids`，至多 20 个，返回这些条目的完整条目块，次序与给出的次序相同。只能读取本次 Run 可见的条目（用户级与本 Run 的项目记忆 Workspace）；不存在或不可见的 id 不让整次调用失败，结果在条目块之后列出没有找到的 id。`ids` 与 `query` 只能用其一。子 Session 与 Headless Run 已注册 `memory_list`，同样可用。本票先于摘要层交付，使主分支上不出现“看得到摘要却读不了全文”的中间状态。

**规格场景:** [spec](../spec.md) 的 AC-12、AC-13、AC-14，以及 AC-15 中关于 `ids` 参数的部分；实现决定“按 id 读取”；用户故事 2、23、24。

**文档影响:** [Memory](../../../docs/subsystems/memory.md) 工具与权限一节的 `memory_list` 行与验证一节。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Closed:** true

- [x] AC-12：以 `ids` 调用返回对应条目的完整条目块，格式与现有列表相同（带 id、作用域、来源），次序与给出的次序相同。
- [x] AC-13：`ids` 中混有不存在的 id、属于其他项目的 id 与可见的 id 时，返回可见的条目并列出其余 id 没有找到；全部没有找到时结果只有未找到的说明，不是工具错误。
- [x] AC-14：`ids` 超过 20 个在参数校验阶段失败，不执行；`ids` 与 `query` 同时给出作为工具错误返回，提示二者只能用其一。
- [x] 不属于项目的 Run 中按 id 读取 Workspace 作用域的条目为未找到。
- [x] 子 Session 与 Headless Run 的请求中 `memory_list` 带 `ids` 参数，调用返回全文。
- [x] 工具描述说明可以用 `ids` 读取指定条目的全文；权限类与注册条件不变；结果超长时沿用现有截断。
- [x] 单元测试覆盖次序、未找到、与 `query` 互斥和上限；真实 Sidecar（faux 脚本）用例覆盖可见范围。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-19：用户确认 8 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
- 与 05 都会改 `memory_list`，合并时注意同一处的改动。
- 2026-11-19：已实施（分支 `mem-tiered/t02`）。`packages/agent/src/context/memory/tools.ts` 的 `memory_list` 增加 `ids?`（schema minItems 1、maxItems 20）：经 `MemoryPort.list`（受 scope 限定）取本 Run 可见的条目，按给出的次序输出条目块（重复 id 只列一次），没有找到的 id 在条目块之后列为 `Memory entries not found: a, b.`，全部没找到时只有这一句；与非空 query 同时给出抛 MemoryToolError（空白 query 视同未给出，与现有行为一致）。描述增加 ids 读取全文的说明；权限类、注册条件与截断未改。未改 MemoryPort 与服务端。`ids: []` 为参数错误（minItems 1），规格未写，属实施时补的细节。
  - 测试：单元 `memory.test.ts` 新增 2 例（次序与未找到、互斥/上限/描述）；先跑为红（2 failed），实现后 `pnpm --filter @coko/agent exec vitest run src/context/memory/memory.test.ts` 30 passed。集成新增 `tests/integration/sidecar-memory-ids.test.ts`（项目 Session 可见范围：本项目 + 用户级可读、其他项目与不存在 id 未找到、互斥与 21 个的错误、移出项目后 workspace id 未找到；子 Session 的参数与全文读取），`headless.test.ts` 的记忆用例增加按 id 读取；`sidecar-subagents-harness.ts` 的 `bootAgents` 增加可选 `dirs` 以便预置条目。`pnpm exec vitest run --project integration tests/integration/sidecar-memory-ids.test.ts tests/integration/headless.test.ts tests/integration/sidecar-subagents-permissions.test.ts`：通过（合并后结果见下）。`pnpm run typecheck` 通过；oxfmt / oxlint（改动文件）无问题；`pnpm run check:docs` 0 问题。
  - 文档影响：`docs/subsystems/memory.md` 工具与权限一节的 `memory_list` 行、验证一节（单元说明、新增 sidecar-memory-ids 条目）。
  - 未验证：真实模型是否会主动用 ids 读取（属 AC-31，需凭据）；AC-15 中摘要层部分由摘要层的票覆盖。
