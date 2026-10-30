---
kind: reference
description: "当前的命令执行与子进程登记契约：ExecPort 与本地执行（进程组、超时、中止、沙箱接缝、onSpawn / onExit）、host_processes 登记表、启动时的孤儿清理与有序关闭、日志与已知限制。修改 bash 执行、子进程启动、MCP stdio 传输或 Sidecar 关闭顺序前查阅。"
lifecycle: active
---

# 命令执行与子进程登记

本文说明 Sidecar 如何运行 shell 命令，以及如何登记自己启动的长寿命子进程，使 Sidecar 被强杀后，下次启动能终止上次留下的孤儿进程。决定与备选方案见 [ADR 0012](../adr/0012-host-process-registry.md)；命令的沙箱档位见 [权限判定与审批](permissions.md)；MCP 连接本身见 [MCP](mcp.md)。目前登记的来源是前台 bash 与 stdio MCP Server；后台任务与 PTY 尚未实现。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/ports/exec.ts` | `ExecPort`、`ExecRequest`（含 `onSpawn` / `onExit`）、`SpawnedProcess`、`SandboxUnavailableError` |
| `packages/agent/src/ports/local-exec.ts` | `createLocalExecPort`：`<shell> -c <command>` 以独立进程组（detached）运行，环境过滤，沙箱前缀 |
| `apps/server/src/adapters/processes.ts` | 进程表：`ps -o lstart=,pgid= -p <pid>` 读启动时间与进程组，向进程组或 pid 发信号 |
| `apps/server/src/application/processes.ts` | `ProcessRegistry`：`track`、`trackExec`、`cleanup`（启动清理）、`terminateAll`（有序关闭） |
| `apps/server/src/adapters/mcp.ts` | stdio 传输启动成功后经 `onProcess` 登记，传输关闭后释放 |
| `apps/server/src/adapters/ripgrep.ts` | `createWorkspaceTools({ wrapExec })`：bash 的执行端口经登记包装 |
| `apps/server/src/runtime/layers.ts` | 装配：`ProcessesLive` 在存储之后、上下文贡献与启动恢复之前 |
| `packages/session` 的 `store.processes` | 迁移 v7 的 `host_processes` 表：`register`、`remove`、`list` |

## 命令执行

`ExecPort.exec(request)` 在进程退出且输出送达后 resolve 为 `exited { exitCode, sandboxDenied? }`、`aborted` 或 `timeout`；只有命令没能启动时 reject（工作目录不存在、沙箱不可用时的 `SandboxUnavailableError`、shell 不存在）。本地实现：

- 每个命令以 `detached: true` 启动，是自己进程组的组长（pgid = pid）。中止（`signal`）与超时（`timeoutMs`）向整个进程组发 SIGKILL，命令派生的子进程一起结束。
- 进程退出后，若被后台子进程继承的管道仍未关闭，空闲 100 ms 后不再等待（不因 `sleep 300 &` 之类的后台子进程挂起）。
- 环境去掉 `ELECTRON_RUN_AS_NODE` 与宿主给出的排除项（Sidecar 用 `HOST_ENV_EXCLUSIONS`：`COKO_*` 与凭据形态的变量）。
- 受限沙箱档位只经宿主的沙箱前缀运行，不能启用时 fail-closed（[ADR 0005](../adr/0005-permission-mode-and-sandbox.md)）。

**生命周期回调。** spawn 成功（Node 的 `spawn` 事件）后调用一次 `onSpawn({ pid, pgid })`，进程退出、被中止或超时后调用一次 `onExit`；命令没有启动时两者都不调用。回调抛出的错误被忽略，不影响命令结果。

## 进程登记

`host_processes` 每行是一个仍在运行的子进程：`pid`、`pgid`（只有自己是进程组组长的进程）、`started_at`（`ps -o lstart=` 原文，`ps` 以 `LC_ALL=C`、`TZ=UTC` 运行，同一进程两次读到的值相同）、`kind`（bash、job、pty、mcp）、`session_id`、`job_id`、`command`。

| 来源 | kind | pgid | command | 删除时机 |
| --- | --- | --- | --- | --- |
| 前台 bash（`trackExec` 包装工具集的执行端口） | bash | 有（= pid） | 命令文本 | `onExit` |
| stdio MCP Server（传输 `start()` 成功后） | mcp | 无 | 可执行文件路径（不含参数与环境） | 传输关闭（含 Server 自行退出、崩溃） |

登记与删除都是后台写入，不阻塞命令：先读 lstart 再写行；进程在读到之前已退出时不写；释放早于写入完成时，写入后再删除。写入失败记 warn `process registration failed { operation, error }`，不影响命令。命令文本只存在库中，不写日志。

## 启动清理

`ProcessesLive` 在打开存储之后、上下文贡献与启动恢复之前调用 `cleanup()`，在 `ready` 之前完成。逐行核对：

| 核对结果 | 处理 | 日志 |
| --- | --- | --- |
| pid 存在且 lstart 与登记一致 | 上次遗留的孤儿：有 pgid 且 ps 报告的当前进程组仍是它时 `kill(-pgid)`，否则 `kill(pid)`；先 SIGTERM，2 秒内仍存在则 SIGKILL；删除行 | warn `orphan process terminated { pid, kind, sessionId? }`，汇总 warn `orphan cleanup finished { terminated }` |
| pid 不存在 | 只删行 | info `stale process registration removed { pid, kind, reason: 'not-running' }` |
| pid 存在但 lstart 不同（pid 已被复用） | 只删行，不发信号 | 同上，`reason: 'pid-reused'` |

只有持有宿主租约的实例会打开存储，因此只有一个实例执行清理。不按名字或命令行搜索进程。

## 有序关闭

关闭顺序：停止 HTTP → 中断并等待 Run（中止的 bash 已按进程组终止，`onExit` 删除其行）→ 关闭 Job → 关闭上下文贡献（MCP 传输关闭 stdin，再 SIGTERM / SIGKILL，关闭后删除其行）→ `terminateAll()` → 关闭存储。`terminateAll()` 先等待已发起的登记与删除写完，再按启动清理的方式核对并终止仍在登记表中的进程，结束时登记表为空。此后再启动的进程不登记，立即 SIGKILL 并记 warn `process started during shutdown killed`。

## 限制

- **spawn 与登记之间的窗口。** spawn 成功到行写入之间（一次 `ps` 与一次库写入）被强杀，这个进程不在登记表中，不会被清理。
- **孙进程逃逸。** 没有登记进程组的进程只按 pid 终止：stdio MCP Server 派生的子进程（例如经 `npx` 启动的 Server）可能留下。pi-mcp 1.4.0 实际以独立进程组启动 stdio Server，但登记表按决定不记录其进程组。另外，进程把自己移到新的进程组（`setsid`）后不再随组终止。
- **组长退出后的后台子进程。** bash 命令的 shell 退出后行即被删除；命令留在后台的子进程（`cmd &` 后 shell 退出）不再登记，与 Sidecar 正常运行时相同。
- **平台。** 依赖 `ps -o lstart=` 与进程组信号（macOS 与 Linux 都有）；只在 darwin 验证。lstart 精确到秒。

## 验证

- `packages/agent/src/ports/local-exec.test.ts`：`onSpawn` 的 pid 与进程组与命令自身看到的一致、中止与超时后的 `onExit`、回调抛错不影响结果、没有启动的命令不调用回调。
- `apps/server/src/application/processes.test.ts`（darwin）：登记与删除、`trackExec`、进程组 SIGTERM、忽略 SIGTERM 时 SIGKILL、pid 复用与已退出只删行、进程组不符时只向 pid 发信号、有序关闭与之后的进程。
- `tests/integration/sidecar-orphans.test.ts`（darwin，真实 Sidecar）：前台 bash 的 `sleep 300` 与经 `.mcp.json` 批准、忽略 stdin 关闭的 stdio MCP 测试 Server 运行时 SIGKILL Sidecar，重启后 5 秒内消失并有 `orphan process terminated`；伪造 lstart 不符的登记，对应进程仍在、行被删除；有序关闭后登记表为空。

## 延伸阅读

- [ADR 0012](../adr/0012-host-process-registry.md)：为什么登记在 SQLite、按 pid 与启动时间核对身份。
- [启动恢复与结果确认](recovery.md)：孤儿清理之后的 Run 恢复；被强杀时运行中的 bash 调用会进入结果确认。
- [MCP](mcp.md)：stdio Server 的启动、关闭与重连。
