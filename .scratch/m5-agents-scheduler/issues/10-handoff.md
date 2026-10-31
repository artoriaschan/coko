# 10: Handoff：/handoff 与对话框、摘要 Run、目标会话（当前目录或 worktree）、继承规则与草稿

**What to build:** 见 [规格](../spec.md)"Handoff"：agent `agents/handoff.ts`（摘要提示与目标条目推导，复制权限条目与 `forkEntries` 同一规则）；server `HandoffService`（准入、`trigger: handoff` 的摘要 Run、Run 正常结束后创建目标 worktree（经票 04）与目标 Session、`handoff_origin` 与源 `handoff` 条目）、`context/handoff.ts`（`/handoff` 命令）、`routes/handoff.ts`；renderer 标题栏"交接"、对话框（目标、未提交改动提示经 `git-status`）、进行中与停止、完成后切到目标会话并写入草稿、`handoff` / `handoff_origin` 时间线行。

**User stories:** 18

**Blocked by:** 04

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/agents/handoff.ts`、`packages/protocol/src/handoff.ts`、`apps/server/src/application/handoff.ts`、`application/context/handoff.ts`、`http/routes/handoff.ts`、`packages/i18n/src/dictionaries/domains/handoff.ts`、renderer `features/conversation/{handoff-dialog（新）,handoff-row}.tsx`、`header-actions.ts`（只改 handoff 一行）、`stores/handoff-store.ts`（新）、composer 草稿存储模块（只增加"为指定会话写入草稿"的导出）、就近测试、`tests/integration/{sidecar-handoff,secrets-gate-handoff}.test.ts`（新）、`apps/desktop/e2e/handoff.e2e.test.ts`（新）、`docs/subsystems/handoff.md`（新）

- [x] 集成：`/handoff 接着实现登录页` → 一个 `trigger: handoff` 的 Run、faux requestLog 中只有一次无工具的摘要请求（含有效上下文与 instructions）→ 目标 Session 存在、首条 `handoff_origin`、模型 / 推理档位 / 权限模式与 Session 规则与源相同、没有 message / goal / todo_list / plan / job 条目；源 Session 有 `handoff { targetSessionId, summary, usage }`，其余不变
- [x] 集成：目标为新 worktree（git 夹具）时目标 Session 绑定该 worktree、工作目录正确；源有未提交改动时 `git-status.dirtyFiles` 为实际数量；目标为已有 worktree 时复用
- [x] 集成：Run 进行中 409、子 Session 409、没有用户消息 400；摘要 Run 被停止时不创建目标 Session 与 worktree
- [x] **对手用例（预算）**：Goal running 且 `maxTokens` 已耗尽时 `/handoff` 不发出摘要请求、Run 以 `budget_exhausted` 结束、没有目标 Session；正常交接的 `handoff.usage` 计入 Goal 的 tokens（`GET …/goal` 断言）
- [x] 秘密总闸 `secrets-gate-handoff`：源对话含登记 Secret 时摘要请求（requestLog）、`handoff` 条目、HTTP、WS 与库中没有明文；目标会话的草稿（renderer 读取的条目）同样没有
- [x] E2E：标题栏"交接"打开对话框 → 选择新 worktree → 提交后显示进行中 → 切到目标会话、输入区草稿为摘要（未发送）→ 源会话时间线显示"已交接到 …"、目标时间线可跳回源；明暗主题与键盘操作
- [x] 符号链接：不新增读取根（worktree 的检查在票 04；Comments 写明）
- [x] handoff.md 建立并可达（含与 Fork 的差异表）；`check:docs` 通过

## Comments
- 2026-10-31 lead：来自票 02——/handoff 已出现在命令目录中，动作目前为 400 占位，由本票替换；摘要模式只提交 run_start / run_end，摘要的 usage 在 RunResult.summaryUsage，由本票写进 handoff 条目。
- 2026-10-31 实施者（m5/10-handoff）：
  - **覆盖。** 验收 1–3：`tests/integration/sidecar-handoff.test.ts`（5 例：/handoff 的摘要请求与 requestLog、目标继承 / 不继承、源条目只增 run_start / run_end / handoff；新 worktree 绑定与 `pwd -P`、git-status.dirtyFiles=2、已有 worktree 复用 sessionCount=2；400 / 409（含 Run 中的 /handoff）、停止后无 handoff、无 Session、git worktree list 只有主 checkout、无 coko/* 分支）。子 Session 409 不能经 HTTP 构造（CreateSessionRequest 没有 parentSessionId），由 `apps/server/src/application/handoff.test.ts` 覆盖。验收 4（对手用例）：同文件"Goal 预算"两例——Token 已耗尽时 /handoff 不发请求、paused + budget_exhausted、无目标；正常交接 usage 1098 计入，GET goal tokens=1100，之后的 Goal Round 不发请求（requestLog 4 条）。验收 5：`secrets-gate-handoff.test.ts`（requestLog、WS、HTTP、库、目标标题、日志；草稿内容即 handoff.summary，已在条目中断言为占位）。验收 6：`apps/desktop/e2e/handoff.e2e.test.ts`（键盘打开、Tab / → / Space 选新 worktree、⌘ 之外 Enter 提交、进行中、目标草稿为摘要且无用户气泡、两边行互跳、明暗对比度 ≥ 4.5）。验收 7：交接不新增读取根——目标 worktree 的创建与工作目录检查都经 WorktreeService（票 04 的符号链接用例）。验收 8：`docs/subsystems/handoff.md`（含与分叉的差异表）与 docs/README 一行，check:docs 0 问题。
  - **对手用例中的新发现。** 摘要 Run 结束后，contributions 顺序中 goal 的 onRunEnd 先于 handoff，Goal 的下一轮可能在 handoff 条目（usage）提交前发出请求、越过预算。修复：HandoffService.beforeRequest——该会话的交接目标仍在创建时，其他 Run 的请求等 handoff 条目提交后再按 Goal 预算重查。单元用例先构造这个顺序；变异（去掉等待）后单元用例失败，集成用例在本机 3/3 仍通过（竞态窗口小），因此以单元用例为准。
  - **负向确认。** 变异 1（去掉请求等待）：handoff.test.ts 1 失败。变异 2（不看 Run 状态就创建目标）：handoff.test.ts 3 失败、集成"被停止"用例失败（先用日志等待时漏检：文件日志有缓冲，改为轮询准入 409→404）。变异 3（目标标题不脱敏）：secrets-gate-handoff 失败。E2E 发现并修复一个缺陷：交接完成切换会话后对话框仍打开（模态遮住标题栏），按钮在 sessionId 变化时关闭对话框。
  - **越出 Write scope（最小改动）。** `packages/agent/src/agents/index.ts` barrel 一行导出（02 所有）；`apps/server/src/application/context/types.ts` 增加 `handoff?` 选项；`apps/server/src/runtime/layers.ts`：HandoffService 在 AssemblyLive 创建（贡献读取它），Run 与 worktree 能力经 lateSessionRuns 晚绑定，`bindSessions(sessions, worktrees)` 多一个参数；`tests/integration/sidecar-m5-seams.test.ts` 的 /handoff 占位用例改为断言 400 nothing-to-hand-off；`dock.browser.test.tsx` 与 `settings/sections.browser.test.tsx` 注册表断言的 handoff 一行（与 08、09 同一行可能冲突，按"各自一行"合并）。
  - **未改与待定。** goals.ts 不在写范围（07 所有）：交接之后源会话的 Goal 照常推进（handoff.md 已知限制）；是否让交接暂停源 Goal 由 Lead 裁决。目标在摘要后创建：校验后才出现的 git 冲突使交接失败，界面停在"正在创建新会话…"（只记 warn）。真实模型未验证。
  - **README 要点（交 08 / Lead 合并）。** agent：`handoffPrompt`、`handoffTargetEntries`、`hasUserMessage`、`handoffSummaryText`、`HANDOFF_COPIED_KINDS`、`HANDOFF_SUMMARY_MAX_CHARS`；server：`HandoffService`（start / beforeRequest / runEnded）、`POST /api/sessions/:id/handoff`；renderer draft-store 新导出 `writeSessionDraft`、`textEditorState`。
- 2026-10-31 lead：运行全量 `pnpm run test` 前取得全量测试锁 `/tmp/coko-full-test.lock`（做法见 implementer-brief 的"全量测试锁"一节）；只跑单个文件不需要。之前多个 worktree 的全量互相重叠，负载到 20–40，真实进程与 Browser Mode 用例大面积超时。
- 2026-10-31 lead：合入 main（e7ec99d），与票 07 在 agents/index.ts、context/types.ts、layers.ts 与票 Comments 冲突，保留两侧（子代理与交接都在 AssemblyLive 创建，bindSessions(sessions, worktrees) 与 hooks.bind 都保留）。合入后发现两处问题：(1) sidecar-handoff 的停止用例在全量下失败——真实缺陷：run_start 之后、第一次请求之前到达的停止找不到可停止的流（agent.abort() 为空操作），请求照常发出并流到结束；对所有 Run 都成立，交接的 20 000 token 摘要使它在全量负载下暴露。lead 在 m5/fix-abort-before-request 先写失败测试（handoff 与 submit 两例，红），在 prepareRequest 中 run.aborted 时扣下请求，合入（f73c4f3）。(2) app.browser 的 390px 用例在 main 上 3/3 失败（scrollWidth 112 > 110）：本票的交接按钮始终显示，标题栏固定宽度的元素在 390px 下超出主列；由 m5/fix-header-narrow 处理。
- 2026-10-31 实施者（m5/fix-header-narrow）：标题栏在窄主区的溢出。
  - **原因（读实际值）。** 整文件运行时上一用例停在 1280 px，390px 用例在 `data-sidebar=rail` 后立即测量，侧栏收起的 300 ms grid 过渡尚未结束：主列 clientWidth 110，标题栏子元素 h1 与连接状态已截断到 0 宽，剩下 ps 16 + 3 个 gap-2 + 交接 36 + 右栏开关 36 = 112。只跑 `-t 390px` 时主列已是 334，所以通过。ui.md 要求过渡中的瞬时窄宽度同样不撑出整页横向滚动，因此按布局修复，不改测试的等待。
  - **做法（ui.md "先重排，再截断" 与 mode-picker 的 `@max-[560px]/main` 先例）。** `HeaderActionDefinition` 增加可选 `MenuItem`：主列窄于 560 px 时，提供菜单呈现的操作收进标题栏"更多操作"菜单（共享 DropdownMenu，EllipsisIcon），按钮本身仍挂载但 `display: none`，它持有的对话框照常工作；没有 `MenuItem` 的操作（jobs 这类带状态的）留在标题栏。"更多操作"只在窄主区且至少一个可收起的操作实际渲染时显示（CSS `group-has`，子 Session 不显示空菜单）。窄主区中标题栏 gap 从 8 px 收到 4 px（不缩小控件和点击区域）。交接：`HandoffMenuItem` 经按会话计数的打开请求让隐藏的 `HandoffButton` 打开对话框。
  - **键盘路径中发现并修复的两处问题。** (1) 菜单关闭时把焦点还给菜单按钮，晚于对话框打开，焦点被拉出对话框，按钮的 Tooltip 吃掉 Escape，对话框关不掉。修复：`HeaderMenuActionContext`，菜单项的动作在菜单的 onCloseAutoFocus 中、焦点回到菜单按钮之后执行。(2) 对话框没有 DialogTrigger，关闭后焦点落到 body（宽窗口下原本也是如此）。修复：`HandoffButton` 记下打开它的元素，经 `HandoffDialog` 新增的 `onCloseAutoFocus` 把焦点还回去。另外，打开请求的"已处理"计数最初没有按会话记，切换会话会让新会话的对话框自行打开（整文件运行时下一个用例因此失败），改为按会话记。
  - **测试。** app.browser.test.tsx 新增"390px：交接收进标题栏的'更多操作'菜单……"：More 在视口内，标题栏的交接按钮不渲染，从右栏开关 Shift+Tab 到 More、Enter 开菜单（焦点在"交接"）、Enter 打开对话框（焦点在下一步目标）、Escape 关闭后焦点回到 More。新文件 `features/conversation/header-actions.browser.test.tsx`（4 例）：不窄于 560 px 时全部留在标题栏；更窄时可收起的进菜单、状态类留在标题栏、菜单项收到会话 id；可收起的操作不渲染时不显示 More；经菜单打开过后切换会话，新会话的对话框不会自行打开。
  - **负向确认。** 修复前 main 上整文件 390px 用例失败（112 > 110）。变异：打开请求不按会话比较时 header-actions 用例 4 失败；没有 (1)(2) 修复时新 app 用例分别失败于 Escape 不关闭和焦点在 body。
  - **运行。** app.browser.test.tsx 整文件连跑 3 次：21/21 ×3。header-actions、handoff、dock、settings/sections 的 browser 用例与 packages/i18n：6 个文件 35/35。git merge main（1d6fdbb）后 typecheck、lint、format:check、check:docs 退出码 0。全量 `pnpm run test`（取锁）见完成报告。
  - **给票 08（agents 一行）。** 标题栏按钮照常放进 `Component`；如果它能在窄主区收进菜单，同一行再给 `MenuItem`（DropdownMenuItem）。菜单项要打开对话框或移动焦点时，经 `HeaderMenuActionContext` 包住动作；对话框由始终挂载的 `Component` 持有。只显示 running 数、点开右栏 tab 的按钮可以不给 `MenuItem`，留在标题栏。
  - **越出 Write scope（最小改动）。** `packages/i18n/src/dictionaries/{zh,en}.ts` 增加 `conversation.moreActions`（更多操作 / More actions）；`HandoffDialog` 增加可选 `onCloseAutoFocus` 属性（同文件，超出 HandoffButton 呈现）；`header-actions.ts` 改了注册表的类型（`MenuItem` 字段与 `HeaderMenuActionContext`），不只 handoff 一行；`HeaderActions` 从 conversation-pane.tsx 导出供测试。
  - **未处理与限制。** session-cost.tsx 不在写范围，未按容器宽度隐藏费用文字。过渡瞬时宽度约 110 px 时，若会话同时有 Job 与费用，留在标题栏的两者仍会短暂超出（约 300 ms，稳定的 390 px 下不超出）；要消除，可给 jobs 和 cost 提供 `MenuItem`，或在窄主区只显示费用图标。Electron E2E 未重跑（handoff.e2e 在 1280 px 下仍点击标题栏中的按钮，不受影响）。
- 2026-10-31 lead：标题栏 390px 溢出由 m5/fix-header-narrow 修复（窄主区把可收起的操作收进"更多操作"菜单，交接仍可用键盘到达；首位实施者中途失败，留下 4 个提交与 1 处未提交的焦点修复，lead 验证后提交并合入 b83530d）。接受越界：agents barrel、context/types.ts 的 handoff 选项、layers.ts 接线、sidecar-m5-seams 占位用例的期望、两个注册表测试的固定值。来源 Session 的 Goal 在交接后继续推进是否应暂停——记入 M5 评审。已知限制：校验之后才出现的 git 冲突使交接失败，界面停在"正在创建新会话"（warn 日志）。main 上在全量测试锁内复核（b578e40，开始前负载约 12，运行期间没有其他全量重叠）：install、typecheck、lint、format:check 退出 0；全量 test 303 文件 2504 通过、1 跳过（真实模型），无页面重载、无未处理错误；check:docs 181 文件 0 问题。worktree 已清理。

Closed: true
