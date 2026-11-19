# 03: 摘要层

**What to build:** 超出正文预算的记忆不再从 Agent 眼前消失。正文层放不下的条目降为一行摘要：带 id、作用域、来源，以及正文第一个非空行截到 60 字符；第一行被截断或正文还有后续内容时以省略号结尾，单行且不超过 60 字符的完整显示。摘要层前有一句固定说明，告诉模型需要全文时用 `memory_list` 的 `ids` 读取。摘要层有独立的 6 000 字符预算，按与正文层相同的规则分两级（项目级先放至多 3 000，余量回流）。摘要也放不下的条目才只在段末计数。写入引导增加一句“把第一行写成能单独看懂的一句话”。条目没超正文预算时，段内没有摘要层与它的说明。

**规格场景:** [spec](../spec.md) 的 AC-01 至 AC-06、AC-09、AC-10、AC-11、AC-15、AC-30；实现决定“三层与候选顺序”“摘要层”“写入引导”；用户故事 1、3、6 至 13、23、24、26。

**文档影响:** [Memory](../../../docs/subsystems/memory.md) 的注入、工具与权限（`memory_list` 的描述）与验证各节及其 frontmatter 摘要；[上下文管理](../../../docs/subsystems/context.md)中上下文用量如有关于 Memory 段长度的说明则同步。

**Blocked by:** 01 注入的候选顺序：用户手写的在前；02 memory_list 按 id 读取

**Status:** ready-for-agent

**Closed:** true

- [x] AC-01：可见条目没超正文层预算时，段内没有摘要层说明与摘要行。
- [x] AC-02：不属于项目的 Session，用户级条目合计超过 12 000 字符时，正文层之后出现说明与摘要行；每行带 id、作用域、来源与不超过 60 字符的第一行；摘要行合计不超过 6 000 字符，正文层仍不超过 12 000 字符。
- [x] AC-03：正文多行、首行超过 60 字符的摘要以省略号结尾；单行且不超过 60 字符的完整显示、没有省略号；截断不落在代理对中间。
- [x] AC-04：摘要层也放不下时，段末注明的条数等于可见条目总数减去正文层与摘要层的条数，并提示用 `query` 检索。
- [x] AC-05、AC-06：项目 Session 中摘要层项目级在前且不超过 3 000 字符；项目级摘要少时用户级用到剩余额度，项目级多而用户级少时余量给项目级；没有项目级候选时用户级可用满 6 000。
- [x] 摘要层从正文层没放入的第一条接着取，沿用 01 的候选顺序；每一级遇到放不下的即停止。
- [x] AC-09：摘要行中的结束标签被转义，正文第一行里伪造的开始标签与来源标注不改变段的结构与其他条目的来源（对手用例）。
- [x] AC-10：保存时含凭据形态文本的条目落在摘要层时，请求中只有脱敏后的文本。
- [x] AC-11：写入引导含“第一行写成能单独看懂的一句话”；有无摘要行两种情况下固定文本各自逐字不变，说明与引导不计入任何一层的预算。
- [x] AC-15：子 Session 与 Headless Run 的请求中同样有摘要层，没有写入引导。
- [x] AC-30：记忆开关关闭时请求中没有 Memory 段与记忆工具。
- [x] 单元测试覆盖两层各自的两级分配与边界（恰好等于上限、单条放不下、余量回流）与摘要的截断；一条真实 Sidecar（faux 脚本）用例确认请求中各层的实际排列，并在同一用例中按 id 读出摘要层条目的全文。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-19：用户确认 8 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
- 分层的结果（每条落在哪一层）需要能被 06 的汇总复用，实现时让它可以单独取得，而不只是拼进段的文本。
- 2026-11-19：已实施（分支 `mem-tiered/t03`）。`packages/agent/src/context/memory/section.ts`：新增 `tierMemories(entries)`，返回 `{ full, summary, omitted }`（每层的条目，项目级在前），供 06 的汇总复用；两层共用 `fillTier`（与原正文层相同的两级分配，按 cost 计），摘要层从每一级正文层没放入的第一条接着取，预算 `MEMORY_SUMMARY_BUDGET = 6000`。摘要行 `formatMemorySummary`：`<summary id scope source>摘要</summary>`，摘要复用 04 的 `memorySummary`（合并时统一为一个函数），结束标签按正文相同方式转义（转义集合增加 `</summary>`）。`memorySection` 据此排列：正文层、说明 `The entries below show only their first line (… marks that the entry has more); to read an entry in full, call memory_list with its id in ids.`、摘要行、`N more entries not shown…`（N 为检索层条数）。写入引导增加 `Make the first line of each memory a sentence that makes sense on its own: when there are many entries, only the first line is shown.`。去掉了 `memorySection` 未被使用的 `budget` 参数。服务端调用不变。
  - 实施时补的细节（规格未写）：摘要行的标签名为 `<summary>`（与正文层的 `<entry>` 区分）；第一行去掉首尾空白；说明文字的措辞。
  - 测试：单元 `memory.test.ts` 先红（17 failed）后绿；原按“省略”断言的用例改为断言降为摘要的条目；新增摘要层用例（AC-01、AC-02/04 的排列与 `tierMemories` 计数、AC-05 恰好 3 000/6 000、AC-06 两向回流、遇到放不下即停止、AC-03 截断/省略号/首个非空行/代理对、AC-09 对手用例、AC-11）。集成新增 `tests/integration/sidecar-memory-summary.test.ts`（项目 Session 请求中各层排列、摘要行格式、伪造标签、`sk-` 凭据只以 `[REDACTED]` 出现、未放入数=总数减两层，同一用例中按 id 读出摘要层条目全文）；`sidecar-memory-ids.test.ts` 的子 Session 用例与 `headless.test.ts` 的记忆用例改为目标条目落在摘要层，断言段内有说明与摘要行并按 id 读出全文（AC-15）；`sidecar-memory.test.ts` 两条预算用例改为断言摘要行。AC-30 由既有 `sidecar-memory.test.ts` 的 `memory.enabled: false` 用例覆盖，行为未改。
  - 实际执行（合并 `feat/memory-tiered-injection` 后）：`pnpm --filter @coko/agent exec vitest run src/context/memory/` 42 passed；`pnpm exec vitest run apps/server/src/application/context/memory.test.ts` 3 passed；`pnpm exec vitest run --project integration` 的 sidecar-memory-summary、sidecar-memory、sidecar-memory-ids、headless、sidecar-memory-projects、secrets-gate-memory(-search)、sidecar-memory-search、sidecar-memory-similar、sidecar-context、sidecar-subagents-permissions 共 11 文件 40 passed；`pnpm run typecheck` 通过；`pnpm run check:docs` 0 问题；改动文件 oxfmt / oxlint 无问题。未跑 `--project agent` 全量与全量集成。
  - 文档影响：`docs/subsystems/memory.md` frontmatter、注入（正文层 / 摘要层 / 检索层、写入引导的新句子、`tierMemories`）、工具与权限（`memory_list` 描述）、验证；`docs/subsystems/context.md` 系统消息一节提及摘要层；`docs/README.md` Memory 一行摘要。
  - 未验证：真实模型是否会读摘要后按 id 取全文（AC-31，需凭据）。
