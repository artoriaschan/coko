# 04: 记忆操作不经审批

**What to build:** 用户让 Agent 记住一件事时，Agent 直接记下，对话不被审批卡打断。记忆的写入、替换与删除在五种 Permission Mode 下都直接执行，包括 read-only 与 plan；时间线上照常出现“已记住”“已更新记忆”“已删除记忆”的工具卡，详情中可见正文。想收紧的用户仍然可以配置 `Memory` 的询问或拒绝规则，外部 Hook 也照常生效。

**规格场景:** [spec](../spec.md) 的 AC-12、AC-13、AC-14、AC-28；实现决定“权限”；用户故事 10、11、12、13。

**文档影响:** [权限判定与审批](../../../docs/subsystems/permissions.md) 的权限类表与规则组说明；[Plan Mode](../../../docs/subsystems/plan-mode.md) 中“memory-write 照常询问”的说法；[Memory](../../../docs/subsystems/memory.md) 的工具与权限、工具卡；[无界面运行](../../../docs/subsystems/headless.md) 中列举需要审批的调用处如提到记忆则同步。

**Blocked by:** 01 新增 ADR 与术语更新；02 工具层限制：保护用户手写条目，无界面运行只读；03 Memory 段：声明、来源标注与写入引导

**Status:** ready-for-agent

- [ ] AC-12：default 模式且没有任何 `Memory` 规则时，模型调用 `memory_write`，没有审批请求，条目已保存，结果为成功；read-only、plan、accept-edits、full-access 下相同。
- [ ] AC-13：同样条件下模型调用 `memory_delete` 删除一条 Agent 来源的条目，没有审批请求，条目已删除。
- [ ] AC-14：全局有 `Memory` 询问规则时，模型调用 `memory_write` 出现审批请求；换成拒绝规则时调用被拒绝，条目未保存。项目设置文件中的同名规则同样生效。
- [ ] 判定顺序不变：拒绝规则、询问规则与外部 Hook 先于模式放行；PreToolUse Hook 的 deny 仍能阻止记忆写入。
- [ ] 已保存的 `Memory` 允许规则保持有效且不报错，不做清理。
- [ ] AC-28：桌面应用 default 模式下模型写入记忆，不出现审批卡，时间线出现“已记住”工具卡，详情可见正文。按 [UI 调试约定](../../../AGENTS.md)静默验证，说明哪些交互未在真实指针或原生层验证。
- [ ] 权限判定的单元测试覆盖 memory-write 在五种模式下放行、询问与拒绝规则仍生效；现有记忆的 Sidecar 用例与 Electron E2E 中依赖审批的步骤按新行为改写，不保留旧行为的断言。
- [ ] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-19：用户确认 9 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
- 本票排在 02、03 之后，使主分支上不出现“审批已取消、限制尚未到位”的中间状态。
