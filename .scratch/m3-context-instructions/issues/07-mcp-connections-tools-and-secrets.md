# 07: MCP 连接与工具、Secret 登记（ADR 0007）

**What to build:** agent `extensions/mcp/`（pi-mcp `McpClient`）：配置校验与规范化摘要、连接状态机、工具注册（`mcp__<server>__<tool>` 命名与截断、权限类 external、effect side-effect、`disabledTools`）、结果转换（isError、50KB / 2000 行、图片、其他类型注明）、超时、`_meta.idempotencyKey`；传输由宿主注入。server：`adapters/mcp.ts`（stdio / streamable HTTP 传输，stdio 环境 = 过滤后的 Sidecar 环境 + 配置 env）；`McpManager`（`context/mcp.ts`：按 (Workspace, Server) 池化，第一个 Run 时并发连接、30 秒超时、失败不阻止 Run、stderr 尾部经 Secret 脱敏、退避重连 3 次、有序关闭时 SIGTERM → SIGKILL）；全局配置设置键 `mcp.servers`、项目 `.mcp.json`（批准摘要 `mcp.approvals.<workspaceId>`，同名被全局遮蔽，项目中的 `${…}` 拒绝加载）；`/api/mcp` 系列路由。Secret（[ADR 0007](../../../docs/adr/0007-secrets-from-registered-entries.md)）：preload `setSecret` → main safeStorage → 控制 IPC `secret.store` / `secret.decrypt`；SecretProvider 只解析登记的 Secret（独立运行读 `COKO_SECRET_<NAME>`），删除按名读环境（Carry-over J4）；`/api/secrets`。界面：MCP 分区（全局与当前 Workspace 的 Server、状态、工具数、启停、增改删、批准、重连、Secrets 子区），把注册表中 mcp 占位改为可用。实施前核对 pi coding-agent 对 MCP inputSchema 的校验方式并在 Comments 记录。

**User stories:** 12, 13, 14, 15

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/extensions/mcp/`、`packages/agent/src/ports/secrets.ts`、`apps/server/src/adapters/mcp.ts`（新）、`apps/server/src/adapters/credentials.ts`、`apps/server/src/application/context/mcp.ts`、`apps/server/src/application/secrets.ts`（新）、`apps/server/src/http/routes/mcp.ts`、`apps/server/src/http/routes/secrets.ts`、`apps/server/src/control/`、`packages/protocol/src/mcp.ts`、`packages/protocol/src/secrets.ts`、`packages/protocol/src/control.ts`（secret 消息）、`apps/desktop/src/main/`、`apps/desktop/src/preload/`、`apps/desktop/src/shared/bridge.ts`、`apps/desktop/src/renderer/features/settings/mcp-section.tsx`、`apps/desktop/src/renderer/stores/mcp-store.ts`（新）、`packages/i18n/src/dictionaries/domains/mcp.ts`、`tests/fixtures/mcp/`（新：stdio 与 HTTP 测试 Server）、`tests/integration/sidecar-mcp.test.ts`（新）、`tests/integration/secrets-gate-mcp.test.ts`（新）、`apps/desktop/e2e/mcp.e2e.test.ts`（新）、`docs/subsystems/mcp.md`（新）、`docs/subsystems/permissions.md`、`docs/adr/0007-secrets-from-registered-entries.md`、`docs/adr/0008-project-files-only-tighten.md`、`apps/server/README.md`

- [x] agent 测试：命名（非法字符、超过 64 字符截断加 hash、Server 名只差 `-` 与 `_` 时冲突诊断）、结果转换、配置校验与摘要（键顺序不影响摘要，改命令则摘要变化）
- [x] 集成测试（stdio 与 HTTP 测试 Server 各一）：连接后工具出现在 faux 请求的工具列表；default 模式下调用出现审批，允许后结果回到模型；full-access 免审批；规则 `mcp__srv` 的 allow 放行该 Server 全部工具；`disabledTools` 不注册；isError、超长截断、超时；测试 Server 收到 `_meta.idempotencyKey = <sessionId>:<toolCallId>`
- [x] 集成测试：项目 `.mcp.json` 的 Server 在批准前不启动（测试 Server 写入的启动标记文件不存在），批准后启动，改动 args 后回到 pending；项目项含 `${X}` 时拒绝加载并诊断；与全局同名时被忽略
- [x] 集成测试：Sidecar 有序关闭后 stdio 测试 Server 进程已退出（按 pid 检查）；测试 Server 崩溃后状态 failed 带 stderr 尾部，自动重连，`POST /api/mcp/reconnect` 可恢复；连接失败不阻止 Run
- [x] `secrets-gate-mcp.test.ts`：登记 `MY_SERVICE_DSN`（不匹配剔除模式）并在配置 env 中引用；测试 Server 只回报其 SHA-256 证明收到；扫描 WebSocket 帧、HTTP 响应、库与 `-wal`、`sidecar.jsonl`、MCP 诊断中都没有明文；同时在 Sidecar 环境中放同名变量，bash `env` 输出中没有该值；未登记名字时 Server 启动失败并诊断
- [x] E2E：MCP 分区添加 stdio Server、看到 connected 与工具数、停用后工具消失；登记 Secret 只显示末四位；批准项目 Server 的对话框显示完整命令
- [x] mcp.md 建立并可达（导航行写在 Comments）；permissions.md 记录 external 类与 `mcp__` 规则；ADR 0007 改为 implemented 并链接证据；ADR 0008 记录项目 Server 批准证据；server README 的 Secrets 一条改写；`pnpm run check:docs` 通过

## Comments
- 2026-10-29 lead：来自票 09 的发现——默认启用的贡献工具（memory_*、skill、mcp__*）会让每个 Session 的第一个 Run 多提交一条带 toolsAdded 的 system 条目，导致 12 个 M2 精确序列断言失败。统一修法（由票 09 实施，越出写范围已授权）：apps/server/src/application/sessions.ts 的 #createRuntime 在 createAgentRuntime 之前调用一次 runContext.tools.set(await this.#context.tools(runContext.scope))，使贡献工具进入首条 system message，只有之后的配置变化才产生 system 条目。本票遇到同样失败时复用这一修法，不另行修改；若本票先于票 09 合入，按同一写法实现，合并时由 Lead 去重。
- 2026-10-29 lead：来自票 09——Memory 写入前的脱敏只按凭据形态（如 sk- 前缀）匹配，不对照已登记的 Secret 值。本票建立 Secret 登记后，让共享脱敏同时替换已登记 Secret 的明文（Memory、工具结果、日志共用），并在秘密总闸中用非 sk- 形态的 Secret 验证。另：票 09 改动了 context/types.ts 与 runtime/layers.ts 的相邻行，合并 main 时注意。

### 实施者报告（m3/07-mcp-connections-tools-and-secrets，2026-10-29）

**覆盖的验收**

1. agent：`extensions/mcp/naming.test.ts`（非法字符、超过 64 字符截断加 8 位 hash 且保留 `mcp__<server>__`、同 Server 规范化后同名加 hash、只差 `-`/`_` 冲突）、`config.test.ts`（stdio / HTTP 校验与错误、键顺序不影响摘要、改命令 / 参数 / env / url / headers 摘要变化、启停与超时不变；`${NAME}` 展开与缺失；项目项 `${…}` 拒绝、与全局同名忽略）、`results.test.ts`（isError、图片、其他类型注明省略、2000 行 / 50KB 截断）、`connection.test.ts`（pi-mcp 内存传输：状态机、`_meta.idempotencyKey`、disabledTools、schema 补全、连接超时、stderr 20 行与脱敏、崩溃后退避重连与用尽、reconnect、list_changed）。
2. `tests/integration/sidecar-mcp.test.ts` 用例 1（stdio + HTTP 测试 Server）：工具出现在 faux requestLog；default 审批后结果回到模型；Session 规则 `mcp__remote` 放行；full-access 免审批；hidden 不注册；isError、截断、超时（timeout 1 秒）；两种传输都收到 `_meta.idempotencyKey = <sessionId>:<toolCallId>`。另：非法配置 400、通用设置接口改 `mcp.servers` 400。
3. 用例 2：项目 Server 批准前 Run 之后启动标记文件不存在；批准后启动（cwd 为 Workspace）；改 args 回到 pending、旧进程退出、旧摘要 409；`${X}` 项 `project-secret-reference`；同名项 `shadowed-by-global` 且其标记文件不存在。
4. 用例 3：不存在的命令 failed（ENOENT）且 Run completed；SIGKILL 后 failed（`Connection closed` + stderr 尾部）并自动重连到新 pid；之后启动都失败时 3 次重连用尽（共 5 次启动）停在 failed；`POST /api/mcp/reconnect` 恢复；`sidecar.stop()` 后按 pid 检查进程已退出。
5. `tests/integration/secrets-gate-mcp.test.ts`：IPC 模式登记 `MY_SERVICE_DSN`（非 sk- 形态），env 中引用；Server 回报的 SHA-256 等于登记值（Sidecar 环境放了同名的另一个值）；bash env 只有宿主值；扫描 WS 帧、HTTP 响应、库与 `-wal`、sidecar.jsonl、Sidecar stderr 与 MCP 诊断（`stderrTail` 为 `[REDACTED:secret]`）均无明文；工具结果中原样回显的值在条目中被替换；未登记名字 failed 并写明名字；删除后重连同样失败。
6. `apps/desktop/e2e/mcp.e2e.test.ts`：添加 stdio Server → connected、6 个工具（hidden 排除）、停用后 disabled 且工具数 0；登记 Secret 只显示末四位、输入框清空、页面与 `/api/secrets` 无明文、用户数据目录无明文；项目 Server 批准对话框显示完整 command、args 与 env 名，批准后启动。
7. 文档：新建 `docs/subsystems/mcp.md`（经 permissions.md、configuration 外的 server README 与 ADR 可达）；permissions.md 记录 external 注册与 `mcp__` 规则；ADR 0007 改 implemented 并附证据；ADR 0008 补项目 Server 证据（仍 partial，待 Skill allowed-tools）；server README 的 Secrets 一条改写并加 MCP / Secret 协议行；`pnpm run check:docs` 109 个文件 0 问题。

**pi coding-agent 的 inputSchema 处理（实施前核对）。** pi v1.4.0 `extensions/mcp/tools.ts` 的 `toParameters` 只补 `type: 'object'` 与空 `properties`，原样交给 pi-ai；pi-ai `validateToolArguments` 对非 TypeBox schema 先做 JSON Schema 形状的类型强转，再用 `typebox/compile` 的 `Compile` 校验。实测 typebox 1.3.27：未知关键字（`x-foo`、`$schema`）与未知 `format` 放行，已知 format（date-time）照常校验，引用不存在的 `$ref` 时校验总是失败。按 pi 做法放行；额外一处：`Compile` 抛错的 schema 以开放对象代替（Server 自行校验），见 `tool.ts` 的 `toParameters`。

**来自 Lead 的两条**

- 贡献工具进入首条 system message：main 上票 09 的写法（`#createRuntime` 中 `runContext.tools.set(...)`）已覆盖 MCP，本票未另改 sessions.ts。
- 共享脱敏对照已登记 Secret：`@coko/logging` 新增 `registerSecretValues` / `redactSecretValues` / `SECRET_REDACTED`；`redactText` 与 sidecar.jsonl 格式化先替换已登记的值（含 JSON 转义形式，少于 4 字符不替换）；`SecretService` 登记其已解密的值；`session-runtimes.ts` 对 toolResult 条目与 `tool_update` / `tool_end` 进度只做按值替换（其余工具输出不变）。Memory 经 `redactText` 自动获得。总闸用非 sk- 形态的值验证（见上第 5 条）。

**实际运行的命令与结果**（worktree，已 `git merge main`，main 为 a921013）

- `pnpm install --frozen-lockfile` 0；`pnpm run typecheck` 0；`pnpm run lint` 0（0 warnings）；`pnpm run format:check` 0；`pnpm run check:docs` 0（109 文件）。
- `pnpm run test`：135 个文件通过，1001 通过、1 跳过（真实模型），含 desktop E2E（`mcp.e2e.test.ts`、`desktop-shell.e2e.test.ts` 等）与 `package-smoke.e2e.test.ts` 2 个。第一次全量有 2 个失败（样式守卫拒绝组件中的字面文案 `MY_SERVICE_DSN`；合并时把 sections 测试打开的占位分区写成了已交付的 memory），已修复后重跑全绿。

**负向确认**

- `SecretService.redact` 不替换值 → `secrets-gate-mcp` 失败；去掉 `_meta` → `sidecar-mcp` 用例 1 失败；去掉项目批准检查 → 用例 2 失败（`idle` ≠ `pending-approval`）；去掉 toolResult 的按值替换 → `secrets-gate-mcp` 失败。撤销后均通过。
- agent 测试在模块存在之前全部失败；E2E 第一次运行发现 main 的 `sidecar-process.ts` 不转发 `secret.*` 控制消息（Secret 已入库但 `setSecret` 不返回），修复后通过。

**未验证项**

- 真实模型：无凭据，未运行。真实第三方 MCP Server（npx 等）未连接，只用仓库内测试 Server。
- 产物 smoke 未覆盖 MCP stdio（该文件归票 11，规格要求在 smoke 中证明 pi-mcp 与 cross-spawn 进入 sidecar bundle）；未打包路径的 E2E 用的是 `dist/sidecar` 构建产物，说明 bundle 中 MCP 可用，但打包产物未验证。
- 视觉：E2E 只断言结构与交互，未逐项核对明暗主题与窄窗口下的 MCP 分区。
- HTTP Server 的 SSE 响应流与 401（`auth-required`）未专门测试（pi-mcp 自带处理）；401 目前显示为普通 failed 错误文本，没有专门的 `auth-required` 状态。
- Windows / Linux 上 stdio 进程组关闭未验证（只在 darwin 运行）。

**越出 Write scope 的改动**（请 Lead 裁决）

- `apps/server/src/application/context/types.ts`（票 01）：`ContextContributionOptions.mcp?`（一行，与票 09 的 `memories?` 相邻，已合并）。
- `apps/server/src/runtime/layers.ts`（票 01）：构造 `SecretService`（IPC / 环境来源）与 `McpManager`，传入贡献与 SessionService，Application 增加 `mcp`、`secrets`；删除 `createEnvSecretProvider` 的使用。
- `apps/server/src/application/index.ts`：`Application.mcp`、`Application.secrets`（路由需要）。
- `apps/server/src/application/settings.ts`：通用设置接口拒绝 `mcp.servers` 与 `mcp.approvals.*`（与 config 键同理）。
- `apps/server/src/application/session-runtimes.ts`：toolResult 与工具进度的按值脱敏（Lead 第二条要求）。
- `packages/logging/src/{redact.ts,index.ts,file.ts}` 与新测试 `secret-values.test.ts`：共享的已登记值脱敏（Lead 第二条要求）。
- `apps/desktop/src/renderer/features/settings/sections.ts`（票 01）：mcp 改为 `available: true`；`sections.browser.test.tsx` 随之改为只剩 skills 占位。
- `apps/desktop/e2e/desktop-shell.e2e.test.ts`：bridge 键加 `setSecret`。
- `tests/integration/sidecar-sandbox.test.ts`、`secrets-gate.test.ts`：`secret_probe` 的 Secret 改从登记条目（IPC 下 `secret.store`）/ `COKO_SECRET_COKO_TEST_SECRET`（独立运行）取得，并断言 Sidecar 环境中的同名变量不被读取（ADR 0007 的直接后果）。
- `packages/agent/THIRD_PARTY_NOTICES.md`：登记 `src/extensions/mcp/` 改编自 pi。
- `apps/server/src/adapters/credentials.test.ts` 重写（原文件测试已删除的 `createEnvSecretProvider`）。

**文档影响 / 需 Lead 合并时处理**

- `docs/README.md`"当前行为"导航加一行：`- [MCP Server 连接与工具](subsystems/mcp.md)：全局与项目 Server 的配置与批准、连接状态与重连、工具命名与权限、Secret 的来源与 /api/mcp、/api/secrets。`
- `docs/TECH_STACK.md` 接入状态：票 01 一行已写"pi-mcp（票 07 起使用）"；建议改为"票 07 接入：stdio 与 streamable HTTP 传输、McpClient 工具"，或由 Lead 增一行"M3 票 07"。

### 供后续票

- **票 08（资源与提示模板）**：`McpConnection`（`packages/agent/src/extensions/mcp/connection.ts`）目前只公开 `callTool`、`tools`、`capabilities`；资源与 `prompts/*` 需要在该文件加一个经当前 client 的 `request(method, params, options)` 封装（client 私有，连接断开时拒绝）。`McpManager`（`apps/server/src/application/context/mcp.ts`）的 `toolsFor(scope)` 返回已连接 Server 的工具；资源工具（context-read）与命令来源可在 `mcpContribution` 中按同一池取 `connected` 的连接。`createMcpToolName`、`mcpNamespace` 在 `naming.ts`。
- **票 11（产物 smoke）**：stdio 测试 Server 为 `tests/fixtures/mcp/stdio-server.ts`（`stdioServerConfig(env, extra)` 生成以 `process.execPath` 启动的配置），经 `PUT /api/mcp/servers { servers, expectedRevision: 0, workspaceId }` 登记后后台连接，`GET /api/mcp?workspaceId` 轮询 `status: 'connected'`。
- **Secret**：`SecretService`（`application/secrets.ts`）的 `provider`、`resolve(name)`、`redact(text)`、`onChange(listener)`；进程级脱敏 `@coko/logging` 的 `registerSecretValues` / `redactSecretValues`。控制 IPC `secret.store` / `secret.decrypt`（`packages/protocol/src/control.ts`）；main 侧 `createSecretBridge`（`apps/desktop/src/main/secrets.ts`），preload `window.coko.setSecret(name, value)`。
- **设置键**：`mcp.servers`、`mcp.approvals.<workspaceId>`（`isMcpSettingKey`）只能经 `/api/mcp` 修改。
