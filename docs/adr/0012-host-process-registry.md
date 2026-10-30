---
kind: decision
description: "Sidecar 把自己启动的长寿命子进程（bash 进程组、后台任务、PTY、stdio MCP Server）登记在 SQLite，启动时按 pid 与进程启动时间核对身份后清理上次留下的孤儿。修改子进程启动、关闭顺序、后台任务或 MCP 传输时回看。"
status: accepted
implementation: implemented
lifecycle: active
category: architecture
---

# Sidecar 登记子进程，启动时按身份清理孤儿

## 上下文

bash 以独立进程组（detached）启动命令，以便超时与停止时终止整个进程树；stdio MCP Server 由 pi-mcp 启动。Sidecar 有序关闭时会终止它们，但被 SIGKILL、崩溃或被 main 的分级退出强杀时，这些子进程会继续运行到结束：bash 的进程组不随父进程退出，MCP Server 只有在读到 stdin 关闭时才可能自行退出。M4 的后台任务与 PTY 会让这类进程更多、寿命更长。macOS 没有"父进程退出时通知子进程"的内核机制（Linux 的 PDEATHSIG），main 又会在 Sidecar 故障后自动重启它（[桌面构建与交付约定](../tech-stack/desktop-delivery.md)），因此孤儿可能与新 Sidecar 同时操作同一个 Workspace。

参考项目 deepseek-harness 在 Linux 上用 user-systemd scope、在 Windows 上用 Job 对象让操作系统持有进程范围，在 macOS 上退回为"只能清理可观察到的进程树"；它的后台任务只在进程内，进程退出即丢失。用户于 2026-10-28 的常设指示要求讨论问题采用推荐方案并优先沿用参考项目；本决定于 2026-10-30 规划 M4 时按该指示采纳，未经用户逐条确认。

## 决定

- **登记。** Sidecar 每启动一个可能比单次调用更久的子进程，在 spawn 成功后立即在同一个 SQLite 库的进程登记表中写入一行：pid、进程组（仅 detached 启动的进程）、操作系统报告的进程启动时间、类别（bash、job、pty、mcp）、所属 Session 与 Job。进程退出或被回收后删除该行。有序关闭在关闭存储之前终止并删除全部登记进程。
- **启动清理。** Sidecar 打开存储后、启动恢复之前，逐行核对：该 pid 仍存在且启动时间与登记一致时，视为上次遗留的孤儿，向进程组（没有进程组的只向该 pid）发 SIGTERM，宽限后 SIGKILL；pid 不存在或启动时间不一致（pid 已被复用）时只删除该行，不发信号。每一项的结果记入日志。
- **范围与限制。** 只终止登记过的进程及其进程组；不按名字或命令行搜索进程。没有独立进程组的子进程派生出的孙进程可能逃逸，这一点记为已知限制。stdio MCP Server 由 pi-mcp 以独立进程组启动，登记其进程组，经 npx 启动的 Server 的孙进程随组终止（2026-10-30 实施 PTY 时修订）。后台任务的输出不跨进程恢复：重启后未结束的 Job 记为 lost。

## 理由与备选方案

- **只依赖 stdin 关闭或父进程轮询（watchdog）。** 要求每个子进程配合；bash 用户命令与第三方 MCP Server 都不受控制。
- **由 main 托管所有子进程。** main 活得比 Sidecar 久，但会把执行、沙箱与权限的进程边界搬进 Electron main，违背 [ADR 0001](0001-sidecar-on-electron-node.md) 与架构约定中"执行在 Sidecar"的分工。
- **启动时按命令行或工作目录搜索并终止。** 可能误杀用户自己启动的同名进程；按 pid 加启动时间核对身份不会命中被复用的 pid。
- **登记在文件而不是 SQLite。** 需要另一套原子写入与锁；登记表与宿主租约同库，只有持有租约的实例会执行清理。

## 后果与验证

- spawn 与写入登记之间仍有极短的窗口：此时被强杀会留下未登记的孤儿。
- 每个子进程多一次库写入；bash 的短命令同样登记，退出后删除。
- implementation 变为 implemented 前需要：以 `ELECTRON_RUN_AS_NODE` 启动真实 Sidecar，在前台 bash、后台 Job 与忽略 stdin 关闭的 stdio MCP 测试 Server 运行时 SIGKILL Sidecar，重启后这些进程在有限时间内退出；伪造一行启动时间不符的登记，确认对应进程不被终止。
- 前台 bash 与 stdio MCP（2026-10-30）：登记、启动清理与有序关闭已实现，机制与限制见 [命令执行与子进程登记](../subsystems/execution.md)。证据：`tests/integration/sidecar-orphans.test.ts`（darwin，真实 Sidecar）在前台 bash 的 `sleep 300` 与经 `.mcp.json` 批准、忽略 stdin 关闭的 stdio MCP 测试 Server 运行时 SIGKILL Sidecar，重启后两者在 5 秒内消失、日志有 `orphan process terminated`；伪造 lstart 不符的登记，对应进程仍在、行被删除；有序关闭后登记表为空。`apps/server/src/application/processes.test.ts` 覆盖宽限后的 SIGKILL 与 pid 复用；`packages/agent/src/ports/local-exec.test.ts` 覆盖 `onSpawn` / `onExit`。后台 Job 与 PTY 尚未登记；implementation 在它们完成后更新。
- 后台 Job（2026-10-30）：Job 进程以 kind job、带 sessionId 与 jobId 登记，退出后删除；行为见 [后台任务](../subsystems/jobs.md)。证据：`tests/integration/sidecar-jobs.test.ts`（darwin，真实 Sidecar）在后台 Job 的 `sleep 300` 运行时 SIGKILL Sidecar，重启后 shell 与子进程在 5 秒内消失、日志有 kind job 的 `orphan process terminated`、启动恢复提交 `job_end lost`；job_kill 与 `POST /api/jobs/:id/kill` 之后进程组退出、登记行删除；有序关闭以 `job_end killed` 结束全部 Job 且登记表为空。
- PTY Job 与 MCP 进程组（2026-10-30）：PTY Job 以 kind pty 登记（pgid = pid，PTY 子进程的会话）；stdio MCP Server 改为登记进程组。行为见 [命令执行与子进程登记](../subsystems/execution.md#pty-与-stdin)。证据：`tests/integration/sidecar-pty.test.ts`（darwin，真实 Sidecar）在忽略 SIGHUP 的 PTY shell 与其 `sleep 300` 运行时 SIGKILL Sidecar，重启后两者在 5 秒内消失、日志有 kind pty 的 `orphan process terminated`、Job 记 lost；`tests/integration/sidecar-orphans.test.ts` 中经 `/bin/sh` 启动、留下同组孙进程的 stubborn MCP Server 连同孙进程被清理。变异确认：MCP 不登记进程组时孙进程留下，PTY 不登记进程组时登记行不符。至此前台 bash、后台 Job、PTY 与 stdio MCP 都已登记，implementation 改为 implemented。
- git 子进程（2026-10-31，M5 票 04）：以独立进程组登记为 kind `git`（命令为脱敏后的 `git <参数>`），结束后删除；超时时对进程组 SIGTERM、2 秒后 SIGKILL。证据：`apps/server/src/adapters/git.test.ts`（忽略 SIGTERM 的假 git 在注入的时限内被终止）。
- Hook 子进程（2026-10-31，M5 票 03）：command 型 Hook 以独立进程组登记为 kind `hook`，结束后删除；超时时对进程组 SIGTERM、宽限后 SIGKILL。证据：`tests/integration/sidecar-hooks.test.ts`（darwin，忽略 SIGTERM 的 Hook 夹具：运行中登记行存在、超时后删除、进程组消失、hook_run 记 timeout）。
- M5 的类别（2026-10-31）：迁移 v8 重建 `host_processes`，kind 增加 hook（外部 Hook 命令，独立进程组）与 git（宿主执行的 git）。登记表与契约已接受这两类（`packages/session/src/sqlite/migrate-v8.test.ts`、`repository-contract.ts`）；登记它们的执行器尚未交付，孤儿清理的证据随 Hook 与 worktree 的实现补充。

## 来源与后继

- 参考实现：deepseek-harness `packages/subprocess/subprocess-local`（进程范围与清理）、`packages/jobs`（进程内后台任务）。本页已提炼所需结论。
- 能力归属见 [Agent 执行约定](../tech-stack/agent-runtime.md#框架能力分工)（Execution Runtime、Background Jobs）；存储边界见 [ADR 0003](0003-settings-and-sessions-in-sqlite.md)。
