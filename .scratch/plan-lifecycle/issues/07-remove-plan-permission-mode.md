# 07: 从 Permission Mode 中移除 `plan`

**What to build:** 收尾清理。04 之后已经没有路径会把 Permission Mode 设为 `plan`，本票把它从类型、判定、沙箱映射与界面里删掉，并让旧 Session 中记录的 `plan` 按它进入前的模式读取。升级后打开旧对话不出错，权限也不会变宽。见 [规格](../spec.md) 的“两个阶段共用的数据形状”与设计稿。

**User stories:** 41、42、43、44

**Blocked by:** 04

**Status:** ready-for-agent

- [x] Permission Mode 的类型只有四档；判定、沙箱映射、Subagent 的模式比较、模式图标与循环顺序中针对 `plan` 的分支全部删除；`pnpm run typecheck` 通过
- [x] `permission_mode` 条目升一版：读取时 `plan` 取 `prior`，没有 `prior` 取 default；不改写数据库行（用例读回数据库中的原始版本号）
- [x] 预置含旧 `plan` 记录的 Session：模式读回为 `prior`，不在规划中，没有 `<plan_mode>`，已提交的计划仍可在时间线与右栏查看
- [x] 预置“首次发送带 `plan`、没有 `prior`”的旧 Session：模式读回为 default
- [x] Session 权限的读取结果与审计的权限模式事件不再带 `prior`
- [x] 02 留下的过渡状态结束：不再有 `plan` 模式与计划阶段并存的 Session
- [x] 新对话草稿里残留的 `plan` 权限读取时按未设置处理，首次发送不带它
- [x] 删除不再使用的规划模式说明与恢复模式文案，两种语言的词典保持同构
- [x] 旧版本应用读取新版本 `permission_mode` 条目的行为写入兼容说明
- [x] 现有涉及 `plan` 模式的测试文件逐个核对：场景保留，断言按新行为更新
- [x] 文档：权限判定与审批（模式数量与模式表）、追踪与审计；`pnpm run check:docs` 通过

## Comments

### 2026-11-20 实施完成（未关闭）

- **交付。** `permission_mode` v3（`{ mode }`，四档）与 v2→v3 迁移（`plan` 取 `prior`，缺省 default；其余原样），只在读取时于内存中升级，库中行不改写；agent 与 protocol 的 `permissionModeSchema` / `PermissionMode` 改为与 `StandardPermissionMode` 相同（保留旧名，免于改动全部引用），`PermissionModePayload` 为 v3。`SessionPermissionsResponse` 与 `SessionPermissionState` 去掉 `prior`，回放只取 `mode`；审计 `permission_mode` 事件去掉 `prior`（agent `audit.ts` 与 protocol `trace.ts`）。删除 `plan` 分支：`decide.ts` 的模式放行、`sandbox.ts` 的档位映射、`gate.ts` 的 isolation 与固定档位检查（规划中的 isolation 文本仍为 `… in plan mode`）、`definitions.ts` 的 `modeRank` / `narrowerMode`（不再是泛型）、`MODE_ICONS` 与 ModePicker 的“规划”标签。新对话草稿：`new-chat-store.ts` 读取持久化配置时把 `permissionMode: 'plan'` 置为未设置（其余配置保留），`chat-store.ts` 首次发送去掉 04 的 `plan` 特例。i18n 删除 `plan.mode`（中英同构）。02 的过渡状态随读取迁移结束：旧 Session 的 `plan` 模式读为 prior，不在规划中。
- **改断言的现有用例（原因：Permission Mode 只剩四档，旧数据在读取时迁移）。**
  1. `policy/decide.test.ts`：删除“plan 模式与 read-only 相同”整组（规划约束已由“Permission Mode × 是否规划中 × 工具类型”覆盖）；各五档表格改为四档；memory-write 的 plan 放行改为 read-only 下规划中放行。`policy/sandbox.test.ts`：去掉 plan → read-only。`agents/definitions.test.ts`、`apps/server/src/application/permission-scope.test.ts`：去掉 `plan` 行。
  2. `agents/{fork,handoff}.test.ts`、`planning/planning.test.ts`：作为输入的 `permission_mode { plan, prior }` 改为四档之一（读回的条目已迁移，不会再有 plan），断言随之改为复制该档。
  3. `session-permissions.test.ts`：预置条目改为显式 v2，原“plan 模式 Session 不在规划中”扩展为模式读为 prior、读取结果不带 prior、运行时 `mode()` / `planning()` 为 default / false；新增 v2 的四种输入读回表。
  4. `plan.browser.test.tsx`：旧数据 Session 的条目改为迁移后的 `{ mode: 'default' }`；删除“旧数据中的 plan 模式按钮显示‘规划’”（ModePicker 不再接受 plan）。`chat-store-permissions.test.ts`：草稿残留 `plan` 改为经持久化存储预置（`vi.stubGlobal('localStorage')`），断言读回为未设置且首次发送不带它。
  5. `tests/integration/sidecar-memory.test.ts`：原经 `PUT …/permission-mode { mode: 'plan' }` 建 Session（04 起即为 400，该用例在 04 之后会失败），改为 read-only 加 `POST …/plan { action: 'enter' }`。
  6. `apps/desktop/e2e/conversation-workbench-closeout.e2e.test.ts`：`/plan` 后模式断言从 `plan` 改为 `default`（04 遗留；未运行）。
- **新增断言。** `decide.test.ts`：v2→v3 迁移与 v3 只接受四档、不带 prior；`new-chat-store.test.ts`（新）：残留 `plan` 读为未设置、其余配置保留；`sidecar-plan.test.ts`“旧数据”：Sidecar 停止时经存储公开接口预置 v2 `{ plan, prior: accept-edits }` 与 v2 `{ plan }`、v1 的 proposed 计划，重启后模式读回 accept-edits / default（不带 prior）、`GET …/plan` 为 none、条目读回为 v3、库中原始 `payload_version` 仍为 2、审计事件不带 prior、计划条目可读、下一个 Run 的请求快照没有 `<plan_mode>` 与 `exit_plan_mode`。
- **与设计稿的偏离。**
  1. 设计稿把 v2→v3 的单元测试放在 `session-entries.test.ts`；`permission_mode` 已有的版本用例在 `policy/decide.test.ts`，v3 用例加在那里；“读回数据库原始版本号”在 `sidecar-plan.test.ts` 以真实 SQLite 断言（单元层没有 SQLite）。
  2. `PermissionMode` 没有删除，改为 `StandardPermissionMode` 的同义（设计稿 §9.1 写“即 StandardPermissionMode”），避免改动全部引用；`CYCLED_PERMISSION_MODES` 不变。
  3. 兼容说明写在 `docs/subsystems/plan-mode.md` 新增的“兼容与降级”一节（设计稿未指定位置），`permissions.md` 链接过去。导航 `docs/README.md` 的 Plan Mode 摘要（原“plan 权限模式、/plan 与 prior”）随本票改为计划阶段与旧数据迁移，`subagents.md`、`teams.md`、`apps/server/README.md` 的 plan 模式描述同步删除。
  4. `fork.ts` 注释中的“plan 模式”留给票 06（它会改写该处的过渡口径）。
- **验证（2026-11-20）。**
  - `pnpm run typecheck` 通过；`pnpm run check:docs` 通过（436 个文件 0 个问题）。
  - 单元：`pnpm exec vitest run packages/agent packages/protocol packages/i18n packages/session apps/server/src apps/desktop/src/renderer/stores apps/desktop/src/renderer/app`：2219 例，2206 通过、13 失败。10 例为已知基线（`engine/host-stop` 2、`policy/approvals` 1、`policy/gate-hooks` Hook deny 1、`instructions/shared` 1、renderer store 4、`protocol/entries` M2–M6 kind 1）；`startup-screen.browser` 1 例与 `right-panel-shortcuts.browser` 2 例在批量中失败，单独重跑分别通过（6 例全过），判为批量负载下的不稳定，与本票无关。
  - Browser Mode：`plan.browser.test.tsx` 与 `context-ring.browser.test.tsx` 2 个文件 24 例通过。
  - 集成（真实 Sidecar，darwin）：`sidecar-plan`、`sidecar-memory`、`sidecar-permissions`、`sidecar-subagents-permissions`、`sidecar-subagents-isolation`、`sidecar-hooks`、`sidecar-handoff`、`sidecar-rewind`、`sidecar-trace`、`headless`、`sidecar-schedules`、`sidecar-pty`、`sidecar-project-permissions`、`sidecar-state-update-fork`、`sidecar-first-send`、`secrets-gate-plan`、`sidecar-tool-search-keywords`、`sidecar-goal`：19 个文件 145 例通过。
  - 未运行：Electron E2E（`plan.e2e.test.ts`、`conversation-workbench-closeout.e2e.test.ts` 只改断言）；非 darwin 平台。
