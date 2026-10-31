# 插件夹具

`sample/` 是一个最小插件：清单 `.coko-plugin/plugin.json`（name `sample`），一个 Skill（`greet`）、一个命令（`hello`）、一个子代理定义
（`reviewer`）、一个 PreToolUse Hook（`tests/fixtures/hooks/hook.mjs`）、一个 stdio MCP Server（`tests/fixtures/mcp/stdio-server.ts`）与一个
语言服务器（`tests/fixtures/lsp/server.mjs`）。

文件中的 `${NODE}`、`${HOOK_FIXTURE}`、`${HOOK_RECORD}`、`${MCP_FIXTURE}`、`${MCP_LOG}`、`${LSP_FIXTURE}` 是夹具占位：
`tests/integration/sidecar-harness.ts` 的 `preparePluginFixture` 把插件复制到临时目录并替换为绝对路径；`${COKO_PLUGIN_ROOT}` 由插件的加载替换。
不要直接把本目录交给 Sidecar：占位未替换时 MCP Server 被当作引用 Secret 而不加载。
