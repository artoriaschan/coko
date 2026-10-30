# 11: Goal 卡、Run 用量与 Session 费用显示

**What to build:** 见 [规格](../spec.md) "界面"一节：dock 的 Goal 卡（`dock-slots.ts` 的 goal 一行改为可用）——目标、阶段徽标与原因、轮次、成功条件与证据、预算条（≥ 80% warning、耗尽 destructive、未定价提示）、暂停 / 恢复 / 编辑目标与预算 / 标为完成 / 取消（确认框）；`/goal` 无参数时打开 Goal 卡；时间线 `goal` 条目的紧凑状态行；每个 Run 结束后的用量行（Token 合计、费用或"未定价"）；会话标题栏 Session 累计费用（`header-actions.ts` 的 cost 一行，HoverCard 分项）。只改 renderer。

**User stories:** 1, 3, 5, 16

**Blocked by:** 10

**Status:** ready-for-agent

**Write scope:** `apps/desktop/src/renderer/features/conversation/dock/{goal-card.tsx,dock-slots.ts（goal 一行）}`、`features/conversation/{goal-row,run-usage-row,session-cost（新）}.tsx`、`features/conversation/header-actions.ts`（cost 一行）、`stores/goal-store.ts`（新）、`packages/i18n/src/dictionaries/domains/{goal,usage}.ts`、`apps/desktop/src/renderer/**/goal*.browser.test.tsx`（新）、`apps/desktop/e2e/goal.e2e.test.ts`（新）、`docs/subsystems/goal.md`（界面一节）

- [ ] Browser Mode：九个阶段的徽标与原因文案（zh / en）；预算条阈值；未定价时费用条显示提示而不是 0；取消需确认；key 为 goalId 与 criterionId
- [ ] E2E（真实 Sidecar + faux 多轮脚本）：建立 Goal → Goal 卡出现在 Todo 与 Queue 之间 → 轮次随 Goal Round 增长 → 暂停后不再推进、恢复后继续 → 编辑预算后 budget-exhausted 的 Goal 可恢复 → 完成后显示证据
- [ ] E2E：Run 用量行与标题栏累计费用与 `GET …/goal` 及条目中的 usage 一致；切换主题、窄窗口（390 px）与键盘操作下 Goal 卡可用（截图检查结果写在 Comments）
- [ ] 不适用项：不新增注入点或读取根（Comments 写明）
- [ ] goal.md 界面一节；`check:docs` 通过

## Comments
- 2026-10-30 lead：来自票 06——i18n 键 conversation.steeringPending 已不再使用（时间线"尚未送达"气泡已删除），本票从 zh / en 字典删除（越出写范围，已授权：packages/i18n/src/dictionaries/{en,zh}.ts）。
- 2026-10-30 lead：来自票 10——GoalResponse.usage 带 toolCalls / tokens / cost / durationMs / costUnpriced；@coko/protocol 的 USAGE_CURRENCY_SETTING 与 usageCurrencyOf；i18n 已有 usage.unpriced、usage.currency.*、usage.price.*；详见票 10 Comments。界面上显示"未定价"时与 Goal 的 cost-unpriced 阻塞原因保持同一措辞。
