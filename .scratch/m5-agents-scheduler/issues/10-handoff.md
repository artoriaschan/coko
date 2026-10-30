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
