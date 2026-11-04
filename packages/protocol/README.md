---
kind: reference
description: "@coko/protocol：Sidecar 的 HTTP 路由、WebSocket 消息与进度事件、控制通道消息、认证与 Host / Origin 围栏、错误码与条目版本。编写外部客户端、改动路由、事件或错误码前查阅。"
lifecycle: active
---

# @coko/protocol

Sidecar 与客户端（桌面 main 与 renderer、外部客户端）之间的契约：TypeBox schema 与类型、路由常量和路径函数。没有运行时依赖之外的逻辑；服务端实现在 `apps/server`，进程与认证的决定见 [架构](../../docs/tech-stack/architecture.md)、[ADR 0001](../../docs/adr/0001-sidecar-on-electron-node.md) 与 [ADR 0002](../../docs/adr/0002-local-service-access-auth.md)。

## 使用或结构入口

只有一个入口 `@coko/protocol`（`src/index.ts` 汇总各领域文件）。每个 schema 同名导出类型，用 `typebox/value` 的 `Value.Check` 校验收到的消息。

## 传输

| 通道 | 方向 | 内容 |
| --- | --- | --- |
| 控制通道 | Sidecar ↔ 宿主 | 有 Node IPC 时经 IPC；独立运行（standalone）时 Sidecar 把 `SidecarToMainMessage` 逐行（JSON）写到 stdout，不接收消息 |
| HTTP | 客户端 → Sidecar | `127.0.0.1:<port>` 上 `/api` 下的 JSON 接口；错误为 `ErrorResponse { error: { code, message, details? } }` |
| WebSocket | 双向 | `/api/ws` 上的 JSON 文本帧：客户端发 `ClientMessage`，Sidecar 发 `ServerMessage` |

### 控制通道

Sidecar → 宿主：`starting`、`ready { port, token }`、`fatal { code, message }`、`shutdown-complete`、`inspect-quit.result`、`credential.decrypt`、`secret.decrypt`、`provider.save.result`、`provider.models.result`、`secret.store.result`、`notify`。宿主 → Sidecar：`shutdown`、`inspect-quit`、`provider.save`、`provider.models`、`provider.models.cancel`、`credential.decrypt.result`、`secret.store`、`secret.decrypt.result`。密钥的加解密只在 main（ADR 0004）；standalone 的 Sidecar 没有 main，Credential 只读 `COKO_CREDENTIAL_<ID>`，Secret 只读 `COKO_SECRET_<NAME>`，也不能保存 Provider。

### WebSocket

- 客户端发 `subscribe { sessionId, afterSeq }`：Sidecar 先补发该 Session 中 `seq > afterSeq` 的已提交条目，再发 `subscribed { sessionId, lastSeq, running }`，之后推送 `entry` 与 `progress`。重连时以已收到的最大 seq 作为 afterSeq。`unsubscribe { sessionId }` 停止推送。
- `entry { sessionId, entry }`：已提交的 Session Entry（`SessionEntryRecord`，带 seq、kind、payloadVersion、runId?），可按 kind 用 `SessionEntry` 校验。条目是事实来源。
- `progress { sessionId, runId, event }`：不持久化的临时显示状态，断线丢失后由条目重建。
- `session_title { sessionId, title }`：标题提交后发给所有连接，不需要订阅该 Session。
- `session_status { sessionId, running, agentsRunning }`：根 Session 的执行状态变化，发给所有连接，不需要订阅；两个布尔字段都必填。`running` 是根 Run 正在执行（含等待审批），`agentsRunning` 是有 running 的 Subagent 或 Teammate（含等待审批）；空闲 Teammate 与 Background Job 不计入。服务端在 `run_start`、`run_end` 和 `agent_update` 进度之后同步读取内存状态，映射到根 Session 并去重，只广播值的变化。运行时在 start 进度前已设为运行中、end 进度前已清除，子代理状态在 update 前已更新。
- `error { code, message, sessionId? }`：订阅失败（例如 Session 不存在）或客户端消息不合 schema。

列表与详情 DTO 的 `Session.agentsRunning?: boolean` 与广播使用同一规则，缺省视为 false。运行状态不持久化，重启后两个值均为 false；重连后读取列表快照补齐断线期间的变化。renderer 用修订号保留列表加载期间收到的较新广播，新一轮快照会清理先前广播的覆盖记录，避免断线后残留状态。操作 DTO 写入已有列表行时保留该行由最新快照或广播得到的执行状态，因此延迟的旧响应不能覆盖刷新结果；普通与归档缓存暂时同时持有同一 Session 时，优先操作目标列表的行。尚未加载的行优先合并已收到的广播，未观察过状态的新行才用 DTO 初始化。`activity` 与已订阅 Session 的条目、进度推导保持独立。

验证：[真实 Sidecar 状态测试](../../tests/integration/sidecar-session-status.test.ts)、[列表并发测试](../../apps/desktop/src/renderer/stores/chat-store.test.ts)、[Electron 未打开会话测试](../../apps/desktop/e2e/session-status.e2e.test.ts)。

### Session 工作目录

`Session.cwd` 为可选的绝对路径：当前服务端返回创建时固定的会话工作目录，worktree 会话包含 Workspace 在仓库中的相对子目录。它是只读元数据，移除中或已移除的 worktree 仍可列出会话与原目录；开始 Run 的 busy/removed 错误另行判定。旧 DTO 可缺省此字段，客户端回退到该 Session 的 Workspace 路径。附件按该目录区分相对 File Reference 与目录外绝对路径，不根据当前项目归属重新定位。

## 认证

1. 启动 Sidecar（standalone 时 `ELECTRON_RUN_AS_NODE=1 <electron> <sidecar>/index.mjs --data-dir <dir> --log-dir <dir>`），读 stdout 的第一条 `ready`，得到端口与一次性启动令牌（43 个字符的 base64url）。
2. `POST /api/auth/exchange { token }` → 204 与 `Set-Cookie`；令牌随即作废，再次交换不再成功。cookie 由进程内存中的密钥签名，绑定 `127.0.0.1:<port>`。
3. 之后每个 HTTP 请求与 WebSocket 升级都带这个 cookie。
4. 信任围栏：`Host` 必须是 `127.0.0.1:<port>`（按 URL 发请求的客户端自动满足）；带 `Origin` 时必须是 `http://127.0.0.1:<port>`（不带也接受）。围栏失败为 403，cookie 无效为 401。

示例客户端：`tests/integration/sdk-standalone-client.test.ts`（只用本包、`ws`、Node 内置模块与全局 `fetch`）。

## 路由

`API_ROUTES`：

| 键 | 路径 | 说明 |
| --- | --- | --- |
| `authExchange` | `/api/auth/exchange` | POST `{ token }` → 204 与 `Set-Cookie`。启动令牌只能交换一次；只供宿主（main 或外部客户端）调用，renderer 的 `coko-app://` 代理拒绝 `/api/auth` 下的一切（`MAIN_ONLY_PREFIX`、`isMainOnlyPath`） |
| `health` | `/api/health` | GET → `{ status: 'ok' }` |
| `stream` | `/api/ws` | WebSocket 升级入口（见下文） |
| `workspaces` | `/api/workspaces` | GET 列表；POST `{ path, name? }` 登记目录（同一路径返回已有的） |
| `projects` | `/api/projects` | GET 项目列表；POST `ProjectFields { name, folders }` 创建，已有项目返回 200 / existing，新建返回 201 / created；更新、重命名、置顶与删除见 `apiPaths` |
| `projectFolderCheck` | `/api/projects/check-folder` | POST `{ path }` 校验目录并返回规范化的 `{ path }`，不创建项目 |
| `firstSend` | `/api/chats/first-send` | POST `FirstSendRequest` 首次发送；同一 `draftId` 幂等创建一个 Session，接受后返回 201 `{ session, runId }`，首条用户消息已持久化；支持项目或独立目录、可选 Worktree、模型、推理档位、权限模式与图片 |
| `sessions` | `/api/sessions` | GET 列表（`?workspaceId=`）；POST 新建；带参数的路径见 `apiPaths` |
| `settings` | `/api/settings` | GET 全部设置；`apiPaths.setting(key)` 按 revision 写入 |
| `providers` | `/api/providers` | GET Provider 列表（只有末四位提示）；删除走 `apiPaths.provider(id)`。HTTP 不创建、不更新 Provider（ADR 0010） |
| `models` | `/api/models` | GET 可用模型与默认模型 |
| `plugins` | `/api/plugins` | 插件（`pluginPaths`） |
| `lsp` | `/api/lsp` | 语言服务器状态（`lspPaths`） |
| `mcpPresets` | `/api/mcp/presets` | GET MCP 预设（如浏览器） |
| `memories` | `/api/memories` | Memory 列表；`?query=` 时为检索（`apiPaths.memorySearch`） |

带参数的路径按领域文件导出（函数返回已编码的路径）：

| 文件 | 导出 | 范围 |
| --- | --- | --- |
| `src/api.ts` | `apiPaths` | Session 的消息、重试、停止、审批、模型、重命名、归属、置顶、归档恢复与永久删除；项目操作；设置；Provider；团队、追踪、审计、导出；Memory 检索 |
| `src/runs.ts` | `runPaths` | 追加指令、暂停、继续、结果确认 |
| `src/permissions.ts` | `permissionPaths` | 全局 / Workspace 规则、Session 模式与规则 |
| `src/checkpoints.ts` | `checkpointPaths` | Checkpoint 列表、回退、分叉 |
| `src/context.ts` | `contextPaths` | 上下文用量 |
| `src/commands.ts` | `commandPaths` | 命令 |
| `src/skills.ts` | `skillPaths` | Skills |
| `src/files.ts` | `filePaths` | 文件候选 |
| `src/config.ts` | `configPaths` | 能力配置 |
| `src/goal.ts` | `goalPaths` | Goal |
| `src/jobs.ts` | `jobPaths` | 后台任务 |
| `src/agents.ts` | `agentPaths` | 子代理 |
| `src/schedules.ts` | `schedulePaths` | 定时任务（含测试时钟） |
| `src/handoff.ts` | `handoffPaths` | 交接 |
| `src/worktrees.ts` | `worktreePaths` | worktree 与 git 状态 |
| `src/hooks.ts` | `hookPaths` | 外部 Hook 与项目 Hook 批准 |
| `src/mcp.ts` | `mcpPaths` | MCP Server、批准、重连、预设 |
| `src/secrets.ts` | `secretPaths` | 登记的 Secret |
| `src/memory.ts` | `memoryPaths` | Memory |
| `src/plugins.ts` | `pluginPaths` | 插件 |
| `src/lsp.ts` | `lspPaths` | 语言服务器 |
| `src/teams.ts` | `teamPaths` | 团队 |
| `src/trace.ts` | `tracePaths` | 追踪、审计、导出 |

提交消息：`POST apiPaths.sessionMessages(id) SubmitMessageRequest { text, images? }`（含图片时文字可为空，服务端重新校验图片格式、字节上限及所选模型能力） → 202 `{ runId }`（开始 Run）或 `{ done: true }`（动作，例如 `/compact` 之外的命令）。回答审批：`POST apiPaths.sessionApproval(id, requestId)`（`AnswerApprovalRequest`）→ 204。

## 进度事件

`ProgressEvent` 的 type（"不属于 Run"见 `DETACHED_PROGRESS` 与 `isDetachedProgress`：这些事件不使客户端进入运行中状态）：

| type | 含义 | 不属于 Run |
| --- | --- | --- |
| `run_start` | Run 开始（第一个进度） | 否 |
| `assistant_delta` | 模型输出的增量（text / thinking / toolcall）；可选 `offset` 为同一 `contentIndex` 中此前已发出的 UTF-16 码元数，供客户端发现缺头或缺失的增量 | 否 |
| `tool_start` | 工具调用开始执行 | 否 |
| `tool_update` | 工具的中间结果 | 否 |
| `tool_end` | 工具调用结束（按完成顺序；最终内容以 toolResult 条目为准） | 否 |
| `retry` | 模型请求失败后的重试 | 否 |
| `context_usage` | 每条 assistant 提交后：上下文 tokens 与窗口 | 否 |
| `compaction_start` | 压缩开始 | 否 |
| `compaction_end` | 压缩完成 | 否 |
| `compaction_failed` | 压缩失败（连续失败次数） | 否 |
| `job_update` | 后台任务的快照 | 是 |
| `job_output` | 后台任务的输出块（已脱敏） | 是 |
| `agent_update` | 子代理的状态 | 是 |
| `schedule_update` | 定时任务的快照（runId 为空串） | 是 |
| `team_update` | 根 Session 的团队快照 | 是 |
| `lsp_update` | 语言服务器状态（runId 为空串） | 是 |
| `run_end` | Run 的最后一个进度，在 run_end 条目提交（或提交失败）之后 | 否 |

`assistant_delta.offset` 在每条 assistant 消息、每个 `contentIndex` 内从 0 开始；Sidecar 按脱敏后实际推送的文本计数。客户端已知首次发送的 Run 身份时，可在 offset 为 0 后开始接收完整前缀；中途加入或发现偏移缺口时等待完整 assistant 条目，避免显示孤立后缀。

## 错误码

`ErrorCode`（HTTP 与 WebSocket 共用；状态码为 Sidecar 的映射）：

| code | HTTP | 含义 |
| --- | --- | --- |
| `bad-request` | 400 | 请求不合 schema 或参数无效 |
| `unauthorized` | 401 | 没有或无效的会话 cookie |
| `forbidden` | 403 | Host / Origin 围栏拒绝 |
| `not-found` | 404 | 对象不存在 |
| `run-in-progress` | 409 | Session 已有 Run |
| `nothing-to-retry` | 409 | 上一轮不是模型错误 |
| `model-not-configured` | 409 | 没有可用模型 |
| `model-required` | 409 | Session 的模型被清空，需要重新选择 |
| `approval-not-pending` | 409 | 审批请求不在等待中 |
| `no-active-run` | 409 | 没有进行中的 Run |
| `nothing-to-continue` | 409 | 上一 Run 不是 paused / interrupted |
| `confirmation-pending` | 409 | 有未回答的结果确认 |
| `recovery-failed` | 409 | 启动恢复没能处理该 Session |
| `session-busy` | 409 | 会话或工作目录有阻止本次操作的执行、后台任务或定时任务，或项目删除时停止失败；`details` 区分原因与资源 |
| `session-archived` | 409 | Session 已归档，恢复后才能运行或修改 |
| `already-exists` | 409 | 标识或唯一约束冲突，例如分支同名、编辑项目的主要文件夹已属于其他项目；创建项目命中主要目录按 existing 结果处理 |
| `revision-conflict` | 409 | expectedRevision 不一致 |
| `invalid-transition` | 409 | 当前阶段不允许该动作 |
| `job-not-running` | 409 | 后台任务已结束 |
| `hook-blocked` | 400 | Hook 阻止了提交或手动压缩 |
| `child-session` | 409 | 子 Session 不接受用户提交 |
| `agent-not-running` | 409 | 子代理已结束 |
| `schedule-not-allowed` | 409 | 该 Run 或子 Session 不能改定时任务 |
| `not-a-git-repo` | 400 | Workspace 不在 git 仓库中 |
| `invalid-name` | 400 | worktree 名不合规则 |
| `unsafe-worktree-path` | 400 | worktree 路径不安全 |
| `worktree-exists` | 409 | 同名分支或路径已存在 |
| `worktree-busy` | 409 | 绑定的会话仍在运行 |
| `worktree-dirty` | 409 | 有未提交的改动 |
| `git-dirty` | 409 | 仓库有未提交或未跟踪的改动，拒绝切换分支；details 为 `{ files, count }` |
| `git-unavailable` | 409 | Git 未安装或无法启动 |
| `worktree-removed` | 409 | 绑定的 worktree 已移除 |
| `nothing-to-hand-off` | 400 | 没有可交接的内容 |
| `digest-mismatch` | 409 | 要批准的 digest 已变化 |
| `plugin-exists` | 409 | 同名插件已安装 |
| `plugin-invalid` | 400 | 插件清单无效 |
| `plugin-too-large` | 400 | 插件超过上限 |
| `plugin-source-unreachable` | 400 | 插件来源不可读 |
| `plugin-not-found` | 404 | 插件不存在 |
| `teammate-exists` | 409 | 同名 teammate 已存在 |
| `team-full` | 409 | teammate 已达上限 |
| `agent-not-reachable` | 409 | 消息目标已结束 |
| `stale-revision` | 409 | 任务 revision 不一致 |
| `task-not-claimable` | 409 | 任务不能认领 |
| `not-owner` | 403 | 不是任务负责人 |
| `task-not-found` | 404 | 任务不存在 |
| `team-task-limit` | 409 | 任务数已达上限 |
| `lsp-server-not-found` | 404 | 语言服务器不存在 |
| `not-implemented` | 501 | 接口尚未接入 |
| `storage-unavailable` | 503 | 存储不可继续使用 |
| `internal` | 500 | 意外错误（不带原文） |

`run_end.error.code` 是另一组取值（Run 的结束原因，见 `@coko/agent` 的 `RunErrorCode`）：`model_error`、`commit_failed`、`internal`、`budget_exhausted`、`cost_unpriced`、`hook_stopped`、`hook_blocked`、`max_turns`、`approval_denied`（无界面运行的 `--on-approval fail`）。

## 版本与兼容

- 本包与 Sidecar 同版本发布，没有独立的协议版本号；客户端与 Sidecar 应来自同一构建。
- Session Entry 按 kind 带 `payloadVersion`；Sidecar 读取时把旧版本迁移到当前版本再推送，客户端只需要理解当前版本。新增 kind 或升级版本时 schema 在 `src/entries.ts` 与各领域文件中登记，迁移在 `@coko/agent` 的 `session-entries/`。
- 新增进度类型必须在 `DETACHED_PROGRESS` 中登记（编译期穷尽）；客户端应忽略不认识的进度类型与条目 kind。
- 本文的路由键、进度类型与错误码由 `src/readme.test.ts` 机械检查：新增而文档没有跟上时测试失败。

## 相关

- 无界面运行：[headless](../../docs/subsystems/headless.md)（stream-json 输出的每一行就是这里的 `ServerMessage`）。
- 把 `@coko/agent` 当库使用：[agent README](../agent/README.md#作为库使用)。
