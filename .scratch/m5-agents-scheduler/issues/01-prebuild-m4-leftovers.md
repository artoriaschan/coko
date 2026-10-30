# 01: 预构建：M4 遗留的坏味道 B1–B12、B15、text-warning 文字色与手动 /compact 的预算检查

**What to build:** 在 M5 新服务落地之前收敛 [M4 Standards 评审](../../m4-goal-plan-tasks/review-standards.md) 未处理的 B1–B12、B15，以及地图 Carry-overs 中标 M5 的两项，细节见 [规格](../spec.md)"预构建"一节：B1 共用 `requestJson`；B2 `KeyedMutex`；B3 `errorMessage` 与 `JOB_NOTIFICATION_TAG`；B4 计划规则守卫测试；B5 改名与去别名；B6 预算维度描述表与 `GoalReason.code` 字面量；B7 GoalService / JobService 注入、删除 `attach()`；B8 `modelPriced` 移位；B9 `ProcessTarget` / `signalTarget`；B10 文档措辞。行为改动只有四项：B11 GoalCard 重读节流、B12 抛错、B15 未设费用上限提示、手动 `/compact` 经请求前预算检查；另把 mcp-section、rewind-dialog、context-ring 中作文字的 `text-warning` 改为 `text-warning-text`。

**User stories:** 20

**Blocked by:** None - can start immediately（阻塞本目录其余全部票）

**Status:** ready-for-agent

**Write scope:** `apps/desktop/src/renderer/client/api.ts`、`stores/{jobs,goal}-store.ts`（及就近测试）、`features/conversation/dock/goal-card.tsx`、`features/settings/mcp-section.tsx`、`features/conversation/{rewind-dialog,context-ring,timeline}.ts(x)`、`apps/server/src/application/{goals,goal-driver,jobs,processes,session-permissions,session-runs,session-models,permissions,errors,keyed-mutex（新）}.ts`、`application/context/compaction.ts`、`apps/server/src/adapters/{processes,pty}.ts`、`apps/server/src/runtime/layers.ts`（只改 GoalService / JobService 的装配与 errorMessage 导入）、`packages/agent/src/goals/{state,budget,tools}.ts`、`packages/agent/src/entries/`（只导出 `JOB_NOTIFICATION_TAG`）、`packages/agent/src/tasks/jobs/`（只改通知标签常量的来源）、`packages/agent/src/planning/exit-plan-mode.ts`、`packages/agent/src/engine/{compaction-driver,runtime}.ts`（只限手动 /compact 经请求前检查）、`packages/protocol/src/{goal,planning,permissions}.ts`、上述文件的就近测试、`tests/integration/sidecar-goal-budget.test.ts`（手动 /compact 用例）、`docs/subsystems/{goal,context}.md`、`packages/agent/README.md`、`apps/server/README.md`

- [ ] 改动前在 main 记录基线：全量测试的文件数、用例数与跳过数写入 Comments
- [ ] 结构项 B1–B9：已有测试只改导入路径即通过（任何断言改动逐条说明理由）；grep 证据：`#gate` / `#locked` 已删除、三处局部 `message` 函数已删除、`'<job-notification>'` 字面量只在生成方一处、`attach(` 不再出现在 goals.ts / jobs.ts
- [ ] B2：`keyed-mutex.test.ts` 断言同一 key 串行、不同 key 并行、任务抛错后锁释放、完成后 Map 为空（用 deferred promise 确定交叠）
- [ ] B4：守卫测试对同一组输入断言 agent 与 protocol 的 `planMarkdownProblem` / `planTitle` 结果相等；临时改一边使其失败后还原（Comments 写明）
- [ ] B6：新增一个维度只需改描述表（单元测试遍历描述表断言 limit / used / 名称 / 格式化齐全）；`GoalReason.code` 的已知值在 renderer 中有本地化
- [ ] B11（先红）：goal-card browser 测试中连续推送 20 条无 usage 的 assistant / toolResult 条目，`GET …/goal` 至多 1 次；推送 `goal` 条目后重读
- [ ] B12（先红）：找不到待审阅记录时批准返回 500 `internal`，不提交新 revision 的 `plan` 条目
- [ ] B15：已定价模型且未设 `maxCost` 时 Goal 卡显示提示（zh / en），设了或未定价时不显示；`create_goal` 描述含 `max_cost` 建议
- [ ] text-warning：三个组件中作文字的位置改为 `text-warning-text`；browser 测试在明暗两种主题下按计算样式断言对比度 ≥ 4.5:1（先红）；图标保留 `text-warning`
- [ ] **对手用例（预算）**：Goal running 且 `maxTokens` 已耗尽时用户发 `/compact` → faux requestLog 中没有摘要请求、没有 `compaction` 条目、Run 以 `paused` + `budget_exhausted` 结束、Goal 为 budget-exhausted（先红）；Goal 不存在或 paused 时 `/compact` 照常
- [ ] goal.md 删除"手动 /compact 不经这项检查"，B10 的子 Session 汇总写成接口说明；README 同步；`typecheck`、`lint`、`format:check`、`check:docs`、`scripts/browser-deps.test.ts`、`scripts/source-references.test.ts` 通过

## Comments
- 2026-10-31 lead：实施者报告的基线失败（tests/integration/sidecar-pty.test.ts 中"job_input 按上次回车之后累计的输入判定"，main 上既有、不稳定）已由 lead 在 m5/fix-pty-trap-race 修复并合入 main（4f5e33f）：原因是 Job 启动与输入在同一 Run 中，Ctrl-C 可能在 bash 装好 `trap '' INT` 之前到达并结束 Job；改为 Job 在第一个 Run 中启动、打印 trap-ready 后再输入，断言不变；单独连跑 6 次通过。本票完成前 git merge main 即可得到修复。
