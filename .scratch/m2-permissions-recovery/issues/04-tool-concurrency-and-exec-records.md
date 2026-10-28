# 04: 工具并发上限、effect 分区与执行记录

**What to build:** agent 调度：并发上限（`AgentRuntimeOptions.toolConcurrency`，默认 10）包住工具 execute；按 `effect` 分区——read 调用共享、side-effect 调用是独占屏障（等前面全部完成，后面等它完成）；side-effect 调用取得执行槽后、执行前提交 `tool_exec` 条目（幂等键 `<sessionId>:<toolCallId>`，经执行上下文交给工具），提交失败则不执行并以 commit_failed 结束 Run；abort 时排队中的调用返回 Operation aborted 且不提交 tool_exec。新建 agent README（工具契约：effect、permissionSubject、调度、执行记录、幂等键）。

**User stories:** 16, 23

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/tools/scheduler.ts`（新）、`packages/agent/src/tools/timeout.ts`、`packages/agent/src/engine/runtime.ts`、`packages/agent/src/engine/types.ts`、`packages/agent/src/session-entries/tools.ts`、`packages/agent/README.md`（新）、`tests/integration/sidecar-concurrency.test.ts`（新）

- [x] agent 测试（deferred 控制，不用 sleep）：6 个 read 调用、上限 2 → 任意时刻至多 2 个在执行，结果按调用顺序提交
- [x] agent 测试：`[read, read, write, read]` → write 在前两个 read 完成后才开始，最后一个 read 在 write 完成后才开始
- [x] agent 测试：side-effect 调用的 `tool_exec` 在其 execute 开始前已提交；提交失败时 execute 未被调用、Run 以 commit_failed 结束；read 调用不提交 tool_exec
- [x] agent 测试：排队中 abort → 未开始的调用返回 Operation aborted，没有 tool_exec
- [x] 集成测试：bash 调用的条目序列中 `tool_exec` 位于 toolCall 所在 assistant 之后、toolResult 之前，幂等键为 `<sessionId>:<toolCallId>`
- [x] agent README 建立并从 docs 导航或包索引可达；不修改 `packages/agent/src/index.ts`（需要的新导出写在 Comments 由 Lead 合并时处理）

## Comments

### 2026-10-29 实施者（分支 m2/04-tool-concurrency-and-exec-records）

**覆盖的验收（全部 6 项）**
- agent `packages/agent/src/tools/scheduler.test.ts`（7 例，deferred 控制，不用 sleep）：6 个 read、上限 2 → 至多 2 个同时执行、乱序放行后结果仍按调用顺序；默认上限 10；`[read, read, write, read]` 屏障顺序；tool_exec 在 execute 开始前已提交、执行上下文带幂等键、read 不提交；tool_exec 提交失败 → execute 未调用、同批其余调用不执行、Run commit_failed；排队中 abort → Operation aborted 且无 tool_exec；toolConcurrency 非正整数抛 RangeError。
- 集成 `tests/integration/sidecar-concurrency.test.ts`（1 例）：bash 的 tool_exec 位于 assistant 之后、toolResult 之前，幂等键 `<sessionId>:b1`，同批 ls 无 tool_exec，Sidecar 重启后详情读回一致。
- `packages/agent/README.md` 新建，从 `docs/README.md`"当前行为"可达；未改 `packages/agent/src/index.ts`。

**实现要点（供 05、06、08）**
- 调度器包住 execute（pi 的 beforeToolCall 仍串行，审批逐个出现）；FIFO，等待中的 side-effect 之后的 read 不越过它。超时在调度之内计时，排队不计时。
- 执行上下文 `ToolExecutionContext { idempotencyKey }` 作为 execute 的第五个参数（pi 签名兼容）。
- 记录提交后、执行前被 abort：不执行，toolResult 为 Operation aborted（此时已有 tool_exec；08 的 planRecovery 只看无 run_end 的 Run，不受影响）。
- 未声明 effect 的宿主工具按 side-effect 独占并提交 tool_exec。
- sessionId 缺省时运行时用随机 id（server 总是传入）。

**需要 Lead 合并时处理的导出**（`packages/agent/src/index.ts`，本票未改）：`ToolEffect`、`ToolExecutionContext`（tools/types.ts）、`DEFAULT_TOOL_CONCURRENCY`（tools/scheduler.ts）。`idempotencyKeyFor` 已经由 session-entries barrel 导出。

**越出 Write scope 的改动**（均为最小改动，请 Lead 裁决）
1. `packages/agent/src/tools/types.ts`：`CokoTool.execute` 增加可选的第五个参数与 `ToolExecutionContext` 类型（规格要求"幂等键经执行上下文交给工具"）。08 的写范围也包含此文件（probeOutcome），可能会有相邻改动。
2. `packages/agent/src/tools/scheduler.test.ts`（新）：调度的 agent 测试放在被测模块旁。
3. `packages/agent/src/engine/runtime.test.ts`：并行顺序用例的两个宿主工具声明 `effect: 'read'`（未声明的工具现在按 side-effect 独占执行，原用例会互相等待而超时）。
4. 新条目进入序列，三处精确序列断言加入 `tool_exec`：`packages/agent/src/policy/approvals.test.ts`（属于 03 的写范围，只改了一行）、`tests/integration/sidecar-approvals.test.ts`、`tests/integration/sidecar-session.test.ts`。
5. `tests/integration/secrets-gate.test.ts`：按须知为新输出通道追加驱动断言（bash env 的 tool_exec 条目）。
6. `docs/README.md`："当前行为"加一行 agent README 链接（验收要求可达）。

**实际运行的命令与结果**（worktree，`unset ELECTRON_RUN_AS_NODE`；`git merge main` 时 main 仍为 284ec2d，已是最新）
- `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run lint`（0 警告 0 错误）、`pnpm run format:check`、`pnpm run check:docs`（82 个文件 0 问题）：退出 0。
- `pnpm run test`：67 个文件，519 通过、1 跳过（真实模型），含 desktop E2E 6 个文件与产物 smoke。
- 负向确认：scheduler 测试在实现前 7 例全部失败；分别注入"无屏障"、"独占不阻止后续 read"、"不提交执行记录"、"排队不响应 abort" 四种变异，各有 1–4 例失败；变异已撤销。

**未验证**：真实模型（无密钥）；CI；非 darwin 平台。

**文档影响**：新建 `packages/agent/README.md`（工具契约、调度、执行记录、幂等键）；`docs/README.md` 加导航行。GLOSSARY、ADR 未改。
