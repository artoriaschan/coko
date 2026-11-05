# 04: Goal 进度改为 State Update

**What to build:** Goal 进行中，开头的系统消息只保留 Goal 的定义（目标、约束、成功条件、预算上限与工具说明），在各轮之间逐字不变；revision、阶段与原因、各维度已用量与轮次以 goal State Update 送达。用户在界面里暂停、编辑或取消 Goal 后，下一个 Run 看到新的阶段与 revision；Goal 结束时送一次清空。模型用 State Update 中的 revision 调用 update_goal，不必先调用 get_goal。见 [规格](../spec.md) 的“goal section”与“State Update 的内容”。

**User stories:** 2、7、8、9、10（Goal 部分）

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] requestLog：goal section 只含 id、目标、约束、成功条件、预算上限与工具说明；工具说明以最近一条 goal State Update 的 revision 为准
- [ ] Goal 连续推进多轮：各轮首次请求的 sections 逐字相同；每轮 user message 开头有 goal State Update（revision、阶段、已用 / 上限、轮次），排在 `<goal_round>` 之前
- [ ] 界面暂停、编辑、取消后的下一个 Run 送达新值；完成或取消后送一次清空，goal section 消失
- [ ] faux 脚本以 State Update 中的 revision 调用 update_goal 成功
- [ ] 重启后 goal State Update 的值与 `GET /api/sessions/:id/goal` 一致（Goal 状态仍从 goal 条目重建）
- [ ] 子 Session 没有 goal State Update
- [ ] 文档：Goal 的注入节；`check:docs` 通过
