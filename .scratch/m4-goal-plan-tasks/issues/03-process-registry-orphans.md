# 03: 子进程登记与孤儿清理（ADR 0012）

**What to build:** 见 [规格](../spec.md) 与 [ADR 0012](../../../docs/adr/0012-host-process-registry.md)：`ExecPort` 的 `onSpawn` / `onExit` 生命周期回调（`local-exec.ts` 在 detached spawn 后报告 pid 与 pgid）；server `adapters/processes.ts`（读 `ps -o lstart=,pgid= -p <pid>`、按进程组或 pid 发信号）；`application/processes.ts` 的 `ProcessRegistry`（登记、删除、启动清理：核对 lstart 后 SIGTERM，2 秒后 SIGKILL，pid 复用时只删行；有序关闭终止全部登记进程）；MCP stdio 传输连接后登记 pid（kind mcp，无 pgid），关闭后删除；layers.ts 接线。这是地图 Carry-over"Sidecar 被强杀时 bash 的 detached 子进程与 stdio MCP 子进程成为孤儿"的处理。

**User stories:** 15

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/ports/{exec,local-exec}.ts` 与其测试、`apps/server/src/adapters/{processes（新）,mcp}.ts`、`apps/server/src/application/processes.ts`、`apps/server/src/runtime/layers.ts`、`tests/fixtures/mcp/`（新增忽略 stdin 关闭的 stdio Server）、`tests/integration/sidecar-orphans.test.ts`（新）、`docs/subsystems/execution.md`（新）、`docs/adr/0012-host-process-registry.md`

- [x] agent：`local-exec` 在 spawn 后调用 `onSpawn({ pid, pgid })`、退出后 `onExit`；spawn 失败时不调用（单元测试）
- [x] 集成（darwin，其他平台 `it.skipIf` 并写明原因）：前台 bash 运行 `sleep 300` 与经 `.mcp.json` 批准的忽略 stdin 关闭的 stdio MCP 测试 Server 都在运行时 SIGKILL Sidecar；以同一数据目录重启后，两者的 pid 在 5 秒内消失（轮询进程表，不用固定 sleep）；日志有 `orphan process terminated`
- [x] 集成：预先写入一行 pid 为一个仍在运行的无关测试进程、lstart 不符的登记，重启后该进程仍在、行被删除
- [x] 集成：有序关闭（shutdown 消息）后登记表为空，前台 bash 子进程已退出
- [x] 不适用项说明：本票不新增读取根或注入点（Comments 写明）；秘密总闸原用例通过
- [x] execution.md 建立并可达（导航行写在 Comments）：命令执行、进程登记、启动清理、限制（孙进程逃逸、spawn 与登记之间的窗口）；ADR 0012 记录本票证据（implementation 留给 05）；`check:docs` 通过

## Comments

- 2026-10-30 implementer：完成。
  - **验收逐项：** (1) `packages/agent/src/ports/local-exec.test.ts` 新增 3 例：onSpawn 的 pid / pgid 与命令自身 `ps -o pgid=` 一致、中止与超时后 onExit、回调抛错不影响结果、工作目录不存在 / fail-closed / 包裹可执行文件不存在 / shell 不存在时都不调用。(2)(3)(4) `tests/integration/sidecar-orphans.test.ts`（darwin，`describe.skipIf(!darwin)`，原因写在文件头；describe 超时 120 s）3 例：前台 bash（shell + `sleep 300`）与经 `.mcp.json` 批准的 `tests/fixtures/mcp/stubborn-stdio-server.ts` 运行时 SIGKILL，重启后 `waitProcessesGone` 5 秒内全部消失、日志 `orphan process terminated`（bash 与 mcp 各一条）；伪造 lstart 不符的行，无关进程仍在、行被删除（日志 `stale process registration removed … reason: pid-reused`）；shutdown 后登记表为空、进程已退出。`apps/server/src/application/processes.test.ts`（darwin）9 例：登记 / 释放、脱敏、trackExec、进程组 SIGTERM、忽略 SIGTERM 时宽限后 SIGKILL、pid 复用 / 已退出只删行、登记的 pgid 已不是当前组时只向 pid 发信号、有序关闭及之后启动的进程。(5) 不新增读取根或注入点（没有新的文件读取路径，也没有进入模型请求的内容），符号链接用例不适用；新通道只有 `host_processes.command` 列，在库中，由原有总闸扫描 `coko.db` 覆盖（见负向确认），不另建 secrets-gate 文件。(6) `docs/subsystems/execution.md` 新建，经 ADR 0012 链接可达；ADR 0012 在"后果与验证"追加本票证据，implementation 仍为 not-started（按票留给 05）；`check:docs` 0 问题。
  - **命令与结果：** `git merge main`（已是最新）；`pnpm install --frozen-lockfile`=0、`typecheck`=0、`lint`=0（0 warning）、`format:check`=0、`check:docs`=0（150 文件）；`pnpm run test` 第一次=1（secrets-gate-echo 1 例失败，见下），修复后第二次=0：218 个文件、1523 通过、1 跳过（settings.e2e 原有的 skip），含 desktop-e2e 与 package-smoke，无未处理错误。
  - **负向确认：** 第一次全量运行中 `secrets-gate-echo.test.ts` 失败：`host_processes.command` 存了模型回显的登记值（coko.db 与 -wal 命中）；改为入库前 `redactText` 后通过，并补单元用例。变异：cleanup 直接返回 0 → 孤儿用例与伪造行用例失败；核对时忽略 lstart → 伪造行用例失败（无关进程被杀）；MCP 传输不登记 → 孤儿用例与有序关闭用例失败（stubborn Server 未退出）。均已还原。单元测试先红（local-exec 两例）后绿。
  - **越出 Write scope：** `apps/server/src/adapters/ripgrep.ts`：`WorkspaceToolsOptions.wrapExec?`（3 行），bash 的执行端口在工具集内部创建，宿主只能经它包装；同时 `layers.ts` 的 `Tools` 服务改为接受 `{ wrapExec }` 的工厂（探测仍在打开存储之前）。新测试文件 `apps/server/src/application/processes.test.ts`（与范围内源码同目录）。`tests/fixtures/mcp/index.ts` 增加 `stubbornStdioServerEntry` 导出（目录在范围内）。
  - **发现（供 Lead 裁决）：** pi-mcp 1.4.0 的 `StdioTransport` 以 `detached` 启动 stdio Server（自己的进程组，pgid = pid），并在 Sidecar 进程 `exit` 时向这些组发 SIGTERM。规格与 ADR 写"MCP 登记 pid（无 pgid）"，本票按规格实现；若改为登记 pgid，经 npx 启动的孙进程也会被清理，ADR 的"孙进程逃逸"限制对 MCP 将不再成立。改动只在 `layers.ts` 的 `processes.track({ pid, kind: 'mcp', … })` 加 `pgid: pid`，但需改规格与 ADR 0012 的措辞，故未做。
  - **未验证：** 非 darwin 平台（用例显式跳过）；真实模型（无凭据）；打包产物中的行为（package-smoke 原用例通过，未加孤儿用例）。
  - **文档影响：** 新页 execution.md；ADR 0012 证据一段。`docs/README.md` 当前行为导航需要 Lead 合并加一行：`- [命令执行与子进程登记](subsystems/execution.md)：bash 的进程组执行与生命周期回调、子进程登记表、启动时的孤儿清理与有序关闭、已知限制。` README 汇总（票 10）：packages/agent README 可写 `ExecRequest.onSpawn / onExit`；apps/server README 可写 `ProcessRegistry` 与 `adapters/processes.ts`。
  - **供后续票（04、05）：** 登记一个进程：`processes.track({ pid, pgid?, kind: 'job' | 'pty', sessionId?, jobId?, command })` 返回释放函数，进程退出后调用（可重复调用；登记是后台写入，释放早于写入时会在写入后删除）。经 ExecPort 启动的：`processes.trackExec(port, { kind, sessionId?, jobId? })` 包装端口，请求自带的 `onSpawn` / `onExit` 照常调用。`ProcessRegistry` 在 `layers.ts` 的 `Processes` 服务中（Assembly 与 App 层都已 `yield* Processes`）。`SpawnedProcess` 类型未从 `@coko/agent` 的 index 导出（index 只由 02 改），需要时用 `Parameters<NonNullable<ExecRequest['onSpawn']>>[0]`，或由 Lead 合并时在 index 加 `SpawnedProcess` 导出。命令文本由 track 内部 `redactText` 脱敏。有序关闭时 `terminateAll` 在关闭 Job 与上下文贡献之后运行，之后启动的进程被立即 SIGKILL、不登记。
- 2026-10-30 lead：评审后合入 main（0f7e696）。接受越界：ripgrep.ts 的 wrapExec 选项与 layers.ts 的工厂调整、新测试 processes.test.ts。lead 补 docs/README 导航行。裁决：pi-mcp 1.4.0 以独立进程组启动 stdio Server，登记 pgid 才能清理经 npx 启动的孙进程，符合 ADR 0012 清理孤儿的意图；改为登记 pgid 由票 05（完成 ADR 0012 implementation）实施，并同步规格与 ADR 0012 的措辞（已授权，记入票 05）。main 上复核（后台任务，含票 07）：install、typecheck、lint、format:check 退出 0；全量 test 223 文件 1555 通过、1 跳过（真实模型），无页面重载、无未处理错误；check:docs 151 文件 0 问题。worktree 已清理。

Closed: true
