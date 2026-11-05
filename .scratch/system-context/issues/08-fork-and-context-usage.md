# 08: 分叉与上下文用量

**What to build:** 从某条消息分叉出的新 Session，复制的 State Update 保持与其消息的配对；新 Session 的第一个 Run 按它自己的当前状态送达（例如分叉不复制 Todo，于是送达一次清空），取代复制来的旧值。上下文环把 State Update 计入 system；导出包含 `state_update` 条目。见 [规格](../spec.md) 的“分叉”与“上下文用量”，以及 [设计](../design.md)“消费者”。

**User stories:** 26、30、31

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 助手回复分支与用户消息分叉各一例：复制的 `state_update` 与其 user message 按原顺序成对出现；配对消息没有被复制的 `state_update` 不复制
- [ ] 新 Session 的第一个 Run 送达当前值（Todo 与 Goal 未复制时为清空）
- [ ] 上下文用量接口：配对的块计入 system，用户输入中同名的文本计入 prompt
- [ ] ndjson 导出与 stream-json 中有 `state_update` 条目
- [ ] 文档：上下文管理的分叉与用量；`check:docs` 通过
