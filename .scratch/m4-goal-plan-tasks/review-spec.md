# M4 Spec 轴评审（6bda8e3...HEAD）

- 评审人：spec 子代理（只读；本文件是唯一改动）。日期 2026-10-30。
- 依据：[spec.md](spec.md)（下称"规格 Lnn"）、[grilling.md](grilling.md)、`issues/01–11` 及 Comments、ADR 0011、ADR 0012。
- 已接受的偏离（各票 Comments 中 lead 的裁决）不重复报告，只在实现本身有误时提出。
- 严重度：**hard** = 与规格或用户故事的明文不符，或可以复现的错误行为；**judgement** = 规格没有明说，或属于取舍，需要 Lead 裁决。
- 实际运行：`pnpm exec vitest run packages/agent/src/goals packages/agent/src/planning packages/agent/src/policy/decide.test.ts` 退出 0（4 个文件，269 例）。运行前确认没有其他 vitest 进程。没有运行集成测试与 E2E。下面的结论来自读代码，新发现的问题都没有用测试复现（要复现须新增测试文件，超出只读范围）。

## 结论摘要

| # | 类别 | 严重度 | 问题 |
| --- | --- | --- | --- |
| 1 | (c) 实现有误 | hard | 用户提交的 Run 中模型调用 `wait_input`，Run 结束时 Goal 立即被唤醒并开始下一轮 |
| 2 | (c) 实现有误 | judgement（高） | 取消 Goal 的过程中用户点"恢复"，可能开出一个不受预算检查、在取消之后继续花钱的 Goal Round |
| 3 | (a) 部分 | judgement（高） | `job_input` 逐段判定：把命令拆成几次输入可以绕过 deny 规则 |
| 4 | (a) 部分 | judgement（高） | 进入 plan 之前启动的 Job 保留原沙箱；plan 模式下的 `job_input` 仍可经 workspace-write 的 PTY 写 Workspace |
| 5 | (c) 实现有误 | judgement | 自动压缩的摘要请求排在预算检查之前：预算耗尽或模型未定价时，仍可能发出一次模型请求 |
| 6 | (a) 部分 | judgement | Goal Round 中出现计划审阅时，Goal 不进入 waiting-input（规格 L118） |
| 7 | (c) 实现有误 | judgement | 批准计划时可选的模式可能比 prior 更宽（用户故事 9 写的是"较窄模式"） |
| 8 | (c) 实现有误 | judgement（低） | 批准计划后，同一 Run 内仍保留 `<plan_mode>` section 与 exit_plan_mode 工具 |
| 9 | (a) 部分 | judgement（低） | `job_kill` 的 `reason` 没有记录（工具描述写的是 recorded in the log） |
| 10 | (c) 取舍理由有误 | judgement | ModelPrice 不设下限的理由不成立：main 在发送前已按同一 schema 校验 |
| 11 | 评审项 | judgement | 控制通道静默丢弃不合 schema 的消息 |
| 12 | 评审项 | judgement | ANSI 绿与黄在浅色主题下对比度约 2.1–2.3:1；Goal 卡的 `text-warning` 文案也受影响 |
| 13 | 评审项 | judgement | checkpoint 备份 hook 先于预算 hook |
| 14 | 评审项 | judgement | plan.e2e 的菜单重试 |
| 15 | 评审项 | judgement | Radix 菜单使 Browser Mode 中 getByRole 失效 |
| 16 | 评审项 | judgement（低） | 孤儿清理：登记窗口内的 pid 复用（已核对，风险可忽略） |
| 17 | (b) 越界 | judgement（低） | `constraints` 可经 HTTP 与 update_goal 编辑（规格 L96、L110 没有列出） |

下面"已核对、未发现问题"一节列出逐条核对过的高风险点。"未读或只抽样"一节列出没有读到的部分。

---

## (c) 实现有误 / (a) 部分实现

### 1. 用户提交的 Run 中调用 `wait_input` 后，Goal 被立即唤醒（hard）

- **位置**：`apps/server/src/application/goals.ts:509`（`endChange`）与 `goals.ts:378-379`（`runEnded` 之后的推进）。
- **规格**：L82 `running → waiting-input`：模型调用 `update_goal { action: wait_input }`。L84 `waiting-input → running` 的条件是"用户提交消息、回答审批或结果确认之后的 Run 结束"。用户故事 2："……直到完成、需要我输入……"。
- **问题**：`endChange` 只判断 `goal.phase === 'waiting-input' && trigger !== 'goal' && status === 'completed'`，不看 Goal 是在本 Run 之前还是本 Run 之中进入 waiting-input 的。复现路径：Goal 为 running，用户提交一条消息（trigger submit）。这个 Run 中 update_goal 已注册（Session 有 Goal），授权为 user。模型判断需要用户补充信息，调用 `wait_input`，Goal 进入 waiting-input。Run 以 completed 结束后，`runEnded` 走到 `wake`，Goal 回到 running，`advance` 随即开始 Goal Round。模型要等的用户输入没有到来，Goal 已经继续无人值守地推进。Goal Round 中调用 wait_input 时 trigger 为 goal，不受影响。审批未回答的路径走 `approval-unanswered`，也不受影响。
- **测试**：`tests/integration` 中没有任何 `wait_input` 用例（grep 结果为 0）。`goals.test.ts` 只覆盖转换表本身。
- **修复**：只有当本 Run 的 `run_start` 晚于让 Goal 进入 waiting-input 的那条 `goal` 条目时才 wake。可以比较 seq：在 `entries` 中找到最后一条 phase 变为 waiting-input 的 goal 条目的 seq，再找到本 Run 的 run_start 的 seq，前者小于后者才唤醒。补一个集成用例：用户提交的 Run 中 faux 调用 wait_input → Run 结束 → 断言 Goal 仍为 waiting-input、没有新的 trigger goal 的 run_start → 用户再提交一次 → 断言回到 running 并推进。

### 2. 取消进行中用户点"恢复"，Goal Round 在取消之后不受控地运行（judgement，高）

- **位置**：`goals.ts:214-246`（`act`）没有检查 `#cancelling`。`goals.ts:258-296`（`#cancel`）在第 274 行只取一次 `activeRunId`。`goals.ts:141`：`beforeRequest` 在 `phase !== 'running'` 时直接放行。
- **规格**：L104 取消要停止进行中的 Run 并等待 run_end。用户故事 5："取消时进行中的 Run 与后台任务一起停止"。ADR 0011 要求停止传播。
- **问题**：`#cancel` 的第一段锁只设置 `#cancelling`，不 bump revision，之后在锁外等待 Run 结束、终止 Job。这段时间里，`runEnded`、`#jobEnded` 与模型的工具调用都因 `#cancelling` 而跳过，但 `act` 没有这个检查。如果 Goal 在取消时是 paused / blocked / failed / budget-exhausted（revision 未变），用户在取消返回前点"恢复"（界面上两个按钮都能按，或者两个窗口），`act` 会在锁内提交 running 并调用 `advance`，开出一个新的 Goal Round。`#cancel` 的 `activeRunId` 在这之前已经读过，不会 abort 新 Run。取消快照提交后 Goal 为 cancelled，`beforeRequest` 与工具调用 hook 都只检查 running 的 Goal，于是这个 Goal Round 跑到自然结束，期间不做任何预算检查。触发需要用户在取消过程中再操作一次，窗口最长 30 秒（`CANCEL_RUN_WAIT_MS`）加 Job 的 5 秒宽限。
- **修复**：`act` 与 `port().create/update` 在锁内遇到 `#cancelling.has(sessionId)` 时抛出 409 `invalid-transition`；`GoalDriver.advance` 同样拒绝。再加一道保险：`#cancel` 在提交 cancelled 之前重新读一次 `activeRunId`，仍有 Run 时 abort 并等待。

### 3. `job_input` 逐段判定，拆分输入可以绕过 deny 规则（judgement，高）

- **位置**：`packages/agent/src/tasks/jobs/tools.ts:170`（`permissionSubject: (args) => args.text`）。
- **规格**：L138"判定对象为 `text`（与 bash 命令同一套规则）"；L154"拒绝与询问规则对所有类照常生效"。grilling G2："向交互式 shell 写入等同于执行命令"。
- **问题**：shell 执行的是到回车为止的整行，判定却只看本次的 `text`。例如 deny 规则 `Bash(rm *)` 下，模型可以先 `job_input {text:"r"}`，再 `job_input {text:"m -rf build", submit:true}`，两段各自都不匹配。full-access 下没有询问，deny 规则是唯一的防线，因此这条路径能静默绕过。default 模式下用户会看到两条片段审批，也很难看出合起来是什么命令。验收只测了整段命令（`sidecar-pty.test.ts:153`）。
- **修复**：JobService 为每个 pty Job 保存上次回车（`\r`）之后的未提交输入，`ctrl_c` 时清空。判定对象改为"已缓冲的输入 + 本次 text"。`permissionSubject` 需要经端口取到缓冲，或者由宿主在 gate 中给出。补一个用例：两段拼成的命令被 deny。也可以退一步：在 deny 或 ask 规则存在时，拒绝不带 submit 的 job_input。

### 4. 进入 plan 之前启动的 Job 保留原沙箱，plan 模式下仍可写 Workspace（judgement，高）

- **位置**：`apps/server/src/application/jobs.ts:369-373`（spawn 时固定 `request.sandbox`）。`apps/server/src/application/session-permissions.ts:125-141`（`setMode` 不涉及 Job）。`tools.ts:170` 的 job_input 判定不知道 Job 的沙箱。
- **规格**：用户故事 7："切到规划模式后 Agent 只能调研、不能改 Workspace（写入与命令都要我批准，命令只读沙箱）"。L114 plan 的命令沙箱为 read-only。L138 job_input"与 bash 同一套规则"。
- **问题**：bash 在执行时按当时的模式选沙箱。后台 Job（包括 PTY）的沙箱在 spawn 时固定，切换模式后不变。在 default / accept-edits 下启动的 `bash -i`（tty），用户切到 plan 之后，模型的 job_input 文本仍在 workspace-write 的沙箱中执行。若有匹配的 allow 规则（例如 `Bash(npm *)`），文本不经询问就会执行，Workspace 被修改，"命令只读沙箱"不成立。非 PTY 的 watcher 类 Job 也会在 plan 模式下继续写 Workspace，这一点规格没有覆盖。
- **修复**：`BackgroundJob.info` 记录 spawn 时的沙箱档位。job_input 判定时，如果该档位宽于当前模式的档位（`widerSandbox`），无论规则如何都询问；在 plan / read-only 下也可以直接拒绝，原因写"job started under a wider sandbox"。进入 plan 时在 `<plan_mode>` 中列出仍在运行的 Job，或者在界面上提示。规格补一句 Job 与模式切换的关系。

### 5. 自动压缩的摘要请求排在预算检查之前（judgement）

- **位置**：`packages/agent/src/engine/runtime.ts:155-157`（`autoCompact` 在 `beforeRequest` 之前）。手动 `/compact` 的 trigger compact 也不经检查。
- **规格**：L102"每次模型请求前（运行时 `beforeRequest`）检查 Token、费用、时间……设了 `maxCost` 而当前模型未定价时不发请求"。
- **问题**：上下文越过压缩阈值时，摘要请求是一次真实的模型请求，它在预算检查之前发出。Token、费用或时间已经耗尽时，仍会多花一次摘要请求，之后才 stop。maxCost 加未定价模型的情况下，规格写"不发请求"，这里仍会发出摘要请求。每个 Run 至多一次，Goal Round 开始前的 `advance` 五维检查限制了总量。
- **修复**：`prepareRequest` 中先做一次不计压缩的 `beforeRequest`，返回 stop 时不压缩；压缩之后再检查一次（计入压缩的 usage）。或者把检查放进 compaction driver 的 `summarize` 之前。如果认为现状可以接受，在 goal.md 的已知限制中写明"压缩请求可能越过预算一次"。

### 6. Goal Round 中的计划审阅不使 Goal 进入 waiting-input（judgement）

- **位置**：`goals.ts:505`（只有 Run 被停止且审批 cancelled 时才是 waiting-input）。
- **规格**：L118"Goal Round 中的 plan 审阅使 Goal 进入 waiting-input"；L82"Goal Round 以等待审批或结果确认结束"。
- **问题**：exit_plan_mode 的审阅阻塞在 broker 中，Run 不会结束。Goal 一直显示 running，Goal 卡上是运行中，用户看不到 Agent 在等自己。时间预算在这段时间里一直累计（L100 规定含审批等待），对用户可见的状态与规格不一致。票 08 的 Comments 写"Run 以等待审批结束的判定与其他审批相同"，但运行中的计划审阅本身没有改变 Goal 的状态。
- **修复**：方案一：plan kind 的 `approval_request` 提交时，若本 Run 是 Goal Round，GoalService 提交 `wait-input`（reason `plan-review`）；回答后在同一 Run 中提交 `wake`。这需要放开"wake 只在 Run 结束后"的约束。方案二：在规格与 goal.md 中改写这一行，说明 Goal 保持 running，只在 Run 被停止时进入 waiting-input，Goal 卡另外显示"等待审阅"。

### 7. 批准计划时的可选模式可能比 prior 更宽（judgement）

- **位置**：`packages/protocol/src/permissions.ts:85`（mode 为 default | accept-edits，不看 prior）；`apps/desktop/src/renderer/features/conversation/plan-review-panel.tsx:256`（"批准并允许编辑"总是给出 accept-edits）。
- **规格**：用户故事 9："回到进入规划前的权限模式（或我选择的较窄模式），so that 规划不会意外放宽……我的设置"。L118"可选 default / accept-edits，不可为 full-access"。
- **问题**：两处规格不一致，实现按 L118。prior 为 read-only 时，审阅卡仍给出"批准并允许编辑"（accept-edits），一键就把模式放宽到进入前没有的档位。这是用户的显式选择，但与用户故事 9 的表述相反。
- **修复**：由 Lead 选定一种口径并改规格。如果按用户故事 9：sidecar 拒绝宽于 prior 的 mode（400），审阅卡在 prior 为 read-only 或 default 时隐藏或禁用更宽的选项。如果按 L118：把用户故事 9 的"较窄"改为"default 或 accept-edits"。

### 8. 批准后同一 Run 中的 `<plan_mode>` 与 exit_plan_mode 不会更新（judgement，低）

- **位置**：`runtime.ts:310`（system sections 每个 Run 只取一次）；`apps/server/src/application/context/plan.ts:40-44`（工具在 Run 开始时注册）。
- **规格**：L118 批准后"Run 继续"，在新模式下执行；L116 `<plan_mode>` 只在 plan 模式下注入。
- **问题**：批准后的同一 Run 里，模型仍然看到"不改动 Workspace，用 exit_plan_mode 提交"，与 toolResult 的"Proceed under <mode>"互相矛盾。exit_plan_mode 仍可调用，会再次弹出审阅。判定已经按新模式进行，所以权限上没有问题。
- **修复**：toolResult 中明确写"plan mode has ended; ignore the <plan_mode> instructions"。或者在 runtime 中允许宿主在批准后刷新 system sections。在 plan-mode.md 中记一行已知限制。

### 9. `job_kill` 的 `reason` 没有记录（judgement，低）

- **位置**：`packages/agent/src/tasks/jobs/tools.ts:121`（描述写"recorded in the log"）；`apps/server/src/application/jobs.ts:143`（`kill: async (jobId) =>` 丢弃了 reason）、`jobs.ts:509`。
- **规格**：L129 `job_kill { job_id, reason? }`。
- **修复**：把 reason 经 redactText 处理后写进 `job stop requested` 日志，或者写进 Job 日志末尾，或者改掉工具描述。

### 10. ModelPrice 不设下限的理由不成立（judgement）

- **位置**：`packages/protocol/src/http.ts:166-169`；`apps/desktop/src/main/credentials.ts:29`。
- **背景**：票 10 的取舍 ⑤，lead 已接受。
- **问题**：取舍的理由是"schema 拒绝会使控制通道静默丢弃消息"。但 main 在发送之前已经用同一个 `ProviderFields` schema 做 `Value.Check`。如果 ModelPrice 加 `minimum: 0`，负数价格会在 main 处得到 `invalid-input`，不会到达控制通道，也不会被丢弃。真正的差别只是错误文案：通用的 `Invalid Provider draft`，还是 sidecar 的具体 400 文案。现在信任边界上的协议 schema 没有表达"非负"，只靠 sidecar 的 `ModelConfigError` 兜底。
- **修复**：给 ModelPrice 加 `minimum: 0`，main 的 `parseInput` 对价格给出具体的失败信息（例如 `invalid-input` 加 details.field）。sidecar 的 400 校验保留。修正 http.ts:163 与 goal.md 中关于这条理由的说法。

## (b) 越界

### 17. `constraints` 可编辑（judgement，低）

- **位置**：`packages/protocol/src/goal.ts:99`；`packages/agent/src/goals/tools.ts:112`。
- **规格**：L96 与 L110 的 edit 字段只有 objective、criteria、budget。
- **评价**：create 已支持 constraints，编辑与它对称，实现小，已写进 goal.md:100。建议接受，并在规格 L96 与 L110 补上。

没有发现其他越界改动。各票 Comments 中的越界改动都已由 lead 接受；抽查的 timeline 通知过滤、204 处理、`/goal` 在本地打开 Goal 卡都与规格的意图一致。

---

## Lead 交给评审的项目

### 11. 控制通道静默丢弃不合 schema 的消息

- **位置**：`apps/server/src/control/channel.ts:34`（sidecar 收到 main 的非法消息时只调用 `onInvalid`，`runtime/main.ts:14-16` 记一条 warn）；`apps/desktop/src/main/sidecar-process.ts:181-184`（main 收到 sidecar 的非法消息时：就绪前启动失败，就绪后终止 sidecar）。
- **判断**：两个方向的处理不对称。main → sidecar 的非法消息被丢弃后，main 的请求只能等到超时（provider.save 有超时，见 credentials.test.ts:172），用户看到 timeout 而不是校验错误。实际触发条件是两端 schema 不一致（同一个包，发布产物中不会出现），或者 main 自己构造了错误的消息。目前 main 发送前都做了 `Value.Check`（credentials.ts:29、provider-models.ts:44），所以没有现实的触发路径。
- **建议**：sidecar 端对带 `requestId` 与可识别 `type` 的非法消息回答 `<type>.result { ok:false, code:'invalid-message' }`。协议层为每类请求声明对应的失败结果，sidecar 用一个通用的回答函数。main 端为每条发出的消息加一个开发构建的断言（发送前 `Value.Check(MainToSidecarMessage, msg)`）。优先级低，不阻塞 M4。

### 12. ANSI 颜色对比度

- **位置**：`apps/desktop/src/renderer/features/right-panel/jobs-tab.tsx:28-31`（绿 → `text-success`，黄 → `text-warning`）；`packages/ui/src/theme.css:38-39, 89-90`（green-500 `rgb(34 197 94)`，amber-500 `rgb(245 158 11)`）。
- **计算**：在白色背景上，green-500 约 2.3:1，amber-500 约 2.1:1，都低于 WCAG AA 正文的 4.5:1。终端输出是正文大小的等宽字体，应按 4.5:1 衡量。
- **依据**：`docs/tech-stack/ui-design-system.md:32`"文字与背景的组合在明暗两套主题下都需可读……用于文字前在两套主题下分别核对对比度"。
- **扩展**：同一个问题也出现在 Goal 卡：`dock/goal-card.tsx:124`（warning 级的预算文字）与 `goal-card.tsx:182`（未定价提示）在浅色主题下用 `text-warning` 显示正文。这一点在票 11 的截图检查中没有提到。
- **建议**：在 ui 包中新增前景用 token `--success-foreground-text` / `--warning-foreground-text`：浅色主题取 green-700 / amber-700（对比度约 5:1），深色主题保持 500。ANSI 映射与 Goal 卡的文字都改用这两个 token；`bg-warning` 的填充条不变。改 token 前按 AGENTS.md 先读 ui-design-system.md。256 色与真彩色的降级显示可以保留，作为已知限制。

### 13. checkpoint 备份先于预算 hook

- **位置**：`apps/server/src/application/session-runs.ts:443`（`[...extension.hooks, runContext.hooks.hooks, secretRedactionHook]`）；checkpoint 在 `packages/agent/src/checkpoints/tracker.ts:119` 的 beforeToolCall 中备份；goal.md:177 已记为已知限制。
- **判断**：调换顺序有实际好处：被预算拦下的 write / edit 不留无主备份，也省掉一次读文件、写快照。风险是 hook 的顺序约定变了：checkpoint 必须在"确定要执行"之后、执行之前。预算 hook 不修改参数，排在 checkpoint 之前不会影响备份内容。影响面小，备份不被引用，`<dataDir>` 中多一个 blob。
- **建议**：调换。做法是把贡献的 hook 拆成 `gates`（只返回 block，例如预算）与 `hooks`。顺序改为：权限 → gates → 扩展（checkpoint）→ 其他 → 脱敏。在 tracker 的单元测试中加一例：前置 gate block 时没有 file_backup。可以不在 M4 做，但应当在 M5 加入更多 gate（例如 Hook 系统）之前完成。

### 14. plan.e2e 的菜单重试

- **位置**：`apps/desktop/e2e/plan.e2e.test.ts:40-56`。
- **判断**：断言没有放宽，重试只发生在"菜单没有出现"时，接受它是合理的。根因很可能是 Radix DropdownMenu 的关闭动画：Presence 在退出动画期间保留内容，并给 body 设 `pointer-events: none`，上一次关闭尚未完成时点击触发器会落空。
- **不需要重试的写法**：每次打开前等待上一次的菜单完全卸载，即 `await expect(app.window.getByRole('menu')).toHaveCount(0)`，同时等 `document.body.style.pointerEvents !== 'none'`，然后点击一次；或者用键盘打开（聚焦触发器后按 Enter 或 ArrowUp），不依赖指针命中。建议改成前者并去掉 Esc 重试的循环，保留 30 秒的总超时。

### 15. Radix 菜单使 Browser Mode 中的 getByRole 失效

- **位置**：`mode-picker.tsx:50`（`<DropdownMenu>` 缺省为 modal）；拆分后的四个文件 `plan-{review,approve-menu,tab,chip}.browser.test.tsx`。
- **判断（推测，未复现）**：modal 的 DropdownMenu 打开时，`aria-hidden` 包的 `hideOthers` 给 body 的其他子节点加上 `aria-hidden="true"`（还有 `data-aria-hidden`），并锁住 pointer-events。选中菜单项后，菜单走关闭动画；如果用例在动画结束前结束、组件被卸载，清理可能没有执行，测试容器留着 `aria-hidden`。之后的用例中，`getByRole` 会跳过这些"隐藏"的节点，表现为查询失效，单独运行则通过，与现象一致。
- **建议**：先验证：在失效用例开始时打印 `document.querySelectorAll('[aria-hidden="true"],[data-aria-hidden]')` 与 `document.body.style.pointerEvents`。如果确认，在共用的 browser setup 的 afterEach 中断言、清理这两项（顺便发现其他文件的泄漏），每个用例在结束前等待菜单卸载。之后可以把四个文件合回去。不建议给生产代码加 `modal={false}`，那样会改变焦点与读屏行为。

### 16. 孤儿清理会不会误杀（已核对）

- **结论**：没有发现误杀路径。`processes.ts:150-162` 只在 pid 存在且 lstart 原文一致时发信号；进程组只在 ps 报告的当前 pgid 仍等于登记值时使用（`processes.ts:155`），否则只发给 pid。`ps` 固定 `LC_ALL=C`、`TZ=UTC`（`adapters/processes.ts:22`）。bash、Job、PTY 的 pgid = pid 由 detached 或 setsid 保证。
- **残余风险（judgement，低）**：①登记是异步的：spawn 之后才执行 `ps`（`processes.ts:66-69`）。如果进程在这之前就退出，而 pid 恰好被复用，登记会记下新进程的 lstart。正常情况下 release 会删掉这一行，只有 sidecar 恰好在这个窗口内被强杀才会留下。②lstart 只精确到秒，同一秒内退出并被复用的 pid 无法区分。两者都需要 pid 在毫秒到秒级内被复用，在 macOS 上可以忽略。
- **可选加固**：登记时比较 lstart 与 spawn 时刻，相差超过 2 秒时不登记，只记一条 warn。

---

## 已核对、未发现问题（高风险项）

- **重启后不会继续花钱**：启动顺序为 Store → Processes（清理）→ Assembly → Runs → App（恢复）→ Http（`layers.ts:397`）。`SessionRecovery.recover` 先补齐中断的 Run（经 commitBatch，不触发 onRunEnd），再执行 Job 的 lost 与 Goal 的 paused（restarted）（`recovery.ts:107-114`，`goals.ts:410-424`）。blocked、failed、budget-exhausted 不会自动推进。
- **同一 Goal 两轮并行**：每个 Session 只有一个 runtime，`startRun` 在启动前检查 `isRunning`（`session-runs.ts:259`、`265`），推进在 GoalService 的 Session 锁内进行，轮次取 `max(round) + 1`（`state.ts:96-104`），所以同一 Goal 不会有两轮同时运行，也不会重复同一 round。
- **预算耗尽后**：`advance` 在开始前检查五维（`goal-driver.ts:64-77`）；工具调用 hook 计入已放行、尚未提交的调用（`goals.ts:157-183`）；`stopAfterBatch` 与 `withhold` 保证不发请求（`runtime.ts:153, 171-180`）；恢复须先使耗尽的维度有余量（`state.ts:254-261`）。
- **Plan Mode 的限制**：判定顺序为 deny → ask → 受保护路径 → 越界写入 → plan-exit 总询问 → 模式放行（`decide.ts`）。plan 的放行与 read-only 相同，命令沙箱为 read-only，可写根为空，所以即使有 allow 规则，写入也会因越出可写根而询问。plan-exit 不参与 reevaluate（`session-permissions.ts:313`）。批准、`/plan off` 与 chip 的 × 都回到 prior（`session-permissions.ts:154-157, 194`）。mode 不能为 full-access（schema）。
- **Secret 不外泄**：goal、todo_list、plan、job_* 条目经 `toNewEntry` 脱敏后入库（`goals.ts:440`、`jobs.ts:540`）。`<goal>`、`<goal_round>`、`<todo_list>`、`<plan_mode>`、`<approved_plan>` 只来自已提交的快照。Job 的输出在进入环形缓冲、日志与帧之前经流式按值替换（`jobs.ts:374`）；通知文本再替换一次（`jobs.ts:503`）；command 与 label 经 `redactSecretValues`；登记表的 command 经 `redactText`；job_input 的日志只记字节数（`jobs.ts:524`）。
- **信任边界**：`GoalActionRequest`、`AnswerApprovalRequest`（editedPlan ≤ 64 000）在路由中经 `body()` 校验；Job 的输出与停止接口校验 jobId 格式（`jobs.ts:44, 197`）与 offset / limit（`routes/jobs.ts:7-21`）；renderer 的 goal-store 与 jobs-store 按 schema 校验响应。

## 未读或只抽样

- **没有读**：票 01 的结构拆分（J1–J7）与其 diff：mcp-admin、context-service、compaction-driver 的拆分细节、ipc-decryptor 与 encrypting-bridge 的完整实现（只看了 ipc-decryptor.ts）；packages/session 的迁移 v7、`sqlite/processes.ts`、契约测试；i18n 五个域的文案；`apps/desktop/build/build.ts`、postinstall、package-smoke 的打包细节；`todo.ts` 的校验实现（只依赖票 07 的验收与测试列表）；`exit-plan-mode.ts`、`planning/state.ts`；faux.ts；dock.tsx、queue-card、todo-card、session-cost、run-usage-row、goal-row、job-row、jobs-button、plan-tab、plan-chip、model-catalog 与价格草稿的 UI 代码；chat-store 的 M4 改动；所有 E2E 与集成测试的正文（只按需 grep）。
- **只抽样**：goal-card.tsx（阈值、颜色、取消确认、key）；plan-review-panel.tsx（模式选项）；jobs-tab.tsx（ANSI 映射）；local-exec.ts 与 bash.ts 的 diff；runtime.ts 的 prepareRequest、halt 与 run_start 附近。
- **没有运行**：集成测试、Browser Mode、E2E、真实模型；也没有用测试复现第 1–4 项（需要新增测试文件）。

---

## 处理结果（m4/12-review-fixes，2026-10-30）

| # | 处理 | 测试 |
| --- | --- | --- |
| 1 | `endChange` 只在 Goal 进入当前这段 waiting-input 的快照早于本 Run 的 run_start 时唤醒（afa3b60） | sidecar-goal：用户的 Run 中 wait_input → 仍 waiting-input、没有新的 Goal Round → 再提交后推进（先红） |
| 2 | 同 Standards A3（194dc9b） | 同 A3 |
| 3 | job_input 判定对象 = 终端当前行（上次回车之后）+ text，ctrl_c 清空；同一批中执行时当前行与判定时不同则不发送（a08424b） | sidecar-pty：拆成两段的 `rm -rf build` 被拒绝；同一批两段时后一段不发送、日志没有 build；jobs.test `nextLine` 七例 |
| 4 | 同 Standards A1（a08424b）；非 PTY Job 在模式切换后仍按原沙箱运行，写入 plan-mode.md | 同 A1 |
| 5 | 同 Standards A4（3799caf） | 同 A4 |
| 6 | 方案一：Goal Round 中 kind plan 的 approval_request 使 Goal 进入 waiting-input（plan-review），未取消的回答在同一 Run 中唤醒（049fbd2） | sidecar-goal：phases running → waiting-input → running → budget-exhausted（先红） |
| 7 | 按用户故事 9：批准的 mode 可为 read-only / default / accept-edits，宽于 prior 时 400；审阅卡只在恢复模式为 full-access 时给出"批准并允许编辑"；spec.md L118 已改（f1bdf07） | sidecar-plan：read-only prior 下 default / accept-edits 400；plan.browser：三种 prior 下不给出更宽选项（先红） |
| 8 | 批准结果写明 plan 模式已结束；`PlanReview.active()`，不在 plan 时 exit_plan_mode 不审阅、返回 `Not in plan mode`（f1bdf07） | sidecar-plan：批准后同一 Run 的 exit_plan_mode 为错误结果、只有一个 approval_request |
| 9 | job_kill 的 reason 按值脱敏后记入 `job stop requested`（171a2d0） | sidecar-jobs：日志 properties 带 reason（关闭后读日志） |
| 10 | 同 Standards A7（2d7b227） | 同 A7 |
| 11 | 同 Standards A7 | 同 A7 |
| 12 | 同 Standards A12（cc49c4b）；goal-card 的 `text-warning` 文字改为 `text-warning-text`。context-ring、mcp-section、rewind-dialog 的 `text-warning` 文字未改（不在本票清单） | 同 A12 |
| 13 | 同 Standards A6（8c698ae） | 同 A6 |
| 14 | 同 Standards A11（1ba9e82） | 同 A11 |
| 15 | 同 Standards A10（a653f94） | 同 A10 |
| 16 | 已核对，不改 | — |
| 17 | 接受：spec.md L96 与 L110 补上 constraints，goal.md 写入"编辑"一项 | 已有 goals.test / sidecar 用例 |
