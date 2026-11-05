---
kind: reference
description: "当前的命令执行与子进程登记契约：ExecPort 与本地执行（进程组、超时、中止、沙箱接缝、onSpawn / onExit）、PTY 与 stdin（node-pty、job_input）、截断工具结果落盘、host_processes 登记表、启动时的孤儿清理与有序关闭、日志与已知限制。修改 bash 执行、PTY、子进程启动、MCP stdio 传输或 Sidecar 关闭顺序前查阅。"
lifecycle: active
---

# 命令执行与子进程登记

本文说明 Sidecar 如何运行 shell 命令，以及如何登记自己启动的长寿命子进程，使 Sidecar 被强杀后，下次启动能终止上次留下的孤儿进程。决定与备选方案见 [ADR 0012](../adr/0012-host-process-registry.md)；命令的沙箱档位见 [权限判定与审批](permissions.md)；MCP 连接本身见 [MCP](mcp.md)。目前登记的来源是前台 bash、后台任务（[后台任务](jobs.md)，含 PTY Job）与 stdio MCP Server。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/ports/exec.ts` | `ExecPort`、`ExecRequest`（含 `onSpawn` / `onExit`）、`SpawnedProcess`、`SandboxUnavailableError` |
| `packages/agent/src/ports/local-exec.ts` | `createLocalExecPort`：`<shell> -c <command>` 以独立进程组（detached）运行，环境过滤，沙箱前缀；`spawn({ tty: true })` 经 PtyPort 在 PTY 中运行 |
| `packages/agent/src/ports/pty.ts` | `PtyPort`、`PtyProcess`、`PtyUnavailableError`（`pty-unavailable`）、尺寸 120×30 |
| `packages/agent/src/tasks/jobs/tools.ts` | `job_input`：向 running 的 pty Job 写入 |
| `apps/server/src/adapters/pty.ts` | node-pty 实现 PtyPort：启动探测、进程组信号 |
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

**后台命令。** `ExecPort.spawn(request)` 以同样的方式（工作目录检查、沙箱前缀、环境过滤、独立进程组、stdin 关闭）启动命令，进程启动后即返回句柄 `{ pid, pgid, kill(signal), exited }`：`kill` 向进程组发信号（缺省 SIGTERM），`exited` 在退出且输出送达后 resolve 为 `{ exitCode, signal? }`（信号终止时退出码为 128 + 信号）。没有超时与中止。`trackExec` 原样转交 `spawn`，由后台任务自己登记。

**生命周期回调。** spawn 成功（Node 的 `spawn` 事件）后调用一次 `onSpawn({ pid, pgid })`，进程退出、被中止或超时后调用一次 `onExit`；命令没有启动时两者都不调用。回调抛出的错误被忽略，不影响命令结果。

## 工具结果落盘

Sidecar 为每个 Session 的运行时设置 `data/tool-results/<sessionId>/`。工具正文因显示行数、字节数或行长限制被截断时，原文写入 `<toolCallId>.txt`，返回给模型的结果末尾包含绝对路径；普通未截断结果不产生文件。调用 id 中的路径分隔符编码后才用作文件名。文件只保留 UTF-8 完整字符，32 MiB 上限包含末尾的 `\n[truncated]\n`；超限时保留可容纳的原文前缀，文件与模型文本均有 `[truncated]` 标记。

bash 的输出在超过显示限制后直接有界写入该文件，等待写入结束才返回结果，不先创建无上限临时文件。read、grep（内置与 ripgrep 后端）、find、ls、MCP 工具与资源、Memory、Job 输出、LSP 和子代理结果在各自显示截断前保留原文，经统一工具调度边界落盘；原文临时字段在进入 Hook、进度与 Session 条目之前移除。查询参数本身限定的范围（例如 read 的 offset/limit 或 grep 的最大匹配数）仍保持原语义，不扩展为无限查询；Job 已从环形缓冲丢弃的输出仍以既有丢弃提示和 `data/jobs/` 日志为准。

分叉会将边界内历史引用的结果文件复制到新 Session 的私有目录，并重写历史中的路径；复制或条目提交失败会回滚新副本与新会话。删除源 Session 不影响已成功分叉的文件，副本仍只在新会话的读取根内。验证见[删除与分叉 Sidecar 用例](../../tests/integration/sidecar-session-cleanup.test.ts)。

该 Session 的结果目录加入额外读取根，免审批读取自己保存的结果；不授予其他 Session 的目录，也不新增写入权限。拒绝规则仍优先。库调用方可用 `AgentRuntimeOptions.toolResultsDirectory` 选择目录；未配置时不启用通用文本落盘，bash 继续使用有界的系统临时文件。

实现入口：`packages/agent/src/tools/output.ts`、`tools/scheduler.ts`、`tools/builtin/output-accumulator.ts`；Sidecar 装配见 `apps/server/src/application/session-runs.ts`。真实 Sidecar 验证在 `tests/integration/sidecar-tool-results.test.ts`，覆盖完整内容、模型请求中的路径、普通结果无文件、字节上限与 UTF-8、路径编码、跨会话审批及只读模式；MCP 工具和资源测试另检查完整原文文件。

## PTY 与 stdin

bash 的 `tty: true`（须同时 `run_in_background: true`，否则参数错误，命令不运行）让后台任务在伪终端中运行，Job kind 为 `pty`：

- `ExecPort.spawn({ tty: true })` 与普通后台命令同样检查工作目录、加沙箱前缀、过滤环境，再交给 `PtyPort.spawn({ argv, cwd, env, cols, rows })`：argv 为沙箱前缀 + `<shell> -c <command>`，cwd 为 Workspace 的真实路径（Workspace 经符号链接登记时，命令中的 `pwd -P` 与 `$PWD` 都是目标路径，与权限判定和沙箱可写根使用的路径一致），尺寸 120×30，环境没有 `TERM` 时设为 `xterm-256color`。句柄多出 `write(text)`；其余 Job 的 stdin 关闭，没有 `write`。
- node-pty 的 spawn-helper 先 `setsid` 再 exec 命令，PTY 子进程是自己会话与进程组的组长（pgid = pid）。`kill` 向进程组发信号（node-pty 自身的 `kill` 只发给 pid）；信号退出时退出码为 128 + 信号号，并带信号名。
- 输出是终端看到的字节（stdout 与 stderr 合并，带 CR 与控制序列）。日志保存原始输出；job_output 与完成通知去除 ANSI 并把 CRLF 归一为 LF。按值替换登记明文与普通后台任务相同，终端回显的输入同样被替换。
- `job_input { job_id, text, submit?, ctrl_c? }`：只接受本 Session running 的 pty Job（非 PTY Job 返回"stdin 已关闭"错误结果，stopping 与已结束的返回"not running"）。写入顺序为 `ctrl_c` 的 `\x03`、`text`、`submit` 的 `\r`；三者都为空时参数错误。不等待回应，结果提示用 job_output 读取。权限类为 bash，判定对象是 shell 将要执行的整行：上次回车之后已写入的当前行加本次 `text`（`ctrl_c` 时当前行先清空；按回车、换行、Ctrl-C、Ctrl-U 与退格近似，其他行编辑键原样计入），与 bash 命令同一套规则（`Bash(...)` 的拒绝与询问规则匹配整行，拆成几次输入不能绕过；default 询问，full-access 放行）。同一批的调用都先判定再执行：执行时当前行与判定时不同（前一段已写入）的调用不发送。Job 记下启动时的沙箱档位；该档位严格宽于当前模式的档位时，plan 与 read-only 下拒绝（`Not sent: … wider than <mode> mode allows`），其余模式要求一次 kind escalation 审批（允许规则与模式放行都不能免掉），见 [ADR 0005](../adr/0005-permission-mode-and-sandbox.md)。日志只记 `job input sent { sessionId, jobId, bytes }`，不记文本。
- **没有 PTY。** Sidecar 在启动时（`ToolsLive`，打开存储之前）加载 node-pty 一次：成功记 info `pty backend selected { backend, version, path }`，失败记 warn `pty backend unavailable; tty commands will not run`，不阻止启动。没有 PtyPort 时 `tty: true` 以错误结果 `pty-unavailable: the command was not run …` 返回，命令不运行。

## 进程登记

`host_processes` 每行是一个仍在运行的子进程：`pid`、`pgid`（只有自己是进程组组长的进程）、`started_at`（`ps -o lstart=` 原文，`ps` 以 `LC_ALL=C`、`TZ=UTC` 运行，同一进程两次读到的值相同）、`kind`（bash、job、pty、mcp）、`session_id`、`job_id`、`command`。

| 来源 | kind | pgid | command | 删除时机 |
| --- | --- | --- | --- | --- |
| 前台 bash（`trackExec` 包装工具集的执行端口） | bash | 有（= pid） | 命令文本 | `onExit` |
| 后台任务（`ExecPort.spawn`，JobService 的 onSpawn） | job | 有（= pid） | 命令文本（带 sessionId、jobId） | 进程退出 |
| PTY Job（`spawn({ tty: true })`，JobService 的 onSpawn） | pty | 有（= pid，PTY 子进程的会话） | 命令文本（带 sessionId、jobId） | 进程退出 |
| stdio MCP Server（传输 `start()` 成功后） | mcp | 有（= pid；pi-mcp 在 POSIX 上以 detached 启动，Windows 无） | 可执行文件路径（不含参数与环境） | 传输关闭（含 Server 自行退出、崩溃） |

登记与删除都是后台写入，不阻塞命令：先读 lstart 再写行；进程在读到之前已退出时不写；释放早于写入完成时，写入后再删除。写入失败记 warn `process registration failed { operation, error }`，不影响命令。命令文本入库前经 `redactText` 脱敏（登记的 Secret 值与凭据形态，[ADR 0007](../adr/0007-secrets-from-registered-entries.md)），不写日志；秘密总闸扫描库文件。

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
- **孙进程逃逸。** 登记的进程都带进程组，孤儿清理向整个组发信号：stdio MCP Server 派生的子进程（例如经 `npx` 启动的 Server）随组终止。进程把自己移到新的进程组或会话（`setsid`、交互式 shell 的作业控制）后不再随组终止。
- **组长退出后的后台子进程。** bash 命令的 shell 退出后行即被删除；命令留在后台的子进程（`cmd &` 后 shell 退出）不再登记，与 Sidecar 正常运行时相同。
- **平台。** 依赖 `ps -o lstart=` 与进程组信号（macOS 与 Linux 都有）；只在 darwin 验证。lstart 精确到秒。

## 验证

- `packages/agent/src/ports/local-exec.test.ts`：`onSpawn` 的 pid 与进程组与命令自身看到的一致、中止与超时后的 `onExit`、回调抛错不影响结果、没有启动的命令不调用回调；tty 请求的 argv、真实 cwd、尺寸与环境，没有 PtyPort 时 `pty-unavailable`，非 PTY 句柄没有 `write`。
- `packages/agent/src/tools/builtin/bash.test.ts` 与 `tasks/jobs/jobs.test.ts`（表驱动）：`tty` 而不后台为参数错误，宿主没有 PTY 时的错误文本；job_input 只接受 running 的 pty Job、写入顺序、终端当前行的推导（`nextLine`）。
- `apps/server/src/adapters/pty.test.ts`（darwin）：node-pty 中 cwd、尺寸与 TERM，输入被读到，kill 向进程组发信号。`pty-runtime.test.ts`：Electron 内置 Node 中加载。
- `tests/integration/sidecar-pty.test.ts`（darwin，真实 Sidecar）：`python3 -i` 经 job_input 读到 42；`ctrl_c` 中断前台的 `sleep 100`；default 询问、full-access 不询问、拒绝规则匹配 text、拆成几段的命令被拒绝规则匹配、同一批中前一段改变当前行时后一段不发送、full-access 下启动后切到 plan 拒绝输入而 default 下要求提权；read-only 档位的 Seatbelt 拒绝写入；SIGKILL 后 PTY 进程组被清理、Job 记 lost；Workspace 经符号链接登记时 `pwd -P` 为目标路径。`secrets-gate-pty.test.ts`：PTY 回显登记 Secret 时各通道没有明文。
- `apps/server/src/application/processes.test.ts`（darwin）：登记与删除、`trackExec`、进程组 SIGTERM、忽略 SIGTERM 时 SIGKILL、pid 复用与已退出只删行、进程组不符时只向 pid 发信号、有序关闭与之后的进程。
- `tests/integration/sidecar-orphans.test.ts`（darwin，真实 Sidecar）：前台 bash 的 `sleep 300` 与经 `.mcp.json` 批准、忽略 stdin 关闭的 stdio MCP 测试 Server（经 `/bin/sh` 启动，留下同组的孙进程）运行时 SIGKILL Sidecar，重启后连同孙进程 5 秒内消失并有 `orphan process terminated`；伪造 lstart 不符的登记，对应进程仍在、行被删除；有序关闭后登记表为空。

## 延伸阅读

- [ADR 0012](../adr/0012-host-process-registry.md)：为什么登记在 SQLite、按 pid 与启动时间核对身份。
- [启动恢复与结果确认](recovery.md)：孤儿清理之后的 Run 恢复；被强杀时运行中的 bash 调用会进入结果确认。
- [MCP](mcp.md)：stdio Server 的启动、关闭与重连。
