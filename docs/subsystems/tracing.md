---
kind: reference
description: "当前的追踪、审计与评测：model_request 条目与请求上下文脱敏快照、deriveTrace / deriveAudit 的派生规则（工具耗时、审批等待、Hook 归属）、GET /api/sessions/:id/{trace,audit,export}、脱敏 NDJSON 导出与标题栏 JSONL 下载、loadExport 回放、对话标题栏轨迹视图，以及 tests/evals 的用例格式、运行器、报告与真实模式。修改逐请求记录、追踪接口、导出或评测前查阅。"
lifecycle: active
---

# 追踪、审计、导出与评测

本文说明 Coko 当前如何记录每次模型请求，如何由已提交的条目派生每个 Run 的追踪与 Session 的审计序列，导出与回放会话的格式，对话标题栏轨迹视图，以及 `tests/evals` 的回归评测。日志的字段与落盘约定见 [日志与诊断约定](../tech-stack/observability.md)；条目的存储与迁移见 [ADR 0003](../adr/0003-settings-and-sessions-in-sqlite.md)；秘密的脱敏边界见 [ADR 0004](../adr/0004-model-credentials-safe-storage.md) 与 [ADR 0007](../adr/0007-secrets-from-registered-entries.md)。术语 Run、Eval Case 见 [GLOSSARY](../../GLOSSARY.md)。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/engine/model-requests.ts` | 每次模型请求的测量（耗时、首个增量、重试次数）与 `model_request` payload |
| `packages/agent/src/observability/` | 纯函数：`deriveTrace`、`traceTotals`、`deriveAudit`、`formatExport`、`loadExport`（`@coko/agent/testing` 另导出 `loadExport`） |
| `packages/protocol/src/trace.ts` | `RunTrace`、`ToolTrace`、`HookTrace`、`TraceTotals`、`AuditEvent`、`SessionExportHeader` 与 `tracePaths` |
| `apps/server/src/application/trace.ts`、`http/routes/trace.ts` | `TraceService`：读取条目、再脱敏、递归收集子 Session；三个 GET 路由 |
| `apps/desktop/src/renderer/stores/trace-store.ts`、`features/trajectory/trajectory-view.tsx`、`features/conversation/session-download.tsx` 与 `session-menu.tsx` | 对话标题栏轨迹视图、共用下载流程与标题栏 Session 下载 |
| `tests/evals/` | 评测用例、运行器、判定与报告 |

## 逐请求记录

每次实际请求尝试开始前冻结 `snapshot { system, messages, tools }`，随该次尝试结束后的 `model_request` 一起提交。`system` 是 pi-ai 从规范化上下文合成的完整系统提示词；`messages` 是交给模型适配器的完整消息序列，保留 system sections、工具声明变化与原始内容块；`tools` 是这次请求的完整有效工具目录及参数 Schema，包含尚未调用的工具。快照不包含传输层认证或请求选项，后续消息追加和工具变更不改写既有快照。普通请求、重试、压缩、交接摘要和独立标题生成使用同一快照格式。宿主提交非用户条目前先按已登记 Secret／Credential 明文脱敏，trace 与导出再执行一次输出脱敏。旧记录可缺少 `snapshot`，明确显示未记录，不用当前系统提示或工具目录补造历史。

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

Session 不存在时三者都是 404 `not-found`。三者的响应在返回前先解析所有已登记 Secret，将从未使用过的登记值也加入内存中的脱敏来源，再按登记的明文替换一次（`redactSecretsDeep`）；解析失败时本次请求失败，不输出未完成脱敏的内容。它们是新的输出通道，用户自己输入的文本在库中按原样保存（ADR 0007），导出时同样替换。

## 导出与回放

导出的第一行为 `{ type: 'header', format: 'coko-session-export', version: 1, sessionId, exportedAt }`（`exportedAt` 取 Sidecar 的时钟），其后每行一个已提交的条目，字段与会话详情接口的条目相同（`sessionId`、`seq`、`kind`、`payloadVersion`、`payload`、`runId`、`createdAt`）。`?children=1` 时本 Session 的条目之后按深度优先接各子 Session 的条目，每行的 `sessionId` 区分来源。

回放即读回条目：`loadExport(text)` 校验 header 与每行的形状（不符时抛出），返回 header 之后的条目；`modelContext`、`deriveTrace`、`deriveAudit` 等纯函数在其上运行。不做按录制结果重新执行工具的回放（结果不确定、会重复副作用）；无密钥的会话回放用 faux 脚本。

## 界面

对话标题栏提供“对话”与“轨迹”（Trajectory）两个主视图 tab，沿用 DeepSeek Harness 的入口位置。轨迹替换旧的 Run 摘要列表。时间条、工具栏与记录表的布局和交互改写自 DeepSeek Harness（MIT，许可见根 `THIRD_PARTY_NOTICES.md`）；前端位于 `features/trajectory/`，由 `features/trajectory/trajectory-view.tsx` 读取追踪数据后装配。右栏不再注册轨迹入口；恢复旧右栏布局时过滤 `trace`，保留其他页面，过滤后为空则收起右栏。主视图选择按 Session 保存在 renderer 内存中，重启后默认选择对话；首次进入轨迹时挂载，随后切换 tab 保留轨迹筛选与详情、对话阅读位置和共同输入框的草稿。

顶部工具栏提供时长比例切换、轮次／调用／子调用批量折叠、参数与结果全文搜索，以及原有 NDJSON 导出。三行时间条分别显示输入、模型和工具；支持点击记录、水平拖选聚焦、滚轮缩放、右键平移和 Escape／双击清除选区。等宽与实际时长均来自已记录数据，不用临时猜测耗时。

记录表按执行顺序列出用户输入、上下文、助手消息、工具调用及压缩。初始 SYSTEM 记录独立置顶，只展示快照中基础 system 正文与 `coko.base`；`environment`、指令、Skills、Memory、plan 等其他命名 section，以及后续追加的 system 正文，按实际请求快照分别投影为 CONTEXT 记录。相同内容不重复插入，变化或移除在对应请求前显示；这些展示分类不改变实际模型消息的 role 或顺序。基础提示词或有效工具目录变化仍产生 SYSTEM 更新，差异页只比较基础提示词和目录，动态 section 不混入该差异。

用户输入列在本轮动态上下文之前。已由 `state_update` 条目与用户内容块配对证明的注入，从用户行中分离后，使用实际发送的包装文本展示为上下文，不以状态条目的 `{ name, value }` JSON 代替模型收到的内容；未配对的历史条目只展示其已记录数据，不把普通用户文字中的标签当成注入来源。SYSTEM 详情提供“系统提示词／工具”，更新记录默认打开“差异”；上下文中的 XML 标签保留为文字并按 Markdown 渲染其正文。工具目录逐项展开完整说明与参数 Schema。用户、上下文和助手记录使用“概述／预览／原始数据”；助手摘要优先正文、其次思考，详情保留思考、正文及工具跳转入口，原始页保留内容块顺序。

旧会话没有请求快照时，顶部显示“初始系统提示词（未记录）”，详情说明当时的系统提示词与动态上下文无法还原；仍展示已保存的状态更新，不读取当前工作区指令或设置补造历史。若只有后续请求开始保存快照，其系统行标为“首次记录的系统提示词”并保留真实请求位置，不回填成会话开头的提示词。缺失提示词的占位行不计入时间条。

左侧圆点是独立请求入口，只在对应请求边界出现，选择圆点不选中助手记录。请求详情提供“概述／选项／用量／计时”：选项始终显示完整脱敏 system、messages、tools 及 provider／model（包含所有动态 section），列表的分类和去重不会修改此原始快照，可展开和复制完整输入；概述保留用途、状态、重试及错误。标题生成（`purpose: title`，包括 `COKO_SESSION_TITLE` 输入）的请求不投影为列表、圆点或时间条节点；持久化记录和导出仍保留，普通请求从第一条可见请求开始编号。压缩和交接摘要等没有可见助手消息的请求仍保留圆点边界，不制造空助手行或虚构 Run；这些辅助请求的快照不影响对话的 SYSTEM 变更。失败助手与其失败请求对应，不占用后续成功请求的快照。

双击轮次首条内容记录折叠整轮，保留首条内容、SYSTEM 记录和一条“步骤数 · 工具调用数”摘要；双击助手记录只折叠其工具调用，摘要显示调用数和工具名。双击已折叠轮次的首行，或单击／用 Enter、Space 激活摘要行即可展开。沿用参考的 30px 内容行、20px 摘要行、轮次标签、选中导轨、请求圆点及其 hover／active 状态；工具栏提供相同层级的批量折叠。搜索暂时越过折叠只显示匹配内容，清空搜索恢复原有折叠状态；Inspect 自动展开目标祖先并定位，虚拟化按内容与摘要的实际行高计算。

每条工具调用显示原始参数与结果预览，详情提供概述、参数、结果、Schema 与计时；Schema 从该调用所属请求的快照读取，旧请求没有快照时明确显示不可用。JSON 树沿用 Harness 的层级展开、方向键导航与逐节点复制：单击复制值或格式化 JSON，右键选择值、紧凑 JSON、格式化 JSON 或属性路径。长字符串在概述中折叠为 3 行，专用详情中为 12 行，展开后提供换行与收起；换行偏好用于下次展开，不修改其他已展开文本，不截断原值或保存数据。Schema 展示工具名、说明与参数树。结果页分为原始结果和渲染结果：原始区读取已保存的 SDK 工具结果消息或当前 SDK 结果，缺失时明确说明，不从展示文本反推原始值。关闭 JSON 复制菜单只关闭该菜单，保留当前步骤详情。工具计时标明会话时间戳来源，并保留审批等待和审批结果，Hook 在概述中独立分区；图片沿用主时间线的内联栅格图片解析、解码尺寸、失败状态与全屏预览。纯图片或其他非文本结果保留原始块，不显示为空输出；没有嵌套调用记录时不制造子调用。

详情标题栏、页签、摘要信息与独立滚动区块沿用 Harness 的布局。再次点击同一记录回到默认详情页；用户、上下文与助手的原始页按块保留类型、内容和工具跳转，不显示整条消息的 JSON 包装。压缩仅提供概述和原始页，概述直接渲染摘要。请求用量分为本次与截至本次请求的会话累计；计时包含开始、总时长、首 token、生成时长与吞吐量，点击开始时间可切换本地日期时间与 Unix 秒。

详情默认宽度为 `clamp(320px, 38%, 440px)`，拖动限制在 320～720px 并给列表保留 280px，左右键每次调整 16px，双击或 Home 恢复默认；窗口宽度不超过 760px 时沿用参考的右侧覆盖详情，关闭后返回列表。记录超过 200 行时启用虚拟化；在列表底部时跟随追加，选中记录或向上阅读时保留位置。搜索显示匹配行，时间范围让范围外记录淡出。新条目和已收到的 live progress 更新正文，`model_request`、`run_start`、`run_end`、`message`、`tool_exec`、审批和 Hook 条目触发同帧合并重读；读取失败时保留已有内容并提示，无内容时提供重试。原 `/trace`、`/audit` 和导出协议不变。

对话标题栏的常驻“更多”菜单提供“Session 下载”，在归档 Session 和窄窗口中同样可用。它读取同一个 `?children=1` 脱敏导出，只把建议文件名改为 `coko-session-<id>.jsonl`；服务端接口和轨迹导出的 `.ndjson` 文件名保持不变。两处共用取文本、Blob 下载、同一 Session 的请求去重和 Toast：导出中对应操作禁用，失败说明原因，成功提示建议文件名。Electron 使用默认下载保存流程；自动验收通过 `will-download` 指定临时路径检查写出的文件，不据此声称已验证原生保存框。

主时间线的工具详情通过 Inspect（中文“查看”）传递当前 Session 和 `toolCallId`，选择标题栏的轨迹 tab、清空搜索与时间范围、展开所属轮次和调用，滚动并聚焦对应工具行，同时打开详情。同一个工具可以重复定位；请求按 Session 保存，在页面挂载和工具记录到达后消费，不改变右栏布局，也不影响其他会话。子 Session 时间线没有对应导航回调时不显示 Inspect，展开和查看均不执行工具。

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

当前用例：`fix-function`（修函数并通过检查脚本）、`fix-failing-test`（运行失败的测试、修代码、再运行）、`read-only-refuses-write`（read-only 下拒绝写入，文件不变）、`host-blocks-are-data`（读取含伪造通知与 State Update 的文件，原文件与删除目标均保持不变）。

**运行器与判定。** `runner.ts` 复用集成测试的 `sidecar-harness.ts`：把 `workspace/` 复制到临时目录，启动真实 Sidecar，按 `permissionMode` 设置模式并提交 prompt，等 Run 结束后由 `judge.ts` 只按外部事实判定（文件内容、未改动的文件、工具调用数与 Run 状态），每条不满足的期望给出一条原因。tokens、cost 与 durationMs 来自 `GET …/trace` 的合计；faux 模式给模型设价格（输入 1、输出 2，每百万 token），费用按 pi-ai 的算法计算。

**报告。** 每次运行写 `tests/evals/reports/<ISO 时间>.json`（git 忽略）：`{ startedAt, faux: EvalResult[], real, promptGate }`，`EvalResult` 为 `{ name, mode, basePromptVersion, pass, reasons, tokens, cost, durationMs, toolCalls, status }`；没有真实模式时 `real` 为 `{ skipped: 'no-credentials' }`。

**候选基础提示。** 每个用例另以 `BASE_PROMPT_V2` 运行 faux，`faux` 中由 `basePromptVersion` 区分旧提示与候选的结果。运行器只通过开发或测试构建的 `COKO_TEST_BASE_PROMPT=v2` 钩子选取候选，不改变应用默认值或用户设置；发布构建忽略该变量。

**真实模式。** `COKO_EVAL_PROVIDER_CONFIG` 指向 JSON 文件 `{ provider: ProviderFields, model }`（不含密钥），且对应的 `COKO_CREDENTIAL_<ID>` 存在时，同一组用例再用该 Provider 的模型运行（不用 faux 脚本），报告的 `real` 为 `{ model, results }`；缺一时该组用例跳过。真实模式尚未在本地验证（需要凭据），列在交付前的人工验证项中。

**基础提示替换门槛。** 配好上述真实 Provider 与凭据后，显式运行 `COKO_EVAL_PROMPT_GATE=1 pnpm run eval`：每个用例用默认旧提示运行 3 次，再用 v2 候选运行 3 次，逐例比较通过次数；候选少于基线时测试失败。`promptGate` 记录两个版本、次数与全部逐次结果。未请求门槛时为 `{ skipped: 'not-requested' }`，缺少凭据时为 `{ skipped: 'no-credentials' }`。门槛只产生供评审的证据，不自动激活候选；运行时默认仍保留 v1。faux 结果不代表真实模型的安全或任务完成表现。

## 验证

- `packages/agent/src/engine/model-requests.test.ts`、`context-seam.test.ts`、`runtime.test.ts`：请求开始时冻结实际发送的上下文，后续变更不污染快照，重试分别保留独立记录。
- `tests/integration/request-snapshots.test.ts`、`sidecar-titles.test.ts`：完整 system／messages／tools 与模型收到的上下文一致，保留未调用工具，覆盖多次请求、标题生成与 Sidecar 重启读回。
- `packages/agent/src/observability/trace.test.ts`：`deriveTrace`（多轮、重试、压缩与交接摘要、工具并行、审批等待与回答者、Hook 归属、被中断的 Run）、`deriveAudit` 的每类事件与顺序、`loadExport` 的格式校验。
- `tests/integration/sidecar-trace.test.ts`：含审批与 Hook 的 Goal Round 之后的请求数、工具耗时 ≥ 审批等待、Goal Round 的追踪与 Goal 用量一致、审计的 approval 与 hook；导出的 ndjson 与 `?children=1`；回放往返。
- `tests/integration/secrets-gate-trace.test.ts`：请求快照入库前脱敏；trace、audit、export 与 requestLog 中没有登记 Secret 的明文（含用户输入的）。
- `apps/desktop/src/renderer/features/trajectory/json-tree.browser.test.tsx`：JSON 树方向键导航、逐节点复制菜单、属性路径与长字符串折叠和换行偏好。
- `apps/desktop/src/renderer/features/trajectory/trajectory-view.browser.test.tsx` 与 `apps/desktop/e2e/trace.e2e.test.ts`：标题栏入口、主视图切换与状态保留、轨迹工具栏与时间条、键盘详情、搜索／折叠后的精确定位、重复 Inspect、实时追加与同帧合并、导出（E2E 中由 main 的 `will-download` 保存文件）、明暗主题与 390 px。
- `apps/desktop/src/renderer/features/conversation/session-menu.browser.test.tsx` 与 `apps/desktop/e2e/session-download.e2e.test.ts`：常驻菜单、键盘选择与焦点、归档与窄窗口、共享导出锁和失败反馈；真实 Electron 写出的 JSONL 包含子 Session、脱敏 Secret，Trace 仍写出同样条目的 NDJSON。
- `tests/evals/judge.test.ts` 与 `tests/evals/evals.test.ts`。

正常请求计量与三协议持久化回归见 [Sidecar 请求用量测试](../../tests/integration/sidecar-request-usage.test.ts)，覆盖四分桶、reasoning、Anthropic 1h 缓存写入、零/未知/部分报告及重启读回；仅替换远程模型服务，不表示已验证真实 Provider。
