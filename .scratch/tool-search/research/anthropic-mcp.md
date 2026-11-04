---
kind: reference
description: "Anthropic tool search 与 MCP 工具发现的一手资料核查。"
lifecycle: active
---

# Anthropic 与 MCP tool search 调研

核查日期：2026-11-04。状态：研究材料，未批准为 Coko 设计，未实施；未运行付费 API 或真实 MCP 联调。本文只记录外部机制及明确标注的推论；Coko 接入结论由本次综合研究承担。

## Anthropic 原生机制

请求携带搜索工具与全部业务工具定义，待发现的定义设 `defer_loading: true`；搜索工具保持常驻。延迟加载减少模型上下文，不减少每次发送的定义。内置版本为 `tool_search_tool_regex_20251119`（Python 正则）和 `tool_search_tool_bm25_20251119`（自然语言查询）；检索名称、描述及参数的名称与描述。[Tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)

命中通过 `tool_reference` 引用，API 展开定义。自定义检索也可返回下面的标准工具结果；每个引用必须对应顶层 `tools` 中的定义。它允许应用自行选择检索算法，无需模仿内置排序。[Tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#custom-tool-search-implementation)

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_search",
  "content": [{ "type": "tool_reference", "tool_name": "github_list_issues" }]
}
```

原生搜索的 `server_tool_use` 与 `tool_search_tool_result` 应原样回传历史；不要对 `srvtoolu_...` 再回工具结果。后续请求保留全量 `tools`，历史引用使已发现工具可复用。Bedrock 原生搜索仅支持 InvokeModel，不支持 Converse。模型应按兼容表核对；同页末尾“every model”与兼容表排除早期模型的描述不一致，不能据此承诺任意模型可用。[Tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)

## 缓存与动态工具

延迟定义不进入系统提示前缀，发现时内联展开在会话中，因此能保留前缀缓存；直接修改初始工具定义会使工具及其后续层级缓存失效。缓存减少重复计费，并不减少上下文占用；tool search 与旧工具结果裁剪分别处理不同来源的上下文压力。[Tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching)、[Manage tool context](https://platform.claude.com/docs/en/agents-and-tools/tool-use/manage-tool-context)

Anthropic 另有 `tool_addition` / `tool_removal` 的会话中工具变更机制，且受模型、工具类型与 beta header 约束；它与返回搜索引用是不同能力。推论：跨 provider 的实现必须分别验证“可改 offered tools”和“可解析原生 tool_reference”，不能用一个布尔值替代全部兼容性判断。[Mid-conversation system messages and tool changes](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages)

## Anthropic 托管 MCP connector

通过托管 connector 接入时，在 `mcp_toolset.default_config` 设全局 `defer_loading`，或以 `configs.<tool>` 覆盖；`enabled` 与 `defer_loading` 是独立配置。前者控制可用性，后者控制首次呈现。connector 与本地 MCP client 也不同：前者由 API 直连远程服务，后者可管理本地 stdio、资源与提示模板。[MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)

该页还记录 `mcp-client-2026-09-15` beta 的 pinned tool list。推论：动态 catalog 需要定义版本及更新时机，不能让同名工具在搜索命中与实际执行之间无声改变定义。是否采用此 beta 不属于本次已确认决定。[MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector#pin-an-mcp-server-s-tool-list-beta)

## MCP 规定什么

MCP 定义 `tools/list`（可分页）、`tools/call` 以及 catalog 变化通知；工具元数据包含 schema。模型面向工具的搜索、排序、延迟呈现和会话加载策略不在这些方法中，属于宿主实现。工具注解来自不受信任服务时不可当作可信授权依据。[MCP tools, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

通知必须按协商版本实现：2025-11-25 的 `listChanged` 服务直接发送 `notifications/tools/list_changed`；2026-07-28 要求客户端先建立 `subscriptions/listen` 并选择 `toolsListChanged: true`。新版还要求工具列表不要因同连接其他请求改变，允许按请求授权变化，建议确定性顺序，并支持缓存。[MCP tools, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#list-changed-notification)、[MCP tools, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

MCP 的访问控制、输入校验与敏感操作确认仍由服务/客户端承担。推论：搜索命中只增加模型可见性，不授予执行权限；应先从当前可用且允许发现的 catalog 检索，执行时再验证授权与定义有效性。接到 catalog 变更后重新分页拉取并更新索引，不能继续执行已移除的工具。[MCP tools security](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#security-considerations)

## 接入前待实测

- provider SDK 是否保留所有原生内容块，日志/持久化/回放是否丢掉引用。
- 压缩历史移除发现记录后，工具装载状态如何保留或重新发现；官方页面没有替 Coko 定义恢复协议。
- catalog 变更与进行中的请求如何协调，以及同名 schema 更新的执行边界。
- 中文任务对英文描述的检索质量；BM25 名称不等于 embedding 语义检索，中文召回需实际评测。
- 工具定义 token、搜索轮数、首个业务调用延迟、Recall@k 与最终任务成功率；官方节省比例不是 Coko 的测量结果。

以上待实测项是研究建议，不是新增需求或通过证明。所有官方链接均在核查日期实际打开；未读取二手文章作为结论依据。
