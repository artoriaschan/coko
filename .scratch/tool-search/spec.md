---
kind: spec
description: "Tool Search 规格：MCP 工具默认作为按需工具，模型经工具搜索加载后按真实名称调用；加载状态随 Session 条目在重启、压缩、回退与分叉中保持；全局开关、按 Server 的始终加载、按 Provider 的保留提示词缓存开关，以及上下文用量口径。"
status: approved
lifecycle: active
---

# Tool Search 规格

Status: ready-for-agent

## 来源、确认与实施状态

本规格按 `to-spec` 汇总 2026-11-04 至 2026-11-05 本会话的需求。用户先指定检索采用 BM25、加载与恢复参考 Rukie；随后决定复刻程小帮 v1.10.1 的 ToolSearch、复用协议原生增量路径、自研搜索算法，并经 `grill-me` 逐项确认 Q1—Q27，最后确认了全部结论的汇总。

用户改动或补充推荐的地方：复刻方向取代了 Q1“首版只用普通 tools 列表”的推荐；Q14 给出 Provider 开关的标题与文案；Q17 把开关从模型目录移到 Provider 表单、默认开启；Q21 让 openai-completions 也显示开关、默认关闭；Q26 让 openai-completions 下未标注支持的模型照常追加顶层 tools、不报错；Q27 改为按 pi 自带目录的标识判断、不追加说明。其余采用推荐。Q20 是 `to-spec` 第 2 步要求核对的测试接缝。设计把加载记录改为单独的条目，这一工程选择在调用 `/to-spec` 前已告知用户。产品需求因此为 `approved`。2026-11-05 拆为 15 张实施票，随后按用户显式调用 `implement-spec` 实现；本地联合验收与边界见下文。

实现方式见 [Tool Search 设计](design.md)，复刻基准见 [程小帮研究](research/chengxiaobang.md)。在本文范围内，本次确认优先于 [MCP](../../docs/subsystems/mcp.md) 与 [上下文管理](../../docs/subsystems/context.md) 中“已连接 Server 的全部工具直接提供给模型”“用量计入全部 MCP 工具”的当前行为说明。既有约束见 [术语表](../../GLOSSARY.md)、[ADR 0024](../../docs/adr/0024-session-state-as-state-updates.md)、[ADR 0008](../../docs/adr/0008-project-files-only-tighten.md)、[ADR 0023](../../docs/adr/0023-assistant-reply-forks.md)、[ADR 0014](../../docs/adr/0014-subagents-as-child-sessions.md)、[ADR 0010](../../docs/adr/0010-provider-one-shot-save.md)、[界面约定](../../docs/tech-stack/ui.md)、[测试约定](../../docs/tech-stack/testing.md) 与 [tracker 协议](../../docs/agents/issue-tracker.md)。任务材料不加入正式文档导航。

## 当前实施状态

2026-11-05：01—15 号票的本地实现与联合验收已完成，见[联合证据](evidence/acceptance.md)。全局按需开关最终默认开启，三个协议依本规格选择写法。真实 Provider 的 AC-02/18 与缓存效果未验证；AC-16 的加载提交失败使用真实 Sidecar 与 SQLite 触发器；乐观中断精确切点在公开 Runtime 重建接缝验证，正常持久化与调用使用真实 Sidecar。规格继续保留 approved 基线，最终两轴审查由集成流程完成后再记录交付；设计稿仍 draft，未推送或发布。

## Problem Statement

连接了多个 MCP Server 的用户，每个 Run 的每次请求都会把这些 Server 的全部工具定义发给模型。任务只用其中少数几个工具时，其余定义仍占用上下文窗口；工具越多，模型越难选对；上下文环和自动压缩也把这些定义全部算进去。

程小帮 v1.10.1 用按需加载解决这个问题：模型先看到一份轻量的工具目录，需要时再搜索并加载定义。Coko 没有这项能力。而且如果加载时直接改写整份工具列表，提示词缓存会从工具定义处失效，长对话里每加载一个工具，就要按未缓存价格重新计算整段对话。

## Solution

MCP 工具默认成为按需工具（On-demand Tool）。每个 Run 开始时，模型收到一份列出 Server 与工具名的目录；需要某个工具时，用工具搜索（Tool Search）找到并加载它，从下一次请求起按真实名称直接调用。加载过的工具在重启、继续、重试和压缩之后仍然可用，回退、分叉和交接按对话的边界处理。把定义加入请求时，优先使用协议原生的增量写法，加载工具不让提示词缓存失效。用户可以在设置里关闭按需加载，把常用的 Server 设为始终加载，或按 Provider 关闭“加载新工具时保留提示词缓存”。行为复刻程小帮 v1.10.1，检索在本地用自己实现的 BM25。

### 范围与开关

- **TS-01** 只有 MCP 工具是按需工具，含插件提供的 MCP Server；内置工具与 Host Tool 始终直接提供。
- **TS-02** 设置 → MCP 顶部「工具搜索」分组中的「按需加载 MCP 工具」默认打开。关闭后所有 MCP 工具直接提供，不注册 `tool_search`，不发目录。Project Settings 只能把它设为 false，设为 true 时被忽略并给出诊断。
- **TS-03** 不设阈值：开关打开、且本次 Run 的目录里至少有一个按需工具时生效；目录为空时不注册 `tool_search`，不发目录。
- **TS-04** MCP Server 的「始终加载」（`alwaysLoad`）可用于全局、项目与插件 Server，这些 Server 的工具始终直接提供，不进入目录。改动它不需要重新批准项目 Server。

### 工具搜索

- **TS-05** `tool_search` 的参数为 `query` 与 `limit`（默认 5，最多 20）。一次调用同时完成搜索与加载，命中的工具从下一次模型请求起可按真实名称调用。
- **TS-06** 查询可以是自然语言关键词；`select:名称[,名称]` 按确切名称选择，不受 limit 限制；`+词` 要求该词必须出现。
- **TS-07** 结果列出每个命中工具的名称、Server、说明与参数 schema；schema 累计超过 8000 字符后，其余只注明已加载。按确切名称选中常驻工具、名称未知、零命中时各有说明；零命中时列出可用 Server，并提示用“Server 名 + 具体动作”重搜。工具描述与提示文字照搬程小帮 v1.10.1，只替换名称，并去掉 Coko 没有的“内置桌面工具”。
- **TS-08** 检索在本地进行，覆盖工具名、说明与第一层参数名；中日韩文字按二字切分；没有正分时按工具名子串兜底。不翻译，不用 embedding。
- **TS-09** `tool_search` 只读，Plan Mode 下可用，可以被 deny 规则与 PreToolUse Hook 拦截。它只能搜到本 Run 可用的工具，范围外的名称报未知。加载不授予执行权限：业务调用照常经过 Permission Rule、Approval Request 与 Hook。
- **TS-10** `tool_search` 的调用卡沿用通用工具卡，不做专门的页面。

### 目录

- **TS-11** 目录按 Server 分组，每个工具一行“名称: 首句说明”，说明超过 60 字截断。超出预算时依次降级：缩短说明（最短 24 字）、只列名称、只列 Server 与工具数。预算取 5000 token 与上下文窗口 2.5% 中的较小值。目录不含 schema。
- **TS-12** 目录以 State Update 在 Run 开始时送达：第一次送完整目录，之后只送 Added/Removed；压缩或回退之后重发完整目录；没有变化不送。
- **TS-13** 目录与 `tool_search` 使用同一份 Run 开始时的快照；Run 中途才连上的 Server，它的工具到下一个 Run 才出现。

### 已加载的工具

- **TS-14** 已加载的工具在重启、continue、retry 与各种压缩之后保留，不自动卸载。
- **TS-15** 回退撤销回退区间内的加载；Fork 继承分叉点之前加载的工具，不继承之后的；Handoff 不继承。
- **TS-16** 工具定义变化时使用当前定义；Server 断连或工具停用时，该工具暂不提供，恢复后自动回来，不需要重新搜索。
- **TS-17** 乐观加载：模型直接调用目录中尚未加载的工具时，这次调用失败，结果提示“已加载，请直接重试”，下一次请求起可用。名称不在目录中时照常报未找到。
- **TS-18** 「按需加载 MCP 工具」关闭期间直接调用过的工具，重新打开后不算已加载。
- **TS-19** 子代理与 Teammate 不按需加载：不发目录，没有 `tool_search`，直接拿到允许范围内的全部工具。
- **TS-20** 加载记录保存失败时，Run 以 commit_failed 停止，不会出现“告诉模型已加载、实际没有保存”的情况。

### 保留提示词缓存（按 Provider）

- **TS-21** Provider 表单的协议选择下方新增「工具搜索」分组，选项为「加载新工具时保留提示词缓存」。anthropic-messages 与 openai-responses 默认开启，升级前已保存的 Provider 也开启；openai-completions 默认关闭。
- **TS-22** 只在同时满足三个条件的 Run 中使用原生增量写法：「按需加载 MCP 工具」已打开；本次 Run 的目录里有按需工具；不是子代理的 Run。其余 Run 照常发送完整工具列表。
- **TS-23** openai-completions 打开开关后，只对 pi 自带模型目录中标注支持对话中途追加工具的模型使用原生写法，按 Base URL 与模型 ID 匹配；其他模型照常把新工具追加到顶层 tools，请求不报错。开关说明不追加内容。
- **TS-24** 使用原生写法的请求被服务端以 400 或 422 拒绝时，错误信息后追加指向这个开关的提示；不自动改用完整工具列表重试，也不自动关闭开关。
- **TS-25** 两个开关都从下一个 Run 生效，重试与继续也算新 Run；进行中的 Run（含等待审批的）沿用开始时的设置。切换后已加载的工具不丢，切换后第一次请求的前缀缓存失效一次。

### 上下文用量与界面文案

- **TS-26** 上下文环与自动压缩只计实际提供给模型的工具定义；目录按其 State Update 计入。
- **TS-27** 界面文案按下表，经 zh/en 字典提供。

| 位置 | 中文 | English |
| --- | --- | --- |
| 设置 → MCP 顶部分组标题 | 工具搜索 | Tool search |
| 全局选项 | 按需加载 MCP 工具 | Load MCP tools on demand |
| 全局说明 | 开启后不再每次请求都发送全部 MCP 工具定义，模型先搜索需要的工具，再直接调用。关闭后一次提供全部 MCP 工具。 | When on, MCP tool definitions aren't sent with every request; the model searches for the tools it needs and then calls them. When off, every MCP tool is provided up front. |
| MCP Server 编辑表单选项 | 始终加载 | Always load |
| Server 选项说明 | 此 Server 的工具始终出现在工具列表中，不需要先搜索。适合几乎每次对话都会用到的 Server。仅在开启「按需加载 MCP 工具」时生效。 | This server's tools are always in the tool list, without a search first. Suited to servers used in almost every conversation. Only applies when "Load MCP tools on demand" is on. |
| Provider 表单分组标题 | 工具搜索 | Tool search |
| Provider 选项 | 加载新工具时保留提示词缓存 | Keep the prompt cache when loading tools |
| Provider 说明 | 对话中途按需加载工具时，只在加载处追加工具定义，不改动整份工具列表。需要服务端支持，不支持时请求会报错，关掉即可。 | When a tool is loaded mid-conversation, its definition is added where it was loaded instead of changing the whole tool list. This needs support from the service; if requests start failing, turn it off. |
| 原生请求被拒时追加的提示 | 如果该服务不支持，请在 Provider 设置中关闭「加载新工具时保留提示词缓存」后重试。 | If this service doesn't support it, turn off "Keep the prompt cache when loading tools" in the provider settings and retry. |

## User Stories

1. As a 连接了多个 MCP Server 的用户, I want MCP 工具的完整定义不再每次请求都发给模型, so that 上下文留给任务本身。
2. As a 用户, I want 模型从目录里知道有哪些 MCP 工具可用, so that 它不会因为看不到定义就以为能力不存在。
3. As a 用户, I want 模型搜索并加载工具后按真实名称调用, so that 工具卡、审批和 Hook 看到的仍是原来的工具。
4. As a 用户, I want 一次搜索同时完成查找与加载, so that 不多花一轮往返。
5. As a 用户, I want 模型能按确切名称一次加载多个工具, so that 目录里已有名字时不必用关键词去猜。
6. As a 用户, I want 中文描述的工具能用中文关键词搜到, so that 中文 MCP Server 同样好用。
7. As a 用户, I want 搜不到时模型知道有哪些 Server 并换个说法重搜, so that 它不会轻易认定能力不可用。
8. As a 用户, I want 工具搜索搜不到我停用、未批准或超出子代理范围的工具, so that 按需加载不会绕开现有限制。
9. As a 用户, I want 加载工具不等于允许执行，调用照常经过权限规则、审批与 Hook, so that 安全性不变。
10. As a 用户, I want Plan Mode 下模型也能搜索工具, so that 规划时能确认有哪些能力。
11. As a 用户, I want deny 规则与 PreToolUse Hook 能拦截工具搜索本身, so that 我能控制这个入口。
12. As a 用户, I want 目录在预算内尽量写全，工具太多时自动精简, so that 目录本身不占太多上下文。
13. As a 用户, I want 目录变化时只告诉模型新增和移除的部分, so that 不重复发送整份目录。
14. As a 用户, I want 压缩或回退之后模型重新收到完整目录, so that 它不会忘记有哪些工具。
15. As a 用户, I want 已加载的工具在重启、继续、重试与压缩之后仍然可用, so that 模型不必反复搜索。

16. As a 用户, I want 回退到加载之前时那次加载一并撤销, so that 会话状态与回退后的对话一致。
17. As a 用户, I want 分叉出的会话只继承分叉点之前加载的工具, so that 它与原会话在分叉点的状态一致。
18. As a 用户, I want 交接到新会话时不带上已加载的工具, so that 新会话按自己的需要重新发现。
19. As a 用户, I want MCP Server 断开时它的工具暂不提供、重连后自动回来, so that 模型不必重新搜索。
20. As a 用户, I want 工具定义更新后模型看到最新的定义, so that 它不会按旧参数调用。
21. As a 用户, I want 模型直接调用还没加载的工具时自动加载并提示重试, so that 少浪费一轮搜索。
22. As a 用户, I want 关闭「按需加载 MCP 工具」后所有 MCP 工具直接提供, so that 遇到问题时能回到原来的行为。
23. As a 用户, I want 把几乎每次都用的 MCP Server 设为「始终加载」, so that 新对话不用先搜索它的工具。
24. As a 项目维护者, I want 在项目配置里为 Server 设置始终加载而不需要重新批准, so that 这个设置不触发多余的批准。
25. As a 项目维护者, I want 项目设置只能关闭按需加载、不能打开它, so that 项目只能收紧全局设置。
26. As a 用户, I want 子代理与 Teammate 直接拿到允许范围内的全部工具, so that 短任务不必先搜索。
27. As a 用户, I want 加载工具时提示词缓存不失效, so that 长对话中加载工具不按未缓存价格重算整段对话。
28. As a 用户, I want 在 Provider 设置里关闭「加载新工具时保留提示词缓存」, so that 服务端不支持时我能自己恢复。
29. As a 用户, I want 服务端拒绝这种写法时错误信息指向这个开关, so that 我知道怎样修复。
30. As a 使用 Kimi K3 的用户, I want 在 openai-completions Provider 上手动打开这个开关, so that 支持的服务也能保留缓存。
31. As a 使用其他 OpenAI 兼容服务的用户, I want 打开开关也不会让请求出错, so that 误开不会破坏对话。
32. As a 用户, I want 改了开关之后已有会话的下一个 Run 就用新设置、已加载的工具不丢, so that 不必新开会话。
33. As a 用户, I want 上下文环只计入实际提供给模型的工具, so that 显示的用量与真实请求一致。
34. As a 没有配置 MCP 的用户, I want 一切照旧, so that 这项功能不影响我。
35. As a Headless Run 的使用者, I want 与桌面相同的按需加载行为与 Provider 设置, so that 命令行运行同样节省上下文。

## Implementation Decisions

### 检索与 `tool_search`

- agent 包新增工具搜索模块：分词、BM25、查询解析、目录的构造与渲染，以及 `tool_search` 的定义与结果文本。它不写 Session、不连接 MCP、不做权限判定，由宿主注入本 Run 的目录快照。
- 检索照搬程小帮 v1.10.1：检索文本为工具名（`_ . - :` 换成空格）、描述与第一层参数名；分词取小写字母数字串，连续中日韩字符切成二字 bigram，单字保留；Okapi BM25，k1=1.5、b=0.75，df 与平均长度只在通过 `+term` 过滤的候选上统计；同分按 Server 与名称排序；没有正分时用完整查询串匹配工具名子串。不做分字段加权、NFKC 归一化或递归提取参数。
- 结果为 JSON，字段与提示文字照搬程小帮：`query`、`totalOnDemand`、`matches`、`loaded`、`note`，以及常驻工具、未知名称与零命中时的字段。schema 预算 8000 字符。
- 权限类为 context-read，与现有 MCP 资源工具相同。

### 目录

- 新增一种 State Update，名称暂定 `on_demand_tools`，值为排序后的已公告工具名。正文第一次为完整目录，之后为相对最近一次送达值的 Added/Removed；送达排在现有各项之后。已公告名单从有效上下文判断，不另存。读取或渲染失败时记 warn，本次不发送，Run 继续。
- 目录来自 Run 开始时的 MCP 快照，只含当时已连接的 Server，排除始终加载的 Server；`tool_search` 用同一份快照。

### 加载记录与提供给模型的工具

- 新增一种宿主条目，名称暂定 `tool_load`：工具名列表、来源（search 或 optimistic）与对应的工具调用 ID。运行时在对应的 toolResult 提交之后写入。工具结果的文本与 details 不算加载记录，其他工具无法伪造。
- 已加载集合等于只处理回退的有效条目中全部加载记录的并集，不经过压缩切点过滤。Fork 只复制目标边界之前的加载记录，不套用权限条目在 assistant-inclusive 边界下复制全部的规则。
- 提供给模型的工具为常驻工具、始终加载 Server 的工具、已加载名单与当前目录的交集，目录非空时再加 `tool_search`。运行时 registry 仍保留全部可用工具，子代理的工具交集照旧计算。每两轮之间重新派生并替换执行集合，工具声明由 pi 生成并经现有提交路径写入，Coko 不另写声明。
- 加载记录提交失败时以 commit_failed 停止 Run。toolResult 已提交而加载记录未提交时崩溃，恢复后没有这次加载，模型再直接调用时由乐观加载补上；恢复不重跑业务工具。

### 乐观加载

- pi 对不在执行集合中的工具返回未找到错误，不经过 hook。工具名在本 Run 的目录中时，运行时在提交前把结果文字改为“已加载，请直接重试”，结果提交后写加载记录；不在目录中时保持原结果。

### 原生增量传输

- 每个 Run 开始时，在取得目录之后、`setModel` 之前计算 compat。满足 TS-22 的三个条件且 Provider 开关打开时：anthropic-messages 设置 `supportsMidConvoSystemMessages` 与 `supportsMidConvoToolChanges`；openai-responses 设置 `supportsMidConvoSystemMessages` 与 `supportsAdditionalTools`；openai-completions 用规范化的 Base URL（去掉末尾斜杠、主机名小写、保留路径）与模型 ID 查 pi 自带目录，条目同时带 `supportsMidConvoSystemMessages` 与 `supportsMidConvoToolAdditions` 时才设置这两项。
- 序列化全部交给锁定的 pi-ai 1.4.0；Coko 不修改 pi，也不按模型名推断能力。
- 原生写法的请求被 400 或 422 拒绝时，Run 的错误信息附带开关提示；现有的重试策略不变。

### 配置、协议与持久化格式

- 全局能力配置新增一个布尔键，默认 true；按现有合并规则，项目文件只能设为 false。
- MCP Server 配置新增可选的 `alwaysLoad`：校验器接受，不进入批准摘要。
- Provider 新增可选的 `incrementalTools`：缺省时 anthropic-messages 与 openai-responses 视为开启，openai-completions 视为关闭；经现有的一次性保存写入，无界面运行的 Provider 启动配置同样接受。
- 新条目与新 State Update 名同时进入 agent 与 protocol 两份 schema，并保持两者的对照测试；旧应用遇到不认识的 kind，按现有降级规则跳过。

### 用量与界面

- 上下文用量只计实际提供给模型的工具；子会话按其过滤后的工具计算。
- 设置的 MCP 分区顶部增加全局开关；MCP Server 编辑表单增加「始终加载」；Provider 表单在协议选择下方增加「工具搜索」分组，三种协议都显示，未设置时按协议显示默认值。

## Testing Decisions

### 原则与接缝

只断言外部事实：实际发给模型服务的请求体、已提交的条目与导出、MCP fixture 是否收到调用、HTTP 接口返回的用量与错误，以及界面渲染出的文字与可访问名称。只有模型服务、外部网络与时钟使用可控替身；工具搜索、目录、加载记录、运行时与持久化都用真实实现。

测试接缝为 Q20 确认的验收方案：

1. **真实 Sidecar（主接缝）。** 用 MCP stdio fixture 作为 MCP Server。模型侧两种替身：faux 脚本，用于搜索、加载、恢复、分叉、乐观加载与子代理；本地伪造的模型 HTTP 服务，按协议返回脚本化的流式响应并记录请求体，用于“第一次请求不带 MCP schema”与三种协议的请求体快照。先例：[MCP](../../tests/integration/sidecar-mcp.test.ts)、[压缩](../../tests/integration/sidecar-compaction.test.ts)、[回退](../../tests/integration/sidecar-rewind.test.ts)、[分叉时的 State Update](../../tests/integration/sidecar-state-update-fork.test.ts)、[子代理](../../tests/integration/sidecar-subagents.test.ts)，以及启动本地伪造模型服务的 [Provider 凭据测试](../../tests/integration/sidecar-settings-credentials.test.ts)。
2. **Browser Mode。** 三处开关、默认值、随协议显示与 zh/en 文案。先例：[MCP 分区](../../apps/desktop/src/renderer/features/settings/mcp-section.browser.test.tsx)、[模型设置](../../apps/desktop/src/renderer/features/settings/models-section.browser.test.tsx)。
3. **纯函数单测（补充）。** 检索、目录渲染与降级、已加载集合的派生与分叉选取。单测不能代替前两类入口。

另按测试约定，为模型可见的行为变化维护一段不需要密钥的会话回放或输出快照，期望内容独立维护。真实 provider 的验证单独报告：默认开启的线路用真实 Key 跑 AC-02 与 AC-18，未跑或未通过的报告为未验证。评测扩展（judge 断言工具名、中英文检索用例）放在首版之后。

### 旧测试与执行范围

- 全局开关默认打开后，经 Run 装配直接调用 MCP 工具的现有测试会先遇到工具未加载。含 `mcp__` 工具名的测试文件有 19 个，其中 integration 与 E2E 测试需要逐个检查：按测试目的改为先搜索、把 fixture Server 设为始终加载，或关闭全局开关，并在交付记录中说明原因。
- 断言“用量计入全部 MCP 工具”的测试随行为修改。
- 按[测试执行与结果报告](../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查。工具装配、条目载荷与 Provider 字段是共享接口，验证范围扩大到受影响的模块；没有理由时不运行全仓测试。

### 验收场景

| 编号 | 前提 → 操作 → 可观察结果 |
| --- | --- |
| AC-01 | 全局开关打开，连接一个提供多个工具的 MCP Server → 在新会话中提交消息 → 第一次模型请求的工具只有内置工具与 `tool_search`，没有这些 MCP 工具的定义；该 Run 开头送达目录 State Update，按 Server 列出工具名与说明。（TS-01、03、11、12） |
| AC-02 | 同上 → 模型调用 `tool_search`，命中两个工具 → 结果列出两者的名称、Server、说明与 schema，并注明已加载；下一次请求的工具包含它们的定义；模型按真实名称调用其中一个，MCP Server 实际收到调用，工具卡显示该工具名。（TS-05、07） |
| AC-03 | 目录中有多个工具 → 依次查询：`select:` 两个确切名称（limit 为 1）、带 `+词` 的关键词、一个常驻工具名、一个不存在的名称、一个没有任何命中的词 → `select:` 加载两个工具；`+词` 只返回含该词的工具；常驻工具列为已可用；不存在的名称列为未知；零命中时返回可用 Server 与重搜提示；schema 累计超过 8000 字符的部分只注明已加载。（TS-06、07） |
| AC-04 | 一个 Server 的工具描述为中文，另一个为英文 → 用中文关键词查询，再用某工具名的一段子串查询 → 中文描述的工具按二字切分命中；英文描述的工具没有命中时按零命中处理；子串查询在没有正分时仍返回该工具。（TS-08） |
| AC-05 | 目标工具有 deny 规则，`tool_search` 配有 PreToolUse Hook，会话处于 Plan Mode，某工具在 disabledTools 中，某项目 Server 未批准 → 分别搜索与调用 → 目标工具可以加载，但调用被拒绝，处理函数不执行；Hook 拦截搜索；Plan Mode 下可以搜索；停用的工具与未批准 Server 的工具搜不到，按确切名称选择时报未知。（TS-09） |
| AC-06 | 目录的完整渲染超出预算 → 开始 Run → 先统一缩短说明，但不少于 24 字；仍超出时从最长的组开始降为只列名称，再降为只列 Server 与工具数；目录不含 schema。（TS-11） |
| AC-07 | 第一个 Run 已送达目录 → 两个 Run 之间新增一个 Server、移除另一个；之后手动压缩；再回退到压缩之前 → 下一个 Run 只送达 Added 与 Removed；压缩与回退之后的下一个 Run 各重发完整目录；目录不变的 Run 不送。（TS-12） |
| AC-08 | Run 开始时某 Server 连接失败 → Run 进行中手动重连成功，在本 Run 内搜索它的工具，然后开始下一个 Run → 本 Run 搜不到；下一个 Run 的目录包含它的工具，可以搜索加载。（TS-13） |
| AC-09 | 会话已加载两个工具 → 重启 Sidecar 后 continue；对失败的请求 retry；分别触发手动、自动与溢出压缩 → 每种情况下的下一次请求都包含这两个工具的定义，模型无需再搜索；恢复过程不重跑业务工具。（TS-14） |
| AC-10 | 第 2 轮加载工具 A，第 4 轮加载工具 B → 回退到第 3 轮之前；从第 3 轮的用户消息分叉；从第 3 轮的助手回复分叉；在压缩过的会话上同样分叉；用 Handoff 交接 → 回退后 B 不再加载，A 仍加载；各种分叉都只继承 A；Handoff 的新会话没有已加载的工具。（TS-15） |
| AC-11 | 已加载工具 A → A 所在 Server 断开，下一个 Run 再重连；A 的说明与 schema 在两个 Run 之间改变 → 断开期间的 Run 不提供 A；重连后的 Run 自动提供 A，无需搜索；定义变化后请求中是新定义。（TS-16） |
| AC-12 | 目录中有未加载的工具 C → 模型直接调用 C，再直接调用一个不在目录中的名称 → C 的调用结果为“已加载，请直接重试”，下一次请求包含 C，再次调用成功；不在目录中的名称返回原有的未找到错误，不加载任何工具。（TS-17） |
| AC-13 | 关闭「按需加载 MCP 工具」，模型直接调用工具 D，然后重新打开；另在项目设置中分别把开关设为 false 与 true → 关闭期间所有 MCP 工具直接提供，没有 `tool_search` 与目录；重新打开后 D 重新成为按需工具；项目设为 false 时该项目的会话不按需加载，设为 true 时被忽略并给出诊断。（TS-02、18） |
| AC-14 | 一个全局 Server、一个项目 Server 与一个插件 Server 都设为始终加载 → 开始 Run → 三者的工具直接出现在请求中，不在目录里；为已批准的项目 Server 在 `.mcp.json` 中增加该字段后不需要重新批准。（TS-04） |
| AC-15 | 根会话启用按需加载，部分 MCP 工具尚未加载 → 派发 general 子代理与一个 Teammate → 子会话的请求包含允许范围内的全部工具，包括父会话未加载的 MCP 工具，没有 `tool_search`，也没有目录 State Update。（TS-19） |
| AC-16 | 加载记录的提交被注入失败 → 模型调用 `tool_search` → Run 以 commit_failed 结束，不发出包含该工具的请求。（TS-20） |

| AC-17 | 新建 anthropic-messages、openai-responses、openai-completions 三个 Provider，另有一个升级前保存的 Messages Provider → 打开各自的 Provider 表单 → 协议选择下方有「工具搜索」分组；前两个与升级前保存的 Provider 显示开启，openai-completions 显示关闭；未设置过时按所选协议显示默认值。（TS-21） |
| AC-18 | 本地伪造的模型服务记录请求体，三种协议各配一个 Provider，开关分别打开与关闭 → 在满足条件的 Run 中加载一个工具 → 关闭时每次请求带完整工具列表；Messages 打开时请求级 tools 为初始工具加 `defer_loading` 占位符，加载以 `tool_addition` 发出，并带 `inline-tools-2026-09-15` beta；Responses 打开时工具在 `additional_tools` 中声明；Completions 打开且模型在 pi 目录中有标注时，以带 `tools` 的 system 消息追加，否则照常追加到顶层 tools，请求不报错。（TS-21、22、23） |
| AC-19 | Provider 开关已打开 → 分别在全局开关关闭、目录为空、子代理的 Run 中发出请求 → 三种情况都发送完整工具列表，不使用原生写法。（TS-22） |
| AC-20 | 使用原生写法的请求分别被以 400、422、401、429 拒绝 → 查看 Run 的错误 → 400 与 422 的错误信息附带开关提示，不自动改用完整列表重试；401 与 429 按现有方式处理，不附带提示。（TS-24） |
| AC-21 | 会话已加载工具，一个 Run 正在等待审批 → 关闭 Provider 开关，完成该 Run，开始下一个 Run，再对一次失败的请求 retry → 进行中的 Run 沿用原来的写法；下一个 Run 与 retry 都发送完整工具列表；已加载的工具仍在请求中。（TS-25） |
| AC-22 | 连接多个 MCP Server，已加载其中部分工具 → 查看根会话与子会话的上下文用量 → 工具一项只计常驻工具、始终加载的工具与已加载的工具；目录计入其 State Update；子会话按其实际工具计算。（TS-26） |
| AC-23 | 界面语言分别为中文与英文 → 打开设置的 MCP 分区、MCP Server 编辑表单与 Provider 表单 → 三处开关的标题、选项名与说明与 TS-27 的文案表一致；宽度为 390 CSS px 时不重叠、不裁切。（TS-02、04、21、27） |

## Out of Scope

- 翻译或 embedding 检索；provider 托管的检索（Anthropic、OpenAI 内置的 tool search）。
- 自动探测服务端能力；按模型名推断能力；按模型设置的开关。
- Run 中途刷新目录；子代理与 Teammate 按需加载；自动卸载工具。
- 内置工具按需加载；搜索 MCP 资源与提示模板的内容；读取 MCP Server 的 `instructions` 作为目录摘要。
- 专用的工具卡或搜索页面；在界面上暴露目录形态、预算与条数上限；用环境变量覆盖开关。
- 修改 pi-ai 或 pi-agent-core。
- 评测扩展，放在首版之后。

## Further Notes

- **与程小帮 v1.10.1 的有意差异。** 已加载集合保存在 Session 条目中，而不是会话字段；已公告名单不另存；Run 中途不刷新 MCP；开关按 Provider 而不按模型；openai-completions 按 pi 目录的标识判断；线上格式随 pi-ai 1.4.0，程小帮在 pi-ai 0.85.1 上的缓存实测不能沿用。
- **目录预算的 token 估算。** Coko 没有 tokenizer：中日韩字符按 1 token、其余按 chars/4 估算，用户 2026-11-05 确认拆票时采用。设计的“实施时需确认”另列了五项实现核查，已分配到实施票。
- **ADR 0024。** 新增一种 State Update 与该 ADR 的决定一致；本次已更新它的列举与[上下文管理](../../docs/subsystems/context.md#state-update)的说明。
- **文档影响。** 本次已同步的当前文档及 ADR 归属判断见[联合证据](evidence/acceptance.md#文档影响与-adr-判断)；设计提案的确认状态保持独立。
- **实施票。** 2026-11-05 拆为 15 张实施票，列表与阻塞关系见 [README](README.md#实施票)；本地实施已完成，当前结果见[联合证据](evidence/acceptance.md)。
