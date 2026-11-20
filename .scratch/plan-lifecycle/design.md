---
kind: design
description: "计划从 Permission Mode 剥离并延伸到结果反馈的实施设计：条目形状与版本、计划阶段的派生、判定与沙箱、注入与工具、Session 计划接口、State Update、回退分叉交接、界面、全部模型可见文本、过渡状态、旧应用读取，以及 02–12 各票的触及文件与验证接口。"
lifecycle: active
status: approved
---

# 计划阶段与计划生命周期：实施设计

本设计是 [规格](spec.md) 的 Implementation Decisions 的定稿展开，也是实施票 02–12 的唯一依据：条目名称与 payload、接口路径与错误码、所有模型可见文本以本页为准，各票不再各自决定。长期决定见 [ADR 0028](../../docs/adr/0028-plan-phase-not-permission-mode.md)。文中“现状”指 `feat/plan-lifecycle` 于 2026-11-20 的代码（提交 `0f4b75bf`），“目标”指本设计交付后的行为。

## 问题与范围

规格的 Problem Statement 列出四类问题：规划顶掉用户选的权限、“不改 Workspace”不成立、计划在批准时结束、审阅时改不了权限。本设计把规格的 68 个用户故事落实到具体模块与接口，分两个阶段交付（阶段一：故事 1–44，票 02–08；阶段二：故事 45–68，票 09–12）。

不在范围（与规格 Out of Scope 一致）：移除 read-only 模式与“帮我批准”改为模型审核；模型可调用的进入规划工具与界面上的进入按钮；“Workspace 只读、临时目录可写”的沙箱档位；完成报告的结构校验、宿主自动验证与完成审批；因执行中的 Plan 自动发起 Run 或批准时创建 Goal；以同一编号修订执行中的计划；放弃的二次确认与撤销改动；Hook 输入中的“规划中”字段；无界面运行的规划入口；回退不还原 Permission Mode 的既有缺陷；为历史上已批准的 Plan 补记状态。

## 来源与约束

### 已确认的决定

- 产品决定：规格（approved，2026-11-20）及其讨论记录 [grilling.md](grilling.md) 的 24 个问题。长期结论提炼在 [ADR 0028](../../docs/adr/0028-plan-phase-not-permission-mode.md)。
- 现有契约：[ADR 0005](../../docs/adr/0005-permission-mode-and-sandbox.md)（判定顺序、沙箱与提权；`plan` 取值部分由 0028 替代）、[ADR 0013](../../docs/adr/0013-external-hooks-tighten-only.md)（Hook 只收紧）、[ADR 0014](../../docs/adr/0014-subagents-as-child-sessions.md)（子 Session）、[ADR 0019](../../docs/adr/0019-headless-runs-deny-approvals.md)（无界面运行）、[ADR 0024](../../docs/adr/0024-session-state-as-state-updates.md)（State Update）、[ADR 0011](../../docs/adr/0011-goal-state-as-session-entries.md)（Goal 条目）、[ADR 0003](../../docs/adr/0003-settings-and-sessions-in-sqlite.md)（条目版本在读取时迁移）。
- 当前行为文档：[Plan Mode](../../docs/subsystems/plan-mode.md)、[权限判定与审批](../../docs/subsystems/permissions.md)、[上下文管理](../../docs/subsystems/context.md)。

### 已核对的代码事实（2026-11-20，只读核对，未运行测试）

| 事实 | 位置 |
| --- | --- |
| 条目 payload 按 kind 注册版本列表，读取时逐版 `migrate` 到当前版本再按当前 schema 校验；不合格（含未注册 kind、版本号高于已知）的条目跳过并报告 `onInvalidEntry`，库中保留；写入缺省用当前版本 | `packages/session/src/payloads.ts`、`internal.ts`（`upgradeEntries`） |
| 增量变化（新字面量、新可选字段）的惯例是加一版并以恒等迁移：`agent_start` v2、`hook_run` v2、`approval_decision` v3、`run_start` v4 | `packages/agent/src/session-entries/*.ts`、`packages/agent/README.md` |
| agent 与 protocol 各有一份 payload schema，`apps/server/src/application/entry-payloads.ts` 编译期比对两侧 kind 与当前版本类型 | 同左 |
| `permission_mode` v1（四档）→ v2（加 `plan` 与 `prior`，恒等迁移）；`plan` 只有 v1（proposed / approved / rejected）；`state_update` 只有 v1，`name` 为 date、goal、todo_list、team、on_demand_tools | `session-entries/{permissions,planning,context}.ts` |
| 判定顺序：拒绝规则 → 询问规则 → 受保护路径 → 越出可写根（write 类）→ plan-exit 总询问 → 模式放行 → 允许规则 → 询问。deny 判定的类型只有 `{ behavior: 'deny'; rule }`；步骤名 `deny-rule`、`ask-rule`、`protected`、`outside-writable`、`mode`、`allow-rule`、`default` | `packages/agent/src/policy/decide.ts` |
| write 类 = 内置 `write`、`edit` 与权限类 `edit`（当前没有其他工具注册 `edit` 类） | `decide.ts` 的 `CATEGORY`、`CLASS_CATEGORY` |
| 权限 hook 中先跑 PreToolUse，Hook deny 优先；再是判定的 deny（`deniedByRule`）、isolation 在 plan / read-only 下拒绝、`fixedSandbox` 在 plan / read-only 下拒绝、提权检查、`combinePreToolUse`；`recheck` 与等待中的重新判定也用 `deniedByRule` | `packages/agent/src/policy/gate.ts`、`extensions/hooks/combine.ts` |
| 沙箱档位 `sandboxModeFor(mode)`（plan → read-only）；可写根 `writableRootsFor(mode, …)`；执行前 `prepare` 现算档位，已批准的提权取较宽者 | `policy/sandbox.ts`、`policy/paths.ts`、`engine/permission-wiring.ts` |
| bash 被沙箱拒绝时在退出码前追加拒绝标记与提权提示（非 danger-full-access） | `tools/builtin/bash.ts` |
| 运行时每次判定现取 `RuntimePermissions.mode()` 与 `rules()`；Hook 输入的 `permission_mode` 取 `mode()` | `engine/types.ts`、`gate.ts` |
| Session 的模式、Session 规则与计划审阅都在 `SessionPermissions`：从原始条目（不是有效条目）回放 `permission_mode` / `permission_rule`，缓存在 `#states`；子 Session 的 `state()` 返回根 Session 的同一个状态对象；`runtimePermissions` 给子 Session 用 `effectiveSubagentMode`（plan 按 read-only） | `apps/server/src/application/session-permissions.ts` |
| `planContribution`：`tools` / `systemSections` 以 `host.mode() === 'plan'` 决定 `exit_plan_mode` 与 `<plan_mode>`；`<approved_plan>` 取 `approvedPlanToReinject`；`/plan` 动作调 `enterPlan` / `exitPlan`；`/plan` 不是 `whileRunning`，Run 进行中以 `run-in-progress` 拒绝 | `apps/server/src/application/context/plan.ts`、`session-runs.ts` |
| 子 Session 由 `scope.parentSessionId` 区分；`exit_plan_mode` 在 `SUBAGENT_EXCLUDED_TOOLS` 中；带 isolation 的派发在 `SubagentService` 与 gate 两处检查 plan / read-only | `packages/agent/src/agents/definitions.ts`、`apps/server/src/application/subagents.ts` |
| `nextPlanRef`：从有效条目向前找，遇到 `plan` 条目按状态续号或新号，遇到 `permission_mode { mode: 'plan' }` 停止 | `packages/agent/src/planning/state.ts` |
| State Update：贡献 `stateValues(scope)` 汇总后 `planStateUpdates(values, entries, renderers)`，与有效上下文（应用压缩）中同名最近一次送达比较；值为 `null` 且从未送达时不发送，送达过则发一次固定的清空文本；渲染在 `renderStateValue`（todo、team 有专用文本） | `packages/agent/src/entries/state-updates.ts`、`apps/server/src/application/context/index.ts` |
| Goal 接口：`GET` / `POST /api/sessions/:id/goal`，响应 `GoalResponse`，`POST` 体 `GoalActionRequest { action, revision, … }`，路由在 `apps/server/src/http/routes/goals.ts` 并登记于 `routes/index.ts` | `packages/protocol/src/goal.ts` |
| 切换模式 `PUT /api/sessions/:id/permission-mode`（子 Session 409 `child-session`，不检查归档）；`GET …/permission-rules` 返回 `SessionPermissionsResponse { mode, prior?, rules }`；首次发送 `FirstSendRequest.permissionMode` 接受五档 | `apps/server/src/http/app.ts`、`packages/protocol/src/{permissions,http}.ts` |
| 回退只在没有 Run 时进行（`session-busy`）；conversation / both 提交 `rewind` 条目后 `runtimes.discard`；`SessionPermissions` 的缓存不随回退失效 | `apps/server/src/application/checkpoints.ts` |
| 分叉复制 `message`、`permission_mode`、`permission_rule`、`tool_load` 与配对的 `state_update`；交接只复制 `permission_mode`、`permission_rule` | `packages/agent/src/agents/{fork,handoff}.ts` |
| 审计的 `permission_mode` 事件带 `prior`；事件形状在 `AuditEvent` | `packages/agent/src/observability/audit.ts`、`packages/protocol/src/trace.ts` |
| 无界面运行 `--permission-mode` 合法取值含 `plan`，错误文本 `--permission-mode must be one of …` | `apps/server/src/headless/args.ts` |
| renderer 从原始条目取最后一条 `permission_mode`（`sessionPermissionMode`），`restoredMode` 取 prior；Plan chip 以 `mode === 'plan'` 显示，× 调 `setPermissionMode(prior)`；模式菜单 `prior` 特例 | `apps/desktop/src/renderer/{stores/chat-store.ts,features/conversation/*}` |
| 原始会话诊断按已加载条目的类型动态筛选，自动包括新 kind | [上下文管理](../../docs/subsystems/context.md) |

### 假设

- 新 kind 与新版本的条目经 WS 推送与 HTTP 读取时都已是当前版本；renderer 只按当前 schema 校验（现状如此）。
- 非 darwin 平台没有 `sandbox-exec`，受限档位的命令 fail-closed；规划中一律 read-only，因此这些平台在规划期所有命令都不运行。这与“其他平台按现有约定处理”一致。

## 模块责任与依赖

| 模块 | 负责什么 | 不负责什么 | 依赖与消费者 |
| --- | --- | --- | --- |
| `packages/agent/src/session-entries/planning.ts` | `plan_phase` v1、`plan` v1→v2 的 schema 与迁移 | 状态派生 | `SESSION_ENTRY_PAYLOADS` |
| `packages/agent/src/session-entries/permissions.ts` | `permission_mode` v3 与 v2→v3 迁移（票 07） | 模式的回放 | 同上 |
| `packages/agent/src/session-entries/context.ts` | `state_update` v2（`name` 增加 `plan`，票 09） | 渲染 | 同上 |
| `packages/agent/src/entries/plan-phase.ts`（新，浏览器安全） | 纯派生：`planPhaseOf`、`activePlanOf` | 写入、缓存 | server、renderer、`planning/state.ts`、`agents/{fork,handoff}.ts` |
| `packages/agent/src/entries/plan-text.ts`（新，票 09） | `plan` State Update 的渲染文本 | 值的计算 | `entries/state-updates.ts` |
| `packages/agent/src/planning/` | `<plan_mode>` 两份文本、`<approved_plan>`、`exit_plan_mode` 与 `complete_plan` 工具与模型可见文本、`nextPlanRef` 与 `approvedPlanToReinject` | 条目提交、计划阶段的状态 | server 的 plan 贡献、gate |
| `packages/agent/src/policy/{decide,gate,sandbox,paths}.ts`、`engine/{permission-wiring,types}.ts`、`tools/builtin/bash.ts` | 判定输入“是否规划中”、规划拒绝、沙箱档位推导、提权与固定档位的拒绝、拒绝文本 | 计划阶段从哪里来 | 运行时 |
| `apps/server/src/application/session-permissions.ts` | 每个 Session 的权限状态，**增加计划阶段**：回放、串行提交、进入与退出（含放弃）、计划审阅（`PlanReview`）、完成、读取视图、`runtimePermissions().planning`、回退后的重新计算 | 模型可见文本 | plan 贡献（经 `PlanHost`）、HTTP 路由、`SubagentService`、checkpoints |
| `apps/server/src/application/context/plan.ts` | 按计划阶段注册工具与注入 section、`plan` State Update 的值、`/plan` 动作 | 状态存储 | `PlanHost` |
| `apps/server/src/http/routes/plans.ts`（新） | `GET` / `POST /api/sessions/:id/plan` | 业务规则 | `SessionPermissions` |
| `packages/protocol/src/planning.ts` | 线上形状：`PlanPhase`、`PlanPhasePayload`、`PlanPayload` v2、`SessionPlanResponse`、`PlanActionRequest`、`planPaths` | — | renderer、server |
| `apps/desktop/src/renderer/...` | 从条目派生计划阶段与计划状态；Plan chip、模式菜单、审阅卡、计划卡、右栏 Plan 页 | 判定 | protocol、`@coko/agent/entries` |

计划阶段放在 `SessionPermissions` 的同一个状态对象里，而不是另起一个服务：它是判定输入，需要与模式、规则同一把锁串行提交，子 Session 取根 Session 状态的现成机制也直接适用。它仍是独立的字段与独立的条目，不与模式互相改写。

## 关键路径与接口

### 1. 条目

#### 1.1 `plan_phase` v1（新 kind，票 02）

记录计划阶段的一次转换。入库与推送同 `permission_mode`：经 `runtimes.commit` 提交，不带 runId（Run 中途提交时也不带）。

```ts
// agent: packages/agent/src/session-entries/planning.ts；protocol: packages/protocol/src/planning.ts（同形）
planPhaseSchema = Union([Literal('none'), Literal('planning'), Literal('executing')])          // protocol 名 PlanPhase
planPhasePayloadSchema = Union([                                                            // protocol 名 PlanPhasePayload
  Object({ phase: Literal('none') }, strict),
  Object({ phase: Literal('planning') }, strict),
  Object({ phase: Literal('executing'), planId: Id }, strict),
])
// 注册：plan_phase: [{ schema: planPhasePayloadSchema }]
```

当前阶段是有效条目中最后一条 `plan_phase`；没有时为 `{ phase: 'none' }`。阶段一只写 `none` 与 `planning`；`executing` 从票 09 起写入。

#### 1.2 `plan` v2（票 02 加 schema，票 10、11 开始写入新状态）

```ts
planStatusSchema = Union([Literal('proposed'), Literal('approved'), Literal('rejected'), Literal('completed'), Literal('abandoned')])
planPayloadSchema = Object({
  planId: Id, revision: Integer({ minimum: 1 }), markdown: String(), status: planStatusSchema,
  feedback: Optional(String()),   // rejected
  report: Optional(String()),     // completed：完成报告（Markdown，已替换登记明文）
}, strict)
// 注册：plan: [{ schema: planV1Schema }, { schema: planPayloadSchema, migrate: (previous) => previous }]
```

- `completed` 与 `abandoned` 条目沿用被执行的 approved 条目的 `planId`、`revision` 与 `markdown`（原文照录，便于界面与派生只看最后一条）。
- approved 的 Plan 是否“执行中”只由计划阶段决定：阶段为 `executing` 且 `planId` 相同。历史上已批准、没有对应阶段条目的 Plan 不算活动计划。
- 惯例上新增状态加一版（见事实表）；v1 schema 保留原三态，迁移为恒等。

#### 1.3 `permission_mode` v3（票 07）

```ts
permissionModePayloadSchema = Object({ mode: standardPermissionModeSchema }, strict)        // 四档，无 prior
// 注册：[{ v1 }, { v2, migrate: identity }, { v3, migrate: (p) => p.mode === 'plan' ? { mode: p.prior ?? 'default' } : { mode: p.mode } }]
```

只在读取时于内存中升级，不改写数据库行。旧数据中没有 `plan_phase`，因此升级后一律不在规划中。新写入为 v3。

#### 1.4 `state_update` v2（票 09）

`name` 增加字面量 `plan`，其余不变；v1→v2 恒等迁移。`STATE_UPDATE_NAMES` 末尾追加 `'plan'`：`['date', 'goal', 'todo_list', 'team', 'on_demand_tools', 'plan']`。

### 2. 派生规则（`packages/agent/src/entries/plan-phase.ts` 与 `planning/state.ts`）

- `planPhaseOf(entries)`：在 `effectiveEntries(entries)`（只应用回退，不应用压缩）中取最后一条 `plan_phase` 的 payload，没有时 `{ phase: 'none' }`。
- `activePlanOf(entries)`：返回 `PlanPayload | undefined`。
  - `planning`：从最后一条 `{ phase: 'planning' }` 之后的 `plan` 条目中取最后一条；它的状态为 `proposed` 时返回它，否则 undefined。
  - `executing`：`planId` 等于阶段 `planId` 的最后一条 `plan` 条目（应为 approved）。
  - `none`：undefined。
- `nextPlanRef(entries)`：有效条目中向前找；遇到 `plan` 条目时，状态为 `approved`、`completed` 或 `abandoned` 则新 planId、revision 1，否则沿用其 planId、revision 加一；遇到 `plan_phase { phase: 'planning' }` 停止并新建。票 02 起以 `plan_phase` 代替 `permission_mode { mode: 'plan' }` 作为停止点。
- `approvedPlanToReinject(entries)`：
  - 票 02–08 不变（最新 approved 条目早于最后一个有效 compaction 的 `firstKeptSeq` 即返回）。
  - 票 09 起：只在 `planPhaseOf` 为 `executing` 时，取该 `planId` 最新的 approved 条目；它的 seq 早于 `firstKeptSeq` 才返回。完成、放弃后与历史 Plan 都不再注入。截断规则不变。

服务端的计划阶段口径：票 02–05 与 Permission Mode 相同（`SessionPermissions.#own` 按原始条目顺序回放，最后一条 `plan_phase` 为准）；票 06 起改为 `planPhaseOf`（有效条目）。renderer 自票 04 起用 `planPhaseOf`。

### 3. 判定与沙箱（票 03）

#### 3.1 判定输入与位置

- `PermissionContext` 增加 `planning?: boolean`；`RuntimePermissions` 与 `PermissionGateOptions` 增加 `planning?: () => boolean`（每次判定现取，与 `mode()` 相同）。
- `DecisionStep` 增加 `'planning'`；`PermissionDecision` 的 deny 增加一种：`{ behavior: 'deny'; reason: 'planning' }`（原 `{ behavior: 'deny'; rule }` 不变）。
- `decideWithStep` 在拒绝规则之后、询问规则之前插入：

```ts
if (context.planning && category === 'write') return at('planning', { behavior: 'deny', reason: 'planning' })
```

  只作用于 write 类（`write`、`edit`、权限类 `edit`）。memory-write、session-state、context-read、team、agent（不带 isolation）、external、command、read 按 Permission Mode 走原有顺序。
- 判定顺序（目标）：拒绝规则 → **规划中拒绝写入** → 询问规则 → 受保护路径 → 越出可写根 → plan-exit 总询问 → 模式放行 → 允许规则 → 询问。
- 与外部 Hook 的组合：gate 中 Hook 的 deny 先于判定结果（不变，Hook 自己的文本）；`combinePreToolUse` 中判定为 deny 时结果为拒绝（不变，Hook 的 allow 与 ask 都不改变它）。`hookCall.matchesRule` 的判定以 `deny-rule` 步为准，不受新步影响。
- 拒绝文本：gate 中所有 `deniedByRule(decision.rule)` 的调用点（`beforeToolCall` 的直接拒绝、组合后的 `by: 'rule'` 拒绝、`askTool` 的重新判定、`recheck`）改为 `deniedText(decision)`：`reason: 'planning'` 时为 [T3 写入拒绝](#t3-写入拒绝)，否则 `deniedByRule(rule)`。规划中的写入不产生审批请求。
- 等待审批中的写入在用户进入规划后被重新判定：结果为 deny，请求以 superseded 结束，模型收到 T3（`reevaluate` 的既有机制）。

#### 3.2 沙箱档位

- `sandboxModeFor(mode, planning = false)`：`planning` 时 `'read-only'`，否则沿用现有映射。`writableRootsFor(mode, workspace, writeRoots, planning = false)` 同样以推导出的档位计算（规划中为空）。
- gate 的 `evaluate` 与 `permission-wiring.ts` 的 `prepare` 都传 `planning()`；`prepare` 中已批准的提权在规划中不存在（见下），因此执行档位即 read-only。
- 规划中可写根为空不影响写入判定（写入已在 `planning` 步拒绝），也不影响读取。

#### 3.3 提权、固定档位与隔离

- **提权。** gate 中 `sandboxRequest` 的检查：`checkEscalation(asked, sandboxModeFor(mode, planning))` 结果为 `escalate` 且规划中时，直接返回 [T4 提权拒绝](#t4-提权拒绝)，不询问、不检查“本 Run 是否被沙箱拒绝过”；结果为 `invalid` 时返回原有的参数错误文本；不在规划中时行为不变。
- **bash 的提权提示。** `SandboxPolicy` 增加 `planning?: true`（不能提权）；`prepare` 在规划中设置。bash 被沙箱拒绝时，拒绝标记不变，`planning` 时不追加提权提示，改为追加 [T5](#t5-规划中的沙箱拒绝标记)。
- **固定档位。** `fixedSandbox` 的档位严格宽于 `sandboxModeFor(mode, planning)` 时：规划中返回 [T6](#t6-向较宽终端输入的拒绝)；否则 read-only 模式下拒绝（原文本）、其余模式按一次提权询问（不变）。
- **Worktree 隔离。** gate 中“isolation 在 plan / read-only 下为错误结果”改为“规划中或 read-only 模式”；规划中的文本为 `isolation: worktree is not available in plan mode`（与现状 plan 模式下的文本逐字相同），read-only 下不变。`SubagentService` 派发处同样检查（`SubagentDeps` 增加 `planning(sessionId): Promise<boolean>`，取根 Session 的阶段；装配在 `apps/server/src/runtime/layers.ts`）。

#### 3.4 子 Session

- `runtimePermissions(state, …)` 返回 `planning: () => state.phase.phase === 'planning'`；子 Session 的 `state` 本就是根 Session 的状态对象，因此“是否规划中”取根 Session，根中途进入或退出即时生效。
- 有效模式（票 04 起）：`effectiveSubagentMode(rootMode, cap) = narrowerMode(rootMode, cap)`，不再把 plan 映射为 read-only；票 07 删除 `plan` 分支。

### 4. 注入与工具注册（`apps/server/src/application/context/plan.ts`）

section 与工具在 Run 开始时取值（现状机制）；判定与沙箱每次调用现取。

| 时机 | 根 Session | 子 Session |
| --- | --- | --- |
| Run 开始时阶段为 `planning` | `<plan_mode>`（[T1](#t1-根-session-的-plan_mode)）；注册 `exit_plan_mode`（plan-exit）；票 10 起另注册 `complete_plan`（session-state） | `<plan_mode>`（[T2](#t2-子-session-的-plan_mode)，取根 Session 的阶段）；不注册上述工具 |
| Run 开始时阶段为 `executing`（票 09 起） | 不注入 `<plan_mode>`；票 10 起注册 `complete_plan`；`<approved_plan>` 按 §2；`plan` State Update 的值见 §7 | 无 |
| Run 开始时阶段为 `none` | 无（`<approved_plan>` 在票 02–08 按旧规则） | 无 |

- 子 Session 由 `scope.parentSessionId !== undefined` 判断。`complete_plan` 另加入 `SUBAGENT_EXCLUDED_TOOLS`（定义的 tools 也不能加回）。
- `ruleTools`：`[{ name: 'exit_plan_mode', permissionClass: 'plan-exit' }, { name: 'complete_plan', permissionClass: 'session-state' }]`（后者票 10 加入）。规则以工具原名书写（`complete_plan`），与 `todo_write` 相同。
- section 名仍为 `plan_mode` 与 `approved_plan`，在 `SECTION_ORDER` 中的位置不变。
- 规划中途进入或退出：本 Run 的 section 与工具不变，到下一个 Run 才变化；写入拒绝与沙箱档位即时生效或解除。

### 5. 计划审阅与批准

`exit_plan_mode` 的参数、校验（`planMarkdownProblem`）、权限类 plan-exit、kind plan 的审批请求、不重新判定、`editedPlan`、带反馈与无反馈拒绝、停止时取消均不变。变化：

- `PlanReview.active()` 读计划阶段：`phase === 'planning'`（票 02）。不在规划中时返回现有的 `NOT_IN_PLAN_MODE_TEXT`（文本不变）。
- `PlanReview.approved(toolCallId, markdown)` 返回 `{ markdown }`（票 04 去掉 `mode`）。提交顺序：approved 的 `plan` 条目（编辑后为 revision 加一）→ 计划阶段条目 → 工具结果（工具执行后由运行时提交）。
  - 计划阶段条目：票 02–08 为 `{ phase: 'none' }`，只在当前阶段为 `planning` 时提交；票 09 起为 `{ phase: 'executing', planId }`，总是提交（审阅等待期间用户退出了规划后再批准，同样进入执行中：批准是用户的明确动作）。
  - 票 02–03：批准仍提交 `permission_mode`（恢复 prior），位置在计划阶段条目之后，与现状一致。票 04 起不再提交 `permission_mode`。
- `AnswerApprovalRequest` 的 allow 分支去掉 `mode`（票 04）：带 `mode` 的请求体不合 schema，400 `bad-request`，请求保持等待。`#answerPlan` 中“不能宽于 prior”的校验删除。
- 执行使用回答时 Session 的 Permission Mode。审阅等待期间切换模式（协议或审阅卡）照常提交 `permission_mode` 并重新判定 kind tool 的请求；kind plan 的请求不重新判定（不变）。
- 工具结果：票 04–08 为 [T7](#t7-批准结果阶段一)，票 09 起为 [T8](#t8-批准结果阶段二)。票 02–03 保持现有文本（`Proceed under <mode>`）。
- 规划中退出（阶段一与阶段二相同）不改动待审阅的 `plan` 条目，也不取消等待中的审批请求；之后批准按上文处理，拒绝照常提交 rejected。
- Goal Round 中审阅使 Goal 进入 waiting-input（`plan-review`），不变。

### 6. `complete_plan`（票 10）

- 定义：`packages/agent/src/planning/complete-plan.ts`，`COMPLETE_PLAN_TOOL = 'complete_plan'`，`createCompletePlanTool(port: { complete(report: string): Promise<void> })`，`effect: 'side-effect'`，`timeoutMs: 0`。名称、描述与参数说明见 [T9](#t9-complete_plan-的定义)。
- 参数：`{ report: string }`。校验在 `execute` 中进行，不合格抛出错误（错误结果），不提交条目：
  - 去掉首尾空白后为空：`the report is empty`；
  - 长度超过 `PLAN_MAX_CHARS`（64 000，按原文长度）：`the report is longer than 64000 characters`。
  - 文本模板见 [T10](#t10-complete_plan-的错误结果)。
- 权限类 session-state：所有 Permission Mode 由模式放行；拒绝规则、询问规则、Hook 照常生效；规划中不受写入拒绝影响。
- 注册：根 Session 在 Run 开始时阶段为 `planning` 或 `executing` 时注册（批准发生在 Run 中途，工具集在 Run 开始时取值）。
- 调用时现取阶段（`port.complete` 在 `SessionPermissions` 的锁内检查）：
  - 不为 `executing`：抛出“没有执行中的 Plan”（T10），不提交条目，阶段不变。
  - 成功：依次提交 `plan { planId, revision, markdown, status: 'completed', report }`（与执行中的 approved 条目相同的 planId、revision、markdown）、`plan_phase { phase: 'none' }`，返回 [T11](#t11-complete_plan-的成功结果)，运行时随后提交工具结果。
- 报告与其他非用户 payload 一样在入库与推送前替换登记明文；工具结果经 Secret 替换 hook。宿主不校验报告结构，不运行任何验证。

### 7. 执行中的 State Update `plan`（票 09）

- 贡献：plan 贡献的 `stateValues(scope)`，只对根 Session（`scope.parentSessionId === undefined`）给值：
  - 阶段为 `executing` 且找得到活动的 Plan：`{ plan: { planId, revision, title } }`，`title = planTitle(markdown)`；
  - 否则 `{ plan: null }`（从未送达过时不发送；送达过时发一次清空）。
- 渲染：`renderStateValue` 对 `plan` 调用 `planStateText(value)`（`packages/agent/src/entries/plan-text.ts`），见 [T12](#t12-state-update-plan)。清空使用 `planStateUpdates` 的通用文本，不另写。
- 送达时机、按值去重、回退与压缩后重发、时间线隐藏、分叉随消息复制，全部沿用 ADR 0024 的既有规则；值经 `redactSecretsDeep`。批准所在的 Run 不额外送达（模型从批准结果得知），下一个带新输入的 Run 开始时送达。

### 8. Session 计划接口与 `/plan`

#### 8.1 协议（`packages/protocol/src/planning.ts`）

```ts
/** GET / POST /api/sessions/:id/plan 的响应。 */
SessionPlanResponse = Object({ phase: PlanPhase, plan: Union([PlanPayload, Null()]) }, strict)

/** POST /api/sessions/:id/plan：enter 进入规划，exit 退出规划（执行中为放弃）。 */
PlanActionRequest = Object({ action: Union([Literal('enter'), Literal('exit')]) }, strict)

planPaths = {
  /** GET：SessionPlanResponse；POST：PlanActionRequest → SessionPlanResponse。 */
  sessionPlan: (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/plan`,
}
```

- `phase` 为当前阶段；`plan` 为活动的 Plan（`activePlanOf`）：规划中且有待审阅的计划时为它，执行中为被执行的计划，否则 `null`。
- 路由：`apps/server/src/http/routes/plans.ts`（`plansRoutes(app)`，`r.get('/sessions/:id/plan')`、`r.post('/sessions/:id/plan')`），登记在 `routes/index.ts` 的 `DOMAIN_ROUTES`。读取在票 02 加入，动作在票 04 加入。

#### 8.2 读取

- `GET`：200 `SessionPlanResponse`。子 Session 返回根 Session 的阶段与活动 Plan（与权限读取一致）。未知 Session 404 `not-found`。

#### 8.3 动作（`SessionPermissions.planAction(sessionId, action)`，在该 Session 的锁内）

| 当前阶段 | `enter` | `exit` |
| --- | --- | --- |
| `none` | 提交 `plan_phase { planning }` | 不提交 |
| `planning` | 不提交 | 提交 `plan_phase { none }`；不改动待审阅的 `plan` 条目与等待中的审批 |
| `executing`（票 11 起） | 依次提交 `plan { …活动计划, status: 'abandoned' }`、`plan_phase { none }`、`plan_phase { planning }` | 依次提交 `plan { …, status: 'abandoned' }`、`plan_phase { none }`；不触碰文件与 Checkpoint |

- 票 09–10 的过渡：`executing` 时 `exit` 只提交 `plan_phase { none }`，`enter` 只提交 `plan_phase { planning }`（不写 abandoned）；票 11 改为上表。
- 结果：200 `SessionPlanResponse`（提交之后的状态）。
- 错误：未知 Session 404 `not-found`；子 Session 409 `child-session`（`A subagent session uses the plan of its root session`）；请求体不合 schema 400 `bad-request`；提交失败按现有映射（`storage-unavailable` 等）。与切换 Permission Mode 相同，不检查归档，Run 进行中照常可用。
- Run 进行中的效果：写入拒绝与沙箱档位从下一次判定起生效或解除；本 Run 的 section 与工具不变。执行中放弃后，本 Run 再调用 `complete_plan` 得到 T10 的“没有执行中的 Plan”。
- 每次提交的 `plan_phase` 都进入审计序列（§9.3）。

#### 8.4 `/plan`

- `/plan [消息]`：调用 `enter`；有消息时随后作为普通提交（202 `{ runId }`），没有时 204。
- `/plan off`（不区分大小写，独占整段参数）：调用 `exit`，204。
- Run 进行中以 `run-in-progress` 拒绝（不是 `whileRunning`，不变）。
- 新对话中输入 `/plan 消息`：经首次发送（`text` 为原文）创建 Session，提交展开为 `/plan` 动作，进入规划后提交消息；只有 `/plan` 没有消息时首次发送以 400 `A message is required` 拒绝（现状）。
- 票 02–03 期间 `/plan` 仍经 `setMode('plan')`（同时提交 `plan_phase`）；票 04 起改为调用上表动作，不再改变模式。
- 命令描述（`packages/agent/src/instructions/commands/builtin.ts`）不变：`Plan before making changes (read-only until you approve)`，`[message | off]`。

### 9. 其他协议与入口的变化

#### 9.1 Permission Mode

- 票 04：`SetPermissionModeRequest.mode` 与 `FirstSendRequest.permissionMode` 改为 `StandardPermissionMode`，`plan` 为 400 `bad-request`（schema 校验）。`SessionPermissions.setMode` 不再有 `plan` 分支。
- 票 07：`PermissionMode` 类型只剩四档（agent 与 protocol 的 `permissionModeSchema` / `PermissionMode` 即 `StandardPermissionMode`）；`SessionPermissionsResponse` 去掉 `prior`；判定、沙箱映射、`modeRank`、`effectiveSubagentMode`、`MODE_ICONS`、Shift+Tab 循环中针对 `plan` 的分支删除。`CYCLED_PERMISSION_MODES` 不变。

#### 9.2 无界面运行与 Hook

- `apps/server/src/headless/args.ts`：`MODES` 去掉 `plan`（票 04）。`--permission-mode plan` 以 `UsageError` 退出，文本 `--permission-mode must be one of read-only, default, accept-edits, full-access`。
- Hook 输入的 `permission_mode`：票 04 起进入规划不再改变模式，`options.mode()` 即真实模式，无需改代码；不新增字段。生命周期事件同理。

#### 9.3 审计

- 新事件：`audit('plan_phase', { phase: Type.String(), planId: Type.Optional(Id) })`，在 `audit.ts` 中由 `plan_phase` 条目生成（票 02）。
- `permission_mode` 事件去掉 `prior`（票 07；读取时已迁移，事件只带 `mode`）。

### 10. 回退、分叉与交接

#### 10.1 回退（票 06）

- 计划阶段与 Plan 的状态按有效条目回放：`SessionPermissions` 中阶段改用 `planPhaseOf`，并在回退提交 `rewind` 条目后重新计算（`checkpoints.ts` 在 `runtimes.commit(rewind)` 之后调用 `permissions.rewound(sessionId)`：重读条目、重算阶段、清掉该 Session 的待审阅记录 `#plans`）。纯文件回退（code）不提交 `rewind` 条目，不重算。
- Permission Mode 的回退口径不改（仍按原始条目回放）。
- 回退目标是用户消息，计划阶段条目落在消息之间：
  - 回退到 `/plan 消息` 之前的某条消息：`plan_phase { planning }` 在被回退的区间内，读回 `none`；下一个 Run 没有 `<plan_mode>` 与提交工具。
  - 回退到 `/plan 消息` 提交的那条消息本身：阶段条目在它之前，仍为 `planning`（这条消息就是在规划中发出的）。
  - 回退到批准所在 Run 的用户消息：approved 条目与之后的阶段条目被回退，读回 `planning`，写入再次被拒；被回退的 approved 记录不再算作当前计划，`nextPlanRef` 沿用回退后最后一条 `plan` 条目续号。
  - 阶段二：回退到完成或放弃之前，`completed` / `abandoned` 与 `plan_phase { none }` 被回退，读回 `executing`，Plan 回到已批准（执行中）。
- renderer 的派生与服务端同口径（都用 `planPhaseOf`）。

#### 10.2 分叉（`packages/agent/src/agents/fork.ts`）

- 边界处的阶段：`user-before` 取 `seq < targetSeq` 的有效条目，`assistant-inclusive` 取 `seq <= targetSeq` 的有效条目，以 `planPhaseOf` 计算。
- 边界处为 `planning`：在复制的条目末尾追加一条 `{ kind: 'plan_phase', payload: { phase: 'planning' } }`；`none` 与 `executing`：不追加。`plan` 条目不复制（不变）。
- 票 02 的过渡口径：阶段取与被复制的 `permission_mode` 相同的范围（`assistant-inclusive` 时为全部有效条目，`user-before` 时为边界前），使新 Session 的 `plan` 模式与“规划中”一致；票 06 改为上述边界口径。

#### 10.3 交接（`packages/agent/src/agents/handoff.ts`）

- 源 Session 当前（有效条目）阶段为 `planning` 时，`handoffTargetEntries` 在复制的权限条目之后追加 `plan_phase { planning }`；其余不追加。票 02 加入，票 06 补测试。

### 11. 界面

#### 11.1 派生（renderer）

- 计划阶段：`planPhaseOf(conversation.entries)`（票 04 起）。子会话视图不显示 chip。
- 计划卡与 Plan 页的状态标签：`proposed`、`rejected`、`completed`、`abandoned` 按条目；`approved` 在 `planPhaseOf` 为 `executing` 且 `planId` 相同时显示“执行中”，否则“已批准”（含历史上已批准的 Plan）。
- 删除 `restoredMode`（`plan-review-panel.tsx`）与模式菜单的 `prior` 参数（票 04）；`sessionPermissionMode` 保留（票 07 后不会再读到 `plan`）。

#### 11.2 组件

- **模式菜单**（票 04）：始终显示并勾选当前 Permission Mode；规划中可切换且不退出规划；Shift+Tab 只切换模式。
- **Plan chip**（票 04、09、11）：阶段为 `planning` 时显示 `plan.chip`，`executing` 时显示 `plan.chipExecuting`；`none` 时不渲染。× 调 `POST …/plan { action: 'exit' }`，等待响应；失败保留显示并经现有失败通道提示（`onFailure`），文字草稿与其他配置不变；成功后焦点回编辑区。关闭按钮的可访问名称：规划中 `plan.exit`，执行中 `plan.abandon`。样式与几何不变，执行中的 × 不弹确认。草稿不显示 chip。
- **审阅卡**（票 04、05）：主按钮 `plan.review.approve`（“批准并执行”），去掉下拉“批准并允许编辑”与“恢复为…”（`data-restores`）。票 05：卡上标出 `plan.review.permission`（“执行权限”）并放入现有 `ModePicker`（同一组件，选择完全访问权限仍先确认风险），切换调用现有的 `setPermissionMode`，失败时卡片保留原显示并提示，审批请求仍可回答。
- **计划卡与 Plan 页**（票 09–11）：新增状态“执行中”“已完成”“已放弃”；已完成在 Plan 页显示完成报告（静态 Markdown，标题 `plan.report`），计划卡显示状态与“在侧边栏查看”；没有右栏可开（历史、只读）时计划卡展开后在正文前显示同一份报告（与 Plan 页共用 `PlanReport`）。
- **新对话草稿**（票 07）：持久化的 `permissionMode: 'plan'` 读取时按未设置处理（`new-chat-store.ts`），首次发送不带它。

#### 11.3 文案（`packages/i18n/src/dictionaries/domains/plan.ts`，中英同构）

| 键 | 中文 | English | 票 |
| --- | --- | --- | --- |
| `chipExecuting`（新） | 执行中 | Executing | 09 |
| `abandon`（新） | 放弃计划 | Abandon plan | 11 |
| `status.executing`（新） | 执行中 | In progress | 09 |
| `status.completed`（新） | 已完成 | Completed | 10 |
| `status.abandoned`（新） | 已放弃 | Abandoned | 11 |
| `report`（新） | 完成报告 | Completion report | 10 |
| `review.permission`（新） | 执行权限 | Runs with | 05 |
| `empty`（改） | 还没有计划。输入 /plan 进入规划后，Agent 提交的计划会显示在这里。 | No plan yet. After you enter planning with /plan, the plan the agent submits appears here. | 04 |
| `mode`、`modeDescription`、`exitHint`、`review.restores`、`review.more`、`review.approveAcceptEdits`（删） | — | — | 04（`mode` 在 07 随模式图标一起删除） |

### 12. 模型可见文本（定稿）

以下文本为契约，实施时逐字使用；`${…}` 为插值。

#### T1 根 Session 的 `<plan_mode>`

票 03 的过渡版（Permission Mode 仍为 `plan`，其余调用仍按 read-only 询问）：

```text
<plan_mode>
Plan mode is active. Research and design only: the user reviews your plan before anything in the Workspace changes.
- File writes (write, edit) are refused while planning. Put the changes you intend to make in the plan instead.
- Commands run in a read-only sandbox and cannot be escalated; a command that writes files fails.
- Reads and searches are allowed; other calls may need the user's approval.
When the plan is ready, call exit_plan_mode with the complete plan as Markdown starting with a # heading. If the user sends feedback, keep planning and submit a revised plan. Once the user approves, plan mode ends and the tool result tells you how to proceed.
</plan_mode>
```

票 04 起的最终版（第三条改为按当前权限处理）：

```text
<plan_mode>
Plan mode is active. Research and design only: the user reviews your plan before anything in the Workspace changes.
- File writes (write, edit) are refused while planning. Put the changes you intend to make in the plan instead.
- Commands run in a read-only sandbox and cannot be escalated; a command that writes files fails.
- Other calls (reads, searches, MCP tools, memory, todo and goal tools) follow the session's current permission mode.
When the plan is ready, call exit_plan_mode with the complete plan as Markdown starting with a # heading. If the user sends feedback, keep planning and submit a revised plan. Once the user approves, plan mode ends and the tool result tells you how to proceed.
</plan_mode>
```

#### T2 子 Session 的 `<plan_mode>`

票 03 起：

```text
<plan_mode>
The parent session is in plan mode, so this task must not change the Workspace. File writes (write, edit) are refused and commands run in a read-only sandbox that cannot be escalated. Research, then report your findings and the changes you would make to the parent agent.
</plan_mode>
```

#### T3 写入拒绝

```text
Refused: plan mode is active, so file writes are blocked until the user approves a plan. Do not retry or work around this; describe the intended change in the plan (or in your report to the parent agent) instead.
```

#### T4 提权拒绝

```text
invalid escalation: plan mode is active, so commands run in a read-only sandbox and cannot be escalated. Do not retry; describe the step that needs write access in the plan instead.
```

#### T5 规划中的沙箱拒绝标记

拒绝标记 `[sandbox: file access denied under read-only mode]` 不变，其后的提权提示替换为：

```text
[sandbox: escalation is not available in plan mode]
```

#### T6 向较宽终端输入的拒绝

```text
Not sent: ${what} was started under the ${fixed} sandbox, but plan mode only allows the read-only sandbox; input to it would run with that access. Start a new terminal job instead.
```

`${what}` 为现有的 `background job <id>`，`${fixed}` 为 Job 启动时的档位。read-only 模式下沿用现有 `fixedSandboxRefusedText`。

#### T7 批准结果（阶段一）

票 04–08：

```text
The user approved the plan. Plan mode has ended: ignore the earlier <plan_mode> instructions and carry out the plan.

${markdown}
```

#### T8 批准结果（阶段二）

票 09 起：

```text
The user approved the plan. Plan mode has ended: ignore the earlier <plan_mode> instructions and carry out the plan:
1. First break the plan into steps with todo_write.
2. Do the work and verify it, for example by running the relevant tests or checks.
3. When the work is done, call complete_plan with a report that goes through the plan item by item: what you did, how you verified it, and anything you did not do or did differently, with the reason.

${markdown}
```

#### T9 `complete_plan` 的定义

- label：`Complete plan`
- description：

```text
Finish the approved plan you are carrying out by submitting a completion report. Call it once, after the work is done and verified. Go through the plan item by item: what you did, how you verified it, and anything you did not do or did differently, with the reason. The user does not need to approve it.
```

- 参数 `report` 的 description：

```text
The completion report as Markdown, following the approved plan item by item.
```

#### T10 `complete_plan` 的错误结果

- 参数不合格：`` `Invalid report: ${problem}. Call complete_plan again with the complete report.` ``，`problem` 为 `the report is empty` 或 `the report is longer than 64000 characters`。
- 没有执行中的 Plan：

```text
No plan is being carried out: there is no approved plan in progress (it was completed or abandoned, or none was approved). Continue with the task.
```

#### T11 `complete_plan` 的成功结果

```text
The plan is complete and your report was recorded; the user sees it with the plan. Continue only if the user asks for more.
```

#### T12 State Update `plan`

值：`{ planId: string, revision: number, title: string }`。渲染（块的包装由 `planStateUpdates` 生成）：

```text
An approved plan is still in progress: "${title}" (revision ${revision}). Keep carrying it out; when the work is done and verified, call complete_plan with a report against the plan.
```

清空：通用文本 `This item currently has no content. Previous updates with this name no longer apply.`

#### 不变的文本

`invalidPlanText`、`NOT_IN_PLAN_MODE_TEXT`、`planFeedbackText`、`<approved_plan>`、`exit_plan_mode` 的名称、描述与参数说明、`isolation: worktree is not available in plan mode`（规划中）与 read-only 下的各条拒绝文本保持现状。

## 状态 持久化与失败

### 计划阶段的转换

```text
            /plan · enter                    批准（票 09 起）
   none ──────────────────▶ planning ──────────────────────▶ executing
    ▲   ◀────────────────── │  ▲     批准（票 04–08）→ none     │
    │   /plan off · exit    │  │                                │
    │                       │  └──── /plan · enter（先放弃）◀───┤
    └────────────────────────────── complete_plan · /plan off · exit（放弃）
```

- 不变量：任一时刻至多一份活动的 Plan；`executing` 的 `planId` 指向一条 approved 的 `plan` 条目。
- 提交点：每次转换是一条 `plan_phase` 条目（放弃与完成先提交 `plan` 条目，再提交阶段条目，在同一把锁内顺序提交）。重启后由回放恢复，进程内不另存状态；待审阅记录 `#plans` 在重启后丢失，与现状一致（Run 中断时审批也随之结束）。
- 部分失败：放弃时 `plan { abandoned }` 已提交而阶段条目提交失败，接口返回错误，读回为 `executing` 且 Plan 的最后一条为 abandoned；重试 `exit` 会再提交一条 abandoned 与阶段条目。`activePlanOf` 以阶段为准，因此读回仍显示执行中的计划，界面保持 chip 并提示失败。完成时同理（工具返回提交失败的错误结果，Run 按现有“记录保存失败”处理）。

### 过渡状态

1. **票 02 到 07：`plan` 模式与计划阶段并存。**
   - 02：进入路径（切换接口设 `plan`、`/plan`、首次发送带 `plan`）在提交 `permission_mode { plan, prior }` 之后提交 `plan_phase { planning }`；退出路径（`/plan off`、Plan chip、从 `plan` 选其他模式、批准）在提交 `permission_mode` 之前或之后提交 `plan_phase { none }`（批准时 approved 条目 → `plan_phase none` → `permission_mode`）。已在该阶段时不重复提交。工具注册、section 注入、`active()` 与 `nextPlanRef` 读计划阶段；判定仍按 `plan` 模式。升级前已停在 `plan` 模式的 Session 没有阶段条目：不再注入 `<plan_mode>`、没有 `exit_plan_mode`，判定仍按 `plan` 模式（类似 read-only），由 07 的读取迁移收尾。
   - 03：规划约束由阶段施加，模式仍为 `plan`（其余调用仍按 read-only 询问），`<plan_mode>` 用 T1 的过渡版。
   - 04：进入与退出不再改变模式；切换接口与首次发送拒绝 `plan`；没有新路径会写入 `plan` 模式，但旧 Session 读回的 `plan` 模式仍存在（模式菜单显示与图标需容忍它直到 07）。持久化草稿中残留的 `plan` 在 04 之后首次发送会得到 400，因此 04 在发送时把草稿的 `plan` 当作未设置（读取侧的处理仍属 07）。
   - 07：读取迁移后不再有 `plan` 模式；过渡结束。
2. **票 08 到 09：批准后阶段为“无”。** 此期间批准的 Plan 与升级前的历史 Plan 相同，不算执行中；`<approved_plan>` 仍按旧规则在压缩后注入最新 approved 计划，直到 09 改为只注入执行中的计划。
3. **票 09 到 11：执行中的结束出口不完整。** 09 中 T8 与 T12 已提到 `complete_plan`，但工具在 10 才注册；执行中的 `exit` 只把阶段置为 `none`、`enter` 只提交 `planning`，不写 abandoned（11 改为放弃）。

### 兼容与迁移

- 新版本读取旧数据：`permission_mode` v1/v2 经迁移读为四档（`plan` 取 `prior`，缺省 default）；没有 `plan_phase` 即“无”；`plan` v1 经恒等迁移；`state_update` v1 经恒等迁移。数据库行不改写，不新增 SQLite schema 版本。
- 旧版本应用读取新版本写入的数据：`plan_phase` 是未注册的 kind，`permission_mode` v3、`plan` v2、`state_update` v2 的版本号高于它已知的版本，这些条目都被跳过并报告 invalid entry，库文件不被隔离，seq 留下空缺。后果：
  - 旧应用不知道计划阶段，按它能读到的最后一条 `permission_mode`（v1/v2）判断是否在 plan 模式；新应用中进入规划的 Session 在旧应用里不在规划中。
  - 新应用创建或切换过模式的 Session，旧应用读到的是更早的 v1/v2 记录或缺省 default，可能比新应用中的模式更宽或更窄。
  - 新应用写入的全部 `plan` 条目在旧应用的时间线与 Plan 页不可见；配对的 State Update 块在旧时间线显示为普通文本（与 [上下文管理](../../docs/subsystems/context.md) 现有的降级说明相同）。
  - 因此不提供降级保证；票 07 把这一点写入兼容说明。

## 备选方案与选择

长期理由见 [ADR 0028](../../docs/adr/0028-plan-phase-not-permission-mode.md)。本设计层面的取舍：

- **计划阶段的归属：放进 `SessionPermissions`，不另起服务。** 另起 `SessionPlans` 需要复制根 Session 解析、串行锁与缓存回放，并在 02–04 期间与模式切换双向调用。代价是 `session-permissions.ts` 继续增大；阶段仍是独立字段与条目。
- **规划中写入拒绝的表示：新增 deny 变体与 `planning` 步。** 也考虑过把它做成一条合成的拒绝规则：会让 `deniedByRule` 的文本说成“被规则拒绝”，审计与 Hook 的 `matchesRule` 也会把它当成用户规则。
- **`plan` 与 `state_update` 加版本 vs 原地扩大 v1。** 原地扩大对旧应用更友好（只跳过新状态的条目），但与项目对增量变化加一版的惯例不一致，且同一版本号下 schema 不同。选择加版本，降级后果在兼容说明中写明。
- **执行中再进入规划的条目：abandoned → none → planning。** 规格写作“先按放弃处理，再提交规划中”，放弃即 abandoned 加“无”；省掉中间的“无”能少一条，但审计与回放会少一次完整的放弃。按规格照录。
- **`complete_plan` 的注册时机：规划中或执行中开始的 Run。** 只在执行中注册会让批准后的同一个 Run 没有这个工具（规格的补充决定 3）。规划中调用得到“没有执行中的 Plan”的错误。
- **规划中的提权：直接返回错误而不是先询问。** 询问后批准会让写入发生，违背硬性禁止。
- **bash 拒绝后的提示：替换为 T5 而不是省略。** 省略后模型只看到拒绝标记，容易换方式重试。

## 验证与实施顺序

测试只断言外部事实（协议读回、faux 请求日志、磁盘文件、真实浏览器），沿用规格列出的五处接缝，不新增接缝。

| 规格场景 | 测试接口或真实入口 | 观察结果 | 依赖与文档影响 |
| --- | --- | --- | --- |
| 进入规划不改模式（1–6、15–21） | Sidecar：`POST …/plan`、`/plan`、`GET …/permission-rules`、`GET …/plan`；faux 请求日志 | 模式读回不变；命令与 MCP 询问与否同未规划；system 中有 T1 | 04；plan-mode、permissions、workbench |
| 写入拒绝与沙箱（7–14） | Sidecar（darwin 沙箱）；`decide.test.ts` 表测试（模式 × 规划中 × 工具类型）；`sandbox.test.ts` | 结果为 T3、无 `approval_request`、文件不存在或逐字节不变；允许规则与 Hook allow 仍拒；写文件命令带 T5 失败；提权为 T4 且无审批；PTY 输入 T6 | 03；permissions、execution、hooks |
| 审阅与批准（22–30） | Sidecar；renderer Browser Mode | 条目顺序（审批决定、工具执行、approved、`plan_phase`、工具结果），无 `permission_mode`；带 `mode` 400；等待中切模式后按新模式判定 | 04、05；plan-mode、workbench |
| Subagent（31–34） | Sidecar 子代理用例 | 子 Session 写入 T3、只读沙箱、有效模式为较窄者、system 中 T2；isolation 派发被拒 | 03、04；subagents |
| 回退、分叉、交接（35–37、66–67） | Sidecar 回退、分叉、交接用例；`fork.test.ts`、`handoff.test.ts` | `GET …/plan` 读回；回退后写入再次被拒；分叉与交接的新 Session 阶段 | 06、11；plan-mode、handoff |
| 定时任务、无界面、Hook（38–40） | Sidecar 定时任务与 Hook 用例；headless 子进程 | 规划中的定时 Run 有 T1 且写入被拒；`--permission-mode plan` 参数错误；PreToolUse 收到真实模式 | 04；headless、hooks、schedules |
| 旧数据（41–44） | 条目版本测试（`session-entries.test.ts`）；Sidecar 预置 v2 `plan` 记录；renderer 草稿测试 | 读回模式为 `prior`（缺省 default）、数据库行版本仍为 2、不在规划中、计划可见 | 07；permissions、tracing |
| 执行中与提醒（45–51） | Sidecar 跨 Run；faux 请求日志；`state-updates.test.ts` | 阶段 `executing`；下一个 Run 首条 user message 带 T12；值不变不重复；压缩后 `<approved_plan>` 只在执行中 | 09；plan-mode、context、workbench |
| 完成（52–59、68） | Sidecar；`secrets-gate-plan.test.ts`；`definitions.test.ts` | 条目顺序 completed → `plan_phase none` → 工具结果；四种模式不询问；错误情形不提交；子 Session 无此工具；明文被替换；清空送达一次 | 10；plan-mode、permissions、workbench |
| 放弃与重新规划（60–65） | Sidecar；renderer | abandoned 与阶段条目；文件逐字节不变；新 planId 从 revision 1；本 Run 的 `complete_plan` 出错 | 11；plan-mode、commands、workbench |
| 端到端 | Electron E2E（后台模式）`apps/desktop/e2e/plan.e2e.test.ts` | 见票 08、12 | 08、12 |

最小端到端切片是票 02 的“计划阶段条目 + 读取接口”：之后每张票在全仓通过的前提下逐步把约束与入口从 `plan` 模式挪走。

### 各票主要触及的文件

以下为起点而非穷尽清单；测试文件列出现有的、按新行为需要更新或扩展的那些。

| 票 | 产品代码 | 测试 | 文档 |
| --- | --- | --- | --- |
| 02 计划阶段条目与读取 | `packages/agent/src/session-entries/planning.ts`；`packages/protocol/src/planning.ts`；`packages/agent/src/entries/{plan-phase.ts（新）,index.ts}`；`packages/agent/src/planning/{state.ts,exit-plan-mode.ts}`（`PlanReview` 注释与 `active`）；`apps/server/src/application/session-permissions.ts`（`phase` 回放、各进入退出路径补提交、`review().active`、`approved` 的阶段条目、`sessionPlan()`）；`apps/server/src/application/context/plan.ts`（`PlanHost.phase`）；`packages/agent/src/agents/{fork,handoff}.ts`；`packages/agent/src/observability/audit.ts`、`packages/protocol/src/trace.ts`；`apps/server/src/http/routes/{plans.ts（新）,index.ts}` | `tests/integration/sidecar-plan.test.ts`；`packages/agent/src/planning/planning.test.ts`；`packages/agent/src/session-entries/session-entries.test.ts`；`packages/agent/src/agents/{fork,handoff}.test.ts`；`apps/server/src/application/session-permissions.test.ts` | `docs/subsystems/plan-mode.md`；`packages/protocol/README.md`、`packages/agent/README.md` 的条目清单 |
| 03 规划约束 | `packages/agent/src/policy/{decide,gate,sandbox,paths}.ts`；`packages/agent/src/engine/{permission-wiring,types}.ts`；`packages/agent/src/ports/exec.ts`（`SandboxPolicy.escalation`）；`packages/agent/src/tools/builtin/bash.ts`；`packages/agent/src/planning/prompt.ts`（T1 过渡版、T2）；`apps/server/src/application/{session-permissions.ts,subagents.ts,context/plan.ts}`；`apps/server/src/runtime/layers.ts` | `packages/agent/src/policy/{decide,sandbox,escalation,gate-hooks}.test.ts`；`packages/agent/src/extensions/hooks/hooks.test.ts`；`tests/integration/{sidecar-plan,sidecar-sandbox,sidecar-pty,sidecar-subagents-isolation,sidecar-subagents-permissions,sidecar-hooks}.test.ts` | `docs/subsystems/{permissions,plan-mode,subagents,execution,hooks}.md` |
| 04 规划不改模式 | `apps/server/src/application/{session-permissions.ts,context/plan.ts,sessions.ts}`；`apps/server/src/http/routes/plans.ts`（POST）；`packages/protocol/src/{permissions.ts,http.ts,planning.ts}`；`apps/server/src/headless/args.ts`；`packages/agent/src/agents/definitions.ts`；`packages/agent/src/planning/{exit-plan-mode.ts,prompt.ts}`；`apps/desktop/src/renderer/client/api.ts`；`apps/desktop/src/renderer/stores/{chat-store.ts,new-chat-store.ts}`；`apps/desktop/src/renderer/features/conversation/{plan-chip,mode-picker,plan-review-panel,conversation-pane}.tsx`；`apps/desktop/src/renderer/testing/fixture-chat.ts`；`packages/i18n/src/dictionaries/domains/plan.ts` | `tests/integration/{sidecar-plan,sidecar-permissions,sidecar-subagents-permissions,sidecar-hooks,sidecar-schedules,sidecar-goal,headless}.test.ts`；`apps/server/src/application/{plan-rules,session-permissions}.test.ts`；`apps/desktop/src/renderer/features/conversation/plan.browser.test.tsx`；`apps/desktop/src/renderer/stores/chat-store-permissions.test.ts` | `docs/subsystems/{plan-mode,permissions,subagents,headless,hooks,workbench}.md` |
| 05 审阅卡切换权限 | `apps/desktop/src/renderer/features/conversation/{plan-review-panel,approval-panel,conversation-pane,mode-picker}.tsx`；`packages/i18n/src/dictionaries/domains/plan.ts` | `plan.browser.test.tsx`；`tests/integration/sidecar-plan.test.ts`（审阅中收紧与放宽） | `docs/subsystems/{plan-mode,workbench}.md` |
| 06 回退、分叉、交接 | `apps/server/src/application/{session-permissions.ts,checkpoints.ts}`；`packages/agent/src/entries/plan-phase.ts`；`packages/agent/src/agents/{fork,handoff}.ts`；renderer 派生调用点 | `tests/integration/{sidecar-rewind,sidecar-plan,sidecar-handoff,sidecar-state-update-fork}.test.ts`；`packages/agent/src/agents/{fork,handoff}.test.ts` | `docs/subsystems/{plan-mode,handoff}.md` |
| 07 移除 `plan` 模式 | `packages/agent/src/session-entries/permissions.ts`（v3）；`packages/protocol/src/{permissions,trace}.ts`；`packages/agent/src/policy/{decide,sandbox,gate}.ts`；`packages/agent/src/agents/definitions.ts`；`packages/agent/src/observability/audit.ts`；`apps/server/src/application/session-permissions.ts`；`apps/desktop/src/renderer/features/{conversation/mode-picker.tsx,settings/permissions-section.tsx}`；`apps/desktop/src/renderer/stores/{chat-store,new-chat-store}.ts`；`packages/i18n/src/dictionaries/{zh.ts,en.ts,domains/plan.ts}` | `packages/agent/src/session-entries/session-entries.test.ts`（v2→v3，含读回数据库原始版本号）；`packages/agent/src/policy/{decide,sandbox}.test.ts`；`packages/agent/src/agents/definitions.test.ts`；`tests/integration/sidecar-plan.test.ts`（旧数据）；renderer 草稿与模式菜单测试；其余引用 `plan` 模式的测试逐个核对 | `docs/subsystems/{permissions,tracing}.md`；兼容说明 |
| 08 阶段一验收 | `apps/desktop/e2e/plan.e2e.test.ts` | Electron E2E | `GLOSSARY.md`（Plan Mode）；ADR 0028 → partial；导航中的 Plan Mode 摘要；证据文档 |
| 09 执行中与提醒 | `apps/server/src/application/{session-permissions.ts,context/plan.ts}`；`packages/agent/src/planning/{exit-plan-mode.ts,state.ts}`；`packages/agent/src/entries/{state-updates.ts,plan-text.ts（新）,plan-phase.ts}`；`packages/agent/src/session-entries/context.ts`、`packages/protocol/src/context-entries.ts`（`state_update` v2）；`apps/desktop/src/renderer/features/{conversation/plan-chip.tsx,conversation/plan-card.tsx,conversation/plan-review-panel.tsx,right-panel/plan-tab.tsx}`；i18n | `tests/integration/{sidecar-plan,sidecar-compaction}.test.ts`；`packages/agent/src/entries/state-updates.test.ts`；`packages/agent/src/planning/planning.test.ts`；`plan.browser.test.tsx` | `docs/subsystems/{plan-mode,context,workbench}.md` |
| 10 `complete_plan` | `packages/agent/src/planning/{complete-plan.ts（新）,index.ts}`；`packages/agent/src/agents/definitions.ts`（排除）；`apps/server/src/application/{context/plan.ts,session-permissions.ts}`；renderer 计划卡与 Plan 页；i18n | `tests/integration/{sidecar-plan,secrets-gate-plan}.test.ts`；`packages/agent/src/planning/planning.test.ts`；`packages/agent/src/agents/definitions.test.ts`；`plan.browser.test.tsx` | `docs/subsystems/{plan-mode,permissions,workbench}.md` |
| 11 放弃与重新规划 | `apps/server/src/application/{session-permissions.ts,context/plan.ts}`；renderer Plan chip、计划卡与 Plan 页；i18n | `tests/integration/{sidecar-plan,sidecar-rewind,sidecar-handoff}.test.ts`；`packages/agent/src/agents/fork.test.ts`；`plan.browser.test.tsx` | `docs/subsystems/{plan-mode,commands,workbench}.md` |
| 12 阶段二验收 | `apps/desktop/e2e/plan.e2e.test.ts` | Electron E2E | `GLOSSARY.md`（Plan）；ADR 0028 → implemented；`docs/subsystems/{todo,goal,tracing}.md`；导航摘要；证据文档 |

## 待决问题与确认

- **批准依据。** 规格于 2026-11-20 由用户确认（含“具体路径在设计阶段确定”的授权），01 票把架构设计交给本设计；本页在该授权内做工程判断并标为 approved，没有新的产品决定。下列超出规格字面、属于工程判断的取舍请审阅时留意，均不阻塞实施：
  1. `plan` 与 `state_update` 也按惯例加一版（规格只写了 `permission_mode` 升版）；后果是旧应用跳过新应用写入的全部计划条目与 State Update。
  2. State Update 名为 `plan`，值为 `{ planId, revision, title }`，清空用通用文本。
  3. 审阅等待期间退出规划后再批准：阶段一不再提交阶段条目，阶段二进入执行中。
  4. 规划中 bash 的沙箱拒绝后附 T5 替代提权提示；无 `sandbox-exec` 的平台在规划期所有命令都不运行。
  5. 计划阶段的状态放在 `SessionPermissions` 中；回退后由 checkpoints 通知重新计算。
  6. 票 04 在首次发送时就把草稿中残留的 `plan` 当作未设置（规格把草稿处理放在 07），避免 04–07 之间首次发送失败。
  7. 子 Session 读取计划接口返回根 Session 的阶段；动作对子 Session 返回 409 `child-session`。
- **未验证。** 真实模型是否遵守 T1、T8、T12 的文本不在本规格门槛内（规格 Testing Decisions），交付时如实报告。
