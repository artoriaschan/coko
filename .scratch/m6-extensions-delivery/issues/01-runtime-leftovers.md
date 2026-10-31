# 01: 运行时遗留：M5 评审的 J3 / J4 / J8 / J9、H4 / H5 / H8、T3 / T4、S2–S7 / S10、worktree 上下文用量与回退边界

**What to build:** 见 [规格](../spec.md)"预构建：运行时遗留"。收敛 M5 评审未处理的服务端项，为 03 的 seam 与 06 的团队实现腾出干净的子代理与 Hook 服务：Notification Hook 先于设置（J3）、父 Session 写入 isolation worktree 须审批（J4）、`COKO_PROJECT_DIR` 与 UserPromptSubmit 原文的文档与用例（J8、J9）、worktree 移除的 TOCTOU（H4）、项目 PermissionRequest allow 的 outcome（H5）、Subagent Hook 解释移入 HookService（H8）、Hook 并行的 barrier 与共享轮询（T3、T4）、模式宽窄序、固定排除集、worktree 名错误、条目类型化读取、ScheduleRepository.get、SubagentService 拆分、PreCompact 阻止改为 `hook_blocked`（S2–S7、S10）、worktree 会话的上下文用量（ContextService 用 SessionCwd）、worktree 子目录 Workspace 的回退边界用例。

**User stories:** 20

**Blocked by:** —（与 02 并行）

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/`（除 `engine/` 外的 `agents/`、`policy/`、`session-entries/agents.ts`、`extensions/hooks/`、`goals/`、`tasks/schedules/`，`protocol` 侧对应的 `runs.ts` 错误码联合）、`packages/protocol/src/`（只为 `hook_blocked` 与 `hook_run.outcome: ignored`）、`packages/session/src/`（`ScheduleRepository.get`）、`packages/i18n/src/dictionaries/domains/{hooks,agents,worktrees}.ts`、`apps/server/src/`（`application/{notifications,subagents,subagent-notifications（新）,subagent-recovery（新）,hooks,worktrees,schedules,permissions,session-permissions,context-service,checkpoints}.ts`、`application/context/`、`engine` 之外的 `adapters/`、`runtime/layers.ts`（拆分后的装配）、就近测试）、`packages/agent/src/engine/{errors,compaction-driver}.ts`（只为 `hook_blocked`）、`tests/integration/`（`sidecar-harness.ts` 的 `pollUntil` 与现有用例的调整、新用例）、`tests/fixtures/hooks/`（barrier 参数）、`docs/subsystems/{hooks,subagents,worktrees,schedules,context}.md`、`packages/agent/README.md`、`apps/server/README.md`

**跨票接口（与 02 定死）：** 本票给 `RunError.code`（protocol 与 agent 两处联合）增加字面量 `hook_blocked`，PreCompact 的手动阻止仍返回 400 `hook-blocked`、自动压缩被阻止时跳过、`continue: false` 仍为 `hook_stopped`；renderer 不需要改动（时间线照常显示 `error.message`），本票不改 `apps/desktop/`。`chat-store.subscribeSession` 的 release 与 main 的通知模块由 02 负责，本票不碰。

- [x] 现有测试只改导入、期望值或 kind 列表即通过（逐条写进 Comments）；行为变化只有 J3、J4、H4、H5、S10，各有先红用例
- [x] **J3** 通知设置总开关关闭时 Notification Hook 仍运行（Hook 夹具记录的 stdin 有该通知），控制通道没有 `notify`；hooks.md 写明
- [x] **J4** 子代理以 isolation worktree 结束并保留后，父 Session 在 full-access 下对该路径的 write / edit 产生 approval_request（先红）；read 仍询问；subagents.md 写明 bash 不受这些规则保护
- [x] **J8 / J9** worktree 会话中 Hook 的 `COKO_PROJECT_DIR` 为该会话的工作目录；`/<skill> 参数` 提交时 UserPromptSubmit 的 `prompt` 为原文、不含 SKILL.md 正文；hooks.md 改写两处
- [x] **H4** 对手用例（并发）：用 deferred 让移除停在 busy 检查之后、git 之前，此时 `POST …/messages` 为 409 `worktree-busy`，没有 run_start（先红）；git 失败时撤销登记、会话可再提交
- [x] **H5** 项目 Hook 的 PermissionRequest allow：`hook_run.outcome` 为 `ignored`，审批卡照常出现
- [x] **H8** SubagentStart 的 additionalContext 中凭据形态的文本被 `redactText` 替换（先红）；`SubagentService` 不再解释 Hook 输出；上限常量只有一份
- [x] **T3 / T4** 两个并行 Hook 以 barrier 夹具证明并行（串行时该用例超时失败——变异确认），不再有墙钟上限断言；五处手写轮询改用 `pollUntil`
- [x] **S2–S7、S10** 宽窄序与 `narrowerMode` 只一份、固定排除集一份、`invalidWorktreeNameError()`、`agentStarts` / `agentEnds` 替换全部裸断言、`ScheduleRepository.get` 契约测试（SQLite 与内存）、`SubagentService` 拆为三个文件（每个 ≤ 450 行）、PreCompact 手动阻止的 Run 以 `hook_blocked` 结束（先红）且 Goal 不因此暂停
- [x] worktree 会话的 `GET /api/sessions/:id/context` 的指令分项来自 worktree 的 AGENTS.md（先红）；worktrees.md 删除该已知限制
- [x] 回退边界：Workspace 为仓库子目录时，worktree 会话中 write 之后回退代码，文件内容恢复（集成，先红前读确认此前已修）；越出该目录的路径不被恢复
- [x] 秘密总闸全部通过；`check:docs` 通过

## Comments
- 2026-10-31 lead：**裁决（回退边界）。** 本票验收中"越出该目录的路径不被恢复"与 ADR 0006（第 43 行：Workspace 即会话工作目录之外或受保护的路径列入 outside，照常处理，确认对话框单独列出并显式警告）冲突。以 ADR 为准，不改 ADR 0006 与 rewind.ts：该验收项改读为"worktree 子目录会话中，目录内的路径按会话工作目录恢复，越出该目录的路径列入 outside（照常处理并单独警告）"。实施者按 ADR 写的用例即满足本项，请勾选并在完成报告中照常写 MERGE-READY，不因此报告 BLOCKED。验收原文的写法是 M6 规划的错误，记入 M6 复盘。
- 2026-10-31 实施者（m6/01-runtime-leftovers）：
  - **覆盖。** J3 `sidecar-hooks-lifecycle`"通知总开关关闭时 Notification Hook 仍运行"（先红：Hook 记录超时）。J4 `sidecar-subagents-isolation`"有提交时保留 worktree……读取与写入"：重启后父 Session（full-access）的 read、write、edit 各出 approval_request（先红：write 无审批直接 file_backup）；规则为 `Read(<path>)` 与 `Edit(<path>)`，Edit 规则组覆盖 write 与 edit，权限中没有单独的 Write 规则组。J8/J9 `sidecar-worktrees`"worktree 会话的作用域"：`COKO_PROJECT_DIR` 等于 worktree 路径，`/demo do it` 的 stdin prompt 为原文（请求中有 SKILL 正文，stdin 没有）。H4 `worktrees.test.ts`"移除与并发开始的 Run"：git port 的 deferred 让移除停在 busy 检查之后、git 之前，此时 `SessionCwd.resolve`（startRun 与 submit 在 run_start 之前都经它）为 409 `worktree-busy`（先红）；git 失败时撤销登记、工作目录照常解析。测在服务层，因为真实 Sidecar 中没有可以注入 deferred 的接缝；登记放在 busy 检查之前，消除检查与登记之间的窗口。H5 `sidecar-hooks` 新用例（先红：outcome allowed）。H8 `sidecar-subagents-cancel`：additionalContext 中的 `sk-…` 被替换且不进 faux requestLog（先红）。T3 barrier（`hook.mjs --start/--await`）；变异：`HookService.run` 改为串行后用例失败（`['blocked','timeout']`），已恢复。S6 契约用例（SQLite 与内存，先红：get is not a function）。S10 `m5-seams` 期望改为 `hook_blocked`（先红），`goals-wake` 增加 hook_blocked 不暂停 / hook_stopped 暂停两例。上下文用量：`sidecar-worktrees` 作用域用例（先红：改回旧 ContextService 后指令路径为主 checkout）。回退边界：按上面的裁决断言，目录内 a.txt 恢复，越界的 OUT.txt 列入 outside（照常删除）；修改前读过 `checkpoints.ts`，已按 SessionCwd 取边界（M5 已修），所以不需要实现改动。
  - **现有测试的改动。** `sidecar-hooks` 并行用例（墙钟上限 → barrier）与超时用例（去掉上限断言），项目 allow 期望 `allowed` → `ignored`；`hook-runner.test` 去掉上限断言；`m5-seams` 的 `hook_stopped` → `hook_blocked`；`permission-scope.test` 的 `capMode` → `narrowerMode`（同一张表）；`subagents-cancel` 的 startOut 加凭据形态文本；五处手写轮询换成 `pollUntil`（`sidecar-hooks`、`secrets-gate-notifications`、`sidecar-schedules`、`sidecar-m5-seams`、`sidecar-handoff`）。
  - **S7。** `subagents.ts` 445 行、`subagent-notifications.ts` 218 行、`subagent-recovery.ts` 349 行。recovery 模块同时负责 `subagent_origin` / `agent_start` / `agent_end` 的写入与快照、isolation 询问规则的登记，也就是恢复时读回的那些记录。
  - **越出 Write scope 的最小改动。** `packages/agent/src/session-entries/hooks.ts`（outcome 联合加 `ignored`，须与 protocol 一致）；`packages/agent/src/engine/types.ts`（`RunErrorCode` 联合在这里，不在 errors.ts）；`packages/agent/src/agents/{definitions,index}.ts`（`narrowerMode`、`isSubagentExcludedTool`）；`apps/server/src/application/{goals,handoff}.ts`（S5 的 `childSessionIds` 与 S4）；`packages/agent/src/engine/m5-seams.test.ts`、`apps/server/src/application/goals-wake.test.ts`。另外 H5 把 PreToolUse 的项目 allow 也记为 `ignored`：两类事件是同一种被忽略的放行，现有用例本来就断言了"Ignored"文本。
  - **秘密总闸。** 本票没有新增输出通道，SubagentStart 文本已在现有 requestLog 中扫描。没有新增读取根与注入点，所以不需要符号链接用例。
  - **文档。** hooks.md、subagents.md、worktrees.md、两份 README；`check:docs` 0 个问题。导航行与 TECH_STACK 不变。
  - **验证（merge main 8673d55 之后）。** `pnpm run typecheck` 0、`pnpm run lint` 0（0 warnings、0 errors）、`pnpm run format:check` 0、`pnpm run check:docs` 0（207 个文件，0 个问题）；在 /tmp/coko-full-test.lock 内运行 `pnpm run test`：test=0，315 个文件，2573 passed、1 skipped（2574），其中含全部 `secrets-gate*`。没有需要真实凭据的项。
