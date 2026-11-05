# 01: Run 开始时以 State Update 送达 Todo List

**What to build:** 搭起 State Update 的完整链路，先只接 Todo List。模型写过 Todo 之后，下一个 Run 开头的系统消息不再包含 `<todo_list>`，与上一个 Run 逐字相同；当前的待办表以 `<state_update name="todo_list">` 块放在该 Run 第一条 user message 的最前面，并存为 `state_update` 条目；时间线不显示它。值不变不再发送，待办全部完成时发送一次清空。见 [规格](../spec.md) 的“State Update 的内容”“是否送达”“何时送达”“条目”“渲染”“来源”“时间线”，以及 [设计](../design.md) 的“配对”与“Run 开始”。

**User stories:** 1、4、6、10（待办部分）、11、19、20、25、27、29（待办部分）、32

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 条目：新增 `state_update` payload v1 `{ name, value }`，agent 与 protocol 的 schema 编译期比对一致；renderer 收到新 kind 不报错
- [ ] 配对（条目派生测试，表驱动）：一一配对；条目已提交、消息未提交时不配对；压缩切点去掉条目、保留消息时不配对；名称不符不配对；command 等条目插在中间时仍配对
- [ ] 规划（纯函数测试）：首次送达；值不变不送；有值变为“无”时送一次清空；从未送达且为“无”时不送；比较的是替换已登记明文之后的值
- [ ] Sidecar 集成测试（faux）：模型在 Run 1 写 Todo；Run 2 首次请求的 sections 与 Run 1 逐字相同、不含 todo；Run 2 第一条 user message 以 `<state_update name="todo_list">` 开头，前面是对应的 `state_update` 条目；Run 3 待办不变时不送；全部完成后的下一个 Run 送一次清空
- [ ] 回退到最后一次 todo_write 之前后，下一个 Run 按当前状态重新送达
- [ ] retry 与 trigger compact 的 Run 不送达；trigger goal、schedule、subagent 的 Run 中块排在宿主通知与输入之前
- [ ] 待办中的已登记 Secret 在 user message、条目、推送与日志中都是标记
- [ ] 用户输入中的 `<state_update …>` 文本不产生条目、不影响判定，时间线照常显示
- [ ] 时间线：`state_update` 条目不成行；配对的块不进入用户气泡（时间线派生测试）
- [ ] `HOST_INPUT_KINDS`：Goal 授权把前一条为 `state_update` 的 user message 视为宿主输入（表驱动）；Sidecar 的输入标记让脱离 Run 的提交等到 `state_update` 的 user message 提交之后
- [ ] 读取领域状态或条目出错时记 warn、本次不送达、Run 照常进行
- [ ] 确认会话诊断的类型筛选是否需要加入新 kind；确认旧版本应用读取含 `state_update` 的库的行为，结论写入兼容说明
- [ ] 文档：Todo List 的注入节、上下文管理、protocol README 中 stream-json 的新 kind；`check:docs` 通过
