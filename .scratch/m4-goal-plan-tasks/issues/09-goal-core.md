# 09: Goal 核心：记录与状态机、Goal Round 推进与去重、完成证据、重启暂停、停止传播

**What to build:** 见 [规格](../spec.md) "Goal"一节与 [ADR 0011](../../../docs/adr/0011-goal-state-as-session-entries.md)，预算只做轮次（其余维度归票 10）：agent `goals/`（快照与 revision、转换表、授权规则、完成证据校验、`<goal>` 与 `<goal_round>` 文本、工具 `get_goal` / `create_goal` / `update_goal`）；`goal` 条目；server `GoalService`（读写、转换、HTTP）、`GoalDriver`（`onRunEnd` 后发起 Goal Round、串行与去重、waiting-input 判定、waiting-external 在等待的 Job 结束后恢复，订阅 JobService 的结束事件）、`context/goal.ts`（工具、system section、`/goal` 命令与动作）、`routes/goals.ts`；启动恢复钩子把 running / waiting-* 提交为 paused（restarted）；取消的停止传播（Run 与 goalId 的 Job）与 cleanup。界面不在本票（票 11），本票用协议测试验收。

**User stories:** 1, 2, 4, 5, 6

**Blocked by:** 04

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/goals/`、`packages/agent/src/session-entries/goals.ts`、`packages/protocol/src/goal.ts`、`apps/server/src/application/{goals,goal-driver（新）}.ts`、`application/session-runs.ts`（Goal Round 入口与 run_start.goal 的最小改动）、`application/context/goal.ts`、`http/routes/goals.ts`、`packages/i18n/src/dictionaries/domains/goal.ts`、`tests/integration/{sidecar-goal,sidecar-goal-restart,secrets-gate-goal}.test.ts`（新）、`docs/subsystems/goal.md`（新）、`docs/subsystems/context.md`（`<goal>` 一段）、`docs/adr/0011-goal-state-as-session-entries.md`

- [ ] agent 表驱动：规格转换表每一行（含非法转换）、Goal Round 中 create / edit / pause / resume 被拒、blocked 的 3 轮阈值、证据缺条件 / 空文本 / 引用不存在或 isError 的 toolCallId 被拒、revision 过期
- [ ] 集成：用户消息让 faux 调用 create_goal → 之后无人操作，Goal Round 依次开始（run_start trigger goal、round 1、2…）直到 faux 给出完整证据的 complete；轮次上限耗尽进入 budget-exhausted（rounds）
- [ ] 集成：Goal Round 中 write 待审批 → Run 等待、审批后继续；Goal Round 以审批未回答被停止时 Goal 为 waiting-input，用户提交后回到 running；`wait_jobs` 后 Job 结束时下一轮开始；用户在 Goal Round 期间提交消息时不重复发起同一轮（run_start 的 round 不重复）
- [ ] 集成：`POST …/goal` 暂停 / 恢复 / 编辑 / 取消与 409（revision-conflict、invalid-transition）；取消时进行中的 Run 结束、goalId 的 Job 进程退出、cancelled 快照带 cleanup；`/goal pause` 与 `/goal cancel` 在 Run 进行中可用
- [ ] 集成 `sidecar-goal-restart`：Goal Round 进行中 SIGKILL Sidecar → 重启后 Goal 为 paused（restarted）、30 秒内不出现新的 run_start（以事件等待超时断言）；恢复后继续
- [ ] 秘密总闸 `secrets-gate-goal.test.ts`：目标与证据含登记 Secret 时条目、WS、HTTP、库与 requestLog（`<goal>`、`<goal_round>`）中没有明文
- [ ] 分叉不复制 Goal；回退对话不改变 Goal（集成断言）；不适用项：不读取文件（Comments 写明）
- [ ] goal.md 建立并可达（导航行写在 Comments）；ADR 0011 补本票证据；`check:docs` 通过

## Comments
