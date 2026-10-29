# 07: MCP 连接与工具、Secret 登记（ADR 0007）

**What to build:** agent `extensions/mcp/`（pi-mcp `McpClient`）：配置校验与规范化摘要、连接状态机、工具注册（`mcp__<server>__<tool>` 命名与截断、权限类 external、effect side-effect、`disabledTools`）、结果转换（isError、50KB / 2000 行、图片、其他类型注明）、超时、`_meta.idempotencyKey`；传输由宿主注入。server：`adapters/mcp.ts`（stdio / streamable HTTP 传输，stdio 环境 = 过滤后的 Sidecar 环境 + 配置 env）；`McpManager`（`context/mcp.ts`：按 (Workspace, Server) 池化，第一个 Run 时并发连接、30 秒超时、失败不阻止 Run、stderr 尾部经 Secret 脱敏、退避重连 3 次、有序关闭时 SIGTERM → SIGKILL）；全局配置设置键 `mcp.servers`、项目 `.mcp.json`（批准摘要 `mcp.approvals.<workspaceId>`，同名被全局遮蔽，项目中的 `${…}` 拒绝加载）；`/api/mcp` 系列路由。Secret（[ADR 0007](../../../docs/adr/0007-secrets-from-registered-entries.md)）：preload `setSecret` → main safeStorage → 控制 IPC `secret.store` / `secret.decrypt`；SecretProvider 只解析登记的 Secret（独立运行读 `COKO_SECRET_<NAME>`），删除按名读环境（Carry-over J4）；`/api/secrets`。界面：MCP 分区（全局与当前 Workspace 的 Server、状态、工具数、启停、增改删、批准、重连、Secrets 子区），把注册表中 mcp 占位改为可用。实施前核对 pi coding-agent 对 MCP inputSchema 的校验方式并在 Comments 记录。

**User stories:** 12, 13, 14, 15

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/extensions/mcp/`、`packages/agent/src/ports/secrets.ts`、`apps/server/src/adapters/mcp.ts`（新）、`apps/server/src/adapters/credentials.ts`、`apps/server/src/application/context/mcp.ts`、`apps/server/src/application/secrets.ts`（新）、`apps/server/src/http/routes/mcp.ts`、`apps/server/src/http/routes/secrets.ts`、`apps/server/src/control/`、`packages/protocol/src/mcp.ts`、`packages/protocol/src/secrets.ts`、`packages/protocol/src/control.ts`（secret 消息）、`apps/desktop/src/main/`、`apps/desktop/src/preload/`、`apps/desktop/src/shared/bridge.ts`、`apps/desktop/src/renderer/features/settings/mcp-section.tsx`、`apps/desktop/src/renderer/stores/mcp-store.ts`（新）、`packages/i18n/src/dictionaries/domains/mcp.ts`、`tests/fixtures/mcp/`（新：stdio 与 HTTP 测试 Server）、`tests/integration/sidecar-mcp.test.ts`（新）、`tests/integration/secrets-gate-mcp.test.ts`（新）、`apps/desktop/e2e/mcp.e2e.test.ts`（新）、`docs/subsystems/mcp.md`（新）、`docs/subsystems/permissions.md`、`docs/adr/0007-secrets-from-registered-entries.md`、`docs/adr/0008-project-files-only-tighten.md`、`apps/server/README.md`

- [ ] agent 测试：命名（非法字符、超过 64 字符截断加 hash、Server 名只差 `-` 与 `_` 时冲突诊断）、结果转换、配置校验与摘要（键顺序不影响摘要，改命令则摘要变化）
- [ ] 集成测试（stdio 与 HTTP 测试 Server 各一）：连接后工具出现在 faux 请求的工具列表；default 模式下调用出现审批，允许后结果回到模型；full-access 免审批；规则 `mcp__srv` 的 allow 放行该 Server 全部工具；`disabledTools` 不注册；isError、超长截断、超时；测试 Server 收到 `_meta.idempotencyKey = <sessionId>:<toolCallId>`
- [ ] 集成测试：项目 `.mcp.json` 的 Server 在批准前不启动（测试 Server 写入的启动标记文件不存在），批准后启动，改动 args 后回到 pending；项目项含 `${X}` 时拒绝加载并诊断；与全局同名时被忽略
- [ ] 集成测试：Sidecar 有序关闭后 stdio 测试 Server 进程已退出（按 pid 检查）；测试 Server 崩溃后状态 failed 带 stderr 尾部，自动重连，`POST /api/mcp/reconnect` 可恢复；连接失败不阻止 Run
- [ ] `secrets-gate-mcp.test.ts`：登记 `MY_SERVICE_DSN`（不匹配剔除模式）并在配置 env 中引用；测试 Server 只回报其 SHA-256 证明收到；扫描 WebSocket 帧、HTTP 响应、库与 `-wal`、`sidecar.jsonl`、MCP 诊断中都没有明文；同时在 Sidecar 环境中放同名变量，bash `env` 输出中没有该值；未登记名字时 Server 启动失败并诊断
- [ ] E2E：MCP 分区添加 stdio Server、看到 connected 与工具数、停用后工具消失；登记 Secret 只显示末四位；批准项目 Server 的对话框显示完整命令
- [ ] mcp.md 建立并可达（导航行写在 Comments）；permissions.md 记录 external 类与 `mcp__` 规则；ADR 0007 改为 implemented 并链接证据；ADR 0008 记录项目 Server 批准证据；server README 的 Secrets 一条改写；`pnpm run check:docs` 通过

## Comments
- 2026-10-29 lead：来自票 09 的发现——默认启用的贡献工具（memory_*、skill、mcp__*）会让每个 Session 的第一个 Run 多提交一条带 toolsAdded 的 system 条目，导致 12 个 M2 精确序列断言失败。统一修法（由票 09 实施，越出写范围已授权）：apps/server/src/application/sessions.ts 的 #createRuntime 在 createAgentRuntime 之前调用一次 runContext.tools.set(await this.#context.tools(runContext.scope))，使贡献工具进入首条 system message，只有之后的配置变化才产生 system 条目。本票遇到同样失败时复用这一修法，不另行修改；若本票先于票 09 合入，按同一写法实现，合并时由 Lead 去重。
