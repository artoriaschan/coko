# 01: 运行时遗留：M5 评审的 J3 / J4 / J8 / J9、H4 / H5 / H8、T3 / T4、S2–S7 / S10、worktree 上下文用量与回退边界

**What to build:** 见 [规格](../spec.md)"预构建：运行时遗留"。收敛 M5 评审未处理的服务端项，为 03 的 seam 与 06 的团队实现腾出干净的子代理与 Hook 服务：Notification Hook 先于设置（J3）、父 Session 写入 isolation worktree 须审批（J4）、`COKO_PROJECT_DIR` 与 UserPromptSubmit 原文的文档与用例（J8、J9）、worktree 移除的 TOCTOU（H4）、项目 PermissionRequest allow 的 outcome（H5）、Subagent Hook 解释移入 HookService（H8）、Hook 并行的 barrier 与共享轮询（T3、T4）、模式宽窄序、固定排除集、worktree 名错误、条目类型化读取、ScheduleRepository.get、SubagentService 拆分、PreCompact 阻止改为 `hook_blocked`（S2–S7、S10）、worktree 会话的上下文用量（ContextService 用 SessionCwd）、worktree 子目录 Workspace 的回退边界用例。

**User stories:** 20

**Blocked by:** —（与 02 并行）

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/`（除 `engine/` 外的 `agents/`、`policy/`、`session-entries/agents.ts`、`extensions/hooks/`、`goals/`、`tasks/schedules/`，`protocol` 侧对应的 `runs.ts` 错误码联合）、`packages/protocol/src/`（只为 `hook_blocked` 与 `hook_run.outcome: ignored`）、`packages/session/src/`（`ScheduleRepository.get`）、`packages/i18n/src/dictionaries/domains/{hooks,agents,worktrees}.ts`、`apps/server/src/`（`application/{notifications,subagents,subagent-notifications（新）,subagent-recovery（新）,hooks,worktrees,schedules,permissions,session-permissions,context-service,checkpoints}.ts`、`application/context/`、`engine` 之外的 `adapters/`、`runtime/layers.ts`（拆分后的装配）、就近测试）、`packages/agent/src/engine/{errors,compaction-driver}.ts`（只为 `hook_blocked`）、`tests/integration/`（`sidecar-harness.ts` 的 `pollUntil` 与现有用例的调整、新用例）、`tests/fixtures/hooks/`（barrier 参数）、`docs/subsystems/{hooks,subagents,worktrees,schedules,context}.md`、`packages/agent/README.md`、`apps/server/README.md`

**跨票接口（与 02 定死）：** 本票给 `RunError.code`（protocol 与 agent 两处联合）增加字面量 `hook_blocked`，PreCompact 的手动阻止仍返回 400 `hook-blocked`、自动压缩被阻止时跳过、`continue: false` 仍为 `hook_stopped`；renderer 不需要改动（时间线照常显示 `error.message`），本票不改 `apps/desktop/`。`chat-store.subscribeSession` 的 release 与 main 的通知模块由 02 负责，本票不碰。

- [ ] 现有测试只改导入、期望值或 kind 列表即通过（逐条写进 Comments）；行为变化只有 J3、J4、H4、H5、S10，各有先红用例
- [ ] **J3** 通知设置总开关关闭时 Notification Hook 仍运行（Hook 夹具记录的 stdin 有该通知），控制通道没有 `notify`；hooks.md 写明
- [ ] **J4** 子代理以 isolation worktree 结束并保留后，父 Session 在 full-access 下对该路径的 write / edit 产生 approval_request（先红）；read 仍询问；subagents.md 写明 bash 不受这些规则保护
- [ ] **J8 / J9** worktree 会话中 Hook 的 `COKO_PROJECT_DIR` 为该会话的工作目录；`/<skill> 参数` 提交时 UserPromptSubmit 的 `prompt` 为原文、不含 SKILL.md 正文；hooks.md 改写两处
- [ ] **H4** 对手用例（并发）：用 deferred 让移除停在 busy 检查之后、git 之前，此时 `POST …/messages` 为 409 `worktree-busy`，没有 run_start（先红）；git 失败时撤销登记、会话可再提交
- [ ] **H5** 项目 Hook 的 PermissionRequest allow：`hook_run.outcome` 为 `ignored`，审批卡照常出现
- [ ] **H8** SubagentStart 的 additionalContext 中凭据形态的文本被 `redactText` 替换（先红）；`SubagentService` 不再解释 Hook 输出；上限常量只有一份
- [ ] **T3 / T4** 两个并行 Hook 以 barrier 夹具证明并行（串行时该用例超时失败——变异确认），不再有墙钟上限断言；五处手写轮询改用 `pollUntil`
- [ ] **S2–S7、S10** 宽窄序与 `narrowerMode` 只一份、固定排除集一份、`invalidWorktreeNameError()`、`agentStarts` / `agentEnds` 替换全部裸断言、`ScheduleRepository.get` 契约测试（SQLite 与内存）、`SubagentService` 拆为三个文件（每个 ≤ 450 行）、PreCompact 手动阻止的 Run 以 `hook_blocked` 结束（先红）且 Goal 不因此暂停
- [ ] worktree 会话的 `GET /api/sessions/:id/context` 的指令分项来自 worktree 的 AGENTS.md（先红）；worktrees.md 删除该已知限制
- [ ] 回退边界：Workspace 为仓库子目录时，worktree 会话中 write 之后回退代码，文件内容恢复（集成，先红前读确认此前已修）；越出该目录的路径不被恢复
- [ ] 秘密总闸全部通过；`check:docs` 通过

## Comments
- 2026-10-31 lead：**裁决（回退边界）。** 本票验收中"越出该目录的路径不被恢复"与 ADR 0006（第 43 行：Workspace 即会话工作目录之外或受保护的路径列入 outside，照常处理，确认对话框单独列出并显式警告）冲突。以 ADR 为准，不改 ADR 0006 与 rewind.ts：该验收项改读为"worktree 子目录会话中，目录内的路径按会话工作目录恢复，越出该目录的路径列入 outside（照常处理并单独警告）"。实施者按 ADR 写的用例即满足本项，请勾选并在完成报告中照常写 MERGE-READY，不因此报告 BLOCKED。验收原文的写法是 M6 规划的错误，记入 M6 复盘。
