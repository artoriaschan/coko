# 计划从权限模式剥离并延伸到结果反馈：规格

Status: ready-for-agent
Spec status: approved（2026-11-20 拆票时向用户说明“启动 `/to-tickets` 视为规格通过，含测试接缝与 Further Notes 的补充决定”，用户答复“确认”）
讨论：[grilling.md](grilling.md) · 设计：[design.md](design.md) · 实施票：[01–12](issues/01-design-and-adr.md) · 现状：[Plan Mode](../../docs/subsystems/plan-mode.md) · 相关决定：[ADR 0028](../../docs/adr/0028-plan-phase-not-permission-mode.md)、[ADR 0005](../../docs/adr/0005-permission-mode-and-sandbox.md)、[ADR 0024](../../docs/adr/0024-session-state-as-state-updates.md) · 术语：[GLOSSARY](../../GLOSSARY.md)

## Problem Statement

用户进入 Plan Mode 是想让 Agent 先调研、给出方案，自己看过再动手。现在这件事被做成了第五种 Permission Mode，带来四类问题：

- **规划会顶掉用户选的权限。** 在“完全访问权限”下进入规划，每条命令、每个 MCP 调用都变成要用户批准；模式菜单三项都不勾选，Shift+Tab 会直接把用户踢出规划并落到只读；批准计划时只能回到进入前的模式或更窄的模式。
- **“不改 Workspace”并不成立。** 规划期间文件写入只是弹审批，用户点了就真的写入；命令被沙箱拒绝后还可以申请单次提权，批准后同样能写。约束靠的是用户每次都不点。
- **计划在批准那一刻就结束了。** 之后没有任务拆解，没有“还在执行”的状态，没有对照计划的汇报。执行到一半 Run 结束，下一个 Run 的模型并不知道有一份没做完的计划；用户也看不出这份计划做完了没有。
- **审阅时改不了权限。** 审阅卡接管输入区后模式菜单不可用，而批准后同一个 Run 立刻继续执行。

## Solution

Plan Mode 改为 Session 的规划阶段，与 Permission Mode 互相独立；Plan 的生命周期延伸到结果反馈。

- **规划中：** 用户输入 `/plan` 进入。Permission Mode 保持不变，读取、命令、MCP 是否询问照旧按它判定。Coko 自己施加两条约束：文件写入一律直接拒绝，命令在只读沙箱里运行且不能提权。Agent 用 `exit_plan_mode` 提交 Plan，用户在审阅卡上看计划、必要时编辑、调整执行权限，然后批准或带反馈让它继续规划。
- **执行中：** 批准后 Plan 进入执行中。Agent 先把计划拆成 Todo List，执行并验证，最后调用 `complete_plan` 提交完成报告，逐项说明做了什么、怎么验证、哪些没做或偏离。执行跨多个 Run 时 Coko 持续告诉模型有未完成的 Plan。用户随时可以放弃。
- **结束：** 完成报告显示在时间线计划卡与右栏 Plan 页；Plan chip 在规划中显示“计划”、执行中显示“执行中”，结束后消失。

分两个阶段交付，各自独立验收：阶段一把规划从 Permission Mode 剥离，行为与现状逐条对应；阶段二加入执行中、完成报告与放弃。

## User Stories

**阶段一：规划与权限互不干扰**

1. As a 用户, I want 进入 Plan Mode 后我选的 Permission Mode 保持不变, so that 规划不会悄悄改掉我的授权档位。
2. As a 用户, I want 在“完全访问权限”下规划时命令与 MCP 调用不再逐次弹审批, so that Agent 调研时我不用守在旁边点批准。
3. As a 用户, I want 在“请求批准”下规划时命令照旧先问我, so that 规划不会放宽我原本的审批范围。
4. As a 用户, I want 规划期间模式菜单照常显示并勾选当前的 Permission Mode, so that 我始终知道 Agent 现在的授权档位。
5. As a 用户, I want 规划期间用模式菜单或 Shift+Tab 切换 Permission Mode 不会退出规划, so that 调整权限和结束规划是两件分开的事。
6. As a 用户, I want 规划期间拒绝规则、询问规则与受保护路径照常生效, so that 我已有的权限规则不因规划而失效。

**阶段一：规划期间不改 Workspace**

7. As a 用户, I want 规划期间 Agent 的文件写入被 Coko 直接拒绝而不是弹审批, so that 我不会因为顺手点了批准而让它在计划确认前改动文件。
8. As a 用户, I want 允许规则与外部 Hook 的放行都不能让规划期间的文件写入通过, so that 这条约束不被我早先配置的规则绕开。
9. As a 用户, I want 规划期间命令在只读沙箱里运行, so that 即使命令被放行或被我批准，它也写不了 Workspace。
10. As a 用户, I want 规划期间命令不能申请沙箱提权, so that “确认前不改动”没有后门。
11. As a 用户, I want 被拒绝的写入告诉模型现在在规划、内容应写进计划, so that 它不会反复重试或绕路。
12. As a 用户, I want 规划期间向进入规划前启动的可写终端发送输入被拒绝, so that 旧终端不会成为改动 Workspace 的通道。
13. As a 用户, I want 规划期间 Memory 写入、Todo List 与 Goal 工具照常可用, so that 规划时 Agent 仍能记录与整理，而这些都不改 Workspace。
14. As a 用户, I want 规划期间读取、搜索与只读命令照常工作, so that Agent 能充分调研。

**阶段一：进入与退出**

15. As a 用户, I want 用 `/plan` 或 `/plan <消息>` 进入规划, so that 进入方式与现在相同。
16. As a 用户, I want 用 `/plan off` 或 Plan chip 的 × 退出规划, so that 不想规划时可以直接回到普通对话。
17. As a 用户, I want 在新对话里直接输入 `/plan <消息>` 就以规划开始, so that 不必先发一条普通消息。
18. As a 用户, I want Run 进行中输入 `/plan` 被拒绝并说明原因, so that 行为与现在一致、不会在 Run 中途打乱上下文。
19. As a 用户, I want 退出规划失败时界面保留当前状态并提示, so that 我不会误以为已经退出。
20. As a 集成方, I want 通过协议读取 Session 的计划阶段并进入或退出规划, so that 不必再把规划伪装成一次权限切换。
21. As a 集成方, I want 切换 Permission Mode 的接口不再接受 `plan`, so that 协议里权限与规划各走各的入口。

**阶段一：提交与审阅**

22. As a 用户, I want Agent 用 `exit_plan_mode` 提交以标题开头的 Markdown 计划, so that 提交方式、校验规则与现在相同。
23. As a 用户, I want 审阅卡标出批准后将以哪个 Permission Mode 执行, so that 我批准前清楚 Agent 接下来的权限。
24. As a 用户, I want 在审阅卡上直接切换 Permission Mode, so that 我能在执行开始前收紧或放宽权限。
25. As a 用户, I want 批准计划只结束规划、不改变 Permission Mode, so that 权限只由我自己的选择决定。
26. As a 用户, I want 批准前可以在右栏编辑计划，编辑后的版本作为新修订被批准, so that 审阅时的修改能力不变。
27. As a 用户, I want 带反馈拒绝后 Agent 继续规划并提交修订, so that 我能迭代计划。
28. As a 用户, I want 无反馈拒绝后 Run 结束、Session 仍在规划中, so that 行为与现在一致。
29. As a 用户, I want 停止或暂停时待审阅的计划保持待审阅, so that 我之后还能看到它。
30. As a 用户, I want Goal Round 中出现计划审阅时 Goal 显示为等待我输入, so that 无人值守的推进不会卡在看不见的地方。

**阶段一：Subagent、分叉与其他入口**

31. As a 用户, I want 规划期间派发的 Subagent 同样不能写文件、命令同样在只读沙箱, so that 派发子代理不能绕过规划约束。
32. As a 用户, I want 规划期间 Subagent 的 Permission Mode 仍按父 Session 与其定义的上限取较窄者, so that 子代理的读取与命令审批不被无故压成只读。
33. As a 用户, I want 规划期间带 Worktree 隔离的 Subagent 派发被拒绝, so that 行为与现在一致。
34. As a 用户, I want Subagent 不再收到“调用 exit_plan_mode 提交计划”的指引, so that 它不会去找一个自己没有的工具。
35. As a 用户, I want 从规划中的 Session 分叉或交接出的新 Session 也在规划中, so that 约束不因换了一条工作线而消失。
36. As a 用户, I want 回退到进入规划之前的消息后 Session 不在规划中, so that 计划阶段与对话内容一致。
37. As a 用户, I want 回退到批准之前的消息后 Session 回到规划中, so that 文件被还原的同时写入约束也恢复。
38. As a 用户, I want 定时任务在规划中的 Session 上照常运行并受同样的约束, so that 行为可预期。
39. As a 无界面运行的使用者, I want `--permission-mode plan` 被当作参数错误并说明合法取值, so that 我不会启动一个永远等不到审阅的 Run。
40. As a Hook 作者, I want Hook 输入里的权限模式是 Session 真实的 Permission Mode, so that 我的脚本按实际授权档位判断。

**阶段一：历史数据**

41. As a 用户, I want 旧 Session 中以 `plan` 记录的权限按它进入前的模式读取, so that 升级后打开旧对话不出错、权限也不变宽。
42. As a 用户, I want 旧 Session 中已提交的计划仍能在时间线与右栏查看, so that 历史记录不丢。
43. As a 用户, I want 升级时正停在规划中的旧 Session 视为已退出规划, so that 它有一个确定的状态，需要时我重新输入 `/plan`。
44. As a 用户, I want 新对话草稿里残留的 `plan` 权限被当作未设置, so that 升级后新对话不会以不存在的模式发送。

**阶段二：执行中**

45. As a 用户, I want 批准后 Plan 显示为执行中, so that 我知道这份计划还没做完。
46. As a 用户, I want Agent 批准后先把计划拆成 Todo List 再动手, so that 我能在待办卡上看到进度。
47. As a 用户, I want 小计划不因没有拆待办而被卡住, so that 拆解是要求而不是门禁。
48. As a 用户, I want 执行跨多个 Run 时模型每次都知道有未完成的 Plan, so that 它在我追问或中断之后仍会把计划做完。
49. As a 用户, I want 已批准的计划正文被压缩掉之后仍提供给模型, so that 长会话里它不会忘记计划内容。
50. As a 用户, I want Coko 不因为有执行中的 Plan 而自动开始下一轮, so that 自动推进只发生在我建了 Goal 的时候。
51. As a 用户, I want Plan chip 在执行中显示“执行中”, so that 输入区能看出当前有一份进行中的计划。

**阶段二：完成与结果反馈**

52. As a 用户, I want Agent 做完后提交一份对照计划的完成报告, so that 我不用翻整段对话就知道每一项做了什么、怎么验证的。
53. As a 用户, I want 报告写明没做或偏离计划的部分, so that 我能判断是否需要追加工作。
54. As a 用户, I want 完成报告显示在时间线计划卡与右栏 Plan 页, so that 我能在熟悉的位置查看。
55. As a 用户, I want 提交完成报告不需要我审批, so that 不多一次没有实际拦截作用的点击。
56. As a 用户, I want 完成后 Plan chip 消失、模型不再被提醒这份计划, so that 之后的对话不受已结束计划的影响。
57. As a 用户, I want 对结果不满意时直接继续对话, so that 不需要额外的“重新打开计划”操作。
58. As a 用户, I want 没有执行中的 Plan 时 Agent 调用 `complete_plan` 得到明确的错误, so that 计划状态不会被误标。
59. As a 用户, I want 任何 Permission Mode 下提交完成报告都不询问, so that 结束计划不依赖授权档位。

**阶段二：放弃与重新规划**

60. As a 用户, I want 执行中用 `/plan off` 或 Plan chip 的 × 放弃计划, so that 不想继续时能明确结束它。
61. As a 用户, I want 放弃不撤销已经做的改动, so that 放弃只改变计划状态，文件的处置由我决定。
62. As a 用户, I want 被放弃的计划在时间线与右栏标为已放弃, so that 之后回看能分清做完的和没做完的。
63. As a 用户, I want 执行中再输入 `/plan` 时旧计划标为已放弃、进入新一轮规划, so that 方向变了可以直接重来。
64. As a 用户, I want 新一轮规划重新禁止写入, so that 新计划同样先确认再动手。
65. As a 用户, I want 一个 Session 同一时刻只有一份活动的 Plan, so that 界面与模型对“当前计划”的理解一致。
66. As a 用户, I want 回退到完成或放弃之前的消息后 Plan 回到执行中, so that 计划状态与对话内容一致。
67. As a 用户, I want 从执行中的 Session 分叉或交接出的新 Session 没有活动的 Plan, so that 新工作线不背着别处批准的计划。
68. As a 用户, I want Subagent 不能提交完成报告, so that 只有负责这份计划的主 Agent 能结束它。

## Implementation Decisions

### 两个阶段共用的数据形状

- **计划阶段是独立的 Session Entry。** 新增一种条目记录 Session 计划阶段的转换，取值为“无”“规划中”“执行中”，执行中带所属 Plan 的 planId。当前阶段是有效条目中最新的一条，没有这种条目即为“无”。条目不带 runId，入库与推送方式与 `permission_mode` 相同。阶段一只写入“规划中”与“无”，schema 在阶段一就包含“执行中”，阶段二不迁移数据。
- **`permission_mode` 条目升一版。** 模式取值收窄为 read-only、default、accept-edits、full-access，去掉 `prior`。旧版本在读取时于内存中升级：`plan` 取 `prior`，没有 `prior` 取 default；不改写数据库行。旧数据中没有计划阶段条目，因此升级后一律不在规划中。
- **`plan` 条目增加两个状态。** 在 proposed、approved、rejected 之外增加 completed（带完成报告）与 abandoned，schema 在阶段一加入，阶段二开始写入。approved 的 Plan 是否“执行中”由计划阶段条目决定：阶段为执行中且 planId 相同才算。历史上已批准的 Plan 没有对应的阶段条目，不算活动计划。
- **“本次规划”的起点** 改为最近一次进入规划的阶段条目，沿用现有的 planId 与 revision 派生规则。

### 阶段一：判定、沙箱与注入

- **判定输入增加“是否规划中”。** 规划中时，edit 权限类（write、edit 等文件写入工具）的调用直接拒绝：位置紧随拒绝规则之后，先于询问规则、受保护路径、越出可写根、模式放行与允许规则；外部 Hook 的 allow 不能免掉，Hook 的 deny 仍然优先。拒绝文本是模型可见契约，说明 Session 在规划中、内容应写进计划。其余权限类按 Permission Mode 走现有顺序。
- **`plan` 不再是判定与沙箱的输入。** 沙箱档位由“Permission Mode 加是否规划中”得出：规划中一律 read-only、可写根为空，否则沿用现有映射。
- **规划中不接受沙箱提权。** 带提权参数的命令直接返回错误结果，不询问。效果固定在更宽档位的调用（向更宽档位启动的 PTY Job 输入）在规划中拒绝；read-only 模式下的拒绝保持不变。
- **带 Worktree 隔离的 Subagent 派发** 在规划中拒绝；read-only 模式下的拒绝保持不变。
- **`exit_plan_mode`** 在规划中开始的 Run 注册，权限类 plan-exit 与审批 kind plan 不变。是否仍在规划中在调用时现取。计划校验、条目顺序、`editedPlan`、带反馈与无反馈拒绝、停止时取消均不变。
- **批准回答去掉 `mode`。** 批准后依次提交 approved 的 `plan` 条目、计划阶段条目（阶段一为“无”，阶段二为“执行中”）与工具结果；不再提交 `permission_mode` 条目。工具结果写明规划已结束、忽略之前的 `<plan_mode>`，不再提及恢复到哪个模式。执行使用回答时 Session 的 Permission Mode。
- **审阅等待期间可以切换 Permission Mode。** kind plan 的请求仍不随模式或规则变更重新判定。
- **`<plan_mode>`** 在规划中开始的 Run 注入，文本改为：写入会被拒绝、命令在只读沙箱中运行、其余调用按当前权限处理、用 `exit_plan_mode` 提交计划。它仍是 system section（ADR 0024）。Subagent 的子 Session 在根 Session 规划中时收到另一段说明，只讲不可改动，不提提交计划。
- **Subagent 的有效 Permission Mode** 为父 Session 模式与定义上限中较窄者，不再把规划映射为 read-only；是否规划中取根 Session 的阶段。

### 阶段一：协议与入口

- **新增 Session 的计划接口。** 读取返回当前阶段与活动的 Plan；动作有进入与退出。形状参照 Goal 的读取与动作接口，具体路径在设计阶段确定。Run 进行中动作照常可用，写入拒绝与沙箱档位即时生效或解除，system section 与工具集到下一个 Run 才变化（与现状中途切换模式一致）。
- **`/plan`** 调用同一组动作：`/plan [消息]` 进入并可随附一次提交，`/plan off` 退出。Run 进行中以 `run-in-progress` 拒绝，保持不变。阶段一中退出规划不改动待审阅的 `plan` 条目。
- **切换 Permission Mode 的接口** 只接受四档，`plan` 为 400；Session 权限的读取结果去掉 `prior`。首次发送的权限字段同样只接受四档。
- **无界面运行** 的 `--permission-mode` 只接受四档，`plan` 为参数错误。
- **外部 Hook** 输入中的权限模式为真实的 Permission Mode，不新增字段。
- **审计** 的权限模式事件去掉 `prior`；计划阶段的转换作为新的审计事件记录，避免丢失“何时进入与退出规划”。
- **分叉与交接：** 边界处阶段为规划中时，新 Session 以规划中开始；其余情况不带计划阶段。`plan` 条目不复制，保持不变。
- **回退：** 计划阶段与 Plan 的状态按有效条目回放，回退后重新计算。Permission Mode 现有的回退行为不改。

### 阶段一：界面

- **模式菜单** 始终显示并勾选当前的 Permission Mode，不再有“按钮显示 prior、三项都不勾选”的特例。Shift+Tab 只切换 Permission Mode。
- **Plan chip** 由计划阶段驱动，× 调用计划接口的退出动作；其余几何与交互不变。
- **审阅卡** 去掉“批准并允许编辑”与“将恢复的模式”，主按钮为“批准并执行”；卡上标出执行权限并放入现有的模式菜单组件，选择“完全访问权限”仍先确认风险。
- **新对话草稿** 中持久化的 `plan` 权限读取时按未设置处理。
- **文案** 删除不再使用的规划模式说明与恢复模式文案。

### 阶段二：执行中与完成

- **批准时计划阶段转为执行中**，带该 Plan 的 planId。批准的工具结果追加指引：先用 `todo_write` 拆解，执行并验证，结束时调用 `complete_plan` 对照计划汇报。
- **`complete_plan`** 参数为 Markdown 报告，非空，长度上限与计划相同。权限类 session-state：所有 Permission Mode 放行，拒绝与询问规则照常生效。在规划中或执行中开始的 Run 注册，因为工具集在 Run 开始时取值，而批准发生在 Run 中途。调用时现取阶段：不在执行中时返回错误结果，不提交条目。成功时依次提交 completed 的 `plan` 条目（同 planId 与 revision，带报告）、计划阶段条目“无”与工具结果。报告入库与推送前替换登记的 Secret 明文。Subagent 的子 Session 排除该工具。宿主不校验报告内容，不运行任何验证。
- **执行中的提醒走 State Update。** 新增一个 State Update：执行中时值为该 Plan 的标识、修订与标题，渲染文本说明有未完成的 Plan、完成后调用 `complete_plan`；完成或放弃后送达一次清空。送达时机、按值去重、回退与压缩后重发遵循 ADR 0024 的既有规则。
- **`<approved_plan>`** 只在计划阶段为执行中、且该 Plan 的正文早于最后一次有效压缩时注入；完成或放弃后不再注入。截断规则不变。
- **放弃：** 执行中调用计划接口的退出动作（`/plan off`、Plan chip 的 ×）时，依次提交 abandoned 的 `plan` 条目与计划阶段条目“无”，不触碰文件与 Checkpoint。Run 进行中放弃后，本 Run 再调用 `complete_plan` 得到错误结果。
- **执行中再进入规划：** 先按放弃处理当前 Plan，再提交“规划中”；新计划使用新的 planId。
- **一个 Session 至多一份活动的 Plan。** 规划中没有执行中的 Plan，执行中不能同时规划。
- **宿主不因执行中的 Plan 发起 Run**，Plan 与 Goal 之间不新增关联。
- **分叉与交接** 不带执行中的阶段与 Plan。

### 阶段二：界面

- **Plan chip** 执行中显示“执行中”，样式不变，× 即放弃且不弹确认；完成或放弃后消失。
- **时间线计划卡与右栏 Plan 页** 的状态增加执行中、已完成、已放弃；已完成显示完成报告。历史上已批准但没有执行阶段的 Plan 仍显示为已批准。

### 文档与决定

- 新写一份 ADR：计划是独立的 Session 状态，不是 Permission Mode；规划期约束由计划流程施加；被否决的方案是借用只读判定。同时在 ADR 0005 上标注“plan 作为模式取值”的部分被替代。在设计阶段完成。
- 术语表跟着实现走：Plan Mode 的定义随阶段一交付修改（Session 的规划阶段），Plan 的定义随阶段二交付修改（贯穿到结果反馈）。
- 随实施更新的当前行为文档：Plan Mode、权限判定与审批、子代理、无界面运行、外部 Hook、命令执行（PTY 与 stdin）、上下文管理、追踪与审计、桌面工作台，以及两个包的 README。

## Testing Decisions

- **好的测试只断言外部事实：** 经协议读回的条目与计划阶段、faux 请求日志中实际发给模型的 system section、工具集与消息、磁盘上的文件内容（包括应保持不变的文件逐字节不变）、界面在真实浏览器中的输出。不断言内部函数的调用或中间结构。
- **不新增接缝，沿用现有五处：**
  - **真实 Sidecar 集成测试（主接缝）。** 以 Electron 内置 Node 启动 Sidecar，经 HTTP 与 WS 驱动，faux 模型。先例是现有的 Plan Mode 闭环测试，以及 Goal、Hook、PTY、回退、定时任务、子代理隔离、无界面运行的集成测试。
  - **判定与沙箱的表测试。** 先例是现有按“模式 × 工具类型”展开的判定表与沙箱档位测试。
  - **条目版本测试。** 先例是 `permission_mode` v1 到 v2 的升级用例。
  - **renderer 的 Browser Mode 测试。** 先例是现有的计划审阅、chip 与模式菜单测试。
  - **一条 Electron E2E。** 先例是现有的 `/plan` 进入到批准的端到端用例，后台模式运行。
- **阶段一的集成测试覆盖：**
  - 四种 Permission Mode 下进入规划：模式读回不变；命令与 MCP 的询问与否和未规划时相同。
  - 规划中的写入：结果为拒绝、不产生审批请求、目标文件不存在或逐字节不变；有匹配的允许规则与 Hook allow 时仍被拒绝。
  - 规划中的命令：被放行的写文件命令因只读沙箱失败（darwin；其他平台按现有约定处理）；带提权参数的调用直接出错且不询问。
  - 提交、编辑后批准、带反馈与无反馈拒绝、停止时取消：条目顺序与现状对应，批准后没有新的 `permission_mode` 条目，模式读回不变。
  - 审阅等待期间切换 Permission Mode 后批准：后续调用按新模式判定。
  - 带 `mode` 的批准回答、把 `plan` 作为模式的切换请求与首次发送：400。
  - Subagent：规划中派发的子 Session 写入被拒、命令在只读沙箱、有效模式为父模式与上限的较窄者、system 中没有提交计划的指引；带 Worktree 隔离的派发被拒。
  - 向更宽档位启动的 PTY Job 输入：规划中被拒。
  - 回退到进入规划之前与批准之前：计划阶段读回分别为无与规划中，后者写入再次被拒。
  - 分叉与交接：源在规划中时新 Session 在规划中。
  - 旧数据：预置含 v2 `plan` 记录的 Session，读回的模式为 `prior`（缺省 default），不在规划中，计划条目可读。
  - 无界面运行：`--permission-mode plan` 以参数错误退出。
  - Hook：规划中 PreToolUse 收到的权限模式是真实模式。
  - Secret：计划条目、审批卡、工具结果与 `<approved_plan>` 中没有登记明文（沿用现有用例）。
- **阶段二的集成测试覆盖：**
  - 批准后计划阶段为执行中；同一个 Run 中调用 `complete_plan` 成功，条目顺序正确，阶段回到无。
  - 执行跨 Run：下一个 Run 的首条 user message 带执行中的 State Update；值不变时不重复；完成或放弃后送达一次清空。
  - 压缩后的 `<approved_plan>` 只在执行中注入，完成后不再注入。
  - 没有执行中的 Plan 时调用 `complete_plan`、空报告、超长报告：错误结果，不提交条目。
  - 四种 Permission Mode 下 `complete_plan` 都不询问；子 Session 的工具集中没有它。
  - 执行中放弃：条目与阶段正确，Workspace 文件逐字节不变；Run 进行中放弃后本 Run 的 `complete_plan` 出错。
  - 执行中再 `/plan`：旧计划为已放弃，新计划使用新的 planId，写入再次被拒。
  - 回退到完成之前：阶段回到执行中。分叉与交接：新 Session 没有活动的 Plan。
  - 有执行中的 Plan 而没有 Goal 时，Run 结束后宿主不发起新的 Run。
  - 完成报告中的登记明文被替换。
- **判定表** 改为“Permission Mode × 是否规划中 × 工具类型”，并保留现有各模式的断言作为不变量；沙箱档位测试覆盖规划中一律 read-only。
- **界面测试** 覆盖：规划中模式菜单勾选当前模式并可切换；审阅卡上的执行权限与模式菜单；chip 在规划中、执行中与结束后的三种状态；计划卡与 Plan 页的新状态与完成报告；共用 setup 对遗留模态层的断言照常生效。
- **现有测试的处理：** 约 33 个涉及 `plan` 模式的测试文件按新行为更新，不删除其覆盖的场景；断言“规划中写入询问”的用例改为断言拒绝，断言 `prior` 与恢复模式的用例改为断言模式不变。
- **真实模型：** 本规格不设真实模型门槛。`<plan_mode>`、批准结果与执行提醒的文本变化只经 faux 请求日志验证链路；模型是否照做未验证，交付时如实报告。

## Out of Scope

- 移除 read-only 模式，以及“帮我批准”改为由大模型审核。
- 模型可调用的进入规划工具，以及界面上进入规划的按钮。
- “Workspace 只读、临时目录可写”的沙箱档位；规划期间需要写文件的命令（会写缓存或产物的测试与构建）会失败，这是本规格接受的代价。
- 完成报告的结构校验、宿主自动运行验证、完成时的用户审批。
- 因执行中的 Plan 自动发起下一轮，或批准时自动创建 Goal。
- 以同一编号修订执行中的计划。
- 放弃的二次确认，以及放弃时撤销已做的改动。
- 外部 Hook 输入中表示“规划中”的字段。
- 无界面运行的规划入口。
- 计划写入 Workspace 文件、语义化授权（现状已排除）。
- 回退不还原 Permission Mode、与分叉口径不一致的现有缺陷（另开问题）。
- 为历史上已批准的 Plan 补记执行或完成状态。

## Further Notes

- **来源。** 产品决定全部来自 [grilling.md](grilling.md) 的 24 个已确认问题。事实核对来自一次只读的代码调查，未运行测试。
- **本规格补充的决定（讨论中没有逐条问过，请审阅时留意）：**
  1. 存储形状：计划阶段用独立条目记录，`permission_mode` 升版并在读取时迁移，`plan` 条目增加两个状态。
  2. 规划中不接受沙箱提权。现状在 plan 模式下命令被沙箱拒绝后可以申请单次提权，批准后能写 Workspace；这与“硬性禁止”冲突，因此堵上。
  3. `complete_plan` 在规划中开始的 Run 也注册，否则批准之后的同一个 Run 没有这个工具。
  4. 执行中的提醒走 State Update，不放进 system，依据 ADR 0024。
  5. 历史上已批准的 Plan 不算执行中，升级后也不再被重新注入为 `<approved_plan>`。现状是它们被压缩掉后会一直注入。
  6. 新增 Session 的计划接口，计划阶段转换进入审计。
  7. Run 进行中经接口进入或退出规划，写入拒绝与沙箱即时生效。
  8. 阶段一批准后计划阶段回到“无”，阶段二改为“执行中”；两个阶段之间批准的 Plan 属于第 5 条所说的历史 Plan。
- **阶段之间的依赖。** 阶段二依赖阶段一的计划阶段条目与计划接口；阶段一交付后行为与现状的差别限于 Problem Statement 的第一、二、四类问题。
- **调查中发现、不在本规格内的现象** 见 grilling.md 的“另行记录的缺口”。其中首次发送带 `plan` 没有 `prior`、审阅等待期间切换模式后批准的落点、无界面运行不提 `plan` 三项，随阶段一交付自然消失。
