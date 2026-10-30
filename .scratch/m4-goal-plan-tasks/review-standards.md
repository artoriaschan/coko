# M4 评审：Standards 轴

范围：`git diff 6bda8e3...HEAD`（排除 pnpm-lock.yaml、.scratch），243 个文件，+19416 / −1588。只读评审，除本文件外未改动仓库。
依据：AGENTS.md、docs/TECH_STACK.md、docs/tech-stack/{architecture,agent-runtime,testing,ui,ui-design-system,observability}.md、ADR 0005 / 0011 / 0012、docs/subsystems/{goal,jobs,execution,plan-mode,permissions}.md、GLOSSARY.md。已在票 Comments 中被 lead 接受的偏离不再重复，除非实现本身有误。
oxlint / oxfmt / tsc / check:docs / 样式守卫 / browser-deps / source-references 能发现的问题不列。

严重度：**hard** = 违反文档写明的规则或契约；**judgement** = 判断题或坏味道。

---

## A. 违反文档标准的问题（按风险排序）

### A1. [hard] PTY Job 的沙箱档位在 spawn 时固定，job_input 可以绕过 plan 模式与单次提权
- 位置：`packages/agent/src/tools/builtin/bash.ts:110-114`（spawn 时 `sandbox` 只取一次）；`apps/server/src/application/jobs.ts:369-379`；`packages/agent/src/tasks/jobs/tools.ts:160-183`（job_input 只按 text 判定，不看 Job 的沙箱档位）；`apps/server/src/application/context/jobs.ts:11,27`。
- 规则：
  - plan-mode.md「判定」：“命令沙箱为 read-only，可写根为空，已批准的命令也不能写 Workspace”。
  - ADR 0005 与 permissions.md:118：提权“只对这一次调用有效，Run 结束时未用掉的授权作废”。
- 问题：PTY shell 在 default、full-access 下，或经一次提权以 danger-full-access 启动之后，会话可以切到 plan 或 default。之后 job_input 的 text 只按 Bash 规则判定：plan 下询问，default 下 `Bash(npm *)` 之类的允许规则会直接放行。被批准的文本在原先更宽的沙箱里执行，plan 的“已批准也不能写 Workspace”不成立。一次提权变成了在整个 Job 寿命内、跨 Run 有效的持久越界，这正是 ADR 0005 拒绝过的方案。sidecar-pty.test.ts 只测了“read-only 档位启动的 PTY 不能写”，没有测“宽档位启动、之后收紧”。
- 修复：`BackgroundJob.info` 记录 spawn 时的 `SandboxMode`。job_input 的 gate 在当前模式的档位严格窄于该档位时，在 plan / read-only 下拒绝，其他模式要求一次 kind escalation 审批。提权启动的 PTY Job 每次 job_input 都按提权处理，或者干脆禁止 `tty` 与 `sandbox_permissions` 同时使用。在 sidecar-pty 中补用例：full-access 下启动 → 切到 plan → job_input `touch x` 不执行，或要求提权。

### A2. [hard] 工具调用预算可以被工具输出文本绕过（按结果文本前缀识别“被拦下”）
- 位置：`packages/agent/src/goals/budget.ts:70,81-85`（`isBudgetBlocked`：`isError` 且首个文本块以 `Goal budget exhausted: tool calls` 开头）。
- 规则：agent-runtime.md「Goal 机制」要求有工具调用限额并在调用前检查；goal.md「预算」表写的是“工具调用上限拦下的不计”，而不是“文本像拦下的不计”。
- 问题：bash 失败时结果文本以命令输出开头（`bash.ts:207-222`，状态行追加在后面）。命令 `echo 'Goal budget exhausted: tool calls'; exit 1` 产生的错误结果被当作“未执行”，不计入用量。模型在无人值守的 Goal Round 中可以无限调用工具，`maxToolCalls` 失效。`budgetDimension` 也用 message 文本的正则反推维度（`apps/server/src/application/goals.ts:516-520`），属于同一类问题。
- 修复：用结构判定，不用文本。可以在拦下时提交一条带 toolCallId 的标记（例如 `tool_exec` 缺失加 `details.budgetBlocked`），budget.ts 只认这条标记。`RunError` 加 `dimension` 字段，`runEnded` 直接读它，不再解析 message。补用例：bash 输出该前缀并以非零退出时仍计 1 次调用。

### A3. [hard] 取消进行中时可以 resume，取消之后仍有 Goal Round 在跑
- 位置：`apps/server/src/application/goals.ts:214-246`（`act` 不检查 `#cancelling`）、`:258-296`（`#cancel` 在两次加锁之间不持锁，等待 Run 与 Job）、`goal-driver.ts:56-92`（`advance` 不检查取消标记）。
- 规则：agent-runtime.md「Goal 机制」要求“推进请求经过单写者和操作去重控制”；goal.md「取消」写明取消期间“Run 结束、Job 结束与模型的 Goal 工具都不再改变 Goal”，用户的 resume 没被列入。
- 问题：Goal 为 paused / blocked 且有 Job 在运行时，`#cancel` 在 `killSession` 的宽限期（最长 5 秒）内释放了锁。此时 HTTP `resume`（或 `/goal resume`）提交 running，并经 `advance` 开始一轮。随后 `#cancel` 提交 cancelled，但新开始的 Run 不会被停止；Goal 已经终结，`beforeRequest` 与工具 hook 的预算检查对它都不再生效（`goals.ts:141,163` 只查 running）。结果是一个不受预算约束的无人值守 Run。界面在 pending 期间禁用按钮，所以只有直接调接口或两个窗口时能触发，但这是服务端的不变量。
- 修复：`act` 在 `#cancelling.has(sessionId)` 时返回 409 `invalid-transition`（"The goal is being cancelled"）；`GoalDriver.advance` 增加 `isCancelling` 宿主能力并据此放弃。用 deferred promise 卡住 `killSession`，补一个确定交叠位置的集成用例（testing.md：“竞态测试用 barrier 或 deferred promise 确定交叠位置”）。

### A4. [hard] 自动压缩发生在模型请求前的预算检查之前，也不受预算限制
- 位置：`packages/agent/src/engine/runtime.ts:155-157`（先 `driver.autoCompact`，再 `context.beforeRequest`）；`compaction-driver.ts:202` 的 `recoverOverflow` 同样不经过预算检查。
- 规则：agent-runtime.md「Goal 机制」：“在调用前检查可用预算”；goal.md 把 `compaction.usage` 计入 tokens / cost。
- 问题：Token 或费用已经耗尽时，下一次请求前仍会先发一次摘要请求（这本身就是一次模型调用，而且计费），然后才被 `beforeRequest` 拦下。超额与上下文窗口成正比，并非可以忽略的量。goal.md 把这一点写成“自动压缩之后”，但这是文档在描述现状，并没有说明为什么可以接受。
- 修复：压缩前先做一次预算检查（只查 tokens / cost / time）；或者给 `CompactionDriver` 注入同一个 `admit()`，压缩与溢出恢复都先过它。补 budget 集成用例：`maxTokens` 刚好耗尽且达到自动压缩阈值时，不产生 compaction 条目。

### A5. [hard] Goal Round 因非瞬态错误没能开始时，Goal 一直停在 running
- 位置：`apps/server/src/application/goal-driver.ts:84-91`。
- 规则：ADR 0011「理由与备选方案」否定了“用户看到‘运行中’却不在推进”；agent-runtime.md：“错误、取消、等待输入和预算耗尽均作为停止或等待条件处理”。
- 问题：`model-not-configured`、`model-required`、`confirmation-pending` 都只记一条 info，Goal 保持 running。Session 空闲时，下一次推进只会在下一个 Run 结束或 Job 结束时触发。如果用户不再提交，Goal 卡会一直显示“进行中”，实际却没有推进。只有 `run-in-progress` 与 `session-busy` 才是“稍后会自然再判定”的情况。
- 修复：对 `model-not-configured` / `model-required` 提交 blocked（`reason.code` 为错误码），对 `confirmation-pending` 提交 waiting-input；只有 `run-in-progress` 与 `session-busy` 维持现状。补集成用例：删除 Provider 后 resume 得到 blocked。

### A6. [hard] Checkpoint 备份 hook 排在预算 hook 之前（评审项：是否调换）
- 位置：`apps/server/src/application/session-runs.ts:443`（`[...extension.hooks, runContext.hooks.hooks, secretRedactionHook]`）；`packages/agent/src/checkpoints/tracker.ts:119-148`。
- 规则：agent-runtime.md「工具扩展与覆盖」的统一接入链；runtime.ts:118 的注释与 permissions.md 都写明“被拒绝的调用不经过其后的 hook（例如 checkpoint 备份）”。预算拦截与权限拒绝一样是“不执行”的决定，同样应该排在副作用之前。
- 结论：**建议调换**。现在的顺序除了留下一份没有引用的 `file_backup`，还有两处副作用：一次 `saveFile` 与 blob 写入（每次被拦的写入都有）；`tracker.ts:146` 在 `changes` 中登记了 toolCallId，而被拦下的调用不会走 afterToolCall，该项不会被删除（只是 Map 泄漏，但说明链路依赖顺序）。
- 修复：在 `ContextContribution` 增加 `admissionHooks`（或给 hook 一个 `phase: 'admission'`），排在 `extension.hooks` 之前、权限 gate 之后；goal 的工具 hook 放进去，检查点备份放在后面。删去 goal.md「已知限制」中关于备份的一句，并补一个“被拦下的 write 不产生 file_backup 条目”的断言。

### A7. [hard] 控制通道静默丢弃不合 schema 的消息（评审项），并且票 10 的理由不成立
- 位置：`apps/server/src/control/channel.ts:34`（`onInvalid` 只记 warn）；`apps/desktop/src/main/encrypting-bridge.ts:49`（main 等 10 秒超时）；`packages/protocol/src/http.ts:162-170`（`ModelPrice` 不设 `minimum`，注释写“使负数价格得到错误回答而不是被控制通道丢弃”）。
- 规则：architecture.md「运行链路」：“server 校验 protocol schema”，并输出可序列化的结果；ui.md「反馈」：错误要简短、可行动；testing.md 要求跨进程协议验证非法输入。
- 问题一：两端处理不对称。main 收到不合 schema 的消息会终止 Sidecar（`sidecar-process.ts:181-184`），Sidecar 收到不合 schema 的消息只记 warn，带 requestId 的请求等 10 秒超时，用户看到的是“Sidecar did not confirm”而不是“输入不合法”。
- 问题二：票 10 的理由不成立。`apps/desktop/src/main/credentials.ts:29` 在发送前已经用同一个 `ProviderFields` schema（其中嵌套 `CatalogModel.price`）校验草稿。如果 `ModelPrice` 设了 `minimum: 0`，负数会在 main 以 `invalid-input` 立即返回，根本到不了控制通道。现在 schema 比实际规则宽，规则只写在 `registry.ts:109-112` 与 sidecar，协议这一边的约束反而丢了。
- 修复：(1) `ModelPrice` 四个字段加 `minimum: 0`，删掉 http.ts:163-164 的理由注释，保留 sidecar 的 400 作为第二道检查。(2) `channel.ts` 对带数字 `requestId` 且 `type` 为已知请求类型的非法消息，回一条 `*.result { ok: false, error: { code: 'bad-request' } }`；其余照旧记 warn。(3) main 的 `SidecarControlChannel.send` 在开发与测试构建中先做 `Value.Check(MainToSidecarMessage)`，把这类问题变成立即的编程错误。补 providers.test：非法的 `provider.save` 在 1 秒内得到失败回答。

### A8. [hard] 测试隔离：localStorage 泄漏只在受害方修复，污染源没有清理
- 位置：`apps/desktop/src/renderer/features/conversation/dock/goal-card.browser.test.tsx:104-107`（`beforeEach localStorage.clear()`）；污染源 `apps/desktop/src/renderer/app/app.browser.test.tsx:90-98` 的 afterEach 不清理草稿；同样渲染 `<App>` 并使用缺省 draft store 的 `dock.browser.test.tsx`、`todo-cards.browser.test.tsx` 没有保护。
- 规则：testing.md「测试隔离与确定性·恢复全局状态」：“立即登记清理……恢复原值，包括原先不存在的状态”；“只在单独运行时通过应视为测试缺陷”。
- 问题：修的是一个受害文件，没有修写入方。Browser Mode 的文件顺序或分片一变，dock / todo-cards 就会受影响。`clear()` 还会抹掉其他测试设置的键，本身也是一种污染。
- 修复：在 desktop 的 browser setup（`vitest.browser.config.ts` 的 `setupFiles`）中登记全局 `afterEach`：快照并恢复 `localStorage`；或者让 `<App>` 在测试中注入内存 draft store（composer.tsx:39 已有注入点）。app.browser.test.tsx 的 afterEach 同时清理它写入的 `coko.draft.*`。goal-card 的 `beforeEach clear()` 随后删除。

### A9. [hard] 测试用 `document.body.innerHTML = ''` 代替卸载
- 位置：`dock/goal-card.browser.test.tsx:109-111`、`dock/todo-cards.browser.test.tsx:58-60`。
- 规则：testing.md「清理到真正结束」：“解除监听并等待……迟到的回调不得污染其他测试”。
- 问题：直接清空 DOM 不会卸载 React 根。`GoalCard` 的 load effect、`ResizeObserver`（goal-card.tsx:150）、store 订阅与 Radix portal 的副作用都还活着，和下面 A10 的 aria-hidden 残留是同一类问题。
- 修复：依赖 vitest-browser-react 的自动 cleanup，或者在 afterEach 中 `await screen.unmount()`；删掉 innerHTML 赋值。

### A10. [hard] Radix 菜单使同文件后续 getByRole 失效（评审项）：原因已在代码中写明，拆文件掩盖了缺陷
- 位置：`apps/desktop/src/renderer/features/conversation/plan-approve-menu.browser.test.tsx:1,49-51`（注释写“关闭中卸载会留下 Radix 对其余节点的 aria-hidden”）；拆成 4 个 plan-*.browser.test.tsx。
- 规则：testing.md：“不要用整个套件串行化掩盖资源冲突”；“只在单独运行时通过应视为测试缺陷”。
- 判断：原因已知，并非“未定位”。modal 的 DropdownMenu 打开时经 `hideOthers` 给 body 的其他子节点设 `aria-hidden` / `data-aria-hidden`，并把 `body.style.pointerEvents` 设为 none。菜单在退出动画中被卸载时这些设置不会撤销，之后的 `getByRole` 看不到这些节点。拆文件只是让每个文件里只出现一次。产品代码中也可能存在同样的残留（例如菜单打开时切换会话）。
- 修复：在共享 browser setup 的 afterEach 中断言 body 的直接子节点没有 `[data-aria-hidden]` / `[aria-hidden="true"]`、`body.style.pointerEvents === ''`，失败即报出泄漏的用例。每个用例结束前 `await menuClosed()`。之后把 4 个文件合回一个以验证。plan-tab.tsx:53 的修订菜单与 mode-picker 也考虑像 plan-review-panel.tsx:242 一样用 `modal={false}`。

### A11. [hard] plan.e2e 的菜单重试（评审项）：可以改为不需要重试的写法
- 位置：`apps/desktop/e2e/plan.e2e.test.ts:41-55`。
- 规则：testing.md「失败先定位再修复」：“不得靠……重试……消除失败”；“等待可观察状态”。
- 判断：lead 接受的理由（点击落在上一次关闭过程中）恰好说明了缺的是哪个等待条件：只等 `aria-expanded !== 'true'` 不够。Radix 在退出动画结束之前，`[role=menu]` 仍挂着，body 的 `pointer-events: none` 也还在，这时的点击会被吞掉。
- 修复：点击前等待 `[role="menu"]` 为 detached，并且 `document.body.style.pointerEvents !== 'none'`；之后单次 `click` + `item.waitFor()`，删除循环与 Esc 重试。goal.e2e 在 aa242e5 中已经用同样的思路（等菜单 detached 再按 Enter）修了同类问题，两处保持一致。

### A12. [hard] 终端 ANSI 颜色在浅色主题下对比度不足（评审项）
- 位置：`apps/desktop/src/renderer/features/right-panel/jobs-tab.tsx:28-37`（绿 → `text-success`、黄 → `text-warning`，蓝 / 品红 / 青都映射到 `text-link`）。
- 规则：ui-design-system.md:32：“文字与背景的组合在明暗两套主题下都需可读……用于文字前在两套主题下分别核对对比度”；ui.md「验证实际渲染结果」：检查实际对比度。
- 判断：票 06 记录了绿 / 黄偏低但没有给出数值，属于已知的违规，不是可以接受的限制。三种颜色合成 link 色还会丢失信息（测试输出中蓝与品红常用于区分）。
- 修复：在 packages/ui 的主题样式表新增 `--terminal-{red,green,yellow,blue,magenta,cyan,muted}` 语义 token，明暗各一套，实测 ≥ 4.5:1（按共享 token 变更流程检查消费者）；jobs-tab 改为消费这些 token。jobs-tab.browser.test 增加两种主题下用 computed color 计算对比度的断言。256 色可以按 xterm 调色板映射到最近的 16 色，不必增加 token。

### A13. [hard] 用 effect 镜像父级派生值
- 位置：`apps/desktop/src/renderer/features/right-panel/plan-tab.tsx:30`（`useEffect(() => setSelected(null), [latestKey])`）、`:35-37`（`reviewing` 变化时 `setEditing(false)`）。
- 规则：ui.md「展示与业务状态分层」：“派生值直接计算，不用 effect 在父子组件或多个 store 间镜像同步”。
- 问题：会多渲染一帧，期间显示旧的修订与编辑框。
- 修复：保存 `{ key: latestKey, selected }`，渲染时如果 key 不同就视为 null；editing 改为 `editing && reviewing`。

### A14. [hard] 渲染端信任边界：jobs-store 的错误体未按 schema 校验
- 位置：`apps/desktop/src/renderer/stores/jobs-store.ts:30-34`（把 `error.code` 直接断言为 `ApiError['code']`）。goal-store.ts:29 用的是 `Value.Check(ErrorResponse, …)`。
- 规则：两个 store 的注释与 architecture.md 一致：“响应在信任边界按 schema 校验”。
- 修复：改为 `Value.Check(ErrorResponse, value)`，并与 goal-store、client/api.ts:61 合并为同一个 `requestJson(schema, …)`（见 B1）。

---

## B. 坏味道（judgement）

- **B1 Duplicated Code：HTTP 调用写了三份。** `client/api.ts:61`、`stores/jobs-store.ts:21-38`、`stores/goal-store.ts:16-34` 的 fetch → 错误映射 → schema 校验几乎相同，其中一份已经出现分歧（A14）。导出一个 `requestJson`，三处复用。
- **B2 Duplicated Code：每 Session 一把锁写了三份。** `goals.ts:185-194`（`#gate`）与 `:464-473`（`#locked`）逐行相同，`session-permissions.ts:99-107` 是同一模式，但缺少 tail 清理，Map 只增不减。抽出 `KeyedMutex`（`run(key, task)`），统一清理逻辑。
- **B3 Duplicated Code：** `const message = (error) => …` 在 `goals.ts:43`、`jobs.ts:37`、`processes.ts:15` 各有一份；`'<job-notification>'` 在 `goal-driver.ts:32` 与 renderer `timeline.ts:93` 各一份，加上生成方 `jobNotificationText` 共三处。标签常量应从 `@coko/agent/entries` 或 protocol 导出。
- **B4 Duplicated Code / 隐式耦合：计划规则写了两份，另有一个裸数字。** `packages/agent/src/planning/exit-plan-mode.ts:12-25` 与 `packages/protocol/src/planning.ts:19-32` 的 `PLAN_MAX_CHARS`、`planMarkdownProblem`、`planTitle` 完全相同；`protocol/src/permissions.ts:84` 的 `maxLength: 64_000` 是同一个常量的裸写。agent 不能依赖 protocol，这份重复可以接受，但需要像 `entry-payloads.ts` 那样加一个守卫测试（两边对同一组输入的结果相等），并让 permissions.ts 引用 `PLAN_MAX_CHARS`。
- **B5 Mysterious Name：** 两个 `formatCost` 含义不同：`goals/state.ts:145` 用于模型可见文本（6 位小数、无符号），`session-cost.tsx:87` 用于界面（带货币与 locale）。前者改名为 `costText`。`application/permissions.ts:7,10` 把 `StandardPermissionMode` 别名为 `PermissionMode` / `PermissionModeSchema`，与 protocol 中含 plan 的 `PermissionMode` 同名不同义，阅读时容易误判 plan 能否作为默认模式。直接使用原名。
- **B6 Primitive Obsession / Repeated Switches / Shotgun Surgery：** 预算维度在 `state.ts:121-124`（limitOf / usedOf）、`:148-155`（显示名）、`goals.ts:516-520`（反解析）与 renderer goal-card 中都有映射；`reason.code` 在协议中是 `Type.String()`（`protocol/src/goal.ts:56`），renderer 按字符串分支。新增一个维度要改 5 处以上。用一张 `GOAL_BUDGET_DIMENSIONS` 描述表（key、budget 字段、usage 字段、模型可见名、格式化函数），协议中把 reason.code 定义为已知字面量的联合，再加 `Type.String()` 兜底。
- **B7 Message Chains / Feature Envy / Middle Man：** GoalService 经 `this.#options.jobs.hub.subscribe/publishEntry`（`goals.ts:302,441,450`）使用 SessionHub，还用 `this.#sessions?.runs.activeRunId / stopAfterBatch / modelPriced / startRun`（`:97,158-177,198,274`）。JobService 的 `hub` getter（`jobs.ts:117-119`）只是转手。构造 GoalService 时直接注入 `hub` 与一个窄的 `GoalRunHost { activeRunId, stopAfterBatch, startRun, modelPriced, isRunning, abort, pause }`，去掉 `attach()` 这种可变的后期装配。
- **B8 Divergent Change：** `session-runs.ts`（473 行）同时负责 Run 入口、bash 的 Job 注入（`withJobs`）、Goal 的 `stopAfterBatch`、定价查询 `modelPriced` 与追加指令的送达。定价与送达不属于“开始 Run”这一职责，`modelPriced` 应该移到 `session-models.ts`。
- **B9 Data Clumps：** `{ pid, pgid? }` 在 `processes.ts:39`、`adapters/processes.ts:17,19,44,46,54`、`pty.ts:16` 中反复出现，pty.ts 还另写了一套组信号回退（`signalGroup`）。导出一个 `ProcessTarget` 类型与一个 `signalTarget`，pty.ts 复用。
- **B10 Speculative Generality：** `goalUsage` 的 `children` 参数（`budget.ts:91,99-105`）与 goal.md 中的子 Session 汇总，注释写明“M4 没有调用方”。按 YAGNI 留到 M5 再加，测试一并删除；或者至少不在 goal.md 中写成当前行为。
- **B11 GoalCard 按条目数重读用量。** `goal-card.tsx:601-603` 每来一条条目就 `GET …/goal`，而服务端每次都从全部条目重算五维（`goals.ts:116-122`）：Run 期间每条消息都会触发一次 O(条目数) 的计算。改为只在 `goal`、`run_end`、`compaction`、assistant 消息条目到达时重读，或者节流到 1 秒一次。
- **B12 计划批准的回退路径编造 revision。** `session-permissions.ts:187`：找不到待审阅记录时用 `nextPlanRef` 新建，导致“批准的计划”与提交的 proposed 条目不是同一个 revision。正常情况下这条路径走不到（propose 总在询问前执行）；走到就说明状态不一致，应该抛出错误，而不是猜一个值。
- **B13 注释过期：** `apps/server/src/application/processes.ts:1-2` 写着“之后还有后台 Job 与 PTY”，这两项已经实现。
- **B14 固定 sleep：** `apps/server/src/application/processes.test.ts:146` 用 `setTimeout 200` 等 trap 生效（testing.md「等待可观察状态」）。可以让脚本在 `trap` 之后写一个 ready 文件，测试等待该文件出现；`startGroup` 已经有同样的写法。
- **B15 无人值守的缺省预算只有轮次。** `normalizeBudget`（`state.ts:182-200`）缺省只设 `maxRounds = 50`，没有 Token、费用与时间上限。ADR 0011 没有要求缺省值，所以不算违规；但无人值守时 50 轮昂贵模型的费用没有上限。建议在 create_goal 的描述中要求模型为长任务设置 `max_cost`，或者界面在没有费用上限时显示提示。

---

## C. 评审项结论汇总（lead 在 Comments 中点名的五项）

| 项 | 结论 | 见 |
| --- | --- | --- |
| plan.e2e 菜单重试 | 改为等 `[role=menu]` detached 且 body 的 pointer-events 恢复后再点，删除重试 | A11 |
| Radix 菜单使 getByRole 失效 | 原因已知（关闭中卸载留下 `aria-hidden` / `pointer-events`），拆文件掩盖了缺陷；加全局泄漏断言后合回一个文件 | A10、A9 |
| ANSI 颜色对比度 | 违反 ui-design-system.md:32；新增 terminal 语义 token 并测量对比度 | A12 |
| checkpoint 备份先于预算 hook | 建议调换：增加一个 admission 阶段，排在有副作用的 hook 之前 | A6 |
| 控制通道静默丢弃非法消息 | 两端处理不对称，属于缺陷；`ModelPrice` 去掉下限的理由不成立（main 已在发送前按同一 schema 校验） | A7 |

---

## D. 已核对、未发现问题的点

- 孤儿清理的身份核对：`#verify` 同时要求 lstart 一致，且 ps 报告的当前 pgid 仍等于登记值，才按组发信号（`processes.ts:150-162`）；`ps` 固定 `LC_ALL=C`、`TZ=UTC`；不按名字搜索；关闭后启动的进程立即 SIGKILL。SIGKILL 前不再核对身份，2 秒窗口内 pgid 被复用的概率很低，接受。lstart 精确到秒的限制已写入 execution.md。
- Plan Mode 工具限制：plan-exit 在 `decide.ts` 的模式放行之前总是询问；`planReviewOf` 用 WeakMap 识别工具，工具对象不能自行声明；editedPlan / mode 只对 kind plan 有效，mode 不能是 full-access；`reevaluate` 跳过 kind plan。
- 秘密：job 命令、label、日志、WS 帧、通知文本、goal 快照、plan 条目都经按值替换；`job input sent` 只记字节数；登记表的 command 用 `redactText`。
- 路由的信任边界：`GoalActionRequest` 经 `body()` 校验；job id 先过 `JOB_ID` 正则再拼路径（`jobs.ts:44,197,236`），防止路径穿越；output 的 limit 有范围检查。
- Goal Round 去重：轮次取自已提交的 `run_start`，推进在 Session 锁内；`runEnded` 与 `#jobEnded` 都检查 `#cancelling`。
- 文档引用：正式文档没有链接 `.scratch`；“M4 票 02”的写法沿用了 TECH_STACK 中已有的“M3 票 01”。

---

## E. 未读或只抽样的部分

只看了 diff stat 或抽样，未逐行读：
- `packages/agent/src/engine/runtime.ts`、`compaction-driver.ts`、`permission-wiring.ts`（只读了 beforeRequest / stopAfterBatch 相关段落）；`engine/types.ts`、`errors.ts`、`system-message.ts`。
- `packages/agent/src/tasks/jobs/job.ts`、`output.ts`、`tasks/todo/todo.ts`；`ports/local-exec.ts`（tty 分支）、`ports/pty.ts`；`goals/prompt.ts`；`goals/tools.ts` 第 140 行之后（planGoalUpdate）。
- `apps/server/src/runtime/layers.ts`（只看了 hook 与测试开关的装配）、`context/index.ts`、`context/mcp*.ts`、`context/todo.ts`、`context-service.ts`、`sessions.ts`、`session-models.ts`、`adapters/faux.ts`、`adapters/mcp.ts`、`ipc-decryptor.ts`、`encrypting-bridge.ts`、`desktop/src/main/secrets.ts`。
- packages/session 的迁移 v7 与 repository-contract；protocol 的 jobs.ts、todo.ts、ws.ts、runs.ts、entries.ts。
- renderer：goal-card.tsx（只读了 560-632 行与 grep 结果）、jobs-tab.tsx、jobs-button.tsx、job-row.tsx、todo-card.tsx、queue-card.tsx、plan-review-panel.tsx（只读了 120-150 行）、approval-panel.tsx、conversation-pane.tsx、timeline*.ts、chat-store.ts、jobs-store.ts（第 45 行之后）、settings 下的价格输入；i18n 的五个新领域文件。
- 测试：所有 `tests/integration/sidecar-*.test.ts`、`secrets-gate-*.test.ts` 与 e2e 文件只 grep 了隔离方面的问题（localStorage、env、固定路径、sleep），没有核对断言内容；`apps/desktop/build/build.ts`、`scripts/postinstall-node-pty.mjs`、`package-smoke.e2e.test.ts` 未读。
- 没有运行任何测试或检查命令（只读评审）。

---

## 处理结果（m4/12-review-fixes，2026-10-30）

| 编号 | 处理 | 测试 |
| --- | --- | --- |
| A1 | Job 记下启动时的沙箱档位（`BackgroundJob.sandbox`，不进入快照与协议）；工具新增 `fixedSandbox`，权限 gate 在该档位严格宽于当前模式时 plan / read-only 拒绝，其余模式按 kind escalation 询问（a08424b） | sidecar-pty："较宽档位启动、之后收紧"（plan 拒绝且终端未写入；default 为 escalation，subject 为整行），原"default 询问"一例改为 escalation |
| A2 | 被宿主 hook 拦下的调用由运行时写 `details.hostBlock`（工具自身给出的去掉），budget.ts 只认它；`RunError.dimension` 交给宿主、不进入 run_end 条目与进度，`budgetDimension` 删除（3799caf，前任起草） | budget.test 伪造前缀仍计数；host-stop.test hostBlock 与 dimension；sidecar-goal-budget 伪造前缀以非零退出仍计 1 次（先红） |
| A3 | `act` 取消中 409；`advance` 经 `isCancelling` 放弃；提交 cancelled 前重读 activeRunId 并停止（194dc9b） | sidecar-goal：忽略 SIGTERM 的 Job 卡住取消，job_update stopping 处 resume → 409，只有 2 个 run_start（先红：200） |
| A4 | 自动压缩与溢出恢复之前先过 `beforeRequest`，压缩后再检查一次（3799caf，前任起草）；手动 /compact 不检查，写入 goal.md | compaction.test 三例（不发摘要请求、压缩后 stop、溢出恢复前 stop） |
| A5 | model-not-configured / model-required → blocked，confirmation-pending → waiting-input，reason.code 为错误码（df98f62） | goal-driver.test 五例（先红 3 例）；未写"删除 Provider 后 resume"集成用例，以单元测试覆盖 |
| A6 | `ContextContribution.admissionHooks`，链序：权限 → 准入 → 扩展（checkpoint）→ hooks → 脱敏；goal 的工具 hook 移入（8c698ae） | sidecar-goal-budget：被拦下的 write 没有 file_backup（先红） |
| A7 | ModelPrice 四项 `minimum: 0`；channel.ts 对带 requestId 的 provider.save / provider.models / secret.store 非法消息回答 bad-request；main `#send` 前 `Value.Check`（2d7b227） | control/channel.test 四例（先红 3 例）；sidecar-model-price 负数价格得到 bad-request |
| A8 | desktop Browser Mode 共用 setup：localStorage 快照与恢复；goal-card 的 `localStorage.clear()` 删除（a653f94） | 全量 desktop-renderer 137 例 |
| A9 | 删除 goal-card、todo-cards 的 `document.body.innerHTML = ''`，setup 中 `cleanup()`（a653f94） | 同上 |
| A10 | setup 断言 body 子节点没有 aria-hidden / data-aria-hidden、pointer-events 复原；4 个 plan 文件合回 `plan.browser.test.tsx`。合并后的真正原因是 plan-review 用例中 `screen.unmount()` 未 await（act 未完成），改为 await（a653f94） | 合并文件 12 例；临时用例留下模态层时 setup 使其失败（已删除） |
| A11 | plan.e2e 改为等 `[role=menu]` detached 且 body pointer-events 不为 none，单次点击（1ba9e82） | plan.e2e 1 例 |
| A12 | 新增 `--success-text`、`--warning-text`、`--terminal-{red,green,yellow,blue,magenta,cyan,muted}`（明暗各一套）；jobs-tab 与 goal-card 文字改用（cc49c4b）。实测对白色 ≥ 4.92、对 gray-800 ≥ 5.04 | jobs-tab.browser：两种主题下 7 色互不相同且对背景 ≥ 4.5:1（先红） |
| A13 | plan-tab 的选中修订与 editing 在渲染时派生（1030edc） | plan.browser 的 Plan tab 用例 |
| A14 | jobs-store 错误体按 `ErrorResponse` 校验并带 details（1030edc）；未合并为共用 requestJson（B1 可选，未做） | jobs-store.test 两例（先红） |
| B13 | processes.ts 注释改正（fe85414） | — |
| B14 | trap 之后写 ready 文件，测试等文件（fe85414） | processes.test 9 例 |
| B1–B12、B15 | 未处理（judgement，未列入本票清单） | — |
