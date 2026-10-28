---
kind: reference
description: "@coko/agent 的运行时入口、工具契约（effect、permissionSubject、执行上下文）、工具调度与执行记录（tool_exec、幂等键）。注册宿主工具、装配运行时或解读工具相关条目前查阅。"
lifecycle: active
---

# @coko/agent

Coko 的 coding-agent 框架层：在 pi-agent-core 1.4.0 的 `Agent` 上实现运行生命周期、内置工具、权限判定与审批、工具调度和 Session Entry 的 payload 定义。项目级约定见 [Agent 运行时约定](../../docs/tech-stack/agent-runtime.md)；权限判定与审批见 [权限判定与审批](../../docs/subsystems/permissions.md)。本文覆盖工具契约、调度与执行记录。尚未实现：命令沙箱与 Secrets 注入、steering 与暂停/继续、启动恢复（执行记录已经提交，但还没有读取它的恢复流程）、Checkpoint。

## 使用或结构入口

| 入口 | 内容 |
| --- | --- |
| `@coko/agent` | `createAgentRuntime`、工具注册表与内置工具、`CokoTool` 契约、`withTimeout`、Session Entry payload（`SESSION_ENTRY_PAYLOADS` 及各 kind 的 schema）、policy 与 ports |
| `@coko/agent/testing` | faux 模型、临时 Workspace、grep 契约测试套件；只供测试文件导入 |

`createAgentRuntime(options)` 返回一个 Session 的运行时：`run(text)`、`retry()`、`abort()`、`answerApproval()`、`subscribe()`。每个已提交事实都以 `RunEntry`（`{ kind, runId?, payload }`）经 `options.commit` 交给宿主，提交兑现后 Run 才继续；提交被拒绝时 Run 以 `commit_failed` 结束。

## 契约与生命周期

### 工具契约

`CokoTool`（`src/tools/types.ts`）是 pi 的 `AgentTool` 加以下字段。名称、描述、参数与 outputSchema 是覆盖时必须保持的契约；其余字段属于实现，覆盖时应沿用内置工具的值。

| 字段 | 含义 |
| --- | --- |
| `effect` | `read`：没有副作用；`side-effect`：可能改变文件、进程或外部状态。缺省按 `side-effect`。内置 read、grep、find、ls 为 read，write、edit、bash 为 side-effect |
| `permissionSubject(args)` | 权限判定看的对象：文件工具返回路径，bash 返回命令；缺省只按工具名判定 |
| `timeoutMs` | 单次调用的时限；`0` 关闭统一超时（工具自己管理，如 bash 的 `timeout` 参数）；缺省用运行时默认（10 分钟） |
| `execute(toolCallId, params, signal, onUpdate, context)` | 第五个参数是执行上下文 `ToolExecutionContext`：`{ idempotencyKey }`。运行时总会传入；直接调用工具（测试）时可缺省 |

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
- **含义。** 有 `tool_exec` 而没有 toolResult 的调用"可能已执行"；没有 `tool_exec` 的调用一定没有开始。记录提交后、执行前被取消的调用不会开始执行。

## 配置与限制

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `toolConcurrency` | 10 | 同时执行的工具调用上限 |
| `timeouts` | 10 分钟 / 宽限 5 秒 | `defaultTimeoutMs`、`graceMs` |
| `sessionId` | 随机 | 幂等键的 Session 部分 |
| `permissions` | 不判定 | 缺省时不做权限判定（无回答通道的库调用方）；server 总是传入 |

- 未声明 `effect` 的宿主工具按 side-effect 独占执行并提交执行记录；只读的宿主工具应声明 `effect: 'read'` 才能并行。
- 在持有独占执行槽的工具内部再经同一运行时调度另一个工具会等待自己，形成死锁；目前没有这样的调用路径。
- 被放弃（超时后不响应取消）的调用释放执行槽时，其底层操作可能仍在后台运行。

## 验证与相关设计

- `src/tools/scheduler.test.ts`：上限 2 时 6 个 read 至多 2 个同时执行、结果按调用顺序；默认上限 10；`[read, read, write, read]` 的屏障顺序；`tool_exec` 在 execute 之前提交、上下文携带幂等键、read 不提交；提交失败时不执行且 Run 以 `commit_failed` 结束；排队中取消返回 `Operation aborted` 且没有 `tool_exec`。交叠由 deferred 控制，不用 sleep。
- `tests/integration/sidecar-concurrency.test.ts`：真实 Sidecar 中 bash 的 `tool_exec` 位于 assistant 之后、toolResult 之前，幂等键为 `<sessionId>:<toolCallId>`，同批 ls 没有 `tool_exec`，重启后读回一致。
- `tests/integration/secrets-gate.test.ts`：`tool_exec` 条目在秘密不外泄总闸的扫描范围内。

运行：`pnpm exec vitest run packages/agent`。

## 延伸阅读

- [ADR 0005](../../docs/adr/0005-permission-mode-and-sandbox.md)：权限模式、审批与沙箱的叠加规则。
- [ADR 0003](../../docs/adr/0003-settings-and-sessions-in-sqlite.md)：Session Entry 的存储、payload 注册与迁移。
- [@coko/session](../session/README.md)：`appendEntries` 的提交与校验契约。
