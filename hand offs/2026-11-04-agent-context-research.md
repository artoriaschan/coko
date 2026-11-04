---
kind: reference
description: "Coko Agent 上下文与 Tools Search 调研交接：客户端检索、按需加载、三协议适配与验收，以及参考实现和待确认事项。"
lifecycle: active
---

# Coko Agent 上下文机制调研交接

日期：2026-11-04（Asia/Shanghai）。本文承接本次会话的静态源码与官方协议文档调研，用于继续确认参考版本、收敛设计及后续规格工作。

2026-11-04 用户明确指定最终保存到主仓库 `/Users/artorias_chan/Workspaces/person/coko/hand offs/`，以便在 VS Code 中查看并于次日继续调研。此前文件曾位于系统临时目录和 Codex 工作树；当前主仓库中的本文件是继续工作的入口。本文为交接快照，未升级为正式规格或已批准设计。

## 先读结论与授权范围

- 用户希望优化 Coko 产品内的 Agent 与基础能力，同时兼顾开发 Coko 的编码 agent 环境；优先产品能力。
- 此前调研重点逐步收敛到 system-prompt、system-reminder、上下文装配，以及 Codex、Claude Code、Chengxiaobang 的实现比较。
- 推荐方向尚未得到实施批准：稳定基础提示 + 每次模型请求的一致状态快照 + 领域状态更新 + 条件触发提醒 + 可解释的请求记录。
- 用户另已明确要求 [Tools Search](#tools-search) 在客户端检索并按需加载工具，同时支持 Chat Completions、OpenAI Responses API 和 Anthropic Messages API。目标已确认；具体接口、加载策略和实现尚未批准或实施，本次仅授权补充交接文档。
- 用户只要求分析和生成交接文档。未修改任何仓库源码、规格、ADR、tracker 或配置，未提交、推送、启动应用或调用真实模型；此前临时交接是该阶段唯一新增产物。现按用户要求移入仓库 `hand offs/`，并补充目录入口和归属登记；这些文档尚未提交或推送。
- 没有运行产品行为测试、故障注入、真实模型请求或模型评测；文档检查单独执行。风险项来自静态分析，不能说成已经复现的缺陷，不能声称建议已经实施。
- **优先待确认：用户指出 Chengxiaobang 可能已有 1.10。尚未定位该版本。前述分析只覆盖本地当前源码和 1.9.2 提取产物，不代表最新产品实现。**

## 工作目录与版本边界

| 对象 | 本地目录 | 已核实版本/状态 |
| --- | --- | --- |
| Coko | `/Users/artorias_chan/Workspaces/person/coko` | HEAD `9ce63508`；调研时工作区干净 |
| Codex | `/Users/artorias_chan/Workspaces/agent/codex` | HEAD `48524f337a`；有既有脏文件，不要清理或覆盖 |
| Claude Code | `/Users/artorias_chan/Workspaces/agent/claude-code` | HEAD `77a7934e`；项目自述为社区逆向/反编译重建且有本地改造，不能视为官方最新源代码 |
| Chengxiaobang | `/Users/artorias_chan/Workspaces/agent/chengxiaobang` | HEAD `0a9ce4d`；可编辑源码 package 版本 `0.1.14`；反编译目录最高 `v1.9.2` |

继续前重新检查相关检出状态，避免把本次源码快照当成永远当前。

## 用户需求演进

1. 用户调用 retro，问“当前项目的 agent 及其基础能力有什么优化空间”。
2. 范围澄清：用户明确选择“两层都看，优先产品能力”。
3. 用户询问 Coko 上下文如何组装，随后询问 Codex 的对应实现。
4. 用户问 system-remainder；本次按 `<system-reminder>` 运行时提醒解释。
5. 用户要求看 Claude Code，并纠正“**不止 system-reminder，还有 system-prompt**”。后续工作必须同时覆盖两者及完整装配机制。
6. 用户要求综合 Codex、Claude Code 优化 Coko，并问 Chengxiaobang 是否借鉴 Claude Code。
7. 用户追问“chengxiaobang 最新的版本是多少？不是 1.10 吗？”目前没有确认 1.10 的位置或发布来源。
8. 用户调用 handoff，要求把以上调研结果生成交接文档，并最终明确保存到主仓库 `hand offs/`，用于在 VS Code 中查看和次日继续讨论。
9. 用户提出客户端 Tools Search：搜索与加载由 Coko 执行，并追问是否依赖 System Reminder。
10. 用户明确要求同时支持 Chat Completions、OpenAI Responses API（口述为 Responder API）及 Anthropic API；要求讨论真正的工具搜索、加载和后续调用，不能只讲提示词或搜索结果文本。
11. 用户要求把 Tools Search 方案、三协议适配和验收要求补入本文件。本次授权为文档维护，未授权实施代码。
12. 用户追问三协议客户端实现是否经过调研。重新核对官方文档后，补齐 Responses 原生客户端搜索、Anthropic 自定义搜索与引用展开，以及 Chat Completions 的应用层实现区别；用户再次调用 handoff，要求同步到主仓库 main 分支下。

## Coko 当前实现：以现有文档为正文

入口与约束：

- [文档导航](../docs/README.md)
- [Agent 执行约定](../docs/tech-stack/agent-runtime.md)
- [上下文当前行为](../docs/subsystems/context.md)
- [指令文件](../docs/subsystems/instructions.md)、[Skills](../docs/subsystems/skills.md)、[Memory](../docs/subsystems/memory.md)
- [Goal](../docs/subsystems/goal.md)、[Todo](../docs/subsystems/todo.md)、[Plan Mode](../docs/subsystems/plan-mode.md)
- [追踪和评测](../docs/subsystems/tracing.md)
- [领域术语](../GLOSSARY.md)、[领域配置](../docs/agents/domain.md)
- [ADR 0005：权限与沙箱](../docs/adr/0005-permission-mode-and-sandbox.md)、[ADR 0008：项目文件只收紧](../docs/adr/0008-project-files-only-tighten.md)、[ADR 0009：用户资源文件](../docs/adr/0009-user-authored-resources-as-files.md)

关键实现入口：

| 文件 | 本次核对的职责 |
| --- | --- |
| [context/index.ts](../apps/server/src/application/context/index.ts) | `ContextContribution` 组合、顺序、工具与 hooks、统一 guarded 降级 |
| [context/types.ts](../apps/server/src/application/context/types.ts) | `ContextScope`、领域贡献接口、待送达输入及请求前检查 |
| [session-runs.ts](../apps/server/src/application/session-runs.ts) | 输入展开、恢复历史、Run 开始时取 scope/tools/hooks、运行时接线 |
| [engine/system-message.ts](../packages/agent/src/engine/system-message.ts) | 极简默认基础提示、`coko.base`、system sections 合成 |
| [engine/runtime.ts](../packages/agent/src/engine/runtime.ts) | Run 开始时应用 sections；每请求准入、压缩和变换接缝 |
| [entries/host-input.ts](../packages/agent/src/entries/host-input.ts) | 宿主通知与真实用户输入的分类；影响授权、Goal 推进及 UI |

便于理解差距的最小事实：输入依次展开命令、File Reference，结合提交前 Hook 和图片；每个 Run 组装系统 sections、工具和权限范围。sections 顺序为基础提示、instructions、skills、memory、plan、goal、todo、subagents、teams。Skill 正文按需读取，嵌套目录指令首次触及时附入工具结果。历史按回退与压缩规则派生；每次模型请求进行脱敏、裁剪、准入和必要压缩。

system sections 主要每个 Run 刷新，而不是每次模型请求刷新。比如同 Run 内 Todo 工具结果反映新状态，开头 Todo section 仍是旧快照；不能误说模型完全不知道变化。

## Codex：已核实的可借鉴机制

源码入口均在 `/Users/artorias_chan/Workspaces/agent/codex`：

- [session/mod.rs](/Users/artorias_chan/Workspaces/agent/codex/codex-rs/core/src/session/mod.rs)：基础指令选择、`capture_step_context_inner`、`build_initial_context_with_world_state`、`record_context_updates_and_set_reference_context_item`、`record_step_world_state_if_changed`。
- [session/world_state.rs](/Users/artorias_chan/Workspaces/agent/codex/codex-rs/core/src/session/world_state.rs)：按当前 Step 装配模型、权限、AGENTS、环境、协作、多代理及扩展状态。
- [context/world_state/mod.rs](/Users/artorias_chan/Workspaces/agent/codex/codex-rs/core/src/context/world_state/mod.rs)：稳定 section ID、比较快照、`render_diff`、Prefix/Standalone/Mergeable 放置策略。
- [context_manager/updates.rs](/Users/artorias_chan/Workspaces/agent/codex/codex-rs/core/src/context_manager/updates.rs)：同角色可合并片段的消息构建；显式消息边界保留。
- [context/user_instructions.rs](/Users/artorias_chan/Workspaces/agent/codex/codex-rs/core/src/context/user_instructions.rs)：AGENTS 内容使用 user 角色与 `<INSTRUCTIONS>` 包装。
- [session/turn.rs](/Users/artorias_chan/Workspaces/agent/codex/codex-rs/core/src/session/turn.rs)：`build_prompt`；普通与增量工具路径。
- [client.rs](/Users/artorias_chan/Workspaces/agent/codex/codex-rs/core/src/client.rs)：这份版本把非空基础指令转换为 developer 消息前置到 input；工具在不同协议/模式中采用独立字段或历史声明。

核心结论：

- 基础指令选择为显式配置 > 恢复历史 > 当前模型默认指令。
- `TurnContext` 与 `StepContext` 分离；一次请求的模型设置、执行环境、指令和工具共享快照。
- 初次/新窗口建立完整状态，后续按各领域 `render_diff` 追加模型可读更新；持久化 JSON merge patch 不等于直接把 JSON patch 发给模型。
- 当前请求角色和序列化方式具有版本、模型和适配器差异。不要沿用旧版“基础指令一定放独立 instructions 字段”的假设。
- 原生运行提醒没有统一采用字面 `<system-reminder>` 标签；该标签在本次检出主要出现于外部会话迁移识别。
- [时间提醒](/Users/artorias_chan/Workspaces/agent/codex/codex-rs/core/src/session/time_reminder.rs)按配置的间隔、窗口和用户/工具输出边界触发；[片段](/Users/artorias_chan/Workspaces/agent/codex/codex-rs/core/src/context/current_time_reminder.rs)使用 developer 角色。
- [会话预算提醒](/Users/artorias_chan/Workspaces/agent/codex/codex-rs/core/src/session/rollout_budget.rs)按线程、窗口和跨越阈值去重；[上下文余量提醒](/Users/artorias_chan/Workspaces/agent/codex/codex-rs/core/src/context/token_budget_context.rs)和 [Hook 上下文](/Users/artorias_chan/Workspaces/agent/codex/codex-rs/core/src/context/hook_additional_context.rs)也是具名片段。

## Claude Code：已核实的可借鉴机制

以下描述仅对应本地社区重建版，尤其存在定制工具和缓存开关，不能直接上升为官方所有版本行为。

- [prompts.ts](/Users/artorias_chan/Workspaces/agent/claude-code/src/constants/prompts.ts)：`getSystemPrompt()` 返回段落数组；稳定前缀涵盖身份、任务、动作、工具、沟通规则；会话相关段落涵盖模式、Memory 使用方法、环境、语言、风格、MCP 等。
- [systemPromptSections.ts](/Users/artorias_chan/Workspaces/agent/claude-code/src/constants/systemPromptSections.ts)：大多数段落缓存到 clear/compact；显式 volatile 段落重复计算。
- [QueryEngine.ts](/Users/artorias_chan/Workspaces/agent/claude-code/src/QueryEngine.ts)、[queryContext.ts](/Users/artorias_chan/Workspaces/agent/claude-code/src/utils/queryContext.ts)：自定义 system prompt 替换默认，append 追加；自定义路径跳过默认提示及默认 systemContext。
- [context.ts](/Users/artorias_chan/Workspaces/agent/claude-code/src/context.ts)、[utils/api.ts](/Users/artorias_chan/Workspaces/agent/claude-code/src/utils/api.ts)：Git 初始快照进入 systemContext；该本地版把 CLAUDE.md 单独包装成 `<project-instructions>` meta user 消息，日期等剩余辅助信息进入开场 reminder。
- [services/api/claude.ts](/Users/artorias_chan/Workspaces/agent/claude-code/src/services/api/claude.ts)：最终独立 `system`、`messages`、`tools`；system 文本块按内部边界拆分与缓存。边界标记本身不发送。
- [attachments.ts](/Users/artorias_chan/Workspaces/agent/claude-code/src/utils/attachments.ts)：事件/状态生成附件；Plan、Task、Skills、记忆、诊断、日期、工具和 MCP 变化等。
- [messages.ts](/Users/artorias_chan/Workspaces/agent/claude-code/src/utils/messages.ts)：`normalizeAttachmentForAPI`、`wrapInSystemReminder`、`wrapMessagesInSystemReminder`；附件转 meta user 文本，部分开关下合入相邻 tool_result。
- [query.ts](/Users/artorias_chan/Workspaces/agent/claude-code/src/query.ts)：主循环工具结果之后收集附件，纳入后续请求。

核心结论：稳定 system 前缀 + 沿历史加入的动态附件。system prompt 解释 reminder 的用途，但标签本身不提升消息角色。当前代码的 Plan 提醒首次发送后按 5 轮间隔、每若干次完整提醒，其余简短；Todo 间隔为 10 轮且有工具可用性条件。Coko 不宜直接照抄阈值或把提醒默认塞进工具输出。

## Coko 推荐方案（未批准、未实施）

### 三类内容与模块职责

1. **基础 system-prompt**：精简、分段、版本化。涵盖身份、工作准则、授权解释、工具协作、失败处理、证据与沟通要求。运行约束由代码执行。
2. **状态上下文**：当前指令、模式、Goal、Plan、Todo、能力目录和相关 Memory。首次/重建完整注入；后续按领域语义发送新快照、替换说明或增删列表。
3. **system-reminder**：在状态变化、事件发生、接近限制或压缩恢复时唤起注意。提醒有触发、去重、作用域和失效策略。

保留现有 ContextContribution。宿主负责读取领域状态、文件、工具与事件；Agent 层集中处理排序、版本比较、提醒选择、裁剪与渲染。调用方应通过小接口取得一份可发送上下文，避免每个领域自行操作历史并决定全局顺序。暂不建立跨模型通用插件平台或复杂 DSL。

### 每请求统一装配

推荐流程：捕获请求快照 → 关键准入/预算检查 → 必要压缩与重建 → 更新快照并复核预算 → 生成状态更新/提醒 → 脱敏、裁剪、统计 → 适配模型协议并发送。

- 快照包含该请求的模型、模式、领域修订、工具与能力目录、相关资源。
- 工具真正执行时仍按最新权限和真实路径复核。请求快照不冻结或绕过执行权限。
- 片段内部元数据至少需要稳定 ID、来源、作用域、修订/内容哈希、内容、放置策略。
- Reminder 另有触发原因、去重键与失效条件。元数据供运行时使用，不要求全部塞进模型文本。
- 不必为所有领域提供 JSON diff；工具目录适合增删，Plan 适合修订摘要，Todo 适合当前快照。

### 来源、授权与持久化

- 来源以结构化元数据与领域条目确定。外部文件、用户正文中同名 XML 标签不自动成为宿主指令。
- 项目指令、Skill、Memory 保留作用域；不得违背 ADR 0008 取得额外执行权限。消息角色映射由模型适配器决定。
- Goal、审批、任务结果与团队消息等业务事实继续归领域存储；提醒正文通常可由事实重建。
- 请求记录保存纳入的片段 ID、修订、事件 ID；重试复用清单。记录“已纳入请求”不能宣称“模型已读/已执行”。
- 压缩之后从领域当前状态重建，恢复未处理事件；不要只依赖摘要文本保存权限、目标或待办。
- 稳定前缀避开时钟和频繁计数；缓存效果用真实请求布局、输入量与缓存读量验证。
- 关键检查失败应停止请求；可选检索可降级并留诊断。当前统一 guarded 降级需要按职责拆分。

### 提醒首批范围与验收

优先覆盖模式/计划变更、Job/子代理完成、目标预算临近、压缩恢复、重复无进展失败。避免只按调用次数要求模型提前结束；合法等待和批处理也会有大量调用。

建议三批：

1. 基础提示分段、请求快照、关键失败策略。
2. 状态更新、提醒触发与去重、压缩/重启重建。
3. 请求上下文清单、缓存/Token 指标、真实模型评测。

验收至少覆盖：同一 Run 多次请求中的状态变化；重复事件/重试去重；压缩后模式和目标不丢失；重启后未处理事件；外部伪造标签不能取得授权；关键装配失败不放行。确定性测试先走现有公共运行时与 Sidecar 入口，另用真实模型评估完成率、误报完成、费用和延迟。

## Tools Search

### 已确认需求与实施状态

**用户确认的目标：客户端检索完整工具目录、按需加载命中工具，并在 Chat Completions、OpenAI Responses API、Anthropic Messages API 三种协议中完成真实工具调用。** “客户端”指相对于模型服务商的 Coko 运行时，实际执行位置为 Sidecar；不是要求 renderer 承担模型调度。

**不依赖 `<system-reminder>` 标签。** 模型通过初始可见的搜索工具发起搜索；客户端检索后，由运行时或协议原生加载机制使命中定义在后续生成中可用。System prompt 或 Reminder 只说明何时搜索、当前有哪些能力，既不注册工具，也不授予权限。仅在 tool result 中返回普通说明或 JSON Schema 文本、没有使正式工具定义可用，不满足此需求；协议识别的 `tool_search_output` 或 `tool_reference` 是结构化加载路径，不能与普通文本混同。

本节记录已确认目标与讨论中的实现建议；没有生成正式规格/ADR/实施票，没有实现或验证 Tools Search。前述会话中的 TypeScript 代码仅是接口示意，内部 `activate` 等字段不是已有 Coko 工具契约或任何服务商的协议字段。

### 官方资料核实：三种协议均有客户端实现路径

2026-11-04 重新核对以下官方资料。此前只描述“普通搜索函数 + 下一次请求更新 tools”的通用方案，遗漏了原生客户端搜索能力；下表更正该不完整说明。文档证据支持协议层可行性，不能替代 Coko 实现、锁定依赖适配和真实请求验收。

| 协议 | 客户端检索及加载路径 | 证据性质与限制 |
| --- | --- | --- |
| Chat Completions | 将 `tool_search` 声明为普通 function；模型发起 tool call，客户端检索目录、回传 tool 消息，并将命中定义加入下一次请求的 `tools` | [Function calling](https://developers.openai.com/api/docs/guides/function-calling) 直接支持客户端函数调用与结果回传；动态增添工具的整条搜索流程是基于这些能力的工程设计推导，不是官方原生 Tool Search 消息协议，尚未实测 |
| OpenAI Responses API | 声明 `type: "tool_search", execution: "client"`；接收 `tool_search_call`，本地检索后按 `call_id` 返回带工具定义的 `tool_search_output` | [Client-executed tool search](https://developers.openai.com/api/docs/guides/tools-tool-search#client-executed-tool-search) 明确提供此模式，也允许返回初始请求未声明的工具；原生能力受模型与服务端支持范围限制，不能推及所有 Responses 兼容端点 |
| Anthropic Messages API | 自定义客户端搜索工具执行检索，在标准 `tool_result` 的 content 中返回 `tool_reference`；API 展开引用后让模型调用命中工具 | [Custom tool search implementation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#custom-tool-search-implementation) 明确提供此模式；每个引用必须在顶层 `tools` 中存在相应完整定义，通常设 `defer_loading: true`；检索可在客户端执行，展开由 API 完成 |

“客户端检索”与“完整工具目录只留在客户端、仅发送命中的 Schema”是两个不同约束。Anthropic 文档中的全量 deferred-tools 路径仍在每次请求发送完整定义，延迟的是进入模型上下文，见 [Deferred tool loading](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool#deferred-tool-loading)。它不能直接证明完整目录未上传。

若 Coko 采用仅发送常驻和已加载工具的目标，三协议可以统一使用下文的普通客户端函数方案；这是待实现和验证的共同基线。Responses 的原生客户端搜索，以及 Anthropic 的自定义搜索加引用展开，是另行评估的可选适配路径，并非必须三套独立检索器。Anthropic 若只在搜索后为命中引用补入定义，也须单独验证，不能假定兼容全量目录方案的缓存与恢复行为。

已完成：官方文档核实及前述静态源码调研。未完成：Coko 搜索/加载实现、当前锁定 pi 依赖的原生字段支持核查、三个实际 endpoint/模型的请求闭环、缓存和费用测量。不得把“协议层可实现”写成“Coko 已支持”或“三协议已测试通过”。

### 候选实现：共享检索与加载，分别适配协议

采用一套协议无关的工具目录、搜索和 Session 加载状态，复用三种模型适配器。对模型暴露的工具名暂用 `tool_search`，命名与具体参数尚待规格确认。

| 部分 | 职责与不变量 |
| --- | --- |
| 本地工具目录 | 保存当前作用域内工具的稳定名称、来源、描述、完整参数 Schema、Schema 修订及执行绑定；目录留在客户端 |
| 检索 | 接收 query 与结果数上限，返回有序候选；先考虑精确工具名、Server 名和词法匹配，排序算法与阈值待确认 |
| Session 可见工具集 | 常驻工具与本 Session 已加载且仍有效的工具；不能用全局已加载集合串联不同 Session |
| 执行循环 | 校验搜索结果、提交结果并应用加载变更，在下一次生成前刷新正式工具定义；对重复加载幂等 |
| 协议适配器 | 将同一工具集合、调用和结果映射到各自的 wire format；不各自实现一套检索或授权策略 |

示意交互如下，表示设计目标而非已验证行为：

```text
请求 1：常驻工具 + tool_search
模型：tool_search(query="查询 GitHub issue", limit=5)
Sidecar：在当前作用域工具目录中检索，取得命中工具的完整定义
Sidecar：记录搜索结果，将命中工具加入 Session 可见集合
请求 2：常驻工具 + tool_search + mcp__github__get_issue 的正式 Schema
模型：mcp__github__get_issue({...})
Sidecar：沿原工具的参数校验、权限、审批、调度、超时和审计链执行
请求 3：携带原工具调用结果，模型继续工作
```

候选搜索接口是 `tool_search({ query, limit? })`；可增加 `select:<完整工具名>` 精确选择。搜索结果提供名称、用途、来源与加载状态，完整 Schema 同时交给运行时；没有必要在文本结果里再重复全部定义。最终默认 limit、最大值、精确选择语法及低相关度/无命中处理仍待规格确定。应专门评估中文查询对英文工具描述的召回。

建议加载后直接调用原工具，保留其正式参数约束、工具身份、权限类、追踪与工具卡。此前讨论的通用 `execute_tool(name, arguments)` 是另一种方案，不是三协议支持的前提，本节未选择它作为默认执行通道。

### 三种协议的适配要求

通用基线是每次请求发送“常驻工具 + 当前 Session 已加载且仍有效的工具”的完整定义。具体采用普通 tools 字段还是适配器已支持的增量声明，应核对 Coko 锁定的 pi 版本与模型能力；不能以另一个 pi 检出的实现代替当前依赖验证。该基线不要求服务商提供原生 Tool Search 或 `tool_reference` 自动展开。

| 协议 | 工具定义的普通格式 | 模型调用 | 搜索及后续工具结果的返回格式 |
| --- | --- | --- | --- |
| Chat Completions | `tools[]` 中 `type: "function"`，名称、描述和 `parameters` 位于 `function` 内 | assistant 的 `tool_calls[]` | `role: "tool"` 消息，以 `tool_call_id` 对应原调用 |
| OpenAI Responses API | `tools[]` 中 `type: "function"`，`name`、`description`、`parameters` 位于该项顶层 | `function_call` 项 | `function_call_output` 项，以 `call_id` 对应原调用 |
| Anthropic Messages API | `tools[]` 中 `name`、`description`、`input_schema` | assistant content 中的 `tool_use` 块 | 后续 user content 中的 `tool_result` 块，以 `tool_use_id` 对应原调用 |

采用上述通用基线时，三条路径都把 `tool_search` 注册为普通客户端工具并实际执行本地搜索；这不是原生客户端搜索必须采用的 wire format。若使用 Responses 原生模式，应处理 `tool_search_call` / `tool_search_output`；若使用 Anthropic 引用模式，应处理 `tool_result.content` 中的 `tool_reference` 及对应定义。适配器同时保持各自协议要求的调用/结果配对、消息顺序及其他必要历史项；不能因为加入新工具而丢掉推理或思考等协议所需内容，也不能把 Anthropic 的 tool_result 改成 Chat Completions 的 tool 角色。

某个 endpoint 或模型的普通工具调用、运行中工具集合变化尚未验证时，应标为未验证/不支持，不能仅凭协议名声明已完成。最终要求仍是三种协议全部交付，不能只完成其中一种后笼统报告“Tools Search 已支持”。

普通工具格式另见 [Anthropic Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)；客户端搜索的官方来源与限制见[核实结果](#官方资料核实三种协议均有客户端实现路径)。实现时复核版本、实际模型与端点，不把官方支持当作 Coko 已完成的证据。

### Coko 接入位置与生命周期

- [模型注册](../packages/agent/src/models/registry.ts) 已声明三种协议，只能证明协议入口存在。
- [ToolRegistry](../packages/agent/src/tools/registry.ts) 的完整目录与模型可见集合需要明确区分。不能直接让全部注册工具都进入请求，也不能让注册与 Schema 加载丢失执行绑定。
- [SessionRuns.refreshTools](../apps/server/src/application/session-runs.ts) 与 [runtime.refreshTools](../packages/agent/src/engine/runtime.ts) 已提供运行中更新、下一次生成生效的接缝。重新收集领域工具之后仍须经过已加载集合过滤，避免一次刷新重新暴露全部 MCP 工具。
- 搜索成功不等于获得执行授权。实际工具调用保留原参数校验、权限/审批、effect 调度与恢复记录；候选目录先应用当前 Session/子代理的可用范围。
- 已加载状态按 Session 隔离。重复搜索保留既有顺序并只追加新工具；并发搜索的集合变更需确定性合并。Server 禁用/断开或 Schema 修订变化时，撤下或替换对应定义。
- 恢复、回退、分叉、压缩及子代理分别定义加载状态的重建规则；优先利用有效历史中的工具声明/加载记录，不复制全局状态。子代理若没有可用的 tool_search，就不能把其必需工具全部隐藏。
- 同批提前调用尚未加载的工具，应返回确定的不可用结果并不执行；加载在下一次模型请求中生效。
- **Schema 延迟发送与 MCP 延迟连接是独立问题。** 首批建议保留当前 MCP 连接/发现方式，在本地持有完整目录，只推迟向模型暴露定义；延迟连接不属于本次已确认要求。
- 首批只延迟 MCP、保留基础文件/命令/控制工具常驻，是讨论中的范围建议，尚未由用户确认。不要把该建议写成已批准限制。
- 改变 tools 集合可能影响不同 Provider 的缓存。功能支持与缓存收益分开验收，不承诺具有服务端原生搜索相同的缓存行为。

可参考 [Neant 的客户端 ToolSearch](/Users/artorias_chan/Workspaces/person/Neant/packages/agent/src/tools/tool-search/tool.ts) 与 [工具集合规划](/Users/artorias_chan/Workspaces/person/Neant/packages/agent/src/tools/tool-search/loadout.ts)。该实现使用 pi-durable 的 `control.addTools`，与 Coko 当前运行时不同；只参考行为与生命周期经验，接线和兼容标志必须按 Coko 实际依赖设计。

### 验收要求：三协议分别提供证据

以下是通用客户端函数基线的后续验收要求，本次仅记录，全部尚未执行。确定性测试使用真实运行时/Sidecar 和可控模型响应或本地协议接收端；真实 Provider 场景另行报告，不能用 faux 通过替代真实模型质量结论。

| 场景 | 每种协议必须观察到的结果 |
| --- | --- |
| 初始请求 | 正式工具定义中有 tool_search 和常驻工具；未加载候选工具的完整 Schema 不提前发送 |
| 搜索执行 | 模型以该协议的标准工具调用发起搜索；Sidecar 实际检索当前作用域目录，返回有依据的候选及加载状态 |
| 加载生效 | 捕获搜索后的下一次实际请求，断言命中工具的完整名称、参数类型/必填约束及正确协议结构确实存在；文本“已加载”不能代替此项 |
| 原工具调用 | 可控模型响应或真实模型调用新加载工具；执行绑定正确，按原参数 Schema 校验，原工具的可观察结果正确 |
| 结果回传 | 搜索调用及后续调用的结果使用各协议正确格式和 ID 配对；下一次请求可继续，不能只断言 UI 文案 |
| 权限与范围 | 搜索不会免掉目标工具审批；拒绝后不产生副作用；受限子代理不能搜索/执行范围外工具 |
| 幂等与并发 | 重复/并发加载不重复定义、不丢已加载工具，最终顺序确定；无命中不虚报已加载 |
| 动态失效 | 禁用、断线、撤销或 Schema 更新后，后续请求和实际执行都不沿用无效绑定；错误有可诊断结果 |
| 历史生命周期 | 恢复、回退、压缩、分叉和子代理按各自有效上下文重建；会话之间不泄漏加载集合 |
| 提醒独立性 | 测试不注入 `<system-reminder>` 时，仍可完成搜索、加载及新工具执行闭环 |

报告按 Chat Completions、Responses API、Anthropic Messages API 分列所测 endpoint/模型、命令、非零测试数、请求断言和结果。缺少凭据或未运行的真实模型路径写为未验证；当前源码已有协议注册或单独搜索算法测试通过均不足以完成验收。

如果选用原生加载路径，额外断言 Responses 的 `execution: "client"`、调用 ID 及 `tool_search_output.tools`，或 Anthropic 的 `tool_reference`、对应 `tools` 定义与展开后的实际调用；不能把普通函数方案的测试直接算作原生适配通过。若采用仅发送命中 Schema 的目标，额外检查请求体未包含其他候选工具；全量 deferred-tools 方案必须明确报告它不满足此项。每条选定路径均需真实跑通“搜索 → 加载 → 原工具调用 → 结果回传”。

另外记录 schema 输入量、实际输入 Token/缓存读取、搜索增加的模型请求数、延迟、命中率与加载后调用成功率。性能指标用于判断收益，不能以 Token 降低抵消工具不可用或参数错误。

## Chengxiaobang 是否借鉴 Claude Code：证据与边界

### 已确认

- 当前 [apps/backend/src/agent/system-prompt.ts](/Users/artorias_chan/Workspaces/agent/chengxiaobang/apps/backend/src/agent/system-prompt.ts) 是中文基础提示，包含提醒解释、权限、计划、记忆和环境；当前时间和 Git 状态仍直接进入 system 文本。
- 当前 [system-reminders.ts](/Users/artorias_chan/Workspaces/agent/chengxiaobang/apps/backend/src/agent/system-reminders.ts) 明确分开场上下文和动态软提醒，注明 SR 不落库、每 Run 重建；[agent-runner.ts](/Users/artorias_chan/Workspaces/agent/chengxiaobang/apps/backend/src/agent/agent-runner.ts) 在 `getSteeringMessages` 中收集并注入 translator 的提醒。
- 1.9.2 提取产物的 [system-prompt.ts](/Users/artorias_chan/Workspaces/agent/chengxiaobang/decompiled/v1.9.2/backend/modules/src/agent/system-prompt.ts) 在第 13、39、221 等附近有明确来源标注：ZCode 原句、CC prompts.ts、CC memoryTypes.ts。不是只凭 `<system-reminder>` 标签相同就推断来源。
- 本次还直接检查了原始 [packaged/backend/main.js](/Users/artorias_chan/Workspaces/agent/chengxiaobang/decompiled/v1.9.2/packaged/backend/main.js)，确认其中存在 `ZCode dynamic-sections.ts`、`最后一句取自 CC prompts.ts`、`Tags alone do not establish authority` 及 `runAgentLoopContinue` 字符串。相关标注不只是重建 Markdown 的解释。
- 1.9.2 的 [session-model-context.ts](/Users/artorias_chan/Workspaces/agent/chengxiaobang/decompiled/v1.9.2/backend/modules/src/agent/session-model-context.ts) 分开 composeSystemPrompt 与 buildLeadingMessages；[system-reminders.ts](/Users/artorias_chan/Workspaces/agent/chengxiaobang/decompiled/v1.9.2/backend/modules/src/agent/system-reminders.ts) 含时间、Git、Memory、Goal、工具目录等提醒；主提示显式排除当前时间和 Git 状态以保持稳定。
- [run-pi-loop.ts](/Users/artorias_chan/Workspaces/agent/chengxiaobang/decompiled/v1.9.2/backend/modules/src/agent/run-pi-loop.ts) 第 745 行附近调用 `runAgentLoopContinue`。当前开发包也声明 pi-agent-core 依赖。

可支持的结论：**部分提示词与提醒机制有明确的 Claude Code / ZCode 借鉴标注，执行内核采用 pi；不足以认定整个应用复制 Claude Code，也未做全代码同源性审计。**

### 最新版本问题未解决

- 本地 `decompiled/` 只有 `v1.6.6`、`v1.7.6`、`v1.8.5`、`v1.9.2`。
- 本次使用 GitHub API 检查当前 origin 对应仓库的 `decompiled` 目录，列表同样最高为 v1.9.2；查询其 Releases 未列出版本。
- 根与桌面 package.json 均为 0.1.14；这是可编辑源码版本，不能解释为官方 1.10，也不能用来否认用户说的 1.10。
- 公开网页搜索未找到可靠的程小帮官方最新发布来源；未验证官方最新版本。
- 对 Downloads/Desktop 的文件名搜索没有完成，已结束该搜索进程；不能声称全机不存在 1.10。
- 已向用户询问 1.10 是另一本地检出还是官方发布，截至生成本文未收到路径/链接。
- 后续优先获取准确路径或发布来源。定位 1.10 后重查其提示词、提醒和装配，再更新设计对照。

反编译材料的格式、来源和能力边界见 [v1.9.2 README](/Users/artorias_chan/Workspaces/agent/chengxiaobang/decompiled/v1.9.2/README.md)。重建 `.ts` 是 bundle 切分后的 JS，不能当作可直接编译的原始 TS；本轮未重新执行提取/AST 验证或产品运行验收。

## 初始 retro 的其他候选项

以下仍是静态风险/改进候选；没有新建问题票或实施。

| 优先级 | 候选 | 入口 |
| --- | --- | --- |
| P1 | 关键上下文/预算检查异常被 guarded 降级放行 | `apps/server/src/application/context/index.ts` |
| P1 | 不响应取消的工具超时后释放执行槽，底层操作可能继续，需结果未知/确认策略 | `packages/agent/src/tools/timeout.ts`、`scheduler.ts` |
| P1 | 只有 3 个 Eval Case，默认 faux 脚本；需真实 Agent 质量基线 | `tests/evals/`、`docs/subsystems/tracing.md` |
| P2 | chars/4、固定 80% 压缩阈值、Memory 按新旧注入；需误差测量和任务相关预算 | `packages/agent/src/context/usage/`、`context/memory/section.ts` |
| P2 | 团队消息队列进程内保存，延迟送达失败只记日志；成果需可验证交回 | `apps/server/src/application/subagents.ts`、`teams.ts` |
| P2 | Goal 完成证据允许无工具引用的文字，引用成功也不等于证明成功条件 | `packages/agent/src/goals/state.ts` 的 `validateEvidence` |
| P1 | 已有检查脚本，但 pre-commit 只 lint-staged；无 CI workflow | 根 package.json、`.husky/pre-commit`、`docs/DEVELOPMENT_WORKFLOW.md` |
| P2 | `.codegraph` 目录存在但无可用 Coko 索引；就绪检测需比存在目录更准确 | 当前 Coko `.codegraph/` |

## 下一会话建议动作

1. 先解决 Chengxiaobang 1.10 的版本来源，避免继续用旧产物代表“最新”。若用户只要求继续 Coko 设计，则把该项显式保留为参考版本限制。
2. 从 Coko 文档入口读有效正文与 ADR，核实当前代码。已有文档是正文来源，本文只保留调研差异与决策候选。
3. 先读 [Tools Search 的官方核实结果](#官方资料核实三种协议均有客户端实现路径)，区分通用函数方案与原生客户端搜索；收敛是否只发送命中 Schema、工具范围、检索接口、加载状态与历史生命周期，再输出规格/方案。核对当前锁定 pi 依赖，再分别验证三个目标 endpoint/模型；Chengxiaobang 1.10 的参考版本缺口不阻塞这项独立讨论。
4. 与用户收敛三类上下文、按请求快照、来源、持久化及验收范围；当前未授权直接修改实现或发布 tracker。
5. 如获准保存正式材料，按文档体系选择归属、模板和必要 ADR，并同步导航；当前交接已保存在主仓库；后续正式规格和决定仍按所属类型独立维护，不以交接快照代替。
6. 实施获得授权后再拆票、改代码及运行相应验证，三协议分别留下实际请求与执行证据。无需重做本轮全部搜索，先使用上面的符号和路径。

## Suggested skills

下一 agent 应按任务调用对应 Skill 工具；若宿主没有 Skill 工具，读取列出的 SKILL.md 并遵循，不要声称调用了不存在的工具。

- `codebase-design`：继续比较接口、模块职责与装配接缝。`/Users/artorias_chan/Workspaces/person/coko/.agents/skills/codebase-design/SKILL.md`
- `writing-for-agents`：起草供后续 agent 消费的规格或交接。`/Users/artorias_chan/Workspaces/person/coko/.agents/skills/writing-for-agents/SKILL.md`
- `coko-docs`：用户批准创建/维护正式项目文档时。`/Users/artorias_chan/Workspaces/person/coko/.agents/skills/coko-docs/SKILL.md`
- `domain-modeling`：需要确定新领域术语或记录 ADR 时。`/Users/artorias_chan/Workspaces/person/coko/.agents/skills/domain-modeling/SKILL.md`
- `to-spec`：用户要求把建议变成规格时显式调用。`/Users/artorias_chan/Workspaces/person/coko/.agents/skills/to-spec/SKILL.md`
- `coko-verify`：获准实施或用户要求验证后选择检查。`/Users/artorias_chan/Workspaces/person/coko/.agents/skills/coko-verify/SKILL.md`
- `openai-docs`：继续研究 Codex 时使用，本任务优先本地源码；公开产品事实需要时再沿官方文档路径确认。`/Users/artorias_chan/.codex/skills/.system/openai-docs/SKILL.md`

## 操作注意

- Coko 项目要求 shell 命令通过 `rtk`；必要时 `rtk proxy <cmd>`。
- Coko 的 CodeGraph 查询已报告无索引，回退 `rg`；不要擅自建索引。Codex/Claude Code/Chengxiaobang 的索引部分查询命中偏题或行号过时，关键证据应对照磁盘源码。
- 不自动复用或派发子代理；用户或适用 skill 明确要求时再使用。此前调研全部由主 agent 完成。
- 不使用 sleep 或固定延时；运行任务通过对应的完成等待工具跟进。
- 用户路径和必要仓库符号保留用于导航；本文不含凭据、密钥或个人联系信息。
