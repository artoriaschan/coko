---
kind: reference
description: "当前的代码智能契约：语言服务器的配置来源（全局、Workspace、插件）与合并诊断、lsp 工具的四个操作与行列换算、结果格式与上限、权限与脱敏、进程的启动、空闲关闭、上限、崩溃与失败、登记与关闭，/api/lsp 与 lsp_update，设置 → 代码智能分区与 lsp 工具卡。修改语言服务器配置、lsp 工具、客户端或进程生命周期前查阅。"
lifecycle: active
---

# 代码智能（语言服务器）

本文说明 Coko 当前如何启动用户配置的语言服务器，并把诊断、定义、引用与悬停信息经 `lsp` 工具交给 Agent。客户端是自研的 JSON-RPC 2.0 stdio 实现，不随包分发任何语言服务器。服务器是用户本机运行的进程，与全局 stdio MCP Server 同一信任级别，不经 Seatbelt，会读取整个工作区建立索引。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/tools/lsp/` | `lsp` 工具（`tool.ts`）、位置换算（`position.ts`）、结果格式化与上限（`format.ts`）、Content-Length 帧编解码（`framing.ts`）；宿主端口 `LspPort` |
| `apps/server/src/adapters/lsp-client.ts` | `createLspClient`：进程启动（独立进程组）、`initialize` / `initialized`、请求超时与取消、服务器发来的请求与通知、stderr 尾部、关闭序列 |
| `apps/server/src/application/lsp.ts` | `LspService`：配置合并与诊断、进程池、状态与 `lsp_update`、`/api/lsp` 的读写与重启、工具端口（文档同步、诊断等待、结果文件的读取判定） |
| `apps/server/src/application/context/lsp.ts` | 上下文贡献：有服务器时注册 `lsp` 工具（权限类 `lsp`） |
| `apps/server/src/http/routes/lsp.ts` | `GET` / `PUT /api/lsp`、`POST /api/lsp/restart` |
| `packages/protocol/src/lsp.ts` | 设置键、`LspServerConfig`、`LspServerStatus`、`LspUpdate`、请求与响应 DTO |
| `apps/desktop/src/renderer/stores/lsp-store.ts`、`features/settings/lsp-section.tsx` | 设置 → 代码智能分区 |
| `apps/desktop/src/renderer/features/conversation/tool-cards.tsx` | `lsp` 工具卡 |

## 配置

三处来源，条目形状相同：`{ [name]: { command, args?, extensionToLanguage: { '.ts': 'typescript', … }, env?, initializationOptions?, startupTimeout? } }`。

- **全局**：设置键 `lsp.servers`；**Workspace**：设置键 `lsp.workspaces.<workspaceId>.servers`。都在 SQLite 中，只经 `PUT /api/lsp` 修改，由用户本人编写，不另批准。
- **插件**：已启用插件的 `lspServers`（[ADR 0017](../adr/0017-plugins-declarative-user-installed.md)），以 `<plugin>:<server>` 登记，来源 `plugin`。`plugins.enabled` 为 false 时没有插件服务器。插件的安装与批准见插件子系统；测试构建另可由 `COKO_TEST_PLUGINS` 提供一个插件。
- **项目文件**：`.coko/settings.json` 中 `lsp` 的 `enabled` 以外的键以 `project-cannot-grant` 忽略（会启动进程，[ADR 0008](../adr/0008-project-files-only-tighten.md)），诊断在 `GET /api/config` 的项目诊断中。

合并规则：同名时 Workspace 覆盖全局（诊断 `shadowed-server`）；同一扩展名有多个服务器时按 workspace > global > plugin 归优先的一个，其余记 `duplicate-extension`；全部扩展名都被占用的服务器不出现在状态中。不合 schema、扩展名不像 `.ts`（只支持单段扩展名，`.d.ts` 按 `.ts` 匹配）或映射为空为 `invalid-lsp-server`。`PUT` 遇到 `invalid-lsp-server` 或名字含冒号（留给插件）时 400（`details.diagnostics`），revision 不一致 409；保存后配置已变或已删除的服务器的进程关闭。

`lsp.enabled`（缺省 true，项目可以关闭）为 false 时不注册 `lsp` 工具。

## lsp 工具

`lsp { operation: 'diagnostics' | 'definition' | 'references' | 'hover', file_path, line?, character? }`，只在 `lsp.enabled` 且该 Session 有服务器时注册（描述中列出已配置的扩展名）。

- 行列为 1 基，列按码点计（中文与表情各一列）；发给服务器时换算为 0 基 UTF-16，结果的位置反向换算。`definition`、`references`、`hover` 缺 `line` 或 `character` 是参数错误；行号越出文件同样。
- 文件扩展名没有匹配的服务器时为错误结果，列出已配置的扩展名。
- 文档同步为整篇，内容读磁盘：同一进程中第一次查询某文件发 `didOpen`（版本 1），之后每次查询发 `didChange`（版本递增）。
- `diagnostics` 发出同步通知后等待该文件的 `publishDiagnostics`（5 秒）；超时返回"没有收到诊断"（details `received: false`），不是错误。
- 结果格式：diagnostics 为 `<rel>:<line>:<col> <severity> <message> [<source>]`（按位置排序，多行消息合为一行）；definition / references 为 `<rel>:<line>:<col>` 加该行文本（去掉首尾空白，至多 200 字符）；hover 为 markdown 文本。至多 200 项、20 000 字符，超出注明总数。工作目录外的结果路径写绝对路径（显示路径按解析前的位置，不跟随符号链接）。
- details 为 `{ operation, file, line?, character?, count, total, truncated, received? }`，工具卡据此显示结果计数。

## 权限与脱敏

权限类 `lsp`（规则组名 `Lsp`）：`file_path` 与 read 同一套路径判定，`Read` 的拒绝、询问与允许规则同样适用；越出 Workspace 与额外读取根时询问，见 [权限判定与审批](permissions.md#模式)。结果与 read 一样经登记明文替换（诊断与悬停文本可能含文件内容）。

结果中位置所在文件的"该行文本"只从真实路径在工作目录内、不在受保护路径中、不被 `Read` 拒绝规则覆盖的文件读取；其余结果只给位置。这一点比 read 的判定更窄：它不经审批，不能让服务器返回的位置把工作区外或被拒绝的文件内容带进结果。

发给语言服务器的是用户本机进程收到的文件内容，不经脱敏。服务器的环境与 MCP stdio 相同：Sidecar 环境剔除 `HOST_ENV_EXCLUSIONS`（`COKO_*` 与凭据形态的变量），再合并配置的 `env`，不注入 Secret。

## 进程

- 键为（来源，服务器名，Session 工作目录）：首次查询时启动，`initialize` 的 `rootUri` 为工作目录，`startupTimeout`（缺省 10 秒）内没有回答为启动失败。请求超时 15 秒（发 `$/cancelRequest`）。服务器发来的请求回空结果（`workspace/configuration` 每项 null），`window/*` 通知只记 debug。
- 以独立进程组启动，登记为 `host_processes.kind = 'lsp'`（[ADR 0012](../adr/0012-host-process-registry.md)），退出后删除；Sidecar 被强杀后，下次启动的孤儿清理终止它们，见 [命令执行与子进程登记](execution.md)。
- 10 分钟没有查询时关闭；同时至多 4 个，启动第 5 个时关闭最久未用的。关闭序列为 `shutdown` → `exit` → SIGTERM → SIGKILL，每步等待 2 秒。有序关闭在"关闭上下文贡献"之后、"终止登记进程"之前关闭全部语言服务器。
- 失败：启动失败，或启动后没有回答任何查询就退出，各计一次；连续 3 次为 `failed`，之后的查询直接返回错误（提示在设置中重启），不再启动。回答过查询之后的退出不计失败，下一次查询重新启动。`POST /api/lsp/restart` 停止该服务器的进程、清零失败计数并重新启动。
- stderr 保留尾部 4 KB，与错误文本一样脱敏后作为状态的 `stderrTail` 与 `error`。

## 接口与进度

- `GET /api/lsp?sessionId=`（或 `?workspaceId=`）→ `{ enabled, global: { servers, revision, diagnostics }, workspace?: { workspaceId, servers, revision, diagnostics }, status: LspServerStatus[] }`。给出 Session 时状态按其工作目录，每个服务器一行（没有进程时 `idle`）；不给时为全局与插件服务器各一行，另加每个进程一行。
- `PUT /api/lsp { scope: 'global' | { workspaceId }, servers, expectedRevision }`：见"配置"；Workspace 不存在 404。
- `POST /api/lsp/restart { name, cwd? }` → 204；没有该服务器 404 `lsp-server-not-found`。
- progress `lsp_update { servers }`：状态变化时推给用过该进程的 Session（`runId` 为空串，不属于 Run）。

## 界面

- 设置 → 代码智能：能力开关 `lsp.enabled`；已配置的服务器列表（名字、来源、扩展名、状态、进程号、工作目录、错误与 stderr 尾部、"重启"）；全局与当前 Workspace 的 JSON 编辑（保存前解析，服务端诊断行内显示，revision 冲突时提示并读回）。状态由 `lsp_update` 更新。
- `lsp` 工具卡：标题为操作，摘要为文件与位置；展开后以“请求”字段区显示真实操作、文件与可用行列，随后显示结果计数（截断时注明总数，诊断超时注明没有收到）和原始结果文本。请求位置不冒充返回结果位置，也不从文本推测可跳转位置；当前没有文件打开回调。输入 / 输出入口保留完整参数、结果文本与 details，字段不完整或错误时使用通用详情。

## 验证与相关设计

- 单元：`packages/agent/src/tools/lsp/lsp.test.ts`（换算、格式化与上限、参数校验、帧编解码），`apps/server/src/adapters/lsp-client.test.ts`（分帧、超时、服务器请求、退出、关闭序列）。
- 集成（真实 Sidecar 与 `tests/fixtures/lsp/server.mjs`）：`tests/integration/sidecar-lsp.test.ts`（四个操作、记录的请求、配置合并、权限对手用例）、`sidecar-lsp-process.test.ts`（登记、空闲关闭、崩溃与 failed、重启、上限、关闭与孤儿清理）、`secrets-gate-lsp.test.ts`。
- 界面与产物：`apps/desktop/e2e/lsp.e2e.test.ts`、`package-smoke.e2e.test.ts` 的语言服务器用例。
- 未验证：真实语言服务器（例如 `typescript-language-server`）与真实模型下的修复流程只在交付前人工验证。

## 延伸阅读

- [权限判定与审批](permissions.md)：`lsp` 权限类与规则组名。
- [分层配置](configuration.md)：`lsp.enabled` 与项目文件的 `project-cannot-grant`。
- [MCP Server 连接、工具、资源与提示模板](mcp.md)：同一信任级别的 stdio 进程与环境过滤。
