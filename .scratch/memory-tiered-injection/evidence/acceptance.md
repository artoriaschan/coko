---
kind: evidence
description: "记忆分层注入的联合验收：跨票联合场景、AC-01—AC-32 的证据映射、并行负载下 read ECONNRESET 的诊断与修复、评测用例在 faux 下实际执行的证据、全量测试与基线失败的区分、未验证范围。"
lifecycle: active
---

# 记忆分层注入联合验收

## 验证对象

- 规格与场景：[规格](../spec.md) 的 AC-01 至 AC-32、用户故事 1 至 27。
- 实施票：[08 号票](../issues/08-integrated-acceptance-and-docs.md)；01—07 号票的逐票检查见各票 Comments（均已关闭、验收项全部勾选）。不新增 ADR。
- 基线与目标：集成分支 `feat/memory-tiered-injection` 的 `1d72fee2`（01—07 已合入）；目标为分支 `mem-tiered/t08`，在其上加本票提交（harness 修复、联合场景测试、文档与本记录），提交标识以 Git 记录为准。全部为本地提交，未合入 main、未推送、未发布；CI 未运行。
- 环境：macOS arm64（Darwin 25.4.0）；Node 24.15.0。测试只替换模型服务（faux 脚本），Sidecar、SQLite（含 FTS5）、HTTP / WebSocket 均为真实实现；降级一侧以 `COKO_TEST_NO_FTS=1` 强制。

## 执行记录

| 命令或步骤 | 覆盖场景 | 实际范围与数量 | 结果 | 日志或产物 |
| --- | --- | --- | --- | --- |
| `pnpm vitest run --project integration tests/integration/sidecar-memory-joint.test.ts` | 跨票联合场景（见下） | 1 例 | 通过（约 2.4 秒）；把 `tierMemories` 的候选顺序临时换回 `sortMemories` 后失败于“最早的用户手写条目在正文层”，已恢复。修复等待条件前该例单独约 26 秒、全量负载下 267 秒超时，原因见“联合场景用例的慢” | 本地终端 |
| `pnpm exec vitest run tests/integration/sidecar-memory tests/integration/secrets-gate-memory apps/server/src`（修复前） | ECONNRESET 复现 | 62 文件 299 例，12 次 | 5 次在“每一级内用户来源在前…”失败（`read ECONNRESET`）；另 1 次为无关的 `pty.test.ts` 信号断言 | 本地终端 |
| 同上（修复后） | ECONNRESET 回归 | 62 文件 299 例，6 次 | 6 次全部通过 | 本地终端 |
| `pnpm exec vitest run --project integration tests/integration/sidecar-memory tests/integration/secrets-gate-memory` | 记忆集成全集 | 10 文件 20 例，3 次（修复前） | 3 次全部通过（不加 server 单元的负载时不复现） | 本地终端 |
| `pnpm run eval` | AC-31、AC-32 | 3 文件，46 通过、14 跳过 | 两例在 v1 与 v2 faux 下 `status: completed`、`toolCalls: 2`、`pass: true`；真实模式 `skipped: no-credentials` | `tests/evals/reports/2026-11-19T11-08-40.565Z.json`（git 忽略） |
| `pnpm vitest run --project agent --project session --project server --project protocol --project i18n --project logging --project ui --project desktop --project desktop-renderer --project integration --project scripts`（一次） | 除 Electron E2E 外的全部测试项目 | 478 文件、3 879 例 | 44 文件 82 例失败、3 796 通过、1 跳过：58 例基线同样失败，23 例为负载抖动（同条件重跑通过或基线有同类超时），1 例为联合场景用例自身的问题（已修复） | JSON reporter（未入库） |
| `pnpm run eval`（一次） | AC-31、AC-32 与全部评测 | 3 文件 | 46 通过、14 跳过（真实模式与门槛） | 本地终端 |
| `pnpm run typecheck`、`pnpm run check:docs`、改动文件的 `oxfmt` / `oxlint` | 类型、文档链接、格式 | 全仓 / 改动文件 | 通过 | 本地终端 |

### 跨票联合场景

[`sidecar-memory-joint.test.ts`](../../../tests/integration/sidecar-memory-joint.test.ts) 在同一个数据目录上：

1. 预置 Sidecar（带写入脚本）：用户经接口手写两条（最早的 `Always answer in Chinese` 与 `用户偏好 pnpm 而不是 npm`）；模型经 `memory_write` 写入检索目标 `Run docker compose up before integration tests`、60 条小条目（一条消息中的多个调用）、6 条约 2 000 字符的用户级大条目与 4 条项目级大条目（来源均为 model）。
2. 重启后先取 `GET /api/memories?workspaceId=…` 的 `injection`（设置页此刻看到的汇总），再在项目对话中发送一次。
3. 请求的 Memory 段：两条用户手写的都在正文层，项目级 `P0` 是摘要行，检索目标的 id 不在段内，段末有未放入的条数。
4. 汇总：两组的全文与仅摘要条数等于请求中各作用域的条目块与摘要行数，两组未注入之和等于段末条数，六个数之和等于可见条目总数。
5. 模型 `memory_list { ids: [P0] }` 得到完整条目块；`memory_list { query: "run docker-compose before tests" }` 第一行为 `No exact match…`，结果含检索目标；`memory_write` 新建 `用户偏好使用 pnpm，不要用 npm`，结果列出用户手写那条并注明 `maintained by the user; you cannot change it`；之后列表多一条，原有条目逐字段不变。

### AC 对照

| AC | 证据 |
| --- | --- |
| AC-01 | `memory.test.ts`（没超正文层预算时没有说明与摘要行；按新候选顺序改写的排列用例）；`sidecar-memory.test.ts` 首例 |
| AC-02 | `memory.test.ts` “AC-02、AC-04”；不属于项目的真实 Sidecar：`headless.test.ts` 记忆用例、`sidecar-memory-injection.test.ts` 的独立对话部分、评测 `reads-summarized-memory` |
| AC-03 | `memory.test.ts` “AC-03”；`sidecar-memory-summary.test.ts`（多行与长首行的省略号） |
| AC-04 | `memory.test.ts` “AC-02、AC-04”；`sidecar-memory-summary.test.ts`（未放入数 = 总数 − 两层）；联合场景 |
| AC-05、AC-06 | `memory.test.ts` “AC-05”“AC-06”（恰好 3 000 / 6 000、两向回流）；`sidecar-memory-summary.test.ts`（项目级在前、合计 ≤ 6 000） |
| AC-07、AC-08 | `memory.test.ts`；`sidecar-memory.test.ts` “每一级内用户来源在前…”；联合场景（最早的用户手写条目在正文层） |
| AC-09、AC-10 | `sidecar-memory-summary.test.ts`（伪造标签与来源、`sk-` 凭据只以 `[REDACTED]` 出现）；`memory.test.ts` 对手用例 |
| AC-11 | `memory.test.ts` “AC-11”；`sidecar-memory-summary.test.ts`（写入引导的第一行句子） |
| AC-12 | `sidecar-memory-summary.test.ts`；联合场景 |
| AC-13、AC-14 | `sidecar-memory-ids.test.ts`（不存在与其他项目的 id、21 个为参数错误、与 query 互斥）；`memory.test.ts` |
| AC-15 | `sidecar-memory-ids.test.ts`（子 Session）、`headless.test.ts`（无界面运行） |
| AC-16—AC-21 | `sidecar-memory-similar.test.ts`（FTS5 与 `COKO_TEST_NO_FTS=1` 各一次：Agent / 用户来源的相近条目、没有相近、另一项目不列出、按 id 替换不列出、降级不列出）；`memory.test.ts`；`packages/session` 仓库契约测试；联合场景（中文样例、用户来源） |
| AC-22—AC-26 | `sidecar-memory-approx.test.ts`（两种模式）；联合场景（AC-22） |
| AC-27、AC-28 | `sidecar-memory-injection.test.ts`；联合场景（AC-27） |
| AC-29 | `memory-section.browser.test.tsx`（两组、独立对话、没有条目的组、搜索时隐藏、zh 暗色与 en 亮色的文案与对比度）；真实 Electron 窗口中未检查（见“桌面”） |
| AC-30 | `sidecar-memory.test.ts`（`memory.enabled: false` 时 section 与工具都不在请求中），行为未改 |
| AC-31、AC-32 | `pnpm run eval`（faux 通过，见上）；`tests/evals/case.test.ts` 检查两例的构造；真实模式未运行 |

### 并行负载下的 `read ECONNRESET`

- 现象：06 号票报告“每一级内用户来源在前…”与其他文件并行时偶发 `read ECONNRESET`，单独运行通过、去掉 06 的改动同样失败。
- 复现：只跑记忆集成文件 3 次不复现；加上 `apps/server/src` 的单元测试（与 06 号票相同的命令）后约 40% 复现。
- 探针：在 harness 的 `request` 错误中带上方法、路径、`req.reusedSocket` 与距同端口上一次响应结束的间隔。三次失败都是 `POST /api/sessions`、`reused=true`，一次记录到闲置 6 595 ms。
- 原因：harness 用 Node 默认的全局 Agent（Node 19 起 keep-alive），Sidecar 的 HTTP 服务器使用默认 `keepAliveTimeout`（5 秒）。该用例在第二次 `send` 中模型连续写入 7 条大条目，负载下等待 `run_end` 超过 5 秒，随后的请求复用了服务端正在关闭的连接。01 号票新增的这个用例是等待最长的一个，所以最常触发；产品代码没有问题。
- 修复：`tests/integration/sidecar-harness.ts` 的 `request` 设 `agent: false`，每次请求一个新连接（所有经 harness 的 HTTP 调用共用这一处）。没有加重试。
- 回归：竞争依赖时序，没有确定性的接缝可写回归用例；以修复前后同一命令的运行次数为证（上表：修复前 12 次中 5 次，修复后 6 次中 0 次）。

### 全量测试与基线失败

按负责人转达的用户决定，不运行 Electron E2E（desktop-e2e、desktop-release）。此前两次 `pnpm test` 由负责人终止；此前一次分组运行包含了 desktop-e2e（在收到该决定之前），其结果不作为结论。最终按负责人给出的命令运行一次（见执行记录），再把失败的用例按完整名称与基线 `19e0ac5c`（main，本规格实施前，独立 worktree）比较；基线结果取自同一批文件在基线上的运行，未覆盖的 15 个文件另在基线与目标上依次各跑一次。

| 类别 | 用例 | 文件（项目） |
| --- | --- | --- |
| 基线同样失败（已有） | 58 | agent：`host-stop` ×2、`approvals`、`gate-hooks`、`session-entries`、`instructions/shared`（01 号票报告的 6 例）；protocol：`entries`；integration：`sdk-library`、`sidecar-approvals` ×2、`sidecar-attachments`、`sidecar-hooks-lifecycle`（UserPromptSubmit）、`sidecar-lsp` ×2、`sidecar-recovery`（期望 schema 11、实际 13）、`sidecar-storage`、`sidecar-teams-restart`；desktop：`chat-store-*` 4 例（多出 run-usage 项）、`dev-reload`、`sidecar-process` 1 例；desktop-renderer：`file-tool-details` 5、`terminal-details` 4、`integrated-detail` 1、`timeline-navigation` 1、`plugins-section` 1（`onMenuClose` 不是函数）、`sections` 1、`fetch-models` 9、`model-catalog` 5、`thinking-levels` 4、`delete-provider` 4（后四个文件为 20 秒超时，基线同样超时） |
| 负载抖动 | 23 | integration：`sidecar-incremental-rejection` 3、`sidecar-incremental-tools` 2、`sidecar-request-usage` 3、`sidecar-settings-credentials` 1、`sidecar-hooks-lifecycle` 1（Sidecar 启动 20 秒超时或用例 60 秒超时）；desktop：`sidecar-process` 2（5 秒超时，基线同文件另一例同样超时）；desktop-renderer：`project-form` 2、`right-panel-shortcuts` 1、`collaboration` 1、`live-progress` 1、`model-price` 1、`project-delete` 1（定位超时），`session-move` 2（子菜单几何 7.78 < 8）、`session-row` 1（焦点），`memory-section` 1（见下）。这些在基线上未失败，在目标上同条件重跑时通过（`sidecar-process` 与 `right-panel-shortcuts` 重跑时各有另一例超时，同文件基线也有超时） |
| 本票用例的问题，已修复 | 1 | integration：`sidecar-memory-joint`（见下） |

运行时本机负载在 15 到 28（8 核）。基线已有的 58 例与负载抖动都不在记忆代码中。与记忆有关的只有 `memory-section.browser.test.tsx` 的“搜索框：防抖后检索一次…”一例：负载下输入间隔超过 200 ms 防抖，多发出一次中间查询 `docker swa`；该用例早于本规格，本规格只改了它旁边的 store 复位字段，没有改防抖与检索逻辑；同条件重跑通过。其余记忆相关文件全部通过。

### 联合场景用例的慢

联合场景用例单独运行约 26 秒、全量负载下 267 秒超时，而同一次运行中其他记忆集成用例只要 2 到 9 秒。分段计时：时间都在预置 Run 的等待中（条目的 createdAt 前后只差约 250 ms），等待期间测试进程 20 秒没有响应（每秒一次的计时器一次也没触发），即卡在测试进程自身。预置的 Run 产生约 1 840 条流消息（1 673 条 progress），测试的等待条件每次都重新扫描全部消息求 run_end 数，而 `Stream.waitFor` 每收到一条消息又对全部消息执行一次条件，总开销约为消息数的三次方。改用 harness 的 `isRunEnd`（每个 Session 只发送一次）后单独运行约 2.4 秒；此前为这个用例放宽的等待（150 秒）与用例超时（240 秒）已撤回，改回默认等待与 60 秒。

### 桌面

没有做静默 CDP 检查。`apps/desktop/e2e/memory.e2e.test.ts` 在收到“不运行 Electron E2E”的决定之前的一次分组运行中以后台模式通过（不作为结论），但它覆盖的是 Memory 分区原有的列表、编辑、搜索与开关，没有断言注入汇总（06 号票未改该用例）。不做窗口检查的原因：本机在验收期间负载持续在 15 到 28（8 核，主要来自本票之外的进程），全量运行中 desktop-e2e 与 Browser Mode 有大量超时失败，基线上同样如此，此时的窗口检查不能区分界面问题与负载。AC-29 的证据只有 Browser Mode 用例（真实 Chromium 渲染，覆盖两组、独立对话、没有条目的组、搜索时隐藏、zh 暗色与 en 亮色的文案与对比度）。未验证：真实 Electron 窗口中设置分区的汇总、真实指针与原生层。

### 相近判定对中文的区分度

沿用 04 号票的阈值实验（29 对样例，阈值 0.35）：中文召回 4/6、误报 1/5，英文 4/5、3/4，中英混合 4/5、2/4。三字符片段只反映措辞，**对中文不足以作为相近判定**：换说法的同义句（“用户喜欢简洁的回答”与“回复要尽量简短”比例为 0）找不到，句式相同而事实不同的条目（“用户偏好 yarn”与“用户偏好 pnpm 而不是 npm”为 0.43）会被列出。受影响的是新建时的相近条目（漏报与误报）与 `memory_list` 的近似匹配（同义改写查不到、同句式的其他条目混入）；分层注入、按 id 读取与设置页汇总不受影响。联合场景只验证了一个措辞相近的中文样例。建议：在有真实条目后按同一组样例复核阈值；若中文漏报明显，考虑语义检索（规格范围外）。本项未解决。

## 文档影响

| 行为或正文变化 | 所属文档 | 受影响引用、摘要与入口 | 已完成动作 | 检查结果与缺口 |
| --- | --- | --- | --- | --- |
| 结构入口缺 `tierMemories`、`MEMORY_SUMMARY_BUDGET`、`memoryInjection`；新增联合场景用例 | [Memory](../../../docs/subsystems/memory.md) | 结构入口表、验证段 | 修改 | 已读回 |
| Memory 摘要 | [文档导航](../../../docs/README.md) | Memory 一行 | 补上检索层、用户手写优先、按 id 读取与注入汇总 | 已读回 |
| 上下文、追踪与评测、测试约定 | [上下文管理](../../../docs/subsystems/context.md)、[追踪、审计、导出与评测](../../../docs/subsystems/tracing.md)、[测试约定](../../../docs/tech-stack/testing.md) | 03、07 号票已改 | 核对一致，无需再改 | 正式文档中没有“超出的不注入，只注明条数”“每一级内按更新时间倒序”“检索要求每个词都出现”的旧说法（严格匹配的“全部出现才匹配”仍是当前行为，近似匹配另有一条） |
| 规格状态 | [规格](../spec.md) | frontmatter、实施状态、实施票段 | approved → delivered | 已读回 |

按[生命周期流程](../../../docs/DOCUMENT_LIFECYCLE.md)从 AGENTS.md → docs/README.md → Memory 读回；正式文档不链接 `.scratch/`，`pnpm run check:docs` 通过。

## 结论与限制

- 已满足：AC-01 至 AC-30 有自动化测试证据（主接缝为真实 Sidecar 加 faux 脚本）；AC-31、AC-32 的 faux 模式在 `pnpm run eval` 中实际执行并通过；跨票联合场景有真实 Sidecar 用例，并确认它能在候选顺序退回旧行为时失败。
- 修复：集成测试 harness 的 keep-alive 竞争（`read ECONNRESET`），根因与修复前后的运行次数见上；联合场景用例等待条件的重复扫描。
- 未验证：AC-31、AC-32 的真实模式（本机没有 `COKO_EVAL_PROVIDER_CONFIG` 与凭据，`skipped: no-credentials`），即真实模型是否会按 id 读取摘要层条目、检索落空后是否换说法再查；AC-29 在真实 Electron 窗口中的显示（只有 Browser Mode 证据）、真实指针与原生层；相近判定对中文的区分度不足（见上，未解决）；`reads-summarized-memory` 在第一次全量负载下一次 20 秒超时的具体位置（之后的两次 `pnpm run eval` 均通过）；Electron E2E 按用户决定未运行。
- 失效条件：Memory 段的组成、`tierMemories`、`memory_list` / `memory_write` 的结果文字、相近判定的阈值、`/api/memories` 的汇总或设置分区的改动，需要重跑记忆集成用例、联合场景与 `pnpm run eval`。
- 状态：本地提交在分支 `mem-tiered/t08`，未合入集成分支 `feat/memory-tiered-injection`（由负责人合并），未合入 main、未推送、未发布；CI 未运行。
