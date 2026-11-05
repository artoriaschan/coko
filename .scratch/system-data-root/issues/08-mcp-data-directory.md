# 08: MCP 运行时数据目录

**What to build:** 每个 MCP Server 获得稳定的运行时数据目录 `~/.coko/data/mcp/<serverName>/`。启动 stdio Server 时注入环境变量 `COKO_MCP_DATA_DIR`；配置没有指定 `cwd` 时把该目录作为 cwd，配置显式指定 `cwd` 时不覆盖。该目录按 Server 保留，不随会话删除。

**Blocked by:** 01 主数据根切换到 ~/.coko

**Status:** ready-for-agent

- [ ] 启用一个 stdio MCP Server 后，`data/mcp/<serverName>/` 自动创建，Server 进程能读到 `COKO_MCP_DATA_DIR`。
- [ ] 配置未指定 `cwd` 时，Server 的 cwd 是该数据目录；配置指定了 `cwd` 时保持配置值。
- [ ] HTTP 类型的 Server 不因缺少 cwd 而失败，目录仍按需创建。
- [ ] 删除会话不会删除 `data/mcp/` 下的内容；卸载 Server 后目录保留。
- [ ] 集成测试用现有 MCP fixture 验证环境变量与 cwd；现有 MCP 连接与工具调用测试不回归。
