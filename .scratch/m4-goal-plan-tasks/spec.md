# M4 目标与任务：规格

Status: ready-for-agent
Spec status: approved（2026-10-30，按用户常设指示采纳，未经用户逐条确认）
Map: [Coko 桌面应用](../desktop-app/map.md) · [里程碑划分](../desktop-app/issues/06-grill-milestone-route.md) · 讨论：[grilling.md](grilling.md) · 实施须知：[implementer-brief.md](implementer-brief.md)

## Problem Statement

M3 之后 Agent 有了指令、Skills、MCP 与压缩，但每次只能完成一个 Run：用户想让它"把所有失败的测试修好"，必须一轮轮手动催它继续，也无法限定它最多花多少时间、Token 或钱；它说"完成了"就算完成，没有可检查的条件。用户想先看方案再让它动手，只能靠口头约定，Agent 照样可以改文件。多步工作没有可见的步骤清单。长命令（开发服务器、构建、测试监听）只能前台运行到超时，Agent 拿不到交互式程序的输入通道。Sidecar 被强杀后，bash 的进程组与 stdio MCP Server 会继续运行成为孤儿。会话界面看不到用量与费用（模型价格固定为 0）。M3 留下的结构债（sessions.ts 596 行、runtime.ts 826 行、路由直接访问存储等）会在引入 Goal / Plan 状态时继续恶化。

## Solution

交付 Goal（目标记录、九阶段状态机、Goal Round 自动推进与单写者去重、五维预算并在调用前检查、按预先记录的成功条件与证据判定完成、重启后暂停、取消时停止传播）、Plan Mode（第五种 Permission Mode：只读沙箱、计划提交与审阅、批准后恢复进入前的模式）、Todo List（整表替换、带依赖与结果）、Background Jobs（后台 bash、输出订阅与落盘、取消、完成通知）、Execution Runtime 的 PTY 与 stdin（node-pty），以及子进程登记与孤儿清理。界面：composer 上方 dock 依次 Todo → Goal → Queue，Plan chip 与右栏审阅，后台任务视图，Run 用量与 Session 费用，Goal 卡的预算条；模型目录可填价格。第一张票先拆分结构债，不改变行为。决定见 [ADR 0011](../../docs/adr/0011-goal-state-as-session-entries.md)、[ADR 0012](../../docs/adr/0012-host-process-registry.md)，Plan 作为权限模式见 [ADR 0005](../../docs/adr/0005-permission-mode-and-sandbox.md)；术语见 [GLOSSARY](../../GLOSSARY.md)。

## User Stories

**Goal**

1. As a 用户, I want 用一句话（或 `/goal 目标`）让 Agent 建立一个 Goal，并看到它记下的成功条件, so that 我知道它怎样才算完成。
2. As a 用户, I want Agent 在我不干预时逐轮推进 Goal，直到完成、需要我输入、等待后台任务、预算耗尽或被我暂停, so that 长任务不需要我一直盯着。
3. As a 用户, I want 为 Goal 设置时间、Token、费用、轮次与工具调用上限，超出前 Agent 就停下, so that 自动推进不会失控。
4. As a 用户, I want Agent 只有在为每条成功条件给出证据后才能把 Goal 标为完成, so that "我说完了"不等于"做完了"。
5. As a 用户, I want 暂停、恢复、编辑、标为完成或取消 Goal；取消时进行中的 Run 与后台任务一起停止，并看到清理结果, so that 我随时掌控。
6. As a 用户, I want 应用重启后未完成的 Goal 处于暂停而不是自己继续, so that 崩溃或重启不会在无人时继续花钱。

**Plan Mode**

7. As a 用户, I want 切到规划模式后 Agent 只能调研、不能改 Workspace（写入与命令都要我批准，命令只读沙箱）, so that 我先看方案。
8. As a 用户, I want Agent 提交的计划在右栏打开，我可以修改后批准执行、或带反馈让它继续规划, so that 计划由我定稿。
9. As a 用户, I want 批准后回到进入规划前的权限模式（或我选择的较窄模式）, so that 规划不会意外放宽或收窄我的设置。

**Todo 与队列**

10. As a 用户, I want 在输入区上方看到 Agent 的步骤清单、当前步骤、依赖与完成结果, so that 我知道它做到哪里。
11. As a 用户, I want 看到我在 Run 进行中发出、尚未送达的追加指令, so that 我知道它们会在当前步骤后送达。

**后台任务与终端**

12. As a 用户, I want Agent 把长命令放到后台运行，随时读取输出或停止，结束时得到通知, so that 它能边跑服务边做别的。
13. As a 用户, I want 在后台任务视图中看到每个任务的状态、时长、退出码与实时输出并能停止它, so that 我能检查它们。
14. As a 用户, I want Agent 能运行需要终端的交互式程序并向其输入, so that REPL、交互式安装与调试器也能用。
15. As a 用户, I want 应用被强制退出后，上次 Agent 启动的命令与 MCP Server 在下次启动时被清理, so that 不留下占用端口或 CPU 的孤儿进程。

**用量与费用**

16. As a 用户, I want 为模型目录中的模型填写价格，看到每个 Run 与整个 Session 的 Token 与费用, so that 我了解开销。

**结构**

17. As a 开发者, I want sessions.ts 与 runtime.ts 在引入 Goal / Plan 之前按职责拆分、路由经 application 层访问存储, so that M4 的新状态不再堆进同一个文件。

## Implementation Decisions

讨论记录：[grilling.md](grilling.md)，全部按常设指示采纳。

### Session Entry 与事件（票 02 预先声明 schema；表中"实现"列为写入方）

| kind / 事件 | payload 要点 | 实现 |
| --- | --- | --- |
| `goal` v1 | 完整快照：`id`、`revision`、`objective`、`constraints?`、`criteria [{ id, text }]`（1–10）、`budget { maxRounds?, maxToolCalls?, maxTokens?, maxCost?, maxDurationMs? }`、`phase`、`reason? { code, message }`、`waitingFor? { jobIds }`、`resumedAtRound`、`evidence? [{ criterionId, text, toolCallIds? }]`、`completedBy?: model / user`、`cleanup? { runsAborted, jobsKilled, failures }`、`source: model / user / system` | 09、10 |
| `todo_list` v1 | `items [{ id, content, status, blockedBy?, result? }]` | 07 |
| `plan` v1 | `planId`、`revision`、`markdown`、`status: proposed / approved / rejected`、`feedback?` | 08 |
| `job_start` v1 | `jobId`、`kind: bash / pty`、`label`、`command`、`toolCallId`、`goalId?`、`logPath` | 04、05 |
| `job_end` v1 | `jobId`、`status: completed / failed / killed / lost`、`exitCode?`、`signal?`、`outputBytes`、`truncated` | 04 |
| `job_notification` v1 | `jobIds`；紧接在送达通知的 user message 之前 | 04 |
| `run_start` v2 | `trigger` 增加 `goal`；`goal? { goalId, round }`；v1 → v2 原样迁移 | 02（09 写入 goal 字段） |
| `permission_mode` v2 | 增加 `prior?`（进入 plan 前的模式）；v1 → v2 原样迁移 | 08 |
| `approval_request` / `approval_decision` | 新 kind `plan { planId, revision }`；回答可带 `editedPlan?`、`mode?` | 08 |
| `compaction` v2 | 增加 `usage?`（摘要请求的 usage，计入 Goal 预算）；v1 → v2 原样迁移 | 10 |
| progress `job_update` | `job`（Job 的公开快照） | 04 |
| progress `job_output` | `jobId`、`offset`、`chunk`（每 Job 每 100 ms 至多一帧，已按值脱敏） | 04 |

新 kind 的 payload 在入库与推送前经 `redactSecretsDeep`（与 message 条目相同）。`goal`、`todo_list`、`plan`、`job_*` 不随分叉复制。

### Goal（agent `goals/`，server `application/goals.ts`、`goal-driver.ts`、`context/goal.ts`）

**阶段与转换。**

| 从 | 到 | 条件 |
| --- | --- | --- |
| （无） | running | `create_goal`（须由用户提交的 Run 或本 Run 送达过用户追加指令） |
| running | waiting-input | Goal Round 以等待审批或结果确认结束；或模型调用 `update_goal { action: wait_input, reason }` |
| running | waiting-external | 模型调用 `update_goal { action: wait_jobs, job_ids }`（job 须为本 Session running） |
| waiting-input | running | 用户提交消息、回答审批或结果确认之后的 Run 结束 |
| waiting-external | running | `waitingFor.jobIds` 全部结束（job_end 已提交） |
| running / waiting-* | paused | 用户暂停；用户停止 Goal Round；重启（`reason.code: restarted`） |
| running | blocked | 模型 `blocked`（Goal Round 中须自 `resumedAtRound` 起至少 3 轮）；未定价模型遇到费用上限（`cost-unpriced`） |
| running | failed | Goal Round 以 `error` 结束（model_error、commit_failed、internal），不自动重试 |
| running | budget-exhausted | 任一维度达到上限（`reason.code`：`rounds` / `tool-calls` / `tokens` / `cost` / `time`） |
| paused / blocked / failed / budget-exhausted | running | 用户恢复（budget-exhausted 须先使该维度有余量）；`resumedAtRound` 设为当前轮次 |
| 任一非终态 | complete | 模型给出完整证据，或用户标为完成 |
| 任一非终态 | cancelled | 用户取消（停止传播见下） |

**推进（GoalDriver）。** Session 的 `run_end` 提交后，若 Goal 为 running、没有待回答的结果确认、没有未送达的追加指令、轮次与预算有余量，则发起 Goal Round：`session-runs` 的统一入口以 `trigger: goal`、`goal { goalId, round: 上一轮 + 1 }` 开始 Run，输入为 `<goal_round>` user message（目标 JSON 字符串、成功条件、"第 n / 上限 轮"、"以当前 Workspace、工具结果与已提交状态为准；完成时用 update_goal 给出每条条件的证据"）。每个 Session 的推进串行；开始前重读 Goal，revision 变化或 Run 已在进行（用户先提交）时放弃预留；启动时已有同 goalId、同 round 的 run_start 时不再发起。Goal Round 的 Run 中用户可以照常追加指令、停止。

**工具**（权限类见下文）：`get_goal`；`create_goal { objective, criteria, constraints?, budget? }`；`update_goal { goal_id, revision, action: edit | pause | resume | complete | blocked | wait_input | wait_jobs, objective?, criteria?, constraints?, budget?, evidence?, reason?, job_ids? }`（constraints 可编辑，与 create 对称；评审 Spec 17 接受）。edit / pause / resume / create 的授权规则见 [grilling B5](grilling.md#第-2-轮)；revision 过期返回错误结果（含当前 revision）。结果为紧凑 JSON `{ goal: … | null }`。工具在 Session 有 Goal 或本 Run 由用户提交时注册（Goal Round 中没有 create）。

**完成证据。** `complete` 须覆盖每条 criterion、text 非空；`toolCallIds` 中每个 id 必须是本 Session 已提交、`isError: false` 的 toolResult。用户标为完成不需要证据（`completedBy: user`）。Run 正常结束不改变阶段。

**预算口径**（ADR 0011：从条目派生）。属于 Goal 的 Run：Goal 处于非终态且非 paused 时开始的 Run（含用户提交的）。轮次 = Goal Round 数；工具调用 = 这些 Run 的 toolResult 数；Token = assistant usage 的 input + output + cacheRead + cacheWrite 加 `compaction.usage`；费用 = 同一组 usage 的 `usage.cost.total`；时间 = 各 Run `run_end.createdAt − run_start.createdAt` 之和（含审批等待，不含 Run 之间）。汇总函数接受子 Session 的条目（M5 接入，M4 无调用方）。缺省 `maxRounds` 50，其余不设。

**检查点。** 每次模型请求前（运行时 `beforeRequest`）检查 Token、费用、时间；每次工具调用前（权限判定之后的 hook）检查工具调用数，超出时该调用不执行，结果 `Goal budget exhausted: tool calls (n / max)`；每个 Goal Round 开始前检查五维。超出时 Run 本批完成后停止（运行时 `stopAfterBatch`），`run_end { status: paused, error: { code: budget_exhausted, message } }`，Goal 进入 budget-exhausted。设了 `maxCost` 而当前模型未定价时不发请求，Goal 进入 blocked（`cost-unpriced`）。

**重启与停止传播。** 启动恢复（Session 恢复之后）把 running / waiting-* 的 Goal 提交为 paused（`restarted`）。取消：`stopAfterBatch` 或 abort 进行中的 Run 并等待 run_end；对 `goalId` 为此 Goal 的 running Job 执行 kill 并等待 job_end；提交 cancelled 快照与 `cleanup`（失败项写入 `failures`，不阻止取消）。

**注入。** Goal 未终结时每个 Run 注入 system section `<goal>`（目标、条件、阶段、轮次、已设维度的用量 / 上限）；压缩后同样存在。

**命令。** 内置 `/goal`：`/goal <目标>` 展开为请模型调用 `create_goal` 的普通提交；`/goal pause | resume | cancel | complete` 为动作（不产生 user message；pause、cancel 在 Run 进行中可用）；无参数时界面打开 Goal 卡。控制词只在独占整段输入时识别。

**HTTP。** `GET /api/sessions/:id/goal` → `{ goal, usage }`（usage 为五维已用值与 `costUnpriced`）；`POST /api/sessions/:id/goal` `{ action: pause | resume | cancel | complete | edit, revision, objective?, constraints?, criteria?, budget? }`（revision 过期 409 `revision-conflict`，非法转换与取消进行中 409 `invalid-transition`）。

### Plan Mode（agent `planning/`、`policy/decide.ts`，server `context/plan.ts`、`session-permissions.ts`）

- **模式。** PermissionMode 增加 `plan`。模式放行与 read-only 相同（Workspace 与额外读取根内的 read 组、context-read、session-state），命令沙箱 read-only，可写根为空；写入、bash、MCP、memory-write 照常询问。判定顺序不变。
- **进入与退出。** 模式菜单"规划"、`/plan [消息]`（动作：切到 plan，`permission_mode { mode: plan, prior }`；有消息时随后作为普通提交）、`/plan off` 与 Plan chip 的 ×（回到 `prior`）。从 plan 选择其他模式即退出（不经审阅）。Shift+Tab 循环不含 plan。已处于 plan 时再进入不改 `prior`。
- **注入。** plan 模式的 Run 注入 `<plan_mode>`（只调研与设计、不改动 Workspace、用 exit_plan_mode 提交以 # 标题开头的完整 Markdown 计划）。
- **exit_plan_mode { plan }。** 只在 plan 模式的 Run 中注册；权限类 plan-exit：任何模式都询问、允许规则不生效、拒绝规则生效。提交 `plan`（proposed，同一 planId 的 revision 递增）与 `approval_request { kind: plan, planId, revision }`。markdown ≤ 64 000 字符，必须以 `#` 标题开头（否则参数错误）。
- **回答。** 批准 `{ decision: allow, editedPlan?, mode? }`：`mode` 缺省为 `prior`，可选 read-only / default / accept-edits 中不宽于 prior 的（用户故事 9；宽于 prior 或 full-access 为 400）；提交 `plan`（approved；有 editedPlan 时为新 revision）、`permission_mode { mode }`、toolResult "The user approved the plan. Plan mode has ended: ignore the earlier <plan_mode> instructions. Proceed under <mode>." 附最终计划，Run 继续；之后同一 Run 中的 exit_plan_mode 不审阅、返回错误结果。带反馈的拒绝：`plan`（rejected，feedback），toolResult 为反馈，Run 继续规划。无反馈拒绝：现有语义（本批结束后 aborted）。Goal Round 中的 plan 审阅使 Goal 进入 waiting-input。
- **压缩后。** 最新的 approved `plan` 早于最后一个 compaction 的 firstKeptSeq 时注入 `<approved_plan>`（≤ 16 000 字符，超出截断并注明）。

### Todo List（agent `tasks/todo/`，server `context/todo.ts`）

`todo_write { items: [{ id?, content, status, blockedBy?, result? }] }` 整表替换并提交 `todo_list`。status：pending / in_progress / completed / cancelled；id 省略时按位置生成 `t1`…；content 1–500 字符且不重复；≤ 50 项；至多一个 in_progress；`blockedBy` 只引用表内 id、无环，前置项未完成（completed / cancelled 之外）时不能为 in_progress 或 completed；`result` ≤ 1000 字符且只在 completed / cancelled 项上。违反时参数错误、原表不变。结果文本：`Updated todo list: <p> pending, <i> in progress, <c> completed, <x> cancelled.` 加当前表。有未完成项时每个 Run 注入 `<todo_list>`。owner 与跨代理共享不做（M5）。

### Background Jobs（agent `tasks/jobs/`，server `application/jobs.ts`、`context/jobs.ts`、`routes/jobs.ts`）

- **发起。** bash 增加 `run_in_background?: boolean`；权限判定、沙箱、Secret 注入、`tool_exec` 与前台 bash 相同；立即返回 `Started background job <id>: <label>. Read output with job_output.`，提交 `job_start`。label 取命令首行，≤ 120 字符。每 Session 同时至多 10 个 running + stopping，超出返回错误结果。
- **输出。** 内存环形 256 KB（模型游标读）；日志 `<dataDir>/jobs/<sessionId>/<jobId>.log`（目录 0700、文件 0600，≤ 64 MiB，超出停止写入并在末尾注明 `truncated`）；写入日志、环形与推送前按值替换登记的 Secret 与 Credential 明文。日志目录不是读取根。
- **工具。** `job_output { job_id, wait?, timeout_ms? }`（只返回上次读取后的输出；wait 缺省 30 000、上限 600 000 ms，结束、超时或追加指令到达时返回；结果末尾 `[status: …]`；去除 ANSI 控制序列；按工具输出截断规则）；`job_list`（`<id> [<kind>] <status> — <label>`）；`job_kill { job_id, reason? }`（进程组 SIGTERM，5 秒后 SIGKILL；stopping → killed；已结束的返回当前快照）。只能访问本 Session 的 Job。
- **完成通知。** `job_end` 提交后生成通知文本 `<job-notification><job-id>…</job-id><status>…</status><exit-code>…</exit-code><summary>Background job "<label>" <status> (exit code n)</summary>[<output>未读输出 ≤ 2 KB</output>]</job-notification>`。Session 有 Run 时作为追加指令送达（前置 `job_notification` 条目）；没有时挂起，合并到下一个 Run 的 user message 开头（同样前置 `job_notification`）。不唤醒没有 Goal 的空闲 Session；模型已经用 job_output 读到终态或用 job_kill 停止的 Job 不通知。
- **取消与归属。** 停止 Run 不终止 Job；取消 Goal 终止其 Job；有序关闭终止全部 Job（job_end killed）；启动恢复为没有 job_end 的 Job 提交 `job_end { status: lost }`。
- **HTTP。** `GET /api/sessions/:id/jobs` → Job 快照列表；`GET /api/jobs/:id/output?offset=&limit=` → `{ offset, chunk, nextOffset, done }`（读日志，不消耗模型游标；limit ≤ 256 KB）；`POST /api/jobs/:id/kill`（204；已结束 409 `job-not-running`）。

### PTY 与 stdin（agent `ports/pty.ts`，server `adapters/pty.ts`）

- `PtyPort.spawn({ argv, cwd, env, cols, rows }) → { pid, write(text), resize, kill(signal), onData, onExit }`；agent 不依赖 node-pty，没有端口时 `tty: true` 以 `pty-unavailable` 错误结果返回。
- bash `tty?: boolean`，须同时 `run_in_background: true`（否则参数错误）；argv 为沙箱前缀 + shell -c 命令；cwd 为 Workspace 真实路径；尺寸 120×30；Job kind `pty`；日志保存原始输出，模型读取时去除 ANSI。
- `job_input { job_id, text, submit?, ctrl_c? }`：只对 running 的 pty Job；权限类 bash，判定对象为 `text`（与 bash 命令同一套规则）；submit 追加 `\r`，ctrl_c 写 `\x03`。非 PTY Job 的 stdin 关闭，job_input 返回错误结果。
- **依赖与打包。** node-pty **1.2.0-beta.15**（精确版本，与 DSH 相同，不带 DSH 补丁）为 apps/server 的 dependency；`pnpm-workspace.yaml` 的 `allowBuilds` 加 `node-pty: true`；预编译 `spawn-helper` 的可执行位由根 postinstall 脚本恢复（DSH 同样处理）。sidecar 的 tsdown 构建把 `node-pty` 保留为 external，构建步骤把 `node-pty` 的 `package.json`、`lib/` 与 `prebuilds/darwin-arm64/` 复制到 `dist/sidecar/node_modules/node-pty/`（`spawn-helper` 0755），随 `extraResource` 放在 `Resources/sidecar`（不在 asar 内，不需要 asar 解包与 auto-unpack-natives 插件）。

### 子进程登记与孤儿清理（ADR 0012；agent `ports/exec.ts`，server `adapters/processes.ts`、`application/processes.ts`）

迁移 v7 新表 `host_processes`（id 主键、pid、pgid?、started_at（`ps -o lstart=` 原文）、kind: bash / job / pty / mcp、session_id?、job_id?、command、created_at；STRICT）与 `store.processes`（`register`、`remove`、`list`）。ExecPort 增加生命周期回调 `onSpawn({ pid, pgid? }) / onExit`；宿主在回调中登记与删除。MCP stdio 传输连接成功后登记其 pid 与进程组（pi-mcp 以 detached 启动，pgid = pid；票 05 由"无 pgid"修订，使经 npx 启动的孙进程也被清理）。启动时（打开存储之后、启动恢复之前）逐行核对：pid 存在且 lstart 一致 → 有 pgid 则 `kill(-pgid)` 否则 `kill(pid)`，SIGTERM，2 秒后 SIGKILL，日志 `orphan process terminated { pid, kind, sessionId? }`；否则只删行。有序关闭在关闭存储之前终止全部登记进程。

### 权限类（扩展 [M3 的权限类](../../docs/subsystems/permissions.md#模式)）

| 权限类 | 工具 | 模式放行 |
| --- | --- | --- |
| context-read（已有） | 另加 get_goal、job_output、job_list | 所有模式 |
| session-state（新，票 02） | todo_write、create_goal、update_goal、job_kill | 所有模式（含 read-only、plan） |
| plan-exit（新，票 02 声明、08 使用） | exit_plan_mode | 无：任何模式都询问，允许规则不生效 |
| bash（已有） | 另加 job_input（判定对象为 text） | 与 bash 相同 |

拒绝与询问规则对所有类照常生效。

### 模型价格与费用（票 10）

Model Catalog 的模型增加可选 `price { input, output, cacheRead?, cacheWrite? }`（每百万 token，非负数）；设置 → 模型服务的模型选项中填写，留空为未定价。全局设置键 `usage.currency`（USD / CNY，缺省 USD）只决定显示符号，在模型服务页顶部选择。注册表把价格写入 pi-ai 的 `model.cost`。未定价模型的 usage.cost 为 0，界面显示"未定价"而不是 0。这是对 [模型服务 PRD](../model-service-settings/spec.md) 第 9 节"费用统计不在本轮"的后续扩展，票 10 在该 PRD 的 10.1 追加一行修订记录。

### 界面

- **dock**（`features/conversation/dock/`，票 02 建容器与注册表）：composer 上方，固定顺序 Todo → Goal → Queue，每张卡 panel elevation、可折叠（折叠状态存 renderer 内存，不入记录），没有内容时不显示。
  - Todo 卡（07）：标题"待办 c/n"、当前 in_progress 项、展开后的列表（状态图标；blocked 项显示"等待 t2"；completed 项可展开 result）；全部完成时折叠为一行，下一个 Run 开始时隐藏。
  - Goal 卡（11）：目标（两行截断、可展开）、阶段徽标与原因、轮次 n/上限、成功条件清单（完成后显示证据）、预算条（每个已设维度：已用 / 上限，≥ 80% warning，耗尽 destructive；费用未定价显示提示）、操作（暂停、恢复、编辑目标与预算、标为完成、取消（确认框））。
  - Queue 卡（07）：未送达的追加指令（单行截断，HoverCard 看全文），说明"当前步骤结束后送达"；不能撤回。
- **Plan**（08）：composer 底栏蓝色 Plan chip（hover 变 ×）；右栏 Plan tab（静态 Markdown、修订下拉、状态、编辑为 mono Textarea）；新 proposed 计划自动打开一次；审阅接管 composer：主按钮"批准并执行"（标出将恢复的模式）、下拉"批准并允许编辑"、"继续规划"（反馈输入）、"在右栏查看"；时间线计划卡。
- **后台任务**（06）：会话标题栏"后台任务"按钮（running 数徽标），右栏 Jobs tab：列表（状态点、标签、时长、退出码）、选中项输出（anser 渲染 SGR，局部横向滚动，跟随尾部，停止按钮）；后台 bash 工具卡显示 Job chip；`job_notification` 为时间线紧凑行。
- **用量**（11）：每个 Run 结束后时间线显示用量行（Token 合计、费用或"未定价"）；会话标题栏 Session 累计费用（HoverCard 分项：输入、输出、缓存读写）。
- 新 kind 在对应票交付前不渲染、不报错。

### 结构拆分（票 01，行为不变）

- J1：`ContextContribution.ruleTools?: readonly { name, permissionClass }[]`（静态），memory 与 mcp 贡献各自声明；`ContextAssembly` 汇总给 `PermissionService`；删除 sessions.ts 的 `CONTRIBUTED_TOOLS`、`#hostToolNames` 的 `process.cwd()` 与 `#rememberContributed`（宿主工具名改由工具工厂的 `names()` 或固定哨兵目录给出）。
- J2：`mcp.ts` 拆出 `mcp-admin.ts`（view、updateServers、approve、reconnect），`McpManager` 只留连接池与运行时；`mcpContribution.tools` 每个 Run 只 `#load` 一次。
- J4：`ContextService`（`application/context-service.ts`）提供 `scopeFor({ sessionId?, workspaceId? })`、`contextUsage`、`commands(scope)`、`skills(scope)`；`MemoryService` 由 Application 持有；`routes/{context,commands,skills,files,memories}.ts` 只校验与调用。
- J5：`engine/compaction-driver.ts` 持有熔断、摘要、`compactNow`、`autoCompact`、`recoverOverflow`，运行时只留接线；另拆 `engine/system-message.ts`。
- J6：`SourcedCommand` 移入 `context/types.ts`，`CommandSourceContribution.list` 返回 `Promise<SourcedCommand[]>`，删除 `isSourcedCommand` 守卫。
- J7：server `adapters/ipc-decryptor.ts` 的 `createIpcDecryptor({ requestType, resultType, … })` 供 Credential 与 Secret；desktop main `encrypting-bridge.ts` 的 `createEncryptingBridge`。
- sessions.ts 拆出 `session-models.ts`（默认模型、档位、setModel、contextModel）与 `session-runs.ts`（`#start`、运行时构造与 Run 上下文），sessions.ts ≤ 300 行；runtime.ts ≤ 450 行；本票新建或改动的文件 ≤ 500 行。

### 运行时与装配 seam（票 02）

- `RunInput.trigger?`（缺省 submit）与 `RunInput.goal?`（写入 run_start）；`AgentRuntime.stopAfterBatch(error: RunError)`：本批完成后停止，run_end 为 `paused` 加该 error。
- `ContextContribution.beforeRequest?(state, scope) → void | { stop: RunError }`（组合后经 `RuntimeContext.beforeRequest` 交给运行时，返回 stop 时调用 `stopAfterBatch`）；`ContextContribution.pendingInput?(scope) → TextContent[]`（下一个 Run 的 user message 开头合并的内容，供 Job 通知）；`ContextContribution.onRunEnd?(scope, result)`（Goal 推进与 waiting-input 判定用）。system section 顺序：指令 → Skills → Memory → plan → goal → todo。
- `session-runs.ts` 的统一入口 `startRun(sessionId, { trigger, input, goal? })`，submit / retry / continue / Goal Round / 动作都经它；`ActionResult` 可为 `{ runId }` 或 `{ done: true }`（不开始 Run 的动作，如 `/goal pause`，204）。
- 内置命令表增加 `plan`、`goal`（动作由 08、09 的贡献实现；实现前提交它们 400 `bad-request`）。
- server 存根：`application/jobs.ts`（JobService）、`application/goals.ts`（GoalService）、`application/processes.ts`（ProcessRegistry：启动清理与关闭钩子，空实现）、`context/{plan,goal,todo,jobs}.ts` 空贡献、`routes/{goals,jobs}.ts` 空 router，均在 `runtime/layers.ts` 装配；关闭顺序：停止 HTTP → 中断 Run → 关闭 Job → 关闭上下文贡献 → 终止登记进程 → 关闭存储。
- renderer：`dock/`（`dock.tsx`、`dock-slots.ts`：todo、goal、queue 三个 `available: false` 的槽）、`header-actions.ts`（jobs、cost 两个占位）、`right-panel/tabs.ts`（plan、jobs 两个占位）、composer 底栏 `plan-chip` 槽、时间线对新 kind 的分发（各自组件文件，票 02 放空组件）、chat-store 的 `onProgress(listener)` 供功能 store 订阅 progress。
- 依赖：apps/server `node-pty` 1.2.0-beta.15；apps/desktop（devDependency）`anser` 2.3.5；`allowBuilds` 与 postinstall；TECH_STACK 登记。

### 共享装配点与所有者（M4 期间）

"A → B"表示按票的顺序修改，前一票合入后下一票才动；没有列出的票不改。

- **只有 02 改：** `packages/protocol/src/{index,entries,ws,runs}.ts`；`packages/agent/src/{index.ts,package.json}`、`session-entries/index.ts`、`session-entries/runs.ts`、`tools/registry.ts`、`instructions/commands/builtin.ts`、`tasks/index.ts`；`packages/session/src/sqlite/schema.ts` 与迁移、`store.processes`；`pnpm-lock.yaml`、`pnpm-workspace.yaml`、根 `package.json`；`packages/i18n/src/dictionaries.ts` 与 `dictionaries/{en,zh}.ts`；server `http/routes/index.ts`、`application/context/{index,types}.ts`、`application/index.ts`；renderer `stores/chat-store.ts`、`features/conversation/{conversation-pane,composer,timeline,timeline-view}.tsx|ts`、`dock/dock.tsx`、`right-panel/right-panel.tsx`；`tests/integration/sidecar-harness.ts`、`secrets-gate-harness.ts`、`apps/desktop/e2e/harness.ts`。
- **按顺序：**
  - `apps/server/src/application/sessions.ts`、`session-models.ts`：01 → 02。`session-runs.ts`：01 → 02 → 04 → 09 → 10。
  - `packages/agent/src/engine/`（runtime、types、compaction-driver、system-message）：01 → 02 → 10。
  - `packages/agent/src/policy/decide.ts`：02 → 08。`policy/gate.ts`：02 → 08。
  - `packages/agent/src/ports/{exec,local-exec}.ts`：03 → 04 → 05。`ports/pty.ts`：02（类型存根）→ 05。
  - `packages/agent/src/tools/builtin/bash.ts`：04 → 05。
  - `apps/server/src/runtime/layers.ts`：01 → 02 → 03 → 05。`apps/server/src/adapters/mcp.ts`：03。`adapters/faux.ts`：02 → 10。`application/permissions.ts`：01 → 02。`application/session-permissions.ts`：08。`application/recovery.ts`：02（Goal、Job 的恢复钩子）。
  - 领域文件各归其票：`goals/`、`session-entries/goals.ts`、`protocol/goal.ts`、`application/{goals,goal-driver}.ts`、`context/goal.ts`、`routes/goals.ts`：02（存根）→ 09 → 10（protocol/goal.ts 另有 11 读取不改）。`tasks/todo/`、`session-entries/tasks.ts`、`protocol/todo.ts`、`context/todo.ts`：02 → 07。`planning/`、`session-entries/{planning,permissions}.ts`、`protocol/{planning,permissions}.ts`、`context/plan.ts`：02 → 08。`tasks/jobs/`、`session-entries/jobs.ts`、`protocol/jobs.ts`、`application/jobs.ts`、`context/jobs.ts`、`routes/jobs.ts`：02 → 04 → 05。`application/processes.ts`、`adapters/processes.ts`：02 → 03。`adapters/pty.ts`：05。`models/registry.ts`、`protocol/http.ts`、`session-entries/context.ts`、`protocol/context-entries.ts`：10。
  - i18n `dictionaries/domains/`：`jobs.ts` 02 → 04 → 06；`todo.ts` 02 → 07；`plan.ts` 02 → 08；`goal.ts` 02 → 09 → 11；`usage.ts` 02 → 10 → 11。
  - renderer：`dock/dock-slots.ts`、`header-actions.ts`、`right-panel/tabs.ts` 由 02 建立，07 / 08 / 06 / 11 各只把自己的一行改为可用（同 M3 设置分区注册表）。`dock/todo-card.tsx`、`queue-card.tsx`：07。`plan-chip.tsx`、`plan-card.tsx`、`plan-review-panel.tsx`、`right-panel/plan-tab.tsx`、`mode-picker.tsx`、`approval-panel.tsx`：08。`right-panel/jobs-tab.tsx`、`job-row.tsx`、`tool-cards.tsx`、`stores/jobs-store.ts`：06。`dock/goal-card.tsx`、`goal-row.tsx`、`run-usage-row.tsx`、`session-cost.tsx`、`stores/goal-store.ts`：11。`features/settings/{model-catalog,models-section}.tsx` 与价格草稿：10。
  - 构建：`apps/desktop/build/build.ts`、`tsdown.config.ts`、`forge.config.ts`、`e2e/package-smoke.e2e.test.ts`：05。
  - 测试夹具：`tests/fixtures/mcp/` 增加忽略 stdin 关闭的 stdio Server：03。
- **文档：** `packages/agent/README.md`、`apps/server/README.md`：01 → 02 → 10（10 汇总 M4 全部变化，其余票把需要写入的要点写进 Comments）；`packages/session/README.md`：02；`docs/tech-stack/architecture.md`：01；`docs/tech-stack/agent-runtime.md`：不改（目标约定）；`docs/tech-stack/desktop-delivery.md`：05；`docs/TECH_STACK.md`：02（node-pty、anser、接入状态）；`docs/subsystems/permissions.md`：02 → 08（05 把 job_input 的一行写进 Comments 由 Lead 合并）；新子系统页 `execution.md`（03 → 05）、`jobs.md`（04 → 06）、`todo.md`（07）、`plan-mode.md`（08）、`goal.md`（09 → 10 → 11）；`docs/subsystems/context.md`：07、08、09 各在"压缩"节后追加自己的一段重新注入说明，由 Lead 合并冲突；`docs/README.md` 当前行为每票只增自己的一行；ADR：0011（09 → 10 补证据，10 改 implemented）、0012（03 → 04 → 05 补证据，05 改 implemented）、0005（08 补 plan 的实施记录）、0003（02 补 host_processes 表）。模型服务 PRD 10.1：10 追加修订记录。

## Testing Decisions

- 好的测试只断言外部事实：协议响应与事件、faux requestLog 中实际发给模型的 system sections 与消息、重新读回的条目、文件与进程是否存在、窗口中实际渲染与交互。
- 测试接口（由高到低）：
  1. **Sidecar 协议**（主接口）：`ELECTRON_RUN_AS_NODE=1` 启动真实 Sidecar，临时 `COKO_HOME`、Workspace 与 faux 脚本（按顺序给出每轮回复，可设 usage）。覆盖：Goal 的创建、逐轮推进、revision 冲突、九个阶段的转换、五维预算耗尽、未定价模型、完成证据拒绝与接受、SIGKILL 后重启为 paused 且不推进、取消的清理；Plan 的进入、限制、提交、编辑后批准、继续规划、恢复 prior；Todo 校验与注入；后台 Job 的输出、wait、kill、通知（运行中与空闲两种）、重启 lost；PTY 的输入与 Ctrl-C；孤儿清理。
  2. **packages/agent**：Goal 状态机转换表、预算派生（含子 Session 条目的汇总函数）、证据校验、Todo 校验、plan 判定、job_output 游标与 ANSI 去除，表驱动。
  3. **packages/session**：迁移 v7（v6 库升级、备份、STRICT）、`store.processes` 契约（SQLite 与内存）。
  4. **Electron E2E**：dock 三张卡、Plan chip 与右栏审阅、模式菜单、后台任务视图与停止、Goal 卡操作与预算条、Run 用量行与 Session 费用、模型价格输入。
  5. **产物 smoke**：打包产物中启动一个 PTY Job 并读到输出（证明 node-pty 与 spawn-helper 进入 `Resources/sidecar` 且可执行）。
- 进程测试用真实子进程：在前台 bash、后台 Job、PTY Job 与忽略 stdin 关闭的 stdio MCP 测试 Server 运行时 SIGKILL Sidecar，重启后断言这些 pid 在 5 秒内消失；伪造一行 lstart 不符的登记，断言对应进程仍在。等待用可观察条件（进程表、条目、事件），不用固定 sleep。
- 秘密不外泄总闸：新增通道各一个 `secrets-gate-<channel>.test.ts`：goal（含 faux requestLog 中的 `<goal>`）、todo（`<todo_list>`）、plan（`plan` 条目、`<approved_plan>`）、jobs（日志文件、`job_output` 结果、WS `job_output` 帧、HTTP 输出接口、通知文本）、pty（PTY 回显）。harness 的落盘扫描范围增加 `<dataDir>/jobs`。
- 符号链接越界：票 04 断言 Workspace 内指向 Job 日志目录的符号链接经 read 读取时仍需审批（日志目录不是读取根）；票 05 断言 PTY 的 cwd 是 Workspace 的真实路径（Workspace 经符号链接登记时命令中的 `pwd -P` 为目标路径）。其余票不新增文件读取，在 Comments 写明。
- 真实模型：具备凭据时跑一条带两轮 Goal Round 与 Todo 的真实对话，否则报告未验证。

## Out of Scope

- Goal：多个并行 Goal、跨 Session 的 Goal 列表、独立评估器、失败自动重试、子代理消耗的实际汇入（M5 接入，M4 只提供汇总接口）、Scheduler 定时恢复（M5）。
- Plan：模型可调用的"进入规划"工具、语义化授权（claude-code `allowedPrompts`）、计划写入 Workspace 文件。
- Todo：owner、认领、加锁与跨代理共享的 Task（M5 Agent Teams）、TaskCreated / TaskCompleted Hook（M5）。
- Jobs 与 PTY：超时或阻塞后自动转后台、卡住检测、跨重启恢复运行中的 Job、用户在界面上向 PTY 输入、终端模拟器（xterm）、持久终端会话、日志清理、Windows ConPTY。
- 费用：多币种换算、按 Provider 的计费规则、额度告警通知。
- 发布构建的产物 E2E、签名与公证（M6）。

## Further Notes

- node-pty 1.2.0-beta.15 是预发布版本：选择理由是与 DSH 一致且 DSH 已在 Electron 上使用。票 02 在本机 Electron 41.0.3 的 `ELECTRON_RUN_AS_NODE` 下验证加载与 spawn；若失败，以 BLOCKED 报告并附错误，由 Lead 决定改用 1.1.0（latest）还是 1.2.0-beta.18。
- 孤儿清理依赖 `ps -o lstart=`（macOS 与 Linux 都有）；只在 darwin 验证，其他平台的用例显式跳过并写明原因。
- Goal Round 会在无人值守时消耗费用。缺省 `maxRounds` 50；界面在 Goal 卡上始终显示轮次与费用（未定价时提示）。
- 并行窗口只派发写范围不重叠的票：{03, 07, 08}、{04, 07, 08}、{05, 06, 09}；01、02、10、11 串行。每票合入前做该票 diff 的轻量 Spec 评审，里程碑末做两轴全量评审。
