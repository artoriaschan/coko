---
kind: reference
description: "当前的 Goal 契约：goal 条目（完整快照与 revision）、九阶段的转换表、create_goal / get_goal / update_goal 的授权与完成证据、Goal Round 的推进与去重（GoalDriver）、wait_jobs 与 Job 结束后的唤醒、五维预算（从条目派生的口径与三个检查点、未定价模型）、<goal> 与 <goal_round> 注入、/goal 命令与 /api/sessions/:id/goal、取消的停止传播与重启后暂停，以及界面（dock 的 Goal 卡、时间线的 Goal 行与消息用量、标题栏的 Session 费用）。修改 Goal 的状态机、推进、预算、工具、注入、接口或界面前查阅。"
lifecycle: active
---

# Goal

本文说明 Coko 当前如何让 Agent 跨多个 Run 推进一个 [Goal](../../GLOSSARY.md)：模型在用户请求的 Run 中用 `create_goal` 记下目标与成功条件，之后 Sidecar 在 Session 空闲时逐轮发起 [Goal Round](../../GLOSSARY.md)，直到模型为每条条件给出证据、需要用户输入、等待后台任务、轮次用尽或被用户暂停。五维预算（轮次、工具调用、Token、费用、时间）从已提交的条目派生，在调用前检查。决定见 [ADR 0011](../adr/0011-goal-state-as-session-entries.md)。界面见 [界面](#界面)。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/goals/state.ts` | 转换表 `GOAL_TRANSITIONS` 与 `applyGoalChange`、`createGoalSnapshot`、`validateEvidence`、`runAuthority`、`goalRounds`、`currentGoal`、`GoalError`；预算维度的描述表 `GOAL_BUDGET_DIMENSIONS`（每维的预算字段、用量字段、模型可见名与格式，维度映射的唯一来源；键与协议的 `GOAL_BUDGET_DIMENSION_KEYS` 相同，server `goals.ts` 中有编译期断言）、判定 `exhaustedDimension`、`exhaustedMessage`、`COST_UNPRICED_MESSAGE` |
| `packages/agent/src/goals/budget.ts` | 预算派生：`goalRunIds`（属于 Goal 的 Run）、`goalUsage`（五维用量） |
| `packages/agent/src/goals/tools.ts` | `planGoalCreate` / `planGoalUpdate`（授权与判定）、三个工具与 `GoalToolPort` |
| `packages/agent/src/goals/prompt.ts` | `goalSection`（`<goal>`）与 `goalRoundText`（`<goal_round>`） |
| `packages/agent/src/session-entries/goals.ts`、`packages/protocol/src/goal.ts` | `goal` v1 的 payload schema；协议另有 `GoalResponse`、`GoalActionRequest`、`GoalUsage`、`goalPaths` |
| `apps/server/src/application/goals.ts` | `GoalService`：读写快照（每个 Session 一把锁）、用户的动作、取消、工具端口、Run 与 Job 结束后的转换、启动恢复 |
| `apps/server/src/application/goal-driver.ts` | `GoalDriver`：发起下一轮（经 `session-runs` 的 `startRun`，trigger goal） |
| `apps/server/src/application/context/goal.ts` | 上下文贡献：`<goal>` section、工具注册、预算检查点（工具调用前的 hook、`beforeRequest`）、`onRunEnd`、`/goal` 的动作 |
| `apps/server/src/http/routes/goals.ts` | `GET` / `POST /api/sessions/:id/goal` |

## 条目

每次变化提交一条 `goal` 条目，payload 是变化后的完整快照，revision 加一；当前 Goal 是该 Session 最新的 `goal` 条目。条目不带 runId，入库前经 `redactSecretsDeep` 替换登记的 Secret 与 Credential 明文，之后经 hub 推送。`source` 记录变化的来源：model（工具）、user（界面、HTTP、`/goal`）、system（Run 结束、Job 结束、轮次用尽、重启）。

- id 为 Session 内的序号 `goal-1`、`goal-2`…（只需在 Session 内唯一）；成功条件的 id 按位置为 `c1`…，编辑条件时重新编号。
- 一个 Session 至多一个未终结的 Goal；complete 或 cancelled 之后可以再建。
- 分叉不复制 `goal` 条目，回退对话不改变当前 Goal（回退不针对 `goal` 条目）。

## 阶段与转换

| 变化 | 出发阶段 | 到 |
| --- | --- | --- |
| 创建 | （没有未终结的 Goal） | running |
| pause | running、waiting-input、waiting-external | paused |
| resume | paused、blocked、failed、budget-exhausted（耗尽的维度须先有余量） | running |
| edit | 任一非终态 | 不变 |
| complete、cancel | 任一非终态 | complete、cancelled |
| blocked、wait_input、wait_jobs | running | blocked、waiting-input、waiting-external |
| 唤醒 | waiting-input、waiting-external | running |
| 失败、轮次用尽 | running | failed、budget-exhausted |

其余组合为 `invalid-transition`。resume 与 edit 把 `resumedAtRound` 设为当时已开始的轮次；进入 running 时清除 `reason` 与 `waitingFor`。

**Run 结束之后**（`onRunEnd`，在该 Session 的锁内）：

- Goal Round 以 error 结束 → failed（`reason.code` 为 Run 的错误码），不自动重试。
- Goal 为 running 时 Run 被停止（aborted，或 paused 且没有 error）：Goal Round 停止时仍有等待回答的审批（`approval_decision` cancelled）→ waiting-input（`approval-unanswered`）；否则 → paused（`user-stopped`）。用户提交的 Run 被停止时同样暂停，避免停止后立即开始下一轮。
- Goal 为 running 时外部 Hook 以 `continue: false` 停下 Run（paused 加 `hook_stopped`，见 [外部 Hook](hooks.md#continue-false-的停止)）→ paused（`hook-stopped`，`reason.message` 为脱敏后的 `stopReason`），不开始下一轮，用户恢复后照常推进。Goal 不是 running（如 waiting-input）时 Run 被 Hook 停下，Goal 不变。
- 交接完成后（源 Session 提交 handoff 条目）running 的 Goal → paused（`handed-off`）；交接 Run 结束不发起下一轮。
- Goal 为 waiting-input 时，用户的 Run（submit、continue、retry；含回答审批之后的）正常结束 → running；定时任务、交接与子代理的 Run 不唤醒；Goal 在这个 Run 之中才进入 waiting-input（模型在用户的 Run 里调用了 `wait_input`）时不唤醒，等用户的下一次提交。
- 预算停止（`run_end.error.code` 为 `budget_exhausted`、`cost_unpriced`）→ budget-exhausted（`reason.code` 为运行时交给宿主的 `RunError.dimension`，不解析消息文本）/ blocked（`cost-unpriced`），见 [预算](#预算)。

**Goal Round 中的计划审阅。** Goal Round 中提交 kind plan 的审批请求（`exit_plan_mode`）时 Goal 进入 waiting-input（`plan-review`），界面显示在等用户；回答（批准或带反馈拒绝）后同一 Run 中回到 running。审阅被停止取消时保持 waiting-input，按上面的规则等用户提交。
- 之后 Goal 为 running 且该 Run 正常结束、没有退回用户写的追加指令时发起下一轮。

## 推进

`GoalDriver.advance` 在 Session 的锁内执行，因此同一 Session 的推进串行：Session 有 Run 时不发起；重读当前 Goal，不是 running 时不发起；轮次 = 该 Goal 的 `run_start.goal.round` 的最大值；检查五维（[预算](#预算)），任一维度用尽时提交 budget-exhausted，设了费用上限而模型未定价时提交 blocked（`cost-unpriced`），都不开始 Run；否则以 `trigger: goal`、`goal { goalId, round: n + 1 }` 调用统一入口 `startRun`。下一轮的轮次取自已提交的 `run_start`，同一轮不会开始两次；用户先开始了 Run（`run-in-progress`）或回退、分叉进行中（`session-busy`）时放弃这次发起，Goal 保持 running，那个 Run 结束后再判定；不会自然再判定的原因不让 Goal 停在 running：模型未配置或须重新选择（`model-not-configured`、`model-required`）提交 blocked，有未回答的结果确认（`confirmation-pending`）提交 waiting-input，`reason.code` 都是该错误码。Goal 正在取消时不发起。挂起的 Job 通知（`pendingInput`）照常合并在 `<goal_round>` 之前。

Goal Round 中用户照常可以追加指令、停止与回答审批；提交新消息以 `run-in-progress` 拒绝。

**等待 Job。** `wait_jobs` 只接受本 Session running 的 Job，快照记 `waitingFor.jobIds`。GoalService 在 Goal 处于 running / waiting-* 时订阅该 Session 的 `job_end`：等待的 Job 全部结束后回到 running，Session 空闲时立即发起下一轮。没有 Goal 的空闲 Session 不因 Job 结束而开始 Run。

**Job 的归属。** Session 有未终结的 Goal 时启动的后台 Job 在 `job_start` 与快照中带 `goalId`。

## 预算

**口径**（`goalUsage`，每次检查时从条目重新计算，不另存计数器）。属于 Goal 的 Run：`run_start` 时 Goal 处于非终态且不是 paused 的 Run（含用户提交的，以及 waiting-input、blocked 期间开始的），和该 Goal 的 Goal Round；创建 Goal 的那个 Run 开始时还没有 Goal，不计。

| 维度（`reason.code`） | 已用 | 上限 |
| --- | --- | --- |
| `rounds` | 该 Goal 的 Goal Round 数（用户提交的 Run 不计） | `maxRounds`，缺省 50 |
| `tool-calls` | 这些 Run 的 toolResult 数（被拒绝的调用照常计入；工具调用上限拦下的不计，按运行时写入的 `details.hostBlock` 识别，不看结果文本） | `maxToolCalls` |
| `tokens` | 带 requestId 的请求事实四分桶之和，按请求身份去重；该 Run 无新计量事实时回退到 assistant / compaction / handoff 的旧 usage；旧来源与请求按四桶签名配对，配不上的 Run 标为不完整但不改变预算数值 | `maxTokens` |
| `cost` | 同一组请求事实的 `cost`；旧记录回退到 usage.cost.total（不换算货币） | `maxCost` |
| `time` | 各 Run `run_end.createdAt − run_start.createdAt` 之和（含审批等待，不含 Run 之间；进行中的 Run 计到此刻） | `maxDurationMs`（毫秒） |

同一 Run 有带 `requestId` 的 `model_request` 时，它是 Token 与费用的唯一累计来源，助手消息、成功压缩和交接中的重复 usage 不再另加。失败重试及失败压缩的已知消耗同样计入；无报告不冒充实测零，也不主动估算未知费用。旧记录保持原口径，不补写历史。预算与消息底栏共用 `@coko/agent/entries` 的同一汇总实现；计数不是安全非负整数、或声明的总量小于分桶和时，该来源不计入。上下文环仍度量当前模型上下文，不使用累计请求消耗。

已用 ≥ 上限即耗尽；多维同时耗尽时按上表顺序取第一个。

子代理的用量计入 Goal：派发它的 Run 属于 Goal 时（`agent_start.goalId`），子 Session 的全部 Run 经 `goalUsage` 的 `children` 计入工具调用、Token、费用与时间，不计轮次；`GET …/goal`、`<goal>` 与各检查点都用这个总量。子 Run 的请求前与工具调用前同样检查父 Session 的 Goal（含其他子 Session 的已用），耗尽时子 Run 停止，父级在下一个检查点停止。取消 Goal 先停止它的 Run 派发的子代理，`cleanup.agentsStopped` 为停止的数量。见 [子代理](subagents.md#预算并行与取消)。

**检查点**（只对 running 的 Goal 与属于它的 Run）：

- **Goal Round 开始前**（`GoalDriver.advance`）：五维；未定价检查。
- **每次模型请求前**（`beforeRequest`）：Token、费用、时间，设了 `maxCost` 而模型未定价时 `cost_unpriced`。自动压缩与溢出恢复的摘要请求也是模型请求：压缩之前先检查一次，返回 stop 时不压缩；压缩之后（计入请求事实，包括已报告的失败尝试）再检查一次。手动 `/compact` 的摘要请求同样先经这项检查：Goal 为 running 且已耗尽时不发摘要请求、不提交 `compaction`，compact 的 Run 照常转换 Goal 的阶段；Goal 不存在或不是 running 时照常压缩。返回 stop 时该次请求不发出，Run 以 `run_end { status: paused, error: { code: budget_exhausted | cost_unpriced, message } }` 结束。
- **每次工具调用前**（权限判定之后、Checkpoint 备份之前的准入 hook `admissionHooks`；被拦下的调用不读文件、不写快照）：已提交的调用数加本 Run 已放行、结果尚未提交的调用数（同一批的调用先放行、后提交结果，检查按 Session 串行）达到 `maxToolCalls` 时该调用不执行，结果为错误 `Goal budget exhausted: tool calls (n / max)`，带运行时写入的结构化标记 `details.hostBlock { by: goal-budget, dimension }`（工具自身给出的同名字段被去掉，命令输出无法伪造），并要求 Run 本批完成后停止（`stopAfterBatch`）；同一批中先到的调用照常执行。

耗尽的消息形如 `Goal budget exhausted: tokens (1050 / 1000)`（费用最多 6 位小数，时间带 `ms`）。Run 结束后 Goal 进入 budget-exhausted；恢复前须用 edit 使该维度有余量（`budget` 整体替换），否则 409 `invalid-transition`。

**未定价模型。** 模型的 `usage.cost` 来自 Model Catalog 的 `price`（见 [模型价格](#模型价格)）；没有价格时为 0。设了 `maxCost` 而 Session 的模型未定价：Goal Round 不开始、请求不发出，Goal 为 blocked（`cost-unpriced`）；恢复后在下一次推进时同样 blocked，直到为模型填写价格或去掉费用上限。`GET …/goal` 的 `usage.costUnpriced` 为当前模型是否未定价。

## 模型价格

Model Catalog 的模型可带 `price { input, output, cacheRead?, cacheWrite? }`（每百万 token，非负；缓存价格省略为 0），经 `provider.save` 保存；协议 schema 要求四项非负（`minimum: 0`），main 发送前按 schema 校验，Sidecar 对不合 schema、带 requestId 的控制请求立即回答 `bad-request`，注册表对非有限数另以 400 `bad-request` 拒绝；没有 `price` 的旧目录照常可用。注册表把价格写入 pi-ai 的 `model.cost`，pi-ai 按模型服务返回的 usage 计算每条 assistant 消息的 `usage.cost`。目录中带 `price` 的模型算已定价（全部为 0 也算）；不经目录注册的 Provider（测试用 faux）按 `cost` 是否有非零单价判定，faux 脚本可设 `price`。全局设置 `usage.currency`（`USD` / `CNY`，缺省 USD）只决定界面的货币符号。设置 → 模型服务：顶部选择费用货币，模型选项中填写四项价格（留空为未定价；填了价格时输入与输出必填）。

## 工具

| 工具 | 权限类 | 注册 |
| --- | --- | --- |
| `get_goal` | context-read | Session 有 Goal，或本 Run 不是 Goal Round |
| `create_goal { objective, criteria, constraints?, budget? }` | session-state | 本 Run 不是 Goal Round |
| `update_goal { goal_id, revision, action, objective?, criteria?, constraints?, budget?, evidence?, reason?, job_ids? }` | session-state | Session 有 Goal（没有 Goal 时它只能返回 not-found；同一 Run 中刚创建的 Goal 到下一个 Run 才能经它更新） |

`budget` 的字段为 `max_rounds`、`max_tool_calls`、`max_tokens`、`max_cost`、`max_duration_ms`；`evidence` 的元素为 `{ criterion_id, text, tool_call_ids? }`。结果为紧凑 JSON `{ goal: { id, revision, objective, constraints?, criteria, phase, reason?, round, maxRounds?, budget, waitingFor?, evidence? } | null }`，取自入库后的快照。被拒绝的调用为错误结果（`isError: true`），不提交条目；revision 过期的消息带当前 revision。

**授权**（调用时按条目判定当前 Run，`runAuthority`）：trigger submit 的 Run，或本 Run 送达过不是 Job 通知的 user message（用户的追加指令）为 user；trigger goal 为该 Goal 的第 n 轮；continue、retry 没有用户追加指令时都不是。

- create、edit、pause、resume 只在 user 的 Run 中接受。
- complete、blocked、wait_input、wait_jobs 在 user 的 Run 或本 Goal 的 Goal Round 中接受；Goal Round 中的 blocked 须 `round − resumedAtRound ≥ 3`，且须有 reason。

**完成证据。** complete 须为每条条件恰好给出一条证据，text 非空；`tool_call_ids` 中每个 id 必须是本 Session 已提交、`isError: false` 的 toolResult，否则以错误结果拒绝。用户标为完成不需要证据（`completedBy: user`）。Run 正常结束不改变阶段。

## 注入

Goal 未终结时每个 Run 开始时注入名为 `goal` 的 system section（顺序在指令、Skills、Memory、plan 之后，todo 之前）：当前 Goal 的 id、revision、阶段与原因、目标（JSON 字符串）、约束、成功条件、轮次 n / 上限与已设维度的已用 / 上限（如 `- tokens: 5000 / 9000`），以及工具用法说明。轮次计入本轮（其 `run_start` 在 section 取值之前提交）。section 来自条目，压缩后照常注入，见 [上下文管理](context.md#压缩后的-goal)。

Goal Round 的输入是一条 user message：`<goal_round>`、`Objective: "<目标>"`、成功条件、`Round: n / 上限` 与推进说明（以当前 Workspace、工具结果与已提交状态为准；完成时用 update_goal 给出每条条件的证据）。文本取自已提交（已脱敏）的快照。

## /goal 与 HTTP

内置命令 `/goal`：

- `/goal <目标>` 展开为普通提交：请模型用 `create_goal` 记下 1–10 条可检查的成功条件并开始工作。
- `/goal pause | resume | cancel | complete` 为动作（204，不产生 user message），只在控制词独占整段参数时识别；`pause` 与 `cancel` 在 Run 进行中可用，其余在 Run 进行中以 `run-in-progress` 拒绝。没有 Goal 时 404。
- 无参数时为空动作（204），界面据此打开 Goal 卡。

`GET /api/sessions/:id/goal` → `{ goal, usage }`（`goal` 没有时为 null，`usage` 为 `{ rounds: 0 }`；有 Goal 时 `usage` 为五维已用值 `{ rounds, toolCalls, tokens, cost, durationMs }` 与 `costUnpriced`）。`POST /api/sessions/:id/goal` `{ action: pause | resume | cancel | complete | edit, revision, objective?, constraints?, criteria?, budget? }` → 200 `{ goal, usage }`；revision 过期 409 `revision-conflict`（details 为 expected 与 actual），当前阶段不允许 409 `invalid-transition`，没有 Goal 或 Session 404。edit 的 `criteria` 为条件文本，`budget` 整体替换（`maxRounds` 缺省 50）。

- **暂停**：提交 paused（`user-paused`）；Run 进行中时该 Run 本批完成后停下（与 `POST …/pause` 相同），不终止 Job。
- **恢复**：提交 running，Session 空闲时立即发起下一轮。
- **标为完成**：提交 complete（`completedBy: user`）；Run 进行中时同样在本批完成后停下。
- **编辑**：可改目标、约束（`constraints`，与 create 对称）、成功条件与预算。
- 取消进行中（提交 cancelled 之前）的动作以 409 `invalid-transition`（"The goal is being cancelled"）拒绝。

## 界面

Renderer 只读条目与上述接口，不新增协议字段、条目、注入点或读取根。

| 位置 | 职责 |
| --- | --- |
| `apps/desktop/src/renderer/features/conversation/dock/goal-card.tsx` | dock 的 Goal 卡、取消确认、编辑对话框；`GoalStoreProvider`、`isGoalCardCommand` |
| `apps/desktop/src/renderer/stores/goal-store.ts` | 已用量（`GET …/goal`）、动作（`POST …/goal`）与卡片的界面状态 |
| `apps/desktop/src/renderer/features/conversation/goal-row.tsx` | 时间线的 Goal 行 |
| `apps/desktop/src/renderer/features/conversation/assistant-footer.tsx`、`session-cost.tsx` | 正常及异常结束的助手底栏；标题栏的 Session 费用与共用用量汇总 |

**Goal 卡**（dock 中 Todo 与 Queue 之间）。快照取自最新的 `goal` 条目；已用量经 `GET …/goal` 读取，只在影响用量的条目（`goal`、`run_end`、`compaction` 与带 usage 的 assistant 消息）到达时重新读取，同一帧内到达的合并为一次。未终结的 Goal 一直显示；complete、cancelled 在下一个 Run 开始前显示，可关闭。收起时为一行：目标（单行截断）、阶段徽标、轮次 n / 上限（缺省 50）、费用（模型未定价且没有费用时为"未定价"），下方一行原因。展开后：目标全文（两行截断，可展开）、原因、成功条件（有证据时显示证据）、已设维度的预算条（已用 / 上限，≥ 80% warning 色，≥ 100% destructive 色；模型未定价时费用为提示而不是进度；模型已定价且没有费用上限时，预算条下方提示"未设费用上限"）、取消的清理结果，以及操作：

- 暂停（running、waiting-*）、恢复（paused、blocked、failed、budget-exhausted；仍有维度达到上限时不可用并提示先调高预算）、编辑（目标与五维预算，留空为不设上限；时间以分钟输入）、标为完成、取消（确认框；请求在清理完成后返回，期间显示"正在停止"）。
- 动作带当前快照的 revision；`revision-conflict` 时提示并重新读取，其他失败以 Toast 提示。
- 原因按 `reason.code` 本地化：协议 `GoalReason.code` 为已知字面量（`GOAL_REASON_CODES`：预算维度与 `budget`、`cost-unpriced`、用户与系统的暂停、停止与取消、外部 Hook 停下 Run 的 `hook-stopped`、`restarted`、`approval-unanswered`、`plan-review`、模型的 update_goal 原因、Goal Round 没能开始的错误码）的联合，另以字符串兜底；每个已知值在 zh / en 中都有文案。needs-input、model-blocked、model-paused 另附模型给出的原文；其余代码（Run 的错误码）显示"运行出错"并附错误消息。

展开状态、经 `/goal` 打开与关闭只在 renderer 内存中。`/goal`（无参数，独占整段输入）在 renderer 中直接展开 Goal 卡、不发送；没有 Goal 时显示空状态（如何用 `/goal <目标>` 建立），下一个 Run 开始或关闭后消失。Run 进行中的 `/goal pause`、`/goal cancel` 作为提交（Sidecar 的动作）发送，不作为追加指令；提交返回 204 时 renderer 不进入运行中、不报错。

**时间线**。Goal 行采用对话区局部的 13px/20px 排版，长目标与原因完整换行，位于过程折叠外。Goal 仍只按 `goal` 快照显示阶段；Run 正常结束不会把目标标为 complete，预算、证据与控制仍由原有 dock 卡负责。每条 `goal` 条目一行：第一条为"新目标"与目标文本，之后为阶段徽标与原因。成功且有最终助手正文的 Run 在正文下显示单一底栏，用量入口及详情不显示费用，交互与时间规则见[工作台消息底栏](workbench.md#对话消息与思考)。其他结束场景在终止状态后复用同一底栏。底栏 Token 合计为已报告的 input + output + cacheRead + cacheWrite，未报告的兼容数值不冒充已知消耗。该 Run 存在带 `requestId` 的 `model_request` 时，以请求记录为唯一来源并按身份去重，不再重复累计助手消息和压缩载体；否则兼容汇总旧 assistant 与 compaction 的合法 usage，包括 reasoning/cacheWrite1h 扩展字段。reasoning 是输出子集，不另加。无法证明完整性的旧数据、缺少必要计数的新数据以及中断／未提交结束记录的 Run 标为“不完整”，完全未取得计数显示“未取得用量”，明确完整报告的零仍显示 0 tokens。用量从当前渲染 Session 的真实条目与 Run ID 汇总；回退历史沿用同一口径，不读取别的活动会话。Agents / Team 子会话阅读器的成功回复复用同一底栏，只累计所渲染子 Session 的事实，不混入活动父会话。

**Session 费用**（会话标题栏）。按与 Run 相同的请求优先、旧记录兼容及身份去重规则汇总本 Session 的计量，另加 Run 外标题请求一次；分叉复制来的无 runId 消息不计，子 Session 自行归属；HoverCard 分项为输入、输出、缓存读取、缓存写入的 Token 与费用。会话没有用量时不显示。

**未定价。** 一条回复的模型在 Model Catalog 中且没有 `price` 时算未定价；不在目录中（faux、已删除的 Provider）时按该回复的 `cost.total` 是否大于 0 判定。全部未定价时显示"未定价"，部分未定价时在费用后注明。Goal 卡的费用按 `usage.costUnpriced`（当前模型）判定。货币符号取 `usage.currency`，不换算；小于 1 时保留 4 位小数。

## 取消与重启

**取消**（HTTP 或 `/goal cancel`）：先标记该 Session 正在取消（Run 结束、Job 结束与模型的 Goal 工具都不再改变 Goal），停止进行中的 Run 并等待其 `run_end`（至多 30 秒，超出记入 failures），再终止 `goalId` 为此 Goal 的 running Job 并等待 `job_end`，最后提交 cancelled 快照与 `cleanup { runsAborted, jobsKilled, failures }`；提交前若仍有 Run 进行中（等待期间开始的），同样停止并等待它。取消期间用户的动作返回 409，`advance` 不发起 Goal Round。失败项不阻止取消。请求在这些都完成后返回。

**重启**：启动恢复在 Session 恢复与 Job 补记 lost 之后，把 running、waiting-input、waiting-external 的 Goal 提交为 paused（`reason.code: restarted`，source system）。不会自动继续，由用户恢复。

**已知限制**：有序关闭中断进行中的 Goal Round 时，该 Run 以 aborted 结束，Goal 被记为 paused（`user-stopped`）而不是 `restarted`；两者都需要用户恢复。

## 验证

- `packages/agent/src/goals/goals.test.ts`：转换表每一行与每个非法组合、resume 与 edit 的 resumedAtRound、budget-exhausted 恢复须有余量、创建的校验、完成证据（缺条件、空文本、未知条件、引用不存在或出错的调用）、各动作在 user / 本 Goal 的轮 / 其他 Goal 的轮 / none 四种 Run 中的授权、blocked 的 3 轮阈值、revision 过期、`runAuthority`、`<goal>` 与 `<goal_round>` 文本。
- `tests/integration/sidecar-goal.test.ts`：create_goal 之后 Goal Round 依次开始直到完整证据的 complete；轮次耗尽、POST 动作与 409；Goal Round 中的审批、停止为 waiting-input、用户提交后回到 running、追加指令授权 edit 与同一轮不重复；用户的 Run 中调用 wait_input 后不立即唤醒；Goal Round 中的计划审阅为 waiting-input（plan-review）；wait_jobs 后 Job 结束时下一轮开始；取消停止 Run 与 Job 并记 cleanup；取消进行中 resume 为 409；`/goal` 的动作；分叉与回退。
- `apps/server/src/application/goal-driver.test.ts`：Goal Round 没能开始时按错误码为 blocked、waiting-input 或保持 running。
- `packages/agent/src/engine/host-stop.test.ts`：`details.hostBlock` 只来自宿主 hook、`RunError.dimension` 不进入条目；`compaction.test.ts`：自动压缩、溢出恢复与手动压缩之前的请求前检查。
- `packages/agent/src/goals/budget.test.ts`：五维派生（请求事实优先与重放去重、旧记录与子 Session 兼容、属于 Goal 的 Run、paused 期间不计、用户提交的 Run 不计轮次、compaction.usage、进行中的 Run、拦下的调用不计）、`children` 接口、耗尽的维度与消息、按完整用量判定恢复、`<goal>` 的用量行；`src/goals/dimensions.test.ts`：描述表的每一维（预算字段、用量字段、名称、格式）与判定、消息、`<goal>` 都取自它，`create_goal` 描述建议设 `max_cost`；`packages/agent/src/engine/compaction.test.ts`：compaction 带摘要请求的 usage、v1 读回为 v2；`packages/agent/src/models/models.test.ts`：价格写入 `model.cost`、已定价判定、负数拒绝。
- `tests/integration/sidecar-goal-budget.test.ts`：每一维单独设上限，耗尽为 budget-exhausted 且 reason 写明维度、工具调用上限时超出的调用不执行且文件逐字节不变、被拦下的 write 没有 `file_backup`、命令输出伪造拦下前缀时仍计为调用、调高后恢复直到完成；Goal running 且 Token 已耗尽时 `/compact` 不发摘要请求、没有 `compaction`，Goal 为 budget-exhausted（对手用例），Goal paused 时 `/compact` 照常；未定价模型设费用上限时 blocked 且 Goal 没有模型请求。
- `tests/integration/sidecar-model-price.test.ts`：`provider.save` 保存价格并读回（含重启）、assistant 的 `usage.cost` 与手算期望一致、负数价格得到 bad-request、没有价格的目录照常可用；`apps/server/src/control/channel.test.ts`：不合 schema、带 requestId 的控制请求立即得到失败回答。
- `apps/desktop/src/renderer/features/settings/model-price.browser.test.tsx`：价格输入与校验、编辑回显与清空、费用货币。
- `tests/integration/sidecar-goal-restart.test.ts`：Goal Round 中 SIGKILL，重启后 paused（restarted）、30 秒内没有新的 run_start，恢复后继续。
- `apps/desktop/src/renderer/features/conversation/dock/goal-card.browser.test.tsx`：九个阶段的徽标与原因（zh / en）、预算条阈值与颜色、未定价时显示提示而不是 0、取消需确认与清理结果、key 为 goalId 与 criterionId、budget-exhausted 时恢复不可用与编辑预算、revision 冲突、`/goal` 打开空状态不发送、助手底栏不展示费用、Session 费用分项保留。
- `apps/desktop/e2e/goal.e2e.test.ts`（真实 Electron + Sidecar + faux 多轮）：Goal 卡在 Todo 与 Queue 之间、轮次随 Goal Round 增长、暂停后不推进与恢复、工具调用上限耗尽后编辑预算再恢复、完成后显示证据；底栏用量、标题栏费用与条目及 `GET …/goal` 一致；明暗主题、390 px 窗口与键盘操作。
- `tests/integration/secrets-gate-goal.test.ts`：目标、约束、条件与证据含登记 Secret 时 goal 条目、工具结果、WebSocket、HTTP（含用量字段）、库、requestLog（`<goal>` 的用量行、`<goal_round>`）与日志中没有明文。

**已知限制**：一个只填了全 0 价格的模型算已定价，费用上限永远不会耗尽。

## 延伸阅读

- [后台任务](jobs.md)：Job 的完成通知与 `job_end`。
- [权限判定与审批](permissions.md)：session-state 与 context-read 权限类。
- [启动恢复与结果确认](recovery.md)：领域恢复钩子的顺序。
