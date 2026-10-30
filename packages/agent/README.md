---
kind: reference
description: "@coko/agent 的运行时入口、运行控制（steer、pause、continue）、工具契约（effect、permissionSubject、sandboxRequest、secrets、probeOutcome、执行上下文）、工具调度与执行记录（tool_exec、幂等键）、命令沙箱接缝与 Secrets 端口。注册宿主工具、装配运行时、实现执行端口或解读工具相关条目前查阅。"
lifecycle: active
---

# @coko/agent

Coko 的 coding-agent 框架层：在 pi-agent-core 1.4.0 的 `Agent` 上实现运行生命周期、内置工具、权限判定与审批、工具调度和 Session Entry 的 payload 定义。项目级约定见 [Agent 运行时约定](../../docs/tech-stack/agent-runtime.md)；权限判定与审批见 [权限判定与审批](../../docs/subsystems/permissions.md)。本文覆盖运行控制（追加指令、暂停与继续）、工具契约、调度与执行记录、命令沙箱接缝与 Secrets 端口。Checkpoint 的文件备份已实现（write / edit 修改前保存原内容）；启动恢复的判定（`planRecovery`）见 [启动恢复与结果确认](../../docs/subsystems/recovery.md)。回退与分叉的纯函数（`effectiveEntries`、`planRewind`、`restoreFiles` 在 `src/checkpoints/rewind.ts`，`forkEntries` 在 `src/agents/fork.ts`；宿主端口 `SnapshotPort`、`RewindFiles` 在 `src/ports/checkpoints.ts`）的决定见 [ADR 0006](../../docs/adr/0006-file-checkpoints-and-rewind.md)。

## 使用或结构入口

| 入口 | 内容 |
| --- | --- |
| `@coko/agent` | `createAgentRuntime`、工具注册表与内置工具、`CokoTool` 契约、`withTimeout`、Session Entry payload（`SESSION_ENTRY_PAYLOADS` 及各 kind 的 schema）、policy 与 ports（沙箱与 Secrets 的类型经 policy barrel 导出：`SandboxPolicy`、`LocalSandbox`、`SandboxUnavailableError`、`SecretProvider` 等）；模型层：`createModelRegistry`（推理开关打开的 Anthropic 模型以 adaptive thinking 的 effort 发送所选档位的参数值）、`selectableThinkingLevels`、`listProviderModels`（按协议请求供应商的模型列表；Anthropic 跟随 `has_more`，至多 `MAX_MODEL_PAGES` 页；失败为 `ListModelsError`，时限与脱敏由宿主负责）、`isHttpUrl` |
| `@coko/agent/entries` | 浏览器安全的条目派生（唯一实现）：`effectiveEntries(entries, { compacted? })`（回退区间；`compacted` 时再应用最后一个有效的 compaction）、`rewoundRanges`、`lastRunStatus`、`unansweredConfirmations`、`modelContext`（有效条目 → 模型消息，压缩后为合成摘要消息 + firstKeptSeq 及之后）。只导入 typebox 与本目录内模块，server、renderer 与 agent 内部都从这里导入；`@coko/agent` 原样转出 |
| `@coko/agent/testing` | faux 模型、临时 Workspace、grep 契约测试套件；只供测试文件导入 |

`createAgentRuntime(options)` 返回一个 Session 的运行时：`run(text)`、`retry()`、`continue()`、`steer(text)`、`pause()`、`abort()`、`answerApproval()`、`subscribe()`。每个已提交事实都以 `RunEntry`（`{ kind, runId?, payload }`）经 `options.commit` 交给宿主，提交兑现后 Run 才继续；提交被拒绝时 Run 以 `commit_failed` 结束。

`src/engine/` 的划分：`runtime.ts`（`createAgentRuntime`：Run 生命周期、事件到条目与进度、运行控制）、`types.ts`（`AgentRuntimeOptions`、`AgentRuntime` 与 Run 的类型）、`compaction-driver.ts`（压缩编排：摘要请求、熔断、手动 / 自动 / 溢出三个触发点，运行时只在 `prepareRequest` 与 `compact()` 接线）、`system-message.ts`（基础提示与 system sections 组成的开头系统消息）、`permission-wiring.ts`（权限判定在运行时的接线：链首判定、执行前准备、沙箱拒绝记录）、`retry.ts`（模型请求的重试）。

## 契约与生命周期

### 运行控制

每个 Run 以 `run_start { trigger, goal? }` 开始（submit / retry / continue / compact / goal；v1 条目原样迁移为 v2），以 `run_end { status, error?, undeliveredSteering? }` 结束。

- **M4 运行控制。** `RunInput.trigger?`（缺省 submit）与 `RunInput.goal? { goalId, round }` 写入 run_start。`stopAfterBatch(error)`：当前工具批次完成并提交结果后不再发出请求，Run 以 `paused` 加该 error 结束（最后一轮只有文本时同样为 paused，与 `pause()` 不同）；没有 Run 时抛 `NoActiveRunError`。`RuntimeContext.beforeRequest` 返回 `{ stop: RunError }` 时该次请求不发出，等同 `stopAfterBatch`（错误码 `budget_exhausted`、`cost_unpriced`）。条目 kind `goal`、`todo_list`、`plan`、`job_start`、`job_end`、`job_notification` 的 schema 在 `session-entries/{goals,tasks,planning,jobs}.ts`，`forkEntries` 不复制它们；`compaction` v2 另带摘要请求的 `usage`（`RequestUsage`，v1 原样迁移）。权限类 `session-state` 与 `plan-exit` 见 [权限判定](../../docs/subsystems/permissions.md#模式)。
- **M5 运行时接缝。** `RunInput.trigger` 另有 `schedule`（带 `schedule { scheduleId, occurrence }`，写入 run_start v3）、`subagent` 与 `handoff`。`handoff` 是摘要模式：一次请求，带有效上下文与调用方的提示、没有工具、经过 `beforeRequest`；只提交 run_start / run_end，对话记录不变；完成时回复文本在 `RunResult.summary`，usage 在 `summaryUsage`。`RuntimeContext.beforeCompact({ trigger, instructions? })` 在手动与自动压缩有可摘要内容时、摘要请求之前调用（溢出恢复不调用）：`{ block }` 使自动压缩跳过本次（请求照常）、手动压缩以 error `hook_stopped` 结束；`{ instructions }` 追加为摘要要求。`RuntimeContext.onStop(info)` 在对话 Run（不含 compact、handoff）正常结束前调用：返回 `{ continue }` 时以该 user message 再请求一次，每个 Run 至多 `ONSTOP_CONTINUE_LIMIT`（3）次，之后仍调用但忽略。`RunErrorCode` 增加 `hook_stopped`、`max_turns`，`stopAfterBatch` 接受它们。`runAuthority` 对 schedule、subagent、handoff 的 Run 总是 none；`goalUsage` 把 `handoff` 条目的 usage 与 compaction 一样计入其 Run。新条目 kind 的 schema 在 `session-entries/{hooks,agents,schedules,handoff}.ts`，`forkEntries` 不复制它们；`approval_decision` v2 增加 `by?: user / hook`。权限：`decideWithStep` 给出判定步骤，权限类 `agent` 与 `automation`，gate 的可选 `PermissionHookPort`（`extensions/hooks/` 的类型），见 [权限判定](../../docs/subsystems/permissions.md#判定)。
- **M4 领域（纯函数与工具，宿主负责读写条目与加锁）。** `goals/`：状态机 `applyGoalChange` 与授权 `runAuthority`、完成证据 `validateEvidence`、预算维度的描述表 `GOAL_BUDGET_DIMENSIONS`（维度映射的唯一来源）、预算派生 `goalUsage` / `goalRunIds`（`children` 为子 Session 预留，目前没有调用方）与判定 `exhaustedDimension` / `exhaustedMessage`、模型可见的费用文本 `costText`、`<goal>` 与 `<goal_round>` 文本、`get_goal` / `create_goal` / `update_goal`（`GoalToolPort`），见 [Goal](../../docs/subsystems/goal.md)。`planning/`：`exit_plan_mode`（`createExitPlanModeTool`、`planReviewOf`）、`<plan_mode>` 与 `<approved_plan>`，见 [Plan Mode](../../docs/subsystems/plan-mode.md)。`tasks/todo/`：`todo_write`（`normalizeTodoItems`、`createTodoTool`）与 `<todo_list>`，见 [Todo List](../../docs/subsystems/todo.md)。`tasks/jobs/`：`BackgroundJob` 与输出环形缓冲 `OutputRing`、`job_output` / `job_list` / `job_kill` / `job_input`（`JobsPort`）、完成通知文本（开头标签 `JOB_NOTIFICATION_TAG` 从 `@coko/agent/entries` 导出，宿主与 renderer 引用），见 [后台任务](../../docs/subsystems/jobs.md)。`ports/pty.ts` 的 `PtyPort`（agent 不依赖 node-pty）与 `ports/exec.ts` 的生命周期回调 `onSpawn` / `onExit`，见 [命令执行与子进程登记](../../docs/subsystems/execution.md)。模型层：`ModelSpec.price`（每百万 token）写入 `model.cost`，`ModelRegistry.priced(model)` 判定是否已定价。内置命令表含 `plan`、`goal`（动作由宿主贡献实现）。

- **输入与上下文 seam（M3）。** `run(input)` 与 `steer(input)` 接受字符串或 `RunInput { text, content?, before? }`：`content` 替换 user message 的内容，`before` 的条目在 run_start 之后（steer 时紧接在该 user message 之前）、user message 之前提交；未送达的追加指令退回的是 `text`。`options.context`（`RuntimeContext`）：`systemSections()` 每个 Run 开始时取一次，有非空段落时开头的系统消息改为 `sections`（`BASE_SYSTEM_SECTION` 为第一段、内容为基础提示），没有时保持 M2 的基础提示；`transformMessages` 只改发给模型的请求（pi `transformContext`），不改条目与对话记录；`beforeRequest` 在每次模型请求之前调用（pi `prepareRequest`）。每条 assistant 消息提交后发 progress `context_usage { tokens, contextWindow }`（tokens 为该消息 usage 的 input + cacheRead + cacheWrite + output）。
- **压缩（M3）。** `options.compaction`（`RuntimeCompaction { entries, autoCompact, keepRecentTokens? }`）开启后，每次模型请求前估算越过阈值时自动压缩（在 `context.beforeRequest` 之前），请求以上下文溢出失败时压缩一次并重试一次；`compact(instructions?)` 开始 `run_start { trigger: compact }` 的 Run，摘要请求之前经 `context.beforeRequest`（返回 stop 时不压缩，Run 以 paused 加该 error 结束），只提交 `compaction`；`compaction` 属性给出 `{ consecutiveFailures, paused }`（连续 3 次自动失败后暂停，成功的压缩复位）。压缩提交 `compaction` 条目，按条目（`modelContext`）重建对话记录并发 `compaction_start` / `compaction_end` / `compaction_failed`；停止时不提交条目。`forkEntries` 复制最后一个 compaction 与其保留的消息。见 [压缩](../../docs/subsystems/context.md#压缩)。
- **M3 扩展点。** `instructions/shared`（只读文件端口 `createNodeFiles`、按 mtime 缓存 `createMtimeCache`、诊断 `ResourceDiagnostic`、`yaml` frontmatter 解析 `parseFrontmatter`）；`instructions/{rules,commands,skills}`、`context/{references,memory,usage,compaction}`、`extensions/mcp` 已实现（见 [docs/subsystems](../../docs/README.md)；`context/usage` 为预算、估算与时间裁剪，`context/compaction` 为切点、摘要提示、压缩后的估算与熔断）；内置遍历 `tools/builtin/walk.ts` 另读 `.git/info/exclude` 与全局 excludes（[忽略规则](../../docs/subsystems/context.md#忽略规则)）；`config/` 的 `capabilityConfigSchema` 与 `defaultCapabilityConfig()`。Session Entry 另有 `command` 与 `compaction`（`session-entries/context.ts`）。

- **追加指令（Steering）。** `steer(text)` 把消息送进当前 Run：当前工具批次结束后、下一次模型请求前送达（pi `steer()`，一次送达全部已发送的），送达时提交为普通 user message 条目，位于这批 toolResult 之后、下一条 assistant 之前。最后一轮只有文本时也会送达，模型再回应一次。Run 以停止、暂停、无反馈拒绝或错误结束时，未送达的追加指令按发送顺序放进 `run_end.undeliveredSteering` 与 `RunResult.undeliveredSteering`，不延续到下一个 Run。没有 Run 时抛 `NoActiveRunError`。
- **暂停。** `pause()`：当前工具批次正常完成并提交 toolResult，之后不再发起模型请求（`finishTurn` 返回 end），不杀进程；等待中的审批以 cancelled 结束，该调用不执行，toolResult 为 `PAUSED_BEFORE_APPROVAL_TEXT`。Run 以 `paused` 结束；暂停发生在只有文本的最后一轮时工作已完成，Run 以 `completed` 结束。没有 Run 时抛 `NoActiveRunError`。
- **继续。** `continue()` 开始新 Run（trigger continue，不追加用户消息），只在上一 Run 为 `paused` 或 `interrupted` 且对话末尾是用户消息或工具结果时允许，否则抛 `NothingToContinueError`；Run 进行中抛 `RuntimeBusyError`。从条目恢复的运行时由宿主以 `lastRunStatus` 传入上一 Run 的状态。是否有待确认结果由宿主检查（[结果确认](../../docs/subsystems/recovery.md#结果确认)）。
- **停止。** `abort()`：等待中的审批 cancelled，未送达的追加指令随 run_end 退回，Run 以 `aborted` 结束。

### 工具契约

`CokoTool`（`src/tools/types.ts`）是 pi 的 `AgentTool` 加以下字段。名称、描述、参数与 outputSchema 是覆盖时必须保持的契约；其余字段属于实现，覆盖时应沿用内置工具的值。

| 字段 | 含义 |
| --- | --- |
| `effect` | `read`：没有副作用；`side-effect`：可能改变文件、进程或外部状态。缺省按 `side-effect`。内置 read、grep、find、ls 为 read，write、edit、bash 为 side-effect |
| `permissionSubject(args)` | 权限判定看的对象：文件工具返回路径，bash 返回命令；缺省只按工具名判定 |
| `sandboxRequest(args)` | 该次调用请求的提权 `{ mode?, justification? }`（bash 的 `sandbox_permissions` / `justification`），由权限 gate 校验；缺省表示工具不能提权 |
| `secrets` | 工具需要的密钥名；运行时每次调用经 `options.secrets`（`SecretProvider`）解析，只放进该次调用的执行上下文。缺失时调用失败（`Missing secret <NAME> declared by tool <name>`），不执行，也不提交 `tool_exec` |
| `probeOutcome(args, cwd)` | 恢复时判断一个已开始（有 `tool_exec`）的 side-effect 调用是否已生效：`applied` / `not-applied` / `unknown`，只读当前状态。内置 write 比对内容、edit 检查新旧文本，bash 没有；缺省时交给用户确认，见 [启动恢复与结果确认](../../docs/subsystems/recovery.md#判定分类) |
| `timeoutMs` | 单次调用的时限；`0` 关闭统一超时（工具自己管理，如 bash 的 `timeout` 参数）；缺省用运行时默认（10 分钟） |
| `execute(toolCallId, params, signal, onUpdate, context)` | 第五个参数是执行上下文 `ToolExecutionContext`：`{ idempotencyKey, sandbox?, secrets?, readDenied? }`。`sandbox` 是该次调用的命令沙箱策略（有权限判定时总会给出）；`secrets` 只含该工具声明的密钥，工具只应交给自己的子进程；`readDenied(path)` 在有带内容的 Read 拒绝规则时给出，grep、find、ls 不列出它命中的路径。运行时总会传入；直接调用工具（测试）时可缺省 |

### 调度

运行时用一个调度器（`src/tools/scheduler.ts`）包住每个工具的 execute。pi 先按调用顺序逐个执行 `beforeToolCall`（权限判定与审批），所以审批请求逐个出现；通过的调用再交给调度器：

- **并发上限。** 同时执行的调用至多 `toolConcurrency` 个（默认 10，须为正整数，否则创建运行时抛 `RangeError`）。
- **effect 分区。** read 调用共享执行槽；side-effect 调用是独占屏障：等排在它前面的调用全部完成才开始，排在后面的调用等它完成。排队按调用顺序，后面的 read 不越过等待中的 side-effect。同一文件的写入另由 file-mutation-queue 串行。
- **执行前的准备。** 取得执行槽之后、执行记录之前：write / edit 按执行时的真实路径复核目标（与判定时不同则重新判定，见 [权限判定与审批](../../docs/subsystems/permissions.md#命令沙箱与提权)）；按执行时的模式现算沙箱档位；解析声明的密钥；给出读取过滤。任一步失败时调用不执行、不提交 `tool_exec`。
- **时限。** 超时在调度之内计时：排队等待与执行前的准备不计入。忽略取消信号的调用在宽限期后被放弃，并释放执行槽。
- **取消。** `abort()` 时，执行中的调用收到 signal；排队中的调用不执行，结果为 `Operation aborted` 错误，也不提交执行记录。
- **顺序。** `tool_start` / `tool_end` progress 按实际开始与完成顺序；toolResult 条目按模型的调用顺序提交。

### 执行记录与幂等键

side-effect 调用取得执行槽、完成执行前的准备之后、execute 之前，运行时提交一条 `tool_exec` 条目（payload `{ toolCallId, toolName, idempotencyKey }`，schema 在 `src/session-entries/tools.ts`），read 调用不提交。一个经审批的调用在 Session 中的条目顺序是：

```text
assistant（含 toolCall） → approval_request → approval_decision → tool_exec → toolResult
```

- **幂等键。** `<sessionId>:<toolCallId>`（`idempotencyKeyFor`），由 `options.sessionId` 组成；缺省时每个运行时用一个随机 id，键在运行时之外不可复现，宿主应总是传入。同一个键经执行上下文交给工具，供外部能力去重。
- **提交失败。** `tool_exec` 提交被拒绝时该调用不执行，Run 停止并以 `commit_failed` 结束；同批排队中的调用按取消处理。
- **含义。** 有 `tool_exec` 而没有 toolResult 的调用"可能已执行"；没有 `tool_exec` 的调用一定没有开始。记录提交后、执行前被取消的调用不会开始执行。启动恢复（`src/recovery/`）据此分类，见 [启动恢复与结果确认](../../docs/subsystems/recovery.md)。

### 命令沙箱接缝

- **档位。** 有 `permissions` 时，运行时在执行记录之前按当时的模式现算 `sandbox = { mode, writableRoots, protectedNames? }`（`policy/sandbox.ts`，与文件工具的可写根同一推导；workspace-write 下 `protectedNames` 为受保护路径段，宿主沙箱在可写根之下也拒绝写入它们）；已批准的提权取目标档位与执行时模式档位中较宽者，只用于该调用。没有 `permissions` 时不设沙箱，命令不受限。
- **执行端口。** `ExecRequest.sandbox` 为受限档位（read-only、workspace-write）时，端口必须实施限制，做不到就以 `SandboxUnavailableError`（`code: 'sandbox-unavailable'`）拒绝且不运行命令；`danger-full-access` 或省略为不受限。`ExecOutcome` 的 `sandboxDenied` 表示受限命令非零退出且输出含拒绝签名。
- **本地执行。** `createLocalExecPort({ sandbox?: LocalSandbox })`：`LocalSandbox.wrap(policy)` 返回包裹 `<shell> -c <command>` 的 argv 前缀（可抛 SandboxUnavailableError），`denialSignature` 为拒绝签名。本包不带沙箱实现（没有系统二进制依赖），不传时受限档位一律 fail-closed；Sidecar 传入 Seatbelt（`apps/server/src/adapters/seatbelt.ts`）。
- **bash。** 被拒绝时在退出码之前追加拒绝标记与提权提示，`details.sandbox = { mode, denied: true }`；端口报告不可用时以 `sandbox-unavailable: …` 错误结束。提权的判定与审批见 [权限判定与审批](../../docs/subsystems/permissions.md#命令沙箱与提权)。

## 配置与限制

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `toolConcurrency` | 10 | 同时执行的工具调用上限 |
| `timeouts` | 10 分钟 / 宽限 5 秒 | `defaultTimeoutMs`、`graceMs` |
| `sessionId` | 随机 | 幂等键的 Session 部分 |
| `permissions` | 不判定 | 缺省时不做权限判定，也不设命令沙箱（无回答通道的库调用方）；server 总是传入。`readRoots()` 给出额外读取根；工具的权限类在注册时给出（`RegisterToolOptions.permissionClass`），见 [权限判定与审批](../../docs/subsystems/permissions.md#模式) |
| `context` | 无 | `RuntimeContext`：system sections、只改请求的消息变换、请求前钩子 |
| `compaction` | 无（不压缩，`compact()` reject） | `RuntimeCompaction`：已提交条目（带 seq）、`context.autoCompact`、保留的最近 tokens（缺省 20 000） |
| `secrets` | 无 | `SecretProvider`；声明了 `secrets` 的工具在缺省时调用失败 |
| `lastRunStatus` | 无 | 上一 Run 的结束状态（从条目恢复时），决定能否 `continue()` |

- 未声明 `effect` 的宿主工具按 side-effect 独占执行并提交执行记录；只读的宿主工具应声明 `effect: 'read'` 才能并行。
- 在持有独占执行槽的工具内部再经同一运行时调度另一个工具会等待自己，形成死锁；目前没有这样的调用路径。
- 被放弃（超时后不响应取消）的调用释放执行槽时，其底层操作可能仍在后台运行。

## 验证与相关设计

- `src/entries/entries.test.ts`：有效条目（回退区间、压缩、压缩落在被回退区间时原历史生效）、`modelContext`、`lastRunStatus`、`unansweredConfirmations` 的表驱动用例；导入守卫断言该子路径（含传递导入）不导入 `node:*` 与 `@earendil-works/*`。`src/engine/context-seam.test.ts`：system sections、`RunInput.before` 的位置、`transformMessages` 只改请求、`context_usage`。`src/instructions/shared/shared.test.ts`：frontmatter、mtime 缓存、文件端口与配置默认值。`src/context/compaction/compaction.test.ts`：切点、摘要提示、文件与 Skill 汇总、压缩后的估算与熔断；`src/engine/compaction.test.ts`：运行时的自动、溢出、熔断、手动压缩与停止。
- `src/engine/run-control.test.ts`：工具执行中 steer 的条目位置与下一次请求上下文、多条按序送达、abort 退回未送达、只有文本的最后一轮也送达、暂停边界（工具完成、不发新请求、待审批 cancelled 且不执行）、continue 的允许条件与 `lastRunStatus`。交叠由 deferred 控制。
- M4 领域：`src/goals/goals.test.ts`（转换表、授权、证据）与 `src/goals/budget.test.ts`（五维派生、`children` 接口、耗尽判定）、`src/goals/dimensions.test.ts`（描述表）、`src/planning/planning.test.ts`、`src/tasks/todo/todo.test.ts`、`src/tasks/jobs/jobs.test.ts`（游标与 ANSI 去除），均为表驱动；`src/models/models.test.ts` 另覆盖价格与已定价判定。
- `src/engine/host-stop.test.ts`：`stopAfterBatch` 在批次完成后结束、只有文本的最后一轮仍为 paused 加 error、`beforeRequest` 返回 stop 时不发出请求（第一次请求前与工具结果之后）、`RunInput.trigger: goal` 写入 run_start v2。交叠由 deferred 控制。`src/agents/fork.test.ts`：分叉不复制 M4 条目（表驱动）。`src/session-entries/session-entries.test.ts`：M4 kind 的示例 payload 与越界取值、run_start v1 → v2。
- `src/tools/scheduler.test.ts`：上限 2 时 6 个 read 至多 2 个同时执行、结果按调用顺序；默认上限 10；`[read, read, write, read]` 的屏障顺序；`tool_exec` 在 execute 之前提交、上下文携带幂等键、read 不提交；提交失败时不执行且 Run 以 `commit_failed` 结束；排队中取消返回 `Operation aborted` 且没有 `tool_exec`。交叠由 deferred 控制，不用 sleep。
- `tests/integration/sidecar-concurrency.test.ts`：真实 Sidecar 中 bash 的 `tool_exec` 位于 assistant 之后、toolResult 之前，幂等键为 `<sessionId>:<toolCallId>`，同批 ls 没有 `tool_exec`，重启后读回一致。
- `tests/integration/secrets-gate.test.ts`：`tool_exec` 条目在秘密不外泄总闸的扫描范围内。
- `src/recovery/plan.test.ts`：`planRecovery` 的分类与 write / edit 的结果探测（真实内置工具、临时 Workspace）。
- `src/policy/execution-checks.test.ts`：目录工具的读取拒绝过滤、判定后目标被替换时重新询问且不提交 `tool_exec`、缺失密钥不提交 `tool_exec`、提权须先被沙箱拒绝、暂停只改写被取消的审批、重新判定后原因变化时重新询问；`src/tools/builtin/read-filter.test.ts`：grep / find / ls 的过滤。
- `src/policy/escalation.test.ts`：四种模式下交给执行端口的沙箱策略与可写根、提权与 Secrets 注入（只给声明的工具、缺失时不执行、值不进条目）；`src/ports/local-exec.test.ts`：包裹接缝与 fail-closed；`src/tools/builtin/bash.test.ts`：拒绝标记与 sandbox-unavailable。真实 Seatbelt 由 `apps/server` 的 `seatbelt.test.ts` 与 `tests/integration/sidecar-sandbox.test.ts` 覆盖。

运行：`pnpm exec vitest run packages/agent`。

## 延伸阅读

- [ADR 0005](../../docs/adr/0005-permission-mode-and-sandbox.md)：权限模式、审批与沙箱的叠加规则。
- [ADR 0003](../../docs/adr/0003-settings-and-sessions-in-sqlite.md)：Session Entry 的存储、payload 注册与迁移。
- [@coko/session](../session/README.md)：`appendEntries` 的提交与校验契约。
