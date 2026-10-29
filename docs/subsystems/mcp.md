---
kind: reference
description: "当前的 MCP Server 连接与工具契约：全局设置键 mcp.servers 与项目 .mcp.json 的形状与诊断、项目 Server 的按摘要批准、Secret 引用、连接状态机与池化、工具命名与结果转换、权限类 external、/api/mcp 与 /api/secrets、设置界面的 MCP 分区。修改 MCP 配置、连接、工具适配、Secret 来源或 MCP 界面前查阅。"
lifecycle: active
---

# MCP Server 连接与工具

本文说明 Coko 当前如何连接 MCP Server、把它们的工具交给 Agent，以及 MCP 配置可以引用的 Secret 从哪里来。范围是 stdio 与 streamable HTTP 两种传输上的工具；MCP 资源与提示模板尚未实现。长期决定见 [ADR 0007](../adr/0007-secrets-from-registered-entries.md)（Secret 只来自登记条目）与 [ADR 0008](../adr/0008-project-files-only-tighten.md)（项目 Server 须批准）。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/extensions/mcp/config.ts` | 配置校验 `validateMcpServerConfig`、规范化摘要 `digestMcpServer`、`${NAME}` 的查找与展开、`parseMcpServers` / `parseProjectMcpFile`（诊断） |
| `packages/agent/src/extensions/mcp/naming.ts` | 工具名 `mcp__<server>__<tool>`、截断与 hash、Server 名冲突 |
| `packages/agent/src/extensions/mcp/connection.ts` | `McpConnection`：pi-mcp `McpClient` 的连接状态机、连接超时、退避重连、stderr 尾部；传输由宿主注入 |
| `packages/agent/src/extensions/mcp/tool.ts`、`results.ts` | MCP 工具 → `CokoTool`（参数 schema、幂等键、进度），结果 → 模型内容 |
| `apps/server/src/adapters/mcp.ts` | stdio 与 streamable HTTP 传输；stdio 的环境与工作目录 |
| `apps/server/src/application/context/mcp.ts` | `McpManager`（按 (Workspace, Server) 池化、读取配置与批准、接口）与上下文贡献 `mcpContribution` |
| `apps/server/src/adapters/credentials.ts`、`application/secrets.ts` | Secret 来源（IPC 密文 / `COKO_SECRET_<NAME>`）与 `SecretService`（登记、删除、解析、按值脱敏） |
| `apps/server/src/http/routes/mcp.ts`、`routes/secrets.ts` | `/api/mcp` 系列与 `/api/secrets` |
| `packages/protocol/src/mcp.ts`、`secrets.ts`、`control.ts` | DTO、路径常量、设置键；控制 IPC 的 `secret.store` / `secret.decrypt` |
| `apps/desktop/src/main/secrets.ts` | main 一侧：safeStorage 加密 `setSecret` 的值、回答 `secret.decrypt` |
| `apps/desktop/src/renderer/stores/mcp-store.ts`、`features/settings/mcp-section.tsx` | 设置弹窗的 MCP 分区 |

## 配置

两处来源，形状都是通用的 `mcpServers` 映射（名字 → 配置）：

- **全局**：设置键 `mcp.servers`，只能经 `PUT /api/mcp/servers` 修改（通用设置接口对 `mcp.servers` 与 `mcp.approvals.*` 返回 400）。
- **项目**：`<Workspace>/.mcp.json` 的 `mcpServers`（受保护路径，Agent 写入须审批）。每次 `GET /api/mcp` 与每个 Run 开始时读取。

| 字段 | 适用 | 含义 |
| --- | --- | --- |
| `command`、`args?`、`env?`、`cwd?` | stdio（`type` 省略或 `stdio`） | `cwd` 相对 Workspace，缺省为 Workspace |
| `url`、`headers?` | HTTP（`type` 省略或 `http`） | http 或 https；不支持 SSE 与 OAuth |
| `enabled?` | 全部 | false 时保留配置、不连接（状态 disabled） |
| `timeout?` | 全部 | 单次请求超时（秒，缺省 60），进度通知重置 |
| `disabledTools?` | 全部 | 不注册的工具（按 Server 给出的名字） |

名字只能用字母、数字、`_`、`-`，不含 `__`，至多 40 个字符；只差 `-` 与 `_` 的两个名字冲突，后者被拒绝。未知键视为错误。能力配置 `mcp.enabled` 为 false 时（全局或项目设置关闭）所有 Server 为 disabled、不连接，见 [分层配置](configuration.md)。

**诊断**（`{ source: 'mcp', path?, code, message }`，不阻止 Run）：`invalid-server`（该项不合法，忽略）、`project-secret-reference`（项目项中任意字符串含 `${`，拒绝加载，ADR 0007）、`shadowed-by-global`（项目项与全局同名，忽略，全局优先）、`name-conflict`、`invalid-json` / `invalid-value`（整个 `.mcp.json` 忽略）、`read-failed`。全局配置经接口写入时就逐项校验，不合法时 400 并写明哪一项。

**项目 Server 的批准**（ADR 0008）。摘要为启动相关字段（传输、command、args、cwd、env；url、headers）键序规范化后的 SHA-256；`enabled`、`timeout`、`disabledTools` 不进入摘要。批准保存在设置键 `mcp.approvals.<workspaceId>`（`{ [name]: digest }`）。保存的摘要不等于当前摘要时状态为 pending-approval、不启动；命令、参数、地址、环境或请求头一改即回到 pending，已有连接随即关闭。

**Secret 引用**（ADR 0007）。只有全局配置的 `env` 值与 `headers` 值可以写 `${NAME}`，在启动或连接时从登记的 Secret 展开；名字未登记时该 Server 以 failed 结束，错误写明缺少的名字（`Secret NAME is not registered; …`），不回退到进程环境。字面值照常使用。

## 连接与生命周期

- **池化**：`McpManager` 按 (Workspace, Server 名) 保存连接，同一 Workspace 的 Session 共用。全局 Server 在每个 Workspace 各有一条连接。
- **何时连接**：Workspace 的 Run 开始时并发连接所有应当连接、状态为 idle 的 Server 并等待其结束（单个连接 30 秒超时）；失败不阻止 Run，该 Server 的工具缺席。经 `PUT /api/mcp/servers`（带 `workspaceId`）或批准之后也在后台连接，界面可立即看到结果。已 failed 的连接不在 Run 开始时自动重试。
- **状态**：idle、connecting、connected、failed（`error`，stdio 另有最后 20 行 stderr `stderrTail`）、disabled、pending-approval。错误与 stderr 尾部先把已解密的 Secret 值替换为 `[REDACTED:secret]`，再按凭据形态脱敏（`redactText`）。
- **崩溃与重连**：已连接的传输意外关闭时状态为 failed（`Connection closed` 与 stderr 尾部），之后按 1、2、4 秒退避自动重连至多 3 次；用尽后停在 failed，需 `POST /api/mcp/reconnect`（或界面的重新连接）。`tools/list_changed` 时刷新工具列表。
- **关闭**：配置改变（摘要不同）、Server 或能力被关闭、批准被撤销、引用的 Secret 被登记、替换或删除时关闭受影响的连接。Sidecar 有序关闭时在 Run 结束之后、存储关闭之前关闭全部连接；stdio 由 pi-mcp 先关 stdin，0.5 秒后 SIGTERM，再 2 秒后 SIGKILL（进程组）。Sidecar 被强杀时 stdio 子进程可能残留（地图 M4 的孤儿进程 Carry-over）。
- **stdio 的环境**：Sidecar 自身环境经与 bash 相同的 `HOST_ENV_EXCLUSIONS` 过滤（去掉 `COKO_*`、`ELECTRON_RUN_AS_NODE`、各 Provider 的密钥变量与凭据形态的名字），再叠加配置 `env`（Secret 已展开）。stdio 进程不套 Seatbelt。客户端声明的 roots 只有 Workspace。

## 工具

- **命名**：`mcp__<server>__<tool>`，`[A-Za-z0-9_-]` 之外的字符换成 `_`；超过 64 字符，或与同一 Server 的另一工具规范化后同名时，截断工具部分并加 8 位 hash（保留 `mcp__<server>__` 前缀，`mcp__<server>` 规则照常匹配）。
- **描述与参数**：描述与 inputSchema 原样交给模型；缺 `type` 时补 `object`、缺 `properties` 时补空对象。参数按 JSON Schema 校验（typebox 编译，不支持的关键字与未知 `format` 放行），校验失败为参数错误结果。schema 无法编译（例如引用不存在的 `$ref`）时以开放对象代替，由 Server 自行校验。这与 pi coding-agent 1.4.0 的做法相同。
- **权限**：宿主以权限类 external 注册，只有 full-access 免审批；规则可写全名或 `mcp__<server>`（匹配该 Server 全部工具），见 [权限判定与审批](permissions.md#模式)。effect 一律 side-effect（Server 的 readOnly 提示不可信），因此执行前提交 `tool_exec`。
- **调用**：`tools/call` 的 `_meta.idempotencyKey` 为 `<sessionId>:<toolCallId>`（与 `tool_exec` 记录同一个键）；超时为配置的 `timeout`，进度通知重置并作为 `tool_update` 推送；统一的 10 分钟工具时限不适用。超时与中止为该次调用的错误结果，不中断 Run。
- **结果**：`isError` 为错误结果（没有文本时为 `MCP tool <server>/<tool> returned an error`）；文本块合并后按 2000 行 / 50KB 截断并注明 `[MCP output truncated: showing N of M lines…]`；图片（含嵌入的图片资源）透传；嵌入的文本资源转为文本；音频、资源链接与二进制资源注明省略；只有 `structuredContent` 时为其 JSON。

## 协议

- `GET /api/mcp?workspaceId` → `McpResponse { enabled, servers, global, globalRevision, project?, diagnostics }`。`servers[]` 为 `{ name, scope, transport, enabled, status, error?, stderrTail?, tools, approval? }`：`tools` 为已注册工具（排除 `disabledTools`）；项目 Server 的 `approval = { digest, approved, launch }`，`launch` 为批准对话框显示的 command、args、cwd、url 与 env / 请求头的名字（不含值）。`global` 是保存的全局配置（Secret 以 `${NAME}` 出现）。不给 `workspaceId` 时只有全局 Server，状态不反映任何连接。
- `PUT /api/mcp/servers { servers, expectedRevision, workspaceId? }`：整体替换全局配置；不合法 400，revision 不一致 409 `revision-conflict`。
- `POST /api/mcp/approvals { workspaceId, name, digest, approve }`：批准时摘要须等于当前项目配置，否则 409 `revision-conflict`；`approve: false` 撤销批准。项目 Server 不存在 404。
- `POST /api/mcp/reconnect { workspaceId, name }`：关闭并重新连接，等待结束后返回 `McpResponse`；Server 为 disabled / pending-approval 时 400。
- `GET /api/secrets` → `{ source: 'stored' | 'environment', secrets: { name, hint, updatedAt? }[] }`（`hint` 为末四位，短于 8 个字符的值为空）；`DELETE /api/secrets/:name` 204，不存在 404，无界面运行时 400。

## Secret 的来源

Secret 名形如 `^[A-Z][A-Z0-9_]{0,63}$`。桌面应用：renderer 调 preload `setSecret(name, value)` → main 以 safeStorage 加密（不可用时 `encryption-unavailable`，不回退明文）→ 控制 IPC `secret.store { name, ciphertext, hint }` → Sidecar 存入 `secrets` 表并回 `secret.store.result`；需要明文时发 `secret.decrypt`，明文只缓存在 Sidecar 内存，登记被替换或删除时清除。无界面运行（没有 IPC 父进程）只读 `COKO_SECRET_<NAME>`；Sidecar 不再按名字读取自身环境中的同名变量。工具声明的 Secrets（`CokoTool.secrets`）经同一 `SecretService` 解析。

**按值脱敏。** `SecretService` 把当前已解密的值登记为 `@coko/logging` 的进程级来源（`registerSecretValues`）：`redactText`（模型错误、Memory 正文、MCP 错误与 stderr 尾部）与 sidecar.jsonl 的格式化在凭据形态之外替换这些值；工具结果（`toolResult` 条目、`tool_update` / `tool_end` 进度）只替换这些值（`redactSecretValues`），其余输出保持原样。替换文本为 `[REDACTED:secret]`，少于 4 个字符的值不替换。只有本进程已解密过的值会被替换；模型在当前 Run 中看到的工具结果不经替换。

## 界面

设置弹窗的 MCP 分区：全局 Server 卡片（名称、传输、状态、工具数与展开的工具列表、启停、编辑、删除、重新连接；failed 时显示错误与可展开的 stderr 尾部）；"添加 Server"表单（stdio 的命令、每行一个参数、`NAME=value` 环境、工作目录；HTTP 的地址与 `Name: value` 请求头；超时与不注册的工具）；当前会话所在 Workspace 的项目 Server（"查看并批准"打开对话框显示完整命令、参数、地址与环境变量 / 请求头的名字，批准后启动；已批准的可撤销）；配置诊断；Secrets 子区（名称与末四位、删除、登记表单，值输入框为密码框，保存后清空）。分区打开期间每 0.75 秒读取一次状态。

## 尚未实现

MCP 资源与提示模板（票 08）、OAuth、SSE 与 WebSocket 传输、sampling、elicitation、资源订阅、stdio Server 的沙箱。

## 验证

- `packages/agent/src/extensions/mcp/naming.test.ts`、`config.test.ts`、`results.test.ts`、`connection.test.ts`：命名（非法字符、64 字符截断加 hash、同 Server 规范化后同名、只差 `-` 与 `_` 的冲突）；配置校验、键顺序不影响摘要而改命令改变摘要、Secret 引用的展开与缺失、项目项的 `${…}` 与同名遮蔽；结果转换与截断；经 pi-mcp 内存传输的状态机、`_meta`、`disabledTools`、连接超时、stderr 尾部 20 行与脱敏、崩溃后退避重连与用尽、`tools/list_changed`。
- `tests/integration/sidecar-mcp.test.ts`（仓库内的 `tests/fixtures/mcp/` stdio 与 HTTP 测试 Server）：工具出现在 faux 请求中、default 审批、Session 规则 `mcp__remote` 放行、full-access 免审批、`disabledTools`、isError、截断、超时、两种传输上的 `_meta.idempotencyKey`；项目 `.mcp.json` 批准前不启动（启动标记文件不存在）、批准后启动、改 args 后回到 pending 且旧进程退出、旧摘要 409、`${…}` 与同名的诊断；连接失败不阻止 Run、崩溃后 failed 带 stderr 尾部并自动重连、重连用尽后 `POST /api/mcp/reconnect` 恢复、有序关闭后按 pid 检查子进程已退出。
- `tests/integration/secrets-gate-mcp.test.ts`：秘密总闸的 MCP 通道，见 [ADR 0007](../adr/0007-secrets-from-registered-entries.md)。
- `apps/server/src/adapters/credentials.test.ts`、`apps/desktop/src/main/secrets.test.ts`、`packages/protocol/src/control.test.ts`：Secret 来源、main 的加解密与消息形状。
- `apps/desktop/e2e/mcp.e2e.test.ts`：MCP 分区添加 stdio Server、connected 与工具数、停用后工具消失、Secret 只显示末四位、批准对话框显示完整命令。

## 延伸阅读

- [权限判定与审批](permissions.md)：external 类与 `mcp__` 规则。
- [分层配置](configuration.md)：`mcp.enabled` 与项目设置。
- [apps/server README](../../apps/server/README.md)：协议总览与 Secret 的启动参数。
