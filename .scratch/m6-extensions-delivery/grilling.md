# M6 扩展与交付：设计树与采纳记录

Map: [Coko 桌面应用](../desktop-app/map.md) · [里程碑划分](../desktop-app/issues/06-grill-milestone-route.md) · [能力深度](../desktop-app/issues/09-grill-capability-depth.md) · 规格：[spec.md](spec.md) · 覆盖表：[capability-coverage.md](capability-coverage.md)

2026-10-31，planner。M6 是地图的最后一个里程碑。按用户常设指示（2026-10-28 goal：讨论问题直接采用推荐答案，优先沿用参考项目决策；packages/agent 参考 pi coding-agent v1.4.0 与 claude-code，apps/desktop 的 UI 参考 deepseek-harness），本文每个问题都由 Agent 给出推荐并**按常设指示采纳**，不是用户逐条确认；grilling 不等待用户。参考材料：[M5 复盘](../m5-agents-scheduler/retro.md)、[M4 复盘](../m4-goal-plan-tasks/retro.md)、M5 两份评审的"处理结果"（[Spec](../m5-agents-scheduler/review-spec.md)、[Standards](../m5-agents-scheduler/review-standards.md)）、[claude-code 研究](../desktop-app/research/claude-code-agent-logic.md)、[DSH 研究](../desktop-app/research/dsh-desktop-architecture.md)。

## 已核对的事实

- **能力表现状。** 逐行核对见 [capability-coverage.md](capability-coverage.md)：35 行中 26 行已交付（M1–M5），部分交付 5 行（Task / Todo、Subagents、Memory、SDK / Headless / Protocol、Observability / Evals），未开始 4 行（Plugins、Agent Teams、Code Intelligence、Browser / Computer Use）。桌面交付项（DMG / ZIP、自动更新接线、发布构建 E2E）未开始。
- **Memory 的"检索"没有实现。** memory.md 写明"检索、FTS 索引与自动提取记忆尚未实现"；ADR 0003 为 partial 的剩余原因也是 FTS5 索引。能力表 Memory 行含"检索"，地图 M6 行没有列出；为使交付后没有未覆盖的行，纳入 M6（K1）。
- **Task / Todo 的"负责人"。** todo_list v1 有 id、blockedBy、result，没有 owner；M4、M5 都把 owner / 认领 / 锁推迟到 Agent Teams。
- **Observability 现状。** assistant 的 `message` 条目带 pi 的 usage 与 cost（Goal 预算由此派生），日志有 `run started` / `run ended`；没有逐请求的延迟、首字节时间与重试次数，没有追踪、审计或回放接口；`tests/evals` 不存在（architecture.md 的目录树已预留）。
- **SDK / Headless 现状。** Sidecar 没有 IPC 父进程时为 standalone：ready / fatal 逐行写 stdout，只读 `COKO_CREDENTIAL_<ID>` 与 `COKO_SECRET_<NAME>`；令牌交换只要求请求不带 cookie，外部进程可以用 stdout 的令牌换 cookie。但 standalone 不能保存 Provider（ADR 0010 只有 main 的 `provider.save` 一条路径），集成 harness 先用一个 IPC 模式的 Sidecar 预写库。`createAgentRuntime` 等从 `@coko/agent` 主入口导出，没有作为 SDK 的说明与示例；protocol 没有 README；architecture.md 写明"需要独立发布 SDK 时（M6）再为 agent 增加 dist 构建"。
- **桌面交付现状。** `forge.config.ts` 的 `makers: []`；没有 `autoUpdater`；E2E 的 globalSetup 只打 `COKO_TEST_BUILD=1` 的测试构建，`package-smoke.e2e.test.ts` 在测试构建上运行。`@electron-forge/maker-dmg@8.0.1` 的可选依赖 `electron-installer-dmg ^5.0.1` 引入 `appdmg 0.6.6`（darwin，带原生依赖链），需要 allowBuilds 裁决（本机 `pnpm view` 核对）。
- **MCP 401。** `McpConnectionStatus` 只有 idle / connecting / connected / failed；pi-mcp 1.4.0 的 `AuthProvider.onUnauthorized(context)` 在 401（或 insufficient_scope 的 403）时被调用，可据此识别。
- **扩展点。** 设置注册表已有 `plugins` 占位（available: false）；右栏 tabs 为 plan / jobs / agents / schedules；标题栏操作为 jobs / cost / agents / schedules / handoff；宿主输入标签与 `HOST_NOTIFICATION_KINDS` 在 `@coko/agent/entries` 的 `host-input.ts` 一处（M5 票 11）。
- **体量。** `subagents.ts` 883 行、`hooks.ts` 556 行、`session-runs.ts` 619 行、`runtime/layers.ts` 647 行；M5 复盘第 7 条：layers.ts 是合并冲突的集中处。
- **参考实现。** claude-code（社区还原版）：插件清单 `.claude-plugin/plugin.json`，声明 commands / agents / skills / hooks / mcpServers / lspServers（`command`、`args`、`extensionToLanguage`、`env`、`initializationOptions`、`startupTimeout`…），`${CLAUDE_PLUGIN_ROOT}` 变量，另有市场与自动更新；LSPTool 9 个操作、1 基行列；TaskCreate / TaskUpdate（owner、blocks / blockedBy、status）/ TaskList；TeamCreate、SendMessage（`to` 为 teammate 名或 `*`）；TeammateIdle（exit 2 → 继续工作）、TaskCreated（exit 2 → 阻止创建）、TaskCompleted（exit 2 → 阻止完成，stderr 给模型）。DSH：`experimental/agent-team`（隐式根 Session 为 Lead，具名 teammate 不可改名；消息经目标收件箱的 Steer 送达，空闲时开始新 turn；任务为完整快照 + `revision` 的 compare-and-set，`blockedBy` 无环，`writeScopes` 只给重叠警告、不加锁；同一 checkout，没有 worktree）；`lsp`（goToDefinition / findReferences / goToImplementation / hover 四个操作，0 基 UTF-16，工具层换算 1 基，stdio provider 按配置启动服务器）；`browser-use`（只做 provider 注册，Playwright MCP / Chrome DevTools MCP 等经 MCP，浏览器状态属于 Session）；`sdk/{client,protocol,server}`；desktop 的 `update-coordinator.ts`。pi v1.4.0：packages 以目录、npm 或 git 安装，清单在 `package.json` 的 `pi` 键，扩展是进程内 TS 模块，项目包须先信任。
- **版本。** `@playwright/mcp` 最新为 0.0.83（本机 `pnpm view`，经公司 Artifactory）。

## 设计树

```text
M6
├── A 预构建 ── A1 M5 遗留的范围与切分 ── A2 J3/J4/J8/J9 的裁决 ── A3 M6 基础票的内容
├── B Plugins ── B1 能执行什么 ── B2 来源与安装位置 ── B3 清单格式 ── B4 信任与批准 ── B5 命名空间
│           └── B6 生命周期（启用 / 禁用 / 更新 / 卸载）与界面
├── C Agent Teams ── C1 teammate 的形态 ── C2 工具面 ── C3 消息送达 ── C4 任务板与锁 ── C5 Hook 事件
│               └── C6 worktree ── C7 预算、并发与重启 ── C8 子代理继续对话 ── C9 界面
├── D Code Intelligence ── D1 配置来源 ── D2 工具与操作 ── D3 权限 ── D4 进程 ── D5 界面
├── E Browser / Computer Use ── E1 预设 ── E2 图像结果 ── E3 MCP 401
├── F SDK / Headless ── F1 库入口 ── F2 无界面运行入口 ── F3 Provider 与审批 ── F4 协议文档
├── G Observability / Evals ── G1 逐请求记录 ── G2 追踪与审计接口 ── G3 回放 ── G4 evals ── G5 界面
├── H 交付 ── H1 DMG / ZIP ── H2 自动更新接线 ── H3 发布构建 E2E
├── K Memory 检索 ── K1 范围
└── L 交付组织 ── L1 复盘规则 ── L2 切片与写范围 ── L3 测试接口 ── L4 ADR 与术语 ── L5 人工验证清单 ── L6 地图建议
```

## 第 1 轮（根节点）

**A1 M5 遗留的范围与切分**：地图 Carry-overs 中标 M6 的遗留项（J3、J4、J8、J9、H4、H5、H8、T3–T5、S2–S10、worktree 会话的上下文用量、回退边界用例、子代理通知的 Electron E2E、390 px 占位符换行）放在哪里？
➡️ 两张可并行的预构建票，按包边界切开，写范围不重叠：**01 运行时遗留**（packages/agent、protocol、session、i18n，apps/server，tests/integration，相关 subsystem 文档）与 **02 界面遗留**（apps/desktop/src、apps/desktop/e2e、packages/ui）。两票之间的接口在开票时定死并写进两张票（M5 复盘第 6 条）：01 给 `RunError.code` 增加 `hook_blocked`（PreCompact 阻止，S10），renderer 照常显示 `error.message`，02 不依赖它；02 让 `chat-store.subscribeSession(sessionId)` 返回 release 并按引用计数退订（S9），01 不碰 renderer；T5（main 通知模块的全局 `live` Set）与子代理通知的 Electron E2E 在 02，01 只改 Sidecar 侧的通知服务（J3）。之后是串行的 **03 M6 基础**。采纳。

**A2 四个规格裁决**：
➡️
- **J3（关闭通知时 Notification Hook 不运行）**：Hook 在设置判定之前运行，设置只决定是否显示。User Story 4 的"转发通知"正是关闭桌面通知、改用 Hook 的场景，规格原文也是"不论是否显示"。改代码，hooks.md 写明。
- **J4（父 Session 写入 isolation worktree 不询问）**：与 Read 一样加 `Edit(<path>/**)` 与 `Write(<path>/**)` 的询问规则（不入库，随子代理结束移除）；bash 不受规则保护，在 subagents.md 写明。ADR 0016 的"隔离成立"要求父级写入同样经过用户。
- **J8（COKO_PROJECT_DIR）**：取 Session 的工作目录（worktree 会话为 worktree 中对应的目录），与 claude-code 的 `CLAUDE_PROJECT_DIR`（会话所在的项目目录）一致；Hook 脚本处理的是该会话实际修改的文件。代码已如此；改的是 M5 grilling B4 的写法（ADR 0013 没有写这个变量），hooks.md 写明，补一条 worktree 会话的用例。
- **J9（UserPromptSubmit 的 prompt）**：保持原文（用户输入的文字，不含 Skill / 命令展开的正文），与 claude-code 一致；守卫 Hook 关心用户写了什么，展开的模板来自已加载的文件。hooks.md 改为"原文"，补用例断言 `/<skill>` 展开的正文不在 stdin 中。
采纳。

**B1 插件能执行什么**：pi 的扩展是进程内 TS 模块；claude-code 的插件只声明资源与外部命令（hooks、MCP、LSP）。
➡️ **只声明，不在 Sidecar 中执行插件代码**。插件提供 Skills、Commands、Subagent Definitions、Hooks、MCP Server 与 LSP Server 的声明；会执行的部分（Hook 命令、MCP / LSP 进程）都是现有机制下的外部进程，经进程登记、超时与脱敏。进程内代码能绕过权限 gate、Seatbelt 与秘密脱敏，等于把 Sidecar 交给插件作者。见 [ADR 0017](../../docs/adr/0017-plugins-declarative-user-installed.md)。采纳。

**C1 teammate 的形态**：
➡️ **teammate 是根 Session 下具名、可继续对话的子 Session**，复用 ADR 0014 的全部机制（有效权限、审批冒泡、预算汇入、取消与重启），只增加名字、消息送达与共享任务板。不另建进程、不另建团队实体：团队 id 即根 Session id（DSH 的隐式根）。见 [ADR 0018](../../docs/adr/0018-agent-teams-in-root-session.md)。采纳。

**D1 LSP 配置来源**：
➡️ 三处：全局设置 `lsp.servers`、按 Workspace 的设置 `lsp.workspaces.<workspaceId>.servers`（都在 SQLite，由用户本人编写，不另批准），以及已批准插件的 `lspServers`。项目文件 `.coko/settings.json` 中的 `lsp` 键以 `project-cannot-grant` 忽略（会启动进程，ADR 0008）。服务器条目沿用 claude-code 的形状 `{ command, args?, extensionToLanguage, env?, initializationOptions?, startupTimeout? }`。不随包分发语言服务器（能力深度票）。采纳。

**E1 浏览器预设**：
➡️ 设置 → MCP 分区增加"添加浏览器（Playwright MCP）"预设，生成一条普通的全局 stdio MCP Server：`npx -y @playwright/mcp@0.0.83 --isolated`（精确版本写入 TECH_STACK；`--isolated` 使浏览器配置不落盘，每次连接是干净状态，与 DSH"浏览器状态属于 Session、不从日志恢复"一致）。不自研浏览器控制，Computer Use 也不做专用实现：桌面控制同样由用户配置的 MCP Server 提供，走同一 MCP 权限类。预设表在 server（`GET /api/mcp/presets`），renderer 不硬编码。采纳。

**F1 SDK 的库入口**：
➡️ `@coko/agent` 的主入口（`createAgentRuntime`、工具注册、条目 schema、权限 gate、端口类型）就是 SDK；补 README 的"作为库使用"一节，以及一个只经公共入口、内存存储与 faux 模型运行的集成用例（`tests/integration/sdk-library.test.ts`）。不做 dist 构建与 npm 发布：仓库没有 remote 与发布目的地，architecture.md 中"需要独立发布时再加 dist"的条件未触发。采纳。

**G1 逐请求记录**：
➡️ 新 kind `model_request` v1，每次模型请求结束（含错误、压缩与交接的摘要请求）由运行时提交一条：`runId`、`provider`、`model`、`startedAt`、`durationMs`、`ttftMs?`、`usage { input, output, cacheRead, cacheWrite, total }`、`cost?`、`stopReason`、`retries`、`errorCode?`。usage 与 cost 已在 assistant 消息中，仍单独保存的理由：错误与摘要请求没有 assistant 消息，延迟只在运行时可知。Goal 预算的派生不改（仍读原来的字段），避免两个来源。Fork 与 Handoff 不复制它。日志同时记 `model request finished`。采纳。

**H1 安装包**：
➡️ 加入 `@electron-forge/maker-zip@8.0.1`（darwin）与 `@electron-forge/maker-dmg@8.0.1`（ULFO），`pnpm run make` 生成。appdmg 链的安装脚本逐个 allowBuilds 裁决并记入 TECH_STACK；无法安装或构建时票以 BLOCKED 报告，不换工具链。签名与公证不交付（地图 Out of scope）。采纳。

**K1 Memory 检索**：
➡️ 纳入 M6，单独一张小票：迁移 v9（票 03）建 `memories_fts`（FTS5，content 表为 memories，触发器同步）与 `MemoryRepository.search(query, scope)`；票 11 让 `memory_list` 增加可选 `query`（按相关度，至多 20 条），`GET /api/memories?query=`，设置的 Memory 分区增加搜索框。运行时不支持 FTS5 时降级为 LIKE（ADR 0003"运行时不支持时降级为普通查询"）。不做自动提取。完成后 ADR 0003 可改 implemented。采纳。

## 第 2 轮

**A3 M6 基础票（03）的内容**：
➡️ 沿用 M5 票 02 的做法，并按 M5 复盘第 7 条**先放好 layers.ts 的占位**：
- 条目：`model_request` v1（运行时提交，G1）、`team_task` v1、`team_message` v1、`agent_start` v2（`name?`、`teammate?`）、`agent_end` v2（`status` 增加 `dismissed`）、`approval_decision` v3（`by` 增加 `headless`）、`hook_run` v2（`source` 增加 `plugin`，`event` 增加三个团队事件）；`RunError.code` 的 `hook_blocked` 由 01 完成。
- 宿主输入：`TEAM_MESSAGE_TAG = '<team-message'`，`HOST_NOTIFICATION_KINDS` 加入 `team_message`，`isHostNotificationText` 识别它，renderer 时间线按位置去掉该块（与 agent 通知相同的处理）。
- 迁移 v9：`plugins` 表、`memories_fts` 与 `search`、`host_processes.kind` 增加 `lsp`（重建表）。
- 协议：领域文件 `{plugins,teams,lsp,trace}.ts` 与 `mcp.ts` 的 `auth-required` 状态值；preload 的 update 桥（`onUpdateStatus`、`checkForUpdates`、`installUpdate`）与 main 的 `UpdateCoordinator` 存根。
- 插件消费 seam：`PluginContributions` 端口（skills / commands / agents 的根目录、hooks、mcpServers、lspServers 的快照，缺省为空），Skills、命令、子代理定义、Hook、MCP 的加载在 03 接入它；04 只实现提供方。
- 服务存根与 layers.ts 的领域块：`PluginService`、`LspService`、`TeamService`、`TraceService`，`apps/server/src/headless/index.ts` 入口存根（构建为 `dist/sidecar/headless.mjs`）。
- 权限类：`lsp` 按路径读取（与 read 同类）；`team`（`send_message`、`task_*`）所有模式放行；`agent` 带 `name` 时与 `agent` 相同。
- 配置键：`plugins.enabled`、`lsp.enabled`、`teams.enabled`（项目只能关；`plugins.enabled` 只在全局）。
- Hook 事件名 `TaskCreated`、`TaskCompleted`、`TeammateIdle` 进入配置校验（不再报 `unknown-event`），分发在 06。
- renderer：设置 `plugins`（已有）与 `lsp` 占位，右栏 `team`、`trace` 占位，标题栏 `team` 占位，时间线对新 kind 的分发与空组件 `team-task-row`、`team-message-row`。
- i18n：`plugins`、`lsp`、`teams`、`trace`、`update` 五个分域。
- harness：插件夹具 `tests/fixtures/plugins/sample/`、LSP 假服务器 `tests/fixtures/lsp/server.mjs`（stdio JSON-RPC，按参数给出诊断、定义、引用、悬停，可记录收到的请求）、`teamMessages` / `traceOf` 辅助、发布构建 globalSetup 的骨架（不加入默认项目）。
采纳。

**B2 来源与安装位置**：
➡️ 两种来源：本机目录与 git URL（`https://` 或 `file://`，可带 `#<ref>`）；不做市场与 npm（没有发布目的地，YAGNI）。安装把插件**复制**到 `~/.coko/plugins/<name>/`（`COKO_HOME` 下）：目录来源复制快照（之后源目录的改动不生效，"更新"才重新复制）；git 来源以宿主 git（M5 的 `adapters/git.ts`：argv、`GIT_TERMINAL_PROMPT=0`、登记 `kind: git`）`clone --depth 1` 到临时目录再复制，记录 commit。复制时拒绝指向插件根之外的符号链接，上限 5 000 个文件、50 MB。只有用户级安装，没有项目级插件（项目要提供资源已有 `.coko/skills` 等）。安装记录（来源、版本、commit、digest、已批准 digest、启用状态）存 SQLite `plugins` 表，文件在 `~/.coko/plugins`（ADR 0009：用户可读的资源为文件，应用状态在库中）。采纳。

**C2 团队的工具面**：
➡️ 不新增团队创建工具（DSH 的隐式根；claude-code 的 TeamCreate 在 Coko 中没有对应的独立实体）：
- `agent` 增加可选 `name`（`[a-z][a-z0-9-]{0,31}`，同一根 Session 内唯一，`lead` 保留）：带 name 时创建 **teammate**，必为后台（与 `run_in_background: false` 同用为参数错误）；需 `teams.enabled`。每个根 Session 至多 8 个 teammate（不含已解散）。
- `send_message { to, message, summary? }`：`to` 为 teammate 名、`lead` 或 `*`（广播给除自己外的全部成员）；也可以是已结束的一次性子代理的 agentId，即"子代理继续对话"（C8）。
- `task_create { subject, description?, blocked_by?, write_scopes? }`、`task_update { id, expected_revision, status?, owner?, subject?, description?, blocked_by?, write_scopes? }`、`task_list {}`。
- 解散：`agent_cancel` 对 teammate 即解散（abort 当前 Run，`agent_end { status: dismissed }`，之后的消息为错误结果）。
`send_message` 与 `task_*` 在根 Session 有 teammate 或已结束的子代理时注册（M5 的按需注册），teammate 的子 Session 中总是注册；teammate 中仍没有 `agent`（深度 1）。采纳。

**D2 LSP 工具与操作**：
➡️ 一个工具 `lsp { operation, file_path, line?, character? }`，operation 为 `diagnostics`、`definition`、`references`、`hover`（能力深度票的四项；DSH 的 goToImplementation 换成诊断，诊断是"改完代码看错误"的主要用途）。行列 1 基（claude-code / DSH 的工具层约定），客户端换算为 0 基 UTF-16。diagnostics 发 didOpen / didChange（读磁盘当前内容）后等待该文件的 `publishDiagnostics`（缺省 5 秒，超时返回"没有收到诊断"）。结果为 `相对路径:行:列 文本` 行，至多 200 项、20 000 字符。只在 `lsp.enabled` 且有服务器时注册；文件扩展名没有匹配的服务器时为错误结果并列出已配置的扩展名。不做编辑后自动追加诊断（YAGNI）。采纳。

**E2 图像结果**：
➡️ Playwright MCP 的截图是 image 内容块，`extensions/mcp/results.ts` 已转换为 pi 的 ImageContent；M6 补证据：测试 MCP Server 返回 image 时，条目中保存了 image 块、时间线渲染缩略图、模型不支持图像输入时给出文本说明。采纳。

**F2 无界面运行入口**：
➡️ `apps/server/src/headless/` 的 headless 入口，在一个进程中装配与 Sidecar 相同的应用层（不监听 HTTP）：

```text
ELECTRON_RUN_AS_NODE=1 <electron> dist/sidecar/headless.mjs --data-dir <dir> --workspace <dir> (--prompt <text> | --prompt-file <f>)
  [--session <id>] [--provider-config <json>] [--model <providerId/modelId>] [--permission-mode <mode>]
  [--output text|json|stream-json] [--max-turns <n>] [--on-approval deny|fail] [--log-dir <dir>]
```

stream-json 逐行输出与 WebSocket 相同的协议事件，最后一行为 `{ type: 'result', status, sessionId, runId, text, usage, durationMs }`；退出码 0 completed、1 failed、2 paused、3 审批被拒且 `--on-approval fail`、4 参数或启动错误。pi 的 `--mode json` 与 claude-code 的 `-p --output-format stream-json` 都是这个形状。长期运行的 SDK 服务器就是 standalone Sidecar（F4），不另做。采纳。

**G2 追踪与审计接口**：
➡️ agent `observability/trace.ts` 的纯函数 `deriveTrace(entries)` → 每个 Run 的 `{ runId, trigger, status, startedAt, durationMs, requests, tools: [{ toolCallId, name, durationMs, approvalWaitMs?, approval?, hooks }], usage, cost }`；`deriveAudit(entries)` → 授权决定、权限模式与规则变更、Hook 结果、结果确认、定时投递、交接、teammate 生命周期的时间序列。HTTP：`GET /api/sessions/:id/trace`（全部 Run 与合计）、`GET /api/sessions/:id/audit`、`GET /api/sessions/:id/export`（`application/x-ndjson`，已脱敏的条目；`?children=1` 含子 Session）。工具耗时用条目的 `createdAt`（tool_exec、approval_request、approval_decision、结果消息）计算，不新增条目。采纳。

**H2 自动更新接线**：
➡️ main 的 `UpdateCoordinator`：feed URL 只来自构建期定义 `COKO_UPDATE_FEED_URL`（`build.ts` 定义为 `__COKO_UPDATE_FEED__`，缺省空），不是用户设置（更新源属于发布方）。`app.isPackaged` 且 feed 非空时 `autoUpdater.setFeedURL({ url })`，启动 30 秒后与每 6 小时检查一次；否则日志 `auto update disabled { reason: not-packaged | no-feed }`。状态 `idle / disabled / checking / available / downloading / downloaded / not-available / error { message }` 经 preload 的 `onUpdateStatus` 推给 renderer；设置 → 关于 显示版本、状态、"检查更新"，已下载时"重启以更新"（`quitAndInstall` 之前走现有的退出确认）。测试构建另读 `COKO_TEST_UPDATE_FEED_URL`；E2E 用本地 feed 服务器断言请求到达、204 → not-available、带更新而签名不合 → error（不崩溃）。采纳。

## 第 3 轮

**B3 清单格式**：
➡️ `<root>/.coko-plugin/plugin.json`，缺失时读 `<root>/.claude-plugin/plugin.json`（兼容 claude-code 插件的子集）。字段：`name`（必填，`[a-z][a-z0-9-]{0,47}`）、`version`（必填，`x.y.z` 可带预发布）、`description?`、`author?`、`engines.coko?`（只支持 `>=x.y.z`，与应用版本比较；不满足为 `incompatible`，不加载）、`skills?` / `commands?` / `agents?`（路径或路径数组，相对插件根，缺省为同名目录）、`hooks?`（路径或内联，缺省 `hooks/hooks.json`，形状与设置中的 Hook 相同）、`mcpServers?`（路径或内联，缺省 `.mcp.json`）、`lspServers?`（路径或内联，缺省 `.lsp.json`）。路径不能逃出插件根（含经符号链接）。字符串中的 `${COKO_PLUGIN_ROOT}`（及 `${CLAUDE_PLUGIN_ROOT}`）替换为插件的安装目录。claude-code 的 `userConfig`、`channels`、`outputStyles`、`settings` 等字段给 `unsupported-field` 诊断并忽略。诊断：`invalid-manifest`、`invalid-name`、`path-outside-plugin`、`unsupported-field`、`incompatible-engine`，以及各资源加载器已有的诊断（带 `source: plugin`）。采纳。

**B4 信任与批准**：
➡️ 安装后为 `needs-approval`，不加载任何资源。批准对话框显示**全部会执行的内容**：每个 Hook 的事件、matcher 与完整命令，每个 MCP / LSP Server 的 command、args、url 与 env 的键，以及 Skills / 命令 / 子代理的名字。digest 覆盖清单与这些可执行声明（规范化后）；批准按 digest 保存，更新使 digest 变化时回到 `needs-approval`（ADR 0008 / 0013 的做法）。批准后：插件的 MCP 与 LSP Server 不再逐个批准；插件 Hook 与全局 Hook 同等对待（其 allow 参与聚合，与允许规则同位，仍越不过判定前四步，ADR 0013）。理由：插件是用户主动安装的用户级资源，批准时已看到完整命令，与用户写进全局设置等效；项目 Hook 只收紧是因为它来自克隆的仓库、不是用户的选择。插件不能声明权限规则、默认模式或能力开关；插件的 MCP Server 不能引用 Secret（与项目 MCP 相同，ADR 0007），需要凭据的由用户在全局 MCP 中配置。采纳。

**C3 消息送达**：
➡️ 目标 Session 收到一条 user message，文本为 `<team-message from="<name|lead>" message-id="…">正文</team-message>`，前一条为 `team_message { messageId, from, to, summary? }` 条目（宿主注入，与 `agent_notification` 同一处理）：
- 目标 running：作为 steering 在当前步骤后送达。
- 目标为 teammate 或已结束的子代理且空闲：以 `trigger: subagent` 开始一个新 Run，输入为该消息（不新增 trigger：runAuthority、定时任务准入与通知类别对 subagent 已是 none / 子 Session）。
- 目标为 lead（根 Session）：与后台子代理通知相同——Run 进行中为追加指令，Goal Round 中照常送达，空闲且没有活动 Goal 时挂起到下一个 Run，不唤醒（M4 Job 通知的规则）。
- 授权：`team_message` 进入 `HOST_NOTIFICATION_KINDS`，`runAuthority` 为 none（不能 create / edit / pause / resume Goal）；Goal 的"用户追加指令"判断不把它算作用户输入；时间线不显示原文包装，显示为 `team_message` 紧凑行。这三处是 M5 复盘第 1 条的固定验收项。
- teammate 的 Run 正常结束（变为空闲）时，lead 收到与后台子代理相同的 `agent_notification`（最后的文本 ≤ 2 KB 时内联）。
- 正文 ≤ 8 000 字符，入库前按值替换登记的 Secret；广播对每个目标各送达一条。
采纳。

**C4 任务板与锁**：
➡️ 任务是根 Session 的条目 `team_task` v1，每次变更提交完整快照 `{ taskId: 't<n>', revision, subject, description, status: pending | in_progress | completed | deleted, owner?: <name> | 'lead', blockedBy, writeScopes, by }`；当前板由条目派生（ADR 0011 的 Goal 做法）。并发控制：同一根 Session 的变更经 `KeyedMutex`，`task_update` 必须带 `expected_revision`，不一致为错误结果 `stale-revision`（带当前快照）——"锁"就是 compare-and-set 加"认领即独占"。认领：`status: in_progress` 且 `owner` 为调用者，要求当前 `pending`、没有 owner（或已是自己）、`blockedBy` 全部 completed，否则 `task-not-claimable`（带原因）。teammate 只能把 owner 设为自己或清空自己的；lead 可以指派任何成员。完成只能由 owner 或 lead；`blockedBy` 引用须存在、未删除且无环。`writeScopes` 是 Workspace 相对路径前缀，只在两个 in_progress 任务重叠时给警告（DSH），不阻止写入、不改变权限判定；不做文件锁：同一 checkout 中需要隔离的用 teammate 的 worktree。至多 100 个非删除任务。见 ADR 0018。采纳。

**D3 LSP 的权限**：
➡️ `lsp` 的 `file_path` 按读取判定（与 read 同一路径规则与可读根：越出 Workspace 询问，受保护路径照常）；结果与 read 一样经秘密脱敏（诊断与悬停文本可能含文件内容）。语言服务器本身会读取整个工作区建立索引，它是用户配置的进程，与全局 MCP stdio Server 同一信任级别，不经 Seatbelt。采纳。

**F3 Provider 与审批（无界面）**：
➡️ 两处与 GUI 不同（[ADR 0019](../../docs/adr/0019-headless-runs-deny-approvals.md)）：
- **审批自动拒绝。** 没有界面可以回答，等待会让进程一直挂起；拒绝的结果文本为 `Denied: no approver in a headless run. Rerun with a wider --permission-mode or add an allow rule.`，记 `approval_decision { by: headless }`，Run 继续（模型看到拒绝，claude-code `-p` 的做法）；`--on-approval fail` 时拒绝后停止 Run 并以 3 退出。PermissionRequest Hook 先于拒绝运行，可以代答。这与 ADR 0014"子代理审批等待、不自动拒绝"不冲突：后者在 GUI 中，总有人可以打开子 Session 回答。
- **Provider 来自启动配置。** `--provider-config <json>`（`ProviderFields` 数组，不含密钥）在启动时以同一事务写入（新建或更新），密钥只读 `COKO_CREDENTIAL_<ID>`。这是 ADR 0010"保存只有一条路径"在无界面运行中的第二条路径：没有 main 就没有 safeStorage，密钥也不入库。
采纳。

**G3 回放**：
➡️ 回放即读导出的条目重建状态：`@coko/agent/testing` 的 `loadExport(ndjson)` 返回条目数组，`modelContext`、`deriveTrace`、`deriveAudit` 等纯函数在其上运行。往返用例：导出 → loadExport → `modelContext` 与 Sidecar 读回的相同。不做"按录制结果重新执行工具"的回放（结果不确定、会重复副作用）；evals 的会话回放用 faux 脚本（已有的无密钥回放机制）。采纳。

**G4 evals**：
➡️ `tests/evals/`：每个用例一个目录 `cases/<name>/`，含 `case.json`（`prompt`、`permissionMode?`、`faux`（脚本）、`expect { files?: { <path>: 内容或 /正则/ }, unchanged?: path[], maxToolCalls?, status? }`）与 `workspace/` 初始文件。运行器复用 `tests/integration/sidecar-harness.ts`（真实 Sidecar），复制 workspace 到临时目录、提交 prompt、等 Run 结束后**按文件结果判定**（能力深度票），写 `tests/evals/reports/<时间>.json`（git 忽略）：每例 pass / fail、原因、tokens、cost、durationMs（来自 trace）。`pnpm run eval` 运行；`COKO_EVAL_PROVIDER_CONFIG` 与凭据存在时同一组用例用真实模型（不用 faux），否则真实模式跳过、报告写 `skipped: no-credentials`。首批 3 个用例：改一个函数并通过检查脚本、修一个失败的测试（bash）、read-only 下拒绝写入（文件不变）。evals 项目加入根 vitest 配置。采纳。

**H3 发布构建 E2E**：
➡️ 发布构建（不带 `COKO_TEST_BUILD`）打到 `out-release/`（`COKO_FORGE_OUT_DIR`），新 Vitest 项目 `desktop-release`（`apps/desktop/vitest.release.config.ts`，globalSetup 打发布构建并 `make`），**只在 `COKO_RELEASE_E2E=1` 时选中用例**（未设置时 include 为空，`pnpm run test` 不多打一次包）：发布构建忽略 `COKO_E2E_BACKGROUND`，窗口会出现，默认全量不能接受（M3 复盘第 5 条）。以 `open -g -n` 启动（不激活），经 CDP 连接。断言：设了 `COKO_FAUX_SCRIPT` 仍无可用模型、日志 `test hooks ignored in a packaged build`、`POST /api/test/clock` 为 404、随包 ripgrep 与 node-pty 被加载、`auto update disabled { reason: no-feed }`；`out-release/make/` 中有 `.zip` 与 `.dmg`，`hdiutil attach -readonly -nobrowse` 挂载后 `Coko.app` 存在、`codesign --verify` 的结果写进报告（adhoc，不断言 Developer ID），卸载。lead 在合入 10 与票 14 各跑一次，结果写进 Comments。采纳。

## 第 4 轮

**B5 命名空间**：
➡️ 插件资源不覆盖用户与项目资源：命令与 Skill 的调用名为 `<plugin>:<name>`（claude-code）；子代理类型为 `<plugin>:<name>`；MCP Server 名为 `plugin-<plugin>-<server>`（工具名经现有 `mcp__<server>__<tool>` 规则）；LSP Server 名为 `<plugin>:<server>`；Hook 的来源为 `plugin`、hookId 带插件名。采纳。

**B6 生命周期与界面**：
➡️ `GET /api/plugins` → `[{ name, version, description?, source { kind: dir | git, location, ref?, commit? }, status: needs-approval | enabled | disabled | incompatible | invalid, digest, approvedDigest?, contributions, executables, diagnostics }]`；`POST /api/plugins { source }` → 201（`plugin-exists` 409、`plugin-invalid` 400 带诊断、`plugin-source-unreachable` 400）；`POST /api/plugins/:name/approve { digest }`（`digest-mismatch` 409）；`PATCH /api/plugins/:name { enabled }`；`POST /api/plugins/:name/update`（重新取来源，digest 变化时回到 needs-approval）；`DELETE /api/plugins/:name`（停止其 MCP / LSP 进程，删除前确认真实路径在 plugins 根下，删除目录与记录）。启用 / 禁用 / 批准 / 卸载在下一个 Run 生效（与其他文件资源一样每个 Run 读快照），MCP / LSP 进程按 reconcile 启停。`plugins.enabled: false` 时全部不加载。不做自动更新与市场。界面（票 12）：设置 → 插件分区（DSH ui-settings 的列表样式）：安装（目录选择或 git URL）、列表（名字、版本、来源、状态、贡献计数、诊断）、批准对话框（完整命令）、启用开关、更新、卸载（确认框）。采纳。

**C5 Hook 事件**：
➡️ 沿用 claude-code 的三个事件与输入字段。公共字段之外：TaskCreated / TaskCompleted 为 `task_id`、`task_subject`、`task_description`、`teammate_name`、`team_name`（根 Session id）；TeammateIdle 为 `teammate_name`、`team_name`。语义：TaskCreated exit 2（或 `decision: block`）→ `task_create` 为错误结果、不提交条目，stderr 给模型；TaskCompleted exit 2 → 不能完成、任务保持 in_progress，stderr 给模型；TeammateIdle exit 2 → stderr 作为 user message 送达该 teammate、Run 继续（与 SubagentStop 共用每 Run 至多 3 次的继续上限，SubagentStop 先运行）。没有 matcher（claude-code 同）。项目 Hook 照常只收紧。记录为 `hook_run`。采纳。

**C6 worktree**：
➡️ `agent { name, isolation: 'worktree' }` 为 teammate 创建 worktree（ADR 0016 的 `createForSubagent`，同一权限类规则：plan / read-only 拒绝，其余非 full-access 询问）；不带 isolation 时继承父级的工作目录（M5 评审修复 H3）。worktree 在 teammate 存在期间保留（它还会收到消息）；解散时 `removeIfUnchanged`，有改动则保留并在 `agent_end.worktree` 写明。父 Session 读写它须审批（J4 的规则同样适用）。采纳。

**C7 预算、并发与重启**：
➡️ teammate 与子代理共用"每个根 Session 至多 4 个 running"的上限：超出时消息送达排队（挂起，有空位时开始 Run），不是错误。预算：teammate 的每个 Run 计入**触发它的根 Run 所属的 Goal**（派发与消息都记录触发它的根 runId），即 ADR 0014 的同一口径；没有 Goal 的根 Run 触发的不计入任何 Goal。重启：teammate 子 Session 按现有中断恢复；空闲的 teammate 重启后仍在名册中、可以接收消息（名册由 `agent_start` v2 / `agent_end` 派生）；排队的消息不跨进程保留（与 Job 通知相同），lead 在名册中看到 teammate 的状态。采纳。

**C8 子代理继续对话**：
➡️ `send_message { to: <agentId> }` 发给已结束（completed / max-turns / failed）的一次性子代理：在其子 Session 开始新 Run（同 C3），结束时父级收到 `agent_notification`（后台语义）。cancelled、interrupted 与 dismissed 的不能继续（错误结果）。不提供 DSH 的"带历史分叉的子代理"。采纳。

**C9 团队界面**：
➡️ 沿用 DSH `client-ui-agent-team` 的信息结构：标题栏"团队"按钮（running 成员数）；右栏 Team tab：名册（名字、状态点、当前活动、用量、worktree chip）、任务板（按 pending / in_progress / completed 分组，显示 owner、阻塞关系与"可认领"、writeScopes 重叠警告）、选中成员的只读时间线（复用 Agents tab 的 TimelineView）；时间线中 `team_message` 与 `team_task` 为紧凑行（发送方 → 接收方与 summary；任务变更）；`send_message`、`task_*` 的工具卡。用户不能直接给 teammate 发消息（子 Session 的 409 `child-session` 不变），经 lead 转达。采纳。

**D4 LSP 进程**：
➡️ 每个（服务器名，Session 工作目录）一个进程，首次查询时启动（`initialize` 的 rootUri 为工作目录），10 分钟无查询关闭；同时至多 4 个，超过时关闭最久未用的。登记 `host_processes.kind = 'lsp'`；关闭为 `shutdown` → `exit` → 2 秒后 SIGTERM → 2 秒后 SIGKILL；崩溃后下一次查询重启，连续 3 次失败后为 `failed`，需在设置中手动重启。启动超时缺省 10 秒（`startupTimeout` 覆盖）。环境与 MCP stdio 相同（剔除 `HOST_ENV_EXCLUSIONS`，不注入 Secret）。stderr 尾部 4 KB 脱敏后作为诊断。采纳。

**D5 LSP 界面**：
➡️ 设置 → 代码智能（`lsp` 分区）：能力开关、全局与当前 Workspace 的服务器 JSON 编辑（Hooks 分区的编辑器样式：保存前校验、revision 冲突时读回）、已配置服务器列表（来源 global / workspace / plugin、扩展名、状态 idle / starting / running / failed、stderr 诊断、"重启"）。`lsp` 工具卡显示操作、文件与位置、结果计数。采纳。

**E3 MCP 401**：
➡️ HTTP MCP Server 的连接或请求收到 401（经 pi-mcp 的 `AuthProvider.onUnauthorized`，或连接错误的状态码）时，状态为新的 `auth-required`（不是 failed），不自动重连；诊断写明"检查请求头中的凭据（可引用登记的 Secret）"；设置中显示"需要认证"徽标与"编辑请求头"入口，修改配置或手动重连后重试。不做 OAuth（没有回调入口与令牌存储的设计，记为非目标）。采纳。

**F4 协议文档**：
➡️ 新建 `packages/protocol/README.md`（reference）：传输（HTTP `/api`、WebSocket 订阅与 afterSeq 补发、控制通道消息）、认证（standalone 时 stdout 的 `ready.token` 经 `POST /api/auth/exchange` 换 cookie，外部客户端如何满足 Host / Origin 围栏）、各领域文件的路由与事件索引、错误码表、版本兼容（条目 kind 与 schema 版本）。机械检查 `packages/protocol/src/readme.test.ts`：`API_ROUTES` 的每个键与 `ProgressEvent` 的每个 type 都出现在 README 中。外部客户端示例用例 `tests/integration/sdk-standalone-client.test.ts`（只用 `@coko/protocol` 与 `ws`：启动 standalone Sidecar、交换令牌、建 Session、订阅、提交、读回）。采纳。

**G5 追踪界面**：
➡️ 右栏 Trace tab：每个 Run 一行（触发、状态、时长、Tokens、费用），展开为模型请求（模型、ttft、时长、Tokens、费用、重试）与工具（名字、时长、审批等待、Hook 结果）；顶部为 Session 合计与"导出"（下载 `.ndjson`）。数据来自 `GET …/trace`，`model_request` / `run_end` 到达时重读（同一帧合并，M5 B11 的做法）。不做图表（YAGNI）。采纳。

## 第 5 轮（交付）

**L1 复盘规则写进 implementer-brief**：
➡️ 复制 M5 brief 改为 m6，新增"M5 复盘已采纳"一节：
- **宿主注入的消息种类**：新增宿主注入消息种类的票（M6：`team_message`、teammate 空闲时的 `agent_notification`、TeammateIdle 的反馈、headless 的拒绝文本），验收固定覆盖 runAuthority（不授予用户权限）、Goal 的用户输入判断（不算用户追加指令）与时间线（不显示原文包装）三处。
- **跨进程至少一条接收侧用例**：M6 的跨进程功能（自动更新 main → renderer、插件的 MCP / LSP 进程、LSP JSON-RPC、headless 的 stdout、发布构建）至少一条在接收侧观察结果。
- **可并行票的接口在开票时定死**：条目形状与共享常量写在规格"跨票接口"表中，并复制进相关的两张票。
- 沿用：对手用例、每完成一项就提交、只在 worktree 中写文件、全量测试锁（脚本中 `echo $$`；本次 brief 以文件写入工具直接写出，不经字符串替换，避免 M5 的 `$$` → `$` 失误）、Browser Mode 项目级 testTimeout 20 秒、不给单个用例加长超时（先确认失败签名同类再按配置处理）。
- **真实凭据**：规格的"人工验证清单"列出需要真实凭据或非 darwin 平台的验收；票中对应项用 `skipIf` 并在 Comments 写"未验证（需真实凭据）"，不因此 BLOCKED。
采纳。

**L2 切片与写范围**：
➡️ 14 张票：
- 01 运行时遗留、02 界面遗留（并行，接口见 A1）→ 03 M6 基础（串行，阻塞其余）。
- {04 插件核心, 05 代码智能（LSP 与设置分区）, 06 Agent Teams 核心, 07 观测与 evals（含 Trace tab）, 08 SDK 与无界面运行, 09 MCP 认证状态与浏览器预设, 10 安装包、自动更新与发布构建 E2E, 11 Memory 检索} 写范围两两不重叠，可同时进行（lead 按负载每次派发 3–4 张）。
- 12 插件界面（04 之后）、13 团队界面（06 之后）。
- 14 交付收尾（全部之后）：README 汇总、能力覆盖表证据、发布构建 E2E 复跑、人工验证清单。
共享装配点（`layers.ts`、`session-runs.ts`、`context/{index,types}.ts`、`config/schema.ts`、条目、协议入口、迁移、注册表、`build.ts` 的入口列表）由 03 一次建好，之后只有规格表中指定的票改；layers.ts 由 03 放好每个领域的装配块（注释界定），04–11 只改自己的块。采纳。

**L3 测试接口**：
➡️ 沿用 M5：Sidecar 协议集成测试为主（真实 Sidecar、临时 `COKO_HOME`、带 `match` 的 faux 脚本、git 夹具）；agent 层纯函数表驱动（清单解析与 digest、任务板状态机与 CAS、LSP 帧编解码与位置换算、trace / audit 派生）；Electron E2E 覆盖插件安装与批准、Team tab、代码智能分区、浏览器预设、Trace tab、关于页的更新状态；产物 smoke 增加打包应用中的插件安装与 LSP 假服务器、打包产物中的 headless；发布构建 E2E 见 H3。采纳。

**L4 ADR 与术语**：
➡️ 满足三条标准的三个：[0017](../../docs/adr/0017-plugins-declarative-user-installed.md)（插件只声明、用户级复制安装、按可执行声明的 digest 批准、批准后与全局同级）、[0018](../../docs/adr/0018-agent-teams-in-root-session.md)（teammate 是根 Session 中具名可继续的子 Session，任务板为根 Session 条目 + CAS，认领即锁、不做文件锁，消息为宿主注入且没有用户权限）、[0019](../../docs/adr/0019-headless-runs-deny-approvals.md)（无界面运行的审批自动拒绝、Provider 来自启动配置）。不写 ADR：LSP（与 MCP stdio 同一信任模型，可逆）、Playwright MCP 预设、`model_request` 条目、evals 目录、构建期 feed（可逆或属选型）、Memory FTS（ADR 0003 已决定）。0010、0014 各加一行指向 0019 / 0018（实施票补）；0003 的 v9 由 03 补记；0016 加 teammate 复用的一行（06）。新增术语 Plugin、Agent Team、Teammate、Team Task、Headless Run、Eval Case，更新 Run、Subagent、Todo List 的定义，已写入 [GLOSSARY](../../GLOSSARY.md)。采纳。

**L5 人工验证清单**：
➡️ 写进规格"人工验证清单（交付前）"：真实模型（任一 Provider 的凭据）跑一次 teammate 协作、一次 LSP 诊断修复、一次浏览器 MCP 截图、一次 headless、一轮 evals 真实模式；真实语言服务器（typescript-language-server）；真实 Playwright MCP（需网络与 npx）；真实 HTTP MCP 的 401；Developer ID 签名的更新链路（需证书，不在本地图）；非 darwin 平台（不在首发范围）。每项写明前置条件与预期观察。采纳。

**L6 地图建议**（地图不在本次写范围，由 lead 合并）：
- Carry-overs 中标 M6 的各项标为"→ 已分配 M6 票 01 / 02 / 03 / 06 / 09 / 10"或"→ 写入 M6 implementer-brief"（对应关系见 [spec.md](spec.md) 的"Carry-overs 去向"）。
- M6 交付后行状态改为 delivered；Destination 的"按能力表实现全部能力"以 [capability-coverage.md](capability-coverage.md) 为证据。
- Out of scope 增加一条："插件市场与 npm 来源、OAuth 型 MCP 认证、用户直接给 teammate 发消息、带历史分叉的子代理（M6 规划裁决）。"

frontier 已空。
