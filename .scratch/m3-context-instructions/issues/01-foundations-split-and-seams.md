# 01: 基础：SessionService 拆分、条目派生收敛、迁移 v3 与 M3 扩展点

**What to build:** 不改变 M2 行为的前提下，(1) 把 `apps/server/src/application/sessions.ts` 按职责拆为 `session-runtimes.ts`、`session-permissions.ts`、`recovery.ts`、`checkpoints.ts`，sessions.ts 只留 DTO 与 Run 控制（评审 S3）；(2) 条目派生收敛到浏览器安全子路径 `@coko/agent/entries`（`effectiveEntries` 含 rewind 与 compaction、`lastRunStatus`、`unansweredConfirmations`、`modelContext`），server、renderer 与 agent 内部都从它导入，renderer 的副本删除（评审 S2）；(3) packages/session 迁移 v3：`memories`、`secrets` 表与 MemoryRepository、SecretRepository；(4) 预先声明 [规格](../spec.md#session-entry-与事件票-01-预先声明) 中 M3 全部条目 kind、progress 事件与 RunTrigger `compact`；(5) 建立后续票的扩展点：protocol 领域文件、agent 子目录 barrel（instructions/shared 含文件端口、mtime 缓存、诊断与 `yaml` frontmatter 解析；config/ 的 schema 与默认值）、运行时 seam（`context.systemSections`、`transformMessages`、`beforeRequest`；`run` / `steer` 接受 `RunInput`；每条 assistant 后发 `context_usage`）、权限类与额外读取根、server `application/context/` 各领域空贡献与组合、`http/routes/<domain>.ts` 空 router、`application/config.ts` 默认值桩、i18n 分域字典、设置分区注册表（skills、mcp、memory 占位且不显示）、`COKO_HOME`（`src/config.ts`，缺省 `~/.coko`）与测试 harness 的临时 `COKO_HOME`、秘密总闸拆为共享 harness + 原用例文件；(6) 写入依赖 `@earendil-works/pi-mcp` 1.4.0、`yaml` 2.9.0 并登记 TECH_STACK。

**User stories:** 29；为 1–27 建立扩展点

**Blocked by:** None - can start immediately

**Status:** ready-for-agent（实施完成，待 Lead 合入）

**Write scope:** `apps/server/src/application/sessions.ts`、`apps/server/src/application/session-runtimes.ts`（新）、`session-permissions.ts`（新）、`recovery.ts`（新）、`checkpoints.ts`（新）、`apps/server/src/application/config.ts`（新，桩）、`apps/server/src/application/context/`（新：`index.ts`、`types.ts` 与 instructions、commands、skills、references、mcp、memory、usage、compaction 各一个空贡献文件）、`apps/server/src/application/index.ts`、`apps/server/src/http/app.ts`、`apps/server/src/http/routes/`（新：config、commands、skills、files、mcp、secrets、memories、context 空 router）、`apps/server/src/runtime/layers.ts`、`apps/server/src/config.ts`、`packages/agent/package.json`、`packages/agent/src/index.ts`、`packages/agent/src/entries/`（新）、`packages/agent/src/checkpoints/rewind.ts`、`packages/agent/src/agents/fork.ts`、`packages/agent/src/recovery/plan.ts`、`packages/agent/src/engine/`、`packages/agent/src/session-entries/`（含新 `context.ts`）、`packages/agent/src/policy/decide.ts`、`packages/agent/src/policy/gate.ts`、`packages/agent/src/tools/registry.ts`、`packages/agent/src/instructions/`（新：`index.ts`、`shared/`、`rules/index.ts`、`commands/index.ts`、`skills/index.ts` 空 barrel）、`packages/agent/src/context/`（新：`index.ts` 与 references、memory、usage、compaction 空 barrel）、`packages/agent/src/extensions/mcp/index.ts`（新，空）、`packages/agent/src/config/`（新）、`packages/session/src/`、`packages/protocol/src/`、`packages/i18n/src/`、`apps/desktop/src/renderer/stores/chat-store.ts`、`apps/desktop/src/renderer/features/conversation/timeline.ts`、`apps/desktop/src/renderer/features/settings/sections.ts`（新）、`settings-dialog.tsx`、`skills-section.tsx`、`mcp-section.tsx`、`memory-section.tsx`（新，占位）、`apps/desktop/src/renderer/app/settings-dialog-store.ts`、`pnpm-lock.yaml`、`tests/integration/sidecar-harness.ts`、`tests/integration/secrets-gate-harness.ts`（新）、`tests/integration/secrets-gate.test.ts`、`tests/integration/sidecar-context-seam.test.ts`（新）、`apps/desktop/e2e/harness.ts`、`docs/TECH_STACK.md`（接入状态行）、`docs/tech-stack/architecture.md`、`docs/subsystems/permiss... (line truncated to 2000 chars)

- [x] M2 的全部 agent、session、server、集成、Browser Mode 与 Electron E2E 测试不改断言地通过（只允许改导入路径；如有断言改动，在 Comments 逐条说明）
- [x] sessions.ts 不再包含权限回放与锁、恢复与结果确认、回退与分叉的实现；拆出的四个文件各有单元或现有集成测试覆盖
- [x] `@coko/agent/entries`：表驱动测试覆盖 rewind 区间、compaction（最后一个 compaction 的合成摘要消息 + firstKeptSeq 及之后；compaction 落在被回退区间时原历史生效）、lastRunStatus、unansweredConfirmations；守卫测试断言该子路径（含传递导入）不导入 `node:*` 与 `@earendil-works/*` 运行时代码；renderer 与 server 中不再有这些函数的副本（grep 证据写入 Comments）
- [x] 迁移 v3：v2 库升级到 3（备份、表与索引、原数据可读）；MemoryRepository 与 SecretRepository 契约测试在 SQLite 与内存实现上通过；SecretRepository.list 不返回密文
- [x] protocol 与 agent 的 `command`、`compaction` payload schema、RunTrigger `compact`、四个新 progress 事件已声明并注册；renderer 遇到这两种 kind 时不报错（暂不渲染）
- [x] agent 运行时测试：`context.systemSections` 组成 `SystemMessage.sections`（`DEFAULT_SYSTEM_PROMPT` 为第一段）、`RunInput.before` 的条目位于 run_start 之后、user message 之前、`transformMessages` 只改请求不改条目、每条 assistant 提交后发 `context_usage`
- [x] `sidecar-context-seam.test.ts`：默认（全部空贡献）时 faux requestLog 中的系统提示与 M2 相同；临时 `COKO_HOME` 经 harness 传入且 bash `env` 中不出现 `COKO_HOME`
- [x] 权限类：`decide.test.ts` 增加 context-read（四种模式都放行、deny 规则仍生效）、memory-write（accept-edits、full-access 放行）、external（仅 full-access 放行）、规则 `mcp__srv` 匹配 `mcp__srv__x` 而不匹配 `mcp__srv2__x`、未注册的 `mcp__` 名字被接受；`readRoots` 下的读取与 Workspace 内读取同样处理；工具对象自身不能指定权限类
- [x] i18n：分域字典组合后类型检查通过，zh 与 en 键集合相同（测试）；设置分区注册表中占位分区不出现在导航（Browser Mode 或 E2E 断言）
- [x] 秘密总闸拆分后原用例全部通过；按 M2 方式做一次负向确认（临时去掉一处脱敏使其失败，再撤销）
- [x] `pnpm install --frozen-lockfile` 通过；TECH_STACK 接入状态登记 pi-mcp 与 yaml；architecture.md 写明 renderer 可导入 `@coko/agent/entries` 的理由与守卫；session / agent / server README 与 ADR 0003（Memory 表已建、工具与界面待票 09）同步；`pnpm run check:docs` 通过

## Comments

### 实施者报告（m3/01-foundations-split-and-seams，2026-10-29）

**覆盖的验收**（逐项）

1. M2 测试不改断言地通过。断言改动逐条：`packages/protocol/src/entries.test.ts` 与 `packages/agent/src/session-entries/session-entries.test.ts` 的 kind 列表加入 `command`、`compaction`（规格要求预先声明）；`packages/session/src/sqlite/recovery.test.ts` 与 `tests/integration/sidecar-recovery.test.ts` 的库版本 2 → 当前版本 3（迁移 v3）；`apps/server/src/config.test.ts` 的期望配置加入 `cokoHome`；`packages/agent/src/index.test.ts` 只加 30 秒 timeout（全量并行时冷转译包入口超过默认 5 秒，见下文）。其余只改导入路径（`rewind.test.ts` 的 `effectiveEntries`、`chat-store-rewind.test.ts` 的 `visibleEntries` 改为 `@coko/agent/entries` 的 `effectiveEntries` 别名）。
2. sessions.ts（473 行）只有 DTO 与 Run 控制，权限回放与锁、恢复与结果确认、回退与分叉的实现分别在 `session-permissions.ts`、`recovery.ts`、`checkpoints.ts`，运行时注册表在 `session-runtimes.ts`；`grep -cE 'permission_rule|#locked|planRecovery|planRewind|forkEntries' sessions.ts` = 0。覆盖：`sessions-recovery.test.ts`（recovery、checkpoints）与集成 `sidecar-permissions / approvals / recovery / rewind / checkpoints / run-control`（全部通过）。
3. `@coko/agent/entries`：`packages/agent/src/entries/entries.test.ts` 表驱动（回退区间、嵌套回退、压缩取最后一个与 firstKeptSeq、压缩落在被回退区间时原历史生效、回退到压缩之后、缺字段不生效；modelContext 合成摘要在前；lastRunStatus；unansweredConfirmations）与导入守卫（沿传递导入，不允许 `node:*`、`@earendil-works/*`、typebox 之外的包）。grep 证据：`function (effectiveEntries|visibleEntries|rewoundRanges|lastRunStatus|unansweredConfirmations|modelContext)` 只在 `packages/agent/src/entries/derive.ts`；renderer 的 `chat-store.ts`、`timeline.ts` 与 server 的 `recovery.ts`、`checkpoints.ts`、`session-runtimes.ts`、`sessions.ts` 都从 `@coko/agent` / `@coko/agent/entries` 导入。Checkpoint 列表与分叉只应用回退（压缩之前的用户消息仍是 Checkpoint）；`effectiveEntries(entries, { compacted: true })` 与 `modelContext` 应用压缩，运行时恢复经 `effectiveMessages` = `modelContext`。
4. 迁移 v3：`recovery.test.ts` 的"SQLite 迁移 v3"（v2 库 → 3、`.backup-v2-*` 0600、STRICT、索引列、原数据可读、备份中无新表）；契约 `repository-contract.ts` 新增 Memory（作用域、排序、not-found、invalid-input）与 Secret（list 只有 name / hint / updatedAt、密文按字节读回、替换、删除）在 SQLite 与内存实现上通过。新增 StoreErrorCode `invalid-input`。
5. protocol `context-entries.ts`（CommandPayload、CompactionPayload，进入 `SESSION_ENTRY_PAYLOAD_SCHEMAS`）、RunTrigger `compact`、`ws.ts` 的 `context_usage`、`compaction_start/end/failed`；agent `session-entries/context.ts` 同形（server `entry-payloads.ts` 编译期比对通过）。renderer：`chat-store-context-entries.test.ts` 断言两种 kind 通过信任边界、时间线不渲染也不报错，新进度不改临时状态（`reduceProgress` 加 default）。
6. agent `engine/context-seam.test.ts`：systemSections → `sections`（`BASE_SYSTEM_SECTION`='coko.base' 为第一段、每 Run 取一次、空段跳过；无段落时开头系统消息与无 seam 时相同）、`RunInput.before` 位于 run_start 后与 user 前（steer 时紧接其 user message 之前）、`content` 替换内容、未送达退回 `text`、transformMessages 只改请求、beforeRequest 每次请求前、每条 assistant 后 `context_usage`。
7. `tests/integration/sidecar-context-seam.test.ts`：空贡献时 requestLog 中两次请求的开头系统消息 `content === DEFAULT_SYSTEM_PROMPT` 且无 `sections`；临时 COKO_HOME（含 AGENTS.md）经 harness 传入，bash `env` 输出不含 `COKO_HOME` 与其路径。
8. 权限类：`decide.test.ts` 新增"权限类（M3）"（context-read 四模式放行且 deny 生效、memory-write 只在 accept-edits / full-access、规则组名 `Memory`、external 只在 full-access 且未注册的 `mcp__` 名字同样、`mcp__srv` 匹配 `mcp__srv__x` 不匹配 `mcp__srv2__x`、`canonicalRuleTool` 接受未注册的 `mcp__` 名字、readRoots 与 Workspace 内读取同样处理）；`registry.test.ts` 与 `policy/permission-class.test.ts`（经运行时 gate：工具对象自身的 `permissionClass` 不生效）。
9. i18n：`dictionaries/domains/`（commands、context、mcp、memory、skills；`defineDomain` 在类型上约束 en 与 zh 同构），`domains.test.ts` 断言每域键集合相同与顶层不重名；原 `index.test.ts` 的全字典键集合测试照常通过。设置注册表 `features/settings/sections.ts`；`sections.browser.test.tsx` 断言 skills / mcp / memory 不在导航、`show('mcp')` 回到 General。
10. 秘密总闸：共享部分移到 `tests/integration/secrets-gate-harness.ts`（`persisted(dirs, { includeCokoHome })` 供之后的通道），原三个用例照常通过。
11. `pnpm install --frozen-lockfile` 通过；TECH_STACK 接入状态加一行；architecture.md 写明 renderer 只经 `@coko/agent/entries` 导入 agent 的理由与守卫；session / agent / server README 与 ADR 0003 同步；`pnpm run check:docs` 0 个问题。

**实际运行的命令与结果**（worktree，已 `git merge main`，HEAD d2033a2）

- `pnpm install --frozen-lockfile` 0；`pnpm run typecheck` 0；`pnpm run lint` 0；`pnpm run format:check` 0；`pnpm run check:docs` 0（104 个文件，0 问题）。
- `pnpm run test`：116 个文件通过，884 通过、1 跳过（settings E2E 中 M2 已有的跳过），含 desktop E2E 11 个文件与产物 smoke（`package-smoke.e2e.test.ts` 2 个）。基线（改动前 main）为 107 文件、822 通过、1 跳过。
- 全量中出现过两次的偶发问题：一次 `setTypeOfService EINVAL` 未处理错误（来自 `apps/desktop/src/main/sidecar-supervisor.test.ts` 的 undici 套接字，改动前的基线全量运行中同样出现，与本票无关）；两次 `packages/agent/src/index.test.ts` 在全量并行时超过 5 秒（单独运行 0.4 秒），已加 30 秒 timeout，最后一次全量无任何错误。

**负向确认**

- 秘密总闸：临时把 `session-runtimes.ts` 的 `redactModelError` 换成恒等函数 → 第一个用例失败（ws frame 5、6、8、9 含 credential），撤销后通过。
- seam：临时把 `HOST_ENV_EXCLUSIONS` 的 `/^COKO_/` 改为放行 `COKO_HOME` → `sidecar-context-seam` 失败（证明 harness 确实传入了 COKO_HOME），撤销后通过。
- 运行时：去掉 `applySystemSections` → sections 用例失败；`context_usage` 去掉 cacheRead / cacheWrite → 用例失败（用例设 `sessionId` 使 faux 模拟提示缓存）。
- 设置注册表：把 mcp 设为 `available: true` → `sections.browser.test.tsx` 失败。

**未验证项**

- 真实模型：无凭据，未运行。
- seam 的 `tools` / `hooks` / `expandInput` 动作分支在 server 上只有空贡献走过（没有领域给出工具或动作）；机制由 agent 层测试覆盖，server 侧的动作路径（409 `run-in-progress`、steer 400）待票 04 / 11 首次使用时补集成用例。
- 产物 smoke 未传 `COKO_HOME`（该文件归票 11）：现在其 Sidecar 会读真实 `~/.coko` 路径，但票 01 的空贡献不读任何文件；票 11 扩充 smoke 时应传临时 `COKO_HOME`。

**越出 Write scope 的改动**（请 Lead 裁决）

- `apps/desktop/package.json`（devDependency `@coko/agent`）与 `apps/desktop/src/renderer/tsconfig.json`（reference packages/agent）：renderer 导入 `@coko/agent/entries` 所必需。
- `packages/agent/src/policy/gate.ts` 在 scope 内；`packages/agent/src/engine/runtime.ts` 在 `engine/` 内。`packages/agent/src/tools/registry.test.ts`、`policy/permission-class.test.ts`、`instructions/shared/shared.test.ts` 为新测试。
- 测试文件：`packages/protocol/src/entries.test.ts`、`packages/agent/src/session-entries/session-entries.test.ts`、`packages/agent/src/checkpoints/rewind.test.ts`、`packages/agent/src/index.test.ts`、`packages/session/src/sqlite/recovery.test.ts`、`tests/integration/sidecar-recovery.test.ts`、`apps/server/src/config.test.ts`、`apps/desktop/src/renderer/stores/chat-store-rewind.test.ts`（改动如上）；新增 `apps/desktop/src/renderer/stores/chat-store-context-entries.test.ts`、`apps/desktop/src/renderer/features/settings/sections.browser.test.tsx`、`packages/protocol/src/context-entries.test.ts`、`packages/i18n/src/domains.test.ts`。
- `packages/agent/src/recovery/{plan.ts,index.ts}`（`unansweredConfirmations` 移到 entries/，barrel 原样转出）、`packages/agent/src/checkpoints/index.ts`（不再导出 `effectiveEntries`、`rewoundRanges`，改由 entries/）。
- `packages/i18n/src/dictionaries/en.ts` 的类型标注改为 `typeof zh`（分域后 `Dictionary` 含领域字典）。
- `apps/server/src/http/routes/shared.ts`、`routes/index.ts`（从 app.ts 抽出的 `Env`、`body`、`errorBody` 与路由登记）。
- 文档：`docs/subsystems/recovery.md`（结构入口与迁移版本）、`docs/adr/0006-file-checkpoints-and-rewind.md`（effectiveEntries 的位置），只修正因本票变得不准确的引用。

**文档影响**：TECH_STACK 接入状态新增"M3 票 01"一行（Lead 合并时如需并入 packages/agent 行请调整）；`docs/README.md` 的"当前行为"导航未改（本票没有新子系统页）。

### 供后续票

- **条目派生**：`@coko/agent/entries` 的 `effectiveEntries(entries, { compacted? })`、`modelContext(entries)`（合成摘要文本 = `COMPACTION_SUMMARY_PREFIX + summary + COMPACTION_SUMMARY_SUFFIX`，user 角色、timestamp 0）、`compactionSummaryMessage`。票 11 若改摘要文本或分叉经过压缩的行为，改 `entries/derive.ts`。
- **运行时**：`AgentRuntimeOptions.context: RuntimeContext { systemSections?, transformMessages?, beforeRequest? }`；`BeforeRequestState { runId, messages, model, signal? }`；`RunInput { text, content?, before? }`（`before` 不带 runId，运行时补上）；`BASE_SYSTEM_SECTION = 'coko.base'`——section 名请用不像整数的稳定名（如 `instructions`、`skills`、`memory`）。
- **server 贡献**：每个 `application/context/<domain>.ts` 导出 `<domain>Contribution(options: ContextContributionOptions): ContextContribution`（字段见 `context/types.ts`）。`ContextScope { workspaceId, cwd, sessionId?, config, cokoHome }`；`expandInput(input, scope)` 返回 undefined 表示不处理，结果 `{ kind: 'input', input }` 或 `{ kind: 'action', name, args }`；`actions[name]({ scope, sessionId, args }) → { runId }`；`tools(scope)` 返回 `{ tool, permissionClass? }[]`，与宿主基础工具同名的被忽略（warn）；单个领域取值失败只记 warn 并当作空。需要新依赖（例如 MCP 的控制通道、Memory 的 store）时，在 `ContextContributionOptions` 中加字段并在 `runtime/layers.ts` 的 `AssemblyLive` 传入——两处都归票 01 的所有者，请写进 Comments 由 Lead 合并。注意 compaction 需要的 `beforeRequest` 目前未经组合传给运行时（`ContextContribution` 没有该字段）；票 11 需要时在 Comments 提出，由 Lead 在 `context/types.ts`、`context/index.ts` 与 sessions.ts 加一处转交。
- **路由**：`http/routes/<domain>.ts` 导出 `<domain>Routes(app: Application) => Hono<Env>`，路径相对 `/api`（如 `r.get('/config', …)`），用 `./shared.ts` 的 `body`、`domainRouter`。`Application` 新增 `config: ConfigService`、`context: ContextAssembly`。
- **配置**：agent `capabilityConfigSchema`、`defaultCapabilityConfig()`、`CONFIG_SETTING_KEY = 'config'`；server `ConfigService.effective(workspacePath?)`（票 02 实现）。
- **权限**：`RegisterToolOptions.permissionClass`、`ToolRegistry.permissionClass(name)`、`PermissionClass`、`MCP_TOOL_PREFIX`；`RuntimePermissions.readRoots?()`。Skill 目录在 `~/.coko` 下时，写入仍受 `.coko` 受保护段约束（读取不受影响）。
- **instructions/shared**：`createNodeFiles()`、`createMtimeCache(files, parse)`、`diagnostic(source, code, message, path?)`、`parseFrontmatter(text)` → `{ ok, frontmatter, body } | { ok: false, error, body }`。
- **存储**：`store.memories`（MemoryRepository）、`store.secrets`（SecretRepository）；新错误码 `invalid-input`。
- **i18n**：新文案写 `packages/i18n/src/dictionaries/domains/<domain>.ts`（`defineDomain(zh, en)`）；已有 `skills.title`、`mcp.title`、`memory.title` 供分区导航。
- **设置分区**：在 `features/settings/sections.ts` 中把对应分区改为 `available: true`（本文件归票 01，这一行变更请写进 Comments 由 Lead 合并）；分区组件签名 `({ theme }) => ReactNode`。
- **harness**：集成 `sidecarDirs()` 返回 `cokoHome`、`writeCokoHome(dirs, relative, content)`；E2E `cokoHomeOf(dir)`、`writeCokoHome(dir, relative, content)`；秘密总闸 `secrets-gate-harness.ts` 的 `marker`、`echoingModelServer`、`recordingClient`、`leaksIn`、`readDir`、`persisted(dirs, { includeCokoHome })`。
