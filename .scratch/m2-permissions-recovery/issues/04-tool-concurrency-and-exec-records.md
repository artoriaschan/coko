# 04: 工具并发上限、effect 分区与执行记录

**What to build:** agent 调度：并发上限（`AgentRuntimeOptions.toolConcurrency`，默认 10）包住工具 execute；按 `effect` 分区——read 调用共享、side-effect 调用是独占屏障（等前面全部完成，后面等它完成）；side-effect 调用取得执行槽后、执行前提交 `tool_exec` 条目（幂等键 `<sessionId>:<toolCallId>`，经执行上下文交给工具），提交失败则不执行并以 commit_failed 结束 Run；abort 时排队中的调用返回 Operation aborted 且不提交 tool_exec。新建 agent README（工具契约：effect、permissionSubject、调度、执行记录、幂等键）。

**User stories:** 16, 23

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/tools/scheduler.ts`（新）、`packages/agent/src/tools/timeout.ts`、`packages/agent/src/engine/runtime.ts`、`packages/agent/src/engine/types.ts`、`packages/agent/src/session-entries/tools.ts`、`packages/agent/README.md`（新）、`tests/integration/sidecar-concurrency.test.ts`（新）

- [ ] agent 测试（deferred 控制，不用 sleep）：6 个 read 调用、上限 2 → 任意时刻至多 2 个在执行，结果按调用顺序提交
- [ ] agent 测试：`[read, read, write, read]` → write 在前两个 read 完成后才开始，最后一个 read 在 write 完成后才开始
- [ ] agent 测试：side-effect 调用的 `tool_exec` 在其 execute 开始前已提交；提交失败时 execute 未被调用、Run 以 commit_failed 结束；read 调用不提交 tool_exec
- [ ] agent 测试：排队中 abort → 未开始的调用返回 Operation aborted，没有 tool_exec
- [ ] 集成测试：bash 调用的条目序列中 `tool_exec` 位于 toolCall 所在 assistant 之后、toolResult 之前，幂等键为 `<sessionId>:<toolCallId>`
- [ ] agent README 建立并从 docs 导航或包索引可达；不修改 `packages/agent/src/index.ts`（需要的新导出写在 Comments 由 Lead 合并时处理）

## Comments
