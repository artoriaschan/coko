# 03: M6 基础：条目与协议、迁移 v9、宿主输入、插件消费 seam、权限类与配置、服务存根与 layers.ts 领域块、UI 占位与测试 harness

**What to build:** 为 04–13 建立扩展点，自身只交付"逐请求记录"一项行为（`model_request` 由运行时提交），见 [规格](../spec.md)"Session Entry 与事件""迁移 v9""运行时与装配 seam""权限类""跨票接口""共享装配点与所有者"：(1) 全部 M6 条目 kind、版本迁移与 progress 事件；(2) 迁移 v9：`plugins`、`memories_fts` 与 `search`、`host_processes.kind` 加 `lsp`；(3) 运行时提交 `model_request`；(4) 宿主输入 `team_message` 的标签、常量与 runAuthority / hasUserSteering / 时间线三处；(5) 插件消费 seam `PluginContributionsPort` 接入 Skills、命令、子代理定义、Hook、MCP 的加载；(6) Hook 新事件名的校验；(7) 权限类 `lsp`、`team`，配置键 `plugins.enabled` / `lsp.enabled` / `teams.enabled`；(8) server 服务存根、空贡献、空 router、`lsp-client` 存根、headless 入口存根，`layers.ts` 的领域块与关闭顺序；(9) 协议新领域文件、错误码与 `API_ROUTES`；(10) desktop：update 桥与 main 存根、注册表占位、时间线分发与空组件、`build.ts` 的 headless 入口与 feed 定义、发布构建 E2E 骨架；(11) i18n 五个分域；(12) harness：插件与 LSP 夹具、辅助函数、`sidecar-m6-seams.test.ts`。

**User stories:** 为 1–19 建立扩展点；15（逐请求记录）

**Blocked by:** 01, 02

**Status:** ready-for-agent

**Write scope:** 规格"只有 03 改"中的全部文件；另 `apps/server/src/runtime/layers.ts`（建领域块）、`packages/agent/src/{extensions/plugins,tools/lsp,agents/teams,observability}/`（新，类型与空 barrel）、`packages/agent/src/{instructions/skills,instructions/commands}/`、`agents/definitions.ts`、`extensions/hooks/config.ts`、`extensions/mcp/config.ts`（插件根与插件 Server 的接入）、`packages/protocol/src/{plugins,lsp,teams,trace}.ts`（新）与 `mcp.ts`（`auth-required`）、`apps/server/src/application/{plugins,lsp,teams,trace}.ts`（新，存根）、`application/hooks.ts`（插件 Hook 并入与新事件校验）、`application/subagents.ts`（`agent_start` v2 字段的写入点保持为空值）、`application/context/{skills,commands,subagents,hooks,mcp,lsp（新）,teams（新）}.ts`、`http/routes/{plugins,lsp,teams,trace}.ts`（新）、`adapters/{lsp-client,plugin-test-port}.ts`（新）、`apps/server/src/headless/index.ts`（新，存根）、`apps/desktop/src/main/update-coordinator.ts`（新，存根）、`apps/desktop/build/build.ts`、`apps/desktop/{vitest.release.config.ts,e2e-release/global-setup.ts}`（新，骨架）、renderer `features/settings/sections.ts`、`features/right-panel/{tabs.ts,team-tab.tsx,trace-tab.tsx}`（后两个新，空组件）、`features/conversation/{header-actions.ts,team-button.tsx,team-task-row.tsx,team-message-row.tsx}`（后三个新，空组件）、`packages/i18n/src/dictionaries/domains/{plugins,lsp,teams,trace,update}.ts`（新）、`tests/integration/sidecar-m6-seams.test.ts`（新）、`tests/fixtures/{plugins,lsp}/`（新）、`docs/subsystems/{permissions,configuration,recovery,hooks,mcp}.md`（新权限类、配置键、迁移版本、插件来源一句、auth-required 值）、`docs/adr/{0003,0012}*.md`、`docs/tech-stack/architecture.md`、`packages/{session,agent}/README.md`、`apps/server/README.md`

**跨票接口（本票定义，04–13 使用，原文见规格"跨票接口"）：** `PluginContributionsSnapshot { skillRoots, commandRoots, agentRoots, hooks, mcpServers, lspServers }` 与 `PluginContributionsPort { snapshot(), onChange(listener) }`；`TEAM_MESSAGE_TAG = '<team-message'`、`teamMessageText({ from, messageId, body })`、`HOST_NOTIFICATION_KINDS` 含 `team_message`；`team_task` / `team_message` / `TeamSnapshot`；`model_request`；`approval_decision.by: 'headless'`；`LspServerStatus`；`UpdateStatus` 与 bridge 的 `onUpdateStatus` / `checkForUpdates` / `installUpdate`；layers.ts 的领域块（plugins 04、lsp 05、teams 06、trace 07、headless 08、mcp 09、memory 11）。

- [ ] 01、02 合入后的全部测试只改 kind 列表、schema 版本或导入路径即通过（逐条写进 Comments；断言精确条目序列的用例改为显式处理 `model_request`）
- [ ] 条目：protocol 与 agent 新 kind 编译期比对（`entry-payloads.ts` 的 `Assert<Equal>`）；`agent_start` v1 → v2、`agent_end` v1 → v2、`approval_decision` v2 → v3、`hook_run` v1 → v2 读回；renderer 收到新 kind 不报错、不渲染；`forkEntries` 与 Handoff 不复制新 kind（表驱动）
- [ ] **model_request**：faux 的一次两轮 Run 产生两条 `model_request`（顺序在对应 assistant 之后，`durationMs` > 0、usage 与 assistant 一致、`purpose: turn`）；faux 返回错误与重试时有 `errorCode` 与 `retries`；手动压缩的摘要请求 `purpose: compaction`；日志有 `model request finished`；Goal 预算的用量不变（与 01 之后同一用例相等）
- [ ] 迁移 v9：v8 库升级到 9（`.backup-v8-*` 0600、STRICT、原数据与 host_processes 行可读、`lsp` 可登记）；`plugins` 仓库与 `memories.search` 契约测试在 SQLite 与内存上通过；FTS 触发器在更新与删除后同步；`COKO_TEST_NO_FTS=1` 时 search 走 LIKE
- [ ] **宿主输入（三处）**：`runAuthority` 表驱动加"Goal Round 中送达 team_message → goal-round、submit 中 → 仍按 submit 的前一条判断"两行（先红）；`hasUserSteering` 对 `<team-message` 退回文本为 false（先红）；renderer timeline 测试：`team_message` 之后的 `<team-message` 块不成气泡，用户自己输入的同样文本照常显示（对手用例）
- [ ] **插件 seam**（`COKO_TEST_PLUGINS=<tests/fixtures/plugins/sample>`）：`sample:` 前缀的 Skill 在 `<available_skills>` 中、`/sample:hello` 命令展开、`sample:reviewer` 子代理可派发、插件 PreToolUse Hook 运行（夹具记录 stdin，`hook_run.source: plugin`）、插件 MCP Server `plugin-sample-echo` 启动且无需项目批准；未设该变量时上述都不存在；插件 MCP 引用 `${X}` 时不加载且有诊断
- [ ] 判定：`decide.test.ts` 的 `lsp` 类按路径读取（Workspace 外询问、受保护路径照常）、`team` 类在五种模式放行、`Team` 拒绝规则生效
- [ ] 配置：项目文件中的 `plugins.enabled` 与 `lsp` 键为 `project-cannot-grant`；`lsp.enabled: false` / `teams.enabled: false` 在项目中生效；Hook 配置中的 `TaskCreated` 等不再报 `unknown-event`，写 matcher 为 `invalid-matcher`
- [ ] `sidecar-m6-seams.test.ts`：空贡献时 faux requestLog 与 02 之后相同（除新增的 `model_request` 条目外，模型请求不变）；新路由返回空结果或 501 占位；headless 存根以 4 退出；关闭顺序（定时器 → Run → Job → 贡献 → LSP → 登记进程 → 存储）由钩子调用顺序断言
- [ ] harness 自测：LSP 假服务器按参数回答四种请求并记录请求；插件夹具通过清单校验（04 的解析器尚不存在时只校验 JSON 形状）
- [ ] desktop：bridge 的键列表增加三个 update 方法（不暴露令牌）；update 存根状态为 disabled；注册表占位不显示（Browser Mode）；`build.ts` 产物中有 `dist/sidecar/headless.mjs`；`COKO_RELEASE_E2E` 未设置时 `desktop-release` 项目选中 0 个文件且不打包
- [ ] i18n：新域 zh / en 键集合相同
- [ ] 文档：permissions.md 两个权限类、configuration.md 三个开关与 lsp 键、recovery.md 版本 9、hooks.md 插件来源与三个事件名（"分发由 Agent Teams 接入"）、mcp.md 的 `auth-required` 值（"由 MCP 认证状态接入"）、ADR 0003 记 v9、ADR 0012 记 lsp 类别、architecture.md 与 README 同步；`check:docs` 通过

## Comments
