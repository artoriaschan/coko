# 07: 注入预算分两级

**What to build:** 记忆较多时，当前项目的事实不会被大量个人偏好挤出上下文。条目合计上限仍是 12 000 字符：先按更新时间倒序放入项目级条目，至多 6 000 字符；再放用户级条目，至多为总上限减去项目级已用的部分；用户级放完还有余量时，继续放入尚未放入的项目级条目。段内项目级在前、用户级在后。有条目没放入时，段末注明未放入的总条数并提示用 `memory_list` 的 `query` 检索。没有项目记忆的 Run 里，用户级条目可以用满 12 000 字符。

**规格场景:** [spec](../spec.md) 的 AC-21 至 AC-24；实现决定“注入预算”与“Memory 段”中关于排列的一条；用户故事 26、27。

**文档影响:** [Memory](../../../docs/subsystems/memory.md) 注入一节的预算与排列。

**Blocked by:** 03 Memory 段：声明、来源标注与写入引导

**Status:** ready-for-agent

Closed: true

- [x] AC-21：项目级与用户级条目各自合计都超过 6 000 字符时，段内项目级条目不超过 6 000 字符、全部条目不超过 12 000 字符，段末注明未放入的总条数。
- [x] AC-22：项目级合计 2 000 字符、用户级合计超过 12 000 字符时，项目级全部在段内，用户级用到约 10 000 字符。
- [x] AC-23：项目级合计超过 12 000 字符、用户级只有 1 000 字符时，用户级全部在段内，项目级用到约 11 000 字符。
- [x] AC-24：没有项目记忆的 Run 中，用户级合计超过 12 000 字符时用到约 12 000 字符。
- [x] 每一级内遇到放不下的条目即停止，不跳过较新的去放较旧的；每条按含标签与一个换行计。
- [x] 段内项目级在前、用户级在后，各自按更新时间倒序；声明与写入引导不计入条目预算。
- [x] 预算分配由单元测试覆盖上述四种情形与边界（恰好等于上限、单条超过一级上限）；一条真实 Sidecar（faux 脚本）用例确认请求中的实际排列与未放入条数。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-19：用户确认 9 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
- 与 05 没有依赖，可以并行；两票都会改 Memory 段的组成，合并时注意同一处的改动。
- 2026-11-19：实施完成。`memorySection`（packages/agent/src/context/memory/section.ts）按两级分配预算：项目级（workspace 条目）先占至多一半（6 000），用户级至多预算减项目级已用，用户级全部放入后余量再给剩余的项目级；每级遇到放不下即停；段内项目级在前。用户级未全部放入时余量不给项目级（否则 AC-21 的“项目级不超过 6 000”会被突破）。没有项目记忆时自然没有 workspace 条目，用户级用满 12 000；未改 server 端的归属与传参（留给 05）。
  - 检查：`pnpm exec vitest run packages/agent/src/context/memory/memory.test.ts`（28 通过，含 AC-21~24、恰好等于上限、不跳过较新、用户级未放完时余量不给项目级、单条超过项目级上限；把第三步改为无条件执行时“余量不给项目级”用例失败，已撤销）；`pnpm exec vitest run tests/integration/sidecar-memory.test.ts tests/integration/sidecar-memory-search.test.ts tests/integration/secrets-gate-memory.test.ts tests/integration/secrets-gate-memory-search.test.ts tests/integration/sidecar-context-seam.test.ts`（5 文件 9 用例通过，新增真实 Sidecar faux 用例确认请求中的排列 P3 P2 P1 U3 U2 U1 与“2 more entries”）；`apps/server/src/application/context/memory.test.ts`、`sidecar-delete-project`、`sidecar-config` 通过；`pnpm run typecheck` 通过；oxlint、oxfmt --check 对改动文件通过。未跑全量。
  - 原集成用例“新的在前：用户级更晚写入时在前”与新排列冲突，改为项目级在前。
  - 文档影响：docs/subsystems/memory.md 注入一节改写预算与排列，测试清单同步。
