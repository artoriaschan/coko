---
kind: decision
description: "计划是独立的 Session 状态（无、规划中、执行中），不是 Permission Mode：规划期间文件写入直接拒绝、命令在只读沙箱中运行且不能提权，由计划流程施加；批准不改变 Permission Mode；计划延伸到执行中，以 complete_plan 的完成报告或用户放弃结束。局部替代 ADR 0005 中 plan 作为模式取值的部分。修改 Plan Mode、计划的生命周期、规划期约束或 Permission Mode 的取值时回看。"
status: accepted
implementation: partial
lifecycle: active
category: architecture
---

# 计划是独立的 Session 状态，不是 Permission Mode

## 上下文

Plan Mode 于 M4 以 [ADR 0005](0005-permission-mode-and-sandbox.md) 中的一句话加入：`plan` 成为第五个 Permission Mode 取值，模式放行与 read-only 相同、命令沙箱 read-only，`permission_mode` 条目另记进入前的模式 `prior`，批准计划、`/plan off` 与 Plan chip 回到它。这一形状沿用 claude-code，ADR 0005 注明它按常设指示采纳、未经用户逐条确认。

2026-11-20 用户核对 Plan Mode 的现状后提出“计划不应该属于权限模式”。当时的代码事实（只读调查，判定、沙箱、子会话注入、写入工具不经沙箱、审阅时输入区隐藏五处对照代码复核）：

- **权限被规划顶掉。** “是否在规划”“是否注入 `<plan_mode>` 与注册 `exit_plan_mode`”“本次规划从哪里算起”都从“当前模式是否为 `plan`”推出。在完全访问权限下进入规划后，每条命令与 MCP 调用都要审批；模式菜单在 plan 时三项都不勾选，Shift+Tab 从 plan 落到 read-only；批准时只能回到 prior 或更窄的模式。
- **“不改 Workspace”不成立。** plan 的可写根为空，`write` / `edit` 落到“越出可写根”的询问，用户点允许就真的写入；命令被只读沙箱拒绝后还能申请单次提权。约束靠用户每次都不点。
- **计划在批准时结束。** 批准只提交 approved 的计划条目并恢复模式，之后没有“执行中”的状态、没有对照计划的汇报；执行跨 Run 时下一个 Run 不知道有一份没做完的计划，只有压缩后的 `<approved_plan>` 再注入。
- **审阅时改不了权限。** 审阅卡接管输入区后模式菜单与 Shift+Tab 不可用，而批准后同一个 Run 立即继续执行。
- **连带。** 子代理在父会话规划时有效模式恒为 read-only，却被注入要求调用它没有的 `exit_plan_mode` 的说明；外部 Hook 收到 `plan` 而不是真实模式；无界面运行接受 `--permission-mode plan`，而无人审阅时计划必然被拒绝。

同日用户调用设计讨论（`/grill-me`），四轮共 24 个问题均答复“全部采用推荐”，并确认了完整清单；随后调用 `/to-spec` 与 `/to-tickets`，对“启动拆票视为规格通过”答复“确认”。本页的决定与理由提炼自这些已确认的结论，适用于根 Session 与子代理的子 Session。

## 决定

- **计划阶段是独立的 Session 状态。** 每个 Session 有一个计划阶段：无、规划中、执行中（执行中关联一份 Plan）。它以自己的 Session Entry 记录转换，与 Permission Mode 互不改写。Permission Mode 只有 read-only、default、accept-edits、full-access 四档，回答“哪些动作要先问”；计划阶段回答“处在流程的哪一步”。一个 Session 同一时刻至多一份活动的 Plan：规划中没有执行中的 Plan，执行中不同时规划。
- **规划期约束由计划流程施加，并且是硬性的。** 规划中：
  - 文件写入工具（edit 权限类）一律直接拒绝，不询问：位置紧随拒绝规则之后，先于询问规则、受保护路径、越出可写根、模式放行与允许规则；外部 Hook 的 allow 不能免掉，Hook 的 deny 仍然优先。
  - 命令在 read-only 沙箱中运行（可写根为空），不接受沙箱提权；效果固定在更宽档位的调用（向较宽档位启动的终端输入）被拒；带 Worktree 隔离的子代理派发被拒。
  - 其余调用（读取、命令与 MCP 是否询问、记忆、Todo List 与 Goal 工具）按当前 Permission Mode 与规则照常判定。
  - 子代理的子 Session 取根 Session 的计划阶段，受同样的约束；它的有效 Permission Mode 是父 Session 模式与定义上限中较窄者，不因规划压成 read-only。
- **只由用户进入规划。** 入口是 `/plan` 与协议中 Session 的计划接口；不提供模型可调用的进入工具，Permission Mode 的切换接口与无界面运行不再接受 `plan`。
- **批准不改变 Permission Mode。** 模型用 `exit_plan_mode` 提交计划，用户审阅（可编辑）后批准或带反馈让它继续规划。批准只结束规划，执行使用批准时 Session 的 Permission Mode；用户在审阅卡上可以先切换它。
- **计划延伸到结果反馈。** 批准后计划进入执行中：模型被要求先拆成 Todo List、执行并验证，再以 `complete_plan` 提交对照计划的完成报告，计划变为已完成。提交报告不需要审批，宿主不校验内容、不运行验证。执行跨多个 Run 时以 State Update 告诉模型有未完成的计划（[ADR 0024](0024-session-state-as-state-updates.md)）。用户可随时放弃（`/plan off`、Plan chip 的 ×），放弃不撤销已做的改动；执行中再 `/plan` 先放弃当前计划，再开始新一轮规划。
- **不承诺。** 宿主不因执行中的计划自动发起 Run，批准时不创建 Goal，计划与 Goal 之间不新增关联；不校验完成报告的结构；不提供“Workspace 只读、临时目录可写”的沙箱档位（规划期间需要写缓存或产物的命令会失败）；外部 Hook 输入不增加“规划中”字段；移除 read-only 模式与“帮我批准”改为模型审核另行立项，三者互不依赖。

## 理由与备选方案

- **保留 `plan` 作为第五个模式（现状）。** 两个正交的问题共用一个字段，代价是 `prior`、“批准不能宽于 prior”的校验、模式菜单的特例、四档与五档两套类型，以及借来的“不改文件”约束。
- **规划期借用 read-only 的判定。** 剥离后仍让规划等于 read-only，会继续顶掉用户选的权限（完全访问权限下每条命令都询问），也使计划依赖一个可能被移除的模式。
- **命令沿用 Permission Mode 对应的沙箱。** 硬性禁止只剩提示词；被放行或被批准的写文件命令照样改动 Workspace。
- **规划期写入改为询问或按路径区分。** 用户点一次允许就绕过约束，这正是要解决的问题；允许规则与 Hook 的 allow 同样会绕过。
- **“Workspace 只读、临时目录可写”的新档位。** 能让规划期跑测试，但需要新的 Seatbelt 档位；等规划时跑测试受阻成为常态再考虑。
- **Run 正常结束即视为完成。** 模型中途提问也会以正常结束收尾，会被误记为完成。
- **批准时自动创建 Goal。** 每份计划都会触发自动续轮与预算，而不是只在用户建了 Goal 时推进。
- **执行中再 `/plan` 等于修订当前计划，或执行中拒绝 `/plan`。** 前者让已执行一半的计划与新方向混在同一份记录里；后者要求用户先放弃再进入，多一步而没有拦截作用。
- **完成报告需要用户审批。** 审批没有可拦截的动作（改动已经发生），只多一次点击。
- **执行中的提醒放进 system。** 每次阶段变化都会使 system 之后的提示缓存失效，与 ADR 0024 的分层相违背。

## 后果与验证

- **获得。** Permission Mode 与规划各走各的入口；规划期“不改 Workspace”不再依赖用户每次都不点；用户与模型都能看出一份计划是否还在执行、做完后得到逐项的汇报。
- **承担。** 新增计划阶段条目；`permission_mode` 条目升版并在读取时把旧的 `plan` 记录按 `prior`（没有时 default）读取，不改写数据库行，升级时正停在 plan 模式的旧 Session 视为已退出规划；`plan` 条目增加已完成与已放弃两个状态。旧版本应用不认识新的条目种类与版本，会跳过它们，降级不保证计划与权限状态一致。规划期需要写文件的命令（会写缓存或产物的测试与构建）失败。`<plan_mode>`、写入拒绝、提权拒绝、批准结果、执行中提醒与 `complete_plan` 的文本是模型可见契约，实施时写入 [Plan Mode](../subsystems/plan-mode.md) 等当前行为文档。
- **分两个阶段交付。** 阶段一把规划从 Permission Mode 剥离（规划期约束、入口、审阅卡切换权限、回退与分叉、旧数据读取）；阶段二加入执行中、完成报告与放弃。阶段一中批准后计划阶段回到“无”，此期间批准的计划与升级前的历史计划一样不算执行中。
- **验证要求。** 以真实 Sidecar 集成测试为主：四种模式下进入规划后模式读回不变、命令与 MCP 的询问与否和未规划时相同；规划中的写入为拒绝、不产生审批、目标文件逐字节不变，允许规则与 Hook allow 不能放行；darwin 上被放行的写文件命令因只读沙箱失败、提权直接出错；子代理同样受约束；回退、分叉与交接后的计划阶段；旧数据读取；`complete_plan` 与放弃的条目、提醒的送达与清空。判定表扩展为“Permission Mode × 是否规划中 × 工具类型”。真实模型是否遵守新的提示文本不在门槛内，交付时如实报告。
- **重新审视的条件。** 规划期跑测试受阻成为常态；需要模型主动进入规划；移除 read-only 模式或改由模型审核审批落地后，规划期约束与 Permission Mode 的组合需要重新核对。
- **implementation：partial。** 阶段一已实施，阶段二未开始；阶段二交付后改为 implemented，并链接实现与验证证据。实施状态见下一节。

## 来源与后继

- 确认主体：用户；日期：2026-11-20；依据：上述设计讨论中四轮 24 个问题的“全部采用推荐”与最终清单确认，以及同日对规格与拆票的“确认”。必要结论已提炼于本页。
- 前继：[ADR 0005](0005-permission-mode-and-sandbox.md)。本页替代其中“`plan` 作为 Permission Mode 取值”（Plan 模式 M4 加入的模式放行、沙箱档位、`prior` 与批准时恢复或收窄模式）的部分；ADR 0005 的四档模式表、判定顺序、审批与沙箱叠加、单次提权与受保护路径继续有效，本页只在判定顺序中插入“规划中拒绝写入”一步。
- 相关：[ADR 0013](0013-external-hooks-tighten-only.md)（Hook 的 allow 不越过规划中的写入拒绝）；[ADR 0014](0014-subagents-as-child-sessions.md)（子 Session 的有效模式与根 Session 的计划阶段）；[ADR 0019](0019-headless-runs-deny-approvals.md)（无界面运行不提供规划入口）；[ADR 0024](0024-session-state-as-state-updates.md)（执行中的提醒走 State Update）；[ADR 0011](0011-goal-state-as-session-entries.md)（Goal 不因计划改变）。
- 当前行为见 [Plan Mode](../subsystems/plan-mode.md)；术语随实施更新 [GLOSSARY](../../GLOSSARY.md)：Plan Mode 已随阶段一改为 Session 的规划阶段，Plan 的定义随阶段二修改。

## 实施状态与证据

2026-11-20，阶段一（规划从 Permission Mode 剥离）在集成分支 `feat/plan-lifecycle` 上实施完成，`implementation` 为 partial；阶段二进行中：批准后进入执行中与执行中的提醒已落地，`complete_plan` 的完成报告与放弃未交付。

- **已落地。** `plan_phase` 条目与 `plan` v2（写入 planning、none 与批准时的 executing）；`permission_mode` v3 只有四档，v2 的 `plan` 在读取时迁移为 `prior`（缺省 default），库中行不改写；判定中紧随拒绝规则的规划步、规划中的 read-only 沙箱、提权与固定档位的拒绝；Session 计划接口 `GET` / `POST /api/sessions/:id/plan`，`/plan`、`/plan off` 与 Plan chip 经它进入与退出；批准结束规划并进入执行中（Permission Mode 不变），执行中以 State Update `plan` 提醒，`<approved_plan>` 只在执行中再注入；审阅卡上的执行权限与模式菜单；回退、分叉与交接按有效条目或边界处的计划阶段。机制见 [Plan Mode](../subsystems/plan-mode.md)、[权限判定与审批](../subsystems/permissions.md) 与 [子代理](../subsystems/subagents.md)。
- **验证。** 真实 Sidecar 集成测试 [`sidecar-plan.test.ts`](../../tests/integration/sidecar-plan.test.ts) 等（清单见 [Plan Mode 的验证](../subsystems/plan-mode.md#验证)），判定表 [`decide.test.ts`](../../packages/agent/src/policy/decide.test.ts)，Browser Mode [`plan.browser.test.tsx`](../../apps/desktop/src/renderer/features/conversation/plan.browser.test.tsx)，以及后台模式的真实 Electron [`plan.e2e.test.ts`](../../apps/desktop/e2e/plan.e2e.test.ts)：完全访问权限下 `/plan` 进入后模式菜单仍勾选该模式，chip 的 × 退出后协议读回不在规划中、模式不变，审阅卡上改为自动接受编辑后批准，读回的模式为改后的一档。
- **未验证。** 真实模型是否遵守新的 `<plan_mode>`、拒绝与批准结果文本（只经 faux 请求日志验证链路）；非 darwin 平台上规划中命令的沙箱行为（相关断言按 `sandbox-unavailable` 分支书写，未在其他平台执行）；需要真实指针或原生层的界面交互。
