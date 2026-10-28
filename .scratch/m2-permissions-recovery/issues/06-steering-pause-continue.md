# 06: 追加指令、暂停与继续

**What to build:** agent 运行控制：`steer(text)`（pi steer，当前工具批次结束后注入，送达时提交 user message）、`pause()`（finishTurn 返回 end，当前批次完成、不发新请求、pending 审批 cancelled，Run 以 paused 结束）、`continue()`（新 Run，`run_start { trigger: continue }`；上一 Run 须为 paused 或 interrupted 且无待确认）、abort 退回未送达追加指令（`run_end.undeliveredSteering`）。server：`POST …/steer`（无 Run 409 `no-active-run`）、`POST …/pause`、`POST …/continue`（409 `nothing-to-continue`），activity 的 paused。renderer：Run 中 composer 可输入、Enter 发送追加指令并显示待送达，停止与暂停并列，paused 横幅带"继续"，停止后未送达文本回到输入区。

**User stories:** 17, 18, 19

**Blocked by:** 05

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/engine/`、`packages/agent/src/session-entries/runs.ts`、`packages/agent/README.md`、`packages/protocol/src/runs.ts`、`apps/server/src/application/sessions.ts`、`apps/server/src/http/app.ts`、`apps/server/README.md`、`apps/desktop/src/renderer/features/conversation/`、`apps/desktop/src/renderer/features/sidebar/`、`apps/desktop/src/renderer/stores/`、`packages/ui/src/composer/`、`packages/i18n/src/dictionaries/`、`apps/desktop/e2e/run-control.e2e.test.ts`（新）、`tests/integration/sidecar-run-control.test.ts`（新）

- [x] 集成测试：bash `sleep` 执行中 steer → 该 user message 条目位于这次 toolResult 之后、下一条 assistant 之前；faux 收到的下一次请求上下文含该文本
- [x] 集成测试：steer 后立刻 abort（未送达）→ run_end 带 `undeliveredSteering`，没有对应 user message 条目
- [x] 集成测试：工具执行中 pause → 工具完成且 toolResult 提交，之后没有新的模型请求，run_end paused，activity paused；continue → 新 run_start（trigger continue）并发起模型请求
- [x] 集成测试：上一 Run completed 时 continue → 409 nothing-to-continue；无 Run 时 steer → 409 no-active-run
- [x] 集成测试：等待审批时 pause → 请求 cancelled、调用未执行、run_end paused
- [x] Electron E2E：Run 中输入并回车 → 待送达气泡随后变为普通消息；暂停 → 横幅出现，点继续 → Run 继续到完成；停止后未送达文本回到输入区
- [x] Browser Mode：Run 进行中 composer 可输入、Enter 调用 steer 而非 submit；IME 组合中不提交
- [x] agent 与 server README 同步

## Comments

- 2026-10-29 implementer（m2/06-steering-pause-continue）：
  - **覆盖的验收（全部 8 项）。** 集成 `tests/integration/sidecar-run-control.test.ts`（5 例）：bash sleep 执行中 steer 的条目位置与 faux 第二次请求上下文；steer 后立刻 abort → `undeliveredSteering`、无对应 user 条目、只有 1 次请求；执行中 pause → toolResult 提交、无新请求、run_end paused、详情与列表 activity paused，continue → run_start continue 并请求，之后 activity idle；completed 后 continue 409 nothing-to-continue、无 Run 时 steer / pause 409 no-active-run、空文本 400、未知 Session 404；等待审批时 pause → cancelled、无 tool_exec、run_end paused、文件不存在、再答 409。agent `engine/run-control.test.ts`（11 例，deferred 控制交叠）。Electron E2E `apps/desktop/e2e/run-control.e2e.test.ts`（3 例）。Browser Mode `features/conversation/composer.browser.test.tsx`（6 例：Run 中 Enter / 发送按钮调用 steer 而非 submit、被拒保留输入、IME 组合中不提交、暂停与停止并列、pausing 禁用、restore 接在草稿之前）。store `chat-store-run-control.test.ts`（6 例）。agent 与 server README 已同步。
  - **语义与判断点。** steeringMode 'all'：一次送达全部已发送的追加指令。停止、无反馈拒绝或暂停时 finishTurn 返回 end，所以停止后已排队的追加指令不送达而退回（否则 pi 会在 abort 后仍注入）。暂停只经权限 gate 的 signal 取消等待中的审批（不中断执行中的工具，不影响其后的 hook）；被取消的调用 toolResult 为 `PAUSED_BEFORE_APPROVAL_TEXT`（"Not run: the user paused…"），不用通用的 Operation aborted。暂停落在只有文本的最后一轮时 Run 以 completed 结束（没有可继续的内容）。continue 要求上一 Run 为 paused / interrupted 且对话末尾不是 assistant；从条目恢复的运行时由 server 传 `lastRunStatus`。aborted 之后不能 continue。server 的 continue 先查未回答的 confirmation_request（409 confirmation-pending），为票 08 预留。
  - **activity。** 不在运行时按上一 run_end 派生 paused / interrupted（server 内存记录：本进程结束的 Run 与读过条目的 Session；重启后未打开的 Session 显示 idle，待票 08 的未完成 Run 查询）。renderer 对已订阅会话按条目派生。`chat-store-approvals.test.ts` 中"run_end interrupted 后 activity idle"的断言改为 interrupted（规格中 activity 含 interrupted）。
  - **renderer。** Run 中 composer 可输入；有内容时显示追加指令发送按钮（`data-action="steer"`，不复用 send，既有 E2E 以 send 判断空闲），暂停与停止并列。待送达气泡弱化并标"待送达"，user 条目到达后由它替代；只退回本窗口发出的未送达文本（其他窗口与历史 run_end 不退回）。paused 横幅在输入区上方带"继续"；时间线 run_end paused 显示"已暂停"。侧栏没有改动（规格的上浮徽标只针对 awaiting-approval / awaiting-confirmation / interrupted）。
  - **越出 Write scope 的改动（最小，请裁决）。** 1）`packages/protocol/src/errors.ts` 与 `apps/server/src/application/errors.ts`：新错误码 no-active-run、nothing-to-continue、confirmation-pending（409）。2）`packages/agent/src/index.ts`：engine 导出行加 NoActiveRunError、NothingToContinueError、PAUSED_BEFORE_APPROVAL_TEXT（与票 10 的 models 行不冲突，合并 main 无冲突）。3）`apps/desktop/src/renderer/client/api.ts`（steerRun / pauseRun / continueRun）、`app/chat-failure.ts`（失败类型与错误码文案）、`testing/fixture-chat.ts`（桩）。4）`apps/server/src/adapters/faux.ts`：脚本可选 `requestLog`，每次请求前把上下文追加为一行 JSON，用于验收"faux 收到的下一次请求上下文含该文本"（只有测试脚本会给出）。5）`packages/ui/src/composer/composer-editor.tsx` 的 handle 加 `getText` / `setText`（属于 `packages/ui/src/composer/`，在范围内，列出备查）。
  - **秘密总闸。** 未追加步骤：新的输出只有 `run_end.undeliveredSteering`（用户自己输入的文本）与 409 错误体，没有新的凭据通道；secrets-gate 全绿。
  - **命令与结果**（worktree，已 `git merge main`（含票 07、10），`unset ELECTRON_RUN_AS_NODE`）：`pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run lint`（0 / 0）、`pnpm run format:check`、`pnpm run check:docs`（82 文件 0 问题）均退出 0；`pnpm run test`：89 个文件，717 通过、1 跳过（真实模型），含 desktop E2E 9 个文件与产物 smoke。合并后第一次全量运行有 29 例失败（ui dialog / app.browser 的 Invalid hook call 与 agent index 导入超时），单独重跑这些文件 30 例全过，第二次全量只剩本票 E2E 一处断言竞态（待送达气泡乐观显示后编辑区稍后才清空），改为等待后连续 3 次通过，第三次全量全绿。负向确认：agent 测试在实现前 10 例失败；实现中 abort 用例抓到"停止后 pi 仍注入追加指令"并修复。视觉：临时 E2E 截取 Run 中（待送达气泡、发送 / 暂停 / 停止三按钮）与暂停横幅（退回文本接在草稿之前），截图未入库。
  - **未验证。** 真实模型（无密钥）；CI；非 darwin。Sidecar 重启后未打开 Session 的 paused activity（见上）。多窗口同时追加指令时的退回只做了"不退回别处文本"的单测。
  - **文档影响。** `packages/agent/README.md` 新增"运行控制"一节与验证条目；`apps/server/README.md` 路由、条目与 activity 取值；GLOSSARY 已有 Steering，未改；docs/subsystems/permissions.md 未改（暂停取消审批的行为写在 agent README）。TECH_STACK 无新依赖。
- 2026-10-29 lead：评审后合入 main（963dac9）。接受越界：protocol 与 server 的错误码 no-active-run、nothing-to-continue、confirmation-pending；agent index.ts engine 导出行；renderer client/api.ts、chat-failure.ts、fixture；faux 脚本可选 requestLog。main 上复核：install、typecheck、lint、format:check 退出 0；全量 test 89 文件 717 通过、1 跳过（真实模型），无页面重载；check:docs 0 问题。实施者报告的首轮 29 例环境性失败未在 main 复现。worktree 已清理。

Closed: true
