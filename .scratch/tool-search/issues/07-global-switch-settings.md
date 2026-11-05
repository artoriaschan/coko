# 07: 全局开关的设置界面与项目收紧

**What to build:** 用户在设置 → MCP 顶部的「工具搜索」分组中开关「按需加载 MCP 工具」。关闭后所有 MCP 工具直接提供，不注册 `tool_search`，不发目录；关闭期间直接调用过的工具，重新打开后仍是按需工具，不算已加载。项目设置只能把它设为 false；设为 true 时被忽略，并给出诊断。开关从下一个 Run 生效，进行中的 Run 沿用开始时的设置。

**规格场景:** [spec](../spec.md) 的 AC-13，以及 AC-23 中 MCP 分区的部分；对应 TS-02、18、25 中全局开关的部分、27。

**设计依据:** [design.md](../design.md) 第 2 节“仍然适用的决定”；[ADR 0008](../../../docs/adr/0008-project-files-only-tighten.md)。

**文档影响:** [分层配置](../../../docs/subsystems/configuration.md) 补充该键与项目收紧规则；[MCP](../../../docs/subsystems/mcp.md) 说明开关关闭时的行为。

**Blocked by:** 03 按需加载最小闭环：目录、按确切名称加载与加载记录

**Status:** ready-for-agent

- [ ] 设置的 MCP 分区顶部增加「工具搜索」分组与开关，标题、选项名与说明按 TS-27 经 zh/en 字典提供；Browser Mode 测试覆盖切换、保存与两种语言的文案。
- [ ] AC-13：关闭期间所有 MCP 工具直接提供，没有 `tool_search` 与目录；关闭期间直接调用工具 D，重新打开后 D 仍是按需工具，不在已加载名单中。
- [ ] 项目设置设为 false 时，该项目的会话不按需加载；设为 true 时被忽略，并给出诊断。
- [ ] 切换开关从下一个 Run 生效，重试与继续也算新 Run；进行中的 Run（含等待审批的）沿用开始时的值；已加载的工具不丢。
- [ ] 场景经真实 Sidecar（faux 脚本）验证。
- [ ] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
