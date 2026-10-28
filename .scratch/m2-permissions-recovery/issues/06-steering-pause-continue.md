# 06: 追加指令、暂停与继续

**What to build:** agent 运行控制：`steer(text)`（pi steer，当前工具批次结束后注入，送达时提交 user message）、`pause()`（finishTurn 返回 end，当前批次完成、不发新请求、pending 审批 cancelled，Run 以 paused 结束）、`continue()`（新 Run，`run_start { trigger: continue }`；上一 Run 须为 paused 或 interrupted 且无待确认）、abort 退回未送达追加指令（`run_end.undeliveredSteering`）。server：`POST …/steer`（无 Run 409 `no-active-run`）、`POST …/pause`、`POST …/continue`（409 `nothing-to-continue`），activity 的 paused。renderer：Run 中 composer 可输入、Enter 发送追加指令并显示待送达，停止与暂停并列，paused 横幅带"继续"，停止后未送达文本回到输入区。

**User stories:** 17, 18, 19

**Blocked by:** 05

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/engine/`、`packages/agent/src/session-entries/runs.ts`、`packages/agent/README.md`、`packages/protocol/src/runs.ts`、`apps/server/src/application/sessions.ts`、`apps/server/src/http/app.ts`、`apps/server/README.md`、`apps/desktop/src/renderer/features/conversation/`、`apps/desktop/src/renderer/features/sidebar/`、`apps/desktop/src/renderer/stores/`、`packages/ui/src/composer/`、`packages/i18n/src/dictionaries/`、`apps/desktop/e2e/run-control.e2e.test.ts`（新）、`tests/integration/sidecar-run-control.test.ts`（新）

- [ ] 集成测试：bash `sleep` 执行中 steer → 该 user message 条目位于这次 toolResult 之后、下一条 assistant 之前；faux 收到的下一次请求上下文含该文本
- [ ] 集成测试：steer 后立刻 abort（未送达）→ run_end 带 `undeliveredSteering`，没有对应 user message 条目
- [ ] 集成测试：工具执行中 pause → 工具完成且 toolResult 提交，之后没有新的模型请求，run_end paused，activity paused；continue → 新 run_start（trigger continue）并发起模型请求
- [ ] 集成测试：上一 Run completed 时 continue → 409 nothing-to-continue；无 Run 时 steer → 409 no-active-run
- [ ] 集成测试：等待审批时 pause → 请求 cancelled、调用未执行、run_end paused
- [ ] Electron E2E：Run 中输入并回车 → 待送达气泡随后变为普通消息；暂停 → 横幅出现，点继续 → Run 继续到完成；停止后未送达文本回到输入区
- [ ] Browser Mode：Run 进行中 composer 可输入、Enter 调用 steer 而非 submit；IME 组合中不提交
- [ ] agent 与 server README 同步

## Comments
