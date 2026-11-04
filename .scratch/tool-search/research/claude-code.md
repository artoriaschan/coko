---
kind: reference
description: "Claude Code 官方公开行为与本地 claude-code-best 社区实现的工具搜索调用链、算法和边界。"
lifecycle: active
---

# Claude Code 的 tool search：官方行为与本地源码分开核查

调研日期：2026-11-04。研究材料，未批准为 Coko 规格，未实施。只读源码与网页，没有启动 CLI、调用模型、执行仓库测试或重现下述代码风险。入口由[本次研究](../README.md)维护。

## 1. 先确认研究对象

本地 `/Users/artorias_chan/Workspaces/agent/claude-code` 的 origin 是 `claude-code-best/claude-code`，HEAD 为 `77a7934e15d69da13879112ed7db695c9ee7a52a`，package 名称 `claude-code-best`、版本 `2.8.4`。其 AGENTS 明确自述 reverse-engineered/decompiled，并包含裁剪和扩展；这不是 Anthropic 发布的 CLI 内部 TypeScript 源码。以下函数级分析只证明此社区 checkout 的实现。[项目声明](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/AGENTS.md)、[package](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/package.json)

本次另核查 Anthropic 官方仓库 `anthropics/claude-code`，远程 main HEAD 为 `26382c08758260c9f5deb2019d8fe851f89fa9ae`。根目录包含发行记录、示例、plugins、mods 与 scripts，未发现下面分析的 ToolSearch 核心模块；因此不能由其公开仓库确定官方内部排序算法。本次也没有下载/分析官方发行二进制。[官方仓库快照](https://github.com/anthropics/claude-code/tree/26382c08758260c9f5deb2019d8fe851f89fa9ae)、[官方 README](https://github.com/anthropics/claude-code/blob/26382c08758260c9f5deb2019d8fe851f89fa9ae/README.md)

## 2. 官方当前公开契约

当前 Claude Code 文档规定默认按需发现 MCP 工具；`ENABLE_TOOL_SEARCH=auto` 才采用 10% context 阈值，并可设 `auto:N`。启动时给模型工具名称与 server instructions；网关须支持 `defer_loading` 和 `tool_reference`，`alwaysLoad` 可控制提前加载。文档还说明自动模式一旦开启可保持开启，避免重连造成总量下降时反复切换。[官方 MCP tool search](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search)

这能证明官方加载协议与可配置行为，不能证明内部使用 BM25、TF-IDF、神经 embedding，或下面社区版的 `ExecuteExtraTool`。不要把 Anthropic API 内置 BM25/regex 工具与 Claude Code 的客户端检索算法画等号。

## 3. 本地社区版当前实际路径

其完整调用链是：

```text
完整 tools（当前会话工具范围）
  -> isDeferredTool：core/alwaysLoad 提前呈现，其余延迟
  -> SearchExtraTools(query, max_results)
  -> 名称/关键词 + TF-IDF 检索
  -> 文本 tool_result：命中名称 + ExecuteExtraTool 使用提示
  -> 历史中提取 discovered 名称
  -> ExecuteExtraTool(tool_name, params)
  -> 当前工具查找、发现门禁、启用检查、参数验证、目标权限检查
  -> targetTool.call(...)
```

**它当前采用固定代理执行入口，不是搜索后把命中工具加入下一轮 `tools`。** Claude API 组装明确过滤所有 deferred 工具，并移除原生 beta、`defer_loading`/`tool_reference` 路径；OpenAI adapter 也使用同类过滤。保留少数固定 tools 是其保持请求工具前缀稳定的设计动机；本次未测量实际缓存命中或节省量。[Claude 组装 L1187](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/src/services/api/claude.ts#L1187)、[OpenAI 组装 L249](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/src/services/api/openai/index.ts#L249)

### 启用与候选集合

`getSearchExtraToolsMode()` 读取 **`ENABLE_SEARCH_EXTRA_TOOLS`**，不是官方文档的变量。未设置为 `tst`；false 为 standard；auto 为阈值模式；auto:0/100 分别对应始终启用/standard。`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` 是关闭开关；搜索入口不在允许工具列表中也关闭。代码注释明确不再区分 provider/model：统一自建搜索。[mode L170](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/src/utils/searchExtraTools.ts#L170)、[availability L296](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/src/utils/searchExtraTools.ts#L296)

auto 模式先计算 deferred definitions 的 token 总量，失败时用字符估算，按模型 context window 百分比判断；默认10%，字符估算为2.5 chars/token。这里的默认模式和统计候选不应直接当成官方实现。[threshold L676](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/src/utils/searchExtraTools.ts#L676)

`isDeferredTool()` 对 `alwaysLoad=true` 和 `CORE_TOOLS` 返回 false，其余全部 true，包含非核心内置工具和 MCP 工具。搜索在传入的 `context.options.tools` 中筛选候选；它不负责构造用户授权的全局目录。[candidate L69](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/packages/builtin-tools/src/tools/SearchExtraToolsTool/prompt.ts#L69)

### 索引与算法

索引存工具名、规范化名、description、`searchHint`、inputSchema 和 TF-IDF 向量。`buildToolIndex()` 只索引 deferred 工具，通过 `tool.prompt()` 获得描述；字段权重是 name=3、searchHint=2.5、description=1。分词使用英语停用词和简单词干规则，中文使用相邻二字 bigram。[index L80](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/src/services/searchExtraTools/toolIndex.ts#L80)、[tokenization L151](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/src/services/skillSearch/localSearch.ts#L151)

`searchTools()` 用 TF-IDF cosine 排序；中文查询不足两个 bigram 命中且没有 ASCII 命中时压为0；完整规范化名称命中可将分数至少抬到0.75，默认展示门槛0.10。[TF-IDF search L151](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/src/services/searchExtraTools/toolIndex.ts#L151)

另一条关键词路径拆分 MCP/驼峰名，名称片段精确/部分命中、searchHint、描述分别加分。`+term` 在这条路径要求候选命中全部 required terms。常规查询同时执行两条路径，然后按关键词排名归一化分数×0.4 + TF-IDF cosine×0.6 合并，取 `max_results`，默认5。[keyword L208](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/packages/builtin-tools/src/tools/SearchExtraToolsTool/SearchExtraToolsTool.ts#L208)、[merge L471](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/packages/builtin-tools/src/tools/SearchExtraToolsTool/SearchExtraToolsTool.ts#L471)

### 查询语法与结果

- `select:A,B` 精确选取；已提前呈现的工具会标为 already_loaded。
- 裸工具名优先精确匹配；`mcp__server` 前缀可按目录顺序找到该服务器工具。
- 自然语言走双路合并；`+slack send` 具有上文所述关键词路径的 required-term 行为。
- `discover:...` 分支只运行 TF-IDF，意图返回说明/schema；但实际返回路径见下文限制。

这些语法的实现入口是 [call L350](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/packages/builtin-tools/src/tools/SearchExtraToolsTool/SearchExtraToolsTool.ts#L350)。最终标准输出只含 `matches/query/total_deferred_tools/pending_mcp_servers/already_loaded`；映射给模型的是文本名称与代理调用提示，不是原生 `tool_reference`。[result mapping L542](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/packages/builtin-tools/src/tools/SearchExtraToolsTool/SearchExtraToolsTool.ts#L542)

## 4. ExecuteExtraTool 的真实闭环与限制

代理参数 schema 是 `{tool_name: string, params: Record<string, unknown>}`。参数结构本身没有约束目标工具各自字段；模型需要另行得到目标 schema，代理执行时再校验。[Execute input L23](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/packages/builtin-tools/src/tools/ExecuteTool/ExecuteTool.ts#L23)

`call()` 先从当前 `context.options.tools` 查目标，搜索激活时再从 `context.messages` 重建 discovered 集合；未发现的 deferred 工具被拒绝。之后检查 `isEnabled()`，对有 `safeParse` 的目标 schema 做校验和默认值应用，调用目标 `validateInput` 与 `checkPermissions`，最后直接 `targetTool.call`。`params` 无 safeParse 的工具（代码注释以 MCP 为例）跳过该分支。[Execute call L66](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/packages/builtin-tools/src/tools/ExecuteTool/ExecuteTool.ts#L66)

外层 `ExecuteTool.checkPermissions()` 返回 passthrough，内层检查目标权限并只对显式 deny 分支立即返回；本次未继续验证其与完整宿主 policy/Hook/审批链的等价性。因此可证明存在目标级检查，不能宣称代理执行天然保留完整执行链。[target permission L184](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/packages/builtin-tools/src/tools/ExecuteTool/ExecuteTool.ts#L184)

静态代码有三个不宜直接照搬的边界，均未运行复现：

1. **schema 到达模型的证据不足。** `discover:` 生成包含 description/schema 的 `text` 局部变量，随后返回的却是 `buildSearchResult(matches, ...)`；该局部文本未进入返回值。标准结果映射也不携带目标 schema。当前测试只断言 matches/文本名称，不能证明模型收到 schema。因而它是“发现名称→通用执行代理”的实现，不能据注释声称完整参数定义闭环已成立。[discover L441](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/packages/builtin-tools/src/tools/SearchExtraToolsTool/SearchExtraToolsTool.ts#L441)、[test L104](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/packages/builtin-tools/src/tools/SearchExtraToolsTool/__tests__/SearchExtraToolsTool.test.ts#L104)
2. **索引版本只看名字。** `getToolIndex()` 的 key 为排序后名称串；description、schema 同名更新时不会由该 key 自行失效。系统另有 clear 函数，本次没有证明所有变更调用点均覆盖。[cache L214](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/src/services/searchExtraTools/toolIndex.ts#L214)
3. **required-term 只约束关键词一路。** TF-IDF 结果合并前未重新应用 `+term` 的交集，所以最终结果不能从关键词函数的过滤逻辑推导出严格 AND 保证。[merge L471](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/packages/builtin-tools/src/tools/SearchExtraToolsTool/SearchExtraToolsTool.ts#L471)

## 5. 发现状态、压缩与目录变化

`extractDiscoveredToolNames()` 每次从消息历史重建集合：识别 legacy `tool_reference`、当前搜索文本，以及 compact boundary 的 `preCompactDiscoveredTools`；还把 `deferred_tools_delta.addedNames` 视为 discovered。这意味着“目录名称被公告”与“搜索命中”并不严格区分；Execute 的发现门禁依赖的是这份提取结果。[history L489](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/src/utils/searchExtraTools.ts#L489)

压缩会把压缩前 discovered 集合按名称排序写到 boundary metadata；会话记忆压缩也有相应保存点。这可作为“压缩需要携带发现事实”的实现参考，但当前 API 呈现已改为固定代理，旧注释仍有“搜索后发送schema”的描述，应以实际 API 过滤代码为准。[compact L630](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/src/services/compact/compact.ts#L630)、[session memory compact L454](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/src/services/compact/sessionMemoryCompact.ts#L454)

`getDeferredToolsDelta()` 扫描此前公告的 added/removed，和当前 deferred/pool 名单做差；真正退出 pool 才报告移除，改为 upfront 时静默处理。作用是目录公告，不是 schema revision 的确认协议。[delta L610](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/src/utils/searchExtraTools.ts#L610)

本次没有针对该社区版实际验证 resume、fork、子代理隔离、并发搜索、MCP schema 同名更新、完整审批/Hook 等价性。不能由有历史扫描函数就宣称这些场景已通过。

## 6. 对 Coko 的可借鉴点

可以借鉴：名称精确选择、候选目录与执行对象分离、中文 bigram、检索字段权重、无结果时说明 pending MCP server、压缩显式携带必要事实。算法组合和权重是参考实现参数，不是效果保证。

固定 `ExecuteExtraTool` 是与“命中schema加入下一轮tools”不同的第三条工程路径。若考虑它，至少先证明：模型收到目标 schema；目标参数统一校验；分派复用完整权限/Hook/调度/取消/追踪路径；目录公告不等于发现授权；同名定义更新使索引与历史失效。当前 checkout 不足以作为这些保证已完备的最佳实践样板。

本次只确认源码中存在相关测试：搜索合并、中文分词、索引缓存、代理未发现拒绝、目标 deny、参数校验和默认值；均未执行，不能报告测试通过。
