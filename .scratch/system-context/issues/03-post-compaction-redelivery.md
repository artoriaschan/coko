# 03: Run 内压缩之后补发 State Update

**What to build:** 长 Run 中自动压缩把写过的待办摘要掉之后，模型在下一次请求里立即重新看到当前的待办；溢出恢复同样补发。摘要请求里的 State Update 缩为一行。见 [规格](../spec.md)“何时送达”中的压缩之后与“摘要请求”，以及 [设计](../design.md)“Run 内压缩之后”。

**User stories:** 24

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Sidecar 集成测试（faux 小窗口）：Run 内自动压缩后，compaction 条目之后依次是 `state_update` 条目与只含块的 user message；下一次请求以它结尾，被摘要掉的待办重新出现
- [ ] 溢出恢复：压缩成功之后、继续之前同样补发
- [ ] 摘要请求中配对的块为 `[state update: todo_list]`；用户输入中的同名文本照原文进入摘要请求
- [ ] 手动 `/compact` 的 Run 不送达，之后的 Run 开头送达
- [ ] 补发之后的请求失败时，retry 重放的上下文包含补发的消息，与原请求一致
- [ ] 文档：上下文管理的压缩节（取代“压缩后的 `<todo_list>`”）；`check:docs` 通过
