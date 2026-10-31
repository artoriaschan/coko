# M5 评审：Standards 轴

范围：`git diff 873803e...HEAD -- . ':!pnpm-lock.yaml' ':!.scratch'`（298 文件，+25 256 / −702）。只读评审，没有运行测试。
依据：AGENTS.md、docs/tech-stack/{architecture,agent-runtime,testing,ui,observability}.md、ADR 0011/0013–0016、docs/subsystems/{handoff,worktrees,schedules}.md。
严重度：**hard** = 违反成文规则或 ADR；**judgement** = 判断（Fowler 坏味道或无成文规则的风险）。票 Comments 中已接受的偏离不重复报告，除非实现本身有误。

---

## 一、Lead 指定事项（"M5 评审"）

### L1 交接后源会话的 Goal 照常推进 —— judgement（建议改）
- 位置：`apps/server/src/application/goals.ts:441-455`（`runEnded` 对 trigger `handoff` 的 completed 照常 `advance`）；`apps/server/src/application/handoff.ts:156-188`（`#finish` 不触碰 Goal）；`docs/subsystems/handoff.md:56,82` 记为已知限制。
- 依据：agent-runtime.md:129"Goal 判断是否应该继续"；ADR 0015:30 与 ADR 0011 的理由都是"不要在没人看的地方无人值守地花预算"。
- 问题：交接之后用户在目标会话工作，源会话立即开始下一轮 Goal Round，工作与目标会话重叠（同一 checkout 时写同一批文件）。
- 修复：`GoalService` 增加 `handedOff(sessionId)`，`HandoffService.#finish` 提交 `handoff` 条目后调用，把 running / waiting-* 的 Goal 以 `pause { code: 'handed-off' }` 暂停；`goals.ts` 的 `runEnded` 对 `trigger === 'handoff'` 不 `advance`（否则下一轮先于暂停开始）。同步 handoff.md 与 goal.md 的原因码表。可逆：用户随时恢复。

### L2 plan / read-only 下 `isolation` 先询问再失败 —— judgement（同意 Lead："应直接拒绝"）
- 位置：`packages/agent/src/policy/decide.ts:237`（非 full-access 时 `modeAllows` 为 false → 落到第 7 步询问）；`apps/server/src/application/subagents.ts:356-358`（批准之后才抛错）。
- 问题：用户被要求批准一个必然失败的调用；PermissionRequest Hook 的 allow 也会"放行"它。另外 `suggest`（decide.ts:267）为 isolation 询问建议 `Agent(general)`，规则不区分 isolation，保存后今后所有带 isolation 的 general 派发在 default / accept-edits 下都免审批；这可能符合用户意图，但对话框应说明。
- 修复：在 `gate.ts:344-349`（`fixedSandbox` 拒绝的同一位置）加 `if (isolation && (mode === 'plan' || mode === 'read-only')) return { block: true, reason: isolationRefusedText(mode) }`，subagents.ts 中的检查保留作防线；更新 `sidecar-subagents-isolation.test.ts:62` 的期望。

### L3 agent 工具 effect `read` 与重启重派 —— **hard**
- 前台：`prepareRecovery`（subagents.ts:732-764）在 Session 恢复之前给已提交 `agent_start` 的调用补 interrupted 结果，不会重派，`sidecar-subagents-restart.test.ts` 覆盖。这部分成立。
- 缺口 a：`subagents.ts:746` 的 `!payload.background` 跳过后台调用。崩溃发生在 `startRun` 之后、父级 toolResult 提交之前时，`recovery/plan.ts:113` 对 effect `read` 给出 `interruptedRead`："It has no side effects, so you can retry it"。模型会再派一个子代理，而第一个可能已经写过文件。
- 缺口 b：崩溃发生在 `createForSubagent` / `createSession` 之后、`agent_start` 提交之前（subagents.ts:369-430）时，同样得到 `interruptedRead`；孤儿子 Session 与 worktree 没人处理：`recover()`（:769）只遍历 `agent_start`。
- 依据：agent-runtime.md:17、:115（已产生外部副作用的调用不能仅靠消息回放自动重跑）；ADR 0014:24。
- 修复：(1) 删掉 :746 的 background 条件，后台调用同样补 `agentInterruptedText`；(2) 让工具声明自己的中断文本（例如 `CokoTool.interruptedText?(args)`），`planRecovery` 对 agent 使用"子代理可能已经开始；先查看子会话再决定是否重派"，不沿用 read 的"可以重试"；(3) 启动恢复扫描 `parent_session_id` 非空但父级没有对应 `agent_start` 的子 Session，以及 `created_by = 'subagent'` 却没有 `agent_start` 的 worktree（对后者调用 `removeIfUnchanged`）；(4) 补用例：后台派发后立即 SIGKILL。

### L4 定时任务的 user message 在时间线中显示原文 `<scheduled_task>` —— judgement
- 位置：`apps/desktop/src/renderer/features/conversation/timeline.ts:274` 只过滤 `JOB_NOTIFICATION_TAG` 与 `<hook-context>`。同一缺口也让后台子代理通知 `<agent-notification …>`（subagents.ts:533、:599）在 Goal Round 或下一次提交中显示为用户气泡。
- 依据：ui.md:45（展示从协议事件派生；宿主包装不是用户的输入）。
- 修复：在 `@coko/agent/entries` 建一张宿主输入标签表（见 S1），timeline 按表处理：去掉 `<agent-notification>` 块（交给 `agent_notification` 行）；`trigger: schedule` 的输入挂在 `schedule_fire` 行下作为可展开的 prompt 原文，不显示包装标签。

### L5 校验之后的 git 冲突使交接界面停在"正在创建新会话" —— **hard**
- 位置：`apps/server/src/application/handoff.ts:148-149` 只记 warn；`apps/desktop/src/renderer/stores/handoff-store.ts:94-103` 只有 `handoff` 条目能让状态离开 `creating`。
- 依据：ui.md:34"操作成功或失败使用应用级 Toast……不提前报告结果"。这里失败从未被报告。
- 修复：`#finish` 失败时让客户端看得到失败：提交可回放的失败记录（`handoff` payload 加 `status: 'failed', reason`，或新 kind `handoff_failed`），至少发一条 progress `handoff_failed`；store 从 `creating` 转为 `failed` 并弹 Toast。更好的做法是把 `new-worktree` 的创建前移到摘要请求之前，与校验一起完成；代价是停止或失败时要回收这个 worktree。

### L6 创建绑定已移除 worktree 的会话 —— judgement
- 位置：`apps/server/src/application/sessions.ts:232-254` 不检查 worktree 状态；`handoff.ts:163-172` 的 `worktree` 目标在 start 时校验过，到 `#finish` 时可能已被移除。
- 依据：ADR 0016:23"移除后绑定的会话只读"；新建一个一开始就只读的会话没有意义。
- 修复：在会话创建的唯一入口（见 H6）要求 `worktree.status === 'active'`，否则 409 `worktree-removed`；`#finish` 复用它。

### L7 上下文用量、恢复探测与项目规则按 Workspace 取作用域 —— 影响比 worktrees.md:84-86 写的大
- **hard** `apps/server/src/application/checkpoints.ts:104-108`：回退以 `workspace.path` 作为 `restoreFiles` 的边界，`packages/agent/src/checkpoints/rewind.ts:214` 跳过边界之外的路径。Workspace 为仓库子目录时，worktree（`<repoRoot>/.coko-worktrees/…`）在边界之外，worktree 会话的"回退代码"静默地不恢复任何文件。违反 ADR 0016:27（Checkpoint 路径与会话目录一致）与 ADR 0006；没有记入已知限制。
- **hard** `apps/server/src/application/recovery.ts:140-144`：探测的 `cwd` 为 `workspace.path`，worktree 会话中的 edit / write 会对照主 checkout 的同名文件判定"已应用 / 未应用"，判错即跳过结果确认（agent-runtime.md:115）。
- judgement `apps/server/src/application/context/mcp.ts:83,194`：MCP 连接池以 `workspaceId + name` 为键，不含 cwd。worktree 会话与主会话共用同名 stdio server，其工作目录取决于谁先连接；`reconcile`（:174）还会按另一个 checkout 的项目文件关闭或重启对方的 server。
- 已记录的：`context-service.ts:46-70`（上下文用量）、`permissions.ts:199-200`（项目 deny / ask 规则）。只影响显示：`subagents.ts:294`（定义列表）、`mcp-admin.ts`。
- 修复：上述位置统一经 `SessionRuns.cwd(session)` 取目录；MCP 池键加入 cwd；更新 worktrees.md 的已知限制与验证列表（补用例：Workspace 为仓库子目录的 worktree 会话中回退）。

### L8 浅色主题切换后 Stop 按钮一度显示为灰色 —— judgement，未复现
- 位置：`composer.tsx:239`（default variant，`disabled` 只随 composer 的 `disabled`）；`packages/ui/src/components/button.tsx:9` 的 `transition-colors`；`packages/ui/src/styles/theme.css:253` 默认 0.2 s；主题切换时没有抑制过渡，`bg-primary` 在两套 token 之间插值，中途呈灰色。判断为过渡观感，不是状态错误。
- 修复：先在浏览器测试中切换主题后轮询 `getComputedStyle(stop).backgroundColor` 是否等于 `--primary`，确认最终状态。若要消除观感，在共享主题切换处临时加 `[data-theme-switching] * { transition: none }`，不在组件里散落主题判断（ui.md:24）。

### L9 跨控制通道的验收只查一侧（票 05 的 notify）—— judgement（已修复，缺守卫）
- 根因：`apps/desktop/src/main/sidecar-process.ts:187-214` 的 `switch` 没有 `default` 穷尽检查，新加的 `SidecarToMainMessage` 成员被静默丢弃，tsc 不报错。
- 同类缺口：`packages/protocol/src/ws.ts:110-113` 的 `isDetachedProgress` 手工列出 job / agent / schedule；以后新增不属于 Run 的进度而漏加时，客户端误入运行中（chat-store.ts:736）。MainToSidecar 在 M5 没有新增成员。
- 修复：`default: { const unhandled: never = message; void unhandled }`；protocol 侧为每个 `ProgressEvent` 成员登记"是否属于 Run"（`Record<ProgressEvent['type'], boolean>`），由类型保证穷尽。验收清单写明"跨控制通道的能力要有真实 Electron 用例"（testing.md:27）。

---

## 二、高风险发现

### H1 后台子代理通知授予 user 权限 —— **hard**
- 位置：`packages/agent/src/goals/state.ts:393` 只把前一条为 `job_notification` 的 user message 视为宿主通知。后台子代理结束通知在 Goal Round、continue 或 retry 中作为追加指令送达时，前置条目是 `agent_notification`（subagents.ts:599-603），`runAuthority` 返回 `user`；随后 `planGoalCreate` / `planGoalUpdate`（goals/tools.ts:145、171、185、189）放行 create_goal、edit（含预算）、pause、resume。
- 依据：agent-runtime.md:111"指令和扩展文件……其声明不能提升宿主授予的权限"。子代理输出受工具结果与仓库文件影响，不等于用户的话。
- 同源：`apps/server/src/application/goal-driver.ts:39` 的 `hasUserSteering` 只排除 `JOB_NOTIFICATION_TAG`，Run 结束退回的 `<agent-notification` 被当作用户追加指令，Goal 不推进而停住（通知由 subagents.ts:519-523 重新挂起，不丢）。`AGENT_NOTIFICATION_TAG`（agents/tools.ts:60）定义了却没有调用方。
- 修复：entries/ 中定义唯一的宿主通知集合（kind `job_notification`、`agent_notification` 与对应标签），`runAuthority` 与 `hasUserSteering` 都用它；补用例：Goal Round 中送达子代理通知后 `update_goal edit` 为 not-authorized。

### H2 定时任务的预算准入不计子代理用量 —— **hard**
- 位置：`apps/server/src/application/schedules.ts:244-246` 用 `goalUsage(entries, goal.id)` 自己重算，不含子 Session；`GoalService.#usage`（goals.ts）计入子 Session。
- 依据：ADR 0014:23（子 Session 用量计入根 Goal）；ADR 0015:23（到期时检查 Goal 是否已有预算维度耗尽）。子代理用尽预算后定时任务仍会投递。
- 修复：`ScheduleService` 不再重算，调用 GoalService 提供的 `exhaustedDimension(sessionId)`（同时消除 Feature Envy）；补集成用例：子代理用尽 maxTokens 后定时任务 skipped `budget`。

### H3 派发失败时 isolation worktree 与 `#live` 泄漏 —— **hard**
- 位置：`apps/server/src/application/subagents.ts:366-433` 只有 `try/finally` 清 `#reserving`。worktree 创建之后，`createSession`、`subagent_origin` 或 `agent_start` 的提交失败时：worktree 与 `#isolated` 的询问规则留下；失败在 `#live.set`（:400）之后时 `live.status` 永远为 running，持续占用并行上限（:362），worktree 一直判为 busy。
- 依据：ADR 0016:23（子代理结束时没有改动的 worktree 自动移除）；agent-runtime.md:113（资源释放）。
- 修复：加 `catch`：`#live.delete`、`#isolate(..., false)`、`removeIfUnchanged(worktree.id)`，再抛出。

### H4 worktree 移除的检查与执行之间可以开始 Run —— judgement
- 位置：`apps/server/src/application/worktrees.ts:269-285`。`#repoLock` 只串行创建与移除，`startRun` 不经过它；`#busy` 之后、`git worktree remove` 之前开始的 Run 落在即将删除的目录中。
- 依据：ADR 0016:23（移除时须没有进行中的 Run）。
- 修复：移除期间登记 `removing` 集合，`cwd.resolve` 对其中的 worktree 抛 `worktree-busy`；或锁内先 `markRemoved` 再执行 git，失败时回滚。

### H5 项目 Hook 的 PermissionRequest allow 记为 `allowed` —— judgement
- 位置：`apps/server/src/application/hooks.ts:346-347`：message 为"Ignored: a project hook cannot allow a call"，outcome 却被改成 `allowed`，时间线与审计显示一次没有生效的放行。
- 修复：第 347 行加 `hook.source !== 'project'` 条件，项目来源的 allow 保留不表示放行的 outcome。

### H6 会话创建有三条路径（Shotgun Surgery）—— judgement
- 位置：`sessions.ts:232`（提交初始 `permission_mode`）、`subagents.ts:371`、`handoff.ts:166`（后两者直接调用 `store.sessions.createSession`）。L6 的 worktree 状态检查与今后的初始条目要在三处各加一遍。
- 修复：`SessionService` 提供唯一入口（如 `createSession({ kind: 'root' | 'child' | 'handoff', … })`），子代理与交接经它创建。

### H7 新路由直接访问存储 —— **hard**
- 位置：`apps/server/src/http/routes/agents.ts:8-12`（`store.sessions.getSession`）、`worktrees.ts:17-19`、`hooks.ts:14-23`（`requireSession(app.store)`、`getWorkspace`）。M5 之前的路由都不直接访问 store。
- 依据：architecture.md:88"HTTP 路由只校验与调用 application 的服务……不直接访问存储或上下文贡献"。
- 修复：分别移入 `SubagentService.list`（内部 requireSession）、`WorktreeService.gitStatusOf(sessionId)`、`HookService.projectFor(sessionId | workspaceId)`。

### H8 SubagentStart / SubagentStop 的 Hook 文本脱敏口径不同 —— judgement
- 位置：`subagents.ts:476`、`:498` 用 `redactSecretValues`（只替换登记值）；HookService 同类路径（hooks.ts:431、:463、:496）用 `redactText`（另替换凭据形态）。上限 `SUBAGENT_CONTEXT_MAX`（:174）与 `HOOK_CONTEXT_MAX_CHARS`（hooks.ts:54）是同一个 10 000 的两份。
- 依据：observability.md:28（脱敏覆盖自由文本）。这两处 Hook 输出进入模型上下文，凭据形态的文本不被替换。
- 修复：把 Start / Stop 的解释移进 HookService（`subagentStart`、`subagentStop`，与 `userPromptSubmit` / `stop` 同构），SubagentService 只调用（同时消除 Feature Envy）。

---

## 三、坏味道（baseline）

- **S1 Duplicated Code / Shotgun Surgery：宿主生成文本的标签散在多处。** `JOB_NOTIFICATION_TAG`（entries/job-notification.ts:5）、`AGENT_NOTIFICATION_TAG`（agents/tools.ts:60，未使用）、`SUBMIT_CONTEXT_TAG`（session-runs.ts:63）与 renderer 手抄的 `HOOK_CONTEXT_TAG`（timeline.ts:23）、subagents.ts:444 再手写一次 `<hook-context>`、`SCHEDULED_TASK_TAG`（tasks/schedules/tools.ts:69）。H1、L4 都源于此。修复：`entries/host-input.ts` 一张表加 `hostInputKind(text)`，server、agent、renderer 共用（renderer 经 `@coko/agent/entries`，符合 architecture.md:84）。
- **S2 Duplicated Code：权限模式宽窄序三份。** `permissions.ts:29-30`（`capMode`）、`agents/definitions.ts:35,290`（`effectiveSubagentMode`）、`session-permissions.ts:63`（`MODE_RANK`）；`session-permissions.ts:179-183` 两个分支只在 plan 处理上不同。另外 `permissions.ts:27` 的注释"不重复地追加规则"现在悬在 `MODE_ORDER` 上方。修复：只保留 agent 的 `PERMISSION_MODE_ORDER` 与一个 `narrowerMode`，注释移回 `withRules`。
- **S3 Duplicated Code：子代理固定排除集判断两份。** `definitions.ts:57`（`excluded`）与 `context/subagents.ts:13`（`fixedExcluded`），导出一个即可。
- **S4 Duplicated Code：worktree 名错误文案逐字相同。** `handoff.ts:108-111` 与 `worktrees.ts:169-172`；导出 `invalidWorktreeNameError()`。
- **S5 Primitive Obsession / Data Clumps：条目 payload 裸断言。** `subagents.ts:566,682,686,688,739,741,743,771,773,775` 与 `goals.ts` 的 `childSessionIds` 都写 `(e.payload as { agentId: string … })`；`session-entries/agents.ts` 已有 schema，应提供类型化读取（如 `agentStarts(entries)`）。`SubagentSessionHost.mode` 返回 `string`（subagents.ts:58），应为 `PermissionMode`。
- **S6 重复全表扫描：** `schedules.ts:170,275,287,331,478,521` 都是 `schedules.list().find((s) => s.id === id)`，在投递路径上。`ScheduleRepository` 补 `get(id)`。
- **S7 Divergent Change：** `SubagentService`（800 行）同时承担派发、通知投递、权限作用域、Hook、恢复与 worktree，字段声明散在 :201、:233、:461。建议拆出 `SubagentNotifications`（`#pending` / `#sent` / `#notify`）与 `SubagentRecovery`。
- **S8 UI 中用 effect 镜像状态（ui.md:45）。** `schedules-tab.tsx:429`、`sidebar/worktrees.tsx:253` 用 `useEffect(() => setSubmitting(false), [x?.id])` 重置；改为父组件给对话框 `key={x?.id}`。`agents-button.tsx:73-81` 与 `schedules-button.tsx:59-69` 是同一个"条目计数变化即 load"的结构，可提成一个 hook。
- **S9 订阅不释放：** `approval-panel.tsx:40-46` 的 `useChildApproval` 订阅子 Session 后从不退订，ids 以换行拼接作为 effect 依赖。修复：`subscribeSession` 返回 release，chat-store 对子 Session 订阅引用计数。
- **S10 Mysterious Name：** `compaction-driver.ts:208` 的 PreCompact 阻止以 `hook_stopped` 结束，与 `continue: false` 同码，而 `goals.ts` 的 `endChange` 对 paused + `hook_stopped` 暂停 Goal。目前一个是 error、一个是 paused，不冲突，但含义重叠；建议改为 `hook_blocked`。
- **S11 注释过时：** `recovery.ts:37-38`"两者由各自的服务实现（当前为空实现）"，实际都已实现。

---

## 四、测试隔离与预算（testing.md:31-41）

- **T1 hard `apps/server/src/adapters/hook-runner.test.ts`：** 启动真实进程却没有显式预算；`:68` 实测至少 2.45 s、断言上限 3.5 s，server 项目沿用默认 5 s testTimeout（apps/server/vitest.config.ts 未设）。`mkdtemp` 的目录（:19、:41）从不删除。依据："尊重平台与执行预算""清理到真正结束"。修复：describe 级 `{ timeout: 15_000 }`，每个目录登记 `onTestFinished(() => rm(...))`。
- **T2 hard 固定 sleep 之后断言"没有发生"：** `stores/handoff-store.test.ts:70`、`:83`，`application/handoff.test.ts:216`。依据："固定 sleep 不能代表准备或清理完成"。修复：之后再推一个已知会被处理的标记条目，`vi.waitFor` 它被处理后再断言没有切换；handoff.test.ts 用 deferred 控制 `listEntries`，确认 `beforeRequest` 已进入等待（barrier）后再断言 pending。
- **T3 judgement 墙钟上限断言：** `tests/integration/sidecar-hooks.test.ts:284`（两个 1 s 的 Hook 并行要求 < 1.8 s）、`:318`、`hook-runner.test.ts:82`。全量负载下易抖动，M5 已因负载出现 9 例超时（票 07）。修复：用 barrier 证明并行（每个 Hook 先写自己的 start 文件，再等对方的 start 文件出现才退出：串行时超时，并行时立即通过）。
- **T4 judgement 重复的手写轮询：** `sidecar-hooks.test.ts:248`（`poll`）、`secrets-gate-notifications.test.ts:50`、`sidecar-schedules.test.ts:474`、`sidecar-m5-seams.test.ts:244`、`sidecar-handoff.test.ts:62`。都在等可观察状态（符合规则），但应收进 `sidecar-harness.ts` 作共享 helper（testing.md:29）或改用 `vi.waitFor`。
- **T5 judgement 模块级全局状态：** `apps/desktop/src/main/notifications.ts` 的 `live` Set 被所有用例共享，`notifications.test.ts:58-77` 靠前后差值规避。依据："优先依赖注入"。修复：改为 `createNotifier()` 实例字段。
- 已核对：新增 E2E 与集成测试都给了 describe 或用例级预算；临时目录用 `mkdtemp`；git 夹具隔离 `GIT_CONFIG_GLOBAL` 与 HOME；新测试中没有写 localStorage、改 `process.env` 或用 fake timers 而不恢复。Browser Mode 的 20 s 预算已在票中说明理由并被接受，不再报告。

---

## 五、已核对、没有发现问题

- Hook 与判定的组合：Hook 的 deny 优先；第 2–4 步（询问规则、受保护路径、越出可写根）与 plan-exit 的询问不能被 allow 免掉（combine.ts:41-73）；提权与 fixedSandbox 在组合之前单独询问（gate.ts:344-361）；项目 Hook 的 allow 不参与聚合（combine.ts:24、:29）；Hook 不能改写参数；`hooks.enabled` 只在全局（merge.ts、schema.ts 的 `GLOBAL_ONLY_SECTIONS`）。没有找到能让 allow、项目文件或模型 / 命令输出越过拒绝或询问规则的路径（H1 是 Goal 授权问题，不是权限判定问题）。
- 子 Session 的有效模式每次判定时取根当前模式与定义中较窄者（session-permissions.ts:179-183）；"本会话总是允许"写入根 Session；子 Session 拒绝直接切换模式与改规则；审批回答发往子 Session（approval-panel.tsx）。
- 用量与预算：子 Run 经 `#governing` 检查根 Goal（goals.ts）；`handoff.usage` 计入 Goal（budget.ts）；摘要请求前经过请求前检查。
- 至多一次：`recordFire` 在单一事务中先改任务行、再追加条目（repositories.ts:643-659）；挂起合并；定时 Run 不能创建或修改任务、不展开 `/goal`；测试时钟只在未打包时启用（layers.ts:296）。
- 秘密：Hook stdin 经 `redactSecretsDeep`（hooks.ts:262），环境经 `filterEnv(HOST_ENV_EXCLUSIONS)`；`hook_run` 的 command 与 message 经 `redactText`；子代理 prompt 与 description 派发时脱敏（subagents.ts:328）；定时任务 title 与 prompt 入库前脱敏（schedules.ts:367）；通知经 `redactSecretsDeep`（notifications.ts）；交接标题经 `redactText`，摘要经 `entries.commit`。例外见 H8。
- worktree 路径：拒绝符号链接与越出仓库的真实路径（worktrees.ts:206-221）；名字排除 `..` 与 `.lock`；git 以 argv 执行；移除前检查 dirty，不加 `--force`。

---

## 六、没有读或只抽样的部分

- UI 正文：`schedules-tab.tsx`（只看 :415-440）、`hooks-section.tsx`、`sidebar/worktrees.tsx`、`handoff-dialog.tsx`、`agents-tab.tsx`、`agent-card.tsx`、`goal-card.tsx` 的改动、各设置分区、`header-actions` 窄屏修复、i18n 字典；没有在浏览器中检查任何视觉状态。
- agent 包：`tasks/schedules/cron.ts`、`rules.ts`（cron 与夏令时）、`agents/definitions.ts`（只看排除集与有效模式）、`extensions/hooks/{config,output,matcher}.ts`、`session-entries/*` 的 schema。
- server：`runtime/layers.ts`（只 grep 时钟与测试钩子）、`adapters/{git,clock,faux,pty,processes}.ts`、`context/{hooks,schedules,handoff,index}.ts`、`session-models.ts`。
- session 包：`sqlite/repositories.ts`（只看 `recordFire` 与 `createSession` 校验）、`memory/index.ts`、`repository-contract.ts`、v8 迁移测试。
- 测试正文：多数集成测试与 E2E 只 grep 了预算、清理与 sleep，没有逐条核对断言。
- 文档：除 handoff.md 与 ADR 0013–0016 外的 subsystem 页、包 README 与 GLOSSARY 没有核对。
