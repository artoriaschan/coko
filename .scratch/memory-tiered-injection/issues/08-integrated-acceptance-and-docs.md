# 08: 联合验收与文档收尾

**What to build:** 把各票的用户可见行为放在同一份最终代码上验收：条目没超预算时与以前只差每一级内的顺序；超出后依次落到正文层、摘要层与检索层，用户手写的最后才被降级；模型能按 id 读出摘要层的全文、能在换了说法后检索到检索层的条目；新建时得到相近条目的提示而系统不自动改动任何条目；设置页的汇总与模型实际看到的一致。核对各票的文档改动彼此一致，把规格的实施状态更新到实际情况，并如实记录真实模型与中文相近判定中没有验证的部分。

**规格场景:** [spec](../spec.md) 的 AC-01 至 AC-32 联合复核，不替代前置票各自必需的测试；用户故事 1 至 27。

**文档影响:** [Memory](../../../docs/subsystems/memory.md)、[上下文管理](../../../docs/subsystems/context.md)、[追踪、审计、导出与评测](../../../docs/subsystems/tracing.md)、[测试约定](../../../docs/tech-stack/testing.md)的最终一致性；[文档导航](../../../docs/README.md)中 Memory 一行的摘要；本规格的状态。

**Blocked by:** 01 注入的候选顺序：用户手写的在前；02 memory_list 按 id 读取；03 摘要层；04 新建时返回相近条目；05 检索的近似匹配；06 设置页的注入汇总；07 评测：预置记忆与两个用例

**Status:** ready-for-agent

Closed: true

- [x] 逐项确认每张前置票确实交付了所需的行为和契约；票已关闭或局部测试通过，不能当作整份规格已完成。
- [x] 跨票联合场景：项目中预置足以填满三层的条目，其中一条很早的用户手写条目 → 发送后它仍在正文层 → 模型按 id 读出一条摘要层条目的全文 → 用措辞不同的查询找到一条检索层条目 → 新建一条与已有条目相近的记忆，结果列出相近条目 → 设置页两组的汇总与这一 Run 请求中各层的条数一致。
- [x] AC-01 至 AC-32 逐条给出对应的测试或实际操作证据；按[证据模板](../../../docs/templates/evidence.md)记录对象版本、精确命令、结果与限制。
- [ ] 桌面部分按 [UI 调试约定](../../../AGENTS.md)静默验证设置分区的汇总在项目对话与独立对话下、明暗主题下的显示；说明哪些交互在静默 CDP 中验证、哪些因需要真实指针或原生层而未验证。
- [x] 真实模型：有凭据时运行 07 的真实模式并单独报告；没有凭据、未运行或未通过的报告为未验证。
- [x] 相近判定：汇总 04 中阈值样例的结论，写明对中文的区分度是否足够；不足时写明受影响的行为（新建时的相近条目、检索的近似匹配）与建议，不写成已解决。
- [x] 当前行为文档中“超出的不注入，只注明条数”“每一级内按更新时间倒序”“检索要求每个词都出现”等旧说法已改为实现后的行为；各票的文档改动彼此一致；[文档导航](../../../docs/README.md)的摘要同步。
- [x] 规格的 status 与“来源、确认与实施状态”更新为实际交付状态，写规格时补充、未经用户逐条确认的细节如在实施中有改动一并注明。
- [x] `pnpm run check:docs` 通过，并从 AGENTS.md、docs/README 到正文依次读回，核验链接与语义；正式文档不链接任务材料。
- [x] 记录本地验证结果与未覆盖风险，区分已提交、已推送与未发布状态。

## Comments

- 2026-11-19：用户确认 8 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
- 2026-11-19（impl-08）：已实施，分支 `mem-tiered/t08`（基于 `feat/memory-tiered-injection` 的 `1d72fee2`，期间集成分支未变，无需合并）。证据见 [联合证据](../evidence/acceptance.md)。
  - 前置票：01—07 均已关闭、验收项全部勾选，交付内容与各自 Comments 一致；02—06 的头部写作 `**Closed:** true`，01、07 为 `Closed: true`，含义相同，未改。
  - 联合场景：新增 `tests/integration/sidecar-memory-joint.test.ts`（真实 Sidecar + faux），按本票第二项的顺序断言，汇总与请求各层条数一致、合计等于可见条目数；把 `tierMemories` 的候选顺序临时换回 `sortMemories` 时失败（已恢复）。
  - 并行负载下的 `read ECONNRESET`（06 号票报告）：根因是集成 harness 的 HTTP 请求复用 keep-alive 连接，闲置超过 Sidecar 默认 5 秒 `keepAliveTimeout` 后与服务端关闭竞争（探针：`POST /api/sessions`、`reusedSocket=true`、闲置 6 595 ms）。`sidecar-harness.ts` 的 `request` 改为 `agent: false`，没有加重试。同一负载命令修复前 12 次中 5 次失败，修复后 6 次全部通过；产品代码未改。
  - 评测：`pnpm run eval` 3 文件 46 通过、14 跳过；`reads-summarized-memory` 与 `finds-memory-by-search` 在 v1 与 v2 faux 下都实际经 `runCase` 执行（报告中 `status: completed`、`toolCalls: 2`、`pass: true`），不只是加载；真实模式 `skipped: no-credentials`，未验证。
  - 全量（按用户决定不运行 Electron E2E）：`pnpm vitest run --project agent --project session --project server --project protocol --project i18n --project logging --project ui --project desktop --project desktop-renderer --project integration --project scripts` 运行一次：478 文件、3 879 例，44 文件 82 例失败、3 796 通过、1 跳过。按完整名称与基线 `19e0ac5c` 比较：58 例基线同样失败（含 01 号票报告的 agent 6 例），23 例为负载抖动（Sidecar 启动或用例超时、定位超时、几何与焦点；同条件重跑通过），1 例为联合场景用例自身的问题（已修复，见下）；没有新引入的失败。逐文件分类见证据。`pnpm run eval` 运行一次：46 通过、14 跳过。此前两次 `pnpm test` 由负责人终止，一次包含 desktop-e2e 的分组运行早于该决定，不作为结论。
  - 联合场景用例的慢：单独约 26 秒、全量负载下 267 秒超时。原因是测试自身的等待条件每次重扫全部流消息（预置 Run 约 1 840 条），配合 `Stream.waitFor` 对每条新消息重跑条件，测试进程卡住约 20 秒。改用 harness 的 `isRunEnd` 后约 2.4 秒，并撤回此前放宽的等待（150 秒）与用例超时（240 秒），回到默认值与 60 秒；顺序回退的变异检查仍失败。
  - 其他检查：`pnpm run typecheck` 通过；`pnpm run check:docs` 0 个问题；改动的测试文件 `oxfmt --check`、`oxlint` 通过。
  - 未勾选：桌面静默 CDP 检查未做（负责人列为可选，用户决定不运行 Electron E2E）。AC-29 只有 Browser Mode 证据，真实 Electron 窗口中的汇总显示、真实指针与原生层未验证。
  - 相近判定：沿用 04 号票的 29 对样例，三字符片段对中文区分度不足（中文召回 4/6、误报 1/5），新建时的相近条目与近似匹配只能作粗筛；建议有真实条目后复核阈值，未解决。
  - 文档影响：`docs/subsystems/memory.md` 结构入口补 `tierMemories`、`MEMORY_SUMMARY_BUDGET`、`memoryInjection`，验证段补联合场景；`docs/README.md` 的 Memory 摘要补检索层、用户手写优先、按 id 读取与注入汇总；context、tracing、testing 核对一致未改；规格 status approved → delivered，实施状态与实施中补充的细节已写明。
  - 状态：本地提交，未合入集成分支与 main，未推送、未发布；CI 未运行。
- 2026-11-19（review-fix）：按代码评审修正，分支 `mem-tiered/review-fix`（基于 `928e5ba9`），提交 `20fc7379`。不重开本票。
  - 联合场景变慢的根因：不是相近查找。测量：预置 Run 隔离时 20.1 秒（Sidecar CPU profile 56 秒中 54.5 秒空闲，相近查找相关函数合计不到 0.1 秒）；把 `similarNote` 临时短路后预置仍为 56 秒（负载 24—38）。真正的开销在测试一侧：`send` 的等待谓词忽略传入的消息、每次都重算 `stream.entries(sessionId)`，而 `Stream` 每收到一条消息就对全部消息跑一遍谓词，预置 Run 有 1 833 条消息，等待本身是立方级。改为只看当前消息（`isRunEnd` 且不在发送前已有的集合中）后预置 0.3 秒、整例 2.4 秒；与其余 12 个记忆集成文件并行时 4.6 秒。恢复默认期限：去掉 150 秒等待与 240 秒用例超时，等待用 harness 默认 20 秒、用例用集成项目默认 60 秒。集成分支同时在 `83cfff23` 独立得出同一结论；合并时联合场景取本分支的版本（改用共享的 `sendAndWaitRun`），证据文件取集成分支的版本。
  - 同一谓词写法在本规格新增的 injection、ids、similar、approx、summary 中也有：收进 `sidecar-harness.ts` 的 `openSession` 与 `sendAndWaitRun`（另加 `toolCall`），各文件改用；记忆专用的 `tiersOf`、`omittedOf`、`memorySection`、`LoggedMessage` 与 `ftsModes` 移到新的 `tests/integration/sidecar-memory-harness.ts`。本规格之前已有的同类重复（sidecar-memory、-search、-projects 等）未动。
  - 用户故事 15：`similarNote` 中 `port.similar` 的失败改为不列出相近条目，保存结果照常返回；新增单元测试（先失败于 `database is locked`，修复后通过）。`memory_list` 拆为 `listByIds`、`listByQuery`、`listAll` 与共用的 `listResult`，行为不变（44 个单元测试与 ids、approx 集成测试通过）。
  - 评测：去掉预置记忆的 `scope` 字段（运行器只建用户级，没有读取方），case.test 删去对应的一行，tracing 文档同步。
  - keep-alive（`agent: false`）没有加确定性回归：Node 24 的全局 Agent 按服务端 `Keep-Alive: timeout=5` 提前 1 秒丢弃空闲连接；在独立进程的服务端上把客户端事件循环同步阻塞 5.3 秒后再请求，修复前后都成功，竞争窗口只在连接被关闭的瞬间，无法在约 7 秒内稳定复现。推测之前的 ECONNRESET 也与上述立方级等待阻塞测试进程的事件循环有关；`agent: false` 保留。
  - 检查：`pnpm run typecheck` 通过；`pnpm run check:docs` 0 个问题；改动的 TS 文件 `oxfmt --check`、`oxlint` 通过；记忆单元测试（agent、server、session 的 memory 与 evals case.test）95 例通过；记忆集成 13 文件 36 例通过（joint、injection、similar、approx、ids、summary、sidecar-memory、-search、-projects、secrets-gate-memory 两个、headless）；`pnpm run eval` 3 文件 45 通过、14 跳过（真实模式 no-credentials）。未跑全量与 e2e。
  - 文档影响：`docs/subsystems/memory.md` 的 memory_write 行与单元测试说明补“查找相近条目失败时结果不变”；`docs/subsystems/tracing.md` 的 `memories?` 去掉 `scope`。
