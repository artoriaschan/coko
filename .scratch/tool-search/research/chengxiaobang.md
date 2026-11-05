---
kind: reference
description: "程小帮当前源码与 1.9.2 解包产物的 ToolSearch 算法、动态工具加载和恢复方式对照。"
lifecycle: active
---

# 程小帮的 Tool Search 实现

核查日期：2026-11-04。研究材料，未批准为 Coko 设计，未实施。只读检查 `/Users/artorias_chan/Workspaces/agent/chengxiaobang`，HEAD 为 `0a9ce4defed95aa633a899d72791de71c407aaa1`，检查前后 Git status 均为空。没有运行程小帮、调用模型、执行测试或重新解包安装包。

## 先区分两份实现

这个仓库同时有当前可编辑工程 `apps/backend/src/` 和发布包的解包还原代码 `decompiled/v1.9.2/backend/modules/src/`。它们的 ToolSearch 不是同一份实现，不能用一方解释另一方。

| 对象 | 检索 | 加载 | 恢复 |
| --- | --- | --- | --- |
| 当前工程 | 手写关键词评分 | 改当前 Run 的 `enabledDeferredToolNames` Set，下轮重选真实 tools | 每次 Run 重新创建空 Set；未发现从历史恢复已加载集 |
| 1.9.2 解包还原 | 本地 BM25，英文词与 CJK bigram | `loadTools` 更新会话发现集，下轮重选真实 tools | `sessions.discovered_tools_json` 单独持久化，启动 Run 时读回 |

两者都不是固定 `ExecuteTool(name, params)` 代理，也不是调用 Anthropic 托管搜索。最终模型直接调用目标真实工具名。

## 一、当前工程：关键词搜索 + Run 内动态加载

### 检索函数

入口为 `apps/backend/src/tools/tool-search-tool.ts:31` 的 `createToolSearchTool(runtime)`。runtime 提供完整工具集合和一个可变 Set。

候选只包括 MCP 工具或共享 metadata 标为 deferred 的工具，排除 ToolSearch 和已经加载的名字。输入 `query` 与可选 `max_results`，默认8、最多20；数值会取整和裁剪。

- `select:ToolA,ToolB`：按精确名字找候选，**受 max_results 截断**。前缀识别不区分大小写，工具名本身按 Map 精确匹配。已加载工具已从候选中排除，所以重复精确选择不再命中。
- 普通查询：转小写，把 `_ : . / -` 转为空格，再按空白切词。检索字段为 name、label、description、metadata.searchHint 与 category。
- 逐词打分：工具名与关键词完全相同 +8；名称包含关键词 +5；其余搜索文本包含 +2；MCP 工具另外 +1。正分降序，同分按名称排序。
- 没有 BM25、embedding 或 `+term` 特殊语法。参数 schema 不参与当前检索。

代码证据：同文件 `deferredCandidates:73`、`selectExactTools:95`、`searchTools:118`、`scoreTool:135`、`normalizeSearchText:159`。

一个静态边界是 MCP 的额外 +1 不依赖任何词命中，所以无关键词匹配的 MCP 工具也可进入结果。它不是严格的“零相关度返回空”；本次没有运行复现或测量影响。

### 怎样让工具真正生效

命中后立即 `enabledDeferredToolNames.add(match.name)`，返回名称/说明文本，结果不携带完整参数 schema。`AgentRunner` 在下一轮 `prepareNextTurn` 重新执行 `selectAgentTools`，将已加载工具的完整 AgentTool 交给 pi，schema 才进入真实模型工具列表。

```text
完整 AgentTool 集合 + 空 enabled Set
  → 初始 selectAgentTools 隐藏 deferred
  → 模型调用 ToolSearch
  → 查询命中，Set.add(name)
  → prepareNextTurn
  → selectAgentTools 将已加载目标放入真实 tools
  → 下一次模型请求可直接调用目标工具
```

证据：`apps/backend/src/agent/agent-runner.ts:808`（每次 Run 的空 Set）、`:1891`（attachToolSearchTool）、`:1731`（prepareNextTurn）；`apps/backend/src/tools/registry.ts:24`（selectAgentTools）、`:106`（isDeferredAgentTool）。

`selectAgentTools` 还应用计划阶段、飞书/headless、OCR 条件与工具并发模式，因此搜索命中不保证该工具在所有通道都出现。例如 OCR 由更早的 enableOcr 分支决定；计划草稿仍过滤写操作。搜索函数本身只筛 deferred 属性，没有复制这些通道条件。

### 权限与恢复

MCP 在共享 metadata 中按 mutating、requiresApproval、非并发安全处理；加载不解除实际调用的审批。工具选择与审批保持分开，业务调用仍进入 pi 的 beforeToolCall 和 RunEventTranslator。

当前 Set 为 Run 局部变量。消息翻译器只持久化 assistant 和 toolResult，历史构建跳过 system 并只接受 user/assistant/toolResult payload；没有发现解析旧 ToolSearch 结果来重建 Set 的路径。因此不能把当前实现称为跨 Run 保留发现状态的方案。

证据：`packages/shared/src/tool.ts:133`（isDeferredToolName）、`:137`（MCP metadata）；`apps/backend/src/tools/registry.ts:14`（requiresApproval）；`apps/backend/src/agent/pi-events.ts:249`（message_end）、`:445`（保存原始 toolResult）；`apps/backend/src/agent/history.ts:28`、`:105`（历史过滤及 parsePayload）。

## 二、1.9.2 解包还原：BM25 + 会话持久化

以下路径均相对于 `decompiled/v1.9.2/backend/modules/src/`。文件头明确写明 reconstructed from bundle，不代表恢复了原始 TypeScript 工程，也不证明此版本真实联网运行结果。

### 候选与目录

`tools/tool-deferral.ts:8` 的 `isDeferrableToolName` 将桌面 computer-use 工具和符合条件的 MCP 纳入：ToolSearch 自身不延迟，`alwaysLoad` 的 MCP 提前呈现，Mod 工具尊重其来源的 isDeferred。

`buildDeferredCatalog:78` 每次根据当前工具重建目录，不长期缓存名字列表。每项包含 name、groupLabel、description、模型可见字符数与搜索 tokens；按 group/name 稳定排序。

搜索文本来自工具名（分隔符替为空格）、description、第一层参数名；computer-use 还附加中英提示词。与 Codex 的递归 schema 文本提取范围不同，本处并未递归读取全部参数描述。

### BM25 算法

`tools/tool-deferral.ts:47` 的 tokenizer：

- 小写英文与数字提取 `/[a-z0-9]+/g`。
- CJK 连续片段转相邻二字 bigram；单字保留。

`bm25Score:130` 是自包含 Okapi BM25，`k1=1.5`、`b=0.75`，使用词频、文档频率与平均文档长度，IDF 为 `log(1 + (N - df + 0.5)/(df + 0.5))`。

`parseToolSearchQuery:110` 支持 `select:` 精确名字和 `+term`。`+term` 被转成必需 tokens，要求候选的完整索引 tokens 都包含这些词，不限于工具名。`searchDeferredCatalog:153` 先应用必需词过滤，再在剩余候选上重新计算 df/avgdl、BM25 排序，取 limit；无正分时还尝试名称子串匹配。

### 返回与加载

`tools/tool-search-tools.ts:16` 的 `createToolSearchTools` 调用 runtime.listTools → buildDeferredCatalog → exact/BM25 → `await runtime.loadTools(matchedNames)`。结果为 JSON：query、总数、matches、loaded、alreadyAvailable/unknownNames 及下一轮直接调用提示。

matches 尽量返回完整 parameters，**结果文本中的 schema 总预算为 8000 字符**；超出则标记 parametersOmitted，但目标仍已加载，其完整 schema 将出现在下一轮 tools。这个预算限制的是结果文本，不能误当作下一轮工具定义的 token 上限。

默认 limit5、最大20，来源是共享 ToolSearchSettings。精确 select 分支直接 resolveSelected，未使用 BM25 的 limit 截断。这与当前工程的8项默认和 select 截断不同。

证据：`tools/tool-search-tools.ts:45`（分支）、`:53`（加载）、`:55`（schema预算）、`:115`（limit）；`decompiled/v1.9.2/shared/src/tool.ts:389`（默认设置）。

### 会话持久化和压缩

`agent/run-tool-deferral.ts:5` 的 `resolveDiscoveredToolSeed` 优先读取 store.getSessionDiscoveredTools；若不存在则扫描历史 MCP 名称形成存量 seed。读取失败按空集合开始。后者是该产物的历史迁移行为，不是 Coko 的建议。

`agent/agent-runner.ts:3116` 创建 toolDeferral：loaded 使用 seed；load 先把新名称加入内存 Set，再将排序后的名字保存到 store。**保存失败只记录 warn，仍返回 added**，所以不能承诺“loaded 文本已返回即一定耐久”。

真实存储是 `repository/sqlite-state-store.ts:1158`/`:1194` 的 `sessions.discovered_tools_json`。它是一份独立会话字段，不是 Rukie 那样从有效 Transcript 工具变更派生。压缩文本无需携带此 Set；下次 Run 直接读字段即可。

`tools/tool-deferral.ts:338` 的 `applyToolDeferral` 按 resident + loadedSorted 选工具；`agent/run-pi-loop.ts:931` 的 prepareNextTurn 在下一轮刷新 MCP 并重选。子代理明确关闭 deferral，使用自身收窄工具集。

另外，`optimisticallyLoadDeferredTools` 会检查模型刚才直接调用的未加载工具名，若是当前目录中的合法候选，就加载并注入提示让模型重试。它不自动重放业务调用。此行为是额外的容错策略，不能从“强制先搜索”这一描述推断出来。

该版本分叉时直接复制源 Session 当前 `discovered_tools_json`，而非从分叉消息位置重放发现事件（`repository/sqlite-state-store.ts:892`/`:940`）。本次没有证明回退会重算发现字段，也没有针对 fork/rewind 运行验证。因此不能套用 Rukie 的分支历史一致性保证。

### 目录提示预算

1.9.2 不仅有搜索，还会给模型一份可发现目录：名称+短说明 → 缩短说明 → 只有名称 → 只有分组摘要，按预算降级。默认 listing=auto、5000 token；运行中按可用上下文2.5%与配置上限取预算，用目录自身的真实 tokenizer 比率换算字符，而不是统一 chars/4。

证据：`tools/tool-deferral.ts:217`（renderDeferredToolsListing）；`agent/run-tool-deferral.ts:137`（renderCatalogListing）；`agent/session-model-context.ts:134`（ToolSearch接线）。目录公告与真正已加载集合分开，运行中还可生成 Added/Removed 的目录增量。

## 对 Coko 有什么意义

程小帮 **1.9.2 的 BM25、CJK bigram、按真实目录重建、名称/说明分组预算，以及搜索结果与正式 schema 分开**，都可以作为 BM25 设计的具体参照。

恢复方式则与用户已指定的 Rukie 路线不同：1.9.2 另存会话 Set，当前工程更只是 Run 内 Set。Coko 若采用已提交历史作为权威，应借鉴检索和目录呈现，不能把它的 discovered_tools_json、写入失败仍成功及分叉复制当前 Set 一起移植。

## 验证范围

已阅读当前工程 `apps/backend/test/tools.test.ts:147`（select/keyword命中并改变Set）、`apps/backend/test/tool-catalog.test.ts:131`（Set控制模型工具可见）、`:146`（并发模式），以及审批相关断言。未找到并阅读到足以证明当前实现跨 Run/压缩恢复加载状态的测试。

所有测试均未执行，1.9.2解包产物也未运行。本文的算法、调用次序、存储和静态边界结论来自上述代码；不包含真实性能、准确率或真实 provider 兼容性的通过证明。参考仓库保持未修改。
