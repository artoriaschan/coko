---
kind: reference
description: "基于真实仓库的 tool search 综合对照：搜索算法、加载路径、历史状态与 Coko 可借鉴点。"
lifecycle: active
---

# 从仓库看 tool search 的实现

核查日期：2026-11-04。响应追加要求：调研网络上有代表性的实现、Claude Code 与本地 Rukie。本文为研究结论与建议，未批准为设计或规格，未实施。完整函数、版本与测试证据在[公开仓库](public-repositories.md)、[Claude Code](claude-code.md)、[Rukie](rukie.md)三份专项正文中。

## 结论：检索算法和工具生效机制应分别比较

已经核查四个公开仓库的固定 commit 源码，以及 Claude Code 官方公开契约、本地社区版与本地 Rukie。没有只用 README 或二手“最佳实践”文章推导内部实现。下列方案有不同用途；没有实测数据支持把其中之一称为所有场景的最优解。

| 对象 | 真实检索机制 | 命中后怎样调用 | 最值得借鉴 |
| --- | --- | --- | --- |
| OpenAI Codex | 本地 BM25；名称、描述、namespace 与 schema 文本 | 原生 `tool_search_output` 加载定义，再正常调用 | 索引与 schema 分离、命中后才物化定义、目录来源变化使缓存失效 |
| LangGraph BigTool | 可替换 Store search；示例为 embedding | 保存工具 ID，下轮 `bind_tools` 加入定义 | 应用层最小闭环清晰，容易实验不同检索器 |
| FastMCP | 自包含 BM25 或受约束 regex | 固定 `search_tools` 返回定义，再 `call_tool` 代理执行 | 搜索与执行共用当前授权/可见目录，执行前重新核查 |
| Docker Agent | 普通模式使用 fzf fuzzy；另有 hosted 原生模式 | 普通模式先 `search_tool` 再 `add_tool`，下轮暴露真实工具 | 显式激活、并发去重、加载位置与压缩重建 |
| 官方 Claude Code | 官方公开契约不能确定内部排名算法 | `defer_loading` / `tool_reference` 按需加载 | 默认策略、alwaysLoad、网关限制与文档契约 |
| 本地 Claude 社区版 | keyword 0.4 + TF-IDF cosine 0.6，中文 bigram | 固定 `SearchExtraTools` + `ExecuteExtraTool` | 混合词法字段与中文处理可研究；执行闭环存在未验证边界 |
| 本地 Rukie | 手写名称/描述加权，不是 BM25 | `control.addTools` → Harness → Transcript → provider 投影 | 搜索与协议分离、可恢复加载事实、子代理与工具目录同步 |

公开仓库版本：Codex `48524f337a84b570f0c2453ca43ec9a1a29375c0`；BigTool `6c587992db83b13924ec78f0f2fdbdefe974c642`；FastMCP `f5607e812a85c1409443bd2d0a6870d357832dca`；Docker Agent `fba158173bb1f0c11bc688aa83e1ea20be11311e`。永久源码链接见[逐仓库正文](public-repositories.md)。

## 三种工具生效路径

### A. 搜索后加载真实工具定义

Codex、BigTool 与 Rukie 都存在此类路径，但 API 方式不同：

```text
可信 registry → 本地/Store 检索 → 工具身份
    → 保存发现/加载事实
    → 原生加载事件 或 下轮 tools/bind_tools
    → 模型正常调用真实工具名
```

优点是正常调用仍有原始工具身份与参数 schema，容易复用工具卡、权限、Hook 和审计。成本是必须处理加载事实、工具列表变化、协议投影与恢复。Rukie 的具体贡献是使用 Harness 正式 control，避免在搜索函数里另写模型循环；BigTool 则展示了只有 graph state 和每轮 bind_tools 也能成立的最小实现。

### B. 搜索与激活分成两步

Docker Agent 普通模式先返回候选名称/说明，模型再调用 `add_tool(name)` 激活；随后正常调用目标。这能控制哪些定义实际进入上下文，但增加一次工具动作。其普通搜索没有 top-k，不能在大目录上无条件照搬输出策略。[Docker deferred 源码](https://github.com/docker/docker-agent/blob/fba158173bb1f0c11bc688aa83e1ea20be11311e/pkg/tools/builtin/deferred/deferred.go#L177)

### C. 保持固定代理工具

FastMCP 与本地 Claude 社区版采用：

```text
search_tools(query) → 返回目标定义/说明
call_tool(name, arguments) → 校验后由网关分派
```

这种方式不需要往模型的 tools 加每个命中定义；schema 仍必须通过搜索或 inspect 到达模型，便于生成正确参数。它需要保证代理内部的真实目标参与权限、Hook、追踪和恢复。FastMCP 通过当前目录重新验证目标再调用；本地社区版虽然也有门禁和目标权限检查，完整执行链等价性与 schema 传达仍未建立证明。[FastMCP 代理](https://github.com/PrefectHQ/fastmcp/blob/f5607e812a85c1409443bd2d0a6870d357832dca/fastmcp_slim/fastmcp/server/transforms/search/base.py#L360)、[社区版 Execute](https://github.com/claude-code-best/claude-code/blob/77a7934e15d69da13879112ed7db695c9ee7a52a/packages/builtin-tools/src/tools/ExecuteTool/ExecuteTool.ts#L66)

## Rukie 的完整闭环最接近什么

当前本地 Rukie HEAD 为 `67d19c333209c91c4cf996d13eb3834a43b0315a`。它将两种问题拆开处理：

1. `ToolSearch.execute` 只搜索当前允许的 MCP 目录。`select:A,B` 精确选择；普通词名称完整片段 +10、名称子串 +5、描述 +1；`+word` 要求名称命中。默认最多5项，上限20，精确选择不按结果数截断。
2. 返回文本解释结果，并返回 `control.addTools` 名称列表。完整工具实现已经登记，不需要新建或加载模块。
3. pi-durable 等本批工具结束、执行 afterTools 后，在事务内消费 control。后续准备产生可重建的工具声明变化。
4. Rukie 从当前分支 Transcript 重建已呈现定义；重启、压缩、rewind 与子代理分别使用自己的历史投影。
5. pi-ai 决定实际请求：支持原生追加则用相应会话内定义事件；其他情况用下一轮普通 `tools`。新增能力探测是独立的 provider 包装层，不是检索算法的一部分。

这说明**普通工具调用模型也可以实现 tool search**；原生支持主要改变加载格式及缓存行为，而不是决定能不能检索和按需呈现。当前 Rukie 的能力探测、成本与 TTL 细节见[专门分析](rukie.md)。此结论不能用来绕过目标 API 明确禁止的原生事件；普通列表更新是另一条实现路径。

## Claude Code 的证据边界

用户本地 `/Users/artorias_chan/Workspaces/agent/claude-code` 是 `claude-code-best/claude-code` 社区还原和扩展仓库，版本 `2.8.4`，HEAD `77a7934e15d69da13879112ed7db695c9ee7a52a`。它已改成固定代理，不能称为官方 Claude Code 的真实内部算法。

官方当前文档说明默认按需加载 MCP；`ENABLE_TOOL_SEARCH=auto` 才是10%阈值模式，支持 `auto:N` 和 `alwaysLoad`。官方公开仓库没有提供本次所追踪的核心 ToolSearch 模块，因此只能确认这些公开行为；没有一手源码证据证明官方使用本地社区版的 TF-IDF 或 Codex 的 BM25。[官方 MCP 文档](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search)

社区版可以借鉴名称直达、searchHint 字段和中文 bigram，但不宜当作完整最佳实践样板。本次静态观察到 `discover:` 构造的 schema 文本未进入返回值、索引 cache key 只用名称集合、`+term` 只约束一条检索支路。这些需要运行复现，不能宣称已经确认产品故障；详细调用点和限制见[Claude Code 研究](claude-code.md)。

## 对 Coko 的建议如何修正

这部分是基于仓库的工程判断，不是用户已批准的实现计划。

- **加载机制优先借鉴 Rukie，普通绑定用 BigTool 作最小参照。** 保持真实工具名和既有执行链，利用 Coko 已有动态工具刷新接口；当前 Coko 是 pi-agent-core 1.4.0，Rukie 是 pi-durable 1.0.4，不能直接复制 `control.addTools`。
- **检索实现优先比较 Rukie 的加权关键词基线和 Codex/FastMCP 的 BM25。** 前者简单可预测，后者将参数/描述字段纳入更完整排名；是否加入 embedding 由中文跨语言和相似工具的评测决定。不能由框架使用 Store 就宣称语义检索必然更好。
- **固定代理作为单独架构选择。** FastMCP 展示了这种方式的合理实现，但它改变模型调用形状与内部目标识别，不能作为无需改权限/Hook 的低成本替换。
- **恢复与目录变更和检索同等重要。** 需要索引 revision、声明变化、压缩后基线、撤销、子会话隔离，以及执行前再次校验当前目标。
- **先验证请求与执行事实。** 首次不呈现目标 schema、搜索后真正调用成功、权限拒绝不运行 handler、重启/压缩后保持所定语义；再测检索 Recall@k、任务完成率、总 token 和延迟。不能只断言模型看到了名称。

## 检查与限制

本次阅读了真实代码和现有测试，没有执行这些参考仓库的代码/测试，没有调用真实模型，也没有测量效果或复现社区版静态风险。未改变 Coko 产品代码、规格或 ADR；文档检查与保存状态归[研究入口](../README.md)。临时下载的公开源码只用于核对，不是报告依赖或可执行产物。
