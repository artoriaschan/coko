# 自动审查模式：规格

Status: ready-for-agent
Spec status: delivered（2026-11-20 实施票 01–10 合入集成分支 `feat/auto-review`，验收与未验证项见[票 10](issues/10-acceptance-and-docs.md)；此前 approved：2026-11-20 向用户列出六处测试接缝与 Further Notes 的补充决定，用户答复“确认”并调用 `/to-tickets`）
讨论：[grilling.md](grilling.md) · 设计稿：[design.md](design.md) · 实施票：[01](issues/01-design-and-adr.md)、[02](issues/02-auto-review-mode-value.md)、[03](issues/03-reviewer-allow-and-escalate.md)、[04](issues/04-escalation-reason-and-failures.md)、[05](issues/05-authorization-sources-and-injection.md)、[06](issues/06-goal-schedules-and-budget.md)、[07](issues/07-reviewing-state-and-timing.md)、[08](issues/08-subagent-review.md)、[09](issues/09-headless.md)、[10](issues/10-acceptance-and-docs.md) · 决定：[ADR 0029](../../docs/adr/0029-auto-review-delegates-final-ask.md) · 现状：[权限判定与审批](../../docs/subsystems/permissions.md) · 相关决定：[ADR 0005](../../docs/adr/0005-permission-mode-and-sandbox.md)、[ADR 0013](../../docs/adr/0013-external-hooks-tighten-only.md)、[ADR 0014](../../docs/adr/0014-subagents-as-child-sessions.md)、[ADR 0019](../../docs/adr/0019-headless-runs-deny-approvals.md) · 前置：[计划生命周期规格](../plan-lifecycle/spec.md) 的阶段一 · 术语：[GLOSSARY](../../GLOSSARY.md)

本规格以计划生命周期阶段一已交付为基线：Permission Mode 只有 read-only、default、accept-edits、full-access 四档，`plan` 不再是模式取值，计划审阅卡使用现有的模式菜单组件。阶段一交付前本规格的实施票不能开始。

## Problem Statement

用户让 Agent 做一件事时，要在两种不合适的授权档位之间选：

- **“请求批准”与“帮我批准”下打扰太多。** 每条没有被允许规则覆盖的命令、每次 MCP 工具调用、每次 Workspace 之外的读取都要用户点一次。绝大多数是 `ls`、跑测试、查 git 状态这类明显无害、也明显在任务范围内的动作。用户要么守着点批准，要么回来发现 Agent 停在第一张卡片上。
- **“完全访问权限”没有任何人把关。** 它同时去掉了审批与命令沙箱，Agent 被网页或文件里的注入内容带偏时，没有任何一层会停下来问。
- **允许规则解决不了没见过的命令。** 规则只能覆盖用户已经想到的命令形状；Agent 每次换一种写法都要重新询问。
- **“帮我批准”的名字让人以为有人在把关。** 它只自动放行可写根内的文件编辑，并不判断命令是否安全。

用户想要的是：平常的动作不用问我，出格的动作必须问我，并且有人替我分辨这两者。

## Solution

新增一个 Permission Mode：**自动审查**（`auto-review`）。

- **平常的动作自动放行。** 在这个模式下，原本要弹审批卡的调用先交给一个 Reviewer。Reviewer 是一次独立的模型请求，它对照用户说过的话判断这个动作是否在授权范围内、是否属于高危类别。判断为可以就直接执行，工具卡上标明“已由自动审查允许”并可查看理由。
- **拿不准或高危的动作照旧问用户。** Reviewer 不放行时，用户看到的是普通的审批卡，卡上多一行 Reviewer 的理由。Reviewer 自己不能拒绝调用；审查超时、出错或看不懂输出时也一律问用户。
- **硬边界不交给模型。** 拒绝规则、询问规则、Protected Path、越出可写根的写入、Escalation、计划审阅都与现在完全一样，Reviewer 碰不到。命令仍在 workspace-write 沙箱里运行，Reviewer 看走眼的命令也写不出 Workspace。
- **花费看得见、管得住。** 审查请求计入该 Run 的用量和 Goal Budget。

模式菜单变为四项：请求批准、帮我批准、自动审查、完全访问权限。“帮我批准”的名字与行为都不变。

## User Stories

**选择与显示**

1. As a 用户, I want 在模式菜单里选择“自动审查”, so that 我能让 Agent 在不逐条打扰我的前提下继续工作。
2. As a 用户, I want 菜单中“帮我批准”与“自动审查”的说明能一眼分清谁只放行文件编辑、谁由模型判断命令, so that 我不会选错档位。
3. As a 用户, I want “自动审查”的说明写明由模型判断、可能误判、命令仍受沙箱限制, so that 我清楚自己委托出去的是什么。
4. As a 用户, I want 选择“自动审查”时不弹确认框, so that 切换和其他普通档位一样快。
5. As a 用户, I want 输入区的权限按钮显示“自动审查”及其图标, so that 我随时看得出当前档位。
6. As a 用户, I want 用 Shift+Tab 在只读、请求批准、帮我批准、自动审查之间循环, so that 我不用鼠标就能切到常用档位。
7. As a 用户, I want Shift+Tab 的循环不包含“完全访问权限”, so that 我不会误触进入没有沙箱的档位。
8. As a 用户, I want 把“自动审查”设为新会话的默认模式, so that 我不用每次新建对话都切换。
9. As a 用户, I want 在计划审阅卡上把执行权限选为“自动审查”, so that 我看过计划后可以放手让它执行。
10. As a 用户, I want Run 进行中切换到或切出“自动审查”立即作用于下一次调用, so that 行为与其他模式切换一致。
11. As a 用户, I want 已保存“帮我批准”的旧会话名字与行为都不变, so that 新功能不会悄悄改变我已有会话的授权。

**审查放行**

12. As a 用户, I want 明显在任务范围内的无害命令不再弹审批卡, so that Agent 能连续工作。
13. As a 用户, I want MCP 工具调用也先经审查, so that 只读查询类的外部工具不用我逐次批准。
14. As a 用户, I want Workspace 之外的读取也先经审查, so that 读文档或依赖源码不打断，而读凭据文件仍会问我。
15. As a 用户, I want 带 Worktree 隔离的 Subagent 派发也先经审查, so that 常规的并行派发不用我点。
16. As a 用户, I want 审查放行的命令仍在 workspace-write 沙箱中运行, so that 即使判断错了它也写不出 Workspace。
17. As a 用户, I want Workspace 内读取与可写根内的文件编辑不经审查直接放行, so that 这些本来就免审批的动作不增加延迟与费用。
18. As a 用户, I want 已被允许规则覆盖的调用不经审查, so that 我写过的规则继续直接生效且不花钱。
19. As a 用户, I want 工具卡上标出“已由自动审查允许”并能展开查看理由, so that 我事后能核对它为什么放行。
20. As a 用户, I want 审查进行时工具卡显示“自动审查中”, so that 一次慢审查不会看起来像界面卡死。

**转交给我**

21. As a 用户, I want Reviewer 拿不准时出现普通的审批卡, so that 最终决定仍在我手里。
22. As a 用户, I want 审批卡上显示 Reviewer 为什么没有放行, so that 我不用自己从头分析这条命令。
23. As a 用户, I want 转交来的审批卡照常提供“总是允许”, so that 我认可的命令形状以后不再经审查。
24. As a 用户, I want 删除或覆盖 Workspace 外的数据、不可逆的 git 操作与推送、发布或部署、把内容或凭据发往外部、读取凭据类文件、下载后直接执行、安装全局软件或改系统配置这些动作一律问我, so that 高危动作不会被模型代为批准。
25. As a 用户, I want 明显超出我要求范围的动作问我, so that Agent 不会借着一个小任务做别的事。
26. As a 用户, I want 创建与修改定时任务始终问我而不经审查, so that 以后无人值守的持续行为由我亲自批准。
27. As a 用户, I want Reviewer 不能直接拒绝调用, so that 误判只会多一张卡片，不会让 Agent 绕路或让 Run 中断。
28. As a 用户, I want 我拒绝转交来的调用时，行为与现在的拒绝完全一样, so that 带反馈与无反馈拒绝的语义不变。

**硬边界**

29. As a 用户, I want 拒绝规则在“自动审查”下照常拒绝, so that 我禁止的事模型批准不了。
30. As a 用户, I want 询问规则命中的调用直接问我而不经审查, so that 我点名要亲自过目的调用不被代答。
31. As a 用户, I want 写入 Protected Path 直接问我而不经审查, so that `.git`、shell 配置等位置不会被模型放行。
32. As a 用户, I want 越出可写根的文件写入直接问我而不经审查, so that 越界写入仍是我每次亲自批准的提权。
33. As a 用户, I want 沙箱 Escalation 直接问我而不经审查, so that 放宽沙箱始终是我的决定。
34. As a 用户, I want 计划审阅直接问我而不经审查, so that 计划仍由我批准。
35. As a 用户, I want 外部 Hook 的拒绝与强制询问优先于 Reviewer, so that 我配置的确定性检查不被模型越过。
36. As a 用户, I want PermissionRequest Hook 先于 Reviewer 回答, so that 能由脚本免费决定的调用不花模型费用。
37. As a 用户, I want 项目设置中的拒绝与询问规则在“自动审查”下照常收紧, so that 仓库里的约束不因我选了这个档位而失效。

**审查失败**

38. As a 用户, I want 审查超时后出现审批卡, so that Agent 不会无限等待，也不会未经判断就执行。
39. As a 用户, I want 审查请求报错或返回看不懂的内容时出现审批卡, so that 模型服务故障不会变成自动放行。
40. As a 用户, I want 会话没有可用模型时出现审批卡, so that 配置问题不会变成自动放行。
41. As a 用户, I want 审批卡说明自动审查没有完成及其原因, so that 我知道这张卡片为什么出现。
42. As a 用户, I want 待审的调用内容太长而无法完整交给 Reviewer 时直接问我, so that 它不会在没看全的情况下放行。

**抗注入与授权来源**

43. As a 用户, I want Reviewer 看不到工具结果、助手正文与思考, so that 网页、文件或 MCP 返回里的指令无法说服它放行。
44. As a 用户, I want Reviewer 只把我亲自输入的消息、当前 Goal 的目标与 Success Criterion、已批准的 Plan 当作授权, so that 模型自己写的文字不能给自己授权。
45. As a 用户, I want 压缩摘要、Subagent 的派发说明、定时任务的提示词只作为“助手委派的任务”给 Reviewer 参考, so that 它们能帮助判断上下文但不算我的授权。
46. As a 用户, I want Reviewer 的理由不进入主模型的上下文, so that 主模型学不到如何改写命令来通过审查。
47. As a 用户, I want 审查请求与保存的理由中没有已登记的 Secret 明文, so that 审查不会成为新的泄露通道。

**Subagent、Goal 与定时任务**

48. As a 用户, I want 根 Session 为“自动审查”时 Subagent 的调用同样经审查, so that 派发子代理不会重新变成逐条询问。
49. As a 用户, I want 审查 Subagent 的调用时以根 Session 中我说过的话为授权, so that 主模型写给子代理的说明不能扩大授权。
50. As a 用户, I want Subagent 定义里的 `permission-mode` 能把它压到比“自动审查”更窄, so that 我能让某类子代理始终逐条询问。
51. As a 用户, I want Subagent 定义的 `permission-mode` 可以写 `auto-review` 作为上限, so that 根 Session 为“完全访问权限”时这类子代理仍受审查与沙箱约束。
52. As a 用户, I want Goal Round 在“自动审查”下被转交的调用照常等我, so that 无人值守的推进不会越过我。
53. As a 用户, I want 定时任务的 Run 在“自动审查”下同样经审查, so that 定时任务不会卡在每一条命令上。
54. As a 用户, I want 审查请求计入 Goal 的 Token 与费用预算, so that 审查不会成为预算之外的开销。
55. As a 用户, I want Goal Budget 耗尽后不再发出审查请求, so that 预算上限对审查同样有效。
56. As a 用户, I want 审查的 Token 与费用计入该 Run 的用量, so that 我看到的花费是完整的。

**切换与时序**

57. As a 用户, I want 审查途中我切换了模式，这次审查的结果作废并按新模式处理, so that 我切到更严的档位时不会有一条调用带着旧结果溜过去。
58. As a 用户, I want 切换到“自动审查”时已经在等我的审批卡保持不变, so that 我正在看的卡片不会突然消失。
59. As a 用户, I want 同一批的多个调用按顺序逐个审查, so that 卡片与工具卡的出现顺序与现在一致。
60. As a 用户, I want 停止或暂停 Run 时正在进行的审查被取消, so that 停止之后没有调用因迟到的审查结果而执行。

**无界面运行与集成**

61. As a 无界面运行的使用者, I want `--permission-mode auto-review` 被接受, so that 脚本与 CI 里也能让模型放行常规动作。
62. As a 无界面运行的使用者, I want Reviewer 转交的调用被立即拒绝并说明没有审批者, so that 进程不会挂起等待。
63. As a 无界面运行的使用者, I want `--on-approval fail` 对转交后的拒绝同样生效, so that 我能让流水线在需要人工决定时失败。
64. As a 集成方, I want 切换模式、首次发送与默认模式的接口接受 `auto-review`, so that 我能经协议使用这个档位。
65. As a 集成方, I want 审批决定条目标明回答者是 Reviewer 并带理由, so that 回放与审计能区分用户、Hook、无界面运行与 Reviewer 的决定。
66. As a 集成方, I want 审查请求在追踪中以独立的 purpose 记录, so that 我能单独统计审查的次数、耗时与花费。
67. As a Hook 作者, I want Hook 输入中的权限模式为 `auto-review`, so that 我的脚本能按实际档位判断。

**历史数据**

68. As a 用户, I want 旧会话的权限与审批记录读取不受影响, so that 升级后打开旧对话不出错。
69. As a 用户, I want 从“自动审查”的会话分叉或交接出的新会话沿用同一模式, so that 行为与其他模式一致。

## Implementation Decisions

### 模式取值与确定性判定

- **新增取值 `auto-review`。** Permission Mode 为 read-only、default、accept-edits、auto-review、full-access 五档。`accept-edits` 的语义不变。
- **宽窄排序** 为 read-only < default < accept-edits < auto-review < full-access，仍由唯一的宽窄比较给出。Subagent 取窄、计划审阅卡对执行权限的约束、其他用到宽窄比较的位置都按此顺序，不加特例。
- **判定七步不变。** `auto-review` 的模式放行与 `accept-edits` 逐项相同（包括各权限类在“模式放行”一步的行为）；Sandbox Mode 为 workspace-write，可写根与 `accept-edits` 相同。判定纯函数不认识 Reviewer，它对 `auto-review` 的输出与对 `accept-edits` 的输出一致。
- **`permission_mode` 条目按现有先例升一版**，取值加入 `auto-review`，旧版本恒等迁移，不改写数据库行。
- **接受新取值的入口：** 切换 Session 模式、首次发送的权限字段、默认模式设置、无界面运行的 `--permission-mode`、Subagent 定义的 `permission-mode`、评测用例的权限模式。项目设置文件中的默认模式照旧被忽略。

### Reviewer 在判定中的位置

- **Reviewer 是权限 gate 的一个新端口**，与外部 Hook 的端口并列，由运行时提供实现；没有端口时 gate 的行为与现在相同。
- **只在以下条件同时成立时调用：** 判定时的模式为 `auto-review`；与 PreToolUse Hook 组合后的最终结论是来自判定第 7 步的询问（不是 Hook 的强制询问）；PermissionRequest Hook 没有给出决定；调用的权限类不是 automation。
- **不调用 Reviewer 的询问：** 询问规则、Protected Path、越出可写根、Escalation（含效果固定在更宽档位的调用）、计划审阅、Hook 的强制询问、automation 类、执行前复核产生的询问。它们照旧直接问用户。
- **回答顺序：** PermissionRequest Hook → Reviewer → 用户（无界面运行为立即拒绝）。Hook 拒绝时不调用 Reviewer。
- **审查结果生效前按当时的模式与规则复核一次。** 审查期间模式或规则变了，结果作废，按新判定处理：新判定放行则执行，拒绝则以规则拒绝，仍需询问且模式仍是 `auto-review` 时不重审，直接问用户。
- **每次调用至多审查一次。** 用户回答之前的重新判定、“总是允许”保存后的重新判定都不触发审查；切换到 `auto-review` 时已在等待的请求保持等待。
- **同一批调用按现有顺序逐个审查**，不并发；审查结果不缓存。
- **停止或暂停 Run 时取消进行中的审查**，该调用按现有的“停止或暂停时未批准”处理。

### 审查请求

- **模型与参数。** 使用 Session 当前模型，与会话标题请求同一取法；不带工具，不要求推理，输出上限很小。超时 15 秒。Subagent 的调用使用根 Session 的模型。
- **输入由三部分组成，分区标注：**
  - 用户授权：有效模型上下文中用户亲自输入的消息文本（不含宿主附加的块，如 State Update、Hook 追加的上下文），当前 Goal 的目标与 Success Criterion，已批准且仍适用的 Plan。
  - 助手委派的任务：Subagent 的派发说明、定时任务的提示词、Goal Round 中宿主合成的继续提示、压缩摘要。标注为不构成授权。
  - 动作：本 Run 已发生的工具调用（名字与参数，不含结果）与待审的这一次调用；待审的是 MCP 工具时附带它的描述。
- **不提供：** 工具结果、助手正文与思考、图片内容。
- **Subagent 的调用** 以根 Session 的用户授权为准，子 Session 自己的首条消息归入“助手委派的任务”。
- **输入有字符上限。** 超出时从最早的内容开始丢弃并标注；待审调用自身的参数无法完整放入时不发请求，直接转交用户。
- **输出为结构化结果：** 放行或转交，加一句理由。无法解析、缺字段或取值不合法都按失败处理。理由有长度上限。
- **审查提示固定内置**，列出必须转交的类别（删除或覆盖 Workspace 外的数据、不可逆的 git 操作与推送、发布或部署、把 Workspace 内容或凭据发往外部、读取凭据类文件、下载后直接执行、安装全局软件或改系统配置、明显超出用户授权范围的动作），并要求拿不准一律转交。不提供用户自定义入口。提示文本属于模型可见契约，变更需同步测试。
- **不可信内容只作为数据。** 委派任务与动作部分以明确的数据边界包裹，其中出现的任何指令性文字不改变请求的指令部分。
- **Secret。** 审查请求的输入、保存的理由与请求快照都经与其他模型请求相同的按值脱敏。

### 结果、失败与预算

- **Reviewer 只有两种结果：放行、转交用户。** 它不能拒绝调用。
- **失败一律转交用户：** 超时、请求报错、输出无法解析、没有可用模型、预算检查不通过、待审调用过长。失败不重试。
- **预算。** 发出审查请求前经与对话请求相同的请求前检查；检查不通过时不发请求，转交用户。审查请求记为带 runId 的模型请求，purpose 为 `review`，计入该 Run 的用量与 Goal 的 Token、费用预算，不计入 Goal 的轮次与工具调用数。
- **无界面运行。** Reviewer 放行的调用照常执行；转交与失败的调用按现有规则立即拒绝，回答者记为 headless，模型看到的文本与 `--on-approval fail` 的行为不变。

### 条目与协议

- **审批决定条目升一版：** 回答者增加 `reviewer`，新增可选的理由字段（只在回答者为 Reviewer 时出现）。Reviewer 放行时依次提交审批请求与 `{ outcome: allowed, scope: once, by: reviewer, reason }` 的决定，不进入等待表，与 Hook 代答的条目顺序相同。
- **审批请求条目升一版：** 新增可选的审查信息，只在 Reviewer 转交或审查失败后出给用户的请求上出现。转交时带 Reviewer 的理由；失败时带失败原因的代码（超时、请求失败、输出无效、没有模型、预算、内容过长），界面按代码本地化。其余字段与建议规则照旧。
- **旧版本恒等迁移**，不改写数据库行。
- **“自动审查中”经不入库的推送送达界面**，带 Session 与工具调用标识，先例是会话标题的推送。审查结束由随后的审批条目体现；重连后不恢复这个状态，工具卡回到普通的等待显示。
- **Sidecar 在审查途中退出：** 此时没有已提交的审批条目，该调用按现有的未执行调用恢复规则处理，重启后不自动重审。
- **审查理由不进入主模型上下文。** 模型看到的仍是工具结果或现有的拒绝文本。
- **追踪的 purpose 增加 `review`**；审计中的权限模式事件自然包含新取值，不新增事件类型。
- **外部 Hook** 输入中的权限模式为 `auto-review`，不新增字段。

### 界面

- **模式菜单四项：** 请求批准（`default`）、帮我批准（`accept-edits`）、自动审查（`auto-review`）、完全访问权限（`full-access`）。“帮我批准”与“自动审查”的说明文字须能区分“只自动放行文件编辑”与“由模型判断其余调用”。“自动审查”有自己的图标，使用普通档位的颜色，不使用 destructive 色，选择时不确认。read-only 照旧不在菜单中。
- **Shift+Tab 循环** 为 read-only → default → accept-edits → auto-review，从 full-access 回到 read-only。
- **设置页默认模式** 的选项加入“自动审查”。
- **计划审阅卡** 上的模式菜单随组件得到新项，受“不得宽于进入规划前的模式”的既有约束。（更正：现状没有这条约束，ADR 0028 已移除；审阅卡随 `ModePicker` 得到“自动审查”一项，不新增约束，见 [设计稿的事实更正](design.md#对规格的事实更正)。）
- **工具卡：** 审查进行时显示“自动审查中”；Reviewer 放行后标题行显示“已由自动审查允许”，展开可读理由。
- **审批卡：** 请求带审查信息时，在明细中显示 Reviewer 的理由，或“自动审查未完成”及原因；其余键盘、焦点、“总是允许”与拒绝交互不变。
- **文案** 中英文同时提供。

### 文档与决定

- 新写一份 ADR（取实施时的下一个编号）：用户可以把判定最后一步的询问委托给模型，硬边界不可委托；Reviewer 只能放行或转交；失败转交用户；审查纳入 Goal Budget。说明它细化 ADR 0005 的“审批是用户的决定”，与 ADR 0013 拒绝 prompt 型 Hook 的区别（由用户显式选择模式、受预算约束），以及与 ADR 0019 的关系（显式给出模式即调用者的授权，没有审批者时转交仍为拒绝）。被否决的方案：改写 `accept-edits`、与模式正交的开关、Reviewer 可直接拒绝、失败即放行。
- 术语表新增 **Auto Review**（由模型代答最后一步询问的 Permission Mode）与 **Reviewer**（代答的那次模型请求），避免使用 auto mode、classifier；注明“帮我批准”是 `accept-edits` 的界面名，不是 Auto Review 的同义词。Permission Mode 的定义不需要改。
- 随实施更新的当前行为文档：权限判定与审批、外部 Hook、无界面运行、子代理、Goal（预算）、定时任务、追踪与审计、桌面工作台与界面约定中涉及模式菜单的部分，以及相关包的 README。

## Testing Decisions

- **好的测试只断言外部事实：** 经协议读回的条目与模式、faux 请求明细日志中实际发给模型的审查请求内容、磁盘上的文件、进程退出码、界面在真实浏览器中的输出。不断言内部函数的调用次数或中间结构。
- **不新增测试接缝，沿用现有六处：**
  - **真实 Sidecar 集成测试（主接缝）。** 以 Electron 内置 Node 启动 Sidecar，经 HTTP 与 WS 驱动，faux 模型。faux 脚本已支持按请求内容匹配应答（会话标题测试以系统提示中的标记匹配），审查请求用同样的方式匹配，不需要改 faux。先例：审批、权限、Hook、沙箱、Goal、子代理、定时任务与会话标题的集成测试。
  - **权限 gate 的运行时级测试。** 在 gate 上注入可编程的 Reviewer 端口。先例是注入假 Hook 端口的 gate 测试、无人回答的 gate 测试与重新判定测试。
  - **判定与沙箱的表测试。** 先例是按“模式 × 工具类型 × 权限类”展开的判定表与沙箱档位测试。
  - **条目版本测试。** 先例是 `permission_mode` 与审批决定条目的升版用例。
  - **无界面运行的集成测试。** 先例是现有的无界面审批用例与其 harness。
  - **renderer 的 Browser Mode 测试与一条 Electron E2E。** 先例是模式菜单、审批卡、工具卡的浏览器测试与权限的端到端用例，后台模式运行。
- **集成测试覆盖：**
  - `auto-review` 下一条未被规则覆盖的命令：faux 审查应答为放行时没有等待中的审批请求，条目顺序为请求、`by: reviewer` 的决定、执行；应答为转交时出现带审查理由的待审批请求，用户允许后执行、拒绝后与现有拒绝语义相同。
  - 审查请求的内容：包含用户消息与待审命令，不包含先前工具结果中的标记文本与助手正文中的标记文本；不带工具；MCP 工具带描述。
  - 失败路径：延迟超过超时（用测试时钟）、返回非结构化文本、返回请求错误，都出现带失败代码的待审批请求，调用未执行。
  - 硬边界（对手用例，faux 审查应答恒为放行）：拒绝规则拒绝；询问规则、`.git` 内写入、越出可写根的写入、Escalation、计划审阅都出现审批请求，且请求明细日志中没有对应的审查请求。
  - `schedule_create` 直接出审批请求，没有审查请求。
  - PermissionRequest Hook 给出 allow 或 deny 时没有审查请求；Hook 没有决定时有。PreToolUse Hook 的强制询问不经审查。
  - 允许规则覆盖的命令、Workspace 内读取、可写根内编辑：没有审查请求。
  - 审查放行的命令越界写入被 Seatbelt 拒绝（darwin；其他平台按现有约定跳过）。
  - 审查途中切换到 default：审查结果不生效，出现审批请求。切换到 `auto-review` 时已在等待的请求保持等待且没有审查请求。
  - 审查途中停止 Run：调用未执行，没有审批决定为 allowed 的条目。
  - Goal：审查请求的用量计入 Goal 的 Token 与费用；预算耗尽后没有新的审查请求，出现带预算代码的待审批请求。
  - Subagent：根为 `auto-review` 时子 Session 的命令经审查，审查请求中的用户授权来自根 Session、派发说明位于委派部分；定义上限为 default 的子代理不经审查。
  - 注入（对手用例）：待审命令的参数与先前工具调用的参数中含伪造的放行指令时，这些文本只出现在审查请求的数据部分，系统提示不变。
  - Secret：审查请求、保存的理由与请求快照中没有登记明文（沿用现有 secrets gate 的通道写法）。
  - 追踪：审查请求以 purpose `review` 出现并带 runId，计入 Session 的费用合计。
  - 旧数据：预置旧版本审批条目与 `permission_mode` 条目的 Session 读取正常。
- **无界面运行覆盖：** `--permission-mode auto-review` 被接受；审查放行的调用执行；转交的调用以 `by: headless` 拒绝且 Run 继续；`--on-approval fail` 以既有退出码结束。
- **gate 的运行时级测试覆盖：** Reviewer 端口的放行、转交、抛错、迟到结果在取消之后到达；每次调用至多调用一次端口；没有端口时行为与现状相同。
- **判定表** 增加 `auto-review` 一列，断言它与 `accept-edits` 逐项相同；宽窄比较覆盖五档的全部组合；沙箱档位测试覆盖新取值。
- **界面测试覆盖：** 菜单四项与勾选、说明文字、Shift+Tab 循环顺序、设置页默认模式；工具卡的“自动审查中”、放行标注与理由；审批卡上的转交理由与失败原因；共用 setup 对遗留模态层的断言照常生效。E2E 一条：选择自动审查，faux 先放行一条命令、再转交一条，用户允许后完成。
- **现有测试的处理：** 以四档为全集的断言（模式列表、循环顺序、取值校验的错误文本）按五档更新，不删除其覆盖的场景。
- **真实模型：** 本规格不设真实模型门槛。Reviewer 的判断质量（该放行的是否放行、该转交的是否转交、是否会被说服）不做自动化评估；faux 只验证链路与结构。交付时把“真实模型的审查质量”列为未验证。

## Out of Scope

- 移除 read-only 模式。
- 改写或改名“帮我批准”（`accept-edits`）。
- 单独的“审查模型”设置，以及用更便宜的模型做审查。
- 用户自定义审查策略、按项目配置审查提示。
- Reviewer 直接拒绝调用；连续转交后的熔断或自动降级。
- 审查结果缓存、同一批调用的并发审查、审查失败后的重试。
- 把审查用于硬边界（询问规则、Protected Path、越出可写根、Escalation、计划审阅）或用于 full-access。
- 向 Reviewer 提供工具结果或助手正文；让 Reviewer 调用工具或读取文件。
- 审查判断质量的评测用例与真实模型门槛。
- 网络与读取的沙箱限制（现状已排除）；本模式下命令的外发与读取只靠 Reviewer 判断。
- 审查状态的持久化与重连后恢复。
- 首次启用时的引导或确认流程。

## Further Notes

- **来源。** 产品决定来自 [grilling.md](grilling.md) 的 22 个已确认问题。事实核对来自阅读当前行为文档、相关 ADR，以及权限 gate、审批 broker、审批条目 schema、模式宽窄比较、会话标题请求、faux 脚本匹配、无界面参数校验与模式菜单的代码；未运行测试。
- **本规格补充的决定（讨论中没有逐条问过，请审阅时留意）：**
  1. Reviewer 是权限 gate 的新端口，判定纯函数不变；`auto-review` 在判定表中与 `accept-edits` 逐项相同。
  2. PreToolUse Hook 的强制询问与执行前复核产生的询问不经审查。讨论中只确定了“第 7 步的询问送审”，这两种询问虽然可能落在第 7 步，但前者是用户配置的脚本要求问用户，后者发生在已经判定过一次之后。
  3. 审查结果生效前复核模式与规则；变化后仍需询问的不重审，直接问用户。
  4. 待审调用的参数无法完整交给 Reviewer 时不发请求，直接问用户。
  5. 用户授权只取有效模型上下文中的用户消息。压缩之后更早的用户消息不再可见，Reviewer 会更多地转交；这是接受的代价，没有改为从条目库读取全部历史。
  6. Goal Round 中宿主合成的继续提示归入“助手委派的任务”。
  7. 条目形状：审批决定增加回答者 `reviewer` 与理由；审批请求增加审查信息（转交理由或失败代码）。
  8. “自动审查中”是不入库的推送，重连后不恢复；Sidecar 在审查途中退出后不自动重审。
  9. Subagent 定义的 `permission-mode` 接受 `auto-review`；Subagent 的审查请求使用根 Session 的模型。
  10. 审查不重试；审查请求不计入 Goal 的轮次与工具调用数。
  11. 转交来的审批卡照常提供“总是允许”建议规则。
- **已知的局限。**
  - 沙箱只约束文件写入。审查放行的命令仍可以读取 Workspace 之外的文件并访问网络，这部分只靠 Reviewer 的判断与用户的拒绝、询问规则。需要确定性保证的场景应写规则。
  - Reviewer 只看得到命令行本身，看不到命令将执行的脚本内容；同一个 Run 中先写后执行的脚本，其写入参数在审查输入中可见，更早 Run 中写入的不可见。
  - 每次送审增加一次模型请求的延迟，慢模型下连续的命令会明显变慢；允许规则是减少送审的手段。
- **与计划生命周期的关系。** 阶段一把 `plan` 移出 Permission Mode 并升版 `permission_mode` 条目，本规格在其上再加一档。阶段二（执行中的 Plan）交付后，“已批准且仍适用的 Plan”指执行中的 Plan；阶段二交付前指有效上下文中最近一份已批准的 Plan。
- **调查中发现的情况。** 评测项目的用例格式含权限模式字段，会随取值扩展接受 `auto-review`；它支持在有凭据时用真实模型运行，可作为以后评估审查质量的载体，本规格不使用。
