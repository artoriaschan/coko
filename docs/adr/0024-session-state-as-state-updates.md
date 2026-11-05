---
kind: decision
description: "system 消息只放静态基础提示与会话内不变的定义；Todo List、Goal 进度、Agent Team 成员状态与日期等会变的 Session 状态以 State Update 存为条目、追加到历史，不写回 system。修改系统消息的组成、上下文的注入位置或提示缓存策略前回看。"
status: accepted
implementation: not-started
lifecycle: active
category: architecture
---

# 会变的 Session 状态以 State Update 进入历史，system 只放定义

## 上下文

Coko 每个 Run 开始时取一次全部 system section（指令、Skills、Memory、plan、goal、todo、subagents、teams），与一句基础提示合成开头的系统消息，排在全部历史之前。所用的 pi-ai 1.4.0 把这条消息作为一整块文本发送。其中几段在 Run 之间会变：`<goal>` 的 revision、阶段与已用量在 Goal 进行中几乎每个 Run 都变；`<todo_list>` 在模型写待办后变；`<team>` 的成员状态每个 Run 重新生成。

两家主要服务商的提示缓存都按前缀匹配。Anthropic 按 tools → system → messages 建前缀，某一级变化使该级及之后各级失效（[Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)）；OpenAI 要求整个渲染前缀一致，并建议把动态内容放到末尾或后面的消息中（[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)）。因此上述任一段变化，下一个 Run 首次请求的缓存从 system 起连同全部历史一起失效。2026-11-05 对本机数据的只读统计显示，section 不变时跨 Run 的缓存确实被复用（第二个 Run 的首次请求复用 6 784 token，未缓存输入 98）；section 变化时的损失尚未实测。

参考实现各有做法：Claude Code（本地社区还原版）把静态段放在 system 前部、动态段在会话内缓存，会变的状态以 `<system-reminder>` 加在历史末尾；Codex 把模型可见状态分成带快照的分段，首轮全量、之后发差量；deepseek-harness 把运行时上下文合成一条 user 快照，内容变化才追加。

2026-11-05 用户在一次设计讨论（`/grill-with-docs`）中对三轮共 14 个问题均答复“全部采用推荐”，本决定依此成立。适用于根 Session，以及子代理与 teammate 的子 Session。

## 决定

- **system 只放会话内不变的定义。** 包括：英文的静态基础提示（带版本号，跨会话与 Workspace 逐字不变）；Instruction File；Skills 索引；环境（Workspace 路径与 Project 的附加文件夹、是否 git 仓库与 Worktree、平台、shell、OS 版本、当前模型、IANA 时区，不含 git status）；Memory；Plan Mode 的说明与被压缩替代的已批准 Plan；Subagent 的角色；teammate 自己的名字、lead 与任务板规则；Goal 的目标、约束、成功条件、预算上限与工具说明。只有这些定义变化时 system 的文本才变。Memory 每个 Run 重新读取，用户删除记忆后下一个 Run 生效。
- **会变的状态改为 State Update。** Goal 的 revision、阶段与原因、各维度已用量；Todo List；Agent Team 的成员状态与当前任务；当天日期（只给日期与星期）。它们由宿主生成，以 user 角色追加到历史，统一用一个包装标签 `<state_update name="…">`，不写回 system。只在当前值与有效模型上下文中同名的最近一条 State Update 不同时送达，因此回退与压缩去掉旧的更新后会自然重发。送达时机、摘要请求中的处理与上下文用量的归类由规格规定。
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

- **获得：** Run 之间 system 前缀逐字稳定，历史的缓存只在定义变化、压缩或换模型时失效；模型能拿到 Workspace 路径、平台与日期。
- **承担：** 新增一种长期保存与读取的条目，时间线需要隐藏它；user 角色的 State Update 权重低于 system，权限与 Plan Mode 的限制仍由宿主强制执行，提示只负责说明；模型写过 Todo 后，下一个 Run 开头会重发一次同样的表。
- **现有缺口（本决定不修）：** 分叉只复制 `message`、`permission_mode` 与 `permission_rule`，宿主通知的前置条目没有复制，复制过来的通知消息在来源判断里会被当成用户输入。
- **implementation 变为 implemented 前需要：** 在真实 Provider 上，用同一段带 Todo 与 Goal 的多 Run 会话比较改动前后每个 Run 首次请求的 cacheRead；真实 Sidecar 集成测试覆盖 State Update 的送达、去重、压缩后补发、回退、分叉与伪造标签；新基础提示在真实模型评测（现有 3 个用例加针对宿主块的用例）中不比旧提示差。
- **需要重新审视的条件：** 所用模型普遍支持原生的中途 system 消息；测量显示 Memory 变化频繁；Tool Search 的目录提醒并入这一通道。

## 来源与后继

- 扩展 [ADR 0011](0011-goal-state-as-session-entries.md)（Goal 状态仍从 `goal` 条目重建）与 [ADR 0023](0023-assistant-reply-forks.md)（分叉的边界语义不变，复制的条目增加 `state_update`）。
- 术语见 [GLOSSARY](../../GLOSSARY.md) 的 Host Notification 与 State Update。
- 参考实现（2026-11-05 本机检出，所需结论已在本页提炼）：Claude Code 社区还原版 `src/constants/prompts.ts`、`src/utils/attachments.ts`；Codex `codex-rs/core/src/context/world_state/`；deepseek-harness `packages/core/agent-loop/src/runtime-context.ts`。
