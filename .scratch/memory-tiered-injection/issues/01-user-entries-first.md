# 01: 注入的候选顺序：用户手写的在前

**What to build:** 用户亲手写的记忆最后才会被挤出正文。Memory 段在每一级（项目级、用户级）内先放来源为用户的条目，再放来源为 Agent 的条目，各自按更新时间倒序；用户编辑过的 Agent 条目来源已是用户，按用户来源参与排序。预算与两级分配规则不变，只有每一级内的候选顺序变了。这个顺序只用于注入：`memory_list` 不带参数时的输出、记忆接口的列表与设置页的列表仍按更新时间倒序。

**规格场景:** [spec](../spec.md) 的 AC-07、AC-08，以及 AC-01 中“每一级内用户来源在前”的部分；实现决定“三层与候选顺序”“正文层”；用户故事 4、5。

**文档影响:** [Memory](../../../docs/subsystems/memory.md) 注入一节的排列与验证一节。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Closed: true

- [x] AC-07：一条很早的用户来源条目与合计超过预算的较新的 Agent 来源条目并存时，用户来源的条目在段内，被挤出的是 Agent 来源中较旧的。
- [x] AC-08：一条 Agent 来源的条目经接口编辑后，在请求的 Memory 段中排在未编辑的 Agent 条目之前。
- [x] 条目没超预算时，段内每一级为用户来源在前、Agent 来源在后，各自按更新时间倒序；项目级仍在用户级之前。
- [x] 两级预算的分配、每一级遇到放不下的条目即停止、未放入条数的注明与现状一致。
- [x] `memory_list` 不带参数的输出、`/api/memories` 的列表与设置页的列表次序不变。
- [x] 现有按更新时间断言段内排列的单元与集成用例按新顺序改写，不保留旧行为的断言；一条真实 Sidecar（faux 脚本）用例确认请求中的实际排列。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-19：用户确认 8 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
- 与 03 都会改 Memory 段的组成；03 排在本票之后。
- 2026-11-19 完成：`packages/agent/src/context/memory/section.ts` 新增并导出 `injectionOrder`（每一级内来源为用户的在前、Agent 在后，各自 updatedAt 倒序；03 的摘要层复用同一顺序），`memorySection` 用它取代 `sortMemories` 作为候选顺序；两级预算、遇到放不下即停止、未放入条数的注明未改。`sortMemories` 仍供 `memory_list` 不带参数的输出使用；`/api/memories` 与设置页的列表走存储层次序，未改动。
  - 单元（`memory.test.ts`）：按更新时间断言段内排列的用例改写为新顺序（两级、混合来源与时间）；新增 AC-07（很早的用户来源条目在段内，省略的是较旧的 Agent 条目，"2 more entries"）；`memory_list` 不带参数时混合来源仍按 updatedAt 倒序。两级预算的既有用例（条目均为同一来源）原样通过。
  - 集成（`tests/integration/sidecar-memory.test.ts`，真实 Sidecar + faux 脚本）：最早的用户手写条目、经接口编辑后来源变为 user 的 Agent 条目、7 条更新的大 Agent 条目 → 请求中的 Memory 段为 `Edited, Always, A6…A2`，注明 2 条未放入（AC-07、AC-08）；同时断言 `/api/memories` 列表仍按 updatedAt 倒序。临时把 `injectionOrder` 换回 `sortMemories` 时该用例失败，确认能区分新旧行为。
  - 实际执行：`vitest run --project agent src/context/memory/` 30 passed；`vitest run apps/server/src/application/context/memory.test.ts` 3 passed；`vitest run --project integration` 的 `sidecar-memory`、`sidecar-memory-projects`、`secrets-gate-memory`、`sidecar-context` 4 文件 13 passed；`pnpm run typecheck` 通过；`pnpm run check:docs` 0 问题；`pnpm run lint` 通过；`pnpm run format:check` 只剩 6 个基线已有的文件（css 与 docs/ui 的 html），本票文件无格式问题。`--project agent` 全量有 6 个失败（host-stop、approvals、gate-hooks、session-entries、shared），在未改动的基线上同样失败，与本票无关，未处理。
  - 文档影响：`docs/subsystems/memory.md` 注入一节写明每一级内用户来源在前、用户编辑过的条目按用户来源排列、此顺序只用于注入；验证一节补充单元与集成用例的覆盖。
