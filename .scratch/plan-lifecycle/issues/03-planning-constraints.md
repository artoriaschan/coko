# 03: 规划约束由计划阶段施加，并变为硬性

**What to build:** 规划期间“不改 Workspace”改由计划阶段保证，而且不再依赖用户每次都不点批准。Session 在规划中时，文件写入被直接拒绝，命令在只读沙箱里运行且不能提权，向可写终端的输入与带 Worktree 隔离的派发被拒；规划期间派发的 Subagent 受同样的约束。本票之后进入规划仍会把 Permission Mode 设为 `plan`，其余调用的询问与否暂时不变（04 处理）。见 [规格](../spec.md) 的“阶段一：判定、沙箱与注入”与设计稿。

**User stories:** 7、8、9、10、11、12、13、14、31、33、34

**Blocked by:** 02

**Status:** ready-for-agent

- [x] 判定表测试改为“Permission Mode × 是否规划中 × 工具类型”：规划中文件写入工具为拒绝，位置紧随拒绝规则之后，先于询问规则、受保护路径、越出可写根、模式放行与允许规则；不在规划中的各格与改动前相同
- [x] 外部 Hook 的 allow 不能放行规划中的写入；Hook 的 deny 仍然优先并保留它自己的结果文本
- [x] 写入拒绝的文本按设计稿，说明 Session 在规划中、内容应写进计划；不产生审批请求
- [x] 沙箱档位：规划中一律 read-only、可写根为空；不在规划中沿用现有映射
- [x] 规划中带提权参数的命令直接返回错误结果，不询问；不在规划中的提权行为不变
- [x] 规划中向更宽档位启动的 PTY Job 输入被拒；read-only 模式下的拒绝不变，其余模式仍按提权询问
- [x] 规划中带 Worktree 隔离的 Subagent 派发在判定与派发两处都被拒；read-only 模式下的拒绝不变
- [x] 规划期间派发的 Subagent：子 Session 的“是否规划中”取根 Session；写入被拒，命令在只读沙箱；子 Session 的系统消息中有“正在规划、不可改动”的说明，没有提交计划的指引
- [x] Memory 写入、Todo List 与 Goal 工具、读取与搜索在规划中照常放行
- [x] `<plan_mode>` 中关于写入与命令的表述与新行为一致（写入会被拒绝）
- [x] Sidecar 集成测试：规划中的写入结果为拒绝、没有审批请求、目标文件不存在或逐字节不变；有匹配的允许规则与 Hook allow 时仍被拒；被放行的写文件命令因只读沙箱失败（darwin，其他平台按现有约定）；带提权参数的调用出错且不询问
- [x] 现有断言“规划中写入询问”的用例改为断言拒绝，并在评论中说明原因
- [x] 文档：权限判定与审批、Plan Mode、子代理、命令执行（PTY 与 stdin）、外部 Hook 的组合说明；`pnpm run check:docs` 通过

## Comments

### 2026-11-20 实施完成（未关闭）

- **交付。** `PermissionContext.planning` 与 `decideWithStep` 的 `planning` 步（`{ behavior: 'deny', reason: 'planning' }`，紧随 `deny-rule`，只作用于 write 类）；`RuntimePermissions` / `PermissionGateOptions` 的 `planning?: () => boolean`（每次判定与执行现取）；gate 的全部拒绝文本改走 `deniedText(decision)`（T3）；`sandboxModeFor(mode, planning)` 与 `writableRootsFor(…, planning)`（规划中 read-only、可写根为空）；gate 的提权检查在规划中返回 T4（`PLANNING_ESCALATION_TEXT`），`fixedSandbox` 在规划中返回 T6（`planningFixedSandboxRefusedText`），isolation 在规划中以 `plan` 文本拒绝；`SandboxPolicy.escalation?: false`，`prepare` 在规划中设置，bash 被拒时以 T5（`planningEscalationMarker()`）替代提权提示；`<plan_mode>` 换为 T1 过渡版，子 Session 注入 T2（`SUBAGENT_PLAN_MODE_TEXT`，`planModeSection(child)`，`context/plan.ts` 以 `scope.parentSessionId` 判断）；`SessionPermissions.runtimePermissions` 返回 `planning`（子 Session 的 state 即根 Session 的状态）；`SubagentService` 派发处另查根 Session 的阶段，装配在 `runtime/layers.ts`。
- **改断言的现有用例（原因：票 03 起规划中的写入由计划阶段直接拒绝，不再询问；PTY 输入的拒绝来自计划阶段，文本改为 T6）。**
  1. `tests/integration/sidecar-plan.test.ts` 首例：写入从“出审批卡、用户带反馈拒绝”改为断言 T3、无审批、文件不存在；bash 的审批序号前移一位；沙箱拒绝后断言 T5 且没有提权提示；`<plan_mode>` 改为断言 T1 全文。
  2. `tests/integration/sidecar-project-permissions.test.ts`：原 `it.each(['read-only', 'plan'])` 的“附加根写入仍需审批”拆为 read-only（不变）与“规划中：附加根写入直接拒绝，不询问”。
  3. `tests/integration/sidecar-rewind.test.ts`“从早期助手分支仍继承源当前 plan 权限”：分叉后的写入从“出审批卡后拒绝”改为断言无审批、结果为 T3、文件不存在。
  4. `tests/integration/sidecar-pty.test.ts`：规划中向 danger-full-access 终端的输入从 `wider than plan mode allows` 改为 T6 全文。
- **新增断言。** `decide.test.ts`（Permission Mode × 是否规划中 × 工具类型，含权限类 edit 与没有目标的写入、步骤位置）；`sandbox.test.ts`（规划中档位与可写根）；`escalation.test.ts`（运行时：T3 无审批、三种模式下的 read-only 沙箱与 `escalation: false`、T5、T4 且不询问不执行、等待中的写入进入规划后 superseded 为 T3、Run 中途进入规划）；`gate-hooks.test.ts` 与 `hooks.test.ts`（Hook allow 不放行、Hook deny 优先）；`subagents-dispatch.test.ts`（派发处拒绝 isolation）；集成：`sidecar-plan`（允许规则下写入与编辑仍被拒且文件逐字节不变、写文件命令失败、提权出错且无审批）、`sidecar-hooks`（全局 Hook allow 下规划中的编辑被拒、文件逐字节不变）、`sidecar-subagents-permissions`（子 Session 写入 T3、命令只读沙箱与 T5、system 中为 T2）。
- **与设计稿的偏离。**
  1. 设计稿 §3.3 写 `SubagentDeps` 增加 `planning(sessionId)`；代码中对应的接口是 `SubagentSessionHost`（`apps/server/src/application/subagents.ts`），在其上增加 `planning(sessionId): Promise<boolean>`，装配取 `sessions.sessionPlan(id).phase`（子 Session 读回根 Session 的阶段）。
  2. 设计稿 §3.2 说规划中“已批准的提权不存在”。批准提权之后、执行之前进入规划时它仍可能存在；`prepare` 在规划中忽略已批准的提权（执行档位一律 read-only），比设计稿更严，不改变其余语义。
  3. 子 Session 的 `<plan_mode>` 由 `planModeSection(child)` 选择文本（设计稿未规定函数形状）。
- **验证。** 见下一节。

### 验证（2026-11-20）

- `pnpm run typecheck` 通过；`pnpm run check:docs` 通过（436 个文件 0 个问题）。
- 单元：`pnpm exec vitest run packages/agent apps/server/src`：131 个文件 1842 例，1837 通过、5 失败；5 例在改动前的基线上同样失败（`engine/host-stop.test.ts` 2 例、`policy/approvals.test.ts` 1 例、`policy/gate-hooks.test.ts`“Hook deny 在 full-access 下拒绝”1 例——条目顺序中 `model_request` 的位置；`instructions/shared/shared.test.ts` 1 例），与本票无关。改动后又新增 1 例（等待中的写入进入规划后重新判定），`escalation.test.ts` 19 例通过。
- 集成（真实 Sidecar，darwin）：`sidecar-plan`、`sidecar-hooks`、`sidecar-pty`、`sidecar-subagents-permissions`、`sidecar-subagents-isolation`、`sidecar-sandbox`、`secrets-gate-plan` 7 个文件 48 例通过；`sidecar-project-permissions`、`sidecar-rewind`、`sidecar-goal`、`sidecar-schedules`、`sidecar-memory`、`sidecar-todo`、`sidecar-tool-search-keywords`、`sidecar-commands`、`sidecar-handoff`、`sidecar-state-update-fork`、`sidecar-permissions` 11 个文件 81 例通过。
- 未运行：Electron E2E（`apps/desktop/e2e/plan.e2e.test.ts` 未断言写入询问，本票未改界面）、renderer Browser Mode、非 darwin 平台（相关断言按现有约定以 `sandbox-unavailable` 分支书写，未在其他平台执行）。真实模型是否遵守 T1–T5 不在本票门槛内，未验证。
