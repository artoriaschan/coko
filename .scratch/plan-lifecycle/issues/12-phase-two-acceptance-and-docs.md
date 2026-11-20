# 12: 阶段二集成验收与文档

**What to build:** 在真实应用里走通“规划、批准、执行、完成报告”与“执行中放弃”两条路径，逐条核对规格的阶段二用户故事，并让术语表、ADR 状态与当前行为文档和实现一致。本票结束即整份规格交付完成。见 [规格](../spec.md) 的 User Stories 45–68 与 Testing Decisions。

**User stories:** 45–68（核对）

**Blocked by:** 10、11

**Status:** ready-for-agent

- [ ] Electron 端到端用例（后台模式）：`/plan` 进入，提交并批准后 Plan chip 显示“执行中”；模型写 Todo List 并提交完成报告；计划卡与右栏 Plan 页显示“已完成”与报告，chip 消失
- [ ] Electron 端到端用例：执行中点 Plan chip 的 × 放弃，计划卡显示“已放弃”，从协议读回没有活动的 Plan，已写入的文件仍在
- [ ] 规格的用户故事 45–68 逐条对应到通过的测试或证据；没有对应的列为缺口并说明
- [ ] 术语表：Plan 改为贯穿到结果反馈的方案，状态为待审阅、已拒绝、执行中、已完成、已放弃
- [ ] 新 ADR 的实施状态更新为已实施
- [ ] 当前行为文档从导航入口读回核验，与实现一致：Plan Mode（阶段、`complete_plan`、放弃、界面）、上下文管理、Todo List 中与计划的关系、Goal 中“不新增关联”的说明、追踪与审计、桌面工作台，以及两个包的 README；文档导航中 Plan Mode 的摘要同步
- [ ] 证据按 [证据模板](../../../docs/templates/evidence.md) 记录
- [ ] 如实报告未验证项：真实模型是否先拆 Todo、是否在做完后调用 `complete_plan`、报告是否逐项对照计划
- [ ] `pnpm run typecheck`、`pnpm run check:docs` 与本阶段受影响的测试文件通过；报告实际选中的用例数
