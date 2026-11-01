# 06: Agent Teams 核心：具名 teammate、send_message、任务板与 CAS 认领、三个 Hook、worktree、预算与重启、子代理继续对话

**What to build:** 见 [规格](../spec.md)"Agent Teams"与 [ADR 0018](../../../docs/adr/0018-agent-teams-in-root-session.md)：agent `agents/teams/`（名册派生、任务板状态机与 CAS、重叠警告、`<team>` section 文本、工具契约）；server `TeamService`（任务变更经 `KeyedMutex`、消息送达与排队、`team_update`）、`SubagentService` 的 teammate 分支（`agent { name }`、解散、空闲通知、继续对话）、`HookService` 的 TaskCreated / TaskCompleted / TeammateIdle 分发、`goals.ts` 按 `triggerRunId` 归属、`context/teams.ts`（工具注册与 `<team>`）、`routes/teams.ts`、layers.ts 的 teams 块。界面归票 13。

**User stories:** 4, 5, 6, 7, 8

**Blocked by:** 03

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/agents/teams/`、`packages/agent/src/goals/budget.ts`（triggerRunId 口径）、`packages/protocol/src/teams.ts`、`apps/server/src/application/{teams,subagents,subagent-notifications,subagent-recovery,goals}.ts`、`application/hooks.ts`（只追加三个事件的分发函数）、`application/context/teams.ts`、`http/routes/teams.ts`、`runtime/layers.ts` 的 teams 块、`packages/i18n/src/dictionaries/domains/teams.ts`、就近测试、`tests/integration/{sidecar-teams,sidecar-teams-tasks,sidecar-teams-hooks,sidecar-teams-budget,sidecar-teams-restart,secrets-gate-teams}.test.ts`（新）、`docs/subsystems/teams.md`（新）、`docs/subsystems/{subagents,hooks,recovery,context}.md`（各一段）、`docs/adr/{0014,0016,0018}*.md`

**跨票接口：** 写 03 定义的 `team_task` v1、`team_message` v1、`agent_start` v2（`name`、`teammate`、`triggerRunId`）、`agent_end` v2（`dismissed`）、`TeamSnapshot` 与 `team_update`；送达文本用 03 的 `teamMessageText`，不另写标签。票 13 只读取这些形状，不要改动字段。

- [ ] agent 表驱动：认领的每个条件（owned、blocked、not-pending）、CAS 的 stale、teammate 指派他人为 not-owner、完成只能由 owner 或 lead、释放、删除后不可认领、blockedBy 环与引用不存在、100 项上限、writeScopes 重叠警告、名字校验
- [ ] 集成：lead 以 `agent { name: 'reviewer' }` 创建 teammate（后台、`agent_start.name`）；teammate 结束后 lead 收到 `agent_notification`；lead `send_message { to: 'reviewer' }` → teammate 开始新 Run（`trigger: subagent`，输入为 `<team-message from="lead"`）；teammate 运行中收到消息为 steering；teammate 给 lead 发消息时 lead 空闲且无 Goal 则不唤醒、下一个 Run 送达；广播 `*`；第 9 个 teammate 为 `team-full`；同名为 `teammate-exists`
- [ ] **宿主注入三处（M5 复盘）**：Goal Round 中送达的 `team_message` 不授予权限——消息正文为"create a goal …"或 `/goal resume` 时 `create_goal` / `update_goal` 为 not-authorized（runAuthority）；Run 结束时退回的 `<team-message` 文本不使 Goal 停住（hasUserSteering）；时间线（经 03 的 renderer 处理）不显示原文包装——以 chat-store 读回的条目断言
- [ ] 集成 `sidecar-teams-tasks`（并发对手用例）：两个 teammate 用同一 `expected_revision` 认领同一任务，以 deferred 控制交叠——只有一个成功、另一个为 `stale-revision` 且带当前快照；前置未完成不能认领；`task_list` 的 ready 与警告
- [ ] 集成 `sidecar-teams-hooks`：TaskCreated exit 2 → `task_create` 错误结果、无 `team_task` 条目；TaskCompleted exit 2 → 保持 in_progress、stderr 在结果中；TeammateIdle exit 2 → stderr 作为 user message 送达、teammate 多一次请求、第 4 次被忽略；三个事件的 stdin 字段（task_id、teammate_name、team_name）；未批准的项目 Hook 不运行
- [ ] 集成（git 夹具）：`isolation: 'worktree'` 的 teammate 在自己的 worktree 中工作（bash `pwd -P`），解散且无改动时 worktree 与分支移除、有提交时保留；父 Session 写入该路径须审批（01 的 J4 规则）
- [ ] **对手用例（预算）** `sidecar-teams-budget`：Goal 设 `maxTokens`，teammate 由 Goal Round 中的消息触发的 Run 计入该 Goal；用尽后 teammate 在下一次请求前停止、lead 在下一个检查点停止、Goal 为 budget-exhausted；没有 Goal 的 Run 触发的 teammate 用量不计入之后创建的 Goal
- [ ] 集成 `sidecar-teams-restart`：teammate 运行中 SIGKILL，重启后名册中该成员为 idle（中断恢复照常）、可以再接收消息并开始新 Run；排队的消息不保留
- [ ] 集成（子代理继续）：一次性子代理 completed 后 `send_message { to: <agentId> }` 开始新 Run，结束时父级收到 `agent_notification`；cancelled 的为 `agent-not-reachable`；解散后的 teammate 同样
- [ ] 并发上限：根 Session 已有 4 个 running 时消息排队，有空位后开始（不是错误）
- [ ] 秘密总闸 `secrets-gate-teams`：消息正文、任务描述、`<team>` section 含登记 Secret 时，各 Session 的 requestLog、条目、`team_update` 帧、HTTP、库中没有明文
- [ ] teams.md 建立并可达；subagents / hooks / recovery / context 各一段；ADR 0018 补服务端证据（implemented 由 13 改），ADR 0014 与 0016 各加一行；Comments 逐条记录与 ADR 0018 的对应；`check:docs` 通过

## Comments

- 2026-11-01 lead：暂不合入。实施者报告 BLOCKED（21e49c7）：本用户进程数约 2640，上限 2666（kern.maxprocperuid），其中约 2190 个是 `~/.git-ai/bin/git-ai bg run`（父进程为 launchd，不是本项目启动的）。14:48 lead 在本分支上单独运行 5 个 git 夹具文件，仍然失败（spawn EAGAIN），其中包括本票自己的 `sidecar-teams-restart`。这些进程不是 Coko 或测试启动的，lead 不按名字结束它们，交由用户处理。处理后：本分支先 `git merge main`（main 之后又合入了 07），再单独运行这 5 个文件，然后在锁内跑一次全量，之后合入。越出写范围的改动（`agents/tools.ts`；run_start v4 的 `subagent.triggerRunId` 涉及 03 独有的文件；`docs/adr/README.md`；只读导入 `buildTimeline`）在合入时裁决。
