# 05: 团队状态改为 State Update

**What to build:** teammate 的子 Session 中，`<team>` section 只保留自己的名字、lead 与任务板规则，在多个 Run 之间逐字不变；其他成员的状态与任务板上的当前任务以 team State Update 在 teammate 的 Run 开头送达，变化才送。见 [规格](../spec.md) 的“teams section”与“State Update 的内容”。

**User stories:** 3、13、29（团队部分）

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] requestLog：teams section 只含名字、lead 与任务板规则
- [ ] teammate 的 Run 开头有 team State Update（其他未解散成员的状态、任务板上的当前任务，至多 30 行）；成员状态或任务变化后下一个 Run 送达新值，不变不送
- [ ] 同一 teammate 的多个 Run 首次请求 sections 逐字相同
- [ ] 任务标题中的已登记 Secret 是标记
- [ ] 文档：Agent Teams 的 `<team>` 节；`check:docs` 通过
