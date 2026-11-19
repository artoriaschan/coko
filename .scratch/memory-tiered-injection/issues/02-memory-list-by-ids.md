# 02: memory_list 按 id 读取

**What to build:** 模型知道某条记忆的 id 时可以直接读出它的全文。`memory_list` 增加可选参数 `ids`，至多 20 个，返回这些条目的完整条目块，次序与给出的次序相同。只能读取本次 Run 可见的条目（用户级与本 Run 的项目记忆 Workspace）；不存在或不可见的 id 不让整次调用失败，结果在条目块之后列出没有找到的 id。`ids` 与 `query` 只能用其一。子 Session 与 Headless Run 已注册 `memory_list`，同样可用。本票先于摘要层交付，使主分支上不出现“看得到摘要却读不了全文”的中间状态。

**规格场景:** [spec](../spec.md) 的 AC-12、AC-13、AC-14，以及 AC-15 中关于 `ids` 参数的部分；实现决定“按 id 读取”；用户故事 2、23、24。

**文档影响:** [Memory](../../../docs/subsystems/memory.md) 工具与权限一节的 `memory_list` 行与验证一节。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] AC-12：以 `ids` 调用返回对应条目的完整条目块，格式与现有列表相同（带 id、作用域、来源），次序与给出的次序相同。
- [ ] AC-13：`ids` 中混有不存在的 id、属于其他项目的 id 与可见的 id 时，返回可见的条目并列出其余 id 没有找到；全部没有找到时结果只有未找到的说明，不是工具错误。
- [ ] AC-14：`ids` 超过 20 个在参数校验阶段失败，不执行；`ids` 与 `query` 同时给出作为工具错误返回，提示二者只能用其一。
- [ ] 不属于项目的 Run 中按 id 读取 Workspace 作用域的条目为未找到。
- [ ] 子 Session 与 Headless Run 的请求中 `memory_list` 带 `ids` 参数，调用返回全文。
- [ ] 工具描述说明可以用 `ids` 读取指定条目的全文；权限类与注册条件不变；结果超长时沿用现有截断。
- [ ] 单元测试覆盖次序、未找到、与 `query` 互斥和上限；真实 Sidecar（faux 脚本）用例覆盖可见范围。
- [ ] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-19：用户确认 8 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
- 与 05 都会改 `memory_list`，合并时注意同一处的改动。
