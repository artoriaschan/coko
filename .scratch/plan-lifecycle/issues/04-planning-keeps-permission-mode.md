# 04: 进入规划不再改变 Permission Mode

**What to build:** 权限与规划各走各的入口。用户用 `/plan` 进入规划后，模式菜单仍显示并勾选原来的 Permission Mode，读取、命令与 MCP 是否询问照旧按它判定；批准计划只结束规划，不恢复也不改变权限。Plan chip 与 `/plan` 经新的计划接口进入和退出。在“完全访问权限”下规划不再逐条弹审批。服务端与桌面必须在同一张票里改，否则 chip 与审阅卡会失效。见 [规格](../spec.md) 的“阶段一：判定、沙箱与注入”“阶段一：协议与入口”“阶段一：界面”与设计稿。

**User stories:** 1、2、3、4、5、6、15、16、17、18、19、20（动作部分）、21、22、25、26、27、28、29、30、32、38、39、40

**Blocked by:** 03

**Status:** ready-for-agent

- [x] Session 计划接口的进入与退出动作：已在规划中进入、不在规划中退出都不提交条目；Run 进行中动作可用，写入拒绝与沙箱档位即时生效或解除，系统消息与工具集到下一个 Run 才变化
- [x] `/plan [消息]` 与 `/plan off` 调用同一组动作；Run 进行中以 `run-in-progress` 拒绝；新对话里 `/plan 消息` 以规划开始并提交该消息
- [x] 进入规划不提交 `permission_mode` 条目；四种 Permission Mode 下进入后模式读回不变
- [x] 规划中命令与 MCP 的询问与否和未规划时相同：完全访问权限下不询问，请求批准下询问；拒绝规则、询问规则与受保护路径照常生效
- [x] 批准：条目顺序为审批决定、工具执行、已批准的 `plan`、计划阶段“无”、工具结果；不提交 `permission_mode`；模式读回不变；工具结果文本按设计稿，不再提及恢复到哪个模式
- [x] 带 `mode` 的批准回答返回 400，请求保持等待；`editedPlan` 的规则不变，编辑后批准仍产生新修订
- [x] 带反馈拒绝、无反馈拒绝、停止时取消的行为与条目不变；Goal Round 中审阅时 Goal 进入等待输入不变
- [x] 切换 Permission Mode 的接口与首次发送对 `plan` 返回 400；无界面运行的 `--permission-mode plan` 为参数错误并列出合法取值
- [x] Subagent 的有效 Permission Mode 为父 Session 模式与定义上限的较窄者，规划中不再被压成 read-only；03 的约束照常生效
- [x] 规划中外部 Hook 收到的权限模式是真实的 Permission Mode
- [x] 定时任务在规划中的 Session 上触发时照常注入规划说明并受约束
- [x] `<plan_mode>` 的文本为设计稿的最终版（其余调用按当前权限处理）
- [x] 桌面：计划阶段由条目派生；Plan chip 由计划阶段驱动，× 调用退出动作，失败时保留状态并提示，草稿与其他配置不变
- [x] 桌面：模式菜单显示并勾选当前 Permission Mode，规划中切换不退出规划；Shift+Tab 只切换 Permission Mode
- [x] 桌面：审阅卡主按钮为“批准并执行”，没有“批准并允许编辑”与“将恢复的模式”
- [x] Sidecar 集成测试与 renderer 浏览器测试覆盖以上各项；现有断言 `prior` 与恢复模式的用例改为断言模式不变，并在评论中说明
- [x] 文档：Plan Mode、权限判定与审批、子代理、无界面运行、外部 Hook、桌面工作台；`pnpm run check:docs` 通过

## Comments

### 2026-11-20 实施完成（未关闭）

- **交付。** 协议：`SetPermissionModeRequest.mode` 与 `FirstSendRequest.permissionMode` 改为 `StandardPermissionMode`（`plan` 为 400）；`AnswerApprovalRequest` 的 allow 去掉 `mode`；新增 `PlanActionRequest`，`planPaths.sessionPlan` 兼作 POST。服务端：`SessionPermissions.planAction(sessionId, action)`（锁内，已在 / 不在规划中不提交，子 Session 409 `child-session`，之后重新判定待审批请求，返回 `sessionPlan`）；`setMode` 去掉 plan 分支，不再触碰计划阶段；`review().approved` 返回 `{ markdown }`，锁内提交 approved → `plan_phase { none }`（仅当仍在规划中），不提交 `permission_mode`；`#answerPlan` 删除“不能宽于 prior”的校验；`PlanHost` 的 `enterPlan` / `exitPlan` 换为 `planAction`，`/plan` 与 `/plan off` 调用它；`SessionService.create` 不再因 `plan` 模式补提交阶段；`POST /api/sessions/:id/plan`（`routes/plans.ts`）；无界面运行 `MODES` 去掉 `plan`。agent：`<plan_mode>` 换为 T1 最终版；`planApprovedText(markdown)` 为 T7；`effectiveSubagentMode = narrowerMode(rootMode, cap)`。renderer：`api.planAction`；chat store 的 `exitPlan(sessionId)`（失败经 `onFailure` 报告为新 kind `plan`）、`setPermissionMode` 只接受四档且不再有“离开 plan”的特例、首次发送丢弃草稿中残留的 `plan`；Plan chip 由 `planPhaseOf(entries)` 驱动、× 调用退出动作且不乐观移除、草稿不显示；模式菜单去掉 `prior`，始终显示当前模式（旧数据的 `plan` 显示“规划”、三项不勾选）；审阅卡只剩“批准并执行”，删除 `restoredMode`、`useModeLabel` 与下拉。i18n：`plan.empty` 改文案，删除 `modeDescription`、`exitHint`、`review.restores`、`review.more`、`review.approveAcceptEdits`（`plan.mode` 留到 07）。
- **改断言的现有用例（原因：票 04 起进入与退出规划、批准计划都不改变 Permission Mode，切换接口不再接受 `plan`）。**
  1. `tests/integration/sidecar-plan.test.ts`：原“/plan 进入（prior = default）…”“从 accept-edits 进入后批准回到 accept-edits”“/plan off 与模式菜单回到 prior；批准时的模式不能宽于 prior”“每条进入与退出路径的 plan_phase 与 permission_mode 顺序；首次发送带 plan”改为断言模式读回不变、批准不提交 `permission_mode`、带 `mode` 的批准 400、T7 结果文本、切换接口与首次发送拒绝 `plan`；分叉用例中复制的 `permission_mode` 从 `{ plan, prior }` 改为 `{ default }`。新增：完全访问权限下规划命令不询问、Run 中途进入与退出规划、审阅等待中退出规划后批准、Run 进行中 `/plan` 409 而接口可用、接口校验与 404、首次发送 `/plan 消息` 以规划开始与只有 `/plan` 时 400。
  2. `sidecar-rewind`、`sidecar-goal`、`sidecar-project-permissions`、`sidecar-pty`、`sidecar-hooks`、`sidecar-subagents-permissions`、`sidecar-subagents-isolation`、`sidecar-tool-search-keywords`、`sidecar-schedules`：原经 `PUT …/permission-mode { mode: 'plan' }` 进入规划，改为经 `POST …/plan { action: 'enter' }`（harness 的 `open(mode, planning)`）；`sidecar-schedules` 原“plan 下 schedule_create 询问”改为“read-only 下进入规划仍询问”；`sidecar-subagents-permissions` 原以允许规则使命令不询问，改为根为 full-access 并在规划中（断言有效模式不再被压成 read-only）；`sidecar-pty` 规划中模式仍为 full-access。
  3. `packages/agent/src/planning/planning.test.ts`：审阅闭环的 harness 不再把模式从 plan 改为 accept-edits，结果文本为 T7；`agents/definitions.test.ts`：`effectiveSubagentMode('plan', …)` 原期望 read-only，改为原样返回 plan（旧数据，与 read-only 同判，07 删除）。
  4. `plan.browser.test.tsx`：审阅卡不再有 `data-restores` 与“批准并允许编辑”（原断言只在 full-access 时给出），改为四种模式下都没有、编辑后批准不带 `mode`；Plan chip 原“plan 模式时显示、点击回到 prior”改为由 `plan_phase` 驱动、× 调用退出动作、模式不变、失败时保留；ModePicker 原“plan 按钮显示 prior”改为旧数据的 plan 显示“规划”。`chat-store-permissions.test.ts` 原“退出计划在服务端接受前保持 plan”改为退出规划经计划接口、失败保持规划中并报告 `plan`。
  5. `apps/desktop/e2e/plan.e2e.test.ts`：进入规划后模式断言从 `plan` 改为 `default`，`data-restores` 改为不存在（未运行，见下）。
- **新增断言（其余）。** `headless.test.ts`：`--permission-mode plan` 退出 4 并列出四个合法取值；`sidecar-hooks`：规划中 PreToolUse 收到 `permission_mode: accept-edits`；`sidecar-schedules`：规划中的 Session 上到期的 Run 注入 `<plan_mode>`、写入 T3、无审批、模式不变；`sidecar-tool-search-keywords`：规划中 MCP 调用 full-access 不询问、default 询问；`session-permissions.test.ts`：计划接口对子 Session 409 `child-session` 且不提交条目。
- **与设计稿的偏离。**
  1. 设计稿 §8.4 写“新对话中输入 `/plan 消息` 经首次发送……（现状）”，但现状的首次发送拒绝一切动作命令（`Send a message to start a new conversation`）。最小补足：`ContextAction` 增加 `firstSend?: boolean`，只有 `/plan` 动作声明它；首次发送展开为该动作时执行，随后提交的消息同样等待输入入库；没有消息时动作返回 done，首次发送以 400 `A message is required` 拒绝并回滚（与设计稿一致）。其他动作命令仍不能作为首次发送。
  2. Plan chip 退出失败的提示需要一个失败类型：`ChatFailure` 增加 `plan`，文案键 `errors.planFailed`（“没能退出规划” / “Could not exit planning”），设计稿 §11.3 的文案表未列出。
  3. chat store 的退出动作为 `exitPlan(sessionId)`（设计稿未规定 renderer 动作的形状）；`api.planAction(id, action)` 两个动作都有，界面只用 `exit`。
  4. `apps/desktop/e2e/plan.e2e.test.ts` 不在本票文件表中（属 08），只把与新行为矛盾的两处断言改掉，避免 04–08 之间该 E2E 必然失败。
- **验证。** 见下一节。

### 验证（2026-11-20）

- `pnpm run typecheck` 通过；`pnpm run check:docs` 通过（436 个文件 0 个问题）。
- 集成（真实 Sidecar，darwin）：`pnpm exec vitest run tests/integration/{sidecar-plan,sidecar-first-send,sidecar-commands,sidecar-rewind,sidecar-goal,sidecar-project-permissions,sidecar-tool-search-keywords,sidecar-pty,sidecar-hooks,sidecar-subagents-permissions,sidecar-schedules,sidecar-subagents-isolation,headless,secrets-gate-plan,sidecar-m4-seams,sidecar-permissions,sidecar-handoff,sidecar-state-update-fork,sidecar-sandbox}.test.ts`：20 个文件 157 例通过。
- renderer Browser Mode：`pnpm exec vitest run --project desktop-renderer` 选中 `plan`、`dock`、`business-timeline`、`context-ring`、`composer`、`new-chat` 等 7 个文件 74 例，73 通过；`new-chat.browser.test.tsx` 的“light：归属菜单在上方 6px…”一次因 `toHaveFocus` 超时失败，单独重跑通过（改动前后各单独运行一次也都通过），判为不稳定，与本票无关。`plan.browser.test.tsx` 15 例通过。
- 单元：`pnpm exec vitest run packages/agent packages/protocol packages/i18n apps/server/src apps/desktop/src/renderer/stores apps/desktop/src/renderer/app`：2120 例，2109 通过、11 失败。失败均与本票无关：已知基线 5 例（`engine/host-stop` 2、`policy/approvals` 1、`policy/gate-hooks` Hook deny 条目顺序 1、`instructions/shared` 1）；另有 4 例 renderer store（`chat-store-context-entries`、`chat-store-m4-entries`、`chat-store-rewind` 的分叉、`chat-store-run-control` 的 pause，均为 run-usage 项或 fork 参数）与 `protocol/entries.test.ts`“预先声明规格表中全部 M2–M6 kind”1 例，改动撤回后单独运行同样失败；`app/startup-screen.browser.test.tsx` 1 例在大批量运行中失败、单独运行通过。
- 未运行：Electron E2E（`apps/desktop/e2e/plan.e2e.test.ts`，只改了断言）；非 darwin 平台。真实模型是否遵守 T1、T7 不在本票门槛内，未验证。
