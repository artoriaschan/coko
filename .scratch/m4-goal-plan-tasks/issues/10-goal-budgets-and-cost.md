# 10: Goal 预算与费用：五维预算、调用前检查、模型价格与 usage.cost

**What to build:** 见 [规格](../spec.md) "预算口径""检查点"与"模型价格与费用"：agent `goals/` 的预算派生（从条目计算五维、接受子 Session 条目的汇总函数）与检查；运行时 `beforeRequest` 检查 Token / 费用 / 时间并 `stopAfterBatch`、工具调用前检查调用数、Goal Round 开始前检查五维；未定价模型遇到 maxCost 时 blocked（cost-unpriced）；`compaction` v2 的 `usage`（摘要请求的 usage）；Model Catalog 的可选 `price`（protocol、server 校验、注册表写入 `model.cost`）；设置 `usage.currency`；设置 → 模型服务的价格输入与货币选择；faux 脚本可设 usage 以驱动测试。M4 结束时汇总 agent 与 server README。

**User stories:** 3, 16

**Blocked by:** 09

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/goals/`、`packages/agent/src/engine/`、`packages/agent/src/models/registry.ts`、`packages/agent/src/session-entries/{goals,context}.ts`、`packages/protocol/src/{goal,http,context-entries}.ts`、`apps/server/src/application/{goals,goal-driver,session-runs,providers}.ts`、`application/context/goal.ts`、`http/routes/goals.ts`、`apps/server/src/adapters/faux.ts`、`apps/desktop/src/renderer/features/settings/{model-catalog,models-section}.tsx` 与 `catalog-draft.ts`、`packages/i18n/src/dictionaries/domains/usage.ts`、`tests/integration/{sidecar-goal-budget,sidecar-model-price}.test.ts`（新）、`apps/desktop/src/renderer/**/model-price*.browser.test.tsx`（新）、`docs/subsystems/goal.md`、`docs/adr/0011-goal-state-as-session-entries.md`、`.scratch/model-service-settings/spec.md`（10.1 追加修订记录）、`packages/agent/README.md`、`apps/server/README.md`

- [ ] agent 表驱动：五维派生（用户提交的 Run 计入 Token / 费用 / 时间 / 工具调用、不计轮次；paused 期间开始的 Run 不计；compaction.usage 计入）；子 Session 汇总函数；`compaction` v1 读回为 v2
- [ ] 集成：每一维单独设上限各一例，达到后 Run 以 `paused` + `budget_exhausted` 结束、Goal 为 budget-exhausted 且 reason 写明维度；工具调用上限时超出的那次调用不执行（Workspace 文件逐字节不变）；调高上限后恢复继续
- [ ] 集成：设 maxCost、模型未定价 → 不发出模型请求（requestLog 为空）、Goal blocked（cost-unpriced）；模型有价格时 assistant 条目的 usage.cost 与价格一致（手算期望值）
- [ ] 集成 `sidecar-model-price`：`provider.save` 保存价格并读回；负数价格 400；没有价格的旧目录照常可用
- [ ] Browser Mode：模型选项的价格输入（留空 = 未定价、负数报错）与货币选择；模型服务页其余交互与 MS 验收场景不受影响（已有测试通过）
- [ ] 不适用项：不新增注入点（预算用量进入 `<goal>` 的部分由票 09 的总闸覆盖，本票在该用例中补用量字段的断言）
- [ ] goal.md 补预算；ADR 0011 改为 implemented 并链接 09、10 的证据；模型服务 PRD 10.1 追加修订记录；agent 与 server README 汇总 M4；`check:docs` 通过

## Comments
- 2026-10-30 lead：来自票 09——exhaustedDimension 与 GoalUsageSnapshot 目前只有 rounds；GoalUsage 的可选字段；runEnded 中 budget_exhausted 与 cost_unpriced 的映射；详见票 09 Comments"供后续票"。来自票 05、09 的合并：sidecar-compaction 的自动压缩用例已把窗口改为 65k，本票若再增加系统提示或工具定义，先看该用例第三轮的断言。请核对 goal.md 是否写明票 09 的四项偏离（update_goal 注册时机、停止 Run 暂停 Goal、有序关闭记 user-stopped、goal-n 与 snake_case），缺则补。faux 的 $LAST_JOB_ID 占位保留（票 04）。
