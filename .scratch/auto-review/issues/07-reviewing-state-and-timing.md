# 07: 审查中状态与切换时序

**What to build:** 审查进行时工具卡显示“自动审查中”，一次慢审查不会看起来像界面卡死。审查与用户操作交叠时结果确定：审查途中切换模式，这次审查的结果作废并按新模式处理；停止或暂停 Run 时审查被取消；切换到“自动审查”时已经在等用户的审批卡保持不变；每次调用至多审查一次。

**User stories:** 10、20、57、58、60。

**Blocked by:** 03

**Status:** ready-for-agent

- [x] 审查开始时向界面推送“自动审查中”，形状取自设计稿，不入库
- [x] 工具卡在审查期间显示“自动审查中”，审查结束后由随后的审批条目决定显示
- [x] 重连后不恢复这个状态，工具卡回到普通的等待显示
- [x] 审查结果生效前按当时的模式与规则复核：新判定放行则执行，拒绝则以规则拒绝，仍需询问则直接问用户且不重审
- [x] 审查途中切到 default：审查结果不生效，出现审批请求
- [x] 审查途中切到 full-access：调用按模式放行执行，没有 Reviewer 的允许决定
- [x] 审查途中新增匹配的拒绝规则：调用以规则拒绝
- [x] 切换到 `auto-review` 时已在等待的请求保持等待，没有审查请求
- [x] 用户回答之前的重新判定、“总是允许”保存后的重新判定不触发审查
- [x] 停止或暂停 Run 时进行中的审查被取消，调用按现有的“停止或暂停时未批准”处理，没有允许决定的条目
- [x] Sidecar 在审查途中退出：重启后该调用按现有的未执行调用恢复规则处理，不自动重审
- [x] 交叠位置用 barrier 或受控 promise 确定，不用固定 sleep 或重复运行代替
- [x] gate 的运行时级测试：每次调用至多调用一次 Reviewer 端口；取消之后到达的结果不生效
- [x] 集成测试覆盖途中切换模式的三种结果与停止时取消
- [x] renderer 的 Browser Mode 测试覆盖“自动审查中”的显示与结束
- [x] 中英文文案齐全

## Comments

**2026-11-20 实施完成（待审查）。**

交付：

- agent 进度 `review_start`（gate 选项 `reviewStarted` 经 wiring 由 runtime 发出，在调用 Reviewer 端口之前）；protocol `ProgressEvent` 与 `DETACHED_PROGRESS.review_start = false`，README 进度表同步。
- gate 复核：结论返回、未中止时按当时的模式与规则再判定一次（PreToolUse 不重跑），比较模式、组合来源、步骤、询问原因与建议规则；作废时按新判定放行（无审批条目）、以规则拒绝或直接询问（不带 `review`、不重审、不再运行 PermissionRequest）。
- renderer：`LiveRun.reviewing`；`buildTimeline` 对仍在审查中、尚无审批请求、执行记录与结果的工具项标 `reviewing`；重连清空；工具卡标题行显示 `tool.reviewing`（muted），状态的无障碍名称同步；中英文文案。

与设计稿的差异：

- 设计稿写 `tool_start` 进度清除审查中状态。pi 在权限判定之前发出 `tool_start`（`agent-loop.js` 中 `tool_execution_start` 先于 `beforeToolCall`），用它清除会让状态立即消失；改为由 `tool_exec` 条目清除（复核作废后直接执行的调用，如审查途中切到 full-access）。审批请求、结果条目与 `run_end` 照设计。
- 状态文字放在标题行的 meta 位（`ToolStateMeta`，紧邻“等待审批”的位置），没有改 `packages/ui` 的 `ToolRow`（它只为 pending / awaiting 显示状态文字）；agent 卡片同样经 `ToolStateMeta` 显示。

实际运行（worktree，合入 `feat/auto-review` 的 `26a501e9`（含票 04、05、06）之后复跑；之后又合入 `3319a8d3`（票 09，只改测试），复跑 `gate-unattended`、`gate-review`（44 通过）、`headless-auto-review` 集成（7 通过）与 `pnpm typecheck`）：

- `pnpm exec vitest run packages/agent/src/policy packages/agent/src/engine packages/protocol apps/server/src/application apps/desktop/src/renderer/stores apps/desktop/src/renderer/features --project agent --project protocol --project server --project desktop`：930 通过、9 失败；9 个失败在集成分支基线上同样失败（entries kind 列表、host-stop ×2、approvals、gate-hooks、chat-store-context-entries、chat-store-m4-entries、chat-store-rewind、chat-store-run-control）。其中 `gate-review.test.ts` 32 通过、`chat-store.test.ts` 30 通过。
- `pnpm exec vitest run --project desktop-renderer apps/desktop/src/renderer/features/conversation apps/desktop/src/renderer/features/trajectory apps/desktop/src/renderer/features/session-diagnostics`：407 通过、9 失败（file-tool-details ×5、terminal-details ×4，基线已知；在合入票 04 后跑，票 05 未改 renderer）；新用例 `permission-states.browser.test.tsx` 的 en / zh 两例通过。
- `pnpm exec vitest run --project integration tests/integration/sidecar-auto-review.test.ts tests/integration/secrets-gate-auto-review.test.ts tests/integration/sidecar-run-control.test.ts tests/integration/sidecar-permissions.test.ts`：39 通过。另跑 `sidecar-approvals`、`sidecar-recovery`：3 个失败（approvals ×2、recovery 的 v1 迁移）在基线上同样失败。
- 回归核验：临时去掉复核分支，途中切到 default / full-access / 拒绝规则三例失败；临时去掉中止判断，停止、暂停的迟到结论用例失败；均已恢复。
- `pnpm typecheck` 通过；`pnpm lint` 无输出（通过）；改动文件 `oxfmt --check` 通过。

未验证：没有在真实 Electron（agent-browser）中查看“自动审查中”的明暗主题与窄窗口外观，只有 Browser Mode 的可见性与文本断言。
