---
kind: reference
description: "当前的 MCP Server 连接、工具、资源与提示模板契约：全局设置键 mcp.servers 与项目 .mcp.json 的形状与诊断、项目 Server 的按摘要批准、Secret 引用、连接状态机与池化（含 HTTP 401 的 auth-required）、工具命名与结果转换（含图像结果）、权限类 external 与 context-read、资源工具、/mcp__<server>__<prompt> 命令、浏览器预设（Playwright MCP）、/api/mcp 与 /api/secrets、设置界面的 MCP 分区。修改 MCP 配置、连接、认证、工具适配、资源或提示模板、预设、Secret 来源或 MCP 界面前查阅。"
lifecycle: active
---

# MCP Server 连接、工具、资源与提示模板

本文说明 Coko 当前如何连接 MCP Server、把它们的工具与资源交给 Agent、把提示模板登记为命令，以及 MCP 配置可以引用的 Secret 从哪里来。范围是 stdio 与 streamable HTTP 两种传输。长期决定见 [ADR 0007](../adr/0007-secrets-from-registered-entries.md)（Secret 只来自登记条目）与 [ADR 0008](../adr/0008-project-files-only-tighten.md)（项目 Server 须批准）。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/extensions/mcp/config.ts` | 配置校验 `validateMcpServerConfig`、规范化摘要 `digestMcpServer`、`${NAME}` 的查找与展开、`parseMcpServers` / `parseProjectMcpFile`（诊断） |
| `packages/agent/src/extensions/mcp/naming.ts` | 工具名 `mcp__<server>__<tool>`、截断与 hash、Server 名冲突 |
| `packages/agent/src/extensions/mcp/connection.ts` | `McpConnection`：pi-mcp `McpClient` 的连接状态机、连接超时、退避重连、stderr 尾部、auth-required（给宿主传输的 `authProvider`、`isMcpAuthError`）；传输由宿主注入 |
| `packages/agent/src/extensions/mcp/tool.ts`、`results.ts` | MCP 工具 → `CokoTool`（参数 schema、幂等键、进度），结果 → 模型内容 |
| `packages/agent/src/extensions/mcp/pagination.ts` | 分页列表：按 `nextCursor` 翻页、重复 cursor 与 1000 页上限、逐项校验与诊断 |
| `packages/agent/src/extensions/mcp/resources.ts` | 资源工具 `list_mcp_resources`、`list_mcp_resource_templates`、`read_mcp_resource` |
| `packages/agent/src/extensions/mcp/prompts.ts` | 提示模板：`prompts/list` 与 `prompts/get` 的请求封装、结果校验、位置参数映射、消息转文本 |
| `apps/server/src/adapters/mcp.ts` | stdio 与 streamable HTTP 传输；stdio 的环境与工作目录 |
| `apps/server/src/application/context/mcp.ts`、`mcp-admin.ts` | `McpManager`（按 (Workspace, Server) 池化、读取配置与批准、资源工具与提示模板命令、连接状态的诊断）与上下文贡献 `mcpContribution`；`McpAdmin`（`/api/mcp` 的视图、保存、批准、重连与预设 `MCP_PRESETS`） |
| `apps/server/src/adapters/credentials.ts`、`application/secrets.ts` | Secret 来源（IPC 密文 / `COKO_SECRET_<NAME>`）与 `SecretService`（登记、删除、解析、按值脱敏） |
| `apps/server/src/http/routes/mcp.ts`、`routes/secrets.ts` | `/api/mcp` 系列与 `/api/secrets` |
| `packages/protocol/src/mcp.ts`、`secrets.ts`、`control.ts` | DTO、路径常量、设置键；控制 IPC 的 `secret.store` / `secret.decrypt` |
| `apps/desktop/src/main/secrets.ts`、`encrypting-bridge.ts` | main 一侧：safeStorage 加密 `setSecret` 的值、回答 `secret.decrypt`（与 Credential 共用 `createEncryptingBridge`） |
| `apps/desktop/src/renderer/stores/mcp-store.ts`、`features/settings/mcp-section.tsx` | 设置页的 MCP 分区（含"添加浏览器"与需要认证的入口） |
| `apps/desktop/src/renderer/features/conversation/tool-cards.tsx` | 工具卡；通用工具卡显示结果中的图片缩略图 |

## 配置

两处来源，形状都是通用的 `mcpServers` 映射（名字 → 配置）：

- **全局**：设置键 `mcp.servers`，只能经 `PUT /api/mcp/servers` 修改（通用设置接口对 `mcp.servers` 与 `mcp.approvals.*` 返回 400）。
- **项目**：`<Workspace>/.mcp.json` 的 `mcpServers`（受保护路径，Agent 写入须审批）。每次 `GET /api/mcp` 与每个 Run 开始时读取。
- **插件**：已启用插件的 Server（ADR 0017）并入全局一级（`scope` 为 global），名字为 `plugin-<插件名>-<server>`，不经项目批准；任意字符串含 `${` 的不加载（诊断 `plugin-secret-reference`，source `plugin`，需要凭据的在全局 MCP 中配置）。插件启用、禁用、批准、更新或卸载之后，`McpManager.reconcileAll()` 对池中每个（Workspace, 目录）重新读取配置，不再提供的插件 Server 的连接关闭；插件的安装与批准见 [插件](plugins.md)。

| 字段 | 适用 | 含义 |
| --- | --- | --- |
| `command`、`args?`、`env?`、`cwd?` | stdio（`type` 省略或 `stdio`） | `cwd` 相对 Workspace，缺省为 Workspace |
| `url`、`headers?` | HTTP（`type` 省略或 `http`） | http 或 https；凭据写在 `headers`（可引用 Secret）；不支持 SSE 与 OAuth |
| `enabled?` | 全部 | false 时保留配置、不连接（状态 disabled） |
| `timeout?` | 全部 | 单次请求超时（秒，缺省 60），进度通知重置 |
| `disabledTools?` | 全部 | 不注册的工具（按 Server 给出的名字） |

名字只能用字母、数字、`_`、`-`，不含 `__`，至多 40 个字符。名字按权限规则匹配工具名的方式比较：不区分大小写，`-` 等于 `_`（`serverNameKey`）；只差大小写、`-` 或 `_` 的两个名字冲突，后者被拒绝。项目项与全局项按同一规则比较，`GitHub` 与全局的 `github` 视为同名而被忽略，因此项目 Server 不能借名字继承用户为全局 Server 保存的 `mcp__github` 规则。未知键视为错误。能力配置 `mcp.enabled` 为 false 时（全局或项目设置关闭）所有 Server 为 disabled、不连接，见 [分层配置](configuration.md)。

**诊断**（`{ source: 'mcp', path?, code, message }`，不阻止 Run）：`invalid-server`（该项不合法，忽略）、`project-secret-reference`（项目项中任意字符串含 `${`，拒绝加载，ADR 0007）、`shadowed-by-global`（项目项与全局同名，按上面的规则比较，忽略，全局优先）、`name-conflict`、`invalid-json` / `invalid-value`（整个 `.mcp.json` 忽略）、`read-failed`。全局配置经接口写入时就逐项校验，不合法时 400 并写明哪一项。

**项目 Server 的批准**（ADR 0008）。摘要为启动相关字段（传输、command、args、cwd、env；url、headers）键序规范化后的 SHA-256；`enabled`、`timeout`、`disabledTools` 不进入摘要。批准保存在设置键 `mcp.approvals.<workspaceId>`（`{ [name]: digest }`）。保存的摘要不等于当前摘要时状态为 pending-approval、不启动；命令、参数、地址、环境或请求头一改即回到 pending，已有连接随即关闭。

**Secret 引用**（ADR 0007）。只有全局配置的 `env` 值与 `headers` 值可以写 `${NAME}`，在启动或连接时从登记的 Secret 展开；名字未登记时该 Server 以 failed 结束，错误写明缺少的名字（`Secret NAME is not registered; …`），不回退到进程环境。字面值照常使用。

## 连接与生命周期

- **池化**：`McpManager` 按 (Workspace, Server 名) 保存连接，同一 Workspace 的 Session 共用。全局 Server 在每个 Workspace 各有一条连接。
- **何时连接**：Workspace 的 Run 开始时并发连接所有应当连接、状态为 idle 的 Server 并等待其结束（单个连接 30 秒超时）；失败不阻止 Run，该 Server 的工具缺席。经 `PUT /api/mcp/servers`（带 `workspaceId`）或批准之后也在后台连接，界面可立即看到结果。已 failed 的连接不在 Run 开始时自动重试。
- **状态**：idle、connecting、connected、failed（`error`，stdio 另有最后 20 行 stderr `stderrTail`）、disabled、pending-approval、auth-required（见下条）。错误与 stderr 尾部先把已解密的 Secret 值替换为 `[REDACTED:secret]`，再按凭据形态脱敏（`redactText`）。
- **需要认证（auth-required）**：HTTP 传输装配 pi-mcp 的 `AuthProvider`（不提供令牌，凭据来自配置的 `headers`）。Server 回 401（或 403 且 `WWW-Authenticate` 为 `insufficient_scope`）时 `onUnauthorized` 立即结束该请求，不以同样的请求头再试；连接错误中读到 HTTP 401（`McpAuthRequiredError` 或状态 401 的 `McpHttpError`）同样处理。发生在连接时，该次连接以 auth-required 结束；发生在已连接后的请求（例如只有 `tools/call` 要求认证）时，该次调用为错误结果 `MCP server "<name>" requires authentication (HTTP 401)`，连接关闭、工具清空、状态 auth-required。之后不按退避重连，Run 开始时也不重试（与 failed 相同）；修改配置（摘要改变，连接关闭后重新连接）、手动 `POST /api/mcp/reconnect` 或引用的 Secret 改变后重试。`error` 为上面的固定文本，诊断 `mcp-auth-required`（`MCP server "<name>" requires authentication: check the credentials in its headers; reference a registered Secret as ${NAME}`）随状态出现在 `GET /api/mcp` 与上下文用量接口中，状态改变后消失；sidecar.jsonl 记 `mcp server requires authentication`（只有 Workspace 与 Server 名）。401 的响应体与 `WWW-Authenticate`（其中可能有令牌）不进入错误、诊断、日志与协议。stdio 不受影响。
- **崩溃与重连**：已连接的传输意外关闭时状态为 failed（`Connection closed` 与 stderr 尾部），之后按 1、2、4 秒退避自动重连至多 3 次；用尽后停在 failed，需 `POST /api/mcp/reconnect`（或界面的重新连接）。`tools/list_changed` 时刷新工具列表；`prompts/list_changed`、`resources/list_changed` 与每次建立连接时，连接的列表版本（`listRevision`）前进，缓存的提示模板列表随之失效。
- **关闭**：配置改变（摘要不同）、Server 或能力被关闭、批准被撤销、引用的 Secret 被登记、替换或删除时关闭受影响的连接。Sidecar 有序关闭时在 Run 结束之后、存储关闭之前关闭全部连接；stdio 由 pi-mcp 先关 stdin，0.5 秒后 SIGTERM，再 2 秒后 SIGKILL（进程组）。Sidecar 被强杀时 stdio 子进程可能残留（地图 M4 的孤儿进程 Carry-over）。
- **stdio 的环境**：Sidecar 自身环境经与 bash 相同的 `HOST_ENV_EXCLUSIONS` 过滤（去掉 `COKO_*`、`ELECTRON_RUN_AS_NODE`、各 Provider 的密钥变量与凭据形态的名字），再叠加配置 `env`（Secret 已展开）。stdio 进程不套 Seatbelt。客户端声明的 roots 只有 Workspace。

## 工具

- **命名**：`mcp__<server>__<tool>`，`[A-Za-z0-9_-]` 之外的字符换成 `_`；超过 64 字符，或与同一 Server 的另一工具规范化后同名时，截断工具部分并加 8 位 hash（保留 `mcp__<server>__` 前缀，`mcp__<server>` 规则照常匹配）。
- **描述与参数**：描述与 inputSchema 原样交给模型；缺 `type` 时补 `object`、缺 `properties` 时补空对象。参数按 JSON Schema 校验（typebox 编译，不支持的关键字与未知 `format` 放行），校验失败为参数错误结果。schema 无法编译（例如引用不存在的 `$ref`）时以开放对象代替，由 Server 自行校验。这与 pi coding-agent 1.4.0 的做法相同。
- **权限**：宿主以权限类 external 注册，只有 full-access 免审批；规则可写全名或 `mcp__<server>`（匹配该 Server 全部工具），见 [权限判定与审批](permissions.md#模式)。effect 一律 side-effect（Server 的 readOnly 提示不可信），因此执行前提交 `tool_exec`。
- **调用**：`tools/call` 的 `_meta.idempotencyKey` 为 `<sessionId>:<toolCallId>`（与 `tool_exec` 记录同一个键）；超时为配置的 `timeout`，进度通知重置并作为 `tool_update` 推送；统一的 10 分钟工具时限不适用。超时与中止为该次调用的错误结果，不中断 Run。
- **结果**：`isError` 为错误结果（没有文本时为 `MCP tool <server>/<tool> returned an error`）；文本块合并后按 2000 行 / 50KB 截断并注明 `[MCP output truncated: showing N of M lines…]`；图片（含嵌入的图片资源）透传：toolResult 条目中为 `{ type: 'image', data, mimeType }` 块，下一次模型请求原样带上（base64 与 mimeType 不变，Secret 的按值替换只作用于文本）；嵌入的文本资源转为文本；音频、资源链接与二进制资源注明省略；只有 `structuredContent` 时为其 JSON。

## 资源

- **注册**：Run 开始时，若该 Workspace 有已连接的 Server 在 `initialize` 中声明了 `resources` 能力，注册三个工具（权限类 context-read，effect read，四种模式都不审批；deny 规则照常生效，例如项目 `.coko/settings.json` 的 `permissions.deny: ["read_mcp_resource"]`）。没有这样的 Server 时三个工具都不注册。工具在调用时按池中当前的连接查找 Server，只覆盖本 Run 加载的 Server；没有声明 resources 的 Server 不可用（错误写明有资源的 Server）。它们不计入 `GET /api/mcp` 中各 Server 的 `tools`。
- **`list_mcp_resources { server?, cursor? }`、`list_mcp_resource_templates { server?, cursor? }`**：结果为 JSON。给出 `server` 时列一页（`{ server, resources | resourceTemplates, nextCursor? }`），`cursor` 接着翻；不给时按名字顺序列出全部 Server 的全部分页，失败或不合格的部分放进 `errors: [{ server, error }]`，不使整个调用失败。不给 `server` 时不能给 `cursor`。每项带 `server`，去掉 `_meta` 与 `icons`；缺 `name` 时用 URI 代替。
- **分页**：按 `nextCursor` 翻页（`null` 与空字符串视为结束），最多 1000 页；cursor 重复时停止（`duplicate-cursor`），超过上限时停止（`page-limit`），已取得的项保留。页不合 schema 时停止、单项不合 schema 时跳过（`invalid-result`）。与提示模板共用同一实现。
- **`read_mcp_resource { server, uri }`**：`resources/read` 的每个内容：文本合并后按 2000 行 / 50KB 截断并注明 `[Resource truncated: showing N of M lines…]`（单行超过 50KB 时按字节截断）；`image/*` 的 blob 作为图片内容块透传；其他 blob 注明 `[binary resource <uri> (<mimeType>, <大小>) omitted]`；有多个内容时以 URI 标注。结果不合 schema（缺 `contents`、内容缺 `uri` 或 `text` / `blob`）时为错误结果。请求超时为该 Server 的 `timeout`。
- 结果作为 toolResult 条目入库前与其他工具输出一样替换已登记 Secret 的明文。资源订阅（`resources/subscribe`）与在 `@` 菜单中引用资源不实现。

## 提示模板

pi-mcp 没有 prompts 方法，Coko 经连接的通用 `request()` 封装 `prompts/list` 与 `prompts/get`。

- **登记为命令**：声明了 `prompts` 能力的已连接 Server 的每个提示模板以 `/mcp__<server>__<prompt>` 登记到命令目录（来源 `mcp`，见 [命令](commands.md)；命名与截断规则同工具名）。描述取 `description`，缺省为 `title` 或 `MCP prompt <name> from server <server>`；`argumentHint` 按声明顺序列出参数，必填为 `<name>`、可选为 `[name]`。`commands.enabled` 与 `commands.disabled` 对它们生效；同名时优先级最低。
- **何时连接与刷新**：`GET /api/commands` 与提交消息（命令展开）和 Run 开始时一样，先连接该 Workspace 应当连接、状态为 idle 的 Server（失败的不重试）。每个连接的 `prompts/list` 结果缓存到列表版本前进（`prompts/list_changed` 或重连）为止；列出失败只记 warn，下一次重新请求。
- **调用**：参数文本按命令模板的规则拆分（引号可包含空格），按声明顺序映射到参数，多出的词并入最后一个参数；没有声明参数时忽略参数文本。缺必填参数时提交以 400 `bad-request` 失败，消息写明参数名，`details = { reason: 'missing-arguments', missing }`，不开始 Run。成功时先提交 `command { name, args, source: 'mcp' }` 条目，再提交展开文本为 user message（steer 同样）。
- **结果校验**：`prompts/get` 的结果须有 `messages` 数组，每条 `role` 为 user 或 assistant、`content` 为合格的 text、image、audio、resource 或 resource_link 块。不合格时提交以 400 `bad-request`（`details.reason = 'invalid-result'`）失败，诊断 `invalid-result` 进入 `GET /api/mcp` 的 `diagnostics` 与上下文用量接口；请求失败（超时、Server 错误、未连接）同样 400，原因经 Secret 脱敏。`prompts/list` 中不合格的项跳过并记诊断。结果诊断按 Server 保存最近一次，下一次成功时清除。
- **消息转文本**：全部消息按顺序以空行连接（不保留角色）：文本原样；嵌入的文本资源内联为 `<resource uri="…">\n…\n</resource>`；图片与音频注明 `[image <mimeType> omitted]` / `[audio … omitted]`；二进制资源注明类型与大小；资源链接写为 `[resource link <uri> "<title>"]`。展开文本入库前替换已登记 Secret 的明文。

## 浏览器预设

`McpAdmin` 的 `MCP_PRESETS` 只有一项：`{ id: 'playwright', name: 'playwright', label: 'Browser (Playwright)', config: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--isolated'] } }`。版本精确锁定；`--isolated` 使每次连接用临时的浏览器配置，不读写用户的浏览器资料。预设不是单独的配置来源：界面确认后经 `PUT /api/mcp/servers` 把 `config` 写入全局配置，之后与手动添加的 stdio Server 相同（权限类 external，每次调用需审批；进程登记为 mcp，经 npx 派生的浏览器进程在同一进程组内）。Playwright MCP 由用户本机的 npx 在首次连接时下载，不进 manifest 与 `pnpm-lock.yaml`。command 为 `npx`（或 `npx.cmd`）的 Server 因找不到它而失败（`ENOENT`）时诊断 `mcp-npx-missing`（`MCP server "<name>" runs npx, which was not found: install Node.js (npx)`）。

## 协议

- `GET /api/mcp?workspaceId` → `McpResponse { enabled, servers, global, globalRevision, project?, diagnostics }`（给出 `workspaceId` 时 `diagnostics` 含该 Workspace 连接的结果诊断）。`servers[]` 为 `{ name, scope, transport, enabled, status, error?, stderrTail?, tools, approval? }`：`tools` 为已注册工具（排除 `disabledTools`）；项目 Server 的 `approval = { digest, approved, launch }`，`launch` 为批准对话框显示的 command、args、cwd、url、`env` 与 `headers`（完整键值：项目项中含 `${` 的整项拒绝，这里只有文件中的字面值，不会泄露登记的 Secret；全局 Server 没有 `launch`）。`global` 是保存的全局配置（Secret 以 `${NAME}` 出现）。不给 `workspaceId` 时只有全局 Server，状态不反映任何连接。
- `PUT /api/mcp/servers { servers, expectedRevision, workspaceId? }`：整体替换全局配置；不合法 400，revision 不一致 409 `revision-conflict`。
- `POST /api/mcp/approvals { workspaceId, name, digest, approve }`：批准时摘要须等于当前项目配置，否则 409 `revision-conflict`；`approve: false` 撤销批准。项目 Server 不存在 404。
- `POST /api/mcp/reconnect { workspaceId, name }`：关闭并重新连接，等待结束后返回 `McpResponse`；Server 为 disabled / pending-approval 时 400（auth-required 与 failed 可以重连）。
- `GET /api/mcp/presets` → `McpPresetsResponse { presets: McpPreset[] }`，`McpPreset { id, name, label, config: { command, args } }`（`id` 为稳定标识，界面按它取本地化名称，`label` 为英文后备）。
- `servers[].error` 在 failed 与 auth-required 时给出。
- `GET /api/secrets` → `{ source: 'stored' | 'environment', secrets: { name, hint, updatedAt? }[] }`（`hint` 为末四位，短于 8 个字符的值为空）；`DELETE /api/secrets/:name` 204，不存在 404，无界面运行时 400。

## Secret 的来源

Secret 名形如 `^[A-Z][A-Z0-9_]{0,63}$`。桌面应用：renderer 调 preload `setSecret(name, value)` → main 以 safeStorage 加密（不可用时 `encryption-unavailable`，不回退明文）→ 控制 IPC `secret.store { name, ciphertext, hint }` → Sidecar 存入 `secrets` 表并回 `secret.store.result`；需要明文时发 `secret.decrypt`，明文只缓存在 Sidecar 内存，登记被替换或删除时清除。无界面运行（没有 IPC 父进程）只读 `COKO_SECRET_<NAME>`；Sidecar 不再按名字读取自身环境中的同名变量。工具声明的 Secrets（`CokoTool.secrets`）经同一 `SecretService` 解析。

**按值脱敏。** `SecretService` 把当前已解密的值登记为 `@coko/logging` 的进程级来源（`registerSecretValues`）；Provider Credential 的明文（IPC 模式为已解密的缓存，无界面运行为 `COKO_CREDENTIAL_*`）同样登记，替换文本为 `[REDACTED]`。`redactText`（模型错误、Memory 正文、MCP 错误与 stderr 尾部）与 sidecar.jsonl 的格式化在凭据形态之外替换这些值。Session 运行时上的替换点（`apps/server/src/application/secret-redaction.ts`）：

- 工具结果在进入运行时之前替换（afterToolCall 链的最后一个 hook，含其他 hook 附加的嵌套指令）：运行时内存、下一次模型请求、库与推送看到同一份文本。
- 每次模型请求前整个上下文按值替换（模型回显的文本与工具调用参数、压缩摘要、恢复后的条目），摘要请求读取的条目同样替换；工具实际执行时拿到的仍是模型给出的原参数。
- 入库与推送前再替换一次：除用户消息外的全部条目 payload（assistant 文本与 toolCall 参数、工具结果、`compaction.summary`、审批对象、执行记录）与全部进度；assistant 增量按内容块缓冲，可能是某个登记值开头的结尾留到下一个增量，跨增量的值也被替换（留下的结尾由之后提交的完整条目取代）。
- 用户自己输入的文本按原样入库；File Reference 块在生成时替换（与 read 工具一致），MCP 提示模板的展开文本经 `SecretService.redactValues` 替换。

替换文本为 `[REDACTED:secret]`，少于 4 个字符的值不替换。只有本进程已解密过的值会被替换。

## 界面

设置页的 MCP 分区：全局 Server 卡片（名称、传输、状态、工具数与展开的工具列表、启停、编辑、删除、重新连接；failed 时显示错误与可展开的 stderr 尾部；auth-required 时状态为"需要认证"（`text-warning-text`）、下方说明"服务器要求认证：检查请求头中的凭据，可引用登记的 Secret ${NAME}"，全局 HTTP Server 另有"编辑请求头"，打开该 Server 的编辑表单并聚焦请求头）；分区标题旁的"添加浏览器"菜单（预设来自 `GET /api/mcp/presets`，名称按 `id` 本地化），选择后的对话框显示完整命令与可改的名称，确认后经全局保存接口写入；名称与已有的全局 Server 按服务端规则冲突（不区分大小写，`-` 等于 `_`）时不保存，提示改名并回到名称输入框；"添加 Server"表单（stdio 的命令、每行一个参数、`NAME=value` 环境、工作目录；HTTP 的地址与 `Name: value` 请求头；超时与不注册的工具）；当前会话所在 Workspace 的项目 Server（"查看并批准"打开对话框显示完整命令、参数、地址与逐行的环境变量 / 请求头键值，批准后启动；已批准的可撤销）；分区顶部的能力开关 `mcp.enabled`（与其他能力开关共用，见 [分层配置](configuration.md#界面)）；保存或删除失败时显示本地化文案，服务端原文只在表单的"技术详情"中展开查看；配置诊断；Secrets 子区（名称与末四位、删除、登记表单，值输入框为密码框，保存后清空）。分区打开期间每 0.75 秒读取一次状态。

时间线的工具详情展开后，在完整结果文本下显示该调用自身的图片图库（PNG、JPEG、GIF、WebP 的 inline base64；SVG、URL 等来源不加载）。单图按实际解码尺寸和 0.25—4 的显示比例计算，长边最多 240px、命中区至少 44px；多图为 64px 方格、间距 10px。尺寸文字明确标为实际解码尺寸；缺少路径或原始尺寸记录时不推断。不可解码图片显示本地化失败状态。点击缩略图或键盘 Enter / Space 打开覆盖视口的原图预览，Escape、关闭按钮或背景操作关闭后焦点回到原缩略图，内部操作不改变工具开合。预览通过所属过程组的交互锁保持返回控件可达；Run 正常完成时保持整轮与该组展开，关闭预览后也不立即隐藏返回焦点，后续仍可手动折叠。图片来源包括实时 partialResult、已结束的实时结果与已提交 toolResult；已提交结果优先，包括最终空结果。以图片来源及同源出现次序保持显示身份，新增文本与结算不重建未改变的图片或预览；子 Session 使用自己的结果，不查主会话条目。预览只使用原有 data URL，不分配 Blob URL。

## 尚未实现

OAuth（auth-required 之后由用户在请求头中填写凭据；没有授权流程与令牌刷新）、SSE 与 WebSocket 传输、sampling、elicitation、资源订阅、在 `@` 菜单引用资源、stdio Server 的沙箱、其他浏览器预设。HTTP 测试 Server 没有服务端流，list_changed 通知只在 stdio 上验证，GET 流上的 401 未单独验证。真实的 Playwright MCP 与真实要求认证的 HTTP 服务未在自动化中验证（`sidecar-mcp-presets` 的真实用例只在 `COKO_REAL_PLAYWRIGHT_MCP=1` 时运行）。

## 验证

- `packages/agent/src/extensions/mcp/naming.test.ts`、`config.test.ts`、`results.test.ts`、`connection.test.ts`：命名（非法字符、64 字符截断加 hash、同 Server 规范化后同名、只差 `-` 与 `_` 的冲突）；配置校验、键顺序不影响摘要而改命令改变摘要、Secret 引用的展开与缺失、项目项的 `${…}` 与同名遮蔽；结果转换与截断；经 pi-mcp 内存传输的状态机、`_meta`、`disabledTools`、连接超时、stderr 尾部 20 行与脱敏、崩溃后退避重连与用尽、`tools/list_changed`。
- `tests/integration/sidecar-mcp.test.ts`（仓库内的 `tests/fixtures/mcp/` stdio 与 HTTP 测试 Server）：工具出现在 faux 请求中、default 审批、Session 规则 `mcp__remote` 放行、full-access 免审批、`disabledTools`、isError、截断、超时、两种传输上的 `_meta.idempotencyKey`；项目 `.mcp.json` 批准前不启动（启动标记文件不存在）、批准后启动、改 args 后回到 pending 且旧进程退出、旧摘要 409、`${…}` 与同名的诊断；连接失败不阻止 Run、崩溃后 failed 带 stderr 尾部并自动重连、重连用尽后 `POST /api/mcp/reconnect` 恢复、有序关闭后按 pid 检查子进程已退出。
- `packages/agent/src/extensions/mcp/prompts.test.ts`、`resources.test.ts`（pi-mcp 内存传输）：分页合并、重复 cursor 停止并诊断、1000 页上限、不合 schema 的项与页、没有 prompts 能力时不请求、`prompts/list_changed` 使列表版本前进；位置参数映射与缺必填参数；不合 schema 的 `prompts/get` 结果被拒绝；消息转文本；资源列表的全部 / 单页 / cursor、读取文本截断（行与字节）、图片、blob、不合 schema 的读取结果。
- `tests/integration/sidecar-mcp-resources-prompts.test.ts`（测试 Server 以 `MCP_FIXTURE_FEATURES=resources,prompts` 声明能力）：没有 resources 能力时三个工具不注册；有时全部分页、单页与 cursor、模板、文本 / 超长文本 / 图片 / 二进制读取；default、read-only、accept-edits、full-access 都不出现审批；项目 deny 规则拒绝 `read_mcp_resource`；`/mcp__srv__greet Alice` 提交 `command { source: mcp }` 与 `prompts/get` 的展开文本（模型只收到展开文本）；缺必填参数 400；不合 schema 400 并诊断；`prompts/list_changed` 之后 `GET /api/commands` 出现新提示模板（之前缓存不变）。
- `tests/integration/secrets-gate-mcp.test.ts`、`secrets-gate-mcp-prompts.test.ts`：秘密总闸的 MCP 通道与提示模板通道，见 [ADR 0007](../adr/0007-secrets-from-registered-entries.md)。
- `apps/server/src/adapters/credentials.test.ts`、`apps/desktop/src/main/secrets.test.ts`、`packages/protocol/src/control.test.ts`：Secret 来源、main 的加解密与消息形状。
- `apps/desktop/e2e/mcp.e2e.test.ts`：MCP 分区添加 stdio Server、connected 与工具数、停用后工具消失、Secret 只显示末四位、批准对话框显示完整命令。
- `packages/agent/src/extensions/mcp/connection.test.ts`（真实 `StreamableHttpTransport` 与假 fetch）：initialize 的 401 → auth-required、只发出一次请求、不自动重连、`reconnect()` 再试；没有 authProvider 时的 401；只在 `tools/call` 时 401；403 `insufficient_scope`；其他 HTTP 错误仍为 failed；错误中没有响应里的令牌。
- `tests/integration/sidecar-mcp-auth.test.ts`（HTTP 测试 Server 的 `auth` 选项）：auth-required、固定错误与诊断 `mcp-auth-required`；只在 `tools/call` 时 401 的错误结果与状态；auth-required 之后 10 秒内（含之后的 Run）没有新的 initialize；手动重连再试一次；改请求头引用登记的 Secret 后 connected；对手用例：401 响应体与 `WWW-Authenticate` 中的令牌及登记的 Secret 不在模型请求、WS 帧、HTTP 响应体、库、日志与 stderr 中。
- `tests/integration/sidecar-mcp-presets.test.ts`：`GET /api/mcp/presets` 的形状（0.0.83 与 `--isolated`）；预设原样保存后的全局配置，经假 npx（`tests/fixtures/mcp/` 的 `fakeNpx`，不访问网络）以预设参数启动；`screenshot` 的 image 块在条目中、下一次模型请求原样；找不到 npx 的诊断；真实 Playwright MCP 用例默认跳过。
- `apps/desktop/src/renderer/features/settings/mcp-section.browser.test.tsx`、`features/conversation/tool-card-images.browser.test.tsx`：需要认证的徽标在明暗主题下对比度 ≥ 4.5:1、说明与本地化诊断、"编辑请求头"聚焦请求头；键盘完成"添加浏览器"、名字冲突提示改名；缩略图实际解码、键盘打开与关闭大图、SVG 不显示。
- `apps/desktop/e2e/mcp-browser.e2e.test.ts`：键盘"添加浏览器"后 playwright（假 npx）connected；401 Server 的"需要认证"与"编辑请求头"（明暗主题）；审批后截图工具卡的缩略图 naturalWidth 为 160。

## 延伸阅读

- [权限判定与审批](permissions.md)：external 与 context-read 类、`mcp__` 规则。
- [命令](commands.md)：命令目录、来源优先级与展开条目。
- [分层配置](configuration.md)：`mcp.enabled` 与项目设置。
- [apps/server README](../../apps/server/README.md)：协议总览与 Secret 的启动参数。
