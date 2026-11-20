# 09: 批准后进入执行中并持续提醒

**What to build:** 批准不再是计划的终点。批准后 Plan 为执行中，Plan chip 与计划卡显示“执行中”；模型被要求先把计划拆成 Todo List 再动手；执行跨多个 Run 时，每个 Run 都以 State Update 告诉模型有未完成的 Plan；计划正文被压缩掉之后重新提供。本票还没有结束计划的出口，完成与放弃分别在 10 与 11。见 [规格](../spec.md) 的“阶段二：执行中与完成”“阶段二：界面”与设计稿。

**User stories:** 45、46、47、48、49、50、51

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] 批准时提交的计划阶段为“执行中”并带该 Plan 的 planId，取代阶段一的“无”；计划接口读回执行中与活动的 Plan
- [ ] 批准的工具结果按设计稿的阶段二文本：先用 `todo_write` 拆解，执行并验证，结束时调用 `complete_plan` 对照计划汇报
- [ ] 宿主不检查是否拆了 Todo：批准后不调用 `todo_write` 直接写入照常放行
- [ ] 执行中写入不再被拒，命令沙箱回到 Permission Mode 对应的档位
- [ ] 执行中的 State Update：名称、值与渲染按设计稿；带新输入的 Run 开始时送达，块位于 user message 最前，前置对应的 `state_update` 条目；时间线不显示
- [ ] State Update 的去重与重发遵循既有规则：值不变不重复；回退或压缩去掉旧的送达后重发
- [ ] `<approved_plan>` 只在计划阶段为执行中、且该 Plan 的正文早于最后一次有效压缩时注入；历史上已批准、没有执行阶段的 Plan 不再注入
- [ ] 有执行中的 Plan 而没有 Goal 时，Run 结束后宿主不发起新的 Run
- [ ] 桌面：Plan chip 在执行中显示“执行中”，样式不变；时间线计划卡与右栏 Plan 页对执行中的 Plan 显示“执行中”，历史上已批准的仍显示“已批准”
- [ ] 本票的过渡状态：执行中的退出动作只把计划阶段置为“无”，不改 `plan` 条目；由 11 改为放弃。写入本票的评论
- [ ] Sidecar 集成测试与 renderer 浏览器测试覆盖以上各项
- [ ] 文档：Plan Mode、上下文管理的 State Update 清单与 `<approved_plan>` 条件、桌面工作台；`pnpm run check:docs` 通过
