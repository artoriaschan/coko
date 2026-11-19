# 05: 检索的近似匹配

**What to build:** Agent 换一种说法检索时仍能找到相近的记忆。`memory_list` 带 `query` 时先做现有的严格匹配（每个词都出现），有结果时行为不变；严格匹配为空时，用查询文本查找相近的条目，至多 20 条，结果第一行注明没有完全匹配、以下是相近的条目；仍然没有时返回现有的“没有匹配”文字。`scope` 参数对近似匹配同样生效。记忆接口的 `query` 不变，仍只做严格匹配，设置页的搜索框因此保持精确。运行时没有 FTS5 时不放宽。

**规格场景:** [spec](../spec.md) 的 AC-22 至 AC-26；实现决定“检索的近似匹配”；用户故事 18、19、20、25。

**文档影响:** [Memory](../../../docs/subsystems/memory.md) 的检索、工具与权限（`memory_list` 的 `query` 说明）与验证各节。

**Blocked by:** 04 新建时返回相近条目

**Status:** ready-for-agent

**Closed:** true

- [x] AC-22：库中有一条条目，模型用措辞不同、严格匹配为空的 `query` 检索时，结果第一行注明没有完全匹配，随后是该条目的条目块。
- [x] AC-23：`query` 的严格匹配有结果时，结果与现状相同，没有近似匹配的说明。
- [x] AC-24：既没有严格匹配也没有相近条目时，返回现有的“没有匹配”文字。
- [x] AC-25：AC-22 的同一个查询经 `/api/memories?query=` 请求返回空列表。
- [x] AC-26：运行时没有 FTS5 时，AC-22 的检索返回现有的“没有匹配”文字。
- [x] 近似匹配至多 20 条，按相近程度排序；给出 `scope` 时只在该作用域内查找；可见范围与严格匹配相同，其他项目的条目不出现。
- [x] 工具描述说明没有完全匹配时会返回相近的条目；查询中的 FTS 语法字符仍按字面处理（沿用现有对手用例）。
- [x] 真实 Sidecar 用例在 FTS5 与强制降级下各跑一次，沿用现有记忆检索用例的写法。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-19：用户确认 8 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
- 与 02 都会改 `memory_list`，合并时注意同一处的改动。
- 2026-11-19（impl-05）：已实施，分支 `mem-tiered/t05`。
  - 实现：`packages/agent/src/context/memory/tools.ts` 的 `memory_list` 在 query 分支中，`port.search` 为空时调用票 04 的 `port.similar(query, { scope?, limit: 20 })`（同一可见范围、同一 scope，没有新增相似度路径），有结果时第一行为 `No exact match for "<query>"; showing similar entries instead:`、空一行后是条目块；仍为空时返回原有 `No memories match "<query>".`。严格匹配有结果时不调用 similar。ids 分支未动。工具描述加一句没有完全匹配时返回并标注相近条目。MemoryPort、服务端与 `/api/memories` 未改（AC-25 由此成立）；没有 FTS5 时 similar 为空数组，故不放宽（AC-26）。
  - 测试：单元 `memory.test.ts` 新增 1 例（退回相近条目与说明、保持端口次序、scope 与 limit 20 透传、严格匹配有结果时不查找、描述），先红后绿。集成新增 `tests/integration/sidecar-memory-approx.test.ts`（FTS5 与 `COKO_TEST_NO_FTS=1` 各一次）：查询 `run docker-compose before tests` 对条目 “Run docker compose up before integration tests” 片段比例 0.83（另一条目 0.28），严格匹配因 `docker-compose` 不出现而为空；覆盖 AC-22 至 AC-26、scope、另一项目的条目不出现（对照：在该项目 Session 中出现）、含 `NEAR(`、引号、星号的查询按字面。撤掉实现后该集成用例 FTS5 一例失败（已确认不是空过）。
  - 检查：`pnpm exec vitest run packages/agent/src/context/memory apps/server/src/application/context` 7 个文件 62 个用例通过；`pnpm exec vitest run --project integration tests/integration/sidecar-memory-approx.test.ts tests/integration/sidecar-memory-search.test.ts tests/integration/sidecar-memory-similar.test.ts tests/integration/sidecar-memory-ids.test.ts tests/integration/secrets-gate-memory-search.test.ts` 9 个用例通过；`pnpm run typecheck` 通过；`pnpm run check:docs` 0 个问题；改动文件 `oxlint` 退出码 0、`oxfmt --check` 通过。
  - 文档影响：`docs/subsystems/memory.md` 的检索（新增“近似匹配”一条，相近查找的用途）、工具与权限（`memory_list` 的 query 与描述）、验证（memory.test.ts 说明、新增 sidecar-memory-approx 条目）与 frontmatter 描述；`docs/README.md` 的 Memory 导航摘要。
  - 未验证：近似匹配沿用票 04 的三字符片段判定，中文换说法的同义查询仍会找不到、句式相同的其他条目可能混入（见票 04 Comments），未在真实条目与真实模型上复核；未运行 Desktop E2E（工具卡与 details 未改）。
