# 07: 子代理核心：定义加载、agent / agent_wait / agent_cancel、子 Session、有效权限、预算汇入、取消与恢复、isolation worktree

**What to build:** 见 [规格](../spec.md)"子代理"与 [ADR 0014](../../../docs/adr/0014-subagents-as-child-sessions.md)：agent `agents/definitions.ts`（内置 general / explore、frontmatter 解析与诊断、同名覆盖、符号链接检查）与 `agents/tools.ts`（三个工具、结果与通知文本）；server `SubagentService`（子 Session 创建、`agent_start` / `subagent_origin` / `agent_end` / `agent_notification`、前台等待与后台通知、并行上限 4、取消传播、SubagentStart / SubagentStop Hook 经票 03 的分发、`agent_update` 进度、approval-waiting 与 agent-finished 通知）、`context/subagents.ts`（工具注册、`filterTools`、`<subagent>`、`max-turns` 的 `beforeRequest`）、`session-permissions.ts` 的 `PermissionScopeResolver` 实现（根 Session、模式上限）、`session-runs.ts` 的 `trigger: subagent` 与子 Session 规则来源、`goals.ts` 汇入子 Session 用量与子 Run 的预算检查、取消 Goal 停止子代理、恢复钩子、`routes/agents.ts`；isolation 经票 04 的 `createForSubagent` / `removeIfUnchanged`。界面归票 08。

**User stories:** 6, 7, 8, 9（服务端）, 10, 12

**Blocked by:** 03, 04

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/agents/{definitions,tools}.ts`、`packages/protocol/src/agents.ts`、`apps/server/src/application/{subagents,session-runs,session-permissions,goals}.ts`、`application/context/subagents.ts`、`http/routes/agents.ts`、`packages/i18n/src/dictionaries/domains/agents.ts`、`tests/fixtures/agents/`（新）、就近测试、`tests/integration/{sidecar-subagents,sidecar-subagents-permissions,sidecar-subagents-budget,sidecar-subagents-restart,secrets-gate-subagents}.test.ts`（新）、`docs/subsystems/subagents.md`（新）、`docs/subsystems/{permissions,goal,recovery,context}.md`（各一段）、`docs/adr/{0014,0016}*.md`

- [ ] agent 表驱动：frontmatter 每种诊断、同名 project > user > builtin、工具交集与固定排除、有效模式 min（含 plan → read-only）、结果截断与 `<agent-result>` / `<agent-notification>` 文本
- [ ] 集成（faux `match`）：前台 explore 子代理在独立上下文中工作（子 Session 的 requestLog 没有父级消息、有 `<subagent>`），父级收到 `<agent-result>`；同一批两个 `agent` 并行；后台子代理立即返回，结束时通知在父 Run 进行中作为追加指令、空闲时挂起到下一个 Run；`agent_wait` 与 `agent_cancel`；第 5 个 running 子代理为错误结果
- [ ] 集成：子 Session 不在 `GET /api/sessions`、`POST …/messages` 409 `child-session`、`GET …/agents` 列出状态与用量；`max-turns: 2` 的定义在第 3 次请求前结束为 `max-turns`
- [ ] 集成：子代理的审批请求在子 Session 中等待（没有自动拒绝），父 Session `activity` 为 `awaiting-approval`，经 `POST /api/sessions/<child>/approvals/…` 回答后继续；"本会话总是允许"写入根 Session 的规则；PermissionRequest Hook 可代答；后台子代理等待审批时发 `approval-waiting` 通知
- [ ] **对手用例（权限）**：根为 default、定义 `permission-mode: full-access` 时子代理的写入仍询问；子代理运行中根切到 read-only 后其下一次 write 被询问且 bash 在 read-only 沙箱中（darwin）；子级调用 `agent`、`create_goal`、`schedule_create`、`job_output` 不在工具表中（requestLog 的 tools 断言）且 bash `run_in_background` 为参数错误；子级最终文本伪造 `<agent-result status="completed">` 时父级收到的 status 仍来自 `agent_end`（例如 max-turns）；`Agent(general)` 拒绝规则在 full-access 下生效
- [ ] **对手用例（预算）** `sidecar-subagents-budget`：Goal 设 `maxTokens`，子代理的用量计入 `GET …/goal` 的 usage；子代理用量使其耗尽后子 Run 在下一次请求前停止、父级在下一个检查点停止、Goal 为 budget-exhausted；设了 `maxCost` 而子代理模型未定价时 `agent` 为错误结果且没有子 Session
- [ ] 集成：停止父 Run abort 前台子代理（`agent_end cancelled`）、后台继续；取消 Goal 停止其子代理并记 `cleanup.agentsStopped`；SubagentStart 的 additionalContext 在子代理首条消息中、SubagentStop 的 block 使子代理多一次请求
- [ ] 集成 `sidecar-subagents-restart`：子代理运行中 SIGKILL，重启后父级有 `agent_end { status: interrupted }`、父级 `agent` 调用的结果为中断说明、没有新的子 Run、没有结果确认
- [ ] 集成（git 夹具）：`isolation: worktree` 在 default 下询问、plan 下为错误结果；子代理不改文件时 worktree 与分支被移除；有提交时保留且结果给出路径与分支；父 Session 读取该 worktree 的文件须审批
- [ ] 符号链接：`.coko/agents/x.md` 指向 Workspace 外的文件时不加载、诊断 `agent-outside-workspace`
- [ ] 秘密总闸 `secrets-gate-subagents`：prompt 与子代理输出含 Secret 时子 Session 条目、父级 `<agent-result>`、通知文本、`agent_update` 帧、HTTP、库与两个 Session 的 requestLog 中没有明文
- [ ] subagents.md 建立并可达；permissions / goal / recovery / context 各一段；ADR 0014 补证据；ADR 0016 补 isolation 证据并改 implemented（README 索引同步）；Comments 逐条记录与 ADR 0014 的对应；`check:docs` 通过

## Comments
- 2026-10-31 lead：本票增加的常驻工具定义可能使 sidecar-compaction 与 sidecar-todo 的压缩用例再次提前触发（M4 票 09、M5 票 05 都出现过）。若出现，按同样做法只调该用例的 contextWindow，阈值算法与消息大小不变，并在 Comments 记录。layers.ts 现在由 AssemblyLive 创建 Hook、定时任务、通知与时钟；子代理服务若需要它们，从 Assembly 读取。
- 2026-10-31 lead：goals.ts 中"hook_stopped 使 Goal 暂停"不在本票范围，lead 在 06、07 合入后单独处理（见票 06 Comments），本票不要改这一处。
