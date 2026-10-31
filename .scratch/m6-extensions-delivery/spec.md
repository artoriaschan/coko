# M6 扩展与交付：规格

Status: ready-for-agent
Spec status: approved（按常设指示：2026-10-28 用户 goal"讨论问题采用推荐答案"，2026-10-31 规划采纳，未经用户逐条确认）
Map: [Coko 桌面应用](../desktop-app/map.md) · [里程碑划分](../desktop-app/issues/06-grill-milestone-route.md) · 讨论：[grilling.md](grilling.md) · 实施须知：[implementer-brief.md](implementer-brief.md) · 能力覆盖：[capability-coverage.md](capability-coverage.md)

## Problem Statement

M5 之后 Coko 能派发子代理、运行 Hook、定时投递与隔离 worktree，但 [能力表](../../docs/tech-stack/agent-runtime.md#框架能力分工) 仍有空行：用户不能把一组 Skills、命令、Hook 与 MCP Server 作为一个插件安装与启停；多个代理不能长期协作、共享带负责人的任务、互相发消息，子代理结束后不能继续对话；Agent 只能用 grep 理解代码，拿不到语言服务器的诊断、定义与引用；没有浏览器操作的现成入口，HTTP MCP 返回 401 时只显示为普通失败；不能在脚本或 CI 中无界面地运行一个任务并拿到结构化结果，SDK 与协议没有文档；看不到每次模型请求的延迟、重试与费用，没有审计、导出与回归评测；Memory 只能整表注入，不能检索。交付侧：没有 DMG / ZIP 安装包与自动更新接线，发布构建（关闭测试钩子）的产物从未被端到端验证。M5 评审还留下一批规格裁决（J3、J4、J8、J9）、结构债与测试问题。

## Solution

M6 交付：**插件**（只声明资源、用户级复制安装、按可执行声明批准，[ADR 0017](../../docs/adr/0017-plugins-declarative-user-installed.md)）；**Agent Teams**（根 Session 中的具名 teammate、消息送达、带 owner / 认领 / revision CAS 的共享任务板、TaskCreated / TaskCompleted / TeammateIdle Hook、teammate 的 worktree、子代理继续对话，[ADR 0018](../../docs/adr/0018-agent-teams-in-root-session.md)）；**代码智能**（自研 LSP stdio 客户端，`lsp` 工具的诊断 / 定义 / 引用 / 悬停，设置分区）；**浏览器经 MCP**（Playwright MCP 预设、图像结果）与 MCP 的 `auth-required` 状态；**SDK 与无界面运行**（`@coko/agent` 作库使用的说明与用例、headless 入口、协议文档与外部客户端用例，[ADR 0019](../../docs/adr/0019-headless-runs-deny-approvals.md)）；**观测与评测**（`model_request` 条目、追踪 / 审计 / 导出接口与 Trace tab、`tests/evals`）；**Memory 检索**（FTS5）；**交付**（DMG / ZIP、autoUpdater 接线、关于页的更新状态、发布构建 E2E）。第一、二张票收敛 M5 遗留，第三张票预建全部共享 seam（含 layers.ts 的领域块）。术语见 [GLOSSARY](../../GLOSSARY.md)。交付后能力表每一行都有已交付的位置，见 [capability-coverage.md](capability-coverage.md)。

## User Stories

**插件**

1. As a 用户, I want 从本机目录或 git 地址安装一个插件，并在启用前看到它会运行的每一条命令, so that 我能一次获得一组相关的 Skills、命令、子代理、Hook 与 MCP / 语言服务器，而不会执行我没看过的东西。
2. As a 用户, I want 启用、禁用、更新与卸载插件，更新改变了命令时重新批准, so that 插件的变化总经过我。
3. As a 用户, I want 插件的资源带插件名前缀、不覆盖我自己与项目的同名资源，插件的 Hook 也越不过我的拒绝与询问规则, so that 装一个插件不会悄悄改变已有行为或放宽权限。

**Agent Teams**

4. As a 用户, I want Agent 创建几个具名的 teammate 并行处理一项工作，它们之间与 lead 之间可以发消息, so that 较大的任务能分给多个长期存在的代理。
5. As a 用户, I want 团队有一张共享任务板，任务有负责人与前置任务，两个成员不能同时认领同一项, so that 分工清楚、不重复劳动。
6. As a 用户, I want 在任务创建、完成与 teammate 空闲时运行 Hook（例如完成前跑检查）, so that 我能给团队加上质量门槛。
7. As a 用户, I want teammate 可以在自己的 worktree 中改代码，团队的用量计入 Goal 预算，成员之间的消息不能替我创建或放宽 Goal, so that 并行协作不会互相踩踏，也不会绕过上限与授权。
8. As a 用户, I want Agent 能给已经结束的子代理发消息继续对话, so that 追问不需要重新派发、重新调研。
9. As a 用户, I want 在右栏看到团队名册、任务板与每个成员的过程, so that 我知道谁在做什么。

**代码智能与浏览器**

10. As a 用户, I want 为语言配置语言服务器后，Agent 能查询诊断、定义、引用与悬停信息, so that 它修改代码后能看到类型错误，并能准确地找到符号。
11. As a 用户, I want 一键添加浏览器（Playwright MCP），Agent 打开网页、操作并截图，操作同样经过审批, so that 我能让它验证网页而不需要自己配置。
12. As a 用户, I want HTTP MCP Server 要求认证时看到"需要认证"与修改请求头的入口, so that 我知道是凭据问题而不是服务器坏了。

**SDK、无界面运行与观测**

13. As a 开发者, I want 用命令行无界面地运行一个任务，得到逐行的事件与最终的结构化结果和退出码，需要审批的调用被拒绝而不是挂起, so that 我能在脚本与 CI 中使用 Coko。
14. As a 开发者, I want 有协议文档与示例，能把 `@coko/agent` 当库调用、或作为客户端连接独立运行的 Sidecar, so that 我能在 Coko 之上构建自己的工具。
15. As a 用户, I want 看到每个 Run 中每次模型请求的延迟、Token、费用与重试，以及每个工具的耗时、审批等待与 Hook 结果，并能导出会话, so that 我能分析慢在哪里、花在哪里，并留存审计。
16. As a 开发者, I want 运行一组按文件结果判定的评测用例并得到报告，有凭据时可以对真实模型跑同一组, so that Agent 行为的回归能被发现。
17. As a 用户, I want Agent 与我都能按关键词检索记忆, so that 记忆多了以后仍能找到相关的那条。

**交付**

18. As a 用户, I want 拿到 DMG 与 ZIP 安装包，在"关于"中看到版本与更新状态并检查更新, so that 我能安装与升级应用。
19. As a 开发者, I want 发布构建（不含测试钩子）的产物经过端到端验证, so that 交给用户的版本与测试的版本行为一致、测试钩子确实关闭。
20. As a 开发者, I want M5 评审留下的规格裁决、结构债与测试问题在新功能之前收敛, so that 新代码不在旧问题上叠加。

## Implementation Decisions

讨论记录：[grilling.md](grilling.md)，全部按常设指示采纳。

### Session Entry 与事件（票 03 预先声明 schema；"实现"列为写入方）

| kind / 事件 | payload 要点 | 实现 |
| --- | --- | --- |
| `model_request` v1 | `runId`、`provider`、`model`、`startedAt`、`durationMs`、`ttftMs?`、`usage { input, output, cacheRead, cacheWrite, total }`、`cost?`、`stopReason`、`retries`、`errorCode?`、`purpose: turn / compaction / summary` | 03（运行时提交）；07 消费 |
| `team_task` v1 | 完整快照 `{ taskId: 't<n>', revision, subject（≤ 200）, description（≤ 4 000）, status: pending / in_progress / completed / deleted, owner?, blockedBy, writeScopes, by }`，提交在根 Session | 06 |
| `team_message` v1 | `messageId`、`from`（名字或 `lead`）、`to`（名字、`lead` 或 agentId）、`summary?`（≤ 120）；紧接在送达该消息的 user message 之前，提交在目标 Session | 06 |
| `agent_start` v2 | v1 + `name?`、`teammate?: boolean`、`triggerRunId`（触发它的根 runId，用于预算）；v1 → v2 原样迁移 | 03 声明，06 写 name |
| `agent_end` v2 | `status` 增加 `dismissed`；v1 → v2 原样迁移 | 03 声明，06 写 |
| `approval_decision` v3 | `by` 增加 `headless`；v2 → v3 原样迁移 | 03 声明，08 写 |
| `hook_run` v2 | `source` 增加 `plugin`（另有 `plugin?` 名字）；`event` 增加 `TaskCreated`、`TaskCompleted`、`TeammateIdle`；v1 → v2 原样迁移 | 03 声明，04 / 06 写 |
| `RunError.code` | 增加 `hook_blocked`（PreCompact 阻止，S10） | 01 |
| progress `team_update` | 根 Session 的 `TeamSnapshot { members, tasks, warnings }`（名册或任务变化时） | 03 声明，06 发 |
| progress `lsp_update` | `LspServerStatus[]`（状态变化时，不属于 Run，登记为 detached） | 03 声明，05 发 |
| MCP 状态 | `McpServerStatus` 增加 `auth-required` | 03 声明，09 写 |

新 kind 入库与推送前经 `redactSecretsDeep`。Fork 与 Handoff 不复制以上新 kind（`team_task` / `team_message` / `model_request`）。宿主输入常量（`@coko/agent/entries` 的 `host-input.ts`，03）：`TEAM_MESSAGE_TAG = '<team-message'`，`HOST_NOTIFICATION_KINDS` = {`job_notification`, `agent_notification`, `team_message`}，`isHostNotificationText` 识别三种标签，`teamMessageText({ from, messageId, body })` 生成包装（属性值经 XML 转义）。

### 迁移 v9（票 03，packages/session）

- 新表 `plugins`（STRICT）：`name` 主键、`version`、`source_kind: dir / git`、`source_location`、`source_ref?`、`commit?`、`path` UNIQUE、`digest`、`approved_digest?`、`enabled`（0/1）、`installed_at`、`updated_at`。store：`plugins { list, get, upsert, approve(name, digest), setEnabled, delete }`。
- `memories_fts`：FTS5 虚拟表（`content='memories'`，列为正文与标题），插入 / 更新 / 删除触发器同步；运行时编译没有 FTS5 时不建表、记 warn。store：`memories.search(query, { scope, workspaceId?, limit })`，FTS 可用时按 bm25，否则 LIKE（大小写不敏感，按 updatedAt 倒序）。
- 重建 `host_processes`，`kind` 增加 `lsp`（登记行按原样复制）。
- 契约测试在 SQLite 与内存实现上通过（内存实现的 search 为子串匹配）。

### 插件（票 04；agent `extensions/plugins/`，server `application/plugins.ts`、`routes/plugins.ts`）

**清单。** `<root>/.coko-plugin/plugin.json`，缺失时 `<root>/.claude-plugin/plugin.json`。字段与诊断见 [grilling B3](grilling.md#第-3-轮)。`engines.coko` 只支持 `>=x.y.z`，比较对象为 `--app-version`（源码运行时 `0.0.0` 视为满足）。路径（含经符号链接）逃出插件根为 `path-outside-plugin`，该项不加载。`${COKO_PLUGIN_ROOT}` 与 `${CLAUDE_PLUGIN_ROOT}` 在 hooks 的 command、MCP 的 command / args / env 值 / url、LSP 的 command / args / env 值中替换为安装目录。

**安装。** `POST /api/plugins { source: { kind: 'dir', path } | { kind: 'git', url, ref? } }`：dir 须为绝对路径；git 的 url 须为 `https://` 或 `file://`，经 `adapters/git.ts` 以 `clone --depth 1 [--branch ref]` 到临时目录（失败 400 `plugin-source-unreachable`）；校验清单（失败 400 `plugin-invalid { diagnostics }`）；同名已安装 409 `plugin-exists`；复制到 `<COKO_HOME>/plugins/<name>/`（拒绝逃出根的符号链接，≤ 5 000 文件、≤ 50 MB，超出 400 `plugin-too-large`；不复制 `.git`）；写 `plugins` 行（status needs-approval）。

**digest 与批准。** digest = SHA-256（规范化 JSON：清单的 name / version / engines，以及展开后的 hooks、mcpServers、lspServers 声明，键排序）。`GET /api/plugins` 的每项带 `executables { hooks: [{ event, matcher?, command }], mcpServers: [{ name, command?, args?, url?, envKeys }], lspServers: [{ name, command, args?, extensions }] }` 与 `contributions { skills, commands, agents }`（名字列表）。`POST /api/plugins/:name/approve { digest }`：与当前 digest 不同 409 `digest-mismatch`；成功后 `approved_digest = digest`、`enabled = 1`。状态派生：清单无效 `invalid`；engines 不满足 `incompatible`；`approved_digest ≠ digest` `needs-approval`；否则 `enabled` / `disabled`。

**生命周期。** `PATCH /api/plugins/:name { enabled }`；`POST /api/plugins/:name/update`（按原来源重新取，替换目录；digest 变化回到 needs-approval）；`DELETE /api/plugins/:name`（经 `PluginContributions` 的变更通知让 MCP / LSP reconcile 关闭其进程，再删除目录：先 `realpath` 确认在 `<COKO_HOME>/plugins/` 之下，再删除记录）→ 204。`plugins.enabled`（只在全局，缺省 true）为 false 时全部不加载。

**贡献。** 只有 `enabled` 状态的插件经 `PluginContributions`（票 03 的端口）提供：`skillRoots`、`commandRoots`、`agentRoots`（各带插件名，加载器以 `<plugin>:<name>` 登记）、`hooks`（Hook 配置，`source: plugin`，与全局同级：allow 参与聚合）、`mcpServers`（名字 `plugin-<plugin>-<server>`，不经项目批准；引用 `${NAME}` Secret 的不加载，诊断 `plugin-secret-reference`）、`lspServers`（名字 `<plugin>:<server>`）。插件根加入 skill 工具的可读根（与 `~/.coko/skills` 相同的处理）。每个 Run 开始时读一次快照。

### 代码智能（票 05；agent `tools/lsp/`，server `adapters/lsp-client.ts`、`application/lsp.ts`、`context/lsp.ts`、`routes/lsp.ts`）

- **配置。** 全局设置键 `lsp.servers`、Workspace 设置键 `lsp.workspaces.<workspaceId>.servers`：`{ [name]: { command, args?, extensionToLanguage: { '.ts': 'typescript', … }, env?, initializationOptions?, startupTimeout? } }`；诊断 `invalid-lsp-server`、`duplicate-extension`（同一扩展名多个服务器时 workspace > global > plugin，其余记 shadowed）。项目文件中的 `lsp` 键：`project-cannot-grant`。`lsp.enabled` 缺省 true，项目可关。
- **客户端。** JSON-RPC 2.0 over stdio，`Content-Length` 分帧；`initialize { rootUri: cwd, capabilities: { textDocument: { publishDiagnostics, definition, references, hover } } }` → `initialized`；文档同步为整篇（`didOpen` 首次、之后 `didChange` 版本递增，内容读磁盘）；请求超时 15 秒；服务器发来的请求（如 `workspace/configuration`）回空结果，`window/*` 通知只记 debug。
- **工具。** `lsp { operation: 'diagnostics' | 'definition' | 'references' | 'hover', file_path, line?, character? }`（后三者要求 line / character，1 基）。结果：diagnostics `<rel>:<line>:<col> <severity> <message> [<source>]`；definition / references `<rel>:<line>:<col>` 加该行文本（≤ 200 字符）；hover 为 markdown 文本。至多 200 项、20 000 字符，超出注明总数。Workspace 外的结果路径写绝对路径。
- **权限。** 权限类 `lsp`：`file_path` 按读取判定（规则组名 `Read` 的路径匹配同样适用；越出可读根询问）。结果经 `secretRedactionHook`。
- **进程。** 见 [grilling D4](grilling.md#第-4-轮)：键（服务器名，cwd），首次查询启动，空闲 10 分钟关闭，至多 4 个，登记 `kind: lsp`，关闭序列 shutdown → exit → SIGTERM → SIGKILL（各 2 秒），连续 3 次启动失败为 failed，手动重启清零。
- **HTTP。** `GET /api/lsp?sessionId=` → `{ enabled, global: { servers, revision, diagnostics }, workspace?: { workspaceId, servers, revision, diagnostics }, status: LspServerStatus[] }`（`LspServerStatus { name, source: global / workspace / plugin, extensions, state: idle / starting / running / failed, cwd?, pid?, stderrTail?, error? }`）；`PUT /api/lsp { scope: 'global' | { workspaceId }, servers, expectedRevision }`（400 / 409）；`POST /api/lsp/restart { name, cwd? }` → 204。
- **界面（同票）。** 设置 → 代码智能（`lsp` 分区，见 grilling D5）；`lsp` 工具卡。

### Agent Teams（票 06；agent `agents/teams/`，server `application/teams.ts`、`context/teams.ts`、`routes/teams.ts`，以及 `application/subagents.ts` 的 teammate 分支）

- **teammate。** `agent { …, name }`：`teams.enabled`（缺省 true，项目可关）；名字 `[a-z][a-z0-9-]{0,31}`、不为 `lead`、在根 Session 的未解散成员中唯一（否则错误结果 `teammate-exists` / `invalid-name`）；至多 8 个（`team-full`）；必为后台；提交 `agent_start { name, teammate: true, triggerRunId }`。teammate 子 Session 的工具 = 子代理工具集 + `send_message` + `task_*`；system section 另注入 `<team>`（自己的名字、lead 与其他成员的名字、任务板的使用要求）。
- **消息。** `send_message { to, message（1–8 000）, summary? }`：to 为成员名、`lead`、`*` 或已结束子代理的 agentId；对 dismissed / cancelled / interrupted 为错误结果 `agent-not-reachable`；发给自己为错误。送达规则见 [grilling C3](grilling.md#第-3-轮)：目标 Session 提交 `team_message` 后紧跟 user message `teamMessageText(...)`。空闲的 teammate / 子代理以 `trigger: subagent` 开始新 Run（`run_start.subagent` 带 `triggerRunId`）；根 Session 运行中的 Run 数达到 4 时排队。lead 空闲且没有活动 Goal 时挂起到下一个 Run（与 Job 通知同一挂起机制）。返回 `Sent to <to> (message <id>).`。
- **任务。** `task_create`、`task_update`、`task_list` 的参数与规则见 [grilling C4](grilling.md#第-3-轮)；错误结果码：`stale-revision`（带当前快照）、`task-not-claimable`（原因：`owned`、`blocked`、`not-pending`）、`not-owner`、`task-not-found`、`cycle`、`team-task-limit`。`task_list` 返回每项的快照加 `ready`（前置全部完成）与重叠警告。根 Session 内的变更经 `KeyedMutex(rootSessionId)` 串行。
- **Hook。** TaskCreated（创建提交之前）、TaskCompleted（变为 completed 之前）、TeammateIdle（teammate 的 Run 正常结束、SubagentStop 之后），输入与语义见 [grilling C5](grilling.md#第-4-轮)，经 03 的 `HookService.run(event, scope, input)` 通用入口与 `onStop` 继续上限。
- **解散与 worktree。** `agent_cancel { agent_id }`（或成员名）对 teammate 为解散：abort、`agent_end { status: dismissed }`、`removeIfUnchanged`；`isolation: 'worktree'` 时 worktree 保留到解散。父 Session 对 isolation 路径的 Read / Edit / Write 询问规则（01 的 J4）同样适用。
- **空闲通知。** teammate 的每个 Run 正常结束时，lead 收到 `agent_notification`（与后台子代理相同的文本与规则）。
- **预算。** 子 Session 的 Run 按 `run_start.subagent.triggerRunId` 归属 Goal（`goalUsage` 的 children 口径改为按触发 Run 过滤；未带 triggerRunId 的旧条目按 `agent_start.toolCallId` 所在 Run，即 M5 行为）。
- **重启。** 名册从 `agent_start` v2 / `agent_end` 派生；排队消息不保留。
- **HTTP。** `GET /api/sessions/:id/team` → `TeamSnapshot { members: [{ agentId, name, status: running / idle / dismissed / failed, activity?, usage, worktree? }], tasks: [TeamTaskView], warnings }`；子 Session id 时返回其根的快照。`team_update` 进度随之推送。
- **界面。** 票 13。

### 观测与评测（票 07；agent `observability/`，server `application/trace.ts`、`routes/trace.ts`，renderer Trace tab，`tests/evals/`）

- **记录。** `model_request` 由运行时提交（03）：每次请求（含重试后的最终一次，`retries` 为之前失败的次数）、压缩与交接摘要（`purpose`）。`ttftMs` 为第一个文本或工具调用增量到达的时间。日志 `model request finished { sessionId, runId, model, durationMs, ttftMs, tokens, cost, retries }`。
- **派生（纯函数，07）。** `deriveTrace(entries) → RunTrace[]`、`deriveAudit(entries) → AuditEvent[]`，见 [grilling G2](grilling.md#第-2-轮)。工具耗时：`tool_exec`（或工具调用所在 assistant 消息）到结果消息的 `createdAt` 差；审批等待：`approval_request` 到 `approval_decision`。
- **HTTP。** `GET /api/sessions/:id/trace` → `{ runs: RunTrace[], totals }`；`GET /api/sessions/:id/audit` → `AuditEvent[]`；`GET /api/sessions/:id/export[?children=1]` → `application/x-ndjson`，第一行 `{ type: 'header', format: 'coko-session-export', version: 1, sessionId, exportedAt }`，其后每行一个条目（已脱敏；子 Session 的条目带 `sessionId`）。
- **回放。** `@coko/agent/testing` 导出 `loadExport(text)`。
- **界面。** 右栏 Trace tab（见 [grilling G5](grilling.md#第-4-轮)）。
- **evals。** `tests/evals/`（`vitest.config.ts` 项目 `evals`，根 `vitest.config.ts` 加入；`pnpm run eval` = `vitest run --project evals`）、`cases/<name>/{case.json,workspace/}`、运行器 `runner.ts`（复用 sidecar-harness）、报告 `reports/<ISO>.json`（`.gitignore`）。真实模式：`COKO_EVAL_PROVIDER_CONFIG`（Provider 配置 JSON 文件）与对应 `COKO_CREDENTIAL_<ID>` 都存在时用真实模型，否则只跑 faux。

### SDK 与无界面运行（票 08；server `headless/`，`packages/protocol/README.md`，agent README 的"作为库使用"）

- **库。** `@coko/agent` 主入口即 SDK。README 增加"作为库使用"：最小装配（`createAgentRuntime`、内置工具注册、内存 Repository、模型解析、权限 gate、事件订阅与 `RunResult`）。`tests/integration/sdk-library.test.ts` 只经 `@coko/agent`、`@coko/agent/testing` 与 `@coko/session` 的内存实现运行一次带工具调用的 Run，断言结构化结果、事件顺序与提交的条目；源码引用守卫：该文件不得深层导入 `packages/*/src/**`。
- **headless 入口。** `apps/server/src/headless/`（03 建存根并加入 sidecar 的 tsdown 入口，产物 `dist/sidecar/headless.mjs`）。参数与输出见 [grilling F2](grilling.md#第-2-轮)：`--data-dir` 必填；`--workspace` 不在库中时登记为 Workspace；`--session` 省略时新建 Session；`--log-dir` 缺省为 `<data-dir>/logs`；`--output` 缺省 text（只打印最终的 assistant 文本到 stdout，事件不打印）。装配与 Sidecar 相同的应用层（`sidecarLayer` 去掉 HTTP 与控制通道，`SecretProvider` 与 CredentialStore 为环境变量模式），提交走 `SessionService.submit`（trigger submit），输出经 hub 订阅。SIGINT / SIGTERM：中止 Run，等待 run_end，以 2 退出。日志写文件，不写 stdout。
- **审批。** 装配 `ApprovalBroker` 的 headless 回答者：PermissionRequest Hook 之后、出卡片之前，以 `approval_decision { decision: deny, by: headless }` 回答，结果文本 `HEADLESS_DENIED_TEXT`（[ADR 0019](../../docs/adr/0019-headless-runs-deny-approvals.md)）；`--on-approval fail` 时随后 `stopAfterBatch` 并以 3 退出。子代理的审批同样。
- **Provider。** `--provider-config <file>`：`{ providers: ProviderFields[], defaultModel? }`，启动时在一个事务中新建或更新（经 `ProviderService` 新增的 `upsertFromConfig`，只在 headless 装配中可用，不暴露 HTTP）；文件中出现 `apiKey` 等密钥字段为 4 退出。缺 `COKO_CREDENTIAL_<ID>` 时 Run 以 `no-credential` 失败（退出 1）。
- **协议文档。** `packages/protocol/README.md` 与 `readme.test.ts` 见 [grilling F4](grilling.md#第-4-轮)；`tests/integration/sdk-standalone-client.test.ts`；新子系统页 `docs/subsystems/headless.md`。
- **产物。** package-smoke 增加一例：打包应用的 `Resources/sidecar/headless.mjs` 以 `ELECTRON_RUN_AS_NODE=1 Coko.app/Contents/MacOS/Coko` 运行 `--output stream-json`（测试构建，faux 脚本），最后一行 result 为 completed、退出码 0（接收侧用例）。

### MCP 认证与浏览器预设（票 09；agent `extensions/mcp/`，server `context/{mcp,mcp-admin}.ts`、`routes/mcp.ts`，renderer MCP 分区）

- **auth-required。** HTTP 传输装配 `AuthProvider { onUnauthorized }`：被调用时连接状态为 `auth-required`，不进入退避重连，诊断 `mcp-auth-required`（文本"服务器要求认证：检查请求头中的凭据，可引用登记的 Secret ${NAME}"）；连接错误中能读到 HTTP 401 的同样处理。配置改变或手动 `reconnect` 后重试。stdio 不受影响。协议 `McpServerStatus` 的新值由 03 声明。界面：状态徽标"需要认证"（`text-warning-text`）与"编辑请求头"按钮（打开该 Server 的编辑表单并聚焦 headers）。
- **浏览器预设。** server 的 `MCP_PRESETS`：`[{ id: 'playwright', name: 'playwright', label, config: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--isolated'] } }]`，`GET /api/mcp/presets`；renderer MCP 分区"添加浏览器"菜单从接口读预设，确认后经现有的全局 MCP 保存接口写入（名字冲突时提示改名）。找不到 `npx` 时连接失败的诊断写明"需要安装 Node.js（npx）"。TECH_STACK Agent 表增加一行 `@playwright/mcp 0.0.83`（经 npx 按需下载，不进 manifest）。
- **图像结果。** 已有的 image 转换补证据：测试 MCP Server（`tests/fixtures/mcp/` 增加 `screenshot` 工具返回 PNG）→ 条目中有 image 块、时间线工具卡渲染缩略图（`img` 的 naturalWidth > 0）、faux 的 requestLog 中 image 块原样传给模型。

### 安装包、自动更新与发布构建（票 10；apps/desktop 的 `forge.config.ts`、`build/`、`src/main/update-coordinator.ts`、关于分区，`e2e-release/`）

- **Makers。** devDependencies `@electron-forge/maker-zip@8.0.1`、`@electron-forge/maker-dmg@8.0.1`；`makers: [new MakerZIP({}, ['darwin']), new MakerDMG({ format: 'ULFO' })]`；`apps/desktop/package.json` 增加 `"make": "electron-forge make"`。`pnpm-workspace.yaml` 的 `allowBuilds` 对 appdmg 链（如 `macos-alias`、`fs-xattr`）逐个裁决，理由写入 TECH_STACK；`COKO_FORGE_OUT_DIR` 改变 Forge 的 `outDir`（缺省 `out`）。
- **更新。** `build.ts` 定义 `__COKO_UPDATE_FEED__` = `process.env.COKO_UPDATE_FEED_URL ?? ''`（main 的 `build-flags.ts` 读取）。`UpdateCoordinator`（03 存根，10 实现）见 [grilling H2](grilling.md#第-2-轮)：`autoUpdater` 的 `checking-for-update` / `update-available` / `update-not-available` / `update-downloaded` / `error` 映射为 `UpdateStatus`，经 `IPC.updateStatus` 推送；`checkForUpdates`、`installUpdate`（经 `quit-coordinator` 的确认后 `quitAndInstall`）。测试构建另读 `COKO_TEST_UPDATE_FEED_URL`（发布构建忽略，记入"test hooks ignored"）。日志 `update status { state, version? }`。
- **关于分区。** 设置 → 关于：应用版本、Electron / Node 版本、更新状态与"检查更新"（disabled 时说明原因）、已下载时"重启以更新"。
- **发布构建 E2E。** 见 [grilling H3](grilling.md#第-3-轮)：`apps/desktop/vitest.release.config.ts`（项目 `desktop-release`；`COKO_RELEASE_E2E=1` 之外 include 为空）、`e2e-release/global-setup.ts`（以 `COKO_FORGE_OUT_DIR=out-release`、不带 `COKO_TEST_BUILD` 运行 `pnpm run make`）、`e2e-release/release.e2e.test.ts`。03 建立前两者的骨架（无用例）。另在测试构建的 E2E 中：本地 feed 服务器（loopback 端口 0）断言 main 请求了 feed、204 时关于页为"已是最新"、返回更新时进入 error 且应用不崩溃（接收侧：renderer 显示的状态）。
- **文档。** desktop-delivery.md 的"自动更新"一节改写为当前做法；新子系统页 `docs/subsystems/delivery.md`（安装包、更新状态、发布构建与测试构建的差异、E2E 入口）。

### Memory 检索（票 11）

- `memory_list { scope?, query? }`：有 query 时调用 `memories.search`（至多 20 条，按相关度），无结果为 `No memories match "<query>".`；工具描述提示"条目多时先检索"。注入的 `<memory>` section 不变（截断提示改为"use memory_list with a query to search them"）。
- `GET /api/memories?query=&scope=&workspaceId=`；设置 → Memory 分区的搜索框（输入防抖 200 ms，清空时恢复列表）。
- FTS 不可用（测试中以 `COKO_TEST_NO_FTS=1` 强制）时降级为 LIKE，结果语义相同（仍至多 20 条）。
- ADR 0003 改 implemented（FTS 证据），memory.md 删除"检索、FTS 索引尚未实现"。

### 预构建：运行时遗留（票 01）

- **J3** `NotificationService.notify`：先运行 Notification Hook（观察者），再读设置决定是否发 `notify`；hooks.md 写明"关闭通知不影响 Hook"。
- **J4** 子代理 isolation worktree：除 `Read(<path>/**)` 外另加 `Edit(<path>/**)`、`Write(<path>/**)` 的询问规则（不入库，随 `#isolate(…, false)` 移除）；subagents.md 写明 bash 不受规则保护。
- **J8** `COKO_PROJECT_DIR` = Session 工作目录（已是如此），hooks.md 写明；补 worktree 会话的用例。
- **J9** UserPromptSubmit 的 `prompt` 为原文（已是如此），hooks.md 改写；补用例：`/<skill> 参数` 时 stdin 的 prompt 等于原文、不含 SKILL.md 正文。
- **H4** worktree 移除：锁内先登记 `removing`，`SessionCwd.resolve` 与 `startRun` 对其中的 worktree 抛 409 `worktree-busy`，git 失败时撤销登记。
- **H5** 项目来源的 PermissionRequest allow：outcome 不记为 `allowed`（记 `context` 之外的新值 `ignored`；`hook_run.outcome` 增加 `ignored`，原样迁移不需要——新增字面量，旧条目不受影响）。
- **H8** SubagentStart / SubagentStop 的解释移入 `HookService.subagentStart` / `subagentStop`（`redactText`，上限用 `HOOK_CONTEXT_MAX_CHARS` 一份），`SubagentService` 只调用。
- **S2** 只保留 agent 的 `PERMISSION_MODE_ORDER` 与 `narrowerMode`；**S3** 导出一个固定排除集判断；**S4** 导出 `invalidWorktreeNameError()`；**S5** `session-entries/agents.ts` 提供类型化读取 `agentStarts(entries)`、`agentEnds(entries)`，替换裸断言，`SubagentSessionHost.mode` 返回 `PermissionMode`；**S6** `ScheduleRepository.get(id)`（SQLite 与内存，契约测试）；**S7** 从 `SubagentService` 拆出 `SubagentNotifications` 与 `SubagentRecovery`（同目录新文件，行为不变）；**S10** PreCompact 阻止改为 `RunError.code: hook_blocked`（goal 对 `hook_stopped` 的暂停不变）。
- **T3** Hook 并行用 barrier 证明（每个夹具写自己的 start 文件并等对方的出现），去掉墙钟上限断言；**T4** `sidecar-harness.ts` 导出 `pollUntil(fn, { timeoutMs })`，替换五处手写轮询。
- **worktree 会话的上下文用量**：`ContextService.scopeFor` 改用 `SessionCwd.resolve(session)`；worktrees.md 删除这条已知限制。
- **回退边界用例**：Workspace 为仓库子目录的 worktree 会话中，write 后回退恢复文件内容（集成），以及越出该边界的路径不被恢复。
- 行为变化：J3、J4、H4、H5、S10，其余为结构或测试，现有测试只改导入或期望即通过。

### 预构建：界面遗留（票 02）

- **S8** `schedules-tab.tsx`、`sidebar/worktrees.tsx` 用父组件的 `key` 重置对话框，删除镜像状态的 effect；`agents-button` 与 `schedules-button` 的"条目计数变化即 load"提成 `useReloadOnEntryCount(kind, load)`。
- **S9** `chat-store.subscribeSession(sessionId): () => void` 返回 release，对子 Session 按引用计数退订（最后一个 release 关闭订阅）；`approval-panel.tsx` 的 `useChildApproval` 在 cleanup 中 release，依赖改为排序后的 id 数组的稳定键。
- **T5** `main/notifications.ts` 改为 `createNotifier()` 实例（`live` 为实例字段），`main/index.ts` 创建一个；测试各自创建。
- **子代理通知的 Electron E2E**：后台子代理结束 → desktop.jsonl 有 `notification shown { kind: agent-finished }`；子代理等待审批 → `approval-waiting`（接收侧用例）。
- **390 px 占位符**：输入区占位符在 390 px 宽时不逐词换行（单行省略：`truncate` / `whitespace-nowrap` 与 `text-ellipsis`，Browser Mode 在 390 px 视口断言占位符元素高度等于一行行高）。

### 运行时与装配 seam（票 03）

- **运行时（engine，只有 03 改）。** 每次模型请求结束提交 `model_request`（经 `RuntimeContext.commit`，与 assistant 消息同一提交链，错误请求也提交）；`RunResult` 不变。
- **宿主输入。** 见"Session Entry 与事件"末段；`runAuthority` 与 `hasUserSteering` 已经读 `HOST_NOTIFICATION_KINDS` / `isHostNotificationText`，03 的表驱动用例各加 `team_message` 一行（先红）；renderer `timeline.ts` 对 `team_message` 之后的 `<team-message` 块按位置去掉（与 agent 通知同一处理），只含该块的消息不成气泡。
- **插件消费 seam。** `ContextScope` 增加 `plugins: PluginContributionsSnapshot`（`{ skillRoots: PluginRoot[], commandRoots, agentRoots, hooks: PluginHookConfig[], mcpServers: PluginMcpServer[], lspServers: PluginLspServer[] }`，`PluginRoot { plugin, path }`），由 `PluginContributionsPort.snapshot()` 提供（03 缺省为空；测试构建在 `COKO_TEST_PLUGINS=<dir>` 时把该目录当作一个已批准插件，供 03 的接线用例）。Skills、命令、子代理定义的加载接受插件根并以 `<plugin>:<name>` 登记（诊断带 `source: plugin`）；HookService 把插件 Hook 并入全局一级；MCP 配置把插件 Server 并入全局一级（不经项目批准，引用 Secret 的不加载）；`lspServers` 由 05 读取。`PluginContributionsPort.onChange(listener)` 供 MCP / LSP reconcile。
- **Hook 通用入口。** `HookService.run(event, scope, input) → HookVerdict`（已有）对新事件可用；配置校验接受 `TaskCreated`、`TaskCompleted`、`TeammateIdle`（无 matcher；写了 matcher 为 `invalid-matcher`）。
- **判定。** 权限类 `lsp`（按 `file_path` 读取判定）、`team`（`send_message`、`task_*`，所有模式放行；规则组名 `Team`）；`agent` 带 `name` 时同 `agent`。
- **配置。** `config/schema.ts`：`plugins.enabled`（只在全局，项目值 `project-cannot-grant`）、`lsp.enabled`、`teams.enabled`（项目只有 false 生效）；项目文件的 `lsp` 键 `project-cannot-grant`。
- **服务存根（03 建，各票实现）。** server `application/{plugins,lsp,teams,trace}.ts`、`context/{lsp,teams}.ts` 空贡献、`routes/{plugins,lsp,teams,trace}.ts` 空 router、`adapters/lsp-client.ts` 存根、`headless/index.ts`（打印"not implemented"并以 4 退出）；`runtime/layers.ts` 中每个领域一个以 `// ── <domain>（票 NN）──` 注释界定的装配块（plugins 04、lsp 05、teams 06、trace 07、headless 08（headless 的装配函数 `headlessLayer`）、mcp 09、memory 11），关闭顺序在 M5 的基础上于"关闭上下文贡献"之后、"终止登记进程"之前加入"关闭 LSP 进程"。agent `extensions/plugins/`、`tools/lsp/`、`agents/teams/`、`observability/` 的类型与空 barrel。
- **协议（03）。** 新领域文件 `protocol/src/{plugins,lsp,teams,trace}.ts` 的 DTO、路径与错误码（`plugin-exists`、`plugin-invalid`、`plugin-too-large`、`plugin-source-unreachable`、`plugin-not-found`、`teammate-exists`、`team-full`、`agent-not-reachable`、`stale-revision`、`task-not-claimable`、`not-owner`、`task-not-found`、`team-task-limit`、`lsp-server-not-found`）；`mcp.ts` 的 `auth-required`；`API_ROUTES` 增加 M6 的全部路径（含 `/api/mcp/presets`、`/api/memories` 的 query）。
- **desktop（03）。** `shared/bridge.ts` 与 preload：`onUpdateStatus(listener)`、`checkForUpdates()`、`installUpdate()`；main `update-coordinator.ts` 存根（状态恒为 `disabled { reason: not-packaged }`）；renderer 注册表：`settings/sections.ts` 的 `lsp` 占位（`plugins` 已有）、`right-panel/tabs.ts` 的 `team`、`trace` 占位、`header-actions.ts` 的 `team` 占位；时间线对新 kind 的分发与空组件 `team-task-row.tsx`、`team-message-row.tsx`；`build/build.ts` 的 sidecar 入口列表加入 `headless`、定义 `__COKO_UPDATE_FEED__`（缺省空）；`vitest.release.config.ts` 与 `e2e-release/global-setup.ts` 骨架。
- **i18n（03）。** 分域 `plugins`、`lsp`、`teams`、`trace`、`update`。
- **harness（03）。** `tests/fixtures/plugins/sample/`（一个 Skill、一个命令、一个子代理定义、一个 PreToolUse Hook 用 `tests/fixtures/hooks/hook.mjs`、一个 stdio MCP Server 用 `tests/fixtures/mcp/`、一个 LSP Server 用下条）；`tests/fixtures/lsp/server.mjs`（参数：`--record <file>`、`--diagnostics <json>`、`--definition <json>`、`--references <json>`、`--hover <text>`、`--crash-after <n>`、`--slow-start <ms>`）；`sidecar-harness.ts` 的 `teamMessages(sessionId)`、`modelRequests(sessionId)`；`sidecar-m6-seams.test.ts`。

### 权限类（扩展 [当前的权限类](../../docs/subsystems/permissions.md#模式)）

| 权限类 | 工具 | 模式放行 |
| --- | --- | --- |
| lsp（新） | `lsp`（规则组名 `Lsp`；路径同时按 `Read` 规则判定） | 与 read 相同：可读根内所有模式放行，越出询问 |
| team（新） | `send_message`、`task_create`、`task_update`、`task_list`（规则组名 `Team`） | 所有模式 |
| agent（已有） | `agent` 带 `name` 同样属于它；`isolation` 的规则不变 | 不变 |

### 跨票接口（开票时定死，已复制进相关两张票）

| 接口 | 定义方 | 使用方 | 形状 |
| --- | --- | --- | --- |
| `RunError.code: 'hook_blocked'` | 01 | 02（不使用，renderer 显示 message） | 字面量加入 protocol 与 agent 的联合 |
| `subscribeSession(sessionId): () => void` | 02 | 13（Team tab 订阅 teammate 子 Session） | 引用计数，最后一个 release 退订 |
| `PluginContributionsSnapshot` / `PluginContributionsPort` | 03 | 04（提供）、05、09（读取 lspServers / mcpServers） | 见"插件消费 seam" |
| `TEAM_MESSAGE_TAG`、`teamMessageText`、`HOST_NOTIFICATION_KINDS` | 03 | 06（送达）、13（渲染） | 见"Session Entry 与事件"末段 |
| `team_task` / `team_message` / `TeamSnapshot` | 03 | 06（写）、13（读） | 见"Session Entry 与事件"与"Agent Teams" |
| `model_request`、`RunTrace` | 03（条目）/ 07（trace） | 07、14 | 见"观测与评测" |
| `HEADLESS_DENIED_TEXT`、`approval_decision.by: headless` | 03（字面量）/ 08（文本常量在 `headless/approvals.ts`） | 07（audit 显示来源） | — |
| `LspServerStatus` | 03 | 05（写）、12（插件详情显示其 LSP 状态时只读） | 见"代码智能" |
| `UpdateStatus` 与 bridge 三个方法 | 03 | 10 | `{ state: 'idle' \| 'disabled' \| 'checking' \| 'available' \| 'downloading' \| 'downloaded' \| 'not-available' \| 'error', reason?, version?, message? }` |
| layers.ts 领域块 | 03 | 04–11 各自一块 | 注释界定，只改自己的块 |

### 共享装配点与所有者（M6 期间）

"A → B"表示按票的顺序修改，前一票合入后下一票才动；没有列出的票不改。01、02 是预构建，可以改各自 Write scope 内的任何文件；下列约束从票 03 起生效。

- **只有 03 改：** `packages/protocol/src/{index,entries,ws,runs,http,errors,control}.ts`；`packages/agent/src/{index.ts,package.json}`、`session-entries/`（全部）、`entries/host-input.ts`、`tools/registry.ts`、`engine/`、`config/schema.ts`、`policy/{decide,gate}.ts`、`agents/index.ts`；`packages/session/src/`；`packages/i18n/src/dictionaries.ts` 与 `dictionaries/{en,zh}.ts`；server `application/index.ts`、`application/context/{index,types}.ts`、`application/sessions.ts`、`application/recovery.ts`、`application/session-runs.ts`、`http/routes/index.ts`、`http/app.ts`；desktop `src/preload/`、`src/shared/bridge.ts`、`src/main/{index,control-channel}.ts`、renderer `stores/chat-store.ts`、`features/conversation/{timeline,timeline-view}.*`、`features/right-panel/right-panel.tsx`、`app/`；`tests/integration/{sidecar-harness,secrets-gate-harness}.ts`、`tests/fixtures/{plugins,lsp}/`、`apps/desktop/e2e/harness.ts`。
- **领域块：** `apps/server/src/runtime/layers.ts` 由 03 建块，之后 04（plugins）、05（lsp）、06（teams）、07（trace）、08（headless）、09（mcp）、11（memory）只改自己的块；需要改块外内容时写进 Comments 由 Lead 合并。
- **按顺序：**
  - `application/hooks.ts`：01 → 03 → 06（团队事件的分发函数，只追加）。`application/subagents.ts`（与 01 拆出的 `subagent-notifications.ts`、`subagent-recovery.ts`）：01 → 03 → 06。`application/goals.ts`：01 → 06（triggerRunId 口径）。`packages/agent/src/goals/`：01 → 03 → 06。
  - `application/context/{skills,commands,subagents,hooks}.ts` 与 agent `instructions/{skills,commands}/`、`agents/definitions.ts`、`extensions/hooks/config.ts`：01 → 03（插件根）。之后 04 不改它们。
  - `application/context/{mcp,mcp-admin}.ts`、`extensions/mcp/`、`protocol/src/mcp.ts`：03 → 09。`routes/mcp.ts`：09。
  - `adapters/git.ts`：01 → 04（clone）。`application/worktrees.ts`：01 → 06（teammate 的回收时机，只用已有接口则不改）。
  - `application/notifications.ts`：01。`application/schedules.ts`：01。`application/providers.ts`：08（`upsertFromConfig`）。`application/context/memory.ts`、`routes/memories.ts`、`protocol/src/memory.ts`：11。
  - 领域文件：`extensions/plugins/`、`protocol/plugins.ts`、`application/plugins.ts`、`routes/plugins.ts`：03 → 04（12 只读）。`tools/lsp/`、`protocol/lsp.ts`、`application/lsp.ts`、`context/lsp.ts`、`routes/lsp.ts`、`adapters/lsp-client.ts`：03 → 05。`agents/teams/`、`protocol/teams.ts`、`application/teams.ts`、`context/teams.ts`、`routes/teams.ts`：03 → 06（13 只读）。`observability/`、`protocol/trace.ts`、`application/trace.ts`、`routes/trace.ts`：03 → 07。`headless/`：03 → 08。
  - i18n `dictionaries/domains/`：`plugins.ts` 03 → 04 → 12；`lsp.ts` 03 → 05；`teams.ts` 03 → 06 → 13；`trace.ts` 03 → 07；`update.ts` 03 → 10；`mcp.ts` 09；`memory.ts` 11；`hooks.ts`、`agents.ts`、`worktrees.ts` 01。
  - renderer：`settings/sections.ts`、`right-panel/tabs.ts`、`header-actions.ts` 由 03 建占位，05（lsp）、07（trace）、12（plugins）、13（team tab 与 header）各只把自己的一行改为可用；`settings/about-section.tsx`：10；`settings/mcp-section.tsx`：02 → 09；`settings/memory-section.tsx`、`stores/memory-store.ts`：11；`settings/lsp-section.tsx`（新）、`stores/lsp-store.ts`（新）：05；`right-panel/trace-tab.tsx`（新）、`stores/trace-store.ts`（新）：07；`settings/plugins-section.tsx`（新）、`stores/plugins-store.ts`（新）：12；`right-panel/team-tab.tsx`、`team-button.tsx`、`team-task-row.tsx`、`team-message-row.tsx`、`stores/team-store.ts`：03（空组件）→ 13；`features/conversation/tool-cards.tsx`：02 → 05（lsp 卡）→ 09（image 缩略图，如需）→ 13（team 卡），按合入顺序，各只追加自己的分支。
  - desktop main：`update-coordinator.ts`：03 → 10；`notifications.ts`：02。`forge.config.ts`、`build/build.ts`（03 之后）、`package.json`、`vitest.release.config.ts`、`e2e-release/`：10。
  - 根：`package.json` 的 `eval` 脚本与 `vitest.config.ts`：07；`pnpm-workspace.yaml` 与 `pnpm-lock.yaml`：10（只有 10 新增依赖）。
  - `apps/desktop/e2e/package-smoke.e2e.test.ts`：04（插件安装与 LSP 假服务器在打包应用中）→ 08（headless 一例），按合入顺序各追加一个用例。
- **文档：** `packages/agent/README.md`、`apps/server/README.md`：01 → 03 → 14（14 汇总 M6 全部变化，04–13 把要点写进 Comments）；`packages/session/README.md`：03 → 11；`packages/protocol/README.md`（新）：08；`docs/tech-stack/architecture.md`：03（新服务一句）、08（SDK 与 dist 的说明）；`docs/tech-stack/agent-runtime.md`：不改；`docs/tech-stack/desktop-delivery.md`：10；`docs/tech-stack/testing.md`：07（evals 一段）、10（发布构建 E2E 一段），各加一段，由 Lead 合并；`docs/TECH_STACK.md`：09（@playwright/mcp 一行）、10（makers 与 allowBuilds）；`docs/subsystems/permissions.md`：03；`configuration.md`：03；`recovery.md`：03 → 06；`hooks.md`：01 → 03 → 06；`subagents.md`：01 → 06；`worktrees.md`：01；`mcp.md`：03 → 09；`memory.md`：11；`context.md`：06（`<team>` 与 `<team-message>` 一段）；新子系统页 `plugins.md`（04 → 12）、`lsp.md`（05）、`teams.md`（06 → 13）、`tracing.md`（07，含 evals）、`headless.md`（08）、`delivery.md`（10）；`docs/README.md` 当前行为每票只增自己的一行；ADR：0017（04 → 12，12 改 implemented）、0018（06 → 13，13 改 implemented）、0019（08 改 implemented）、0003（03 补 v9；11 改 implemented）、0012（03 补 lsp 类别）、0010 与 0014（08 / 06 各补一行指向后继细化）、0016（06 补 teammate 复用）；`docs/adr/README.md` 的 implementation 列随改 implemented 的票同步。

### Carry-overs 去向

| 地图 Carry-over | 去向 |
| --- | --- |
| 带 owner / 认领 / 锁的 Task、共享 blockedBy、TaskCreated / TaskCompleted / TeammateIdle Hook | 03（条目、事件名）→ 06 |
| Plugins 以同一 Hook schema 声明 Hook | 03（插件 Hook 并入）→ 04 |
| 子代理继续对话（send_message）；teammate 复用 ADR 0016 | 06 |
| Spec J3、J4、J8、J9；Standards H4、H5、H8、T3、T4、S2–S7、S10 | 01 |
| Standards T5、S8、S9 | 02 |
| worktree 会话的上下文用量；回退边界用例 | 01 |
| 子代理桌面通知的 Electron E2E；390 px 占位符换行 | 02 |
| MCP HTTP 401 的需要认证状态 | 03（状态值）→ 09 |
| 发布构建（不带 COKO_TEST_BUILD）的产物 E2E | 03（骨架）→ 10 → 14（复跑） |
| M5 复盘规则（宿主注入三处、接收侧用例、接口定死） | [implementer-brief](implementer-brief.md) |

## Testing Decisions

- 好的测试只断言外部事实：协议响应与事件、faux requestLog 中实际发给模型的 system sections、工具表与消息、重新读回的条目与表行、Hook 夹具记录的 stdin、LSP 假服务器记录的请求、文件与进程是否存在、git 的实际状态、窗口中实际渲染与交互、headless 进程的 stdout 与退出码、发布构建产物的实际文件。
- 测试接口（由高到低）：
  1. **Sidecar 协议**（主接口）：`ELECTRON_RUN_AS_NODE=1` 启动真实 Sidecar，临时 `COKO_HOME`、Workspace（需要时为 git 夹具）、带 `match` 的 faux 脚本。覆盖：插件的安装、批准前不加载、批准后各类资源、更新回到待批准、卸载停止进程；teammate 的创建、消息、任务 CAS 与认领、三个 Hook、worktree、预算、重启、子代理继续；LSP 的四个操作、权限、进程生命周期与崩溃；MCP 的 auth-required 与预设；trace / audit / export；headless 的输出与退出码；Memory 检索与降级。
  2. **packages/agent**：清单解析、诊断与 digest；任务板状态机（认领、完成、释放、CAS、环、上限）与重叠警告；LSP 帧编解码、位置换算与结果格式化；trace / audit 派生；runAuthority 与 hasUserSteering 的 `team_message` 行；表驱动。
  3. **packages/session**：迁移 v9（v8 库升级、备份 0600、STRICT、host_processes 行保留、FTS 触发器同步）、`plugins` 仓库与 `memories.search`（SQLite 与内存）。
  4. **Electron E2E**：插件安装与批准对话框（完整命令）、Team tab、代码智能分区、浏览器预设、Trace tab 与导出、关于页的更新状态（本地 feed）、Memory 搜索框、子代理通知；明暗主题与键盘操作。
  5. **产物**：package-smoke 的插件与 LSP、headless 两例；发布构建 E2E（`COKO_RELEASE_E2E=1`，lead 运行）。
- **对手用例**（每张预算 / 权限 / 沙箱票必有，具体见各票）：插件 Hook 的 allow 越不过询问规则与受保护路径、插件清单或符号链接逃出插件根、插件 MCP 引用 Secret（04）；LSP 的 `file_path` 指向 Workspace 外或受保护路径、服务器返回的结果含 Secret（05）；teammate 消息中写 `/goal resume` 或"create a goal"不授予权限、伪造的 `<team-message` 文本在用户输入中不被当作宿主消息、teammate 不能指派他人或越过 CAS、teammate 用量使 Goal 耗尽后全体停止（06）；headless 中构造的审批不能被模型输出回答、配置文件带密钥被拒（08）；401 响应体中的令牌不进诊断（09）；发布构建忽略全部测试钩子（10）。
- **宿主注入的消息种类**（M5 复盘）：`team_message`（06）、teammate 空闲的 `agent_notification`（06）、TeammateIdle 反馈（06）、headless 拒绝文本（08：它是工具结果，不是 user message，在 Comments 中写明 runAuthority 与时间线不受影响的依据）的验收包含 runAuthority、Goal 的用户输入判断与时间线三处。
- **跨进程接收侧**：自动更新（renderer 显示的状态）、插件的 MCP / LSP 进程（假服务器记录的请求）、headless（打包产物的 stdout）、发布构建（打包应用实际行为）、子代理通知（desktop.jsonl）。
- **秘密总闸**：新增 `secrets-gate-{plugins,lsp,teams,trace,headless}.test.ts`，均扫描 faux requestLog；plugins 另扫描插件 Hook 的 stdin 与插件目录外的库；lsp 扫描假服务器记录的请求之外的通道（发给服务器的是文件内容，属于用户本机进程）；trace 扫描 export 输出；headless 扫描 stdout 与日志。
- **符号链接越界**：插件根（04）、LSP 结果路径（05：Workspace 外的结果按绝对路径显示，不改变读取判定）；其余票在 Comments 写明不新增读取根的理由。
- 进程测试用真实子进程（Hook、MCP、LSP 夹具为仓库内 node 脚本）；等待用可观察条件，不用固定 sleep。
- 真实模型、真实语言服务器、真实 Playwright MCP：见下节，测试中 `skipIf` 并报告未验证。

## 人工验证清单（交付前，需要真实凭据或外部条件）

| 项 | 前置条件 | 操作 | 预期观察 | 票 |
| --- | --- | --- | --- | --- |
| 真实模型的 teammate 协作 | 任一 Provider 的凭据 | 在 Workspace 中让 Agent 建两个 teammate 分工完成一个小改动 | 任务板有两项被不同成员认领并完成；名册显示用量；Goal 用量包含两者 | 06、13 |
| 真实模型的 LSP 修复 | 凭据；本机 `typescript-language-server` | 配置 TS 服务器，让 Agent 修一个类型错误并用 `lsp diagnostics` 确认 | 修复前诊断 ≥ 1，修复后 0 | 05 |
| 真实语言服务器 | `npm i -g typescript typescript-language-server` | 设置中添加服务器，对仓库内一个 TS 文件查定义与引用 | 结果位置正确；状态 running；10 分钟后 idle | 05 |
| 浏览器 MCP | 网络、Node（npx）、凭据 | 添加 Playwright 预设，让 Agent 打开一个页面并截图 | 审批卡出现；工具卡显示截图缩略图 | 09 |
| HTTP MCP 401 | 一个需要 Bearer 的 MCP 服务 | 不带 / 带错误的 Authorization 添加 | 状态"需要认证"，补上正确的请求头后 connected | 09 |
| headless 真实运行 | 凭据（`COKO_CREDENTIAL_<ID>`）与 Provider 配置文件 | 对打包产物运行 `headless.mjs --output stream-json` | 最后一行 result completed，退出 0；default 模式下的写入被拒并有说明 | 08 |
| evals 真实模式 | `COKO_EVAL_PROVIDER_CONFIG` 与凭据 | `pnpm run eval` | 报告中 3 例有 pass / fail 与费用，无 `skipped` | 07 |
| 插件来自真实 git 仓库 | 网络与一个公开插件仓库 | 以 https URL 安装、批准、启用 | 资源出现，commit 记录正确 | 04、12 |
| 签名的更新链路 | Apple Developer ID 证书与发布 feed（不在本地图范围） | — | 记为不在范围 | 10 |
| 非 darwin 平台 | 不在首发范围 | — | 记为不在范围 | — |

## Out of Scope

- 插件市场、npm 来源、插件自动更新、项目级插件、进程内插件代码、claude-code 的 `userConfig` / `channels` / `outputStyles` / `settings` 字段。
- Agent Teams：用户直接给 teammate 发消息、跨根 Session 的团队、文件锁、teammate 改名、嵌套团队、带历史分叉的子代理、排队消息跨进程保留。
- LSP：随包分发语言服务器、socket 传输、编辑后自动追加诊断、符号 / 调用层级 / 重命名等其他操作、项目文件配置语言服务器。
- 浏览器：自研浏览器或桌面控制、Computer Use 专用预设、浏览器登录状态持久化。
- MCP：OAuth 认证流程。
- SDK：dist 构建与 npm 发布、长期运行的 SDK 服务器（standalone Sidecar 已是）、headless 中的交互式审批。
- 观测：OpenTelemetry 导出、图表、按工具结果重新执行的回放、产品遥测。
- Memory：自动提取与语义（向量）检索。
- 交付：代码签名与公证、发布 feed 与发布目的地、Windows / Linux。

## Further Notes

- **最大风险：票 06（Agent Teams 核心）。** 它同时触及子代理服务（883 行、M5 评审最多发现的模块）、Goal 预算归属、宿主注入的新消息种类（授权与时间线）、并发（CAS 与认领）、重启与 worktree。01 先把 `SubagentService` 拆开（S7）、03 把条目、标签与 runAuthority 的表驱动用例预建好，06 只填实现；06 的 Comments 须逐条记录与 ADR 0018 的对应关系。
- **第二风险：票 10 的依赖与时长。** appdmg 链可能需要原生构建；发布构建 E2E 需要第二次打包与 make（数分钟），默认全量不包含它，由 lead 在 10 合入与 14 中运行。
- **组合后的工具定义体积。** M6 新增常驻工具 `lsp`（有服务器时）、`send_message` / `task_*`（有成员时）；M4、M5 都因工具定义增加使压缩阈值用例提前触发。Lead 在 05、06 合入后复核 `sidecar-compaction` 与 `sidecar-todo`，需要时只调整该用例的窗口（不改阈值算法）。
- **条目 kind 列表的断言。** `model_request` 会出现在每个有模型请求的 Session 中；03 负责把断言精确条目序列的已有测试改为忽略 `model_request` 或显式包含它，并逐条写进 Comments。
- **插件 Hook 与全局同级**是本里程碑唯一放宽信任的地方（ADR 0017），04 的对手用例必须覆盖它仍越不过判定前四步。
- 并行窗口只派发写范围不重叠的票：{01, 02}；03 单独；{04, 05, 06, 07, 08, 09, 10, 11} 中任选（建议先 06、04、10 这三张最长的）；12 在 04 后、13 在 06 后；14 最后。每票合入前做该票 diff 的轻量 Spec 评审，里程碑末做两轴全量评审。
