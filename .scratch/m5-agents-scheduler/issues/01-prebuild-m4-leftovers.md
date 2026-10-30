# 01: 预构建：M4 遗留的坏味道 B1–B12、B15、text-warning 文字色与手动 /compact 的预算检查

**What to build:** 在 M5 新服务落地之前收敛 [M4 Standards 评审](../../m4-goal-plan-tasks/review-standards.md) 未处理的 B1–B12、B15，以及地图 Carry-overs 中标 M5 的两项，细节见 [规格](../spec.md)"预构建"一节：B1 共用 `requestJson`；B2 `KeyedMutex`；B3 `errorMessage` 与 `JOB_NOTIFICATION_TAG`；B4 计划规则守卫测试；B5 改名与去别名；B6 预算维度描述表与 `GoalReason.code` 字面量；B7 GoalService / JobService 注入、删除 `attach()`；B8 `modelPriced` 移位；B9 `ProcessTarget` / `signalTarget`；B10 文档措辞。行为改动只有四项：B11 GoalCard 重读节流、B12 抛错、B15 未设费用上限提示、手动 `/compact` 经请求前预算检查；另把 mcp-section、rewind-dialog、context-ring 中作文字的 `text-warning` 改为 `text-warning-text`。

**User stories:** 20

**Blocked by:** None - can start immediately（阻塞本目录其余全部票）

**Status:** ready-for-agent

**Write scope:** `apps/desktop/src/renderer/client/api.ts`、`stores/{jobs,goal}-store.ts`（及就近测试）、`features/conversation/dock/goal-card.tsx`、`features/settings/mcp-section.tsx`、`features/conversation/{rewind-dialog,context-ring,timeline}.ts(x)`、`apps/server/src/application/{goals,goal-driver,jobs,processes,session-permissions,session-runs,session-models,permissions,errors,keyed-mutex（新）}.ts`、`application/context/compaction.ts`、`apps/server/src/adapters/{processes,pty}.ts`、`apps/server/src/runtime/layers.ts`（只改 GoalService / JobService 的装配与 errorMessage 导入）、`packages/agent/src/goals/{state,budget,tools}.ts`、`packages/agent/src/entries/`（只导出 `JOB_NOTIFICATION_TAG`）、`packages/agent/src/tasks/jobs/`（只改通知标签常量的来源）、`packages/agent/src/planning/exit-plan-mode.ts`、`packages/agent/src/engine/{compaction-driver,runtime}.ts`（只限手动 /compact 经请求前检查）、`packages/protocol/src/{goal,planning,permissions}.ts`、上述文件的就近测试、`tests/integration/sidecar-goal-budget.test.ts`（手动 /compact 用例）、`docs/subsystems/{goal,context}.md`、`packages/agent/README.md`、`apps/server/README.md`

- [x] 改动前在 main 记录基线：全量测试的文件数、用例数与跳过数写入 Comments
- [x] 结构项 B1–B9：已有测试只改导入路径即通过（任何断言改动逐条说明理由）；grep 证据：`#gate` / `#locked` 已删除、三处局部 `message` 函数已删除、`'<job-notification>'` 字面量只在生成方一处、`attach(` 不再出现在 goals.ts / jobs.ts
- [x] B2：`keyed-mutex.test.ts` 断言同一 key 串行、不同 key 并行、任务抛错后锁释放、完成后 Map 为空（用 deferred promise 确定交叠）
- [x] B4：守卫测试对同一组输入断言 agent 与 protocol 的 `planMarkdownProblem` / `planTitle` 结果相等；临时改一边使其失败后还原（Comments 写明）
- [x] B6：新增一个维度只需改描述表（单元测试遍历描述表断言 limit / used / 名称 / 格式化齐全）；`GoalReason.code` 的已知值在 renderer 中有本地化
- [x] B11（先红）：goal-card browser 测试中连续推送 20 条无 usage 的 assistant / toolResult 条目，`GET …/goal` 至多 1 次；推送 `goal` 条目后重读
- [x] B12（先红）：找不到待审阅记录时批准返回 500 `internal`，不提交新 revision 的 `plan` 条目
- [x] B15：已定价模型且未设 `maxCost` 时 Goal 卡显示提示（zh / en），设了或未定价时不显示；`create_goal` 描述含 `max_cost` 建议
- [x] text-warning：三个组件中作文字的位置改为 `text-warning-text`；browser 测试在明暗两种主题下按计算样式断言对比度 ≥ 4.5:1（先红）；图标保留 `text-warning`
- [x] **对手用例（预算）**：Goal running 且 `maxTokens` 已耗尽时用户发 `/compact` → faux requestLog 中没有摘要请求、没有 `compaction` 条目、Run 以 `paused` + `budget_exhausted` 结束、Goal 为 budget-exhausted（先红）；Goal 不存在或 paused 时 `/compact` 照常
- [x] goal.md 删除"手动 /compact 不经这项检查"，B10 的子 Session 汇总写成接口说明；README 同步；`typecheck`、`lint`、`format:check`、`check:docs`、`scripts/browser-deps.test.ts`、`scripts/source-references.test.ts` 通过

## Comments
- 2026-10-31 lead：实施者报告的基线失败（tests/integration/sidecar-pty.test.ts 中"job_input 按上次回车之后累计的输入判定"，main 上既有、不稳定）已由 lead 在 m5/fix-pty-trap-race 修复并合入 main（4f5e33f）：原因是 Job 启动与输入在同一 Run 中，Ctrl-C 可能在 bash 装好 `trap '' INT` 之前到达并结束 Job；改为 Job 在第一个 Run 中启动、打印 trap-ready 后再输入，断言不变；单独连跑 6 次通过。本票完成前 git merge main 即可得到修复。

### 实施者（票 01）

**基线（main 92f9205，worktree 中 `pnpm run test`，2026-10-31 01:44，负载约 3）：** 250 个测试文件（249 通过、1 失败），1952 例（1950 通过、1 失败、1 跳过），test=1。失败用例在 main 上已存在：`tests/integration/sidecar-pty.test.ts` 的"job_input 按上次回车之后累计的输入判定…"。实际值：Ctrl-C（c1）之后，`trap '' INT; cat` 的 PTY Job 以 status failed 结束，q1 / q2 都返回 "Background job … is not running (status: failed)"，日志为 `rm -r^C`。单独运行该文件 4 次：2 次失败、2 次通过（负载约 3.8）。这在本票写范围之外，不改；推测为 Ctrl-C 早于 trap 生效（未验证）。跳过的 1 例是 settings.e2e 中已有的 skip。

**逐项结果与提交（m5/01-prebuild-m4-leftovers）：**

- B1（e8ac0d9）：`client/api.ts` 导出 `requestJson(schema, method, path, body?, fetchImpl?)`，`createApiClient`、`httpGoalBackend`、`httpJobsBackend` 复用；错误体按 `ErrorResponse` 校验。已有 jobs-store.test 两例未改即通过。
- B2（44afb3c、ca495bb）：`application/keyed-mutex.ts` 的 `KeyedMutex.run(key, task)`（尾部清理、`size`）。goals.ts 的 `#gate` / `#locked` 删除，改为 `#locks` / `#toolCallLocks` 两个 KeyedMutex；`session-permissions.ts` 的 `locked` 委托给它（原实现没有尾部清理）。`keyed-mutex.test.ts` 4 例（deferred 确定交叠）。变异：去掉尾部删除 → "全部完成后不留下 key"失败；去掉按 key 的前驱 → "同一 key 串行"失败；`then(task, task)` 改 `then(task)` 存活，因为前驱总是已 catch 的 tail，属等价变异。
- B3（c97b549）：`errors.ts` 导出 `errorMessage`，goals、jobs、processes、layers 的局部函数删除。`JOB_NOTIFICATION_TAG` 在 `agent/src/entries/job-notification.ts`（entries 子路径只导入本目录，导入守卫照常通过），生成方 `tasks/jobs/job.ts`、`goal-driver.ts` 与 renderer `timeline.ts` 引用。非测试源码中 `'<job-notification>'` 字面量只剩定义处一处。
- B4（0bb19ce）：`apps/server/src/application/plan-rules.test.ts`（server 是同时依赖 agent 与 protocol 的唯一 workspace，同 entry-payloads.test.ts）断言两份 `PLAN_MAX_CHARS` / `planMarkdownProblem` / `planTitle` 对 13 个输入结果相等，审阅接口 editedPlan 上限即 `PLAN_MAX_CHARS`；`protocol/permissions.ts` 引用 `PLAN_MAX_CHARS`。负向：临时把 agent 的标题正则改为 `#{1,7}` → planMarkdownProblem 一例失败；把 planTitle 的 `[ \t]+` 改为 `*` → planTitle 一例失败；均已还原。
- B5（9268676）：`formatCost` → `costText`（state.ts、prompt.ts）；`application/permissions.ts` 直接用 `StandardPermissionMode`。
- B6（0cbaa7e）：agent `GOAL_BUDGET_DIMENSIONS` 改为描述表 `{ limit, used, name, format }`，`GOAL_BUDGET_DIMENSION_KEYS` 为判定顺序；`exhaustedDimension`、`exhaustedMessage`、`<goal>` 的预算行都取自它（`limitOf` / `usedOf` / 名称分支删除）。协议 `GOAL_BUDGET_DIMENSION_KEYS`、`GOAL_REASON_CODES`、`GoalReason`（`Type.Union([Type.Enum(codes), Type.String()])`）；server goals.ts 编译期断言两边维度键相同；renderer goal-card 的维度表为 `Record<GoalBudgetDimension, …>`，顺序取协议的键。新增 `goals/dimensions.test.ts`：遍历描述表断言每维的预算字段、用量字段、名称、格式齐全，以及判定、消息、`<goal>` 行都用它。renderer 本地化：补齐 `budget`、`plan-review`、`model-not-configured`、`model-required`、`confirmation-pending`（此前落到"运行出错"）；goal-card browser 测试断言 `GOAL_REASON_CODES` 在 zh / en 都有文案，临时删掉 en 的 plan-review → 该例失败（已还原）。
- B7 / B8（1f6e4a8）：`GoalService` 构造时注入 `hub` 与 `GoalRunHost { activeRunId, stopAfterBatch, startRun, modelPriced, isRunning, abort, pause }`，`JobService` 注入 `hub` 与 `JobRunHost { activeRunId, deliver }`；`attach()` 与 JobService 的 `hub` getter 删除，`#interrupt` 改为公开的 `steered`。两者先于 SessionService 创建（上下文贡献读取它们），`layers.ts` 的 `lateSessionRuns()` 给出两个窄接口，AppLive 创建 SessionService 后 `bindSessions` 一次，再 `sessions.runs.useJobs(...)`；bind 之前调用抛错（之前是静默返回空值，实际在启动恢复与监听之前就已 bind，不会走到）。`modelPriced` 移到 `session-models.ts`。goals.ts / jobs.ts 中没有 `attach(`。
- B9（47d4d66）：`adapters/processes.ts` 导出 `ProcessTarget` 与 `signalTarget(target, signal) → boolean`；`application/processes.ts` 的 `Target` 删除、`TrackedProcess extends ProcessTarget`；`adapters/pty.ts` 的组信号回退改为两次 `signalTarget`（行为同前：组失败时退回 pid）。
- B10（e333efa）：保留 `goalUsage` 的 `children`；goal.md 改写为接口说明（"子 Session 的汇总由子代理接入，目前没有调用方"）。
- B11（0cbaa7e，先红）：GoalCard 只按 `goal`、`run_end`、`compaction`、带 usage 的 assistant 条目计数重读，经 requestAnimationFrame 合并同一帧。browser 测试逐帧推送 10 对无 usage 的 assistant(toolUse) / toolResult：旧实现 20 次 GET，新实现 0 次（断言 ≤ 1）；推送 goal 条目后重读 1 次。
- B12（e180e3a，先红）：`session-permissions.ts` 在回答批准（`#answerPlan`）与执行（`approved`）时找不到审阅记录都抛 `AppError('internal')`（500），不放行、不提交 plan 条目，记 error 日志。`session-permissions.test.ts` 两例：先红为"回答成功、approved 返回 { markdown, mode }"。`approved(toolCallId, markdown)` 的 markdown 参数不再使用（接口签名未改）。
- B15（0cbaa7e，先红）：已定价（`usage.costUnpriced === false`）且没有 `maxCost` 时 Goal 卡预算区下方显示 `goal.noCostLimit`（zh / en）；设了上限或未定价时不显示，用量未读到时也不显示。`create_goal` 描述建议长任务设 `budget.max_cost`（dimensions.test 断言）。
- text-warning（71fe651，先红）：mcp-section 的 pending-approval 状态与"MCP 已关闭"提示、rewind-dialog 的两条警告、context-ring 卡片的截断标注与诊断码改为 `text-warning-text`；图标（rewind 的三角图标、暂停标记）保留 `text-warning`，rewind 段落中的图标显式加 `text-warning`。新测试 `conversation/warning-text.browser.test.tsx`（rewind、context 卡）与 mcp-section.browser.test 新增两例，明暗主题下按计算样式对最近的不透明背景断言 ≥ 4.5:1；改动前浅色主题 3 例失败（深色本来通过）。
- 手动 /compact（6b63e45，对手用例先红）：`runtime.compact()` 在 `driver.manual` 之前调用与对话请求相同的 `admit`（beforeRequest）；server `GoalService.runEnded` 对 compact 的 Run 只在预算停止（paused 加 budget_exhausted / cost_unpriced）时照常转换阶段，其余仍不推进。`compaction.test.ts` 新增一例（不发摘要请求、只有 run_start / run_end、beforeRequest 收到 compact Run 的 runId）。`sidecar-goal-budget.test.ts` 新增两例：用不重试的模型错误结束用户 Run（不推进 Goal）构造"Goal running、Session 空闲、Token 1100 / 1000"，`/compact` → requestLog 仍为 6 条且没有 `<conversation>`、没有 compaction 条目、run_end 为 paused + budget_exhausted、Goal 为 budget-exhausted（tokens）；Goal paused 时 `/compact` 照常压缩。负向：只去掉 runtime 的 admit 一行 → 对手用例 run_end 为 completed 而失败（已还原）；只有 runtime 修复、没有 runEnded 修复时 Goal 停在 running（等待超时）。Goal 不存在时的 `/compact` 由既有 sidecar-compaction 覆盖。

**已有测试的断言改动：** 无。已有测试文件只新增用例：goal-card.browser.test（fakeGoals 增加 `reads` 计数，供新用例使用）、mcp-section.browser.test、compaction.test、sidecar-goal-budget.test。现有断言与超时未改。

**越出 Write scope 的最小改动（请 Lead 裁决）：**
- `apps/server/src/application/sessions.ts`：新增一行委托 `modelPriced(sessionId)`（B8 移到 SessionModels 之后，layers.ts 只能经 SessionService 拿到）。该文件从票 02 起"只有 02 改"，本票是预构建。
- `packages/agent/src/goals/prompt.ts`：B5 改名与 B6 描述表的消费方（`<goal>` 的预算行）。
- `packages/agent/src/entries/{index,job-notification}.ts`：票面"只导出 JOB_NOTIFICATION_TAG"，常量放在 entries 目录内的新文件（子路径的导入守卫只允许本目录）。
- `packages/i18n/src/dictionaries/domains/goal.ts`：B6 的已知 reason.code 文案与 B15 提示。
- 新测试文件 `apps/server/src/application/{keyed-mutex,plan-rules,session-permissions}.test.ts`、`packages/agent/src/goals/dimensions.test.ts`、`apps/desktop/src/renderer/features/conversation/warning-text.browser.test.tsx`（就近测试）。
- `docs/subsystems/plan-mode.md`：B12 的一句当前行为。

**对手用例：** 本票的预算判定为手动 /compact，见上（模型无法经命令输出改变判定：检查只读已提交条目派生的用量）。其余 B 项不涉及新的读取根或注入点；新增的输出通道只有 Goal 卡的本地化提示（静态文案），不需要新的 secrets-gate 用例。

**文档影响：** goal.md（描述表、children 的接口说明、手动 /compact 经请求前检查、GoalCard 重读条件、未设费用上限提示、reason.code 联合与本地化、测试清单）、context.md（/compact 行）、plan-mode.md（B12）、packages/agent/README.md、apps/server/README.md。`pnpm run check:docs` 通过。没有需要 Lead 合并的导航行或协议导出（协议新导出经 `goal.ts`，index 已 `export *`）。
**最终验证（合入 main fe38367 之后，e0ce9bb 起）：** worktree 中 `pnpm run test`（02:21，负载约 4.7）：255 个测试文件全部通过，1984 例（1983 通过、1 跳过），test=0，日志中没有 Unhandled；包含 27 个 desktop-e2e 文件、`package-smoke.e2e.test.ts`（3 例）与 Lead 修复后的 `sidecar-pty.test.ts`（8 例）。另：`pnpm run typecheck`、`lint`、`format:check`、`check:docs` 退出码 0；`scripts/browser-deps.test.ts` 与 `scripts/source-references.test.ts` 4 例通过。较基线新增 5 个测试文件、32 例。

**未验证：** 真实模型（无凭据）；Electron 窗口最小化时 requestAnimationFrame 暂停，GoalCard 的重读推迟到窗口恢复（按设计接受，未在 E2E 中单测）。
