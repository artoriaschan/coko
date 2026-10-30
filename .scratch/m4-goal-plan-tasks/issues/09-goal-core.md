# 09: Goal 核心：记录与状态机、Goal Round 推进与去重、完成证据、重启暂停、停止传播

**What to build:** 见 [规格](../spec.md) "Goal"一节与 [ADR 0011](../../../docs/adr/0011-goal-state-as-session-entries.md)，预算只做轮次（其余维度归票 10）：agent `goals/`（快照与 revision、转换表、授权规则、完成证据校验、`<goal>` 与 `<goal_round>` 文本、工具 `get_goal` / `create_goal` / `update_goal`）；`goal` 条目；server `GoalService`（读写、转换、HTTP）、`GoalDriver`（`onRunEnd` 后发起 Goal Round、串行与去重、waiting-input 判定、waiting-external 在等待的 Job 结束后恢复，订阅 JobService 的结束事件）、`context/goal.ts`（工具、system section、`/goal` 命令与动作）、`routes/goals.ts`；启动恢复钩子把 running / waiting-* 提交为 paused（restarted）；取消的停止传播（Run 与 goalId 的 Job）与 cleanup。界面不在本票（票 11），本票用协议测试验收。

**User stories:** 1, 2, 4, 5, 6

**Blocked by:** 04

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/goals/`、`packages/agent/src/session-entries/goals.ts`、`packages/protocol/src/goal.ts`、`apps/server/src/application/{goals,goal-driver（新）}.ts`、`application/session-runs.ts`（Goal Round 入口与 run_start.goal 的最小改动）、`application/context/goal.ts`、`http/routes/goals.ts`、`packages/i18n/src/dictionaries/domains/goal.ts`、`tests/integration/{sidecar-goal,sidecar-goal-restart,secrets-gate-goal}.test.ts`（新）、`docs/subsystems/goal.md`（新）、`docs/subsystems/context.md`（`<goal>` 一段）、`docs/adr/0011-goal-state-as-session-entries.md`

- [x] agent 表驱动：规格转换表每一行（含非法转换）、Goal Round 中 create / edit / pause / resume 被拒、blocked 的 3 轮阈值、证据缺条件 / 空文本 / 引用不存在或 isError 的 toolCallId 被拒、revision 过期
- [x] 集成：用户消息让 faux 调用 create_goal → 之后无人操作，Goal Round 依次开始（run_start trigger goal、round 1、2…）直到 faux 给出完整证据的 complete；轮次上限耗尽进入 budget-exhausted（rounds）
- [x] 集成：Goal Round 中 write 待审批 → Run 等待、审批后继续；Goal Round 以审批未回答被停止时 Goal 为 waiting-input，用户提交后回到 running；`wait_jobs` 后 Job 结束时下一轮开始；用户在 Goal Round 期间提交消息时不重复发起同一轮（run_start 的 round 不重复）
- [x] 集成：`POST …/goal` 暂停 / 恢复 / 编辑 / 取消与 409（revision-conflict、invalid-transition）；取消时进行中的 Run 结束、goalId 的 Job 进程退出、cancelled 快照带 cleanup；`/goal pause` 与 `/goal cancel` 在 Run 进行中可用
- [x] 集成 `sidecar-goal-restart`：Goal Round 进行中 SIGKILL Sidecar → 重启后 Goal 为 paused（restarted）、30 秒内不出现新的 run_start（以事件等待超时断言）；恢复后继续
- [x] 秘密总闸 `secrets-gate-goal.test.ts`：目标与证据含登记 Secret 时条目、WS、HTTP、库与 requestLog（`<goal>`、`<goal_round>`）中没有明文
- [x] 分叉不复制 Goal；回退对话不改变 Goal（集成断言）；不适用项：不读取文件（Comments 写明）
- [x] goal.md 建立并可达（导航行写在 Comments）；ADR 0011 补本票证据；`check:docs` 通过

## Comments
- 2026-10-30 lead：来自票 04——停止 Goal 时用 JobService.killSession(sessionId) 结束该 Session 的 Job；Job 的 goalId 尚未写入，由本票写；带 Goal 的空闲 Session 在 Job 完成时的唤醒由本票实现（无 Goal 时不唤醒，见规格）。
- 2026-10-30 implementer（m4/09-goal-core）：
  - **覆盖的验收：** 全部 8 项。agent 表驱动 `packages/agent/src/goals/goals.test.ts`（162 例：转换表 11 种变化 × 9 阶段的每个组合、各动作在 user / 本 Goal 的轮 / 其他 Goal 的轮 / none 四种 Run 中的授权、blocked 3 轮阈值、证据的 7 种拒绝、revision 过期、runAuthority、文本）；集成 `sidecar-goal.test.ts`（7 例）、`sidecar-goal-restart.test.ts`（1 例，含 30 秒不推进的等待超时断言）、`secrets-gate-goal.test.ts`（1 例，扫描 WS、HTTP、库、requestLog 中的 `<goal>` 与 `<goal_round>`、落盘文件与 stderr）。
  - **负向确认（变异，均已还原）：** 启动恢复不暂停 → restart 用例失败；goal 条目不经 toNewEntry → secrets-gate-goal 失败；blocked 阈值改为 2 → agent 阈值用例失败；忽略被取消的审批 → waiting-input 用例失败；Goal Round 视为用户授权 → 同一用例失败（pause 未被拒）。
  - **与规格的取舍（请 Lead 裁决）：** ①规格写"工具在 Session 有 Goal 或本 Run 由用户提交时注册"；实现为 get_goal 按此规则、create_goal 只在非 Goal Round、update_goal 只在 Session 有 Goal 时注册。原因：三个工具约 3.5K 字符 schema 使 sidecar-compaction 与 sidecar-todo 的压缩阈值用例提前一轮压缩；没有 Goal 时 update_goal 只能返回 not-found。代价：同一 Run 中刚 create 的 Goal 要到下一个 Run（通常就是 Goal Round 1）才能经 update_goal 更新。②用户提交的 Run（非 Goal Round）在 Goal running 时被停止，同样把 Goal 记为 paused（user-stopped），避免停止后立即开始下一轮；Goal Round 停止时仍有等待回答的审批为 waiting-input。③有序关闭中断 Goal Round 时 Goal 记为 paused（user-stopped）而非 restarted（goal.md 已知限制）。④Goal id 为 Session 内序号 goal-n（faux 脚本可预写；只需 Session 内唯一）。⑤工具参数 snake_case（budget 内为 max_rounds 等，evidence 内为 criterion_id / tool_call_ids）；HTTP 与条目为 camelCase。
  - **越出 Write scope 的最小改动：** `apps/server/src/application/jobs.ts`（`useGoals` 解析器使 job_start 带 goalId；`killSession(sessionId, goalId?)` 只终止该 Goal 的 Job）——票 05 同时改此文件的 `#start`，合并时注意冲突；`packages/protocol/src/errors.ts` 与 `apps/server/src/application/errors.ts` 增加 `invalid-transition`（409，规格 HTTP 一节要求）；`tests/integration/sidecar-m4-seams.test.ts` 的 /goal 用例改为实现后的期望（没有 Goal 时 404，Run 中 /goal pause 照常执行）；`docs/subsystems/jobs.md` 两行（goalId 已写入、waiting-external 的唤醒）；`docs/README.md` 当前行为增加 goal.md 一行。i18n `goal.ts` 未改（界面在票 11）。
  - **实际运行：** `pnpm run test packages/agent/src/goals/goals.test.ts` 162 通过；`tests/integration/sidecar-goal*.test.ts`、`secrets-gate-goal.test.ts`、`sidecar-m4-seams`、`sidecar-commands`、`sidecar-compaction`、`sidecar-todo` 单独运行通过；`tsc -b`、`pnpm run lint`、`pnpm run format:check`、`pnpm run check:docs`（154 文件 0 问题）退出 0。全量 `pnpm run test`（含 desktop E2E 与 package-smoke，等其他 vitest run 结束后运行）退出 0：238 文件、1821 通过、1 跳过（真实模型），无未处理错误。此前一次全量与票 05 的全量并行（负载约 20），出现 browser 用例超时与 sidecar-jobs 一处只读一次的 `jobStarts()[0]`（第 301 行），单独重跑通过，与本票改动无关。
  - **不适用项：** 符号链接越界——Goal 的条目、`<goal>` 与 `<goal_round>` 只来自已提交的快照，不读取文件、不新增读取根。
  - **未验证：** 真实模型（无凭据）；Electron 界面（票 11）。
  - **供后续票：** 票 10——`exhaustedDimension(budget, usage)` 与 `GoalUsageSnapshot`（state.ts）目前只有 rounds，在这里补其余四维；`GoalUsage`（protocol）的 toolCalls / tokens / cost / durationMs / costUnpriced 已声明为可选；`GoalService.runEnded` 已把 `run_end.error.code` budget_exhausted / cost_unpriced 映射为 budget-exhausted / blocked（reason.code 取自 message 中的维度名，tool calls → tool-calls）；`<goal>` 中其余维度目前只列上限。工具调用前的 hook 与 beforeRequest 尚无（context/goal.ts 增加）。票 11——`goalPaths.sessionGoal`、`GoalResponse`、`GoalActionRequest`（edit 的 criteria 为文本数组，budget 整体替换）；/goal 无参数返回 204 done，界面据此打开 Goal 卡；reason.code 取值：user-paused、user-stopped、approval-unanswered、needs-input、waiting-jobs、model-paused、model-blocked、restarted、rounds、cost-unpriced、user-cancelled 与 Run 错误码。票 10（README 汇总）：agent README 记 `goals/` 导出；server README 记 GoalService、GoalDriver、routes/goals、`invalid-transition`。
  - **文档影响：** 新建 `docs/subsystems/goal.md`；`context.md` 增"压缩后的 `<goal>`"一节；ADR 0011 增实施记录（implementation 仍为 not-started，票 10 改）；导航行 `- [Goal](subsystems/goal.md)：…` 已加在 docs/README.md 的 Plan Mode 之前。
