---
kind: reference
description: "当前的 Goal 契约：goal 条目（完整快照与 revision）、九阶段的转换表、create_goal / get_goal / update_goal 的授权与完成证据、Goal Round 的推进与去重（GoalDriver）、wait_jobs 与 Job 结束后的唤醒、五维预算（从条目派生的口径与三个检查点、未定价模型）、<goal> 与 <goal_round> 注入、/goal 命令与 /api/sessions/:id/goal、取消的停止传播与重启后暂停。修改 Goal 的状态机、推进、预算、工具、注入或接口前查阅。"
lifecycle: active
---

# Goal

本文说明 Coko 当前如何让 Agent 跨多个 Run 推进一个 [Goal](../../GLOSSARY.md)：模型在用户请求的 Run 中用 `create_goal` 记下目标与成功条件，之后 Sidecar 在 Session 空闲时逐轮发起 [Goal Round](../../GLOSSARY.md)，直到模型为每条条件给出证据、需要用户输入、等待后台任务、轮次用尽或被用户暂停。五维预算（轮次、工具调用、Token、费用、时间）从已提交的条目派生，在调用前检查。决定见 [ADR 0011](../adr/0011-goal-state-as-session-entries.md)。Goal 卡与 Run 用量的界面尚未实现。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/goals/state.ts` | 转换表 `GOAL_TRANSITIONS` 与 `applyGoalChange`、`createGoalSnapshot`、`validateEvidence`、`runAuthority`、`goalRounds`、`currentGoal`、`GoalError`；预算判定 `exhaustedDimension`、`exhaustedMessage`、`GOAL_BUDGET_DIMENSIONS`、`COST_UNPRICED_MESSAGE` |
| `packages/agent/src/goals/budget.ts` | 预算派生：`goalRunIds`（属于 Goal 的 Run）、`goalUsage`（五维用量，接受子 Session 的条目） |
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
- Goal 为 waiting-input 时，用户提交（或回答审批之后）的 Run 正常结束 → running。
- 预算停止（`run_end.error.code` 为 `budget_exhausted`、`cost_unpriced`）→ budget-exhausted（`reason.code` 为消息中的维度）/ blocked（`cost-unpriced`），见 [预算](#预算)。
- 之后 Goal 为 running 且该 Run 正常结束、没有退回用户写的追加指令时发起下一轮。

## 推进

`GoalDriver.advance` 在 Session 的锁内执行，因此同一 Session 的推进串行：Session 有 Run 时不发起；重读当前 Goal，不是 running 时不发起；轮次 = 该 Goal 的 `run_start.goal.round` 的最大值；检查五维（[预算](#预算)），任一维度用尽时提交 budget-exhausted，设了费用上限而模型未定价时提交 blocked（`cost-unpriced`），都不开始 Run；否则以 `trigger: goal`、`goal { goalId, round: n + 1 }` 调用统一入口 `startRun`。下一轮的轮次取自已提交的 `run_start`，同一轮不会开始两次；用户先开始了 Run（`run-in-progress`）、有未回答的结果确认、回退或分叉进行中时放弃这次发起。挂起的 Job 通知（`pendingInput`）照常合并在 `<goal_round>` 之前。

Goal Round 中用户照常可以追加指令、停止与回答审批；提交新消息以 `run-in-progress` 拒绝。

**等待 Job。** `wait_jobs` 只接受本 Session running 的 Job，快照记 `waitingFor.jobIds`。GoalService 在 Goal 处于 running / waiting-* 时订阅该 Session 的 `job_end`：等待的 Job 全部结束后回到 running，Session 空闲时立即发起下一轮。没有 Goal 的空闲 Session 不因 Job 结束而开始 Run。

**Job 的归属。** Session 有未终结的 Goal 时启动的后台 Job 在 `job_start` 与快照中带 `goalId`。

## 预算

**口径**（`goalUsage`，每次检查时从条目重新计算，不另存计数器）。属于 Goal 的 Run：`run_start` 时 Goal 处于非终态且不是 paused 的 Run（含用户提交的，以及 waiting-input、blocked 期间开始的），和该 Goal 的 Goal Round；创建 Goal 的那个 Run 开始时还没有 Goal，不计。

| 维度（`reason.code`） | 已用 | 上限 |
| --- | --- | --- |
| `rounds` | 该 Goal 的 Goal Round 数（用户提交的 Run 不计） | `maxRounds`，缺省 50 |
| `tool-calls` | 这些 Run 的 toolResult 数（被拒绝的调用照常计入，工具调用上限拦下的不计） | `maxToolCalls` |
| `tokens` | assistant usage 的 input + output + cacheRead + cacheWrite，加 `compaction.usage`（摘要请求） | `maxTokens` |
| `cost` | 同一组 usage 的 `cost.total`（不换算货币） | `maxCost` |
| `time` | 各 Run `run_end.createdAt − run_start.createdAt` 之和（含审批等待，不含 Run 之间；进行中的 Run 计到此刻） | `maxDurationMs`（毫秒） |

已用 ≥ 上限即耗尽；多维同时耗尽时按上表顺序取第一个。汇总函数另接受子 Session 的条目（全部 Run 计入，不计轮次），M4 没有调用方。

**检查点**（只对 running 的 Goal 与属于它的 Run）：

- **Goal Round 开始前**（`GoalDriver.advance`）：五维；未定价检查。
- **每次模型请求前**（`beforeRequest`，自动压缩之后）：Token、费用、时间，设了 `maxCost` 而模型未定价时 `cost_unpriced`。返回 stop 时该次请求不发出，Run 以 `run_end { status: paused, error: { code: budget_exhausted | cost_unpriced, message } }` 结束。
- **每次工具调用前**（权限判定与 Checkpoint 备份之后的 hook）：已提交的调用数加本 Run 已放行、结果尚未提交的调用数（同一批的调用先放行、后提交结果，检查按 Session 串行）达到 `maxToolCalls` 时该调用不执行，结果为错误 `Goal budget exhausted: tool calls (n / max)`，并要求 Run 本批完成后停止（`stopAfterBatch`）；同一批中先到的调用照常执行。

耗尽的消息形如 `Goal budget exhausted: tokens (1050 / 1000)`（费用最多 6 位小数，时间带 `ms`）。Run 结束后 Goal 进入 budget-exhausted；恢复前须用 edit 使该维度有余量（`budget` 整体替换），否则 409 `invalid-transition`。

**未定价模型。** 模型的 `usage.cost` 来自 Model Catalog 的 `price`（见 [模型价格](#模型价格)）；没有价格时为 0。设了 `maxCost` 而 Session 的模型未定价：Goal Round 不开始、请求不发出，Goal 为 blocked（`cost-unpriced`）；恢复后在下一次推进时同样 blocked，直到为模型填写价格或去掉费用上限。`GET …/goal` 的 `usage.costUnpriced` 为当前模型是否未定价。

## 模型价格

Model Catalog 的模型可带 `price { input, output, cacheRead?, cacheWrite? }`（每百万 token，非负；缓存价格省略为 0），经 `provider.save` 保存，负数或非有限数为 400 `bad-request`；没有 `price` 的旧目录照常可用。注册表把价格写入 pi-ai 的 `model.cost`，pi-ai 按模型服务返回的 usage 计算每条 assistant 消息的 `usage.cost`。目录中带 `price` 的模型算已定价（全部为 0 也算）；不经目录注册的 Provider（测试用 faux）按 `cost` 是否有非零单价判定，faux 脚本可设 `price`。全局设置 `usage.currency`（`USD` / `CNY`，缺省 USD）只决定界面的货币符号。设置 → 模型服务：顶部选择费用货币，模型选项中填写四项价格（留空为未定价；填了价格时输入与输出必填）。

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

## 取消与重启

**取消**（HTTP 或 `/goal cancel`）：先标记该 Session 正在取消（Run 结束、Job 结束与模型的 Goal 工具都不再改变 Goal），停止进行中的 Run 并等待其 `run_end`（至多 30 秒，超出记入 failures），再终止 `goalId` 为此 Goal 的 running Job 并等待 `job_end`，最后提交 cancelled 快照与 `cleanup { runsAborted, jobsKilled, failures }`。失败项不阻止取消。请求在这些都完成后返回。

**重启**：启动恢复在 Session 恢复与 Job 补记 lost 之后，把 running、waiting-input、waiting-external 的 Goal 提交为 paused（`reason.code: restarted`，source system）。不会自动继续，由用户恢复。

**已知限制**：有序关闭中断进行中的 Goal Round 时，该 Run 以 aborted 结束，Goal 被记为 paused（`user-stopped`）而不是 `restarted`；两者都需要用户恢复。

## 验证

- `packages/agent/src/goals/goals.test.ts`：转换表每一行与每个非法组合、resume 与 edit 的 resumedAtRound、budget-exhausted 恢复须有余量、创建的校验、完成证据（缺条件、空文本、未知条件、引用不存在或出错的调用）、各动作在 user / 本 Goal 的轮 / 其他 Goal 的轮 / none 四种 Run 中的授权、blocked 的 3 轮阈值、revision 过期、`runAuthority`、`<goal>` 与 `<goal_round>` 文本。
- `tests/integration/sidecar-goal.test.ts`：create_goal 之后 Goal Round 依次开始直到完整证据的 complete；轮次耗尽、POST 动作与 409；Goal Round 中的审批、停止为 waiting-input、用户提交后回到 running、追加指令授权 edit 与同一轮不重复；wait_jobs 后 Job 结束时下一轮开始；取消停止 Run 与 Job 并记 cleanup；`/goal` 的动作；分叉与回退。
- `packages/agent/src/goals/budget.test.ts`：五维派生（属于 Goal 的 Run、paused 期间不计、用户提交的 Run 不计轮次、compaction.usage、进行中的 Run、拦下的调用不计）、子 Session 汇总、耗尽的维度与消息、按完整用量判定恢复、`<goal>` 的用量行；`packages/agent/src/engine/compaction.test.ts`：compaction 带摘要请求的 usage、v1 读回为 v2；`packages/agent/src/models/models.test.ts`：价格写入 `model.cost`、已定价判定、负数拒绝。
- `tests/integration/sidecar-goal-budget.test.ts`：每一维单独设上限，耗尽为 budget-exhausted 且 reason 写明维度、工具调用上限时超出的调用不执行且文件逐字节不变、调高后恢复直到完成；未定价模型设费用上限时 blocked 且 Goal 没有模型请求。
- `tests/integration/sidecar-model-price.test.ts`：`provider.save` 保存价格并读回（含重启）、assistant 的 `usage.cost` 与手算期望一致、负数价格 400、没有价格的目录照常可用。
- `apps/desktop/src/renderer/features/settings/model-price.browser.test.tsx`：价格输入与校验、编辑回显与清空、费用货币。
- `tests/integration/sidecar-goal-restart.test.ts`：Goal Round 中 SIGKILL，重启后 paused（restarted）、30 秒内没有新的 run_start，恢复后继续。
- `tests/integration/secrets-gate-goal.test.ts`：目标、约束、条件与证据含登记 Secret 时 goal 条目、工具结果、WebSocket、HTTP（含用量字段）、库、requestLog（`<goal>` 的用量行、`<goal_round>`）与日志中没有明文。

**已知限制**：一个只填了全 0 价格的模型算已定价，费用上限永远不会耗尽；Checkpoint 的备份在工具调用上限的检查之前，被拦下的 write / edit 仍可能留下一份备份（Workspace 文件不变）。

## 延伸阅读

- [后台任务](jobs.md)：Job 的完成通知与 `job_end`。
- [权限判定与审批](permissions.md)：session-state 与 context-read 权限类。
- [启动恢复与结果确认](recovery.md)：领域恢复钩子的顺序。
