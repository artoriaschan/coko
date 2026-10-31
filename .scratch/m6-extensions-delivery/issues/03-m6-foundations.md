# 03: M6 基础：条目与协议、迁移 v9、宿主输入、插件消费 seam、权限类与配置、服务存根与 layers.ts 领域块、UI 占位与测试 harness

**What to build:** 为 04–13 建立扩展点，自身只交付"逐请求记录"一项行为（`model_request` 由运行时提交），见 [规格](../spec.md)"Session Entry 与事件""迁移 v9""运行时与装配 seam""权限类""跨票接口""共享装配点与所有者"：(1) 全部 M6 条目 kind、版本迁移与 progress 事件；(2) 迁移 v9：`plugins`、`memories_fts` 与 `search`、`host_processes.kind` 加 `lsp`；(3) 运行时提交 `model_request`；(4) 宿主输入 `team_message` 的标签、常量与 runAuthority / hasUserSteering / 时间线三处；(5) 插件消费 seam `PluginContributionsPort` 接入 Skills、命令、子代理定义、Hook、MCP 的加载；(6) Hook 新事件名的校验；(7) 权限类 `lsp`、`team`，配置键 `plugins.enabled` / `lsp.enabled` / `teams.enabled`；(8) server 服务存根、空贡献、空 router、`lsp-client` 存根、headless 入口存根，`layers.ts` 的领域块与关闭顺序；(9) 协议新领域文件、错误码与 `API_ROUTES`；(10) desktop：update 桥与 main 存根、注册表占位、时间线分发与空组件、`build.ts` 的 headless 入口与 feed 定义、发布构建 E2E 骨架；(11) i18n 五个分域；(12) harness：插件与 LSP 夹具、辅助函数、`sidecar-m6-seams.test.ts`。

**User stories:** 为 1–19 建立扩展点；15（逐请求记录）

**Blocked by:** 01, 02

**Status:** ready-for-review

**Write scope:** 规格"只有 03 改"中的全部文件；另 `apps/server/src/runtime/layers.ts`（建领域块）、`packages/agent/src/{extensions/plugins,tools/lsp,agents/teams,observability}/`（新，类型与空 barrel）、`packages/agent/src/{instructions/skills,instructions/commands}/`、`agents/definitions.ts`、`extensions/hooks/config.ts`、`extensions/mcp/config.ts`（插件根与插件 Server 的接入）、`packages/protocol/src/{plugins,lsp,teams,trace}.ts`（新）与 `mcp.ts`（`auth-required`）、`apps/server/src/application/{plugins,lsp,teams,trace}.ts`（新，存根）、`application/hooks.ts`（插件 Hook 并入与新事件校验）、`application/subagents.ts`（`agent_start` v2 字段的写入点保持为空值）、`application/context/{skills,commands,subagents,hooks,mcp,lsp（新）,teams（新）}.ts`、`http/routes/{plugins,lsp,teams,trace}.ts`（新）、`adapters/{lsp-client,plugin-test-port}.ts`（新）、`apps/server/src/headless/index.ts`（新，存根）、`apps/desktop/src/main/update-coordinator.ts`（新，存根）、`apps/desktop/build/build.ts`、`apps/desktop/{vitest.release.config.ts,e2e-release/global-setup.ts}`（新，骨架）、renderer `features/settings/sections.ts`、`features/right-panel/{tabs.ts,team-tab.tsx,trace-tab.tsx}`（后两个新，空组件）、`features/conversation/{header-actions.ts,team-button.tsx,team-task-row.tsx,team-message-row.tsx}`（后三个新，空组件）、`packages/i18n/src/dictionaries/domains/{plugins,lsp,teams,trace,update}.ts`（新）、`tests/integration/sidecar-m6-seams.test.ts`（新）、`tests/fixtures/{plugins,lsp}/`（新）、`docs/subsystems/{permissions,configuration,recovery,hooks,mcp}.md`（新权限类、配置键、迁移版本、插件来源一句、auth-required 值）、`docs/adr/{0003,0012}*.md`、`docs/tech-stack/architecture.md`、`packages/{session,agent}/README.md`、`apps/server/README.md`

**跨票接口（本票定义，04–13 使用，原文见规格"跨票接口"）：** `PluginContributionsSnapshot { skillRoots, commandRoots, agentRoots, hooks, mcpServers, lspServers }` 与 `PluginContributionsPort { snapshot(), onChange(listener) }`；`TEAM_MESSAGE_TAG = '<team-message'`、`teamMessageText({ from, messageId, body })`、`HOST_NOTIFICATION_KINDS` 含 `team_message`；`team_task` / `team_message` / `TeamSnapshot`；`model_request`；`approval_decision.by: 'headless'`；`LspServerStatus`；`UpdateStatus` 与 bridge 的 `onUpdateStatus` / `checkForUpdates` / `installUpdate`；layers.ts 的领域块（plugins 04、lsp 05、teams 06、trace 07、headless 08、mcp 09、memory 11）。

- [x] 01、02 合入后的全部测试只改 kind 列表、schema 版本或导入路径即通过（逐条写进 Comments；断言精确条目序列的用例改为显式处理 `model_request`）
- [x] 条目：protocol 与 agent 新 kind 编译期比对（`entry-payloads.ts` 的 `Assert<Equal>`）；`agent_start` v1 → v2、`agent_end` v1 → v2、`approval_decision` v2 → v3、`hook_run` v1 → v2 读回；renderer 收到新 kind 不报错、不渲染；`forkEntries` 与 Handoff 不复制新 kind（表驱动）
- [x] **model_request**：faux 的一次两轮 Run 产生两条 `model_request`（顺序在对应 assistant 之后，`durationMs` > 0、usage 与 assistant 一致、`purpose: turn`）；faux 返回错误与重试时有 `errorCode` 与 `retries`；手动压缩的摘要请求 `purpose: compaction`；日志有 `model request finished`；Goal 预算的用量不变（与 01 之后同一用例相等）
- [x] 迁移 v9：v8 库升级到 9（`.backup-v8-*` 0600、STRICT、原数据与 host_processes 行可读、`lsp` 可登记）；`plugins` 仓库与 `memories.search` 契约测试在 SQLite 与内存上通过；FTS 触发器在更新与删除后同步；`COKO_TEST_NO_FTS=1` 时 search 走 LIKE
- [x] **宿主输入（三处）**：`runAuthority` 表驱动加"Goal Round 中送达 team_message → goal-round、submit 中 → 仍按 submit 的前一条判断"两行（先红）；`hasUserSteering` 对 `<team-message` 退回文本为 false（先红）；renderer timeline 测试：`team_message` 之后的 `<team-message` 块不成气泡，用户自己输入的同样文本照常显示（对手用例）
- [x] **插件 seam**（`COKO_TEST_PLUGINS=<tests/fixtures/plugins/sample>`）：`sample:` 前缀的 Skill 在 `<available_skills>` 中、`/sample:hello` 命令展开、`sample:reviewer` 子代理可派发、插件 PreToolUse Hook 运行（夹具记录 stdin，`hook_run.source: plugin`）、插件 MCP Server `plugin-sample-echo` 启动且无需项目批准；未设该变量时上述都不存在；插件 MCP 引用 `${X}` 时不加载且有诊断
- [x] 判定：`decide.test.ts` 的 `lsp` 类按路径读取（Workspace 外询问、受保护路径照常）、`team` 类在五种模式放行、`Team` 拒绝规则生效
- [x] 配置：项目文件中的 `plugins.enabled` 与 `lsp` 键为 `project-cannot-grant`；`lsp.enabled: false` / `teams.enabled: false` 在项目中生效；Hook 配置中的 `TaskCreated` 等不再报 `unknown-event`，写 matcher 为 `invalid-matcher`
- [x] `sidecar-m6-seams.test.ts`：空贡献时 faux requestLog 与 02 之后相同（除新增的 `model_request` 条目外，模型请求不变）；新路由返回空结果或 501 占位；headless 存根以 4 退出；关闭顺序（定时器 → Run → Job → 贡献 → LSP → 登记进程 → 存储）由钩子调用顺序断言
- [x] harness 自测：LSP 假服务器按参数回答四种请求并记录请求；插件夹具通过清单校验（04 的解析器尚不存在时只校验 JSON 形状）
- [x] desktop：bridge 的键列表增加三个 update 方法（不暴露令牌）；update 存根状态为 disabled；注册表占位不显示（Browser Mode）；`build.ts` 产物中有 `dist/sidecar/headless.mjs`；`COKO_RELEASE_E2E` 未设置时 `desktop-release` 项目选中 0 个文件且不打包
- [x] i18n：新域 zh / en 键集合相同
- [x] 文档：permissions.md 两个权限类、configuration.md 三个开关与 lsp 键、recovery.md 版本 9、hooks.md 插件来源与三个事件名（"分发由 Agent Teams 接入"）、mcp.md 的 `auth-required` 值（"由 MCP 认证状态接入"）、ADR 0003 记 v9、ADR 0012 记 lsp 类别、architecture.md 与 README 同步；`check:docs` 通过

## Comments

### 实施者回执（m6/03-m6-foundations）

**覆盖的验收**（全部勾选；证据文件）：
- 01、02 之后的测试只改 kind 列表、版本或导入即通过。逐条改动：精确条目序列的断言显式加入 `model_request`（agent：`session-entries.test.ts`、`engine/{runtime,run-control,host-stop,context-seam,compaction,m5-seams}.test.ts`、`policy/{approvals,gate-hooks}.test.ts`、`tools/scheduler.test.ts`；integration：`sidecar-{run-control,recovery,rewind,commands,references,mcp-resources-prompts,approvals,handoff,todo,compaction}.test.ts`，其中压缩、交接与溢出用例按位置另断言 `purpose`，几处下标随之移位）；approval_decision 版本数 2 → 3；`defaultCapabilityConfig` / config-store 测试加三个开关；`migrate-v8.test.ts` 的版本断言改为 ≥ 8；`sidecar-m5-seams.test.ts` 关闭顺序加 `lsp`；`sidecar-m4-seams` 只看相对顺序不变；`subagents-dispatch.test.ts` 与三个 context 单测的 scope 字面量加 `plugins`；desktop E2E 的 bridge 键列表加三个 update 方法；dock 注册表断言加占位行。
- 条目与迁移：`session-entries.test.ts`（M6 kind、v1→v2 / v2→v3 原样迁移、越界值）；`entry-payloads.ts` 的 `Assert<Equal>` 编译期比对；`timeline.test.ts`（新 kind 不渲染、team_message 位置判断）；`fork.test.ts` / `handoff.test.ts` 表驱动加三种新 kind。
- model_request：`runtime.test.ts`（两轮两条、usage 与 assistant 一致、durationMs > 0、retries / errorCode）、`compaction.test.ts`（purpose compaction）、`m5-seams.test.ts`（purpose summary）、`sidecar-m6-seams.test.ts`（Sidecar 上两条与日志 `model request finished`）。Goal 预算的用量不变：`goals/` 与 `sidecar-goal*.test.ts` 未改断言、照常通过（派生不读 model_request）。
- 迁移 v9：`migrate-v9.test.ts`（v8 → 9、`.backup-v8-*` 0600、STRICT、登记行可读、lsp 可登记、FTS 触发器在更新与删除后同步、`fts: false` 走 LIKE 且通配符按字面）；`repository-contract.ts` 的 plugins 与 search 用例在 SQLite 与内存上通过。
- 宿主输入三处：`goals.test.ts` runAuthority 三行、`goal-driver.test.ts` hasUserSteering 一行、`timeline.test.ts` 两例（含对手用例），均先红后绿；`entries/host-input.test.ts`（teamMessageText 转义）。
- 插件 seam：`sidecar-m6-seams.test.ts` 的三例（接入、未设置时不存在、`${NAME}` 不加载）；agent 侧 `hooks.test.ts`（plugin 来源、团队事件、matcher 为 invalid-matcher）。
- 判定：`decide.test.ts` 的 M6 块（lsp 与 read 逐模式一致、Read 规则对 lsp 生效、team 五模式放行与 Team 拒绝、teammate 同 agent）。
- 配置：`merge.ts` 对项目文件 `plugins` 与 `lsp` 的非 enabled 键报 `project-cannot-grant`；`lsp.enabled` / `teams.enabled` 的 false 生效（与其他开关同一合并路径，`shared.test.ts` 默认值）。
- desktop：bridge 三方法（preload 只交出状态对象）、`update-coordinator.ts` 恒为 `disabled { reason: not-packaged }`（shell E2E 在 renderer 接收侧断言）；注册表占位（`sections.browser.test.tsx` 新例）；`build.ts` 的 sidecar 入口加 headless（shell E2E 断言 `dist/sidecar/headless.mjs` 存在并以 4 退出）；`desktop-release` 未设 `COKO_RELEASE_E2E` 时选中 0 个文件、不装 globalSetup。
- i18n：五个分域，`domains.test.ts` 键集合相同（另加登记断言）。
- 文档：permissions.md、configuration.md、recovery.md（版本 9）、hooks.md（插件来源、三个事件名与 v2）、mcp.md（插件来源、`auth-required`）、ADR 0003（v9）、ADR 0012（lsp）、architecture.md、agent / server / session README；`pnpm run check:docs` 0 个问题。

**实际运行的命令与结果**：见完成报告（typecheck / lint / format:check / check:docs 逐项退出码 0；取锁的全量 `pnpm run test`）。

**负向确认**：宿主输入四条用例先红；engine 的 model_request 断言先红（实现前缺 3 条）；`sidecar-m6-seams` 的"未设置时不存在"与"引用 Secret 不加载"是对照用例。

**偏离与越界（请 Lead 裁决）**：
- `layers.ts` 的领域块注释写作 `// ── <domain> ──` … `// ── end <domain> ──`，没有写票号：规格的 `（票 NN）` 会使 `scripts/source-references.test.ts` 失败（源码不得引用票号）。块与票的对应以规格"共享装配点"为准。
- 越出 Write scope 的最小改动：`apps/server/src/config.ts`（`COKO_TEST_NO_FTS`、`COKO_TEST_PLUGINS` 两个测试钩子）；`apps/server/src/application/errors.ts` 的状态码表与 `session-runs.ts` 的 `model request finished` 日志（session-runs 在"只有 03 改"中）；`packages/agent/src/{config/merge.ts,instructions/shared/diagnostics.ts,extensions/mcp/index.ts,policy/gate.ts}`（gate 只给 lsp 类解析目标）；i18n `domains/{agents,hooks,mcp}.ts` 各加一个新字面量的文案（`dismissed`、`plugin`、`auth-required`），renderer `agent-card.tsx`、`agents-button.tsx`、`mcp-section.tsx` 的 Record 各加一项（新字面量使穷尽表编译失败）；`apps/desktop/src/main/index.ts`（update IPC）；desktop E2E `desktop-shell.e2e.test.ts`；`sections.browser.test.tsx`、`dock.browser.test.tsx`、`config-store.test.ts`；protocol `config.ts`、`permissions.ts`、`agents.ts`、`hooks.ts`、`api.ts`（共享装配点或新字面量所在文件）。
- `ResourceDiagnostic.source` 增加 `plugin` 与 `lsp`（protocol 与 agent 同步）。插件的 Skill / 子代理定义保持 `scope` / `source` 为 `user`、只加 `<plugin>:<name>` 前缀，避免改 `SkillInfo` 与 `subagent_origin` 的 schema。
- `memories` 只有正文列：`memories_fts` 只索引 content（规格写"正文与标题"）。分词用 trigram（中文可检索）；词短于 3 个字符时走 LIKE。
- `PluginContributionsPort.snapshot()` 返回 Promise（提供方要读库）；形状与规格的字段相同。`ErrorCode` 增加 `not-implemented`（501，供新路由占位）。

**未验证**：真实语言服务器、真实插件安装与 Playwright MCP 不在本票；发布构建 E2E 只有骨架（`COKO_RELEASE_E2E=1` 时 globalSetup 明确报"make 未接入"），由票 10 实现。

**新的读取根 / 注入点**：本票只建 seam。插件目录作为读取根（Skill 的 baseDir 进入 readRoots）与插件资源、插件 Hook stdin 的符号链接越界用例与 `secrets-gate-plugins.test.ts` 属于票 04；seam 已对 Skill / 子代理定义在插件根外的真实路径给 `path-outside-plugin` 并不加载。`model_request` 只含数字与模型名，不新增秘密通道（payload 经 toNewEntry 的 redactSecretsDeep）。

**给 Lead 的合并事项**：`docs/README.md` 当前行为导航没有改动；TECH_STACK 未改。
