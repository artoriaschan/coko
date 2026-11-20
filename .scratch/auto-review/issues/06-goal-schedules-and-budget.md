# 06: Goal、定时任务与预算

**What to build:** 审查的花费看得见、管得住：审查请求的 Token 与费用计入所属 Run 的用量和 Goal Budget；Goal Budget 耗尽后不再发出审查请求，改为问用户。Goal Round 与定时任务的 Run 在“自动审查”下同样经审查，被转交的调用照常等用户。

**User stories:** 52–56。

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] 审查请求的用量计入该 Run 的用量汇总与 Session 的费用合计
- [ ] 审查请求的 Token 与费用计入 Goal Budget，不计入 Goal 的轮次与工具调用数
- [ ] 发出审查请求前经与对话请求相同的请求前检查
- [ ] 检查不通过时不发审查请求，出现带预算代码的待审批请求；Run 之后按现有规则因预算暂停
- [ ] 失败与被取消的审查请求中已报告的用量同样计入
- [ ] Goal Round 在该模式下：Reviewer 放行的调用执行；被转交的调用等待用户，Goal 的等待状态与现有审批等待相同
- [ ] 定时任务的 Run 在该模式下经审查；定时 Run 中 `schedule_create` 的现有限制不变
- [ ] 集成测试：带 Token 或费用上限的 Goal 中，审查请求的用量使预算读数增加；预算耗尽后请求明细日志中没有新的审查请求
- [ ] 集成测试：Goal Round 中被转交的调用使 Session 进入等待审批，允许后 Goal 继续
- [ ] 集成测试：定时任务触发的 Run 中未被规则覆盖的命令有审查请求

## Comments
