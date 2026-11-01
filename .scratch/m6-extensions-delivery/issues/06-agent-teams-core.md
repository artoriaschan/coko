# 06: Agent Teams 核心：具名 teammate、send_message、任务板与 CAS 认领、三个 Hook、worktree、预算与重启、子代理继续对话

**What to build:** 见 [规格](../spec.md)"Agent Teams"与 [ADR 0018](../../../docs/adr/0018-agent-teams-in-root-session.md)：agent `agents/teams/`（名册派生、任务板状态机与 CAS、重叠警告、`<team>` section 文本、工具契约）；server `TeamService`（任务变更经 `KeyedMutex`、消息送达与排队、`team_update`）、`SubagentService` 的 teammate 分支（`agent { name }`、解散、空闲通知、继续对话）、`HookService` 的 TaskCreated / TaskCompleted / TeammateIdle 分发、`goals.ts` 按 `triggerRunId` 归属、`context/teams.ts`（工具注册与 `<team>`）、`routes/teams.ts`、layers.ts 的 teams 块。界面归票 13。

**User stories:** 4, 5, 6, 7, 8

**Blocked by:** 03

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/agents/teams/`、`packages/agent/src/goals/budget.ts`（triggerRunId 口径）、`packages/protocol/src/teams.ts`、`apps/server/src/application/{teams,subagents,subagent-notifications,subagent-recovery,goals}.ts`、`application/hooks.ts`（只追加三个事件的分发函数）、`application/context/teams.ts`、`http/routes/teams.ts`、`runtime/layers.ts` 的 teams 块、`packages/i18n/src/dictionaries/domains/teams.ts`、就近测试、`tests/integration/{sidecar-teams,sidecar-teams-tasks,sidecar-teams-hooks,sidecar-teams-budget,sidecar-teams-restart,secrets-gate-teams}.test.ts`（新）、`docs/subsystems/teams.md`（新）、`docs/subsystems/{subagents,hooks,recovery,context}.md`（各一段）、`docs/adr/{0014,0016,0018}*.md`

**跨票接口：** 写 03 定义的 `team_task` v1、`team_message` v1、`agent_start` v2（`name`、`teammate`、`triggerRunId`）、`agent_end` v2（`dismissed`）、`TeamSnapshot` 与 `team_update`；送达文本用 03 的 `teamMessageText`，不另写标签。票 13 只读取这些形状，不要改动字段。

- [x] agent 表驱动：认领的每个条件（owned、blocked、not-pending）、CAS 的 stale、teammate 指派他人为 not-owner、完成只能由 owner 或 lead、释放、删除后不可认领、blockedBy 环与引用不存在、100 项上限、writeScopes 重叠警告、名字校验
- [x] 集成：lead 以 `agent { name: 'reviewer' }` 创建 teammate（后台、`agent_start.name`）；teammate 结束后 lead 收到 `agent_notification`；lead `send_message { to: 'reviewer' }` → teammate 开始新 Run（`trigger: subagent`，输入为 `<team-message from="lead"`）；teammate 运行中收到消息为 steering；teammate 给 lead 发消息时 lead 空闲且无 Goal 则不唤醒、下一个 Run 送达；广播 `*`；第 9 个 teammate 为 `team-full`；同名为 `teammate-exists`
- [x] **宿主注入三处（M5 复盘）**：Goal Round 中送达的 `team_message` 不授予权限——消息正文为"create a goal …"或 `/goal resume` 时 `create_goal` / `update_goal` 为 not-authorized（runAuthority）；Run 结束时退回的 `<team-message` 文本不使 Goal 停住（hasUserSteering）；时间线（经 03 的 renderer 处理）不显示原文包装——以 chat-store 读回的条目断言
- [x] 集成 `sidecar-teams-tasks`（并发对手用例）：两个 teammate 用同一 `expected_revision` 认领同一任务，以 deferred 控制交叠——只有一个成功、另一个为 `stale-revision` 且带当前快照；前置未完成不能认领；`task_list` 的 ready 与警告
- [x] 集成 `sidecar-teams-hooks`：TaskCreated exit 2 → `task_create` 错误结果、无 `team_task` 条目；TaskCompleted exit 2 → 保持 in_progress、stderr 在结果中；TeammateIdle exit 2 → stderr 作为 user message 送达、teammate 多一次请求、第 4 次被忽略；三个事件的 stdin 字段（task_id、teammate_name、team_name）；未批准的项目 Hook 不运行
- [x] 集成（git 夹具）：`isolation: 'worktree'` 的 teammate 在自己的 worktree 中工作（bash `pwd -P`），解散且无改动时 worktree 与分支移除、有提交时保留；父 Session 写入该路径须审批（01 的 J4 规则）
- [x] **对手用例（预算）** `sidecar-teams-budget`：Goal 设 `maxTokens`，teammate 由 Goal Round 中的消息触发的 Run 计入该 Goal；用尽后 teammate 在下一次请求前停止、lead 在下一个检查点停止、Goal 为 budget-exhausted；没有 Goal 的 Run 触发的 teammate 用量不计入之后创建的 Goal
- [x] 集成 `sidecar-teams-restart`：teammate 运行中 SIGKILL，重启后名册中该成员为 idle（中断恢复照常）、可以再接收消息并开始新 Run；排队的消息不保留
- [x] 集成（子代理继续）：一次性子代理 completed 后 `send_message { to: <agentId> }` 开始新 Run，结束时父级收到 `agent_notification`；cancelled 的为 `agent-not-reachable`；解散后的 teammate 同样
- [x] 并发上限：根 Session 已有 4 个 running 时消息排队，有空位后开始（不是错误）
- [x] 秘密总闸 `secrets-gate-teams`：消息正文、任务描述、`<team>` section 含登记 Secret 时，各 Session 的 requestLog、条目、`team_update` 帧、HTTP、库中没有明文
- [x] teams.md 建立并可达；subagents / hooks / recovery / context 各一段；ADR 0018 补服务端证据（implemented 由 13 改），ADR 0014 与 0016 各加一行；Comments 逐条记录与 ADR 0018 的对应；`check:docs` 通过

## Comments

### 实施回执（2026-11-01，接续实施者）

**分支状态。** 接续时已有 4 个提交（任务板 / 名册 / 工具、run_start v4、goals 归属、server TeamService 与 teammate 分支与 Hook），验收都未勾选，集成测试与文档都没有。本次补齐全部集成测试、server 并发单测、文档，修了一个缺陷（见下），两次合入 main（4eafe2b 之后的票 04、10）。

**逐项覆盖：**

1. agent 表驱动：`packages/agent/src/agents/teams/teams.test.ts`（27 例，前任提交）——三种不可认领原因、stale、not-owner、完成者、释放、删除、环与引用、100 上限、重叠警告、名字。
2. 集成：`tests/integration/sidecar-teams.test.ts` 前 3 例——创建（`agent_start { name, teammate, triggerRunId }`、`<team name="reviewer">`）、空闲通知、lead 空闲不唤醒且下一个 Run 送达、`send_message` 唤醒（trigger subagent、triggerRunId 为 lead 的 Run 2、输入为 `<team-message from="lead"`）、运行中 steering（同一 Run）、teammate→空闲 lead 挂起、广播（同一 messageId 各一条）、`teammate-exists` / `team-full`。
3. 宿主注入三处：runAuthority——`sidecar-teams-budget.test.ts` 第 2 例（Goal Round 中 teammate 发来"create a goal … /goal resume"，`create_goal` 与 `update_goal pause` 为 not-authorized，Goal 不变）；hasUserSteering——`apps/server/src/application/goal-driver.test.ts` 的"只有团队消息"行（03 已加），Run 结束退回的团队消息由 `subagent-notifications.ts` 的 onRunEnd 重新挂起；时间线——`sidecar-teams.test.ts` 第 1 例用 renderer 的 `buildTimeline` 处理读回的子 Session 条目，`<team-message` 不在用户气泡中、有 team-message 行（用户自己输入的同样文本照常显示由 03 的 `timeline.test.ts` 对手用例覆盖）。
4. `sidecar-teams-tasks.test.ts`：两个 teammate 等同一闸门文件、以 revision 1 认领 t1，只有一个成功、另一个 stale-revision 带 revision 2 的快照；前置未完成为 `task-not-claimable (blocked)`；teammate 指派他人为 not-owner；task_list 的 ready 与警告与 GET …/team 一致。读取交叠的确定性用例：`apps/server/src/application/teams.test.ts`（第一次认领的读取停在 deferred 上）。
5. `sidecar-teams-hooks.test.ts`：TaskCreated exit 2 → 错误结果、无 team_task；TaskCompleted exit 2 → 保持 in_progress、stderr 在结果中；TeammateIdle exit 2 → 3 次 user message、第 4 次忽略、没有第 5 次请求；三个事件的 stdin 字段（含 teammate 发起时 `teammate_name: worker`）；未批准的项目 Hook 不运行。
6. worktree（git 夹具）：`sidecar-teams-restart.test.ts` 第 2 例——`pwd -P` 在自己的 worktree；Run 结束后保留；重启后解散：无改动的 worktree 与分支移除、有提交的保留并写在 `agent_end.worktree`；父 Session 写入保留的 worktree 询问（拒绝后文件不存在）。
7. 对手用例（预算）：`sidecar-teams-budget.test.ts` 第 1 例——没有 Goal 时触发的 5 000 token 不计入；Goal Round 中消息触发的 teammate Run 计入；teammate 第 3 次请求前停止，lead 的 Goal Round 以 budget_exhausted 结束，Goal 为 budget-exhausted；用量 ∈ [3 510, 5 000)。
8. 重启：`sidecar-teams-restart.test.ts` 第 1 例——4 个 busy teammate 的 bash 已开始时 SIGKILL：名册全为 idle、根有 agent_end interrupted、排队的消息不保留；空闲的 teammate 收到消息开始新 Run。
9. 子代理继续：`sidecar-teams.test.ts` 第 4 例——completed 的一次性子代理经重启后 `send_message { to: agentId }` 开始新 Run，结束时父级恰有一条 agent_notification；cancelled 与解散的 teammate 为 agent-not-reachable。
10. 并发上限：`sidecar-teams.test.ts` 第 5 例——4 个 running 时消息为 "Sent"、不开始 Run；放行一个后排队的消息开始新 Run。
11. 秘密总闸：`secrets-gate-teams.test.ts`——正文、summary、任务标题与描述、`<team>` 含登记 Secret；WS 帧、HTTP、requestLog（各 Session）、库与 stderr 无明文；前置断言确认各通道被驱动。
12. 文档：新建 `docs/subsystems/teams.md`；subagents（"团队与继续对话"一节，去掉"不能继续对话"限制）、hooks（"团队事件"一节，改开头一句）、recovery（"团队"一段）、context（`<team>` 与 `<team-message>` 一节）；ADR 0018 实施记录（implementation 改为 partial，implemented 留给 13）、0014 加后继一行、0016 加 teammate 复用一行；`docs/README.md` 当前行为一行、`docs/adr/README.md` 0018 行改 partial；`check:docs` 通过。

**发现并修复的缺陷（先红后绿）。** 重启时工具执行中被杀的 teammate 有未回答的结果确认；给它发消息时 `startRun` 抛 `confirmation-pending`，`#continue` 吞掉错误、给它提交 `agent_end failed`，`send_message` 却返回 "Sent"。现在 `deliverMessage` 用 `unansweredConfirmations` 先判断，返回 `agent-not-reachable`（不改变成员状态）；用户回答确认后照常继续。去掉检查时用例为红（"Sent to busy1"）。这是首次全量在负载下暴露的（单跑时 SIGKILL 恰好落在 bash 开始之前），用例现在先等 `tool_exec` 再杀进程，两条路径都确定。

**负向确认（变异，均先红后恢复）：** 去掉 `deliverMessage` 的并发上限判断 → 排队用例红；去掉 `#updateTask` 的 KeyedMutex → server 并发单测红（两个都成功）；`goalChildRuns` 不看 triggerRunId → 预算用例红；从 `HOST_NOTIFICATION_KINDS` 去掉 team_message → 授权用例红；消息正文不脱敏 → 秘密总闸红；去掉确认检查 → 重启用例红。

**实际运行的命令与结果：** 全量见下一段；单独运行：团队相关 10 个文件 44 例（合并 main 后，负载 126）全部通过；`pnpm run typecheck` 退出 0；`pnpm run check:docs` 211 个文件 0 问题；`scripts/browser-deps.test.ts`、`scripts/source-references.test.ts` 4 例通过；`pnpm install --frozen-lockfile` 退出 0。

**全量（锁内、后台，看退出码）：**
- 第 1 次（基线 4eafe2b，HEAD 718289b，负载 23–62）：test=1，330 文件 / 2 684 例，4 例失败。`apps/desktop/src/main/sidecar-process.test.ts` 3 例为默认 5 秒超时（实际 5.3–6.0 秒，没有断言失败，本分支未改该文件），单独重跑 11/11 通过；`sidecar-teams-restart` 1 例暴露上面的确认缺陷，c3e0ffb 修复。
- 第 2 次（c3e0ffb，负载 15–41）：test=1，330 文件，1 例失败。teammate worktree 用例用子串比较分支名，两个 worktree 名互为前缀时误判（测试缺陷），f0b828e 改为按行比较。
- 第 3 次：main 前进（票 04、10 合入），中途停掉。合并 main 为 8401f76（只有 `docs/adr/README.md` 冲突，0017 取 main 的 partial、0018 取本票的 partial），`pnpm install --frozen-lockfile` 0，typecheck 0，check:docs 211 文件 0 问题；团队 10 个文件 44 例在负载 126 时全部通过。
- 第 4 次（8401f76，负载 103–183）：test=1，只跑到 255/330 个文件，86 次 vitest worker 的 `spawn … EAGAIN`。失败的 15 个非 E2E 文件单独重跑：14 个通过，`sidecar-process.test.ts` 同一 5 秒超时签名，再单独跑 11/11 通过；`apps/desktop/e2e/goal.e2e.test.ts` 一次断言失败（phase 已是 budget-exhausted 时用量条仍读到 normal，这是该用例只读一次的时序问题），单独重跑 2/2 通过。
- 第 5 次（8401f76，负载 88–110）：test=1，339 文件 / 2 756 例，13 个文件 24 例失败。其中 8 个文件（goal-budget、plugins、recovery、schedules、session、ui dialog、model-catalog、thinking-levels）单独重跑全部通过。另外 5 个用 git 夹具的文件（`sidecar-worktrees`、`sidecar-subagents-isolation`、`sidecar-handoff`、`sidecar-m5-seams`、`sidecar-teams-restart`）单独重跑仍报 `spawn git EAGAIN`。

**环境阻塞（合并后没有拿到 test=0 的全量）：** 本用户进程数 2 605–2 648，上限 `kern.maxprocperuid` 为 2 666。其中 2 186 个是 `~/.git-ai/bin/git-ai bg run`（ppid 1，存活数十分钟到 22 小时，持续累积）：PATH 上的 `git` 是 `~/.git-ai/bin/git` → git-ai 的符号链接，每次 git 调用都可能留下一个守护进程。按 brief 不按名字终止它们。把 `/usr/bin` 放到 PATH 前面后重跑仍为 EAGAIN（进程表已满）。合并前，这 5 个文件在第 2 次全量中都通过（只有已修复的分支名用例失败）；合并后 teams-restart 在 13:44 的团队批次中通过。需要清理这些进程后，再跑一次全量确认 test=0。

**与 ADR 0018 的逐条对应：** 团队即根 Session——TeamService 从根 Session 条目派生名册与任务板，子 Session id 取根的快照（sidecar-teams 第 1 例）；teammate 沿用 ADR 0014——权限、审批、取消走 SubagentService 原路径，只多名字、消息与任务工具，teammate 中没有 agent；已结束子代理可继续（第 4 例）；任务板是根 Session 条目 + revision CAS、认领即独占、写入范围只警告（tasks 用例与 server 单测）；不做文件锁，隔离用 worktree（restart 第 2 例）；消息为宿主注入、无用户权限、不算追加指令（budget 第 2 例、goal-driver 单测）、lead 空闲不唤醒（sidecar-teams 第 1、2 例）；三个 Hook 的 exit 2 语义与只收紧（hooks 用例）；后果——并行上限时排队、排队消息不跨进程保留（第 5 例、restart 第 1 例）。细化：预算归属记在 `run_start.subagent.triggerRunId`，teammate 之间的消息沿用发送方当前 Run 的触发 Run。

**宿主注入的 TeammateIdle 反馈。** 它与 M5 的 SubagentStop 继续相同：经 onStop 的继续请求送达 teammate 子 Session，不是追加指令，所以不进 undeliveredSteering；子 Session 的 Run 为 trigger subagent，runAuthority 恒为 none，teammate 也没有 Goal 工具。它没有宿主标签包装（与 SubagentStop 相同），时间线中显示为用户气泡——是否需要专门的行留给票 13 判断。

**未验证：** 真实模型的 teammate 协作（未验证，需真实凭据，见规格人工验证清单）；非 darwin 平台。团队界面（票 13）。

**符号链接 / 读取根：** 不适用——团队不新增读取根；名册与任务板只读根 Session 的条目，`writeScopes` 只用于警告（规范化时拒绝绝对路径与 `..`），不参与读写判定。新增注入点 `<team>`、`<team-message>` 与空闲通知由 `secrets-gate-teams` 扫描 requestLog。

**越出 Write scope 的改动（请 Lead 合并时裁决）：**
- `packages/agent/src/agents/tools.ts`（前任）：`agent` 的 `name` 参数与 teammate 的启动文本。规格要求 `agent { name }`，Write scope 只列了 `agents/teams/`。
- `packages/agent/src/{engine/runtime.ts,engine/types.ts,session-entries/runs.ts,session-entries/session-entries.test.ts}`、`packages/protocol/src/runs.ts`（前任）：run_start v4 的 `subagent.triggerRunId`（v3 原样迁移）。这些属于"只有 03 改"；规格"Agent Teams · 消息 / 预算"要求 `run_start.subagent` 带 triggerRunId，但 03 没有声明。形状不在"跨票接口"表中，13 不读它，所以没有 BLOCKED。
- `apps/server/src/application/context/{index,types}.ts`、`application/session-runs.ts`（前任，也属"只有 03 改"）：SECTION_ORDER 加 `teams`、`RunRequest.subagent.triggerRunId` 与 launch 转交。
- `runtime/layers.ts` 只改了 teams 块。
- `docs/adr/README.md` 的 0018 一行（not-started → partial，与 ADR 的 implementation 同步）。
- `tests/integration/sidecar-teams.test.ts` 从 renderer 导入 `buildTimeline`（只读，跨包相对路径），以满足"以 chat-store 读回的条目断言时间线"。

**README 要点（交给 14）：** agent README——`@coko/agent` 导出 `agents/teams` 的名册、任务板与四个工具，`goalChildRuns`；server README——TeamService、`GET /api/sessions/:id/team`、`team_update`、send_message 的排队与 `agent-not-reachable`（含等待结果确认的目标）。

**导航行（已在本分支加入，合并时核对）：** `docs/README.md` 当前行为的"Agent Teams"一行。

- 2026-11-01 lead：暂不合入。实施者报告 BLOCKED（21e49c7）：本用户进程数约 2640，上限 2666（kern.maxprocperuid），其中约 2190 个是 `~/.git-ai/bin/git-ai bg run`（父进程为 launchd，不是本项目启动的）。14:48 lead 在本分支上单独运行 5 个 git 夹具文件，仍然失败（spawn EAGAIN），其中包括本票自己的 `sidecar-teams-restart`。这些进程不是 Coko 或测试启动的，lead 不按名字结束它们，交由用户处理。处理后：本分支先 `git merge main`（main 之后又合入了 07），再单独运行这 5 个文件，然后在锁内跑一次全量，之后合入。越出写范围的改动（`agents/tools.ts`；run_start v4 的 `subagent.triggerRunId` 涉及 03 独有的文件；`docs/adr/README.md`；只读导入 `buildTimeline`）在合入时裁决。

### Lead 合入（2026-11-01）

- 阻塞解除：进程表耗尽的原因是测试本身。git 夹具每次设新的临时 HOME，PATH 上的 git 是 git-ai 包装，每个 HOME 留下一个后台进程。用户同意后 lead 结束了 2250 个残留，并以 m6/fix-git-ai-leak（295cb69）修复：根 vitest.config.ts 在 worker 启动前把 git 包装目录移出 PATH。
- 裁决：越出写范围的改动全部接受。
  - `run_start` v4 的 `subagent.triggerRunId`（`protocol/src/runs.ts`、`session-entries/runs.ts` 的 v3 → v4 原样迁移、`engine/{types,runtime}.ts`、`context/types.ts`、`session-runs.ts`）：规格要求 Goal 预算按触发 Run 归属，03 没有声明这个字段。改动只增加可选字段，旧条目原样迁移。票 13 读取的 `agent_start` / `agent_end` / `team_*` 形状没有改。
  - `agents/tools.ts` 的 `name` 参数（带 name 时必为后台）。
  - `docs/adr/README.md` 的 0018 一行（partial）。
  - `sidecar-teams.test.ts` 只读导入 renderer 的 `buildTimeline`。
- 合并 main（0b388bd，只有本票文件末尾的 lead 记录与回执冲突，两边都保留）后，lead 在分支上复核（负载最高 57，git-ai 后台进程始终 1 个）：`pnpm install --frozen-lockfile`、`typecheck`、`lint`、`format:check`、`check:docs` 退出 0；锁内全量 `test=0`，357 个文件、2876 例通过、4 例跳过，没有 EAGAIN。
- 以 9b186cf 合入 main，树与复核过的分支相同，`typecheck` 退出 0。
- 留给票 14：实施者回执中的 agent / server README 要点。

Closed: true
