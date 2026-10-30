# 02: M4 基础：条目与协议、迁移 v7、运行时与装配 seam、权限类、依赖与 UI 容器

**What to build:** 为后续票建立扩展点，自身不交付用户可见功能，见 [规格](../spec.md)：(1) 声明全部 M4 条目 kind 与 progress 事件的 schema（agent `session-entries/{goals,tasks,planning,jobs}.ts` 与 protocol `{goal,todo,planning,jobs}.ts`，`run_start` v2 加 `trigger: goal` 与 `goal`），注册进 `SESSION_ENTRY_PAYLOADS` 与 `SESSION_ENTRY_PAYLOAD_SCHEMAS`；分叉不复制这些 kind；(2) packages/session 迁移 v7：`host_processes` 表与 `store.processes`；(3) 运行时 seam：`RunInput.trigger` / `goal`、`AgentRuntime.stopAfterBatch`、`ContextContribution.beforeRequest` / `pendingInput` / `onRunEnd` 及其组合与转交、`session-runs.startRun` 统一入口、`ActionResult` 的 `{ done }`、内置命令 `plan` 与 `goal` 占位；(4) 权限类 `session-state` 与 `plan-exit`（decide.ts 中的模式放行；plan 模式本身归票 08）；(5) server 存根 `application/{jobs,goals,processes}.ts`、`context/{plan,goal,todo,jobs}.ts` 空贡献、`routes/{goals,jobs}.ts` 空 router、启动顺序与关闭顺序中的钩子、`recovery.ts` 中 Goal 与 Job 的恢复钩子（空实现）；(6) i18n 分域 `jobs`、`todo`、`plan`、`goal`、`usage`；(7) renderer 容器：dock（三个不可用槽）、header-actions、右栏 tabs、composer 的 plan-chip 槽、时间线对新 kind 的分发与空组件、chat-store `onProgress`；(8) 依赖：apps/server `node-pty` 1.2.0-beta.15、apps/desktop devDependency `anser` 2.3.5、`allowBuilds: node-pty: true`、恢复 spawn-helper 可执行位的根 postinstall，登记 TECH_STACK；(9) 测试 harness：集成 harness 的"SIGKILL Sidecar 后以同一数据目录重启"辅助、进程存在判断辅助、秘密总闸落盘扫描增加 `<dataDir>/jobs`；faux 脚本可设每条回复的 usage。

**User stories:** 为 1–16 建立扩展点

**Blocked by:** 01

**Status:** ready-for-agent

**Write scope:** `packages/protocol/src/`（`index`、`entries`、`ws`、`runs` 与新 `goal`、`todo`、`planning`、`jobs`）、`packages/agent/package.json`、`packages/agent/src/index.ts`、`session-entries/`（`index`、`runs` 与新 `goals`、`tasks`、`planning`、`jobs`）、`agents/fork.ts`、`engine/`、`policy/{decide,gate}.ts`、`tools/registry.ts`、`instructions/commands/builtin.ts`、`tasks/`（新：`index.ts` 与 `todo/`、`jobs/` 空 barrel）、`goals/`（新，空 barrel）、`planning/`（新，空 barrel）、`ports/pty.ts`（新，类型）、`packages/session/src/`、`packages/i18n/src/`（`dictionaries.ts`、`dictionaries/{en,zh}.ts`、新 `domains/{jobs,todo,plan,goal,usage}.ts`）、`apps/server/package.json`、`apps/server/src/application/{sessions,session-runs,session-models,recovery,permissions,jobs（新）,goals（新）,processes（新）,index}.ts`、`application/context/{index,types,plan（新）,goal（新）,todo（新）,jobs（新）}.ts`、`http/routes/{index,goals（新）,jobs（新）}.ts`、`runtime/layers.ts`、`adapters/faux.ts`、`apps/desktop/package.json`、`apps/desktop/src/renderer/stores/chat-store.ts`、`features/conversation/{conversation-pane,composer,timeline,timeline-view}.*`、`features/conversation/dock/`（新：`dock.tsx`、`dock-slots.ts`、空 `todo-card`、`goal-card`、`queue-card`）、`features/conversation/header-actions.ts`（新）、`features/conversation/{plan-chip,plan-card,job-row,goal-row,run-usage-row}.tsx`（新，空组件）、`features/right-panel/{right-panel.tsx,tabs.ts（新）}`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、根 `package.json`、`scripts/postinstall-node-pty.mjs`（新）、`tests/integration/{sidecar-harness,secrets-gate-harness}.ts`、`tests/integration/sidecar-m4-seams.test.ts`（新）、`apps/server/src/adapters/pty-runtime.test.ts`（新）、`apps/desktop/e2e/harness.ts`、`docs/TECH_STACK.md`、`docs/subsystems/permissions.md`（两个新权限类）、`docs/adr/0003-settings-and-sessions-in-sqlite.md`（host_processes 一行）、`packages/session/README.md`、`packages/agent/README.md`、`apps/server/README.md`

- [ ] 01 合入后的全部测试只改导入路径或 kind 列表、schema 版本即通过（逐条写入 Comments）
- [ ] 条目：protocol 与 agent 的新 kind 编译期比对（沿用 `entry-payloads.ts` 的 `Assert<Equal>`）；`run_start` v1 条目读回为 v2；renderer 收到新 kind 不报错、不渲染（`chat-store` 测试）；`forkEntries` 不复制新 kind（表驱动）
- [ ] 迁移 v7：v6 库升级到 7（`.backup-v6-*` 0600、STRICT、原数据可读）；`store.processes` 契约测试在 SQLite 与内存实现上通过
- [ ] 运行时：`stopAfterBatch` 在工具批次完成后结束、run_end 为 paused 加 error；`beforeRequest` 返回 stop 时不发出该次请求；`RunInput.trigger: goal` 写入 run_start v2（agent 测试，deferred 控制交叠）
- [ ] `sidecar-m4-seams.test.ts`：空贡献时 faux requestLog 与 01 之后相同；`pendingInput` 的测试贡献内容出现在下一个 Run 的 user message 开头；`/plan`、`/goal pause` 在实现前返回 400；关闭顺序（Job → 贡献 → 登记进程 → 存储）由钩子调用顺序断言
- [ ] 权限类：`decide.test.ts` 增加 session-state（五种现有模式都放行，deny 生效）、plan-exit（四种模式都询问，allow 规则不生效、deny 生效）
- [ ] i18n：新域 zh / en 键集合相同；dock、header-actions、右栏 tabs 的占位不显示（Browser Mode 断言）
- [ ] 依赖：`unset ELECTRON_RUN_AS_NODE; pnpm install --frozen-lockfile` 通过；`pty-runtime.test.ts` 以 `ELECTRON_RUN_AS_NODE=1` 启动 Electron 41.0.3 子进程加载 node-pty 并 spawn `/bin/echo ok` 读到 `ok`，断言 `spawn-helper` 可执行；失败时以 BLOCKED 报告（见规格 Further Notes）
- [ ] harness：重启辅助与进程存在辅助各有一个自测；秘密总闸的落盘扫描包含 `<dataDir>/jobs`，原用例全部通过，做一次负向确认
- [ ] TECH_STACK 登记 node-pty 1.2.0-beta.15（附包元数据与选择理由）、anser 接入、allowBuilds；ADR 0003 记 host_processes；permissions.md 写两个新权限类；README 同步；`check:docs` 通过

## Comments
- 2026-10-30 lead：来自票 01——SessionRuns.start（apps/server/src/application/session-runs.ts）是 startRun 的接入点；新的贡献工具只需声明 ruleTools；Application.context 现为 ContextService，组装结果在 .assembly。apps/server/src/application/context/compaction.ts 第 2 行注释仍写 sessions.ts，应为 session-runs.ts，本票顺带修正。
