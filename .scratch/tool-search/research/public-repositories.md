---
kind: reference
description: "四个公开仓库的 tool search 源码对照：Codex、LangGraph BigTool、FastMCP 与 Docker Agent。"
lifecycle: active
---

# 公开仓库如何实现 tool search

核查日期：2026-11-04。研究材料，未批准为 Coko 规格，未实施。本文通过 GitHub API 固定 commit 后读取 raw 源码与测试；没有安装、执行这些仓库代码，没有实测其检索质量。选取的是四种有代表性的公开实现，不声称存在脱离场景的“最佳仓库”。本次入口见 [研究入口](../README.md)。

## 先区分主要实现模式

| 实现 | 搜索什么 | 命中后怎样可调用 | 本质 |
| --- | --- | --- | --- |
| OpenAI Codex | deferred registry 的名称、描述、namespace、schema 文本 | 返回原生 `tool_search_output` 的 loadable specs | provider 原生工具发现与加载 |
| LangGraph BigTool | Store 中的工具 metadata；默认可用 embedding 语义检索 | ID 写入 graph state，下一轮 `llm.bind_tools` | 应用管理动态模型工具集 |
| FastMCP SearchTransform | 经授权过滤的 MCP 工具目录 | 搜索返回定义，随后固定 `call_tool(name, arguments)` 代理执行 | MCP server 端发现与调用网关 |
| Docker Agent | 普通模式 fuzzy 搜索名称/描述，原生模式由 provider 搜索 | 普通模式显式 `add_tool`；原生模式 deferred declarations | 同时支持两种加载路径 |

这些差异直接决定缓存、工具卡身份、Hook matcher、审批和会话恢复如何实现。搜索结果中出现 schema，不代表已将该 schema 注册成模型的新 function。

## 1. OpenAI Codex：本地 BM25 + 原生加载事件

核查版本：`48524f337a84b570f0c2453ca43ec9a1a29375c0`。来源：[仓库](https://github.com/openai/codex/tree/48524f337a84b570f0c2453ca43ec9a1a29375c0)。

### 目录与索引

`ToolSearchHandlerCache.get_or_build()` 只收集 registry 中 exposure 为 deferred 的来源；不可变 runtime 用弱引用身份比较，动态 search info 按值比较。来源或 source-listing 设置变化时重建 handler，避免仅按工具数量判断缓存是否过期。

`ToolSearchHandler::new()` 使用 `bm25::EmbedderBuilder::with_fit_to_corpus(Language::English, &corpus)`，将搜索文本加入 `Scorer`。这里的 Embedder 是 BM25 库的表示，不是调用远程神经 embedding 服务。[handler 源码](https://github.com/openai/codex/blob/48524f337a84b570f0c2453ca43ec9a1a29375c0/codex-rs/core/src/tools/handlers/tool_search.rs#L67)

`default_tool_search_text()` 拼接 namespace 名称/说明、工具名称/说明与 schema 内容；函数名另外将下划线替为空格。schema 提取递归经过 properties、items、anyOf，加入属性名与描述。`ToolSearchEntry` 共享 `Arc<ToolSpec>`，选中后才 `to_loadable_spec()`，不必每次检索复制整个 schema 库。[搜索条目与字段提取](https://github.com/openai/codex/blob/48524f337a84b570f0c2453ca43ec9a1a29375c0/codex-rs/tools/src/tool_search.rs#L13)

### 搜索与加载

模型接口接收 `query` 和可选 `limit`，工具描述显式告诉模型它使用 BM25、命中将在下一次模型调用暴露，并要求 MCP 工具发现使用此入口而非 resources 列表。[搜索工具定义](https://github.com/openai/codex/blob/48524f337a84b570f0c2453ca43ec9a1a29375c0/codex-rs/core/src/tools/handlers/tool_search_spec.rs#L16)

`handle_call()` 拒绝空 query 和零 limit。普通路径 BM25 排序 → top-k 条目 → `to_loadable_spec()` → 合并 namespace → `ToolSearchOutput { tools }`。定义规范化将函数的 `defer_loading` 设为 true；不是把一段 schema 文本当普通 toolResult 回给模型。[执行路径](https://github.com/openai/codex/blob/48524f337a84b570f0c2453ca43ec9a1a29375c0/codex-rs/core/src/tools/handlers/tool_search.rs#L209)、[规范化](https://github.com/openai/codex/blob/48524f337a84b570f0c2453ca43ec9a1a29375c0/codex-rs/tools/src/tool_search.rs#L98)

Code Mode 是另一条路径：返回名称/描述供代码调用，而不是原生 schema 加载结果；其检索在限制结果数之前应用当前 step 的 nested-tool policy。不能假设 code mode 结果形状和普通搜索相同。[Code Mode 检索](https://github.com/openai/codex/blob/48524f337a84b570f0c2453ca43ec9a1a29375c0/codex-rs/core/src/tools/handlers/tool_search.rs#L283)

### 测试与局限

`core/tests/suite/search_tool.rs` 包含 mock Responses 多轮链路：搜索后直接调用 deferred 工具、不重复做 follow-up tools injection；动态函数/custom tool 发现后的路由；仅索引 enabled MCP 工具；app-only 工具不可直接运行；名称、描述、schema 的检索。它是重要行为证据，但本次只读测试，未执行，也不证明某个外部登录路由当前接受同样请求。[端到端测试](https://github.com/openai/codex/blob/48524f337a84b570f0c2453ca43ec9a1a29375c0/codex-rs/core/tests/suite/search_tool.rs#L562)

**可借鉴：**索引文本与 schema 分离、目录版本驱动缓存失效、保留 namespace 身份、原生搜索事件可回放。**需另验：**中文到英文工具的召回，及 Coko 锁定适配器是否能无损保存相关事件；本节未建立完整重启/压缩实现证明。

## 2. LangGraph BigTool：检索 ID → graph state → bind_tools

核查版本：`6c587992db83b13924ec78f0f2fdbdefe974c642`。来源：[仓库](https://github.com/langchain-ai/langgraph-bigtool/tree/6c587992db83b13924ec78f0f2fdbdefe974c642)。

### 调用链

应用先提供 `tool_registry: dict[id, tool]`。默认 `retrieve_tools()` 调用 `store.search(namespace_prefix, query, limit, filter)`，只返回搜索项的 key；同步与异步版本相同。检索器也能完全替换成按类别选择等任意逻辑。默认 limit 为 2，不是库内实现了一套固定 embedding 排名器。[retrieval 源码](https://github.com/langchain-ai/langgraph-bigtool/blob/6c587992db83b13924ec78f0f2fdbdefe974c642/langgraph_bigtool/tools.py#L14)

`State.selected_tool_ids` 使用 `_add_new` reducer 累积去重。`select_tools()` 执行 retrieval，生成提示哪些名称已可用的 ToolMessage，同时写 selected IDs。下一次 `call_model()` 从 registry 取定义，并执行 `llm.bind_tools([retrieve_tools, *selected_tools])`。搜索入口因此始终存在，已发现工具逐步累积。[graph state 与模型绑定](https://github.com/langchain-ai/langgraph-bigtool/blob/6c587992db83b13924ec78f0f2fdbdefe974c642/langgraph_bigtool/graph.py#L16)

README 示例把名称和描述写入 InMemoryStore 的 description 字段，显式提供 embedding 实例；这说明向量检索的依赖和持久化 Store 由应用选择，并非工具发现必然需要向量数据库。[示例配置](https://github.com/langchain-ai/langgraph-bigtool/blob/6c587992db83b13924ec78f0f2fdbdefe974c642/README.md#quickstart)

### 执行与状态边界

业务执行节点 `ToolNode` 预先持有全量 `tool_registry.values()`；`should_continue()` 只把 retrieval 调用送去 select_tools，其余送 ToolNode。selected IDs 管的是模型呈现，没有在这里成为执行授权白名单；检索器返回未知 ID 也会直接索引 registry。因此应用仍要校验检索结果并在执行处应用权限。[路由与执行](https://github.com/langchain-ai/langgraph-bigtool/blob/6c587992db83b13924ec78f0f2fdbdefe974c642/langgraph_bigtool/graph.py#L85)

selected IDs 是 graph state，可以由 LangGraph 的 checkpoint 机制持久化，但 `create_agent()` 本身只返回 builder，没有自动替宿主配置持久 checkpoint、目录撤销或 schema 修订处理。state 累积也没有内置“卸载”或加载 token 上限，不能把它描述成完整生产权限/恢复方案。[builder 源码](https://github.com/langchain-ai/langgraph-bigtool/blob/6c587992db83b13924ec78f0f2fdbdefe974c642/langgraph_bigtool/graph.py#L157)

测试覆盖同步/异步、custom retrieval、重复发现后 bind_tools 无重复名称，以及函数型 registry；使用 fake model 和 deterministic fake embedding。[测试](https://github.com/langchain-ai/langgraph-bigtool/blob/6c587992db83b13924ec78f0f2fdbdefe974c642/tests/unit_tests/test_end_to_end.py#L340)

**可借鉴：**最容易复现的应用级最小闭环；用稳定工具 ID 保存加载集，每轮实际绑定 schema。**不能直接照搬：**把全 registry 的执行入口暴露给模型后，仅依赖 selected IDs 作为安全边界。

## 3. FastMCP：固定 search_tools + call_tool 网关

核查版本：`f5607e812a85c1409443bd2d0a6870d357832dca`。来源：[仓库](https://github.com/PrefectHQ/fastmcp/tree/f5607e812a85c1409443bd2d0a6870d357832dca)。

### 目录呈现和调用

`BaseSearchTransform.transform_tools()` 将 MCP `list_tools` 结果改为 pinned tools 加合成的 `search_tools`、`call_tool`。`get_tool()` 对普通名称仍向下游委派；隐藏定义不等于撤销工具。默认搜索结果序列化为完整 MCP tool 定义，也可定制紧凑输出。[transform 与代理](https://github.com/PrefectHQ/fastmcp/blob/f5607e812a85c1409443bd2d0a6870d357832dca/fastmcp_slim/fastmcp/server/transforms/search/base.py#L336)

模型搜索后调用固定代理 `call_tool(name, arguments)`。代理拒绝递归调用搜索/代理自身，重新检查名称是否在当前 `get_tool_catalog(ctx)` 中，才经 `ctx.fastmcp.call_tool` 调用真实工具。它**没有把每个命中工具注册成模型新 function**，所以能保持模型初始 tools 稳定，但业务名称、参数与失败要透过代理表达。[代理实现](https://github.com/PrefectHQ/fastmcp/blob/f5607e812a85c1409443bd2d0a6870d357832dca/fastmcp_slim/fastmcp/server/transforms/search/base.py#L360)

`CatalogTransform.get_tool_catalog()` 用实例级 ContextVar 只绕过自己的目录替换，仍调用带 middleware 的真实 `list_tools`，再按名称取最新版本并过滤 model visibility。过滤在版本去重之后，防止旧版可见却实际调用新版 app-only 定义。[catalog 实现](https://github.com/PrefectHQ/fastmcp/blob/f5607e812a85c1409443bd2d0a6870d357832dca/fastmcp_slim/fastmcp/server/transforms/catalog.py#L172)

### 检索算法

BM25 版本是自包含 Okapi 索引，默认 k1=1.5、b=0.75。分词做 Unicode NFKC、casefold，再提取至少两个字符的字母数字 token。文档来自工具名、说明、第一层参数名称/说明；查询只返回正分前 k 项，默认 k=5。按排序后的可搜索文本 SHA256 检测索引过期；命中用名称解析当前工具对象，因此不是一直返回缓存中的旧 schema。[BM25 源码](https://github.com/PrefectHQ/fastmcp/blob/f5607e812a85c1409443bd2d0a6870d357832dca/fastmcp_slim/fastmcp/server/transforms/search/bm25.py#L20)、[文本提取](https://github.com/PrefectHQ/fastmcp/blob/f5607e812a85c1409443bd2d0a6870d357832dca/fastmcp_slim/fastmcp/server/transforms/search/base.py#L43)

regex 版本使用 Pydantic 的 Rust regex 引擎，不支持回溯引用/lookaround；限制 query 长度 1000，约 1 秒搜索预算，非法模式返回空集。它不是无限制把用户正则传给 Python `re`。[regex 源码](https://github.com/PrefectHQ/fastmcp/blob/f5607e812a85c1409443bd2d0a6870d357832dca/fastmcp_slim/fastmcp/server/transforms/search/regex.py#L19)

测试文件包含 basic behavior、regex/BM25、目录变更后的重建、顺序改变后的缓存结果、当前 schema、代理自递归拒绝和 description 变化导致 hash 改变。此次只读，不报告测试通过。[测试](https://github.com/PrefectHQ/fastmcp/blob/f5607e812a85c1409443bd2d0a6870d357832dca/tests/server/transforms/test_search.py#L72)

**可借鉴：**搜索与执行都使用同一套经过过滤的目录；执行前复查，避免网关扩大能力。**产品代价：**若 Coko 采用此模式，原有按真实工具名匹配的权限、Hook、工具卡、追踪与恢复必须识别内部目标，不能仅看到 `call_tool` 就全部放行。本模式自身没有需要跨轮保存的 loaded 集。

## 4. Docker Agent：显式搜索/激活 + provider 原生加载

核查版本：`fba158173bb1f0c11bc688aa83e1ea20be11311e`。来源：[仓库](https://github.com/docker/docker-agent/tree/fba158173bb1f0c11bc688aa83e1ea20be11311e)。

### 普通模式

deferred ToolSet 从其它 toolset 接入来源；首次 search/add 时懒加载 snapshot，来源尚未 ready 则跳过并下次重试。列表获取不持有主锁；并发列出时首次成功 snapshot 获胜。重复工具名由首个来源取胜。[来源快照](https://github.com/docker/docker-agent/blob/fba158173bb1f0c11bc688aa83e1ea20be11311e/pkg/tools/builtin/deferred/deferred.go#L111)

`search_tool` 在尚未激活工具的名称+描述上做 `fuzzy.Score`，按分数排序，返回名称/描述；空 query 返回全部。`fuzzy.Score` 是 fzf 的 FuzzyMatchV2，不是 BM25 或 embedding。该函数当前没有 top-k 截断，因此大目录输出需另外评估。[搜索实现](https://github.com/docker/docker-agent/blob/fba158173bb1f0c11bc688aa83e1ea20be11311e/pkg/tools/builtin/deferred/deferred.go#L177)、[fuzzy 算法入口](https://github.com/docker/docker-agent/blob/fba158173bb1f0c11bc688aa83e1ea20be11311e/pkg/fuzzy/fuzzy.go#L1)

`add_tool(name)` 在锁内查找并写 `activatedTools`，同名并发只发生一次激活；下一次 `Tools()` 返回 search/add 两个入口加已激活的真实工具。因此模型显式经历“查找 → 激活 → 调用”，比搜索即加载多一个工具动作。[激活与工具集](https://github.com/docker/docker-agent/blob/fba158173bb1f0c11bc688aa83e1ea20be11311e/pkg/tools/builtin/deferred/deferred.go#L250)

### 原生模式与历史

OpenAI `hostedToolSearchTools()` 在能力开关允许时，将 catalog 定义设为 `defer_loading: true` 并按名称稳定排序，增加 server-executed `tool_search`；普通工具上的 client load marks 则清除。关闭原生模式时只保留普通 search/add 加激活后的工具。两套机制共享目录，但不会同时生成同一份 client 加载状态。[provider 实现](https://github.com/docker/docker-agent/blob/fba158173bb1f0c11bc688aa83e1ea20be11311e/pkg/model/provider/openai/tool_search.go#L27)

`DeferralTracker.MarkAt()` 按 Session 保存首次请求的工具集合，并给后续新增定义记录 `DeferredAtToolCallID`；`Reset()` 明确用于压缩掉加载位置的历史之后重建基线。注意它与 ToolSet 实例内 `activatedTools` 不是同一状态；本次未完整追踪 toolset 生命周期，不能据此承诺后者已具备跨 Session 隔离或重启恢复。[tracker](https://github.com/docker/docker-agent/blob/fba158173bb1f0c11bc688aa83e1ea20be11311e/pkg/tools/deferrals.go#L10)

### 行为证据

单元测试含来源延迟就绪、重复名、并发激活、部分延迟与 catalog。runtime 测试使用真实 OpenAI client/agent/runtime 加假 Responses 服务，断言原生搜索可直接 dispatch 未手动激活工具、排除的工具不进入请求、后续请求原样回放 hosted 输出且定义不变；另一测试断言 catalog 工具执行前仍需审批，拒绝时 handler 不运行。[deferred 测试](https://github.com/docker/docker-agent/blob/fba158173bb1f0c11bc688aa83e1ea20be11311e/pkg/tools/builtin/deferred/deferred_test.go#L34)、[runtime 测试](https://github.com/docker/docker-agent/blob/fba158173bb1f0c11bc688aa83e1ea20be11311e/pkg/runtime/openai_tool_search_integration_test.go#L28)

**可借鉴：**异步来源懒快照、激活原子性、稳定声明、原生发现仍经审批、压缩后加载点重建。**需另验：**成功 snapshot 后的动态 catalog 更新、激活集生命周期，以及普通 fuzzy 搜索的 token 上限。

## 对 Coko 的取舍建议

这是基于上述源码的工程判断，未形成已批准设计。

1. 若保持真实工具名、既有权限/Hook/工具卡链路，优先研究 Codex 的原生加载投影与 BigTool 的普通动态绑定；FastMCP 网关不是低成本替换。
2. 将 registry、搜索索引与模型呈现分开：检索只返回可信目录内的稳定 ID；加载时解析当前定义；业务执行仍走原工具链。
3. 先做词法检索基线，再以真实任务测 Recall@k 与完成率决定 embedding。Codex/FastMCP 的 BM25、Docker 的 fuzzy 与 BigTool 的 Store 检索代表不同算法，不应混称“语义搜索”。
4. 学习 Docker/Codex 的行为测试：实际检查下一轮请求和 handler 调用，并覆盖排除、审批、并发、目录变化与历史重建；仅看搜索返回名称不足以验证实现。
5. 首版应决定搜索即加载还是独立 inspect/add：前者减少往返，后者控制大 schema 注入。不要在缺少数据时把多阶段检索复杂度全部引入。

本次没有执行任何仓库测试、调用真实模型或测量性能。四个 commit 的原始文件暂存在 `/tmp/coko-tool-search-public` 供本轮核对；长期证据是文中固定 commit 的永久源码链接，报告不依赖临时目录存在。
