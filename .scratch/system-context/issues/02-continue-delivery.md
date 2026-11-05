# 02: continue 时送达 State Update

**What to build:** 用户继续一个暂停或中断的 Run 时，如果之后状态有变化，模型先看到一条只含 State Update 块的 user message，再接着做；没有变化时 continue 与现在相同。这条消息不算用户的输入。见 [规格](../spec.md)“何时送达”中的 continue，以及 [设计](../design.md)“Run 开始”中 continue 的处理。

**User stories:** 21、28

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Sidecar 集成测试（faux）：Run 在写过 Todo 后暂停；continue 先提交 `state_update` 条目与只含块的 user message，第一次请求的最后一条消息是它
- [ ] 没有要送达的项：continue 的 requestLog 与条目与现在相同
- [ ] 继续一个 Goal Round 的 Run：只含块的 user message 不使授权变为 user
- [ ] 时间线：只含块的 user message 不成气泡
- [ ] 以工具结果结尾与以 user message 结尾的 Run 在 faux 下都能继续；真实 Provider 是否验证写入 Comments
- [ ] 文档：上下文管理中 continue 的送达；`check:docs` 通过
