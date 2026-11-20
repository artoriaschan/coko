---
kind: reference
description: "当前的 Plan Mode 契约：计划阶段施加的硬性约束（写入拒绝、命令只读沙箱且不能提权，其余调用按当前 Permission Mode）、进入与退出（Session 计划接口、/plan、Plan chip，不改变 Permission Mode）、<plan_mode> 与 <approved_plan> 注入、exit_plan_mode 的校验与审阅（kind plan 的审批、editedPlan，批准只结束规划）、plan 与 plan_phase 条目、回退分叉与交接中的计划阶段、Session 计划接口、旧数据中的 plan 模式与降级、界面（审阅卡与其上的执行权限、右栏 Plan tab、计划卡）。修改规划、计划提交或审阅界面前查阅。"
lifecycle: active
---

# Plan Mode

Plan Mode 让 Agent 先调研与设计、由用户审阅计划后再动手。“是否在规划”是 Session 的计划阶段（`plan_phase` 条目，[ADR 0028](../adr/0028-plan-phase-not-permission-mode.md)），不是 Permission Mode：进入与退出规划都不改变用户选的模式，批准计划只结束规划。“不改 Workspace”由计划阶段保证：规划中写入直接拒绝、命令在只读沙箱中运行且不能提权；其余调用（读取、搜索、MCP、记忆、Todo 与 Goal 工具）按 Session 当前的 Permission Mode 判定（[ADR 0005](../adr/0005-permission-mode-and-sandbox.md)），完全访问权限下规划不逐条询问。Agent 用 `exit_plan_mode` 提交以 `#` 标题开头的 Markdown 计划，用户批准（可先编辑）或带反馈让它继续规划。模型可调用的"进入规划"工具、计划写入 Workspace 文件与语义化授权不在当前范围。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/planning/` | `<plan_mode>` 与 `<approved_plan>` 文本（`prompt.ts`）；`createExitPlanModeTool(review)`、`PlanReview`、计划校验与模型可见文本（`exit-plan-mode.ts`）；条目派生 `nextPlanRef`、`latestPlan`、`approvedPlanToReinject`（`state.ts`） |
| `packages/agent/src/entries/plan-phase.ts`（`@coko/agent/entries`，浏览器安全） | 计划阶段与活动 Plan 的派生 `planPhaseOf`、`activePlanOf` |
| `packages/agent/src/policy/decide.ts`、`sandbox.ts`、`gate.ts`、`engine/permission-wiring.ts` | 规划中的写入拒绝、只读沙箱、提权与固定档位的拒绝；plan-exit 总询问；权限 hook 在询问前提交 proposed 的计划并以 kind plan 等待审阅 |
| `packages/agent/src/session-entries/{planning,permissions}.ts`、`packages/protocol/src/{planning,permissions}.ts` | `plan` 条目（v2）、`plan_phase` 条目、`SessionPlanResponse`、`PlanActionRequest` 与 `planPaths`、`approval_request` 的 kind plan、`AnswerApprovalRequest` 的 `editedPlan`、`planMarkdownProblem` / `planTitle` |
| `apps/server/src/application/context/plan.ts` | 上下文贡献：开始时计划阶段为规划中的 Run 注册 `exit_plan_mode` 并注入 `<plan_mode>`；`<approved_plan>`；`/plan` 动作（可作为新对话的首次发送） |
| `apps/server/src/application/session-permissions.ts` | 计划阶段的回放与提交、计划接口的进入与退出（`planAction`）、计划审阅（提交 plan 条目、批准时的编辑与结束规划）、Session 计划的读取 |
| `apps/server/src/http/routes/plans.ts` | `GET` / `POST /api/sessions/:id/plan` |
| `apps/desktop/src/renderer/features/conversation/{plan-review-panel,plan-chip,plan-card,mode-picker,approval-panel}.tsx`、`features/right-panel/plan-tab.tsx` | 审阅卡、Plan chip、计划卡、三项权限菜单、右栏 Plan tab |

## 进入、退出与判定

- **判定。** 规划中（计划阶段为 `planning`）的约束由阶段施加，不依赖用户不点批准：write、edit 与权限类 edit 的调用在拒绝规则之后直接拒绝，允许规则、模式与外部 Hook 的 allow 都不能放行，Hook 的 deny 仍优先并保留自己的文本；不产生审批请求，模型收到 `Refused: plan mode is active, so file writes are blocked until the user approves a plan. …`。命令沙箱一律 read-only、可写根为空，被批准或被规则放行的写文件命令也会失败，被沙箱拒绝时提权提示换为 `[sandbox: escalation is not available in plan mode]`；带提权参数的 bash 直接返回 `invalid escalation: plan mode is active, …`，不询问。进入规划之前在较宽档位启动的 PTY Job 不接受 `job_input`（`Not sent: … but plan mode only allows the read-only sandbox; …`，见 [PTY 与 stdin](execution.md#pty-与-stdin)）；非 PTY 的后台 Job 已在运行，进入规划不改变它的沙箱。带 isolation 的 agent 调用为错误结果。其余调用按 Session 当前的 Permission Mode 判定，与未规划时相同：完全访问权限下命令与 MCP 不询问（命令仍在只读沙箱中），请求批准下照常询问；拒绝规则、询问规则与受保护路径照常生效。约束在每次调用时现取：Run 进行中进入或退出规划，下一次调用即生效或解除，等待中的写入审批随之重新判定（进入规划时以 superseded 结束，模型收到上面的拒绝文本）。判定顺序见 [权限判定与审批](permissions.md#判定)。
- **进入与退出。** Session 计划接口 `POST /api/sessions/:id/plan { action: 'enter' | 'exit' }`：不在规划中时 `enter` 提交 `plan_phase { planning }`，规划中时 `exit` 提交 `plan_phase { none }`，否则不提交；都不提交 `permission_mode`，不改动待审阅的 `plan` 条目与等待中的审批。响应为之后的 `SessionPlanResponse`。子 Session 409 `child-session`（`A subagent session uses the plan of its root session`），未知 Session 404，请求体不合 schema 400 `bad-request`；与切换 Permission Mode 相同，不检查归档，Run 进行中照常可用（写入拒绝与沙箱档位从下一次判定起变化，本 Run 的 section 与工具不变）。`/plan [消息]` 调用 `enter`，有消息时随后作为普通提交（202 `{ runId }`），没有时 204；`/plan off`（不区分大小写，独占整段参数）调用 `exit`，204。`/plan` 在 Run 进行中以 `run-in-progress` 拒绝（计划接口与 chip 照常可用）。新对话中输入 `/plan 消息`：首次发送（`text` 为原文）创建 Session 后展开为 `/plan` 动作，以规划开始并提交该消息；只有 `/plan` 时以 400 `A message is required` 拒绝并回滚。其他动作命令仍不能作为首次发送（`Send a message to start a new conversation`）。
- **与 Permission Mode 分开。** 切换 Permission Mode 的接口（`PUT …/permission-mode`）与首次发送的 `permissionMode` 只接受四档，`plan` 为 400 `bad-request`；无界面运行的 `--permission-mode plan` 为参数错误（见 [无界面运行](headless.md)）。规划中切换模式照常提交 `permission_mode` 并重新判定待审批的工具请求，不退出规划；外部 Hook 与生命周期事件收到的 `permission_mode` 是真实模式。
- **计划阶段。** `plan_phase` 条目记录一次转换：`{ phase: 'none' }`、`{ phase: 'planning' }` 或 `{ phase: 'executing', planId }`（当前不写入 executing）；与 `permission_mode` 一样经 `runtimes.commit` 提交，不带 runId。服务端与 renderer 都以 `@coko/agent/entries` 的 `planPhaseOf` 取阶段：有效条目（回退区间不算，压缩不影响）中最后一条，没有时为 none。每次转换进入审计序列（`plan_phase` 事件，executing 时带 planId）。
- **旧数据中的 plan 模式。** 升级前写入的 `permission_mode`（v2）`{ mode: 'plan', prior? }` 在读取时迁移为 v3 `{ mode: prior }`，没有 `prior` 时为 default，数据库行不改写（见 [权限判定与审批](permissions.md#模式)）。这样的 Session 没有 `plan_phase` 条目，因此读回后不在规划中：Run 不注入 `<plan_mode>`、不注册 `exit_plan_mode`，写入与命令按读回的模式判定；已提交的计划仍在时间线与右栏 Plan 页可见。需要时重新输入 `/plan`。
- **回退。** 计划阶段与 Plan 的状态跟着对话内容走：回退（conversation / both）提交 `rewind` 条目后服务端按有效条目重新计算阶段，并清掉该 Session 的待审阅记录；纯代码回退不提交 `rewind`，不重算。阶段条目落在用户消息之间：回退到进入规划之前的消息，读回 none，下一个 Run 没有 `<plan_mode>` 与 `exit_plan_mode`，写入按 Permission Mode 判定；回退到 `/plan 消息` 那条消息本身仍在规划中（阶段条目在它之前）；回退到批准所在 Run 的用户消息，approved 与之后的 `plan_phase { none }` 被回退，读回 planning，写入再次被拒，被回退的已批准记录不再算作当前计划，下一次提交沿用回退后最后一条 `plan` 条目续号。Permission Mode 与 Session 规则的回退行为不变：仍按原始条目回放，回退区间内的切换照常生效（与分叉口径不一致的既有缺陷，另行处理）。
- **分叉与交接。** 分叉复制 `permission_mode` 条目，新 Session 的模式与源相同（assistant-inclusive 时为源当前的权限状态）；计划阶段取边界处（user-before 为边界前、assistant-inclusive 为到边界为止的有效条目，以 `planPhaseOf` 计算），为规划中时在复制的条目末尾追加一条 `plan_phase { planning }`，边界在进入规划之前或退出之后不追加，与源当前是否在规划中无关。交接取源当前（有效条目）的阶段：规划中时在复制的权限条目之后追加，见 [交接](handoff.md)。`plan` 与原 `plan_phase` 条目不随分叉或交接复制。
- **读取。** `GET /api/sessions/:id/plan` → `SessionPlanResponse { phase, plan }`：`phase` 为当前阶段；`plan` 为活动的 Plan（`activePlanOf`：规划中且本次规划最后一条 `plan` 为 proposed 时为它，执行中为该 planId 的最后一条，否则 `null`）。子 Session 返回根 Session 的阶段与计划；未知 Session 404 `not-found`。

## 注入

- 开始时计划阶段为规划中的 Run（包括定时任务触发的 Run）注入 system section `<plan_mode>`（只调研与设计；写入会被拒绝、改为写进计划；命令在只读沙箱中运行且不能提权；其余调用——读取、搜索、MCP 工具、记忆、Todo 与 Goal 工具——按 Session 当前的 Permission Mode 处理；用 exit_plan_mode 提交以 # 标题开头的完整计划），并注册 `exit_plan_mode`（权限类 plan-exit）。子 Session 取根 Session 的阶段，收到另一段 `<plan_mode>`：父 Session 在规划中、本任务不可改动 Workspace（写入被拒、命令在不能提权的只读沙箱中），调研后把发现与拟做的改动报告给父代理；不提提交计划（`exit_plan_mode` 对子代理排除）。section 与工具在 Run 开始时取值：Run 中批准或经接口退出后阶段已变化，本 Run 剩余的请求仍带 `<plan_mode>`（Run 中途进入规划时本 Run 也不补注入），到下一个 Run 才变化；批准的结果写明 plan 模式已结束、忽略之前的 `<plan_mode>`，同一 Run 中再调用 `exit_plan_mode` 时不审阅，直接返回错误结果 `Not in plan mode: …`。子代理的有效模式为根 Session 的模式与定义上限中较窄者，规划中不被压成 read-only（见 [子代理](subagents.md)）。
- 最新的 approved 计划早于最后一个有效 compaction 的 `firstKeptSeq`（已被摘要掉）时，之后每个 Run 注入 `<approved_plan>`（正文至多 16 000 字符，超出截断并注明总长度）。与模式无关。section 顺序见 [上下文管理](context.md#压缩后的-approved_plan)。

## 提交与审阅

`exit_plan_mode { plan }`：plan 至多 64 000 字符，去掉开头空白后必须以 `#`–`######` 加空白开头的标题行开始，否则参数错误（`Invalid plan: …`），不提交条目也不询问。权限类 plan-exit 任何模式都询问，允许规则不生效，拒绝规则生效。

条目顺序：

1. `plan { planId, revision, markdown, status: 'proposed' }`：本次规划（最近一条 `plan_phase { planning }` 之后）已有未批准（不是 approved、completed 或 abandoned）的计划时沿用其 planId、revision 加一，否则新 planId、revision 1。`exit_plan_mode` 调用时计划阶段不为规划中则不审阅（`Not in plan mode: …`）。
2. `approval_request { kind: 'plan', toolName: 'exit_plan_mode', subject: <标题>, planId, revision, suggestions: [] }`，等待回答。kind plan 的请求不随模式或规则变更重新判定。
3. 回答（`POST /api/sessions/:id/approvals/:requestId`）：
   - 批准 `{ decision: 'allow', editedPlan? }`：`editedPlan` 规则同上；scope 只能是 once；带 `mode` 的请求体不合 schema。不合格时 400，请求保持等待。批准只结束规划，不恢复也不改变 Permission Mode，之后的调用按回答时 Session 的模式判定。之后 `approval_decision` → `tool_exec` → `plan { status: 'approved' }`（editedPlan 与原文不同时 revision 加一）→ `plan_phase { none }`（仍在规划中时；审阅等待期间已退出规划则不再提交）→ toolResult `The user approved the plan. Plan mode has ended: ignore the earlier <plan_mode> instructions and carry out the plan.` 加空行与最终计划，Run 继续。Goal Round 中的审阅使 Goal 进入 waiting-input（`plan-review`），见 [Goal](goal.md#阶段与转换)。 待批准的请求没有对应的审阅记录（propose 总在询问之前登记，正常走不到）时以 500 `internal` 拒绝，不放行、不提交新 revision 的 `plan` 条目。
   - 带反馈拒绝 `{ decision: 'deny', feedback }`：`approval_decision` → `plan { status: 'rejected', feedback }` → 错误结果 `The user did not approve the plan and said:\n<feedback>\n\nKeep planning: …`，Run 继续规划，仍在规划中。
   - 无反馈拒绝：`plan { status: 'rejected' }`，其余与普通拒绝相同（本批结束后 aborted）。
   - 停止或暂停：请求 cancelled，计划保持 proposed。
4. `editedPlan` 用于 kind tool 或 escalation 的请求时 400；任何回答带 `mode` 都是 400。

`plan` 条目与审批卡的 subject 入库与推送前替换登记明文（与其他非用户 payload 相同，见 [MCP](mcp.md#secret-的来源) 的按值脱敏）；toolResult 中的计划经 Secret 替换 hook。

## 界面

- **计划阶段的派生**：renderer 以 `planPhaseOf(conversation.entries)` 取计划阶段；子会话视图与草稿不显示 chip。
- **模式菜单**：输入区只列出 default / accept-edits / full-access，始终显示并勾选当前 Permission Mode；规划中可切换且不退出规划，Shift+Tab 只在 read-only / default / accept-edits 间切换模式。草稿中残留的 `plan`（升级前持久化）读取时按未设置处理，草稿的其余配置保留，首次发送不带它。
- **Plan chip**：计划阶段为规划中时在权限右侧显示 0.5px × 16px 分隔线与中性的“计划”胶囊。胶囊 H28、圆弧 R14，灯泡与关闭图标共用 24px 槽，hover 或键盘聚焦显示圆形关闭图标，标签位置和右侧至少 12px 内边距不变。关闭按钮有可访问名称（`plan.exit`）和 Tooltip，无快捷键提示。点击调用 `POST …/plan { action: 'exit' }`，等待期间禁用，成功后返回编辑区焦点，chip 随 `plan_phase { none }` 条目消失；失败时保留显示并经失败通道提示（“没能退出规划”），文字草稿与其他配置不改变。退出不改变 Permission Mode。发送清空编辑器不会关闭规划。
- **审阅卡**：kind plan 的待审批请求接管输入区（`data-slot="plan-review"`）：标题、修订、正文预览、"已编辑"标记；主按钮"批准并执行"（没有“将恢复的模式”与“批准并允许编辑”）；按钮行左侧标出“执行权限”并放入输入区同一个模式菜单（`ModePicker`），显示并勾选 Session 当前的 Permission Mode（含待确认的切换），即批准后执行所用的模式。审阅等待期间在卡上切换调用同一个切换动作（`PUT …/permission-mode`）：选择完全访问权限仍先确认风险；切换照常提交 `permission_mode` 并重新判定待审批的工具请求，计划的审批请求不消失、不被重新判定；批准后同一个 Run 按切换后的模式继续，这是执行开始前收紧或放宽权限的时机。切换失败时卡上撤回为原模式并经失败通道提示（“权限设置没有保存”），审批请求仍可回答；回答发出后菜单禁用。"继续规划"展开反馈输入，"发送反馈"为带反馈拒绝；"在侧边栏查看"打开或聚焦右栏 Plan 页面。新请求出现时自动打开或聚焦计划页一次（按 requestId，renderer 内存）。右栏中的编辑不合格时不能批准。
- **右栏 Plan tab**：选中修订（缺省最新）的静态 Markdown、修订下拉（每个 planId 每个 revision 一项，最新在前）、状态与拒绝反馈；正在审阅的修订有"编辑"（mono Textarea）与"撤销编辑"。草稿在 renderer 内存，按 Session、planId 与 revision 保存，随批准作为 `editedPlan` 提交。
- **时间线计划卡**（`data-slot="plan-card"`）：标题、修订、状态与反馈；proposed 条目在同一计划有后续条目后不再显示；主会话中点击打开或聚焦右栏 Plan 页面；子会话、回退历史及只读上下文中，点击展开当前记录的只读 Markdown 快照，不误开主会话的最新计划。后续修订仅按当前渲染 Session 的条目判断，不读取活动父会话。计划卡沿用对话详情的 13px/20px 字体、R16 轻量表面与 10px/14px 内边距，反馈完整换行。计划审阅仍接管既有输入区，状态机和审批契约不变。

## 兼容与降级

新版本读取旧数据见上文“旧数据中的 plan 模式”。旧版本应用读取新版本写入的数据不提供降级保证：`plan_phase` 是它未注册的 kind，`permission_mode` v3 与 `plan` v2 的版本号高于它已知的版本，这些条目被跳过并报告 invalid entry，库文件不被隔离，seq 留下空缺。后果：

- 旧应用不知道计划阶段，只按它能读到的最后一条 `permission_mode`（v1 / v2）判断是否在 plan 模式；新应用中进入规划的 Session 在旧应用里不在规划中。
- 新应用创建或切换过模式的 Session，旧应用读到的是更早的 v1 / v2 记录或缺省 default，可能比新应用中的模式更宽或更窄。
- 新应用写入的 `plan` 条目在旧应用的时间线与 Plan 页不可见。

## 验证

- `packages/agent/src/session-entries/session-entries.test.ts`：`plan` v1 → v2、`plan_phase` 的形状；`packages/agent/src/agents/{fork,handoff}.test.ts`：分叉按边界处的阶段（两种边界、边界之后进入或退出规划）、交接按有效条目的阶段（进入规划被回退、退出规划被回退）追加 `plan_phase { planning }`；`packages/agent/src/agents/definitions.test.ts`：子代理有效模式为根模式与上限中较窄者；`packages/agent/src/observability/trace.test.ts`：`plan_phase` 审计事件；`apps/server/src/application/session-permissions.test.ts`：子 Session 读取根 Session 的计划、计划接口对子 Session 为 `child-session`、旧数据的 plan 模式（`permission_mode` v2）读为 prior（缺省 default）且不在规划中、读取结果不带 prior。
- `packages/agent/src/policy/decide.test.ts`：`permission_mode` v1 → v2 → v3（plan 读为 prior，缺省 default；v3 只有四档），以及 Permission Mode × 是否规划中 × 工具类型（规划中写入在拒绝规则之后拒绝，其余与不在规划中相同）；`sandbox.test.ts`：规划中一律 read-only 且可写根为空。`policy/escalation.test.ts`：规划中写入拒绝、各模式下命令在 read-only 沙箱、拒绝后的规划标记、提权直接出错、Run 中途进入规划；`policy/gate-hooks.test.ts` 与 `extensions/hooks/hooks.test.ts`：Hook allow 不放行规划中的写入、Hook deny 优先。`apps/server/src/application/subagents-dispatch.test.ts`：规划中带 isolation 的派发在派发处被拒。`packages/agent/src/planning/planning.test.ts`：planId / revision 派生（以 `plan_phase` 为起点）、`planPhaseOf` 与 `activePlanOf`、`<approved_plan>` 的判定与截断、计划校验，以及运行时上的审阅闭环（批准结果不提模式、带反馈与无反馈拒绝、参数错误不询问）。
- `tests/integration/sidecar-plan.test.ts`：真实 Sidecar 上 `/plan` 与计划接口进入和退出时模式读回不变、`<plan_mode>` 全文、写入直接拒绝且无审批、有允许规则时写入仍被拒且文件逐字节不变、命令按当前模式询问（default 询问、full-access 不询问）并被只读沙箱拒绝（darwin；其他平台 fail-closed）且带规划标记、提权参数出错且不询问、提交与审阅、回答校验（带 `mode` 400）、编辑后批准的新 revision、批准的条目顺序（无 `permission_mode`）与结果文本、带反馈继续规划、切换接口拒绝 `plan`、规划中切换模式不退出规划、审阅等待中退出规划后批准、审阅等待中切换模式（放宽与收紧）后计划审批仍在等待且批准后同一个 Run 的写入按新模式判定、Run 进行中 `/plan` 为 409 而接口可用、Run 中途进入与退出时写入审批的重新判定与 `<plan_mode>` 到下一个 Run 才出现、接口校验与 404、审计中的阶段转换、首次发送拒绝 `plan` 而 `/plan 消息` 以规划开始、压缩后的 `<approved_plan>`、分叉（含分叉后的计划阶段）、回退到 `/plan` 消息本身与进入规划之前（读回、下一个 Run 的 section 与工具、写入按模式、模式不随回退还原）、回退到批准之前（读回规划中、写入再次被拒、提交工具可用、续号）、旧数据（预置 v2 的 plan 记录：模式读为 prior 或 default、库中原始版本号仍为 2、不在规划中、没有 `<plan_mode>` 与 `exit_plan_mode`、已提交的计划可读、审计事件不带 prior）。`secrets-gate-plan.test.ts`：plan 条目、审批卡、结果、WS 与 `<approved_plan>` 中没有登记明文。`sidecar-hooks.test.ts`：全局 Hook 的 allow 不放行规划中的写入、Hook 收到的 `permission_mode` 是真实模式；`sidecar-subagents-permissions.test.ts`：规划中派发的子代理有效模式为根的 full-access（命令不询问）、写入被拒、命令在只读沙箱、system 中是子 Session 的 `<plan_mode>`；`sidecar-tool-search-keywords.test.ts`：规划中 MCP 调用的询问与否同未规划；`sidecar-schedules.test.ts`：规划中到期的定时任务注入 `<plan_mode>` 且写入被拒、规划中 schedule_create 按当前模式询问；`headless.test.ts`：`--permission-mode plan` 为参数错误；`sidecar-subagents-isolation.test.ts`：规划中带 isolation 的派发为错误结果；`sidecar-pty.test.ts`：规划中向较宽档位终端的输入被拒；`sidecar-project-permissions.test.ts`：附加根在规划中的写入直接拒绝；`sidecar-rewind.test.ts`：助手边界分支继承源当前的模式（写入按 default 询问），计划阶段取边界处；`sidecar-handoff.test.ts`：源在规划中时目标以规划中开始。
- `apps/desktop/src/renderer/features/conversation/plan.browser.test.tsx`（审阅卡只有"批准并执行"且批准不带 mode、审阅卡标出执行权限并经同一模式菜单切换（完全访问权限先确认风险、失败时保留原显示且仍可批准）、右栏编辑随批准提交、右栏 Plan tab、chip 由计划阶段驱动且 × 调用退出动作、失败时保留、回退条目到达后 chip 与 Plan tab 按有效条目变化、旧数据与草稿不显示 chip、模式菜单在同一文件中依次渲染；共用 setup 断言没有遗留的模态层）；`apps/desktop/src/renderer/stores/chat-store-permissions.test.ts`：退出规划失败时保持规划中并报告、规划中切换模式不退出规划、草稿残留的 `plan` 读取时按未设置处理、首次发送时不带出；`apps/desktop/src/renderer/stores/new-chat-store.test.ts`：残留的 `plan` 读为未设置、草稿其余配置保留；`apps/desktop/e2e/plan.e2e.test.ts`：`/plan` 进入、chip 关闭、提交后右栏自动打开、继续规划、右栏编辑后批准并执行与计划卡（随票 08 按新行为更新）。

## 延伸阅读

- [权限判定与审批](permissions.md)：模式表、权限类与审批状态。
- [上下文管理](context.md)：system section 顺序与压缩。
- [ADR 0005](../adr/0005-permission-mode-and-sandbox.md)：模式同时决定审批范围与沙箱档位。
- [ADR 0028](../adr/0028-plan-phase-not-permission-mode.md)：计划是独立的 Session 状态，不是 Permission Mode。
