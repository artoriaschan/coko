---
kind: reference
description: "当前的追踪、审计与评测：model_request 条目、deriveTrace / deriveAudit 的派生规则（工具耗时、审批等待、Hook 归属）、GET /api/sessions/:id/{trace,audit,export}、导出的 ndjson 格式与 loadExport 回放、右栏 Trace tab，以及 tests/evals 的用例格式、运行器、报告与真实模式。修改逐请求记录、追踪接口、导出或评测前查阅。"
lifecycle: active
---

# 追踪、审计、导出与评测

本文说明 Coko 当前如何记录每次模型请求，如何由已提交的条目派生每个 Run 的追踪与 Session 的审计序列，导出与回放会话的格式，右栏 Trace tab，以及 `tests/evals` 的回归评测。日志的字段与落盘约定见 [日志与诊断约定](../tech-stack/observability.md)；条目的存储与迁移见 [ADR 0003](../adr/0003-settings-and-sessions-in-sqlite.md)；秘密的脱敏边界见 [ADR 0004](../adr/0004-model-credentials-safe-storage.md) 与 [ADR 0007](../adr/0007-secrets-from-registered-entries.md)。术语 Run、Eval Case 见 [GLOSSARY](../../GLOSSARY.md)。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/engine/model-requests.ts` | 每次模型请求的测量（耗时、首个增量、重试次数）与 `model_request` payload |
| `packages/agent/src/observability/` | 纯函数：`deriveTrace`、`traceTotals`、`deriveAudit`、`formatExport`、`loadExport`（`@coko/agent/testing` 另导出 `loadExport`） |
| `packages/protocol/src/trace.ts` | `RunTrace`、`ToolTrace`、`HookTrace`、`TraceTotals`、`AuditEvent`、`SessionExportHeader` 与 `tracePaths` |
| `apps/server/src/application/trace.ts`、`http/routes/trace.ts` | `TraceService`：读取条目、再脱敏、递归收集子 Session；三个 GET 路由 |
| `apps/desktop/src/renderer/stores/trace-store.ts`、`features/right-panel/trace-tab.tsx` | 右栏 Trace tab 与导出 |
| `tests/evals/` | 评测用例、运行器、判定与报告 |

## 逐请求记录

运行时为每次实际启动的模型请求尝试提交一条 `model_request`（v1，与 assistant 消息同一提交链，失败、取消以及失败压缩的请求也提交）：`runId`、`provider`、`model`、`startedAt`、`durationMs`（仅该次尝试，不含重试退避等待）、`ttftMs?`（第一个文本或工具调用增量到达的时间）、`usage { input, output, cacheRead, cacheWrite, total }`、`cost?`（未定价时省略）、`stopReason`、`retries`（同次逻辑调用中之前失败的次数，首次为 0）、`errorCode?`（`aborted`、`context_overflow`、`model_error`）与 `purpose`（`turn`、压缩的 `compaction`、交接的 `summary`、会话标题的 `title`）。新请求另有唯一 `requestId`、`usageReport { complete, known }`（四分桶中实际已知的字段）、可选 `reasoning` 与 `costBreakdown`。`usageReport` 缺失的旧记录不能证明完整性，不补写历史计量；`reasoning` 是输出子集，不能再加到合计。配置的 Chat Completions、Responses 和 Anthropic 适配器通过 pi-ai 的原始流事件回调，在依赖填零之前记录计数字段是否存在；协议允许省略的缓存字段可解释为零，缺少必要字段保留其他已知值并标为不完整。OpenAI 输入总量扣除缓存读取/写入后才是未缓存输入，Anthropic 输入原本不含缓存。无效计数不升级为实测零。

重试的每次真实尝试各有独立 `requestId`；记录保留结束前取得的有效计数。失败尝试在退避前提交，退避时 Sidecar 崩溃后仍可读回；退避期间停止不产生尚未发出的下一次请求，失败压缩即使没有成功 `compaction` 条目也保留请求事实。后续部分报告省略先前字段时不清空已有计数；缺失、无效或矛盾报告保持不完整。

普通对话的最终请求事实先于其助手消息副本持久化，避免助手消息已经提交、对应计量尚未提交时崩溃造成漏计；失败尝试仍在退避前落盘。记录提交失败会停止 Run，不因展示助手正文而越过计量提交屏障。中断 Run 或缺少可信结束记录只能提供已知小计，不能从现存的完整请求报告推断整轮完整。

同时记日志 `model request finished { sessionId, runId, model, durationMs, ttftMs, tokens, cost, retries }`。Fork 与 Handoff 不复制 `model_request`。

标题请求在 Run 之外，信封与 payload 的 `runId` 均为 `null`，不创建虚构的 Run，也不提交 assistant / user 消息。其失败与超时同样记录；超时 `errorCode` 为 `timeout`。日志为 `title request finished { durationMs, usage, outcome }`，不包含标题、用户文字或模型错误原文。实现见[标题服务](../../apps/server/src/application/session-titles.ts)。

## 追踪

`deriveTrace(entries)` 按 `run_start` 的顺序给出每个 Run 的 `RunTrace`；没有 `run_start` 的 runId 与不属于 Run 的条目不出现。追踪包含被回退的 Run（它是执行记录，不是有效上下文）。

- **Run。** `trigger` 取自 `run_start`；`status`、`errorCode` 与 `durationMs`（`run_end.createdAt − run_start.createdAt`）取自 `run_end`，没有 `run_end`（被中断或进行中）时省略。`requests` 为本 Run 的全部 `model_request`（含摘要请求），按 `requestId` 去重（旧记录按条目序号），相同计数的不同尝试分别累计；`usage` 为它们之和，`tokens = input + output + cacheRead + cacheWrite`（与 [Goal 预算](goal.md#预算) 的 Token 口径相同），`cost` 为已定价请求之和。
- **工具耗时。** 每个工具调用从所在 assistant 消息的 `createdAt` 起算，到结果消息的 `createdAt`（`durationMs`，含审批等待与 Hook）；side-effect 调用另有 `execMs`（`tool_exec` 到结果）。并行执行的一批调用的结果一起提交，各自的 `durationMs` 约等于整批的时间。没有结果的调用（Run 被中断）没有 `durationMs`。不新增条目。
- **审批等待。** `approval_request` 到 `approval_decision` 的 `createdAt` 差，同一调用的多次审批相加；`approval` 为最后一次的结果（没有回答时 `pending`），`approvalBy` 为 `user`、`hook`（PermissionRequest Hook）或 `headless`（[ADR 0019](../adr/0019-headless-runs-deny-approvals.md)）。决定按 `requestId` 找到请求，不依赖决定条目的 runId。
- **Hook 归属。** `hook_run` 不带 toolCallId：工具 Hook（PreToolUse、PermissionRequest、PostToolUse、PostToolUseFailure）只在本 Run 恰有一个调用尚未得到结果时记在该调用的 `hooks` 上；多个调用同时未结束（并行的一批或顺序执行时尚未开始的调用）时无法确定归属，与 UserPromptSubmit、Stop、PreCompact 等一起记在 Run 的 `hooks` 上。
- **合计。** `traceTotals` 为 Run 数、请求数、工具调用数、Token、费用与已结束 Run 的时长之和；HTTP 的 Session 合计另外加上 `runId: null` 的 `title` 请求数、Token 与费用，Run 行不包含这些独立请求；只含本 Session 的条目（子 Session 的追踪单独读取，Goal 用量另计入子 Session，见 [子代理](subagents.md)）。

## 审计

`deriveAudit(entries)` 按提交顺序给出 `AuditEvent`，每项带 `seq`、`at`（`createdAt`）与可选的 `runId`：

| kind | 来源 | 字段 |
| --- | --- | --- |
| `approval` | `approval_request` + `approval_decision` | 在回答时给出（seq 为决定条目）：`requestId`、`toolCallId`、`toolName`、`approvalKind`、`subject`（已脱敏的命令或路径）、`requestedAt`、`outcome`、`by`（缺省 `user`）、`scope?`；没有回答的以请求的位置给出 `outcome: pending` |
| `permission_mode`、`permission_rule` | 同名条目 | 模式与 `prior`；规则的增删 |
| `hook` | `hook_run` | 事件、hookId、来源（含插件名）、结论、退出码、耗时、`message?`（入库时已脱敏，≤ 2 KB） |
| `confirmation` | `confirmation_answer` | 结果确认的回答 |
| `schedule_fire` | 同名条目 | 到期时刻、started / skipped、原因、合并次数 |
| `handoff`、`handoff_failed`、`handoff_origin` | 同名条目 | 目标 Session 与位置、失败码、来源；不含交接摘要与说明 |
| `agent_start`、`agent_end` | 同名条目 | 子代理与 teammate 的 id、类型、后台、名字与结束状态 |

审计只取结构化字段：不带用户输入、模型输出、交接摘要等正文。

## HTTP 接口

| 路由 | 响应 |
| --- | --- |
| `GET /api/sessions/:id/trace` | `{ runs: RunTrace[], totals: TraceTotals }` |
| `GET /api/sessions/:id/audit` | `AuditEvent[]` |
| `GET /api/sessions/:id/export[?children=1]` | `application/x-ndjson`，`content-disposition: attachment; filename="coko-session-<id>.ndjson"` |

Session 不存在时三者都是 404 `not-found`。三者的响应在返回前再按登记的明文替换一次（`redactSecretsDeep`）：它们是新的输出通道，用户自己输入的文本在库中按原样保存（ADR 0007），导出时同样替换。

## 导出与回放

导出的第一行为 `{ type: 'header', format: 'coko-session-export', version: 1, sessionId, exportedAt }`（`exportedAt` 取 Sidecar 的时钟），其后每行一个已提交的条目，字段与会话详情接口的条目相同（`sessionId`、`seq`、`kind`、`payloadVersion`、`payload`、`runId`、`createdAt`）。`?children=1` 时本 Session 的条目之后按深度优先接各子 Session 的条目，每行的 `sessionId` 区分来源。

回放即读回条目：`loadExport(text)` 校验 header 与每行的形状（不符时抛出），返回 header 之后的条目；`modelContext`、`deriveTrace`、`deriveAudit` 等纯函数在其上运行。不做按录制结果重新执行工具的回放（结果不确定、会重复副作用）；无密钥的会话回放用 faux 脚本。

## 界面

右栏 Trace tab：顶部为 Session 合计（Token、费用、Run 数、请求数、工具调用数）与"导出"（读取 `?children=1` 的文本，经浏览器下载保存为 `.ndjson`，成功后 Toast 提示文件名）；其下每个 Run 一行（触发、状态、时长、Token、费用，最近的在最上面），展开为模型请求（模型、用途、时长、首字、Token、费用、重试、错误码）与工具（名字、时长、审批等待与结果、出错、Hook 结果），以及 Run 上的 Hook。费用符号取设置 `usage.currency`。数据来自 `GET …/trace`；`model_request`、`run_start` 与 `run_end` 的条目数变化时重读，同一帧内的多次变化合并为一次；重读不重挂载已有的 Run 行，展开状态保留。读取失败时没有内容显示错误与重试，有内容时保留并显示一行提示。不做图表。

主时间线的工具详情通过 Inspect（中文“查看”）复用该 Trace 标签页，必要时打开右栏；当前入口只选择当前 Session 的 Trace，不提供工具行定位。子 Session 时间线没有对应追踪导航回调时不显示 Inspect，也不通过展开或查看重新执行工具。

## 评测

`tests/evals/` 是根 Vitest 配置中的项目 `evals`（`tests/evals/vitest.config.ts`），随 `pnpm run test` 运行；`pnpm run eval`（`vitest run --project evals`）只运行它。

**用例格式。** 每个 Eval Case 一个目录 `cases/<name>/`：`workspace/` 为初始文件，`case.json` 为

| 字段 | 含义 |
| --- | --- |
| `prompt` | 提交的文本 |
| `permissionMode?` | 缺省 `full-access`；`read-only` 与 `default` 下的审批由运行器带反馈拒绝（Run 继续） |
| `faux` | faux 模式的回复脚本（与 `COKO_FAUX_SCRIPT` 的 `responses` 相同） |
| `expect.files?` | 路径 → 完整内容，或 `"/正则/"` |
| `expect.unchanged?` | 内容应与初始文件相同的路径 |
| `expect.maxToolCalls?` | 工具调用数上限 |
| `expect.status?` | 最后一个 Run 的状态，缺省 `completed` |

当前用例：`fix-function`（修函数并通过检查脚本）、`fix-failing-test`（运行失败的测试、修代码、再运行）、`read-only-refuses-write`（read-only 下拒绝写入，文件不变）。

**运行器与判定。** `runner.ts` 复用集成测试的 `sidecar-harness.ts`：把 `workspace/` 复制到临时目录，启动真实 Sidecar，按 `permissionMode` 设置模式并提交 prompt，等 Run 结束后由 `judge.ts` 只按外部事实判定（文件内容、未改动的文件、工具调用数与 Run 状态），每条不满足的期望给出一条原因。tokens、cost 与 durationMs 来自 `GET …/trace` 的合计；faux 模式给模型设价格（输入 1、输出 2，每百万 token），费用按 pi-ai 的算法计算。

**报告。** 每次运行写 `tests/evals/reports/<ISO 时间>.json`（git 忽略）：`{ startedAt, faux: EvalResult[], real }`，`EvalResult` 为 `{ name, mode, pass, reasons, tokens, cost, durationMs, toolCalls, status }`；没有真实模式时 `real` 为 `{ skipped: 'no-credentials' }`。

**真实模式。** `COKO_EVAL_PROVIDER_CONFIG` 指向 JSON 文件 `{ provider: ProviderFields, model }`（不含密钥），且对应的 `COKO_CREDENTIAL_<ID>` 存在时，同一组用例再用该 Provider 的模型运行（不用 faux 脚本），报告的 `real` 为 `{ model, results }`；缺一时该组用例跳过。真实模式尚未在本地验证（需要凭据），列在交付前的人工验证项中。

## 验证

- `packages/agent/src/observability/trace.test.ts`：`deriveTrace`（多轮、重试、压缩与交接摘要、工具并行、审批等待与回答者、Hook 归属、被中断的 Run）、`deriveAudit` 的每类事件与顺序、`loadExport` 的格式校验。
- `tests/integration/sidecar-trace.test.ts`：含审批与 Hook 的 Goal Round 之后的请求数、工具耗时 ≥ 审批等待、Goal Round 的追踪与 Goal 用量一致、审计的 approval 与 hook；导出的 ndjson 与 `?children=1`；回放往返。
- `tests/integration/secrets-gate-trace.test.ts`：trace、audit、export 与 requestLog 中没有登记 Secret 的明文（含用户输入的）。
- `apps/desktop/src/renderer/features/right-panel/trace-tab.browser.test.tsx` 与 `apps/desktop/e2e/trace.e2e.test.ts`：列表、键盘展开、自动更新与同帧合并、导出（E2E 中由 main 的 `will-download` 保存文件）、明暗主题对比度与 390 px。
- `tests/evals/judge.test.ts` 与 `tests/evals/evals.test.ts`。

正常请求计量与三协议持久化回归见 [Sidecar 请求用量测试](../../tests/integration/sidecar-request-usage.test.ts)，覆盖四分桶、reasoning、Anthropic 1h 缓存写入、零/未知/部分报告及重启读回；仅替换远程模型服务，不表示已验证真实 Provider。
