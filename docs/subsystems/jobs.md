---
kind: reference
description: "当前的后台任务（Background Job）契约：bash run_in_background、Job 状态机、内存环形缓冲与模型游标、日志文件 <dataDir>/jobs、job_output / job_list / job_kill、完成通知（Run 进行中与空闲两种）、job_* 条目与进度、HTTP 接口、停止与关闭、启动恢复 lost、脱敏与已知限制。修改后台命令、Job 输出、通知或 Job 接口前查阅。"
lifecycle: active
---

# 后台任务

本文说明 Coko 当前如何让 Agent 把长命令（开发服务器、监听、长构建）放到后台运行，随时读取输出或停止，并在结束时得到通知。进程登记与孤儿清理见 [命令执行与子进程登记](execution.md)；权限类见 [权限判定与审批](permissions.md)。PTY Job 与 `job_input`、后台任务视图尚未实现。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/tasks/jobs/` | `BackgroundJob`（状态机、游标、等待）、`OutputRing`、`stripAnsi`、`jobLabel`、`jobNotificationText`、工具 `job_output` / `job_list` / `job_kill`、`JobsPort`、`BackgroundJobLauncher` |
| `packages/agent/src/ports/exec.ts`、`local-exec.ts` | `ExecPort.spawn`：不等待退出的长寿命进程句柄（`pid`、`pgid`、`kill(signal)`、`exited`），stdin 关闭 |
| `packages/agent/src/tools/builtin/bash.ts` | `run_in_background` 参数；经执行上下文中的 `jobs` 启动 |
| `packages/agent/src/session-entries/jobs.ts`、`packages/protocol/src/jobs.ts` | `job_start`、`job_end`、`job_notification` v1；`JobSnapshot`、`SessionJobsResponse`、`JobOutputResponse`、`jobPaths` |
| `apps/server/src/application/jobs.ts` | `JobService`：启动、上限、日志与脱敏、进度、停止、通知、恢复、关闭 |
| `apps/server/src/application/session-runs.ts` | 为运行时的 bash 注入本 Session 的启动入口；`deliver`（通知作为追加指令送达）；追加指令到达时唤醒等待的 `job_output` |
| `apps/server/src/application/context/jobs.ts` | 上下文贡献：三个工具、`pendingInput`（挂起的通知）、`onRunEnd`（未送达的通知挂起） |
| `apps/server/src/http/routes/jobs.ts` | HTTP 接口 |

## 发起

bash 的 `run_in_background: true` 与前台 bash 经过同样的权限判定、沙箱档位、环境过滤与 `tool_exec`；进程经同一个执行端口的 `spawn` 以独立进程组启动，`timeout` 不适用。启动成功后先提交 `job_start`（在该调用的 toolResult 之前），再返回 `Started background job <id>: <label>. Read output with job_output.`。

- jobId 为 `job_` 加 12 个十六进制字符。label 为命令的第一个非空行，超过 120 字符时截断并加省略号。
- 每个 Session 同时至多 10 个 running 与 stopping 的 Job，第 11 个以错误结果返回，不启动进程。
- 有序关闭开始后不再启动（错误结果）。宿主没有后台任务时 `run_in_background` 为错误结果。
- 进程以 kind `job`、带 sessionId 与 jobId 登记到 `host_processes`，退出后删除。

## 状态与输出

状态：`running` → `completed`（退出码 0）/ `failed`（其他退出码，含被外部信号终止）；`running` → `stopping`（被要求停止）→ `killed`；`lost` 只由启动恢复补记。

输出（stdout 与 stderr 合并）按 UTF-8 解码后先经流式按值替换（登记的 Secret 与 Credential 明文，跨输出块的值也被替换），再进入三处，偏移都是替换后文本的字节偏移：

- **环形缓冲**：内存中保留最近 256 KB，模型的游标在其上；游标落后于环形起点时丢弃的字节数在结果中注明。
- **日志**：`<dataDir>/jobs/<sessionId>/<jobId>.log`，目录 0700、文件 0600，至多 64 MiB；超出后停止写入，结束时在末尾写一行 `[truncated: …]`，`job_end.truncated` 为 true。日志目录不是读取根：Workspace 内指向它的符号链接经 read 读取时与其他 Workspace 外路径一样需要审批。
- **进度**：WebSocket `job_output { jobId, offset, chunk }`，每个 Job 至多每 100 ms 一帧，offset 连续；状态变化时 `job_update { job }`。两者的 runId 为发起该 Job 的 Run（Job 可以比它活得久）。

## 工具

| 工具 | 权限类 | 行为 |
| --- | --- | --- |
| `job_output { job_id, wait?, timeout_ms? }` | context-read | 只返回游标之后的输出（去除 ANSI 控制序列，CRLF 归一为 LF），按工具输出规则保留末尾 2000 行 / 50 KB，末尾 `[status: …]`（`completed`、`failed (exit code n)`、`killed (signal SIGTERM)`…）。wait 时等到结束、超时（缺省 30 000 ms，上限 600 000 ms）或有追加指令送进该 Session 的 Run。没有新输出时为 `(no new output)`。 |
| `job_list` | context-read | 每个 Job 一行 `<id> [<kind>] <status> — <label>`，含重启前的历史；没有时 `No background jobs.`。 |
| `job_kill { job_id, reason? }` | session-state | 进程组 SIGTERM，5 秒后仍在则 SIGKILL，等到 `job_end` 提交后返回；已结束的返回当前状态。 |

三个工具只能访问本 Session 中运行中或本进程内结束的 Job，其他 id 为错误结果。

## 完成通知

`job_end` 提交后，除非模型已经用 `job_output` 读到终态或用 `job_kill` 停止了它，生成通知：

```text
<job-notification>
<job-id>…</job-id>
<status>completed</status>
<exit-code>0</exit-code>
<summary>Background job "<label>" completed (exit code 0)</summary>
<output>未读输出（≤ 2 KB 时内联）</output>
</job-notification>
```

没有退出码时省略 `<exit-code>`；未读输出超过 2 KB 时省略 `<output>`，以 `<note>` 提示用 `job_output` 读取。文本在入库前再按值替换一次（通知作为 user message 入库，不经条目的第二道替换）。

- **Session 有 Run**：作为追加指令送达（不经输入展开），在该批工具完成后的下一次模型请求之前出现；紧接在 user message 之前提交 `job_notification { jobIds }`。Run 结束时没有送达的（`run_end.undeliveredSteering` 中）挂起。
- **Session 空闲**：挂起，不开始 Run；下一次 submit 或 Goal Round 的 user message 以通知开头（之后是用户文本），`job_notification` 紧接在它之前。
- 内联的输出在送达后计为已读（游标前移）。用户经 HTTP 停止的 Job 照常通知。

## 停止、关闭与恢复

- 停止 Run 不终止 Job。
- `JobService.killSession(sessionId, goalId?)` 终止该 Session 的 Job，给出 goalId 时只终止属于该 Goal 的（取消 Goal 使用）；Session 有未终结的 Goal 时启动的 Job 在 `job_start` 中带 `goalId`，见 [Goal](goal.md#推进)。
- 有序关闭在中断 Run 之后、关闭上下文贡献之前终止全部 Job（`job_end killed`，不再通知）；登记表随后由 `terminateAll()` 兜底。
- 启动恢复（Session 恢复之后、Goal 恢复之前）为每个没有 `job_end` 的 `job_start` 提交 `job_end { status: lost }`，outputBytes 取日志大小；进程此前已由孤儿清理终止。运行中的 Job 不跨重启恢复。

## HTTP

| 接口 | 结果 |
| --- | --- |
| `GET /api/sessions/:id/jobs` | `{ jobs: JobSnapshot[] }`（启动顺序；运行中与本进程内结束的以内存为准，其余来自条目） |
| `GET /api/jobs/:id/output?offset=&limit=` | `{ offset, chunk, nextOffset, done }`：读日志，不影响模型游标；limit 1–262 144（缺省上限），不在多字节字符中间结束；done 为 Job 已结束且读到日志末尾 |
| `POST /api/jobs/:id/kill` | 204（Job 结束后返回）；已结束 409 `job-not-running`；未知 404 |

## 测试替身

faux 脚本中工具调用参数里的 `$LAST_JOB_ID` 在请求时替换为上下文中最近一次 `Started background job <id>` 结果的 jobId（`apps/server/src/adapters/faux.ts`）。

## 限制

- 不唤醒没有 Goal 的空闲 Session；Goal 为 waiting-external 时，等待的 Job 全部结束后由 Goal 发起下一轮，见 [Goal](goal.md#推进)。
- 日志不清理；被截断的日志之后的 `job_output` 进度帧的 offset 超出日志长度，HTTP 只能读到截断处。
- 输出按 UTF-8 解码，非 UTF-8 字节以替换字符保存。
- 环形缓冲按字节丢弃，最早保留的一个多字节字符可能被切开。

## 验证

- `packages/agent/src/tasks/jobs/jobs.test.ts`：环形缓冲与偏移、ANSI 去除、label、job_output 的游标、wait 的结束 / 超时 / 追加指令 / 取消、截断、未知 id、job_kill 与 job_list、状态机、通知文本（内联、超过 2 KB、转义）。
- `packages/agent/src/ports/local-exec.test.ts`、`tools/builtin/bash.test.ts`：`spawn` 的流式输出、进程组 kill 与退出码、启动失败；bash 经启动入口启动与没有入口时的错误。
- `tests/integration/sidecar-jobs.test.ts`：真实 Sidecar 上的全部发起、输出、日志权限、上限、两种通知（requestLog）、HTTP 分页与 WS 帧偏移、符号链接需要审批；darwin 上 job_kill 与 HTTP 停止后进程组退出与登记行删除、停止 Run 后 Job 仍在、SIGKILL 重启后 lost 与孤儿清理。
- `tests/integration/secrets-gate-jobs.test.ts`：后台 bash 跨输出块回显登记 Secret，日志、job_output 结果、WS 帧、HTTP 输出、通知文本、requestLog、库与日志中没有明文。

## 延伸阅读

- [命令执行与子进程登记](execution.md)：执行端口、进程组与孤儿清理。
- [ADR 0012](../adr/0012-host-process-registry.md)：进程登记与清理的决定。
