# 03: 子进程登记与孤儿清理（ADR 0012）

**What to build:** 见 [规格](../spec.md) 与 [ADR 0012](../../../docs/adr/0012-host-process-registry.md)：`ExecPort` 的 `onSpawn` / `onExit` 生命周期回调（`local-exec.ts` 在 detached spawn 后报告 pid 与 pgid）；server `adapters/processes.ts`（读 `ps -o lstart=,pgid= -p <pid>`、按进程组或 pid 发信号）；`application/processes.ts` 的 `ProcessRegistry`（登记、删除、启动清理：核对 lstart 后 SIGTERM，2 秒后 SIGKILL，pid 复用时只删行；有序关闭终止全部登记进程）；MCP stdio 传输连接后登记 pid（kind mcp，无 pgid），关闭后删除；layers.ts 接线。这是地图 Carry-over"Sidecar 被强杀时 bash 的 detached 子进程与 stdio MCP 子进程成为孤儿"的处理。

**User stories:** 15

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/ports/{exec,local-exec}.ts` 与其测试、`apps/server/src/adapters/{processes（新）,mcp}.ts`、`apps/server/src/application/processes.ts`、`apps/server/src/runtime/layers.ts`、`tests/fixtures/mcp/`（新增忽略 stdin 关闭的 stdio Server）、`tests/integration/sidecar-orphans.test.ts`（新）、`docs/subsystems/execution.md`（新）、`docs/adr/0012-host-process-registry.md`

- [ ] agent：`local-exec` 在 spawn 后调用 `onSpawn({ pid, pgid })`、退出后 `onExit`；spawn 失败时不调用（单元测试）
- [ ] 集成（darwin，其他平台 `it.skipIf` 并写明原因）：前台 bash 运行 `sleep 300` 与经 `.mcp.json` 批准的忽略 stdin 关闭的 stdio MCP 测试 Server 都在运行时 SIGKILL Sidecar；以同一数据目录重启后，两者的 pid 在 5 秒内消失（轮询进程表，不用固定 sleep）；日志有 `orphan process terminated`
- [ ] 集成：预先写入一行 pid 为一个仍在运行的无关测试进程、lstart 不符的登记，重启后该进程仍在、行被删除
- [ ] 集成：有序关闭（shutdown 消息）后登记表为空，前台 bash 子进程已退出
- [ ] 不适用项说明：本票不新增读取根或注入点（Comments 写明）；秘密总闸原用例通过
- [ ] execution.md 建立并可达（导航行写在 Comments）：命令执行、进程登记、启动清理、限制（孙进程逃逸、spawn 与登记之间的窗口）；ADR 0012 记录本票证据（implementation 留给 05）；`check:docs` 通过

## Comments
