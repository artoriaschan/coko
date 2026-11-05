# 11: 默认打开按需加载并迁移现有 MCP 测试

**What to build:** 「按需加载 MCP 工具」改为默认打开，达到 TS-02 的最终状态。经 Run 装配直接调用 MCP 工具的现有 integration 与 E2E 测试逐个检查，按测试目的改为先搜索、把 fixture Server 设为始终加载，或关闭全局开关，并记录理由。没有配置 MCP 的会话行为不变。

**规格场景:** [spec](../spec.md) 的 TS-02 中的默认值与用户故事 34；Testing Decisions 的“旧测试与执行范围”。

**设计依据:** [design.md](../design.md) 第 8 节。

**文档影响:** [MCP](../../../docs/subsystems/mcp.md)、[分层配置](../../../docs/subsystems/configuration.md) 与 [上下文管理](../../../docs/subsystems/context.md) 中的默认值与工具提供方式按默认打开更新。

**Blocked by:** 03 按需加载最小闭环：目录、按确切名称加载与加载记录；06 MCP Server「始终加载」

**Status:** ready-for-agent

- [ ] 全局配置的默认值改为 true；未设置该键的用户与 Headless Run 都得到打开的行为。07 号票已完成时，设置界面的默认显示与相关测试同步更新；未完成时，由 07 号票按新的默认值实现。
- [ ] 含 `mcp__` 工具名的测试逐个检查：验证 MCP 执行链本身的，改为先搜索或把 fixture Server 设为始终加载；与按需加载无关的，可以关闭全局开关。每个文件的处理方式与理由记入 Comments；不放宽断言，不跳过或删除测试。
- [ ] 断言“用量计入全部 MCP 工具”的测试随行为修改，并说明理由。
- [ ] 没有配置 MCP 的会话，请求与改动前相同，没有 `tool_search` 与目录。
- [ ] 前面各票中显式打开开关的测试继续通过。
- [ ] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行受影响的 MCP 相关 unit、integration 与 E2E 测试及类型检查；改动波及共享装配，范围按实际受影响的模块确定。实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
