---
kind: reference
description: "@coko/agent 的运行时入口、运行控制（steer、pause、continue）、工具契约（effect、permissionSubject、sandboxRequest、secrets、probeOutcome、执行上下文）、工具调度与执行记录（tool_exec、幂等键）、命令沙箱接缝与 Secrets 端口。注册宿主工具、装配运行时、实现执行端口或解读工具相关条目前查阅。"
lifecycle: active
---

# @coko/agent

Coko 的 coding-agent 框架层：在 pi-agent-core 1.4.0 的 `Agent` 上实现运行生命周期、内置工具、权限判定与审批、工具调度和 Session Entry 的 payload 定义。项目级约定见 [Agent 运行时约定](../../docs/tech-stack/agent-runtime.md)；权限判定与审批见 [权限判定与审批](../../docs/subsystems/permissions.md)。本文覆盖运行控制（追加指令、暂停与继续）、工具契约、调度与执行记录、命令沙箱接缝与 Secrets 端口。Checkpoint 的文件备份已实现（write / edit 修改前保存原内容）；启动恢复的判定（`planRecovery`）见 [启动恢复与结果确认](../../docs/subsystems/recovery.md)。回退与分叉的纯函数（`effectiveEntries`、`planRewind`、`restoreFiles`、`forkEntries`，`src/checkpoints/rewind.ts`）的决定见 [ADR 0006](../../docs/adr/0006-file-checkpoints-and-rewind.md)。

## 使用或结构入口

| 入口 | 内容 |
| --- | --- |
| `@coko/agent` | `createAgentRuntime`、工具注册表与内置工具、`CokoTool` 契约、`withTimeout`、Session Entry payload（`SESSION_ENTRY_PAYLOADS` 及各 kind 的 schema）、policy 与 ports（沙箱与 Secrets 的类型经 policy barrel 导出：`SandboxPolicy`、`LocalSandbox`、`SandboxUnavailableError`、`SecretProvider` 等） |
| `@coko/agent/testing` | faux 模型、临时 Workspace、grep 契约测试套件；只供测试文件导入 |

`createAgentRuntime(options)` 返回一个 Session 的运行时：`run(text)`、`retry()`、`continue()`、`steer(text)`、`pause()`、`abort()`、`answerApproval()`、`subscribe()`。每个已提交事实都以 `RunEntry`（`{ kind, runId?, payload }`）经 `options.commit` 交给宿主，提交兑现后 Run 才继续；提交被拒绝时 Run 以 `commit_failed` 结束。

## 契约与生命周期

### 运行控制

每个 Run 以 `run_start { trigger }` 开始（submit / retry / continue），以 `run_end { status, error?, undeliveredSteering? }` 结束。

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
| `secrets` | 工具需要的密钥名；运行时每次调用经 `options.secrets`（`SecretProvider`）解析，只放进该次调用的执行上下文。缺失时调用失败（`Missing secret <NAME> declared by tool <name>`）且不执行 |
| `probeOutcome(args, cwd)` | 恢复时判断一个已开始（有 `tool_exec`）的 side-effect 调用是否已生效：`applied` / `not-applied` / `unknown`，只读当前状态。内置 write 比对内容、edit 检查新旧文本，bash 没有；缺省时交给用户确认，见 [启动恢复与结果确认](../../docs/subsystems/recovery.md#判定分类) |
| `timeoutMs` | 单次调用的时限；`0` 关闭统一超时（工具自己管理，如 bash 的 `timeout` 参数）；缺省用运行时默认（10 分钟） |
| `execute(toolCallId, params, signal, onUpdate, context)` | 第五个参数是执行上下文 `ToolExecutionContext`：`{ idempotencyKey, sandbox?, secrets? }`。`sandbox` 是该次调用的命令沙箱策略（有权限判定时总会给出）；`secrets` 只含该工具声明的密钥，工具只应交给自己的子进程。运行时总会传入；直接调用工具（测试）时可缺省 |

### 调度

运行时用一个调度器（`src/tools/scheduler.ts`）包住每个工具的 execute。pi 先按调用顺序逐个执行 `beforeToolCall`（权限判定与审批），所以审批请求逐个出现；通过的调用再交给调度器：

- **并发上限。** 同时执行的调用至多 `toolConcurrency` 个（默认 10，须为正整数，否则创建运行时抛 `RangeError`）。
- **effect 分区。** read 调用共享执行槽；side-effect 调用是独占屏障：等排在它前面的调用全部完成才开始，排在后面的调用等它完成。排队按调用顺序，后面的 read 不越过等待中的 side-effect。同一文件的写入另由 file-mutation-queue 串行。
- **时限。** 超时在调度之内计时：排队等待不计入。忽略取消信号的调用在宽限期后被放弃，并释放执行槽。
- **取消。** `abort()` 时，执行中的调用收到 signal；排队中的调用不执行，结果为 `Operation aborted` 错误，也不提交执行记录。
- **顺序。** `tool_start` / `tool_end` progress 按实际开始与完成顺序；toolResult 条目按模型的调用顺序提交。

### 执行记录与幂等键

side-effect 调用取得执行槽之后、execute 之前，运行时提交一条 `tool_exec` 条目（payload `{ toolCallId, toolName, idempotencyKey }`，schema 在 `src/session-entries/tools.ts`），read 调用不提交。一个经审批的调用在 Session 中的条目顺序是：

```text
assistant（含 toolCall） → approval_request → approval_decision → tool_exec → toolResult
```

- **幂等键。** `<sessionId>:<toolCallId>`（`idempotencyKeyFor`），由 `options.sessionId` 组成；缺省时每个运行时用一个随机 id，键在运行时之外不可复现，宿主应总是传入。同一个键经执行上下文交给工具，供外部能力去重。
- **提交失败。** `tool_exec` 提交被拒绝时该调用不执行，Run 停止并以 `commit_failed` 结束；同批排队中的调用按取消处理。
- **含义。** 有 `tool_exec` 而没有 toolResult 的调用"可能已执行"；没有 `tool_exec` 的调用一定没有开始。记录提交后、执行前被取消的调用不会开始执行。启动恢复（`src/recovery/`）据此分类，见 [启动恢复与结果确认](../../docs/subsystems/recovery.md)。

### 命令沙箱接缝

- **档位。** 有 `permissions` 时，运行时在执行记录之后、execute 之前按当时的模式现算 `sandbox = { mode, writableRoots }`（`policy/sandbox.ts`，与文件工具的可写根同一推导）；已批准的提权取目标档位与执行时模式档位中较宽者，只用于该调用。没有 `permissions` 时不设沙箱，命令不受限。
- **执行端口。** `ExecRequest.sandbox` 为受限档位（read-only、workspace-write）时，端口必须实施限制，做不到就以 `SandboxUnavailableError`（`code: 'sandbox-unavailable'`）拒绝且不运行命令；`danger-full-access` 或省略为不受限。`ExecOutcome` 的 `sandboxDenied` 表示受限命令非零退出且输出含拒绝签名。
- **本地执行。** `createLocalExecPort({ sandbox?: LocalSandbox })`：`LocalSandbox.wrap(policy)` 返回包裹 `<shell> -c <command>` 的 argv 前缀（可抛 SandboxUnavailableError），`denialSignature` 为拒绝签名。本包不带沙箱实现（没有系统二进制依赖），不传时受限档位一律 fail-closed；Sidecar 传入 Seatbelt（`apps/server/src/adapters/seatbelt.ts`）。
- **bash。** 被拒绝时在退出码之前追加拒绝标记与提权提示，`details.sandbox = { mode, denied: true }`；端口报告不可用时以 `sandbox-unavailable: …` 错误结束。提权的判定与审批见 [权限判定与审批](../../docs/subsystems/permissions.md#命令沙箱与提权)。

## 配置与限制

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `toolConcurrency` | 10 | 同时执行的工具调用上限 |
| `timeouts` | 10 分钟 / 宽限 5 秒 | `defaultTimeoutMs`、`graceMs` |
| `sessionId` | 随机 | 幂等键的 Session 部分 |
| `permissions` | 不判定 | 缺省时不做权限判定，也不设命令沙箱（无回答通道的库调用方）；server 总是传入 |
| `secrets` | 无 | `SecretProvider`；声明了 `secrets` 的工具在缺省时调用失败 |
| `lastRunStatus` | 无 | 上一 Run 的结束状态（从条目恢复时），决定能否 `continue()` |

- 未声明 `effect` 的宿主工具按 side-effect 独占执行并提交执行记录；只读的宿主工具应声明 `effect: 'read'` 才能并行。
- 在持有独占执行槽的工具内部再经同一运行时调度另一个工具会等待自己，形成死锁；目前没有这样的调用路径。
- 被放弃（超时后不响应取消）的调用释放执行槽时，其底层操作可能仍在后台运行。

## 验证与相关设计

- `src/engine/run-control.test.ts`：工具执行中 steer 的条目位置与下一次请求上下文、多条按序送达、abort 退回未送达、只有文本的最后一轮也送达、暂停边界（工具完成、不发新请求、待审批 cancelled 且不执行）、continue 的允许条件与 `lastRunStatus`。交叠由 deferred 控制。
- `src/tools/scheduler.test.ts`：上限 2 时 6 个 read 至多 2 个同时执行、结果按调用顺序；默认上限 10；`[read, read, write, read]` 的屏障顺序；`tool_exec` 在 execute 之前提交、上下文携带幂等键、read 不提交；提交失败时不执行且 Run 以 `commit_failed` 结束；排队中取消返回 `Operation aborted` 且没有 `tool_exec`。交叠由 deferred 控制，不用 sleep。
- `tests/integration/sidecar-concurrency.test.ts`：真实 Sidecar 中 bash 的 `tool_exec` 位于 assistant 之后、toolResult 之前，幂等键为 `<sessionId>:<toolCallId>`，同批 ls 没有 `tool_exec`，重启后读回一致。
- `tests/integration/secrets-gate.test.ts`：`tool_exec` 条目在秘密不外泄总闸的扫描范围内。
- `src/recovery/plan.test.ts`：`planRecovery` 的分类与 write / edit 的结果探测（真实内置工具、临时 Workspace）。
- `src/policy/escalation.test.ts`：四种模式下交给执行端口的沙箱策略与可写根、提权与 Secrets 注入（只给声明的工具、缺失时不执行、值不进条目）；`src/ports/local-exec.test.ts`：包裹接缝与 fail-closed；`src/tools/builtin/bash.test.ts`：拒绝标记与 sandbox-unavailable。真实 Seatbelt 由 `apps/server` 的 `seatbelt.test.ts` 与 `tests/integration/sidecar-sandbox.test.ts` 覆盖。

运行：`pnpm exec vitest run packages/agent`。

## 延伸阅读

- [ADR 0005](../../docs/adr/0005-permission-mode-and-sandbox.md)：权限模式、审批与沙箱的叠加规则。
- [ADR 0003](../../docs/adr/0003-settings-and-sessions-in-sqlite.md)：Session Entry 的存储、payload 注册与迁移。
- [@coko/session](../session/README.md)：`appendEntries` 的提交与校验契约。
