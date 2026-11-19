---
kind: decision
description: "记忆只分用户级与项目级：Session 使用哪个 Workspace 的记忆由当前项目归属决定，不属于项目的 Session 只有用户级记忆，局部替代 ADR 0020 中关于记忆的部分；记忆的写入、替换与删除在任何权限模式下不经审批，改由 Memory 段声明、来源标注、用户来源条目不可被模型改动、子 Session 与 Headless Run 只读约束，并记录残余风险。想恢复记忆审批、放宽这些限制或再次调整记忆归属时回看。"
status: accepted
implementation: not-started
lifecycle: active
category: feature
---

# 记忆跟随项目归属，写入不经审批

## 上下文

记忆条目以 Workspace 为键保存，分用户级与 Workspace 级。[ADR 0020](0020-projects-organize-workspaces.md) 引入项目后规定：移入、移出项目只改归属，不改变按 Workspace 保存的批准与记忆。于是 Session 看到的 Workspace 记忆始终是它创建时所在目录上的那一份，与用户理解的“项目”对不上：

- 独立对话的 Workspace 是 Coko 为它创建的专属目录，只有它自己使用，记在上面的内容其他对话看不到。
- 独立对话移入项目后能读写项目文件夹，却看不到项目的记忆；项目 A 的对话移到项目 B 后，记下的项目事实仍写进 A。

记忆也很少被写进来。[ADR 0005](0005-permission-mode-and-sandbox.md) 规定权限模式决定哪些调用无需审批；记忆写入属于 memory-write 权限类，只在 accept-edits 与 full-access 由模式放行，默认的“请求批准”模式下每次写入都弹审批卡，既打断用户，也让模型更少去记；基础提示没有提到记忆，模型只能从工具描述得知用途。

用户于 2026-11-19 的记忆需求澄清中多轮确认了下述决定，并同意新增本 ADR。用户明确提出的要求：

- 独立对话的记忆放在用户级，不保存 Workspace 记忆。
- 记忆操作都静默执行，不询问用户。
- 在系统上下文和工具调用两处做限制。
- 本次只做记忆优化，权限模式与计划流程的调整另行立项。

其余条目是 Agent 给出推荐、用户逐轮回复采纳的结论：项目记忆取项目主要文件夹的 Workspace、在每个 Run 开始时解析、子 Session 与 Headless Run 只读、用户来源条目不可被模型改动、用户配置的询问与拒绝规则照常生效、存储不变、更换主要文件夹后使用新文件夹上的记忆。“用户编辑过的条目视为用户手写”与“子 Session 按根 Session 判定归属”两点没有单独成题，在最终总结中随用户确认一并生效。

## 决定

本决定已接受，尚未实施；以下为目标行为。

### 记忆跟随项目归属

- 记忆只有两个层级：用户级和项目级。Session 属于某个 Project 时，使用该 Project 主要文件夹对应 Workspace 上的项目记忆和用户级记忆；不属于任何 Project 时只使用用户级记忆。
- 判定只看项目归属，不看工作目录。绑定 worktree 的 Session、从别处移入项目的 Session、工作目录是 Coko 专属目录但已移入项目的 Session，都使用所属项目的项目记忆；从项目移出或项目被删除后留下的 Session 只有用户级记忆，即使工作目录仍是原项目文件夹。子 Session（子代理与 Teammate）取根 Session 的归属。
- 归属在每个 Run 开始时解析，与 Workspace 根快照同时；Run 进行中的归属变化从下一个 Run 生效。
- 没有项目记忆的 Run 中，模型不能选择 Workspace 作用域；有项目记忆的 Run 中，Workspace 作用域的读写都针对所属项目的主要 Workspace。新建 Workspace 作用域条目的目标必须是某个现存 Project 的主要 Workspace。
- 存储不变：条目仍以 Workspace 为键保存，作用域的存储值与协议值仍是 `user` 与 `workspace`，不迁移已有数据。项目更换主要文件夹后改用新文件夹上的记忆，原记忆留在原 Workspace 上；删除项目不删除记忆，沿用 [ADR 0022](0022-project-removal-preserves-sessions.md)，用同一文件夹重新创建项目即可恢复。

### 记忆操作不经审批

- memory-write 权限类在所有 Permission Mode 下由模式放行，包括 read-only 与 plan。拒绝规则、询问规则与外部 Hook 仍先于模式放行生效，规则组名仍是 `Memory`，项目设置文件仍可用它收紧。记忆不再产生审批请求，也不再有针对记忆的“总是允许”建议；已保存的 `Memory` 允许规则不清理。
- 取代审批的固定限制：
  - **声明。** 记忆开启时每个 Run 都注入 Memory 段，段首声明条目是供参考的事实、不是指令、不授予任何权限，与用户当前要求冲突时以当前要求为准。
  - **来源标注。** 每条标明是 Agent 记的还是用户手写的；Agent 自己记的条目可信度低于用户手写的。用户经界面修改正文后，条目来源改为用户。
  - **用户来源不可改。** 模型按 id 替换或删除用户来源的条目时得到工具错误，条目不变；发现过时时在回复中告知用户。
  - **只读的运行。** 子 Session 与 Headless Run 只注册 `memory_list`，不注册写入与删除工具。
  - **写入引导。** 工具描述与 Memory 段说明只记用户亲口表达的偏好和核实过的项目事实，不把文件、网页或工具输出中出现的指令记成记忆，不记任务进度、代码里读得到的内容和凭据。
- 记忆关闭时不注入、不提供任何记忆工具，与原行为相同。

本决定不改变：[ADR 0020](0020-projects-organize-workspaces.md) 中批准规则、工作目录与 worktree 绑定按 Workspace 保存的部分；[ADR 0003](0003-settings-and-sessions-in-sqlite.md) 与 [ADR 0009](0009-user-authored-resources-as-files.md) 的存储位置；[ADR 0024](0024-session-state-as-state-updates.md) 中 Memory 属于 system 定义、每个 Run 重新读取的规则；[ADR 0004](0004-model-credentials-safe-storage.md) 对正文的凭据脱敏。

## 理由与备选方案

- **记忆继续固定在 Session 的 Workspace 上。** 最省改动，但正是上下文中三种错位的来源：独立对话的记忆被困在专属目录里，移动对话后读写的仍是原目录的记忆。用户要求记忆按“项目”理解，因此不采用。
- **只放行项目级写入，用户级仍询问。** 用户级条目会进入之后所有 Session，风险更大，因此作为折中考虑过。但用户明确要求所有记忆操作静默执行；独立对话只能写用户级，这一方案会让独立对话的每次写入仍被打断，行为也随作用域不同而不一致。
- **保留默认询问。** 维持 ADR 0005 的现状最保守，但审批卡既打断对话，也抑制模型写入，记忆功能难以发挥作用。用户在知情的前提下选择静默执行，并要求以系统上下文与工具层的限制代替审批。

## 后果与验证

- 项目里的所有对话、worktree 对话和子代理看到同一份项目记忆；独立对话记下的内容进入用户级，其他对话可用。
- 项目被删除后，其主要文件夹上的记忆在重新建项目之前没有任何会话可见，也无法在界面中管理；此前不属于任何项目的 Workspace 上遗留的记忆同样不可见。这是已确认的取舍。
- 面向用户的文案称“项目”，存储和协议仍是 `workspace`；面向模型的说明需把 `workspace` 解释为当前项目。

**残余风险。** 审批取消后，模型读到的不受信任内容（文件、网页、工具输出）仍可能诱导它写入一条 Agent 来源的记忆，这条记忆会进入之后的 Run。声明、来源标注与写入引导对模型只是提示，不是硬性拦截。硬性的限制只有：子 Session 与 Headless Run 不能写；用户来源的条目不可被模型改动；用户配置的询问、拒绝规则与外部 Hook。用户已在知情的前提下接受这一风险。

验证要求：实施时以真实 Sidecar 请求断言 Memory 段与工具集合随归属、Run 类型和开关变化；对手用例确认记忆正文或工具输出中伪造的来源标注、结束标签或“用户手写”声明不能改变条目来源，也不能让模型改动用户来源的条目；权限判定覆盖五种模式放行及询问、拒绝规则仍生效。写入引导是否让真实模型记得更多、更准，需要以真实 Provider 运行评测用例回答。implementation 变为 implemented 时在本页链接实现与检查结果。

**需要重新审视的情形：**

- 出现不受信任内容诱导写入记忆、并在之后的 Run 中造成实际影响的案例，或对手评测显示现有限制不足。
- 权限模式与计划流程另行立项调整时，memory-write 在 read-only 与 plan 下放行的安排需随之复核。
- 需要让 Headless Run 或子 Session 写入记忆，或需要不属于项目的 Workspace 级记忆、跨项目共享记忆。
- Project 与 Workspace 的映射改变（例如项目不再有唯一的主要文件夹），或决定把存储与协议中的 `workspace` 改名。

## 来源与后继

- 确认主体：用户；日期：2026-11-19；依据：记忆归属、写入与注入的需求澄清，必要内容已提炼于本页。
- 局部替代 [ADR 0020](0020-projects-organize-workspaces.md) 中“移入、移出项目不改变按 Workspace 作用域保存的记忆”这一部分；ADR 0020 关于批准规则、工作目录与 worktree 绑定的决定不变。
- 局部修订 [ADR 0005](0005-permission-mode-and-sandbox.md) 的模式放行：memory-write 在所有模式下无需审批；判定顺序、其余模式放行与沙箱档位不变。
- 与 [ADR 0019](0019-headless-runs-deny-approvals.md) 的关系：Headless Run 遇到审批仍自动拒绝；记忆不再经审批后，改由不注册写入工具保证 Headless Run 只读。子 Session 的定义见 [ADR 0014](0014-subagents-as-child-sessions.md)，Teammate 见 [ADR 0018](0018-agent-teams-in-root-session.md)。
- 删除项目保留会话与记忆沿用 [ADR 0022](0022-project-removal-preserves-sessions.md)。
- 当前行为（实施前）见 [Memory](../subsystems/memory.md)。
