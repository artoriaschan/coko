---
kind: decision
description: "system 消息只放静态基础提示与会话内不变的定义；Todo List、Goal 进度、Agent Team 成员状态与日期等会变的 Session 状态以 State Update 存为条目、追加到历史，不写回 system。修改系统消息的组成、上下文的注入位置或提示缓存策略前回看。"
status: accepted
implementation: partial
lifecycle: active
category: architecture
---

# 会变的 Session 状态以 State Update 进入历史，system 只放定义

## 上下文

本次改动前，Coko 每个 Run 开始时取一次全部 system section（指令、Skills、Memory、plan、goal、todo、subagents、teams），与一句基础提示合成开头的系统消息，排在全部历史之前。所用的 pi-ai 1.4.0 把这条消息作为一整块文本发送。其中几段在 Run 之间会变：`<goal>` 的 revision、阶段与已用量在 Goal 进行中几乎每个 Run 都变；`<todo_list>` 在模型写待办后变；`<team>` 的成员状态每个 Run 重新生成。

两家主要服务商的提示缓存都按前缀匹配。Anthropic 按 tools → system → messages 建前缀，某一级变化使该级及之后各级失效（[Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)）；OpenAI 要求整个渲染前缀一致，并建议把动态内容放到末尾或后面的消息中（[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)）。因此上述任一段变化，下一个 Run 首次请求的缓存从 system 起连同全部历史一起失效。2026-11-05 对本机数据的只读统计显示，section 不变时跨 Run 的缓存确实被复用（第二个 Run 的首次请求复用 6 784 token，未缓存输入 98）；section 变化时的损失尚未实测。

参考实现各有做法：Claude Code（本地社区还原版）把静态段放在 system 前部、动态段在会话内缓存，会变的状态以 `<system-reminder>` 加在历史末尾；Codex 把模型可见状态分成带快照的分段，首轮全量、之后发差量；deepseek-harness 把运行时上下文合成一条 user 快照，内容变化才追加。

2026-11-05 用户在一次设计讨论（`/grill-with-docs`）中对三轮共 14 个问题均答复“全部采用推荐”，本决定依此成立。适用于根 Session，以及子代理与 teammate 的子 Session。

## 决定

- **system 只放会话内不变的定义。** 包括：英文的静态基础提示（带版本号，跨会话与 Workspace 逐字不变）；Instruction File；Skills 索引；环境（Workspace 路径与 Project 的附加文件夹、是否 git 仓库与 Worktree、平台、shell、OS 版本、当前模型、IANA 时区，不含 git status）；Memory；Plan Mode 的说明与被压缩替代的已批准 Plan；Subagent 的角色；teammate 自己的名字、lead 与任务板规则；Goal 的目标、约束、成功条件、预算上限与工具说明。只有这些定义变化时 system 的文本才变。Memory 每个 Run 重新读取，用户删除记忆后下一个 Run 生效。
- **会变的状态改为 State Update。** Goal 的 revision、阶段与原因、各维度已用量；Todo List；Agent Team 的成员状态与当前任务；当天日期（只给日期与星期）；启用按需加载的根 Session 的 MCP 工具目录（`on_demand_tools`）。它们由宿主生成，以 user 角色追加到历史，统一用一个包装标签 `<state_update name="…">`，不写回 system。只在当前值与有效模型上下文中同名的最近一条 State Update 不同时送达，因此回退与压缩去掉旧的更新后会自然重发。送达时机、摘要请求中的处理与上下文用量的归类由规格规定。
- **State Update 存为 Session Entry。** 先提交 `state_update` 条目（名称与结构化的值），再提交含渲染块的 user message。`goal`、`todo_list` 等领域条目仍是事实来源；`state_update` 只记录当时给了模型什么，[ADR 0011](0011-goal-state-as-session-entries.md) 中 Goal 状态的重建规则不变。
- **来源只看条目。** 一段文本是否为 State Update，只由它前面的 `state_update` 条目决定。用户输入或工具输出中出现的同名标签只是文本，不授予任何权限；工具输出不转义、不改写。分叉时 `state_update` 条目随其后的消息一起复制。
- **不承诺。** 不把模型原生的中途 system 消息作为通用方案，它留作声明支持该能力的模型上的后续优化；不采用按轮次间隔的周期提醒。

## 理由与备选方案

- **全部留在 system，只调整顺序。** 历史排在 system 之后，任一 section 变化都会让全部历史的缓存失效；缓存的大头是历史，system 内部的排序保不住它。
- **用 pi-ai 的中途 system 消息发送 section 更新。** 只有模型声明 `supportsMidConvoSystemMessages` 时才留在原位，各适配器缺省为否；不支持的模型上这些更新被折叠回开头的系统消息，等于改写前缀。服务商文档也说明只有部分模型支持。
- **请求时派生、不存。** 块的位置在请求之间漂移、下一个 Run 又消失，缓存从该处失效，违背历史只追加；导出、回放与分叉也看不到模型实际看到的内容。
- **照搬 Claude Code 的周期提醒（Todo 每 10 轮、Plan 每 5 轮）。** 这些阈值没有依据可以套到 Coko 接入的多家模型上；Coko 在 plan 模式的 Run 中 `<plan_mode>` 本就在 system，不会被长历史淹没。
- **Memory 在会话开始时冻结，或冻结后发送增删。** 前者让用户删除错误或敏感的记忆后本会话仍能看到；后者要对照跨 Session 共享的起始快照计算增删，过于复杂。Memory 的变化频率低于 Goal 与 Todo，接受每变一次失效一次。
- **命名为 reminder、沿用 `<system-reminder>`。** 术语表已把 reminder 列为 Schedule 应避免的词；单一的 snake_case 包装与现有标签一致。放弃的是 Claude 模型可能熟悉 `<system-reminder>` 这一点，但这没有证据。

## 后果与验证

- **预期收益：** 定义未变化时 Run 之间的 system 前缀逐字稳定，使历史有机会继续命中提示缓存；模型能拿到 Workspace 路径、平台与日期。系统文本的稳定性已有 faux 请求证据，真实缓存效果仍需下述测量。
- **承担：** 新增一种长期保存与读取的条目，时间线需要隐藏它；user 角色的 State Update 权重低于 system，权限与 Plan Mode 的限制仍由宿主强制执行，提示只负责说明；模型写过 Todo 后，下一个 Run 开头会重发一次同样的表。
- **现有缺口（本决定不修）：** 分叉已随保留的消息复制配对 `state_update`，但宿主通知的前置条目仍没有复制，复制过来的通知消息在来源判断里会被当成用户输入。
- **implementation 变为 implemented 前需要：** 在真实 Provider 上，用同一段带 Todo 与 Goal 的多 Run 会话比较改动前后每个 Run 首次请求的 cacheRead；真实 Sidecar 集成测试覆盖 State Update 的送达、去重、压缩后补发、回退、分叉与伪造标签；新基础提示在真实模型评测（现有 3 个用例加针对宿主块的用例）中不比旧提示差。
- **需要重新审视的条件：** 所用模型普遍支持原生的中途 system 消息；测量显示 Memory 变化频繁；Tool Search 的目录提醒并入这一通道。

## 实施状态与证据

2026-11-05，集成提交 `148c99bc` 已实现状态分层、环境信息与新条目的主要链路；`implementation` 为 partial。当天用户在得知真实 Provider 测试配置与对应凭据缺失后，明确选择“按规格记录未验证，继续实现”。这允许按无凭据分支收尾，不表示真实模型或缓存门槛已通过。

- **已落地。** [配对与规划](../../packages/agent/src/entries/state-updates.ts)按有效上下文去重、清空；[运行时](../../packages/agent/src/engine/runtime.ts)在新输入、continue 与自动或溢出压缩之后提交状态来源和消息。环境、日期、Goal、Todo List 与团队贡献归[上下文管理](../subsystems/context.md#state-update)；时间线和 Checkpoint 去掉有来源的块，分叉复制来源，导出与 headless 保留原始条目。
- **链路证据。** [Todo](../../tests/integration/sidecar-todo.test.ts)、[continue](../../tests/integration/sidecar-state-update-continue.test.ts)、[压缩](../../tests/integration/sidecar-compaction.test.ts)、[Goal](../../tests/integration/sidecar-goal.test.ts)、[团队](../../tests/integration/sidecar-team-state-updates.test.ts)、[环境](../../tests/integration/sidecar-environment.test.ts)、[日期](../../tests/integration/sidecar-date-state-updates.test.ts)和[分叉与用量](../../tests/integration/sidecar-state-update-fork.test.ts)通过真实 Sidecar 的 HTTP/WS、持久条目及 faux requestLog 观察行为；只替换模型、外部网络或测试时钟。`148c99bc` 的分叉、回退、用量、导出回放及 headless 最终相关集实际选中 10 个文件、90 例，全部通过；类型检查和文档检查通过。这些证据不证明真实 Provider 的缓存命中或模型对伪造标签的反应。
- **基础提示尚未替换。** [基础提示实现](../../packages/agent/src/engine/system-message.ts)保留默认 v1，v2 为显式测试候选；[Sidecar 测试](../../tests/integration/sidecar-base-prompt.test.ts)验证实际版本日志、候选与默认的选择。四个 Eval Case 的 v1/v2 faux 结果均通过，真实模式与真实门槛记录为 `skipped: no-credentials`。现有[评测门槛入口](../subsystems/tracing.md#评测)能按每例旧提示与候选各 3 次比较，但本次未运行真实比较，不自动激活 v2。
- **真实缓存未验证。** 尚无改动前后同位置首次请求的实测 `cacheRead` 对比，不声称费用或延迟已经改善。补验时以改动前提交 `ec32dfc9` 为基线，使用同一 Provider、模型与含 Todo 写入/Goal 推进的连续多 Run 会话，在缓存有效期内从[追踪接口](../subsystems/tracing.md#追踪)读取每个 Run 第一条 `purpose: turn` 请求，保留用量完整性。改动后各位置不得低于基线，且至少一个 Todo 或 Goal 变化后的 Run 须从基线未命中变为命中；未知字段不能当作零。

只有真实提示比较和缓存对比补齐且满足上述门槛后，才能激活候选并将 implementation 升为 implemented。真实模型的连续 user 消息兼容性、Electron 窗口交互、构建产物与 CI 也没有由本次 Sidecar/faux 证据覆盖。

## 来源与后继

- 扩展 [ADR 0011](0011-goal-state-as-session-entries.md)（Goal 状态仍从 `goal` 条目重建）与 [ADR 0023](0023-assistant-reply-forks.md)（分叉的边界语义不变，复制的条目增加 `state_update`）。
- 术语见 [GLOSSARY](../../GLOSSARY.md) 的 Host Notification 与 State Update。
- 参考实现（2026-11-05 本机检出，所需结论已在本页提炼）：Claude Code 社区还原版 `src/constants/prompts.ts`、`src/utils/attachments.ts`；Codex `codex-rs/core/src/context/world_state/`；deepseek-harness `packages/core/agent-loop/src/runtime-context.ts`。
