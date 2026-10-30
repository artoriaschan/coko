# 01: 预构建：M3 结构债 J1、J2、J4–J7 与 sessions.ts、runtime.ts 拆分（行为不变）

**What to build:** 不改变任何行为，在引入 Goal / Plan 状态之前收敛 [M3 Standards 评审](../../m3-context-instructions/review-standards.md) 的 J1、J2、J4–J7，并拆分两个过大的文件，细节见 [规格](../spec.md)：J1 贡献工具的权限类由 `ContextContribution.ruleTools` 声明，删除 sessions.ts 的 `CONTRIBUTED_TOOLS`、`process.cwd()` 取名与 `#rememberContributed`；J2 `McpAdmin` 拆出、每个 Run 只 `#load` 一次；J4 `ContextService` 与 Application 持有的 `MemoryService`，路由只校验与调用；J5 `engine/compaction-driver.ts` 与 `engine/system-message.ts`；J6 `CommandSourceContribution.list` 返回 `SourcedCommand[]`；J7 `createIpcDecryptor` 与 `createEncryptingBridge`。sessions.ts 拆出 `session-models.ts` 与 `session-runs.ts`。

**User stories:** 17

**Blocked by:** None - can start immediately（阻塞本目录其余全部票）

**Status:** ready-for-agent

**Write scope:** `apps/server/src/application/sessions.ts`、`session-models.ts`（新）、`session-runs.ts`（新）、`session-runtimes.ts`、`permissions.ts`、`secrets.ts`、`memory.ts`（若存在）、`context-service.ts`（新）、`application/index.ts`、`application/context/{index,types,mcp,mcp-admin（新）,memory,commands,skills,usage}.ts`、`apps/server/src/http/routes/{context,commands,skills,files,memories,mcp}.ts`、`apps/server/src/http/app.ts`、`apps/server/src/runtime/layers.ts`、`apps/server/src/adapters/{credentials,ipc-decryptor（新）}.ts`、`apps/desktop/src/main/{credentials,secrets,encrypting-bridge（新）}.ts`、`packages/agent/src/engine/`（`runtime.ts`、`compaction-driver.ts`（新）、`system-message.ts`（新）、`types.ts`）、`packages/agent/src/context/compaction/`（只限被 driver 移动的导出）、上述文件的就近测试（只改导入路径，新测试见下）、`packages/agent/README.md`、`apps/server/README.md`、`docs/tech-stack/architecture.md`（应用层结构一句）

- [x] 改动前在 main 记录基线：全量测试的文件数、用例数与跳过数写入 Comments
- [x] 已有的 agent、session、server、集成、Browser Mode 与 Electron E2E 测试只改导入路径即通过；任何断言改动在 Comments 逐条说明理由（预期为零）
- [x] `wc -l`：sessions.ts ≤ 300、runtime.ts ≤ 450，本票新建或改动的源文件 ≤ 500 行（结果写入 Comments）
- [x] J1：`grep -n 'CONTRIBUTED_TOOLS\|process.cwd()' apps/server/src/application/sessions.ts` 无结果；新单元测试：memory 关闭时仍能写 `Memory` 规则、新增一个贡献只需在贡献中声明 `ruleTools`（用测试贡献验证 `PermissionService` 接受其名字）
- [x] J2：新单元测试断言一个 Run 中 `.mcp.json` 与有效配置各只读取一次（计数文件端口）；`McpManager` 不再含 view / updateServers / approve
- [x] J4：`routes/{context,commands,skills,files,memories}.ts` 不再直接调用 `app.store`、不 `new MemoryService`、不用 `contributions.find`（grep 证据）；`sidecar-context.test.ts` 等原集成测试通过
- [x] J5：runtime.ts 不含 `summarize` / `compactNow` / `autoCompact` / `recoverOverflow` 的实现；`engine/compaction.test.ts` 原样通过
- [x] J6：`isSourcedCommand` 删除，`tsc -b` 通过
- [x] J7：Credential 与 Secret 的 IPC 解密共用 `createIpcDecryptor`；`secrets-gate*.test.ts` 全部通过；按 M3 方式做一次负向确认（临时让解密器跳过按值脱敏登记，确认总闸失败，再撤销）
- [x] `pnpm run typecheck`、`lint`、`format:check`、`check:docs` 退出 0；`scripts/browser-deps.test.ts`、`scripts/source-references.test.ts` 通过；README 与 architecture.md 的结构描述与新文件一致

## Comments

### 基线（main 0eafbba，改动前）

- `pnpm run test`（全量，含 desktop E2E 与 package-smoke）：Test Files 2 failed | 205 passed (207)；Tests 2 failed | 1458 passed | 1 skipped (1461)；退出码 1。
- 两个失败均为 5 秒超时：`apps/desktop/src/main/sidecar-process.test.ts`（以 ELECTRON_RUN_AS_NODE 启动…）与 `sidecar-supervisor.test.ts`（ready 之后意外退出…）。单独重跑这两个文件：2 files、16 tests 全部通过，退出 0，判定为全量并发负载下的超时，与本票无关。
- 跳过的 1 项：`apps/desktop/e2e/settings.e2e.test.ts` 中原有的 skip。

### 完成记录

**覆盖的验收**

- 基线：见上节。
- 只改导入路径：已有测试无导入改动；唯一的断言/夹具改动见下"断言改动"。
- `wc -l`：sessions.ts 296、runtime.ts 436；本票新建或改动的源文件最大为 runtime.ts 436（其余：context/mcp.ts 408、layers.ts 337、session-runs.ts 282、permissions.ts 275、engine/types.ts 239、compaction-driver.ts 196、context/index.ts 189、permission-wiring.ts 147、credentials.ts 145、mcp-admin.ts 142、其余 < 130）。
- J1：`grep -n 'CONTRIBUTED_TOOLS\|process.cwd()' apps/server/src/application/sessions.ts` 无结果（退出 1）。`ContextContribution.ruleTools` 由 memory（名字与权限类取自 `createMemoryTools` 的定义，Memory 关闭或没有存储时同样声明）与 mcp（`MCP_RESOURCE_TOOL_NAMES`）声明，`ContextAssembly.ruleTools` 汇总；宿主工具名由 `permissions.ts` 的 `hostToolNames` 以固定目录 `/` 调用工具工厂取得。新测试 `application/permissions.test.ts`：Memory 关闭时写 Memory 规则；测试贡献只声明 `ruleTools` 即被 PermissionService 接受（并归一 memory-write → Memory），未声明的名字 unknown-tool。
- J2：`context/mcp-admin.ts` 的 `McpAdmin`（view、updateServers、approve、reconnect）；`McpManager` 只留连接池、配置读取与运行时；`toolsFor` / `resourceToolsFor` 合并为 `runTools`（只 `load` 一次）。新测试 `context/mcp.test.ts`：一个 Run 的工具取值中 `.mcp.json` 读取 1 次、有效配置 1 次（`McpManagerOptions.readFile` 计数端口）。`Application.mcp` 的类型改为 `McpAdmin`，路由不变。
- J4：`application/context-service.ts` 的 `ContextService`（`scopeFor`、`contextUsage`、`commands`、`skills`、`files`）为 `Application.context`（装配本身为 `context.assembly`）；`Application.memories` 为 `MemoryService`。`grep -nE 'app\.store|new MemoryService|contributions\.find' apps/server/src/http/routes/{context,commands,skills,files,memories}.ts` 无结果；sidecar-context、commands、skills、references、memory 集成测试通过。
- J5：`engine/compaction-driver.ts` 持有熔断、摘要、compactNow、autoCompact、recoverOverflow；runtime.ts 只在 prepareRequest 调 `driver.autoCompact`、在 run/retry/continue 包 `driver.recoverOverflow`、在 compact() 调 `driver.manual`。另拆 `engine/system-message.ts`；`engine/compaction.test.ts` 未改动并通过。
- J6：`SourcedCommand` 在 `context/types.ts`，`list` 返回 `Promise<SourcedCommand[]>`，`isSourcedCommand` 已删除（仓库中 0 处），`tsc -b` 通过。
- J7：server `adapters/ipc-decryptor.ts` 的 `createIpcDecryptor({ control, requestType, resultType, label, timeoutMs? })` 供 Credential 与 Secret；desktop main `encrypting-bridge.ts` 的 `createEncryptingBridge`（解密回答、加密、存库请求与超时映射），`Encryption` 与 `credentialHint` 移入并由 credentials.ts 再导出。负向确认：临时让 `createIpcDecryptor` 的 `cachedValues` 返回 `[]`（跳过按值脱敏登记），`pnpm run test tests/integration/secrets-gate` 为 3 failed | 7 passed（10 files）、3 failed | 9 passed（12 tests），失败的是 secrets-gate-context、secrets-gate-mcp-prompts、secrets-gate-mcp；撤销后 10 files / 12 tests 全部通过。

**断言改动（逐条）**

1. `apps/server/src/application/context/commands.test.ts`：删去来源返回的不合格条目 `{ name: 'bogus' }`，用例名去掉"与不合格的条目"。理由：J6 把 `CommandSourceContribution.list` 收紧为 `Promise<SourcedCommand[]>` 并按规格删除 `isSourcedCommand` 守卫与 warn 分支，不合格条目在类型层面不再可能，运行时也不再过滤。其余断言未改。

**越出 Write scope 的改动**

- `packages/agent/src/engine/permission-wiring.ts`（新）：runtime.ts 拆出 compaction-driver 与 system-message 后仍为 525 行，把权限接线（链首判定、执行前准备、沙箱拒绝记录，原样移动）移到此文件后为 436 行。位于 `engine/` 目录内；`PAUSED_BEFORE_APPROVAL_TEXT` 由 runtime.ts 再导出，index.ts 未改。后续票按 engine 的顺序（01 → 02 → 10）一并视作该目录。
- `apps/server/src/application/context/mcp.test.ts`、`permissions.test.ts`（新）：J2、J1 要求的新单元测试，放在被测文件旁。
- 文档：`docs/subsystems/{context,permissions,mcp,commands}.md` 代码位置表各改一两行，指向移动后的文件（不改行为描述）。

**实际运行的命令与结果**

- `git merge main`：Already up to date（main 仍为 0eafbba）。
- `pnpm run typecheck`、`pnpm run lint`（0 warnings、0 errors，587 files）、`pnpm run format:check`（613 files）、`pnpm run check:docs`（148 files、0 问题）：均退出 0。
- `pnpm run test`（全量，含 desktop E2E、package-smoke、scripts/browser-deps 与 source-references）：Test Files 209 passed (209)；Tests 1463 passed | 1 skipped (1464)；`test=0`，日志中没有 Unhandled 错误。比基线多 2 个文件、3 个用例（mcp.test.ts 1、permissions.test.ts 2）；基线的两个 sidecar 超时这次未出现。
- 先红：J2 测试在接入 `readFile` 端口前失败（reads 为 []）；J1 第二个用例在实现前以 `Unknown tool in permission rule: FAKE_LOOKUP` 失败（第一个用例在旧常量下已通过，作为回归保护）。

**未验证项**：真实模型（不适用，行为不变）；符号链接越界用例不适用（本票不新增读取根与文件读取）。

**供后续票**

- 统一 Run 入口（票 02）：`SessionRuns.start(sessionId, (runtime) => …)` 在 `session-runs.ts`；submit / retry / continue / 动作都经它；`SessionRuns.scope(session)` 给出 Run 的作用域。
- 新的贡献工具只需在贡献上声明 `ruleTools: [{ name, permissionClass }]`（例如 todo_write → session-state），不改 sessions.ts 或 permissions.ts。
- `Application.context` 现为 `ContextService`（装配为 `.assembly`），`Application.memories` 为 `MemoryService`，`Application.mcp` 为 `McpAdmin`；新路由经 application 服务访问，不读 `app.store`。
- 运行时接线点：压缩在 `compaction-driver.ts`；`prepareRequest` 在 runtime.ts（先 `driver.autoCompact`，后 `context.beforeRequest`）；`stopAfterBatch`（票 02）可放在 runtime.ts 的运行控制旁。`AgentRuntimeOptions` / `AgentRuntime` 在 `engine/types.ts`。
- 已知的过时注释（不在本票范围）：`application/context/compaction.ts` 第 2 行仍写"由 sessions.ts 接线"，应为 session-runs.ts。
- 2026-10-30 lead：评审后合入 main（8a9238e）。接受越界：新增 engine/permission-wiring.ts（runtime.ts 拆出编排后仍 525 行）、新测试 mcp.test.ts 与 permissions.test.ts、四个 subsystems 文档的代码位置行；接受 commands.test.ts 去掉不合形的 bogus 命令源（J6 删除了过滤它的守卫）。main 上复核（后台任务）：install、typecheck、lint、format:check 退出 0；全量 test 209 文件 1463 通过、1 跳过（真实模型），无页面重载、无未处理错误；check:docs 148 文件 0 问题；sessions.ts 296 行、runtime.ts 436 行。worktree 已清理。

Closed: true
