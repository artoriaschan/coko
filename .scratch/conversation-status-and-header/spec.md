---
kind: spec
description: "对话状态栏、标题栏、Session 下载与侧栏“执行中”指示规格：输入框底部的会话统计与 Token 用量及详情卡，标题行与“对话”tab、标题栏三项移除与“更多”菜单，Session JSONL 下载，以及“执行中”的定义、转圈指示与实时广播。"
status: delivered
lifecycle: active
---

# 对话状态栏、标题栏与侧栏执行中指示规格

Status: ready-for-agent

## 来源、确认与实施状态

本规格按 `to-spec` 汇总 2026-11-04 本会话经 `grill-me` 两轮确认的需求。第一轮 Q1—Q11 中，用户修改两项，其余采用推荐：Q9 改为父 Run 结束后后台 Subagent 或 Teammate 仍在运行时也显示“执行中”；Q11 改为需要创建 spec、不修改视觉稿（视觉稿为 `docs/ui/` 下的 `.pen` 文件）。第二轮 Q12 改为 Background Job 不算“执行中”；Q13（测试接缝）与 Q14（spec 和 design 的位置、不拆实施票、写完直接实现）采用推荐。产品需求因此为 `approved`。`to-spec` 第 2 步要求核对的测试接缝即 Q13 的确认结果，本次不再重复询问。

Q14 原定写完 spec 后直接实现、不拆实施票。开始实现之后，用户叫停：“不要修改代码，我还要生成工单”，随后调用 `to-tickets`，要求撤回已经写好的代码。2026-11-04，用户回复“确认”，确认 9 张实施票及其阻塞关系，取代了 Q14 中“不拆实施票”的结论；票的清单见下文“交付方式”。撤回前写的草稿保存在 [session-status-broadcast.patch](reference/session-status-broadcast.patch)，当时只通过了类型检查，没有测试。2026-11-04 用户调用 `implement-spec` 后，9 票现已本地实施并完成联合验收，证据与原生层未验证范围见文末；尚未推送、合入主分支或发布。

本功能使用独立 tracker 目录。界面布局与交互参考 DeepSeek Harness，视觉使用 Coko 的字体、语义 token、图标和共享浮层组件；视觉稿 [双栏布局.pen](../../docs/ui/双栏布局.pen) 本次不修改。既有约束见[术语表](../../GLOSSARY.md)、[界面约定](../../docs/tech-stack/ui.md)、[设计系统规格](../../docs/tech-stack/ui-design-system.md)、[测试约定](../../docs/tech-stack/testing.md)、[tracker 协议](../../docs/agents/issue-tracker.md)和[开发流程](../../docs/DEVELOPMENT_WORKFLOW.md)。

在本文的修订范围内，本次确认优先于以下当前行为说明：[项目与会话列表](../../docs/subsystems/projects.md)中“列表不显示运行状态点”，[Goal](../../docs/subsystems/goal.md)中标题栏的 Session 费用，[交接](../../docs/subsystems/handoff.md)中标题栏的交接按钮与对话框。消息正文、消息底栏和本轮用量仍按已交付的[对话详情规格](../conversation-detail/spec.md)与[消息底栏规格](../message-footers/spec.md)执行。任务材料不加入正式文档导航。

## Problem Statement

用户在对话详情页的输入框附近看不到本 Session 的执行统计和 Token 消耗。现有的 Session 级入口只有标题栏的费用按钮，它显示金额或“未定价”，不显示执行了多少轮、多少步、用了多少 Token、缓存命中多少。

标题栏同时堆着 Sidecar 连接指示、费用和交接按钮，和参考实现“标题 + 视图 tab”的结构不一致。右栏入口叫“打开右栏”，Session 级操作（例如下载）没有固定的位置。

侧栏里，用户分不清哪些 Session 或项目正在执行。父 Run 结束后后台 Subagent 或 Teammate 还在工作时，侧栏完全看不出来。定时任务或 Goal 在当前窗口没打开过的 Session 中开始 Run 时，侧栏也不会变化，因为服务端只向已订阅的会话推送运行状态。

用户还想直接把当前 Session 保存成文件，现在只能在右栏 Trace tab 里找到导出按钮，得到的是 `.ndjson` 文件。

## Solution

### 输入框底部的状态栏

| 编号 | 已确认行为 |
| --- | --- |
| STAT-01 | 状态栏只在对话详情页出现，新对话页不显示。归档的 Session、worktree 已移除的只读 Session，以及审批卡或结果确认卡占用输入位置时，状态栏照常显示。 |
| STAT-02 | 布局照搬 DeepSeek Harness：位于输入框卡片下方，水平居中，与输入框共用列宽。输入框卡片底边往下 4px 是状态栏，状态栏高 22px，再往下 4px 到主区底边，卡片底边到主区底边合计 30px（原为 16px）。胶囊为 12px 弱化色文字，胶囊之间间距 12px；图标 14px、stroke 1；悬停与打开时使用共享的悬停背景。空间不够时胶囊用省略号截断，不换行。 |
| STAT-03 | 没有数据时保留 22px 的空行，数据到达时输入框位置不跳动。 |
| STAT-04 | 会话统计胶囊显示 `{轮} 轮 {步} 步 · {tps} tok/s`，图标为仪表。1 轮 = 本 Session 中至少发出过一次主循环模型请求的 Run：用户发送和 Goal Round 都算，单纯的 `/compact` 与交接摘要 Run 不算。1 步 = 一次主循环模型请求，重试只计一次。没有输出速度时省略 `· {tps} tok/s`；步数为 0 时不显示这个胶囊。缺少请求记录的旧 Session 不补造统计。 |
| STAT-05 | 会话统计卡：标题行左侧为仪表图标加“会话统计”，右侧为 `{轮} 轮 {步} 步`，下有分隔线。之后的行依次是：模型用时（主循环请求耗时之和）、工具调用用时（从工具调用发出到拿到结果，包含审批等待，与 Trace 的工具耗时口径一致）、首 token 平均（TTFT）、输出速度（TPS，输出 token 除以生成时间，生成时间 = 请求耗时减去 TTFT）。值为 0 或未知的行不显示。耗时小于 60 秒显示为 `45.2秒`，否则显示为 `2分42秒`；速度不小于 10 时取整，小于 10 时保留 1 位小数。 |
| STAT-06 | Token 胶囊的范围是整个 Session，沿用现有 Session 级用量汇总：包括主循环、压缩、交接摘要和标题生成请求，不包括 Subagent 的子 Session。只累计服务商明确上报的分桶。胶囊显示 `45.2K tok · 缓存命中 90%`，图标为数据库；没有输入时省略缓存命中部分；没有任何用量计数时不显示这个胶囊。 |
| STAT-07 | Token 卡：标题行左侧为数据库图标加“Token 用量”，右侧为带千位分隔的精确总量，下有分隔线。之后的行与“本轮用量”卡相同：缓存命中、未缓存输入、缓存读取、缓存写入、输出、推理（推理是输出的子集，确有数据时才显示）。只在服务商有未上报的分项时，最后显示“数据不完整”说明。卡片不显示费用。 |
| STAT-08 | 点击胶囊打开或关闭对应的卡；点击外部或按 Escape 关闭，焦点回到胶囊。同一时间只开一张卡。卡片默认出现在胶囊上方，靠近视口边缘时自动调整位置，不被裁剪。胶囊的可访问名称包含完整读数；只在文字被截断时显示 Tooltip。 |
| STAT-09 | 数值随 Session Entry 的提交更新，流式输出过程中不逐 token 变化。重新加载、重新打开 Session 和应用重启后，数值与持久化事实一致，不重复计数。 |
| STAT-10 | 输入框工具栏中现有的上下文环留在原位，状态栏不新增上下文环。 |

### 标题栏

| 编号 | 已确认行为 |
| --- | --- |
| HEAD-01 | 对话详情页的标题栏分两行。标题行保持 48px 高，与右栏头部和窗口安全区共用这个高度；标题字体样式参考 DeepSeek Harness。标题行下方是 tab 行。新对话页不显示标题和 tab 行，保持现状。 |
| HEAD-02 | 标题行：标题（14px、字重 500，单行截断，可读到完整标题）后接 worktree 分支 chip。右侧保留后台任务、子代理、定时任务、团队四个状态按钮，最右侧依次是“更多”和“打开侧边栏”。标题区不增加面包屑、Agent 预设名或其他标签。 |
| HEAD-03 | tab 行只有一个选中的“对话”tab：下划线式，13px、字重 500，选中时文字与 2px 下划线均为 link 蓝；tab 行下方有一条细分隔线。点击 tab 不切换内容，但保留 tab 列表与 tab 的语义。 |
| HEAD-04 | 标题栏移除三项：Sidecar 连接指示（圆点和“Sidecar 已连接”等文字）、Session 费用按钮（硬币图标、金额或“未定价”以及悬停分项卡）、交接按钮。连接状态改为只给读屏器的状态元素，连接变化仍会播报；“连接中”“已断开”这类瞬时状态不再可见，启动失败时的全屏提示层保留。Session 费用仍可在 Trace tab 和 Goal 卡中查看。 |
| HEAD-05 | 交接对话框删除，界面上只能用 `/handoff <下一步目标>` 发起交接，目标为当前目录。交接原有的效果保留：完成后切到目标 Session（用户仍在源 Session 时）并写入摘要草稿；失败时弹出应用级 Toast，并提供“重试”。时间线中的交接行不变。 |
| HEAD-06 | 右栏开关改为“打开侧边栏”按钮，只在右栏关闭时显示，使用面板样式图标；Tooltip 为“打开侧边栏”，可访问名称为“打开右侧边栏”。右栏打开后标题栏不再显示这个按钮，关闭右栏使用右栏自带的 X，它的 Tooltip 改为“收起侧边栏”，可访问名称为“收起右侧边栏”。 |
| HEAD-07 | “打开侧边栏”左侧新增常驻的“更多”按钮，归档 Session 和窄窗口下同样显示。点击打开浮动菜单，只有一项“Session 下载”（英文 “Download session”，配下载图标）。原来窄窗口才出现的“更多操作”收起菜单随交接菜单项一起移除。 |

### Session 下载

| 编号 | 已确认行为 |
| --- | --- |
| DL-01 | 下载当前 Session 及其 Subagent 子 Session，内容与 Trace tab 的导出相同：经脱敏的 NDJSON，第一行是导出 header，之后每行一条 Session Entry。文件名为 `coko-session-<Session id>.jsonl`。 |
| DL-02 | 下载经 Electron 默认的保存框完成。同一 Session 同时只进行一次导出；失败时弹出应用级 Toast 说明原因，成功反馈与 Trace 导出相同。 |
| DL-03 | Trace tab 的导出按钮、服务端导出接口及其默认的 `.ndjson` 文件名不变。 |

### 侧栏“执行中”指示

| 编号 | 已确认行为 |
| --- | --- |
| RUN-01 | 根 Session 满足任一条件时为“执行中”：当前 Run 正在执行（包括 Run 内等待审批）；有后台 Subagent 在运行（包括它在等待审批）；有 Teammate 正在执行 Run。Teammate 空闲等待消息、已暂停、已中断、等待结果确认，以及 Background Job（包括开发服务器这类常驻进程）都不算“执行中”。 |
| RUN-02 | “执行中”的 Session 行右侧对齐显示 12px 的转动加载图标，弱化色，位置与悬停操作按钮相同。可访问名称：Run 正在执行时为“运行中”，否则为“后台运行中”。 |
| RUN-03 | 鼠标悬停或键盘焦点进入行时，转圈消失，显示原有的操作按钮（置顶、更多）；离开后转圈恢复。系统开启减少动态效果时转圈停止转动。 |
| RUN-04 | 项目收起、且其中有“执行中”的未置顶成员 Session 时，项目行右侧显示同样的转圈，悬停或焦点进入时换成“更多”和“新建会话”。项目展开时，转圈显示在对应的 Session 行上，项目行不显示。执行中的 Session 被分页“展开”藏起来，或整个分类被收起时，不做特殊处理。置顶 Session 在置顶区显示自己的转圈，不计入所属项目；置顶的项目按同样规则处理。 |
| RUN-05 | 列表中的所有 Session，包括当前窗口从未打开过的，都实时显示“执行中”。服务端把每个根 Session 运行状态的变化广播给所有连接，列表快照带同样的字段；重连或重新加载列表后不残留过期的转圈。Run 与 Subagent 不跨重启保留，应用重启后没有“执行中”。 |
| RUN-06 | “执行中”不改变列表排序，也不把执行中的项上浮。 |

## User Stories

1. 作为用户，我希望在输入框下方看到本 Session 的轮数、步数和输出速度，以便了解 Agent 已经做了多少工作。
2. 作为用户，我希望打开会话统计卡查看模型用时和工具调用用时，以便判断时间花在模型上还是工具上。
3. 作为用户，我希望看到首 token 平均耗时，以便判断模型响应快慢。
4. 作为用户，我希望状态栏显示本 Session 累计的 Token 用量，以便掌握整段对话的消耗。
5. 作为用户，我希望看到缓存命中率，以便了解缓存是否在节省消耗。
6. 作为用户，我希望 Token 卡列出未缓存输入、缓存读取、缓存写入和输出的精确值，以便核对每一类消耗。
7. 作为用户，我希望在服务商上报时看到推理 token，并知道它属于输出，以便理解输出构成而不重复计算。
8. 作为用户，我希望服务商没有完整上报时看到明确的不完整提示，以便不把部分数值当成总量。
9. 作为用户，我希望 Subagent 的消耗不混入本 Session 的 Token 用量，以便统计口径一致。
10. 作为用户，我希望在归档或只读的 Session 中仍能看到状态栏，以便回看历史消耗。
11. 作为用户，我希望审批卡或结果确认卡占用输入位置时状态栏仍在，以便随时了解执行进展。
12. 作为用户，我希望状态栏数据第一次出现时输入框不跳动，以便输入不被打断。
13. 作为键盘用户，我希望能用键盘打开和关闭统计卡，关闭后焦点回到原来的胶囊，以便不用鼠标也能查看详情。
14. 作为用户，我希望一次只开一张统计卡，以便界面不被浮层遮挡。
15. 作为用户，我希望统计卡在窗口边缘也能完整显示，以便窄窗口下也能读到全部数值。
16. 作为用户，我希望重启应用或重新打开 Session 后统计数值不变，以便信任这些数字。
17. 作为用户，我希望流式输出时状态栏数值保持稳定，只在记录提交后更新，以便阅读时不被频繁跳动的数字干扰。
18. 作为用户，我希望上下文环仍在输入框工具栏原来的位置，以便沿用熟悉的操作。
19. 作为用户，我希望标题栏只显示标题和“对话”tab，以便界面与参考实现一样简洁。
20. 作为用户，我希望标题旁仍显示 worktree 分支，以便知道当前在哪个分支上工作。
21. 作为用户，我希望后台任务、子代理、定时任务和团队按钮仍在标题栏，以便随时查看这些状态。
22. 作为用户，我希望标题栏不再显示 Sidecar 连接文字，以便标题栏只保留与对话有关的内容。
23. 作为读屏用户，我希望连接状态变化仍会播报，以便知道应用是否可用。
24. 作为用户，我希望 Sidecar 启动失败时仍看到全屏提示，以便知道需要处理什么。
25. 作为用户，我希望标题栏不再显示费用按钮，需要时在 Trace tab 或 Goal 卡中查看费用，以便标题栏不被金额和“未定价”占用。
26. 作为用户，我希望继续用 `/handoff` 发起交接，完成后自动切到新 Session 并带上摘要草稿，以便交接流程不因按钮移除而中断。
27. 作为用户，我希望交接失败时看到 Toast，并能一键按原来的目标重试，以便不必重新输入。
28. 作为用户，我希望右栏入口叫“打开侧边栏”并使用面板图标，以便一眼看出它的作用。
29. 作为用户，我希望右栏打开后标题栏不再重复显示打开按钮，以便用右栏自带的按钮收起它。
30. 作为用户，我希望标题栏有一个固定的“更多”按钮，以便找到 Session 级的操作。
31. 作为用户，我希望从“更多”菜单把当前 Session 下载成 JSONL 文件，以便保存或分享对话记录。
32. 作为用户，我希望下载的文件包含 Subagent 的子 Session，以便得到完整的执行记录。
33. 作为用户，我希望下载内容经过脱敏，以便文件中不出现登记过的 Secret。
34. 作为用户，我希望下载失败时看到原因，以便决定是否重试。
35. 作为用户，我希望连续点击下载不会同时发起多次导出，以便不产生重复文件。
36. 作为用户，我希望 Trace tab 的导出保持原样，以便已有的使用方式不变。
37. 作为用户，我希望侧栏显示哪些 Session 正在执行，以便不必逐个打开查看。
38. 作为用户，我希望父 Run 结束后后台 Subagent 或 Teammate 还在工作时，侧栏仍显示“执行中”，以便知道工作没有结束。
39. 作为用户，我希望空闲的 Teammate 和开发服务器这类 Background Job 不让 Session 一直转圈，以便转圈只表示真正在执行。
40. 作为用户，我希望定时任务或 Goal 在没打开过的 Session 中开始执行时侧栏也会更新，以便及时发现后台工作。
41. 作为用户，我希望收起的项目在有成员执行时显示转圈，以便不展开也能知道。
42. 作为用户，我希望悬停或键盘聚焦时转圈换成操作按钮，以便照常置顶或打开菜单。
43. 作为对动效敏感的用户，我希望开启减少动态效果后转圈停止转动，以便减少干扰。
44. 作为用户，我希望“执行中”不改变列表排序，以便列表位置稳定、便于查找。
45. 作为用户，我希望重连或重启后侧栏没有残留的转圈，以便状态可信。
46. 作为用户，我希望状态栏、标题栏和侧栏指示在明暗主题、中英文和 390 CSS px 宽度下都清晰可用，以便在不同环境中使用。

## Implementation Decisions

标注“工程决定”的条目是 Agent 在授权范围内做出的实现选择，不是用户确认的产品决定；其余条目来自两轮确认。

### 状态栏

- **数据只从已加载的条目派生。** 状态栏与两张卡只读取当前 Session 已加载的 Session Entry，不新增服务端接口或进度事件。
- **Token 复用现有汇总。** Token 总量复用现有的 Session 级用量汇总，请求去重、四个互斥分桶和完整性规则与[消息底栏规格](../message-footers/spec.md)的 USAGE-01、USAGE-02、USAGE-04 相同，只是范围扩大到整个 Session。
- **会话统计的来源。** 从主循环模型请求记录（用途、重试次数、耗时、首 token 时间）及工具调用与结果的配对派生；工具耗时与 Trace 的计算方式一致。
- **纯函数与格式化。** 新增的汇总与格式化函数为纯函数，可单独测试；复用现有的 token 格式化与缓存命中百分比函数，不另写一套格式规则。
- **卡片共用字段渲染。** 详情卡复用“本轮用量”卡的浮层与字段列表；把它的字段渲染抽成两张卡共用的部分，两张卡不各自维护字段清单。
- **挂载位置与间距。** 状态栏位于输入框卡片、审批卡、结果确认卡和归档/只读提示之后，在 Session 详情页的整个生命周期内保持挂载，这些卡片切换时不重新挂载。输入区底部间距按 STAT-02 调整，新对话页布局不变。

### 标题栏

- **标题栏操作只留四个状态按钮。** 移除费用、交接，以及窄主区收起机制（菜单项和菜单关闭后执行的回调），因为它们不再有使用者。
- **删除 Session 费用组件，保留共享函数。** 其中的格式化、定价与货币函数仍被 Trace、Goal 和 Subagent 使用，保留不动。
- **交接的效果挪到常驻位置。** 绑定交接 store、完成后自动切换、写入草稿和失败 Toast 挪到对话区里常驻挂载的位置；交接对话框与标题栏按钮删除。时间线的交接行、交接 store、`/handoff` 和服务端接口不变。
- **（工程决定）失败 Toast 的“重试”。** 原来的“重试”会重新打开已删除的对话框。现在改为取失败条目中记录的下一步目标，对当前目录重新发起交接。代价是旧对话框里的“复制摘要”入口随之消失。
- **连接状态只给读屏器。** 连接状态组件改为视觉隐藏的播报区域，保留 status 角色和表示连接状态的 data 属性，现有 e2e 的就绪等待不用改；可见的圆点和文字去掉。
- **标题栏的组成与样式。** 标题行与 tab 行由同一个标题栏组件组成；交互控件按共享规则退出窗口拖拽区。标题字体使用 Coko 现有的 body-lg 与中等字重档位，tab 使用现有的 body 字号与 link 色，不新增全局 token。
- **（工程决定）图标按钮支持单独的 Tooltip。** “打开侧边栏”的 Tooltip 与可访问名称文字不同，共享的图标按钮因此支持单独传入 Tooltip 文字，缺省时与可访问名称相同。
- **（联合验收中的工程决定）窄主区的导航控制条重排。** 主区不宽于 560px 且侧栏收起时，把同一份展开侧栏、后退、前进和新对话控制条放到 tab 行左侧，“对话”tab 随后；标题行仍高 48px，保留原生安全区与四个状态按钮、“更多”、打开侧边栏的顺序和命中区。不隐藏操作、不新增第三行，也不改变新对话页或全局 token。真实 Electron 曾在全部状态入口出现时裁掉行尾操作，聚焦后又把主区横向滚动 70px；局部 CSS 重排消除了这一缺陷。

### 会话状态广播（跨进程）

- **新的全局消息。** 新增 WebSocket 全局消息 `session_status { sessionId, running, agentsRunning }`，与 `session_title` 一样发给所有连接；renderer 对消息的严格校验需要包含这个新类型。
- **DTO 新增可选字段。** Session DTO 新增可选的 `agentsRunning`，缺省视为 false；列表接口与详情接口按同一规则计算。
- **服务端只为根 Session 计算。** `running` 沿用现有的运行时状态；该根 Session 下有 running 的 Subagent 或 Teammate 时，`agentsRunning` 为 true。Background Job 不参与计算。
- **重算时机与去重。** 在三类进度之后重算受影响的根 Session：Run 开始、Run 结束、Subagent 状态更新；只在值变化时广播。这依赖三个时序：运行时在发出 `run_start` 之前已标记为运行中，在发出 `run_end` 之前已清除运行中状态，Subagent 的状态在发布 `agent_update` 之前已更新。
- **renderer 写入。** renderer 的列表 store 按广播写入这两个字段，用与标题相同的修订号写法：加载列表快照期间收到的广播，在快照落地后仍然生效。接口返回的 DTO 写入已有列表行时保留当前行的执行状态，因此清理先前广播的覆盖记录后，延迟的旧 DTO 也不能覆盖新快照或广播；尚未加载的行先合并已收到的广播，无已有状态时才用 DTO 初始化。对已订阅的 Session，现有的按条目与进度推导运行状态的逻辑保持不变。
- **侧栏的判断。** 侧栏以 `running` 或 `agentsRunning` 为真作为“执行中”。具体设计见 [design.md](design.md)。

### Session 下载

- **复用现有导出接口。** 带子 Session 调用现有导出接口，只在前端改建议的文件名。
- **下载流程共用。** 取文本、生成 blob、触发下载、导出中去重、成功与失败反馈，抽成 Trace 导出与 Session 下载共用的能力，不复制第二份实现。

### 文案与文档

- **文案走字典。** 所有新的可见文案、可访问名称和 Tooltip 走类型化的 zh/en 领域字典；能复用现有 `usage` 字段名的就复用；侧栏启用字典中已有但尚未使用的“运行中”文案。
- **（工程决定）无悬停设备不显示转圈。** 在无悬停能力、会话行操作按钮常显的设备上不显示转圈，与操作区现有的行为一致。
- **同批同步当前行为文档。** projects 改为“执行中”规则；workbench 更新标题栏、状态栏与输入区间距；goal 删除标题栏费用；handoff 更新入口与失败反馈；tracing 增加下载入口；WebSocket 消息与 DTO 字段写入所属子系统说明；Subagent 与团队文档中“没有‘更多操作’菜单项”的说法同步修改。正式文档不引用本任务文件。

## Testing Decisions

### 原则与接缝

只断言外部事实：渲染的文字与可访问名称、实际几何、协议消息、下载文件的内容和持久化后读回的结果。不用 class 名、内部函数调用次数或 Agent 声称完成来代替。只有模型服务、外部网络和时钟使用可控替身；内部汇总、store 和服务装配都用真实实现。

测试接缝为 Q13 确认的四类入口：

1. **真实 App 的 Browser Mode 测试。** 装配方式照 [App 浏览器测试](../../apps/desktop/src/renderer/app/app.browser.test.tsx)与[对话联合浏览器测试](../../apps/desktop/src/renderer/features/conversation/integrated-detail.browser.test.tsx)。覆盖：状态栏读数和两张卡的字段与交互；标题栏结构和三项移除；“更多”菜单触发下载；侧边栏的打开与收起；Session 行和项目行的转圈及悬停/焦点替换；减少动态效果；390 CSS px 宽度。侧栏既有用例见[侧栏列表浏览器测试](../../apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx)。
2. **真实 Sidecar 协议集成测试。** 写法照 [Subagent 集成测试](../../tests/integration/sidecar-subagents.test.ts)与[团队集成测试](../../tests/integration/sidecar-teams.test.ts)，使用 faux 模型。验证：一个没有订阅某 Session 的连接，在该 Session 的 Run、后台 Subagent、Teammate 开始和结束时都收到 `session_status`；Background Job 不使它进入运行中；列表快照与广播一致。
3. **真实 Electron E2E。** faux Run 之后检查状态栏读数；像 [Trace 导出 E2E](../../apps/desktop/e2e/trace.e2e.test.ts) 那样用 `will-download` 截获 Session 下载，检查文件内容；在未打开的 Session 中运行后台 Subagent，检查侧栏转圈。依赖已删除元素的 E2E 改用新入口，[交接 E2E](../../apps/desktop/e2e/handoff.e2e.test.ts) 改走 `/handoff`。
4. **agent-browser 静默检查。** 明暗主题、390px 宽、悬停，以及弹出卡片在视口边缘的位置。

### 单元测试、旧测试与执行范围

- 汇总与格式化的纯函数补充单元测试，但不能代替上面的入口测试。
- 断言旧行为的测试随行为一起修改，并在交付记录中说明原因：列表不显示运行状态、标题栏费用、交接对话框、窄窗口“更多操作”。删除的对话框的测试随之删除；交接的效果另有覆盖。
- 按[测试约定](../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关测试集和类型检查；协议与 DTO 有变化，所以扩大到真实的使用方。无理由不运行全仓测试；E2E 与 agent-browser 的结果分开报告。

### 验收场景

| 编号 | 前提 → 操作 → 可观察结果 |
| --- | --- |
| AC-01 | 详情页完成一次 faux Run → 查看输入框下方 → 状态栏显示轮数、步数和 Token 读数，间距、图标与水平居中符合 STAT-02；新对话页没有状态栏。（STAT-01、02、04、06） |
| AC-02 | Session 含多个 Run、失败后重试、`/compact`、交接摘要和标题请求 → 打开会话统计卡 → 轮数不计 `/compact` 与摘要 Run，重试只计一步；模型用时、工具用时、TTFT 平均和速度按规则计算，值为 0 的行不显示。（STAT-04、05） |
| AC-03 | Session 含主循环、压缩、标题请求和一个后台 Subagent → 打开 Token 卡 → 总量为本 Session 的合计，不含 Subagent；按已上报分桶给出精确值；只在有未上报分项时出现不完整说明；不显示费用。（STAT-06、07） |
| AC-04 | 新 Session 尚未完成第一步 → 查看状态栏 → 保留 22px 空行，没有胶囊；数据到达后输入框位置不变。（STAT-03） |
| AC-05 | 两个胶囊都可见 → 点击打开、再次点击、点击外部、按 Escape、打开另一个胶囊 → 同一时间只开一张卡，焦点回到触发的胶囊，靠近视口边缘时不被裁剪。（STAT-08） |
| AC-06 | Session 已归档、worktree 已移除，或审批/确认卡占用输入位置 → 查看详情页 → 状态栏照常显示历史读数。（STAT-01） |
| AC-07 | 打开详情页 → 查看标题栏 → 标题行依次为标题、分支 chip、四个状态按钮、“更多”和“打开侧边栏”，下面是只有一个选中“对话”tab 的 tab 行；没有连接状态文字、费用按钮和交接按钮。（HEAD-01—04、07） |
| AC-08 | Sidecar 连接状态变化 → 用读屏器查看 → 视觉隐藏的状态元素更新并播报，界面上没有可见文字；启动失败时的全屏提示层仍出现。（HEAD-04） |
| AC-09 | 在根 Session 中执行 `/handoff` → 成功或目标创建失败 → 成功时切到目标 Session 并写入摘要草稿；失败时弹出 Toast，“重试”按原来的下一步目标对当前目录重新发起交接。（HEAD-05） |
| AC-10 | 右栏关闭 → 点击“打开侧边栏”，再用右栏的 X 关闭 → 打开后标题栏不再显示这个按钮；X 的 Tooltip 为“收起侧边栏”；关闭后按钮重新出现，Tooltip 与可访问名称正确。（HEAD-06） |
| AC-11 | 打开“更多”，选择“Session 下载” → 保存 → 得到 `coko-session-<id>.jsonl`，内容为导出 header 加本 Session 与子 Session 脱敏后的条目。（DL-01、02） |
| AC-12 | 导出失败，或导出进行中再次点击 → 观察反馈与请求 → 失败时弹出错误 Toast；导出进行中不重复发起请求。（DL-02） |
| AC-13 | 定时任务或后台 Subagent 在一个未打开过的 Session 中开始执行 → 查看侧栏 → 该行右侧出现 12px 转圈，执行结束后消失。（RUN-01、02、05） |
| AC-14 | 父 Run 结束后后台 Subagent 或 Teammate 仍在运行；随后 Teammate 进入空闲，或只剩 Background Job 在运行 → 查看侧栏 → 前一种情况仍显示转圈，后一种情况转圈消失。（RUN-01） |
| AC-15 | 行上有转圈 → 鼠标悬停或键盘焦点进入，再离开；开启减少动态效果 → 进入时转圈消失，出现置顶和更多按钮，离开后转圈恢复；减少动态效果下图标不转动。（RUN-02、03） |
| AC-16 | 项目有执行中的未置顶成员 → 收起与展开项目，悬停项目行 → 收起时项目行显示转圈，悬停时换成“更多”和“新建会话”；展开后转圈只在成员行上；置顶 Session 不计入项目。（RUN-04） |
| AC-17 | 列表加载期间收到状态广播，以及重连、应用重启 → 查看侧栏 → 最终状态与服务端一致，没有残留的转圈，列表排序不变。（RUN-05、06） |
| AC-18 | 明暗主题、zh/en、390 CSS px 及以上宽度 → 查看状态栏、标题栏和侧栏指示 → 没有意外的裁剪、重叠或整页横向滚动，键盘路径完整。（STAT-02、HEAD-02、RUN-02） |

## Out of Scope

- 修改 `docs/ui` 下的视觉稿。
- 在状态栏显示费用，或把费用恢复到标题栏。
- 照搬参考实现的“简洁 / 详细”展示设置、ZIP 导出，以及打包媒体与附件。
- 移动或重做上下文环。
- 重做右栏 tab 的样式，或让它与“对话”tab 对齐到同一条线。
- 增加“对话”以外的 tab。
- 在界面上交接到新 worktree 或已有 worktree，或扩展 `/handoff` 使它能打开对话框。
- Background Job 的执行中指示；侧栏为出错、待审批、完成未读等状态单独设计的指示。
- 按运行状态排序或上浮，或在分页中自动保留执行中的 Session。
- 提交、推送或发布，除非用户另行要求。

## Further Notes

### 调查基线与参考差异

本次调查的 Coko 基线为 `560148db7f7260b37fe205673ee8cdbcddec0945`，参考项目 DeepSeek Harness 基线为 `8bd073392eef6f54e921a093b95076248eb08cbb`。版本变化后，下文的参考事实需要重新核对。

- Coko 的 Session 存在 SQLite 中，磁盘上没有每个 Session 单独的 JSONL 文件，所以“jsonl 下载”沿用现有的导出格式，只改扩展名。参考实现下载的是包含 JSONL、子 Session 和媒体的 ZIP，本次不采用。
- 参考实现的侧栏把运行状态画成行左侧的状态点，悬停时不隐藏，也不显示在项目分组上，并且不计 Background Job。Coko 按用户指定的右侧对齐规则和项目级显示实现。

### 已知后果

- 删除交接对话框后，失败交接的“复制摘要”入口随之消失。HTTP 接口仍支持交接到 worktree，但界面只能经 `/handoff` 交接到当前目录。要在另一个 worktree 中工作，仍可以用新对话的 worktree 入口，与 [ADR 0016](../../docs/adr/0016-session-cwd-fixed-worktrees.md) 中“新建会话或交接”的路径一致，不改动 ADR。
- 旧的“列表不显示运行状态”只记录在当前行为说明中，没有 ADR 依据，本次只修改当前行为说明和对应的测试。

### 交付方式

本规格与 [design.md](design.md) 由 `to-tickets` 拆为 9 张实施票，阻塞关系写在各票的 Blocked by 中：

- [01 侧栏“执行中”转圈](issues/01-sidebar-running-indicator.md)
- [02 会话运行状态实时广播](issues/02-session-status-broadcast.md)
- [03 标题栏改为标题行与“对话”tab 行](issues/03-header-title-and-chat-tab.md)
- [04 移除标题栏的交接入口](issues/04-remove-header-handoff.md)
- [05 常驻“更多”菜单与 Session 下载](issues/05-more-menu-session-download.md)
- [06 “打开侧边栏”按钮](issues/06-open-sidebar-button.md)
- [07 输入框底部状态栏与 Token 用量](issues/07-status-bar-token-usage.md)
- [08 状态栏的会话统计](issues/08-status-bar-session-stats.md)
- [09 联合验收与交付核对](issues/09-integrated-acceptance.md)

用户显式启动实施流程之后，各票分别实施，验证证据记入各票的 Comments。09 做联合验收，并把整体交付状态记入本文。长期有效的结论提炼到所属的正式文档。

## 联合验收与交付记录

2026-11-04：01—08 的能力已逐项核对，09 在集成基线 `b02c800b` 上完成组合验收；09 的代码与测试提交为 `c2443fcb`。这次交付是本地分支交付，没有推送、合入主分支或发布。两轴评审在 `implement-spec` 的集成步骤中另行完成，不以这些测试代替评审。

### 场景与证据

| 场景 | 已核对的证据与结果 |
| --- | --- |
| AC-01、04、06 | 真实 App 状态栏 Browser 覆盖 22px 空行、4px/22px/4px 几何、归档/移除 worktree/审批/确认卡切换且同一状态行不重挂载；最终 Electron 的显式 faux 分桶报告得到 250 tok，轮步与独立 Trace 请求事实一致，重载后读数不变。 |
| AC-02、03 | 统计纯函数与用量 Browser/协议 E2E 覆盖多 Run、重试、辅助请求、缺失/零值、TTFT/TPS、工具审批等待、子 Session 排除与持久化读回；结果见 07、08 的 Comments。最终联合测试使用真实 Job、具名子代理和 Schedule，辅助通知产生的实际主循环请求同样计入步数。 |
| AC-05 | 两卡直接切换、外点与 Escape、边缘避让与焦点返回均已验证。09 的 Browser 回归曾在“统计→Token→Escape”时失败，焦点错误地回到统计；关闭卡片不再从另一张已打开卡片抢焦点，修复后 Browser 与静默 CDP 均回到 Token 胶囊。 |
| AC-07、08、10 | 48px 标题、单一选中 tab、三项移除、隐藏连接播报与新对话就绪信号、四个状态入口的顺序、独立 Tooltip、右栏关闭后的焦点已核对。所有状态入口同时存在时的 390px 检查覆盖原生安全区与控件命中区。 |
| AC-09 | `/handoff` 的真实 Electron 场景通过；真实 App 的完成/失败/重试/历史补发测试通过，历史补发不切换 Session 或重新弹失败 Toast。 |
| AC-11、12 | 最终 Electron 下载测试通过：JSONL 文件名、header、子 Session、脱敏，以及 Trace 的同内容 NDJSON；Browser 验证同 Session 共用导出锁、失败 Toast 和键盘菜单。静默 agent-browser 另下载一份真实 JSONL，包含 26 条 Entry、2 个 Session。原生保存框的视觉行为未验证，见下文范围。 |
| AC-13、14、17 | 最终 Electron 的未打开 Session 场景通过；真实 Sidecar 覆盖根 Run、后台审批/取消、Teammate idle/rearm、Background Job 排除与重启；store 覆盖广播与快照/DTO 交错。静默 CDP 另检查后台转圈、项目收起聚合与取消清除。 |
| AC-15、16 | 真实 App Browser 与静默 CDP 覆盖 Session/项目的 hover 替换，Browser 另覆盖键盘、菜单保持、减少动态效果、置顶与排序。 |
| AC-18 | 最终 Electron 对 zh/en × light/dark 的四种组合均在 390 CSS px 核对卡片、菜单、焦点、10 个标题栏操作的真实边界及无主区横向偏移；静默 CDP 另检查 1280px、390px、明暗主题、中文与英文。 |

### 最终检查

以下命令均退出 0。选择最小相关集，不将局部通过描述为全仓通过；01—08 中未受 09 的局部 UI 修复影响的服务端与协议证据继续有效。

- `pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-status-bar.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-menu.browser.test.tsx apps/desktop/src/renderer/features/sidebar/sidebar-activity.browser.test.tsx packages/ui/src/guards/style-guard.test.ts`：5 文件、88 项通过。
- `COKO_E2E_SCREENSHOT_DIR=/Users/chenzheng/Documents/Codex/2026-11-04/conversation-status-header pnpm run test apps/desktop/e2e/conversation-status-header.e2e.test.ts apps/desktop/e2e/session-download.e2e.test.ts apps/desktop/e2e/session-status.e2e.test.ts apps/desktop/e2e/handoff.e2e.test.ts`：4 文件、4 项真实 Electron 测试通过，globalSetup 构建本次应用。整理测试诊断和几何断言后，同环境单独复跑 `apps/desktop/e2e/conversation-status-header.e2e.test.ts`：1 项通过。
- 修复前的组合相关集：`pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-status-bar.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-menu.browser.test.tsx apps/desktop/src/renderer/features/sidebar/sidebar-activity.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-statistics.test.ts apps/desktop/src/renderer/stores/chat-store.test.ts apps/server/src/application/hub.test.ts tests/integration/sidecar-session-status.test.ts tests/integration/secrets-gate-trace.test.ts packages/ui/src/guards/style-guard.test.ts`：10 文件、125 项通过。09 后续只改 UI 与组合测试，因此其中 store、Hub、Sidecar、Secret 与统计纯函数证据仍有效；UI/样式由上述 88 项及最终 Electron 重新验证。
- `pnpm run typecheck` 通过；上述 4 个变更 TS/TSX 文件的 `pnpm exec oxlint`、5 个变更源码/测试/CSS 文件的 `pnpm run format` 与 `git diff --check` 通过。提交 hook 同样运行格式与 lint，未跳过。
- `pnpm run check:docs`：319 个 Markdown、0 问题。已从 AGENTS → docs/README 回读 projects、workbench、goal、handoff、tracing、protocol，以及相关导航；行为、事实归属、引用方向、生命周期与当前入口一致。新增窄标题栏事实归 workbench，正式文档不依赖本任务。

09 发现并修复两处组合缺陷：一是上述切卡后焦点；二是全状态标题栏在 390px 裁掉行尾操作，聚焦又让 `overflow: hidden` 的主区横向偏移 70px。后者的 Electron 回归在修复前明确失败（期望 0、实际 70），修复后为 0；将同一份导航控制条移到 tab 行的局部重排没有缩小命中区、隐藏操作或修改全局 token。

### 静默 Electron 与产物

agent-browser 会话为 `status09-998311604c41`，应用通过以下实际入口启动：`COKO_E2E_BACKGROUND=1 COKO_USER_DATA_DIR=/var/folders/fm/kpyn8kps2132fdlzztk20vsm0000gr/T/coko-status09-visual-CsvEA5/user-data COKO_HOME=/var/folders/fm/kpyn8kps2132fdlzztk20vsm0000gr/T/coko-status09-visual-CsvEA5/coko-home COKO_CHATS_ROOT=/var/folders/fm/kpyn8kps2132fdlzztk20vsm0000gr/T/coko-status09-visual-CsvEA5/chats COKO_FAUX_SCRIPT=/var/folders/fm/kpyn8kps2132fdlzztk20vsm0000gr/T/coko-status09-visual-CsvEA5/faux.json pnpm --filter @coko/desktop exec electron-forge start -- --remote-debugging-port=9222`。前置取消 `ELECTRON_RUN_AS_NODE`；使用独立用户数据和 Coko 目录，没有读写真实用户配置。

`agent-browser --session status09-998311604c41 connect 9222` 后执行 snapshot、hover、click、press、390/1280 viewport、screenshot；`download @e103 /Users/chenzheng/Documents/Codex/2026-11-04/conversation-status-header/coko-session-86f65d88-6394-41b8-87cb-b804aeef3490.jsonl` 实际写出文件并读回 header、Entry 数和 Session 数。菜单打开、两卡位置、切换后的焦点、后台与项目指示及 hover 隐藏均在静默 CDP 中观察。此处的下载由 CDP 指定保存路径，没有据此宣称观察到默认原生保存框。

产物位于 `/Users/chenzheng/Documents/Codex/2026-11-04/conversation-status-header/`：`en-light-390-statistics.png`、`en-light-390-tokens.png`、`zh-dark-390-tokens.png`、`zh-dark-390-menu.png`、后台 Session 与项目的宽屏截图，四种 zh/en × light/dark 的 `*-390-electron.png` 和 `*-geometry.json`，以及上述 JSONL 与合成的 `faux-visual.json`。截图已读回检查。

已关闭 agent-browser 会话与 Forge 应用，并确认本次捕获的 Electron `25423`、Sidecar `25495`、renderer `25504` 及 Forge 祖先进程退出，9222 不再监听。只清理本次实例，没有结束其他应用。真实 OS 指针、红绿灯、原生标题栏/材质和保存框、真实模型、CI 与发布/签名产物未验证；未运行全仓测试，也未推送或发布。

### 两轴评审与修复

2026-11-04：使用两个新的只读子代理评审 `25d4228e...131e69e6`。Standards：0 项发现；Spec：1 项 P2，已由另一个新的实施子代理在 `4a9725de` 修复，没有复用实施或评审子代理。问题是“恢复归档响应延迟 → 收到运行广播 → 新列表刷新并清理广播覆盖记录 → 旧响应写回”的顺序会把执行中改为空闲，违反 RUN-05 的旧 DTO 保护。

已有列表行的执行状态由最新接受的快照或广播持有，操作 DTO 只更新元数据；普通与归档缓存暂时同时存在该 Session 时优先使用操作目标列表的行。新快照仍能修正断线期间漏掉的结束广播，旧 DTO 不能在快照之后重新制造转圈。未加载的 Session 仍合并已收到的广播，无已有状态时以 DTO 初始化。协议正文和 design 已同步这一实现边界，产品语义不变。

回归先在真实 ChatStore 的恢复入口失败（刷新后为执行中，延迟 DTO 后变为空闲），修复后通过；另覆盖归档目标列表的快照优先级，以及普通/归档列表中“漏结束广播 → 重连快照改为空闲 → 延迟活跃 DTO”的相反方向。`pnpm run test apps/desktop/src/renderer/stores/chat-store.test.ts apps/desktop/src/renderer/stores/chat-store-archive.test.ts packages/protocol/src/readme.test.ts apps/desktop/src/renderer/features/sidebar/sidebar-activity.browser.test.tsx`：4 文件、42 项通过；`pnpm run typecheck`、两份变更 TS 的 oxfmt/oxlint、`git diff --check` 和 `pnpm run check:docs`（319 Markdown、0 问题）均退出 0。已有 Electron、Sidecar、静默 CDP 与视觉证据未被这次列表 DTO 合并修复推翻，未重复构建、未运行全仓测试。此次交付仍为本地分支，未推送或发布；原生层等未验证范围保持不变。
