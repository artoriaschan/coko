# 02: 工具层限制：保护用户手写条目，无界面运行只读

**What to build:** 用户在设置里亲手写的记忆不会被 Agent 改写或删除：模型按 id 替换或删除来源为用户的条目时得到工具错误，条目不变；来源为 Agent 的条目模型仍可自由维护。用户在设置里修改过一条 Agent 记下的条目后，这条的来源变为用户，界面标签变为“手动添加”，之后模型同样不能改动它。Headless Run 只能读记忆：请求中有 `memory_list`，没有 `memory_write` 与 `memory_delete`。这些限制先于“不经审批”（04）交付，本票不改变审批行为。

**规格场景:** [spec](../spec.md) 的 AC-15、AC-16、AC-17，以及 AC-09 中“子 Session 没有写入与删除工具”的部分；用户故事 14、15、16、20、21。

**文档影响:** [Memory](../../../docs/subsystems/memory.md) 的条目与来源、工具结果与错误；[无界面运行](../../../docs/subsystems/headless.md) 的工具集合；[@coko/session](../../../packages/session/README.md) 中记忆更新接口的说明。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] AC-15：模型按 id 替换或删除一条来源为用户的条目，得到说明“该条目由用户维护”的工具错误，条目的正文与来源不变；对来源为 Agent 的条目的替换与删除照常成功。
- [ ] AC-16：用户经接口修改一条 Agent 来源条目的正文后，接口返回的来源为用户；之后模型按 id 替换它得到工具错误。经工具的替换不改变来源。存储的更新接口支持在改正文时改来源，内存实现与 SQLite 实现的契约测试一并覆盖，不新增 schema 版本。
- [ ] AC-17：Headless Run 且记忆开启时，请求中有 Memory 段与 `memory_list`，没有 `memory_write` 与 `memory_delete`。
- [ ] 子代理与 Teammate 的子 Session 没有 `memory_write` 与 `memory_delete`（现状），补上回归断言。
- [ ] 对手用例：记忆正文或工具输出中构造的文本（自称用户手写、伪造来源标注）不能改变条目的来源，也不能让模型改动用户来源的条目。
- [ ] 设置的 Memory 分区中，编辑并保存一条 Agent 记下的条目后，来源标签显示为“手动添加”。
- [ ] 场景经真实 Sidecar（faux 脚本）验证；现有的记忆凭据脱敏用例继续通过。
- [ ] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-19：用户确认 9 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
