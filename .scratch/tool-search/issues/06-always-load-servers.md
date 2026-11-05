# 06: MCP Server「始终加载」

**What to build:** 用户可以把几乎每次都用的 MCP Server 设为「始终加载」：它的工具始终直接出现在请求中，不进入目录，也不需要先搜索。全局、项目与插件提供的 Server 都可以设置；为已批准的项目 Server 增加这个字段，不需要重新批准。MCP Server 编辑表单增加这个选项与中英文说明；它只在「按需加载 MCP 工具」打开时生效。

**规格场景:** [spec](../spec.md) 的 AC-14，以及 AC-23 中 MCP Server 编辑表单的部分；对应 TS-04、27。

**设计依据:** [design.md](../design.md) 第 2 节代码事实表中 MCP 配置的一行。

**文档影响:** [分层配置](../../../docs/subsystems/configuration.md) 与 [MCP](../../../docs/subsystems/mcp.md) 补充 `alwaysLoad` 字段，以及它不进入批准摘要的规则。

**Blocked by:** 03 按需加载最小闭环：目录、按确切名称加载与加载记录

**Status:** ready-for-agent

- [ ] MCP Server 配置接受可选的 `alwaysLoad`；全局、项目与插件 Server 经同一校验；该字段不进入项目 Server 的批准摘要，已批准的 Server 增加它之后不需要重新批准。
- [ ] AC-14：三个来源的 Server 都设为始终加载后开始 Run，它们的工具直接出现在请求中，不在目录里；`tool_search` 按确切名称选中它们时列为已可用。
- [ ] 「按需加载 MCP 工具」关闭时，该字段没有效果。
- [ ] MCP Server 编辑表单增加「始终加载」与说明，文案按 TS-27 经 zh/en 字典提供；Browser Mode 测试覆盖保存、回显与两种语言的文案。
- [ ] 场景经真实 Sidecar（faux 脚本）验证。
- [ ] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
