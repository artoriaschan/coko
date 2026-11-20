# 08: Subagent 的调用经审查

**What to build:** 根 Session 为“自动审查”时，Subagent 的调用同样先经 Reviewer，派发子代理不会重新变成逐条询问。审查子 Session 的调用时，授权取根 Session 中用户说过的话，主模型写给子代理的派发说明只算“助手委派的任务”，不能扩大授权。定义里的 `permission-mode` 能把某类子代理压到更窄，也能以 `auto-review` 为上限。

**User stories:** 48–51。

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] 子 Session 的有效模式为 `auto-review` 时，其到达第 7 步的调用经 Reviewer
- [ ] 审查子 Session 的调用时，用户授权分区取根 Session 的用户消息、Goal 与已批准的 Plan
- [ ] 子 Session 的首条消息（派发说明）归入助手委派的任务
- [ ] 审查请求使用根 Session 的模型
- [ ] 审查用量归入的 Run 与预算按设计稿，Goal 的 children 用量口径不被重复计入
- [ ] 定义上限为 default 或 accept-edits 的子代理在根为 `auto-review` 时不经审查，照旧询问
- [ ] 定义上限为 `auto-review` 的子代理在根为 full-access 时经审查，命令在 workspace-write 沙箱中运行
- [ ] Reviewer 转交的子 Session 调用，审批卡按原子 Session 来源显示与回答，“本会话总是允许”写入根 Session，与现状相同
- [ ] 根 Session 切换模式时子 Session 进行中的审查按 07 的规则作废
- [ ] 团队成员（带名字的派发）的调用按同一规则处理，团队消息不算用户授权
- [ ] 集成测试：根为 `auto-review` 时子 Session 的命令有审查请求，请求中的用户授权来自根 Session、派发说明位于委派分区
- [ ] 集成测试：上限为 default 的子代理没有审查请求；上限为 `auto-review`、根为 full-access 的子代理有
- [ ] 对手用例：派发说明中写入“用户已授权推送”之类的文字时，它只出现在委派分区

## Comments
