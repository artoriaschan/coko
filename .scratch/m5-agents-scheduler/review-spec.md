# M5 里程碑末评审：Spec 轴

范围：`git diff 873803e...HEAD`（不含 pnpm-lock.yaml 与 .scratch）。依据：spec.md、grilling.md、票 01–10 及 Comments、ADR 0013–0016。只读代码与测试，没有运行测试（见文末"未覆盖"）。

严重度：**hard**＝与规格、ADR 或票的验收明确不符，或有可复现的越权、计费、正确性后果；**judgement**＝规格没写死，或影响较小，需要 Lead 裁决。

各票 Comments 中 Lead 已接受的偏离不再重复，除非实现本身有错。

---

## 一、按风险排序的发现

### H1（hard）后台子代理的通知让 Goal Round 获得用户权限
- 位置：`packages/agent/src/goals/state.ts:393`。
- 规则：spec:158（`runAuthority` 对无人值守的输入为 none）、spec:64（`agent_notification` 紧接在送达通知的 user message 之前）、spec:131（与 Job 通知相同的送达规则）。
- 现状：只有前一条是 `job_notification` 的 user message 才被当作宿主通知；前一条是 `agent_notification` 时，这条消息被判为用户消息，返回 `{ kind: 'user' }`。Goal Round、continue 或 retry 进行中，后台子代理一结束，模型就拿到用户权限，可以 create / edit / pause / resume Goal。通知文本里含有子代理的输出，而子代理的输出可能来自它读到的文件或命令。
- 修复：条件改为 `!['job_notification', 'agent_notification'].includes(entries[i-1]?.kind)`；在 `goals.test.ts` 加一行表驱动用例："goal 触发的 Run 中送达 agent_notification → goal-round"。

### H2（hard）Run 结束时没送达的子代理通知会卡住 Goal
- 位置：`apps/server/src/application/goal-driver.ts:39`，调用方 `goals.ts:455`。
- 规则：spec:131（与 Job 通知相同的送达、挂起与不唤醒规则）。
- 现状：`hasUserSteering` 只认 `JOB_NOTIFICATION_TAG`。`<agent-notification` 文本被退回时算作"用户写的追加指令"，Goal 不推进下一轮，停在 running，直到用户发消息。
- 修复：同时识别 `AGENT_NOTIFICATION_TAG`，或者让 SessionRuns 带出"宿主通知"标记，不再按文本前缀判断；补集成用例：后台子代理在 Goal Round 的最后一次请求之后结束。

### H3（hard）worktree 会话中派发的普通子代理在主 checkout 中工作
- 位置：`apps/server/src/application/subagents.ts:371-378`。
- 规则：ADR 0014 与 grilling:20（子 Session 的目录取父级）、spec:136 与 spec:138（可写根按子 Session 的 cwd）、ADR 0016 的隔离目标。
- 现状：不带 isolation 时，`createSession` 不传 `worktreeId: parent.worktreeId`。`WorktreeService.cwd` 因此把子 Session 解析到 Workspace 目录（主 checkout），子代理在那里读写。父 Session 的 worktree 会话以为改动留在 worktree 里。
- 修复：没有 isolation 时继承 `parent.worktreeId`；补 git 夹具用例：在 worktree 会话中派发 general，bash `pwd -P` 应为 worktree 路径。

### H4（hard）worktree 会话的项目规则、恢复探测与回退仍按 Workspace 目录
- 位置：
  - `apps/server/src/application/permissions.ts:199-200`（`readProjectRules(workspace.path)`，`rulesFor` 按 workspaceId 取规则）
  - `recovery.ts:140-144`（探测与工具注册表的 cwd 是 `workspace.path`）
  - `checkpoints.ts:108`（`restoreFiles` 的 workspace）
  - `context-service.ts:46-70`
- 规则：spec:177（"指令、项目设置、项目 Hook 与 MCP、Skills、子代理定义都从这个目录读取；批准与 Workspace 作用域规则仍按 Workspace"）。项目的 deny / ask 规则属于项目设置，不属于"Workspace 作用域规则"。
- 后果：
  - worktree 分支里加的 deny 规则不生效，主 checkout 的规则反而生效（安全相关）。
  - 启动恢复按主 checkout 的文件给出 applied / not-applied 的探测结论，结论可能是错的，模型据此决定是否重做。
  - 回退的 `outside` 判定以 Workspace 为根：Workspace 不是仓库子目录时，worktree 中的路径全被标为"越界"。
- 票 04 把这些记作已知限制，Lead 要求本评审评估：前两项应修，不应只登记为限制。
- 修复：
  - PermissionService 的项目规则按 `(workspaceId, cwd)` 缓存，`runtimePermissions` 传入 `scope.cwd`。
  - `SessionRecovery` 与 `SessionCheckpoints` 改用 `runs.cwd(session)`。
  - ContextService 同样改用它（judgement，可以晚一些）。

### H5（hard）后台 agent 调用在重启后的结果是"没有副作用，可以重试"
- 位置：`subagents.ts:746`（`!payload.background` 时不补结果），`packages/agent/src/recovery/plan.ts:113`。
- 规则：spec:144（父级被中断的 `agent` 调用的结果为 `Subagent interrupted by a restart; partial results are in child session <id>.`）。
- 现状：后台调用在 `startRun` 返回之后才有 toolResult。崩溃发生在 agent_start 之后、toolResult 之前时，`prepareRecovery` 跳过它，`planRecovery` 按 `effect: 'read'` 给出 `interruptedRead`（"It has no side effects, so you can retry it"）。这时子代理可能已经写过文件，模型重派会重复执行写入。
- Lead 的问题"会不会重派"的回答：
  - 宿主不会自动重派：恢复不续跑 Run，子 Session 拒绝非 subagent 的 trigger，restart 用例也断言了这一点。
  - 但后台调用在这个窗口里拿到的结果文本诱导模型重派，这是缺口。
- 修复：前台与后台都补 `agentInterruptedText`（去掉 `!payload.background`）；或者把 agent 工具改为 `effect: 'side-effect'`、另开调度例外。第一种改动最小。补 restart 用例：后台子代理，在 `startRun` 前设测试挂起点。

### H6（hard）摘要之后目标创建失败：界面卡住，Goal 少计用量
- 位置：`apps/server/src/application/handoff.ts:148-153`，`apps/desktop/src/renderer/stores/handoff-store.ts:94-102`。
- 规则：spec:170（`goalUsage` 计入该 usage）、spec:169（停止或失败时不创建目标）。
- 现状：git 冲突等失败只记一条 warn：
  - 没有 handoff 条目，摘要请求的 token 与费用不进 `goalUsage`，Goal 预算少算一次最长约 2 万 token 的请求（预算绕过）。
  - 摘要文本丢失。
  - renderer 一直停在 `creating`，没有出口（Lead 列出的"停在正在创建新会话"）。
- 修复：失败时仍提交 `handoff` 条目（或新的 `handoff_failed` / `handoff { status: 'failed', error, usage }`，需要 02 所有者同意改 schema），带上 usage 与摘要；renderer 收到后转为 `stopped`，并给出"复制摘要"。补集成用例：worktree 名在校验之后被外部占用 → 有带 usage 的失败条目，`GET goal` 的 tokens 增加。

### H7（hard）plan / read-only 下 isolation 先询问、批准后才返回错误
- 位置：`subagents.ts:356-360`，判定在 `packages/agent/src/policy/decide.ts:237`（`modeAllows`）与 `gate.ts:363` 之后的 ask。
- 规则：spec:142、spec:187（plan / read-only 下工具返回错误结果，其余模式询问）。
- 现状：plan / read-only 下先出审批卡，用户批准后才得到错误结果。Lead 已接受为已知限制；按 Lead 的要求评估：这是 hard 偏离，用户批准了一个注定失败的操作，修复成本很低。
- 修复：在 gate 的 `combinePreToolUse` 之前加一条：`isolation && (mode === 'plan' || mode === 'read-only')` 时返回 `{ block: true, reason: 'isolation: worktree is not available in <mode> mode' }`（Hook deny 之后、规则 deny 之后）；`subagents.ts` 的检查留作纵深防御。补 decide / gate 表驱动行，以及集成用例"plan 下没有 approval_request"。

### H8（hard）子代理的两类桌面通知没有任何测试
- 位置：`subagents.ts:589-591`（agent-finished）、`subagents.ts:617-625`（approval-waiting）。
- 规则：票 07 验收"后台子代理等待审批时发 `approval-waiting` 通知"（已勾选）、spec:164、User Story 9 与 16。
- 现状：在 tests 与 e2e 中搜 `approval-waiting` / `agent-finished`，只命中 `sidecar-schedules` 与 `sidecar-hooks-lifecycle`。票 07 的验收被勾选，但没有证据，与票 05 的 notify 问题同类。代码路径看起来正确。
- 修复：在 `sidecar-subagents.test.ts` 的后台用例中断言 `notifyMessages` 依次为 approval-waiting 与 agent-finished；E2E 跨通道断言一次 `notification shown`（kind agent-finished）。

### H9（hard）后台派发后，同一个 Run 中没有 agent_wait
- 位置：`apps/server/src/application/context/subagents.ts:29-37`；工具只在 `session-runs.ts:357`（Run 开始）取值。
- 规则：spec:131（后台返回文本为 "Wait with agent_wait."）、spec:134（只在本 Session 有子代理时注册）。
- 现状：一个 Session 第一次派发后台子代理时，本 Run 中没有 `agent_wait` / `agent_cancel`，模型按返回文本调用会得到未知工具错误。现有用例在第二个 Run 中才调用 `agent_wait`（`sidecar-subagents.test.ts:111-115`），没有覆盖这种情况。
- 修复：二选一：
  - agent 调用结束后，经 `runContext.tools.set` 增量注册（运行时已支持 toolsAdded 系统消息）；
  - 或者改为"agent 可用时总是注册"，接受多两个常驻工具定义（需要 Lead 复核压缩用例的窗口）。

### J1（judgement）交接之后源 Session 的 Goal 继续推进
- 位置：`apps/server/src/application/goals.ts:455`（handoff Run completed → `driver.advance`），以及 `goals.ts:624`（waiting-input 时任何非 goal 触发的 Run 正常结束都会唤醒 Goal，含 handoff、schedule、subagent）。
- 规则：spec:172（不继承 Goal；源 Session 不变）、spec:15 与 spec:158（定时触发不恢复 Goal）。
- 评估：交接的意图是"在新会话中继续"。源 Goal 立即开始下一轮，会与目标会话并行改同一份代码，同时继续花费源 Goal 的预算。另外，waiting-input 的 Goal 会被一次定时任务 Run 或交接 Run 唤醒，这与"无人值守不扩大权限 / 花费"的精神不符。
- 建议：
  - `runEnded` 中 `trigger === 'handoff'` 与 compact 同样处理：只在预算停止时转换阶段，不 advance。是否暂停源 Goal（新 reason `handed-off`）由 Lead 定。
  - `endChange` 的 wake 限定 `trigger === 'submit'`（或者 runAuthority 为 user）。

### J2（judgement）定时任务的 budget 准入不计子代理用量
- 位置：`apps/server/src/application/schedules.ts:246`。
- 规则：spec:156（任一维度已耗尽时 `budget`）、spec:140（子 Session 计入 G）。
- 现状：直接调用 `goalUsage(entries, goal.id)`，没有带 `children`。子代理把 Goal 用尽之后，定时任务照常被准入；之后被 Goal 的 beforeRequest 停下，记录的是 `started` 加 paused，不是 `skipped: budget`。
- 修复：ScheduleService 注入 GoalService 的用量查询（`GoalService.usage(sessionId)`），不要自行计算。

### J3（judgement）关闭通知后 Notification Hook 也不触发
- 位置：`apps/server/src/application/notifications.ts:51-66`。
- 规则：spec:102（"Coko 发出桌面通知时（不论是否显示）"）。
- 现状：设置关闭时直接 return，观察者也不调用。用户关闭桌面通知、改用 Hook 转发（User Story 4 的"转发通知"）时，什么也收不到。
- 建议：观察者在设置判定之前调用；或者 Lead 明确"关闭"包括 Hook，并写进 hooks.md。

### J4（judgement）父 Session 写入 isolation worktree 不询问
- 位置：`subagents.ts:235-237`（只加 `Read(<path>)` 的询问规则）。
- 规则：ADR 0016（隔离成立）、spec:142。
- 现状：父 Session 在 accept-edits / full-access 下可以免审批 write / edit 子代理保留的 worktree（`.coko-worktrees/` 在可写根内）。读取要审批，写入不要，方向反了。
- 建议：同时加 `Edit(<path>)` 的询问规则；bash 的命令不受规则保护，在 subagents.md 中写明这一点。

### J5（judgement）创建会话时可以绑定已移除的 worktree
- 位置：`apps/server/src/application/sessions.ts:236-249`；协议 `packages/protocol/src/http.ts:86` 的注释写的是"active worktree"。
- 规则：spec:179。规格没有要求拒绝，但协议注释与 ADR 0016 的"移除后只读"都暗示新建应被拒。
- 现状：store（`repositories.ts:170-173`）只校验 Workspace，不看 status。另有一个竞态：交接的 `worktree` 目标在 `#checkTarget` 之后被移除，`#finish` 照样绑定（`handoff.ts:163-171`）。
- 修复：`SessionService.create` 与 `HandoffService.#finish` 中，`status === 'removed'` 时返回 409 `worktree-removed`。

### J6（judgement）子代理的 max-turns 在自动压缩后重新计数
- 位置：`subagents.ts:507`。
- 规则：spec:136（在子 Run 的 beforeRequest 计数）。
- 现状：按 `state.messages` 中的 assistant 条数计数。自动压缩把上下文换成摘要后条数变少，轮次上限可以被越过。
- 修复：按本 Run 已提交的 assistant 条目计数（或在 RunState 中计数）。

### J7（judgement）abort 只在 admit 之前检查
- 位置：`packages/agent/src/engine/runtime.ts:179-182`。
- 现状：Lead 的修复在 `admit` 之前检查 `run.aborted`。但 `admit` 中有 await（例如 `HandoffService.beforeRequest` 会等 `pending.done`，GoalService 会读库），停止在这期间到达时，请求照样发出。
- 修复：`admit` 与 `autoCompact` 之后再检查一次 `run.aborted`。

### J8（judgement）COKO_PROJECT_DIR 与已采纳的决定不一致
- 位置：`apps/server/src/application/hooks.ts:272`（`COKO_PROJECT_DIR: scope.cwd`）。
- 规则：grilling:109（"`COKO_PROJECT_DIR`（Workspace 根，worktree 会话中为原 Workspace）"）。
- 现状：实现中 worktree 会话的值是 worktree 目录。spec:119 只列了变量名。按 cwd 给值更合理，但与已采纳的决定不符。
- 建议：Lead 二选一，然后改 hooks.md 或代码。

### J9（judgement）UserPromptSubmit 收到的是展开前的原文
- 位置：`apps/server/src/application/session-runs.ts:447`（`beforeSubmit(scope, text)`）。
- 规则：spec:97（"trigger submit 的输入展开之后"）。
- 现状：Hook 收到的是原文，不是 `expanded.input`。Skill / 命令展开后的文本 Hook 看不到。stdin 本身经过脱敏。
- 修复：传入展开后的文本（`expanded.input.text`）；或者在规格中改为"原文"。

### J10（judgement）控制通道的另外两处单侧验证
- `apps/desktop/src/main/sidecar-process.ts:187-214`：`switch (message.type)` 没有 `default: assertNever`。之后给 `SidecarToMainMessage` 新增类型时，编译器不会提示漏转发，票 05 的 notify 缺陷就是这样产生的。修复：加 exhaustive default。
- 通知点击的路径是 main → `webContents.send(IPC.openSession)` → preload → renderer `bindOpenSession`。只有两侧各自的单元测试（`main/notifications.test.ts` 用替身，`app/open-session.test.ts` 用假 bridge），没有一个用例经过真实的 IPC 通道名。修复：E2E 中从 main 侧（`electronApp.evaluate`）调用 openSession 的 handler，断言 renderer 打开了目标会话。

---

## 二、Lead 点名的评估项（M5 评审）

| 项 | 结论 |
| --- | --- |
| 交接后源 Goal | J1：继续推进并开始下一轮。建议 handoff Run 不 advance，是否暂停由 Lead 定。 |
| isolation 在 plan / read-only 下先询问 | H7：hard，在 gate 中直接拒绝。 |
| agent 工具 effect 'read' 与重启重派 | H5：不会自动重派；后台调用崩溃窗口的结果文本诱导模型重派，应补中断说明。 |
| 定时任务 prompt 在时间线显示为 `<scheduled_task>` 原文 | judgement。`timeline.ts:274` 同样没有过滤 `<agent-notification`：只含通知的 user message 也显示为原文气泡，与 spec:197（`agent_notification` 为紧凑行）冲突，这一半偏 hard。修复：与 JOB 标签相同，过滤 AGENT_NOTIFICATION_TAG；`<scheduled_task>` 解析后只显示 prompt 并标"定时任务"。 |
| 校验后的 git 冲突使界面停在"正在创建新会话" | H6：hard，另有 Goal 少计用量。 |
| 创建会话时绑定已移除的 worktree | J5：应返回 409。 |
| 上下文用量、恢复探测、项目规则按 Workspace 取作用域 | H4：项目规则与恢复探测为 hard，上下文用量为 judgement。 |
| 切换主题后 Stop 按钮显示为灰色 | judgement、低。`agents-tab.tsx:149` 是 `variant="outline"`，`button.tsx:15` 的 `hover:bg-accent` 没有加 `[@media(hover:hover)]` 守卫（同文件列表项有守卫），并且有 `transition-colors`。截图时指针悬停或过渡还没结束都会显示为灰色。建议：截图前等 `transitionend`，或用计算样式断言；顺带把 hover 改为 hover 媒体查询守卫。 |
| 跨控制通道的验收只查了一侧 | H8（子代理通知完全没有测试）、J10（switch 不穷尽、openSession 没有跨通道用例）。 |

---

## 三、规格覆盖

### (a) 缺失或部分实现
- User Story 9 与 16：子代理的 approval-waiting / agent-finished 没有验证（H8）。
- User Story 8 与 12：worktree 会话中的子代理不在 worktree 中（H3）；父 Session 写入 isolation worktree 不询问（J4）。
- User Story 10：交接失败时摘要用量不计入（H6）；定时任务准入不计子代理用量（J2）。
- User Story 15：waiting-input 的 Goal 会被定时任务 Run 唤醒（J1）。
- User Story 19 与 spec:177：项目设置（规则）不从 worktree 读取（H4）。
- spec:131 与 spec:134：同一个 Run 中派发后台子代理后没有 agent_wait（H9）。
- spec:144：后台调用的中断结果文本错误（H5）。
- spec:97：UserPromptSubmit 的时机或内容（J9）。
- spec:102：设置关闭时 Notification Hook 不触发（J3）。

### (b) 范围外的增加（都不大，列出供核对）
- PreToolUse 的 Hook ask 在等待期间与新判定再组合（`gate.ts:117-127`，票 03 设计说明已说明）。
- 不入库的 `Read(<isolation path>)` 询问规则（ADR 0016 的推论，规格没有写）。
- `GET /api/hooks?workspaceId=`、批准记录改为 `{digest, hookId}`（Lead 已接受）。
- 定义的 `thinking` frontmatter（没有核对 grilling C2 是否列出）。
- 标题栏"更多操作"菜单（Lead 已接受）。

### (c) 实现但有误
H1、H2、H3、H5、H6、J6、J7。

---

## 四、核对过、未发现问题的部分
- Hook 与判定的组合：
  - `combine.ts` 的组合表与 spec:106-115 逐行一致。
  - 提权与固定档位在组合之前单独询问，Hook 的 allow 越不过它们。
  - plan-exit 为 forced。
  - 项目 Hook 的 allow 在 PreToolUse 与 PermissionRequest 中都被忽略。
  - PermissionRequest 只在 step `default` 时运行。
  - 项目文件中的 `hooks.enabled` 被忽略。
  - Hook 的 stdin 经 `redactSecretsDeep`，环境经 `HOST_ENV_EXCLUSIONS` 过滤。
  - 登记的命令经 `redactText`。
- 子代理的有效模式：`effectiveSubagentMode` 每次判定时计算，plan 按 read-only；规则取根；"本会话总是允许"写入根；根切换模式时重新判定同根的待审批请求；子 Session 拒绝 setMode 与改规则；子 Session 没有 Job 入口；固定排除集。
- 定时任务：
  - `recordFire` 之后才开始 Run，做到至多一次。
  - 挂起状态只在内存中，同一任务只挂起一次。
  - 补跑只投递最近一次。
  - `schedulesAllowed` 只看 run_start。
  - title 与 prompt 入库前脱敏。
- Worktree：符号链接与真实路径检查、不加 `--force`、移除时检查 busy / dirty、`removeIfUnchanged` 同时要求 HEAD = base 且干净、启动恢复标 removed。
- Handoff：摘要模式经 beforeRequest；摘要 Run 自身不等待；目标只复制 permission_mode 与 permission_rule；`handoffTitle` 脱敏。
- notify 的转发（票 09 的修复）已在 `sidecar-process.ts:211`。

## 五、未覆盖
- 没有运行任何测试；结论都来自读代码与测试源码。
- 没有读或只扫了一眼：
  - `packages/session`（迁移 v8、repositories、contract）
  - `extensions/hooks/{config,matcher,output}.ts`
  - `tasks/schedules/{cron,rules}.ts`
  - `runtime/layers.ts`
  - `adapters/{git,faux,clock}.ts`
  - renderer 的 hooks-section、schedules-tab、sidebar/worktrees、handoff-dialog、approval-panel、agent-card、tool-cards
  - i18n
  - docs 与 ADR 正文
  - 全部 E2E
  - 除 subagents、restart、schedules 片段之外的集成用例
  - 票 01 的 B1–B15 细项
