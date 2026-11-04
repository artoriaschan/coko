---
kind: reference
description: "Rukie 当前 ToolSearch 的真实调用链、检索打分、Transcript 加载与模型能力探测。"
lifecycle: active
---

# Rukie 的 ToolSearch 实现

核查日期：2026-11-04。研究状态：未批准为 Coko 设计，未实施。用户所称 Raukie 按本机存在的 Rukie 仓库核查：`/Users/artorias_chan/Workspaces/person/rukie`，HEAD `67d19c333209c91c4cf996d13eb3834a43b0315a`；核查前后 Git status 均为空。没有运行其产品或测试，没有修改该仓库。

## 一句话结论

它是“客户端轻量关键词搜索 → 工具结果返回加载控制 → Harness 提交工具可见性变化 → pi-ai 按模型能力序列化”的完整链路。**检索不是 BM25，也没有向量数据库；它使用名称/描述的手写加权子串匹配。** 已加载集合由当前 Transcript 投影重建，没有另建 Rukie 专用的 discovered Set。

当前实现比旧 Neant 记录多了协议无关搜索与自动能力探测。源代码与 ADR 0026/0027 都明确：即使没有原生追加能力，也可以搜索，随后用普通顶层 `tools` 呈现已加载定义。旧版“缺少原生能力就禁用 ToolSearch”的说法已被部分替代。

## 1. 什么时候延迟工具

入口：`packages/agent/src/tools/tool-search/loadout.ts:10` 的 `planToolSearchLoadout()`。

- 候选：名称以 `mcp__` 开头，但不以 `__authenticate` 结尾。
- 搜索入口必须在当前允许的目录中；候选至少有一个。
- `off` 不延迟新工具；`on` 开启；`auto` 为默认。
- `auto` 的判断：所有候选 `JSON.stringify(toToolDeclaration(tool)).length / 4` 之和，**严格大于** `contextWindow * 0.1`。这只是估算，不是实际 tokenizer。
- 现有工具按 Transcript 原顺序保留；新候选才放入 deferred；同名定义改变则移到追加/替换处理。因此后续启用不会把原本已呈现的工具全部隐藏。

这与“目录里有 N 个工具就开启”不同，也与官方 Claude Code 当前的默认策略不同。

## 2. 怎样搜索

全部算法在 `packages/agent/src/tools/tool-search/tool.ts:13` 的 `createToolSearchTool().execute()`，没有单独 search service。

输入为 `query`，可选 `max_results`（1–20，默认 5）。两个查询分支：

| 查询形式 | 实际实现 |
| --- | --- |
| `select:NAME,NAME` | 逗号分隔、去重、精确名称查 Map；保留请求顺序；不存在的名字返回 Unknown；此分支不受 `max_results` 截断 |
| 普通关键词 | query 小写后按空白切词；对所有候选逐个打分，再排序截断 |

普通关键词逐词评分：

```text
toolName = lowercase(name)
nameWords = toolName.split(/_+/)

for term in queryTerms:
    required = term starts with '+'
    word = required ? term without '+' : term
    if empty word or (required and name does not contain word):
        entire tool score = 0; stop
    if name contains word:
        score += word in nameWords ? 10 : 5
    else if description contains word:
        score += 1

keep score > 0
sort by score descending, then original catalog order
take max_results or 5
```

所以普通词是加分项，不要求每个词都命中；`+calendar` 才要求工具名包含 calendar，描述命中不能满足。`calendar events` 在名称中各为完整下划线词时可得 20 分；仅描述含这两词时为 2 分。

它不检索参数说明，不做词干化、同义词或中文语义召回；这是低依赖且可预测的基线。是否足够取决于实际目录与任务，不应把它描述成通用最优检索。

## 3. 命中结果为什么真的能调用

工具执行返回的主体只是名称与 `(loaded)` / `(already available)` 文本。真正触发加载的是：

```ts
return {
  content: [{ type: "text", text: lines.join("\n") }],
  ...(addTools.length ? { control: { addTools } } : {}),
};
```

`addTools` 是命中但尚未呈现的工具名。可执行实现早已注册于完整的 extension registry，加载只改变当前会话呈现的子集，不是在执行时临时导入一个模块。

调用链与所有权：

```text
createToolLoadout.refresh()
  完整内置/MCP/ToolSearch 工具登记，并安装权限包装
      ↓
planToolSearchLoadout()
  初始呈现常驻工具，MCP 候选延迟
      ↓
模型调用 ToolSearch → execute() 返回 control.addTools
      ↓
pi-durable finishToolRound()
  工具全部结束 → afterTools hooks → 收集成功结果中的 controls
  → 事务中 addTools() 更新 Harness 的活动工具选择
      ↓
下一次 Generation 的准备/Transcript 投影
  形成可恢复的 toolsAdded 工具声明变化
      ↓
pi-ai 根据 compat 与历史序列化
      ↓
模型调用正式 mcp__server__tool → 原实现、权限与 hooks
```

应用侧证据：`packages/agent/src/session/tools.ts:136` 的 `createToolLoadout()`、`publish()` 和 `planToolDeclarationChanges()`。锁定的依赖是 pi-durable/pi-ai **1.0.4**，本次直接阅读其已安装 dist：

- `packages/agent/node_modules/@earendil-works/pi-durable/dist/harness/generation.js:469`：`finishToolRound`，afterTools 后消费 controls，再进入下一轮。
- 同包 `dist/harness/agent.js:58`：`addTools` 对已有工具数组去重追加；它是 Harness 内部状态，不是 Rukie 自建第二份发现事实。
- `packages/agent/node_modules/@earendil-works/pi-ai/dist/utils/transcript.js:198`：`resolveTranscriptTools` 按历史工具增删与能力决定顶层请求用初始工具还是当前工具。

不能把“工具返回一段名称文本”误认为加载机制本身；脱离 Harness 的 control 消费和下一轮投影，照抄此工具函数不会工作。

## 4. 怎样形成真正的 API 请求

### 支持原生增量格式

- Anthropic Messages：pi-ai 把后续定义序列化到会话内的 `tool_addition` / `tool_definition` 块，初始顶层工具尽量稳定。这不是 Anthropic 托管 BM25 搜索。
- OpenAI Responses：在历史加入位置合成配对的 `tool_search_call` / `tool_search_output`；同一 call ID，输出携带选中定义；若配置支持 `additional_tools`，可选该格式。

证据：安装包 `pi-ai/dist/api/openai-responses-shared.js:92` 的 `appendSystemToolAdditions`，`pi-ai/dist/api/anthropic-messages.js:858` 的 `buildParams`。

### 不支持或未知

`resolveTranscriptTools()` 返回 `getCurrentTools(messages)`，下一次请求的普通顶层 `tools` 包含已加载定义。搜索能力继续可用，代价是工具列表改变可能降低前缀缓存命中。删除或同名重新声明等非纯追加变化也会使部分路由改用当前工具列表，不能承诺所有变化都保持初始列表。

同一协议不同网关不能据名称推断支持。当前 Rukie 的 ADR 0026/0027 已处理这个问题；它们是参考项目的已确认决定，不是 Coko 自动继承的需求。

## 5. 自动探测具体做了什么

所有权在 `packages/agent/src/config/tool-capabilities.ts:368` 的 `withToolCapabilityDetection()`，不在搜索函数里。

仅当历史有后续工具追加、API 属于 Responses/Messages、能力未明确配置时探测。构造独立合成会话：先声明初始工具，再追加 `rukie_native_tool_probe`，使用 tool_choice 强制模型调用新工具。**看到新增工具调用才算支持，不执行该工具。**

- 显式 compat 优先；完整开启或明确关闭时不探测；不改用户模型设置。
- 10 秒上限；探测输出不写 Session Transcript，也不混入任务遥测，用量单独存诊断。
- 缓存按 API/provider/baseUrl/model/凭据/请求 headers 的 SHA-256 指纹隔离；成功 24h，不支持 1h，未知 60s，取消不形成有效缓存；进程内并发探测共享。
- 只把 HTTP 400/422 且错误内容明确拒绝原生追加格式的结果判为 unsupported；网络、认证、限流、未调用探测工具等为 unknown。
- 真正任务的原生请求若在输出前明确拒绝格式，可转普通声明重试一次；已经产生内容、取消或其他错误不借此重放。

这是一个完整但额外复杂的兼容层，首次发现可能增加一次付费请求和等待。Coko 是否需要自动探测应单独决定，不能因为 Rukie 有此机制就无条件照搬。

证据：`docs/adr/0026-protocol-independent-tool-search.md`、`docs/adr/0027-native-tool-capability-probing.md`；已读其实现而非仅复述决定。

## 6. 恢复、目录变化、子代理与权限

`createToolLoadout.current()` 每次从 `conversation.context()` 的消息调用 `getCurrentTools()`；压缩后原生 baseline 尚未准备时，回读当前分支完整历史。`publish()` 比较现有与目标声明，把必要的 toolsAdded/toolsRemoved 提交为 `rukie.mcp-loadout`。`hasMcpDrift()` 比较 MCP 工具数、名称与定义，schema 改变也能触发刷新。

`planToolDeclarationChanges()` 保留不变声明的位置，只追加新增；同名变更先移除再加入；如果不能通过“保留 + 追加”实现目标顺序，才完整替换。这是在保护历史一致性与缓存，不是检索优化。

`deferredToolsReminder()` 从本分支已有提醒重建名单，仅追加 Added/Removed；提醒告诉模型有哪些未加载能力，但不把完整 schema 塞进提示词。`packages/agent/src/tools/tool-search/reminder.ts:8`

子代理使用自己的 conversation/history 和 allowed 目录。显式 allowlist 同时限制搜索候选；没有允许 ToolSearch 的受限子代理，直接呈现其允许的 MCP 工具，避免只有延迟名字却没有发现入口。`subagent_fork` 的工具发现独立于父级活动集合；保留的子会话可继续保留其自身发现。

ToolSearch 本身按只读工具处理，仍运行 PreToolUse/PostToolUse Hook。加载成功的 MCP 调用仍受原权限拒绝规则控制；不把搜索当成授权。OAuth authenticate 不延迟。证据主要在上述实现及下面的集成测试源码。

## 7. 测试证据与限制

已阅读测试，**本次未执行**，不能报告这些场景已经在当前机器通过：

| 测试文件 | 已存在的覆盖意图与断言 |
| --- | --- |
| `packages/agent/tests/e2e/tool-search.test.ts:70` | 首次请求没有候选、搜索后声明追加、JSONL 持久化只有一份追加；auto/on/off；关键词、+term、select 和结果上限；执行 deny；晚到工具、删除后重新出现；resume/rewind；Hook；OAuth；取消 |
| `packages/agent/tests/e2e/tool-search-children.test.ts:57` | 子代理/fork 独立发现、保留子会话、allowlist、有 MCP 无搜索入口时 eager、compaction 后加载状态与名单 |
| `packages/agent/tests/config/tool-capabilities.test.ts` | 目标能力探测模块有专属测试；本次未逐条阅读或执行全部用例 |

前两类测试使用 faux model 检查真实 Session 与工具组装，不证明任意真实 provider 接受相同 wire format。源码中的传输分支与真实服务支持应分别验证。

## 适合借鉴与不宜直接移植

最值得借鉴的是：将检索与协议投影解耦；用 Harness 正式工具控制加载；当前分支历史作为恢复依据；完整允许目录与已加载集分开；按声明变化增量同步；子代理与取消的集成验证。

关键词评分可用作低成本基线，但参数说明、中文跨语言和相似名称的召回不足需要评测。固定 10% 与字符除以四是该项目策略；自动能力探测涉及额外请求和缓存生命周期。Coko 当前使用 pi-agent-core 1.4.0，Rukie 使用 pi-durable 1.0.4，二者的工具控制接口不同，不能直接复制 `control.addTools`。
