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
| `pnpm exec vitest run --project integration tests/integration/sidecar-memory-joint.test.ts` | 跨票联合场景（见下） | 1 例 | 通过（约 26 秒）；把 `tierMemories` 的候选顺序临时换回 `sortMemories` 后失败于“最早的用户手写条目在正文层”，已恢复。第一次全量运行中该例在 66.7 秒失败（预置的 Run 超过当时 60 秒的等待），之后把用户级大条目也放进一条消息、等待放宽到 150 秒，在负载下的记忆集成命令 2 次与重跑中均通过 | 本地终端 |
| `pnpm exec vitest run tests/integration/sidecar-memory tests/integration/secrets-gate-memory apps/server/src`（修复前） | ECONNRESET 复现 | 62 文件 299 例，12 次 | 5 次在“每一级内用户来源在前…”失败（`read ECONNRESET`）；另 1 次为无关的 `pty.test.ts` 信号断言 | 本地终端 |
| 同上（修复后） | ECONNRESET 回归 | 62 文件 299 例，6 次 | 6 次全部通过 | 本地终端 |
| `pnpm exec vitest run --project integration tests/integration/sidecar-memory tests/integration/secrets-gate-memory` | 记忆集成全集 | 10 文件 20 例，3 次（修复前） | 3 次全部通过（不加 server 单元的负载时不复现） | 本地终端 |
| `pnpm run eval` | AC-31、AC-32 | 3 文件，46 通过、14 跳过 | 两例在 v1 与 v2 faux 下 `status: completed`、`toolCalls: 2`、`pass: true`；真实模式 `skipped: no-credentials` | `tests/evals/reports/2026-11-19T11-08-40.565Z.json`（git 忽略） |
| `pnpm test`（两次） | 全量 | 全部项目 | 两次都被外部 SIGTERM 终止（退出码 143），没有汇总，见“全量测试与基线失败” | 本地终端 |
| `pnpm exec vitest run --project agent --project desktop --project evals --project i18n --project integration --project logging --project protocol --project server --project session --project ui --project scripts --project desktop-release` | 全量的非浏览器部分 | 392 文件、3 216 例 | 21 失败、3 180 通过、15 跳过；21 例都在基线上同样失败 | JSON reporter（未入库） |
| `pnpm exec vitest run --project ui-browser --project desktop-renderer --project desktop-e2e` | 全量的浏览器与 E2E 部分 | 184 文件、949 例 | 67 失败、881 通过、1 跳过；62 例在基线重跑中同样失败，另 4 例补跑基线同样失败，`reading-position.e2e` 1 例在目标上重跑 2 次均通过 | JSON reporter（未入库） |
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

第一次全量 `pnpm test`（约 40 分钟）在结束时被 SIGTERM（退出码 143），vitest 没有输出汇总与错误详情，来源未查明；输出中有 58 个文件含失败。为区分基线，把这 58 个文件在目标（`mem-tiered/t08`）与基线 `19e0ac5c`（main 上本规格开始实施前，独立 worktree `coko-wt/base08`）上依次各跑一次，用 JSON reporter 比较失败用例的完整名称：

| 运行 | 文件 | 用例 |
| --- | --- | --- |
| 目标 | 58 个：48 失败、10 通过 | 95 失败、316 通过、15 跳过 |
| 基线（不含新增的 `sidecar-memory-joint`） | 57 个：50 失败、7 通过 | 97 失败、309 通过、11 跳过 |

- 两边都失败的 84 例：基线上同样失败，不是本规格引入的。包括 01 号票报告的 `--project agent` 6 例（`host-stop` ×2、`approvals`、`gate-hooks`、`session-entries`、`instructions/shared`），以及 desktop-e2e、Browser Mode（settings 的 models / fetch-models / model-catalog / thinking-levels / delete-provider 等）、desktop 主进程与 store、`protocol/entries`、`sdk-library`、`sidecar-approvals`、`sidecar-storage`、`sidecar-teams-restart` 等。
- 只在目标上失败的 11 例：`sidecar-process.test.ts` 6 例 `Test timed out in 5000ms`，`sidecar-hooks-lifecycle`、`sidecar-lsp`、`sidecar-project-permissions`、`sidecar-recovery` 各 1 例 `Timed out waiting for ready`（Sidecar 启动超时），`app-frame.browser.test.tsx` 1 例拖拽时的宽度动画断言。都是超时或动画时序，同一文件中另有用例只在基线上失败（基线独有 13 例，同样是超时与时序），判断为负载造成的抖动；都不在记忆相关代码中。
- 记忆相关：`sidecar-memory-joint` 与 `evals.test.ts` 在第一次全量中失败（前者见上；后者是候选提示 v2 下的 `reads-summarized-memory`，在 20.1 秒时失败，与 harness 的 20 秒默认等待吻合，没有错误详情），在目标的重跑中都通过。`reads-summarized-memory` 的预置多一次 Sidecar 启动与停止，负载下更容易碰到 20 秒的启动等待；未单独复现，未改。

第二次全量（带 JSON reporter）约 10 分钟后在 desktop-renderer 阶段再次被 SIGTERM，终止点与第一次不同，判断来自套件之外（已告知负责人，来源未查明）。于是把全部项目分两组运行（命令见执行记录），合计 576 个文件、4 165 例：88 失败、4 061 通过、16 跳过。88 例逐条按完整名称与基线比对：87 例在基线上同样失败（非浏览器组 21 例、浏览器与 E2E 组 62 例来自基线重跑，另 4 例为补跑基线确认），`reading-position.e2e` 1 例在目标上重跑 2 次均通过（负载抖动），没有只在目标上稳定失败的用例。两组中记忆相关的文件（全部 `sidecar-memory*`、`secrets-gate-memory*`、`headless`、`evals`、`memory-section.browser`、`memory-store`）都通过。

### 桌面

没有做静默 CDP 检查。`apps/desktop/e2e/memory.e2e.test.ts` 在浏览器与 E2E 组中以后台模式运行并通过，但它覆盖的是 Memory 分区原有的列表、编辑、搜索与开关，没有断言注入汇总（06 号票未改该用例）。不做窗口检查的原因：本机在验收期间负载持续在 15 到 28（8 核，主要来自本票之外的进程），全量运行中 desktop-e2e 与 Browser Mode 有大量超时失败，基线上同样如此，此时的窗口检查不能区分界面问题与负载。AC-29 的证据只有 Browser Mode 用例（真实 Chromium 渲染，覆盖两组、独立对话、没有条目的组、搜索时隐藏、zh 暗色与 en 亮色的文案与对比度）。未验证：真实 Electron 窗口中设置分区的汇总、真实指针与原生层。

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
- 修复：集成测试 harness 的 keep-alive 竞争（`read ECONNRESET`），根因与修复前后的运行次数见上。
- 未验证：AC-31、AC-32 的真实模式（本机没有 `COKO_EVAL_PROVIDER_CONFIG` 与凭据，`skipped: no-credentials`），即真实模型是否会按 id 读取摘要层条目、检索落空后是否换说法再查；AC-29 在真实 Electron 窗口中的显示（只有 Browser Mode 证据）、真实指针与原生层；相近判定对中文的区分度不足（见上，未解决）；`reads-summarized-memory` 在全量负载下一次 20 秒超时的具体位置；两次全量运行被 SIGTERM 的来源。
- 失效条件：Memory 段的组成、`tierMemories`、`memory_list` / `memory_write` 的结果文字、相近判定的阈值、`/api/memories` 的汇总或设置分区的改动，需要重跑记忆集成用例、联合场景与 `pnpm run eval`。
- 状态：本地提交在分支 `mem-tiered/t08`，未合入集成分支 `feat/memory-tiered-injection`（由负责人合并），未合入 main、未推送、未发布；CI 未运行。
