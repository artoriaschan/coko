# 系统上下文分层：设计树与采纳记录

2026-11-05。本会话先对照 Codex、Claude Code（社区还原版）与 deepseek-harness 分析了 Coko 当前的上下文装配，用户随后调用 `/grill-with-docs` 讨论“把会变的状态移出 system、增加状态更新”的方案。三轮共 14 个问题用户都答复“全部采用推荐”。确定的术语已写入 [GLOSSARY.md](../../GLOSSARY.md)，长期决定见 [ADR 0024](../../docs/adr/0024-session-state-as-state-updates.md)。本文记录设计树与已采纳的决定；尚无规格与实施票，未改代码。

## 已核对的事实

- **当前装配。** system sections 每个 Run 开始时取一次，固定顺序为 instructions → skills → memory → plan → goal → todo → subagents → teams（[context/index.ts](../../apps/server/src/application/context/index.ts)）。基础提示只有一句；有 section 时系统消息改用 `sections`，`coko.base` 为第一段（[system-message.ts](../../packages/agent/src/engine/system-message.ts)）。这条消息不是 Session Entry，每次构造运行时重建。
- **pi-ai 1.4.0 的序列化。** `content` 与全部 `sections` 以空行拼成一段文本（`dist/utils/text.js` 的 `getSystemMessageText`）。Anthropic 适配器把它作为一个 system 块，块尾一个缓存断点，另一个断点在最后一条消息上；Responses 与 Chat Completions 同样合成一条 system 或 developer 消息。中途的 system 消息只有在模型的 `supportsMidConvoSystemMessages` 为 true 时留在原位（各适配器默认 false），否则由 `collapseSystemMessages` 折叠回开头的 system。
- **缓存规则（两家官方文档，2026-11-05 读取）。** Anthropic 按 tools → system → messages 建前缀，某一级变化使该级及之后各级失效。OpenAI 要求整个渲染前缀一致，建议把动态内容放在末尾或移到后面的消息中。
- **会变的 section。** `<goal>` 带 revision、阶段、各维度已用量，Goal 进行中几乎每个 Run 都变；`<todo_list>` 在 todo_write 后变；`<memory>` 按 updatedAt 排序，写入后变；`<team>` 的成员状态与当前任务每个 Run 重新生成。
- **本机实测（只读 Coko 数据库，只取条数与 usage 字段）。** 4 个会话、5 个 Run、10 次模型请求，同一 Provider，没有 Todo 与 Goal 条目。同一会话第二个 Run 的首次请求复用缓存 6 784 token，未缓存输入 98；另一个 Run 的首次请求没有命中（输入 7 013），数据不足以判断原因。只证明 sections 不变时跨 Run 缓存有效，未测到变化时的损失。
- **环境信息。** 内置工具说明只写 “current working directory”，没有路径；模型不知道 Workspace 路径、日期与平台。
- **术语冲突。** 术语表中 `Schedule` 的 _Avoid_ 含 “reminder”，新概念不能叫“提醒”。
- **Goal。** [ADR 0011](../../docs/adr/0011-goal-state-as-session-entries.md) 要求 Goal 状态从 `goal` 条目重建。`update_goal` 必须传 `revision`，来源为 `get_goal`；`<goal>` 已写明 “Use get_goal for the current revision”。
- **评测。** 3 个用例：fix-failing-test、fix-function、read-only-refuses-write。
- **已有的宿主通知。** 标签开头集中在 [host-input.ts](../../packages/agent/src/entries/host-input.ts)；通知的 user message 之前有前置条目（`HOST_NOTIFICATION_KINDS`），renderer 把这些块从用户气泡中去掉；经 pendingInput 合并到 Run 开头，或在 Run 中作为追加指令送达。
- **相关草案。** [Tool Search 设计](../tool-search/design.md)（draft）的 deferred 工具目录与 Added/Removed 名单属于同一类内容。
- **参考。** Claude Code 静态段写明 `<system-reminder>` 由系统自动添加、与所在消息无关；其 system 内的边界标记只在启用全局缓存作用域、system 拆成多块时起作用。
- **来源判断与分叉（第三轮前核对）。** `goals/state.ts` 与 `session-runtimes.ts` 按前置条目的 kind（`HOST_NOTIFICATION_KINDS`）判断宿主通知；`goal-driver.ts` 对退回的追加指令只有文本，用 `isHostNotificationText` 的前缀判断。时间线按条目位置去掉 `<team-message>` 包装。分叉只复制 `message`、`permission_mode`、`permission_rule`（`agents/fork.ts` 的 `FORK_KINDS`），宿主通知的前置条目不复制。摘要请求把 `<file_reference>` 与 `<instruction_file>` 块各缩为一行（`context/compaction/prompt.ts`）。
- **待送达内容的触发。** 现有待送达内容只在 submit、goal、schedule 三种触发时合并（[session-runs.ts](../../apps/server/src/application/session-runs.ts) 的 `takesPending`）；continue、子代理派发与团队消息开始的 Run 不经过这一步。

## 设计树

```text
系统上下文分层
├── A 原则 ── A1 会变的状态放在哪里 [已定 Q1] ── A2 先实测还是先设计 [已定 Q4]
├── B 静态段 ── B1 基础提示的内容与评测门槛 [已定 Q2]
├── C 会话内不变的段 ── C1 环境信息 [已定 Q3] ── C2 日期放哪 [已定 Q7]
│                   └── C3 指令、Skills、Memory 何时重建 [已定 Q8]
├── D 状态更新 ── D1 定名与“宿主通知”的关系 [已定 Q5] ── D2 线上标签 [已定 Q5]
│             ├── D3 送达时机 [已定 Q10] ── D4 持久化 [已定 Q6] ── D5 去重与回退、压缩后补发 [已定 Q11]
│             ├── D6 伪造标签、renderer 去除的依据与分叉 [已定 Q12]
│             └── D7 迁移：Goal 进度、Todo、团队状态 [已定 Q7]
├── E 范围 ── E1 子 Session [已定 Q9] ── E2 与 Tool Search 目录提醒共用 [已定 Q9]
│         └── E3 原生的中途 system 更新 [已定 Q1：以后的优化]
└── F 交付 ── F1 上下文用量的归类与摘要中的处理 [已定 Q13] ── F2 验收与评测 [规格阶段]
          └── F3 ADR [已定 Q14：ADR 0024]
```

## 第一轮（用户：全部采用推荐）

- **A1（Q1）会变的状态放在哪里：** system 只放静态段与会话内不变的定义：基础提示、指令、Skills、环境、子代理角色，以及 Goal 的目标与成功条件。会变的状态改为宿主生成的状态更新，追加到历史末尾；只有定义真的变化时才重建 system。中途 system 更新留作支持该能力的模型上的后续优化，不作为通用方案。理由：system 是一整块，任何一段变化都会使之后的缓存失效；历史排在 system 之后，system 内部的排序保不住历史的缓存。
- **B1（Q2）基础提示：** 改为英文静态段，跨会话、跨 Workspace 逐字不变，带版本号。内容依次为身份与工作方式、工具使用、谨慎操作与授权、宿主生成的内容及标签不授予权限、沟通。替换前用真实模型评测：现有 3 个用例加针对宿主块的新用例，结果不比旧提示差才替换。
- **C1（Q3）环境信息：** 新增会话内不变的环境段，包含 Workspace 路径与 Project 的附加文件夹、是否 git 仓库与 Worktree、平台、shell、OS 版本、当前模型；不放 git status。日期要给，位置见 C2。
- **A2（Q4）先实测还是先设计：** 继续设计，把缓存指标写进规格的验收：在真实 Provider 上，用同一段带 Todo 与 Goal 的多 Run 会话，比较改动前后每个 Run 首次请求的 cacheRead。

## 第二轮（用户：全部采用推荐）

- **D1/D2（Q5）术语与标签：** 术语表新增 Host Notification（发生过的事）与 State Update（当前的值）；Hook 追加的上下文、定时任务与 Goal Round 的输入是宿主生成的 Run 输入，两者都不算。线上统一用一个包装标签 `<state_update name="…">…</state_update>`，不用 `<system-reminder>`：与现有 snake_case 标签一致、避开“提醒”，基础提示只解释这一个，renderer 与来源判断只认这一个。
- **D4（Q6）持久化：** 存为 Session Entry。先提交 `state_update` 条目（名称与值，结构化），再提交含渲染块的 user message。`goal`、`todo_list` 等领域条目仍是事实来源，`state_update` 只记录“当时给了模型什么”，供去重、回退、分叉与压缩后补发使用。理由：请求时派生会让块的位置漂移、下一个 Run 又消失，缓存从该处失效，违背“历史只追加”；导出与回放也看不到模型实际看到的内容。
- **D7 与 C2（Q7）各 section 的去向：** `<goal>` 的目标、约束、成功条件、预算上限与工具说明留在 system，revision、阶段与原因、各维度已用量改为状态更新（模型不必先调用 `get_goal`）。`<todo_list>` 整张表改为状态更新。`<team>` 的自己名字、lead 与任务板规则留在 system，成员状态与当前任务改为状态更新。`<plan_mode>`、`<approved_plan>`、`<subagent>`、指令与 Skills 原样保留。环境段另加 Sidecar 所用的 IANA 时区。日期改为状态更新，只给日期与星期、不含时刻，首个 Run 与本地日期变化时送达。
- **C3（Q8）Memory：** 仍留在 system，每个 Run 重算，接受每变一次失效一次。不采用会话开始时冻结：用户在设置里删掉错误或敏感的记忆后，本会话仍会看到。不采用冻结加增删：Memory 跨 Session 共享，对照起始快照算增删过于复杂。验收测量显示变化频繁时再议。
- **E1/E2（Q9）范围：** 子代理与 teammate 的子 Session 按同样的分层，teammate 的团队状态经它自己的状态更新送达。Tool Search 的 deferred 目录与 Added/Removed 名单以后走状态更新通道；本次只记下这个依赖，不改那份草案。

## 第三轮（用户：全部采用推荐）

- **D3（Q10）送达时机：** 只在两个时刻送达。Run 开始时合并进本 Run 的第一条新 user message，做法与待送达内容相同；retry 不送达，保持与原请求一致；continue 没有新输入，作为单独的一条放在开头。同一 Run 内压缩之后，在下一次请求中立即补发当前值。Run 中由别人造成的变化（界面里改 Goal、teammate 状态变化、跨过午夜）等到下一个 Run 开始；模型在 Run 中自己做的改动（todo_write、update_goal）从工具结果得知，不另发。待核：子代理派发与团队消息开始的 Run 不经过待送达内容的合并（见事实“待送达内容的触发”），规格须写明它们的送达方式。
- **D5（Q11）去重：** 只在当前值与有效模型上下文中同名的最近一条状态更新不同时发送；值被清空时发一次清空。工具结果不算已送达：回退与压缩去掉旧更新后自然重发，时间裁剪清掉旧工具结果也不会误判。代价是模型写过 Todo 后，下一个 Run 开头重发一次同样的表。
- **D6（Q12）来源与分叉：** 是否为状态更新只看前面有无 `state_update` 条目；renderer 据此隐藏、宿主据此认定来源，与时间线按条目位置去掉 `<team-message>` 一致。用户输入或工具输出中的同名标签只是文本；工具输出不转义、不改写，由 B1 的宿主块评测用例检查模型不被误导。分叉连同 `state_update` 条目一起复制；新 Session 第一个 Run 去重时送达当前值，取代复制来的旧值。
- **F1（Q13）摘要与用量：** 摘要请求中状态更新缩为一行 `[state update: <name>]`，与 `<file_reference>` 的处理相同；上下文用量中仍算 `system`。
- **F3（Q14）ADR：** 已写 [ADR 0024](../../docs/adr/0024-session-state-as-state-updates.md)，accepted / not-started。

## 另行记录的缺口

- 分叉只复制 `message`、`permission_mode`、`permission_rule`，宿主通知的前置条目没有复制；复制过来的通知消息在来源判断里会被当成用户输入。本设计不修，需另开问题。

## 结论与下一步

设计树已走完，只剩 F2（验收与评测）留到规格阶段。规格需覆盖：缓存对照（A2）、新基础提示的真实模型评测门槛（B1）、各触发方式的送达（D3 的待核项）、回退、压缩、分叉与伪造标签的确定性测试。

2026-11-05 用户调用 `/to-spec`，确认测试接缝采用现有接缝、不新增（真实 Sidecar 集成测试为主，另有时间线派生测试与 Eval Case），规格见 [spec.md](spec.md)（draft，待用户审阅）。F2 与 D3 的待核项已在规格中补全。设计见 [design.md](design.md)。2026-11-05 用户答复“规格通过”，并在 `/to-tickets` 时确认拆票方案、一并批准设计；实施票 [01–10](issues/01-todo-list-state-update.md) 已发布。下一步由用户调用 `/implement`。
