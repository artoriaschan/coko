# 07: 日期改为 State Update

**What to build:** 模型在 Session 的第一个 Run 收到今天的日期与星期，跨过午夜后的下一个 Run 收到新日期；同一天不再重复。日期按 Sidecar 的时钟与环境中的时区计算，子 Session 同样收到。见 [规格](../spec.md) 的“State Update 的内容”与“何时送达”。

**User stories:** 12、29（日期部分）

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Sidecar 集成测试（测试时钟）：首个 Run 送达 date；同一天的后续 Run 不送；跨过午夜后的下一个 Run 送达新日期
- [ ] Run 进行中跨过午夜不在中途送达
- [ ] 与 todo_list 同时送达时 date 在前
- [ ] 子代理与 teammate 的子 Session 的第一个 Run 收到 date
- [ ] 文档：上下文管理；`check:docs` 通过
