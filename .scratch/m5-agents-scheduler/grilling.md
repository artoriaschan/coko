# M5 多代理与调度：设计树与采纳记录

Map: [Coko 桌面应用](../desktop-app/map.md) · [里程碑划分](../desktop-app/issues/06-grill-milestone-route.md) · [能力深度](../desktop-app/issues/09-grill-capability-depth.md) · 规格：[spec.md](spec.md)

2026-10-31，planner。用户于 2026-10-31 指示"继续 M5"。按用户常设指示（2026-10-28 goal：讨论问题直接采用推荐答案，优先沿用参考项目决策；packages/agent 参考 pi coding-agent v1.4.0 与 claude-code，apps/desktop 的 UI 参考 deepseek-harness），本文每个问题都由 Agent 给出推荐并**按常设指示采纳**，不是用户逐条确认。参考材料：[claude-code 研究](../desktop-app/research/claude-code-agent-logic.md) §1（判定流水线）、§2（Hooks）、§5（Subagents）、§13（Fork / Resume）；[DSH 研究](../desktop-app/research/dsh-desktop-architecture.md)；[pi 研究](../desktop-app/research/pi-agent-core-and-coding-agent.md)；[M4 复盘](../m4-goal-plan-tasks/retro.md) 与 [M4 Standards 评审](../m4-goal-plan-tasks/review-standards.md) 的 B 类坏味道。

## 已核对的事实

- **Hooks 现状。** `packages/agent/src/extensions/hooks.ts` 只有进程内的 `ToolHooks { beforeToolCall, afterToolCall }` 与顺序组合（第一个 block 生效）；没有外部 Hook、事件表、配置或聚合。server 的链序为 权限 gate → `admissionHooks`（预算）→ 扩展（checkpoint）→ 贡献 hooks → `secretRedactionHook`（`session-runs.ts`）。设置注册表已有 `hooks` 与 `plugins` 两个 `available: false` 的分区（`features/settings/sections.ts`）。ADR 0005 已写明"以后接入的 Hook 放行（M5）不能越过前四步"。
- **Fork 现状。** M2 交付"从此分叉"：`agents/fork.ts` 只复制 `message`、`permission_mode`、`permission_rule`，新 Session 带 `fork_origin`；Goal、Todo、Plan、Job 不复制。没有 Handoff。
- **Session 与目录。** `sessions` 表只有 `workspace_id`，没有父 Session 与 worktree；Run 的 cwd 恒为 `workspace.path`（`session-runs.ts` 三处）。权限、沙箱可写根、指令与项目设置都从这个 cwd 推导。
- **子代理接口。** `goals/budget.ts` 的 `goalUsage(entries, goalId, { children })` 已能汇总子 Session 条目，M4 没有调用方（评审 B10）。
- **进程登记。** `host_processes.kind` 有 `CHECK (kind IN ('bash','job','pty','mcp'))`；新增 hook 与 git 类别需要重建表（SQLite 不能修改 CHECK）。
- **通知。** 代码中没有 Electron `Notification` 的使用；Sidecar 与 main 之间已有控制通道（`control/channel.ts`，M4 A7 已让非法请求立即得到回答）。
- **受保护路径。** `.coko` 是任意深度的受保护目录，Seatbelt 在可写根下对它追加 deny；因此 worktree 不能放在 `.coko/` 之下。`PROTECTED_PATH_NAMES` 按整段匹配，`.coko-worktrees` 不命中（票 04 须以测试确认）。
- **M4 遗留。** B1（`client/api.ts`、`jobs-store.ts`、`goal-store.ts` 三份 HTTP 调用）、B2（`goals.ts` 的 `#gate` 与 `#locked`、`session-permissions.ts` 的同类锁，后者 Map 不清理）等 B1–B12、B15 未处理；`text-warning` 作文字色：`mcp-section.tsx` 的状态文字与"已关闭"提示、`rewind-dialog.tsx` 的两条 alert 文字（三角图标保留 `text-warning`）、`context-ring.tsx` 的"已截断"与诊断 code（按钮图标保留）；手动 `/compact` 经 `trigger: compact` 的 Run，运行时只在自动压缩与溢出恢复前做 `beforeRequest` 检查（M4 A4 修复）。
- **ADR 索引过时。** `docs/adr/README.md` 中 0011、0012 仍为 not-started，两个文件 frontmatter 均为 implemented。
- **环境。** 系统 git 2.50.1（Apple Git-155）；Electron 41.0.3 自带完整 ICU（`Intl.DateTimeFormat` 的 IANA 时区可用）。
- **claude-code（社区还原版）。** 27 个 Hook 事件，`event → [{ matcher, hooks: [{ type, command, if, timeout }] }]`；stdin 一行 JSON，exit 2 阻断、其他非 0 只给用户看；同一事件并行执行，deny > ask > allow；Hook 的 allow 只免对话框，deny / ask 规则仍生效；工具类 Hook 缺省超时 10 分钟。Agent 工具 `{ description, prompt, subagent_type, model, run_in_background, isolation: 'worktree' }`；定义为 Markdown frontmatter（tools、disallowedTools、model、permissionMode、maxTurns…），同名覆盖 built-in < user < project；子代理禁用 Agent、TaskOutput、Plan 工具等；异步子代理不弹审批（自动拒绝），`bubble` 模式冒泡给父级；完成时 `<task-notification>` 带 `<result>` 与 `<usage>`。`isolation: worktree` 在 `.claude/worktrees/<slug>` 建分支 `worktree-<slug>`，没有改动时自动删除。Cron 任务分一次性与重复，重复任务默认 7 天过期，带抖动。
- **DSH。** `schedule`：after / at / every（≥ 60 秒）/ daily / weekly / cron（五段 Vixie，显式 IANA 时区），绑定原 Session，重启后每个重复任务只补最近一次，委派的子代理调用排程工具以 `subagent_session` 拒绝。`subagent`：进程内新建或带历史分叉的子 Session，可继续对话（send_message）、可中断、可列出；子 Session 持久化，目录取父级。`experimental/worktree`：`<checkout>/.agents/worktrees/<name>` 新建分支，不复制未提交改动，离开时保留。
- **pi v1.4.0。** subagent 示例以独立 `pi` 进程运行、并行上限 8（并发 4）、项目级 agent 须信任确认；handoff 示例用模型生成"Context / Files / Task"提示，作为新会话编辑器中的草稿供用户修改后发送。

## 设计树

```text
M5
├── A 预构建 ── A1 M4 遗留的范围 ── A2 与 M5 基础票的关系
├── B Hooks ── B1 Hook 类型 ── B2 配置位置与项目 Hook ── B3 事件裁剪 ── B4 输入输出 JSON
│         ├── B5 与权限判定的位置 ── B6 聚合与 allow 的上限 ── B7 超时与失败 ── B8 执行与进程
│         └── B9 记录与界面
├── C Subagents ── C1 进程内子 Session 还是独立进程 ── C2 定义文件 ── C3 工具面 ── C4 工具与模型配置
│             ├── C5 权限不宽于父级 ── C6 审批（无界面时） ── C7 预算汇入 Goal ── C8 取消、并发与重启
│             └── C9 卡片与右栏
├── D Scheduler ── D1 存储 ── D2 规则 ── D3 投递与去重 ── D4 补跑 ── D5 运行准入 ── D6 模型可否创建
│             └── D7 通知 ── D8 入口
├── E Fork / Handoff ── E1 Handoff 的形状 ── E2 继承规则 ── E3 跨 worktree 交接
├── F Workspace / Worktree ── F1 绑定方式 ── F2 位置与分支 ── F3 清理 ── F4 与子代理 / Teams 的关系 ── F5 宿主执行 git
├── G Agent Teams 与 Task 的归属
└── H 交付 ── H1 Carry-overs 与 M4 复盘规则 ── H2 切片与写范围 ── H3 测试接口 ── H4 ADR 与术语 ── H5 地图建议
```

## 第 1 轮（根节点）

**A1 预构建范围**：M4 评审未做的 B1–B12、B15，`text-warning` 作文字，手动 `/compact` 不经预算检查，都在第一张票做吗？
➡️ 是，票 01 一次收敛。理由：B1（三份 HTTP helper）与 B2（每 Session 锁）恰好是 M5 新服务（Hook、子代理、排程）要复用的形状，不先收敛会再复制两份。改变行为的只有四项，在票内分开验收：手动 `/compact` 在 Goal 运行中先过同一个请求前检查（与 A4 的"调用前检查"一致）；B12 找不到待审阅记录时抛错；B11 GoalCard 只在相关条目到达时重读；B15 只做提示（已定价模型且没有费用上限时 Goal 卡显示"未设费用上限"，`create_goal` 描述要求长任务设 `max_cost`），不改缺省预算。B10 不删除 `children` 参数：M5 票 07 接入调用方，同时把 goal.md 中"M4 没有调用方"的写法改为"M5 子代理接入"。采纳。

**A2 预构建与 M5 基础的关系**：
➡️ 两张，沿用 M4 的拆法。票 01 行为基本不变（上述四项除外），验收为"已有测试只改导入即通过 + 四项各自先红"；票 02 预建 M5 的条目 kind、协议领域文件、迁移 v8、运行时 seam、权限类、宿主适配器存根、UI 容器与测试 harness。采纳。

**B1 Hook 类型**：claude-code 有 command、prompt、http、agent 四种。
➡️ M5 只做 `command`。prompt / agent 型在无人值守时额外消耗模型费用且不受 Goal 预算约束；http 型需要网络与请求头白名单，属于新的外发通道。配置中的其他 type 给出诊断 `unsupported-hook-type` 并忽略该条。M6 的 Plugins 以同一 schema 声明 Hook。采纳。

**C1 子代理的执行形态**：独立 `pi` 进程（pi 示例）还是同一 Sidecar 内的子 Session（DSH、claude-code）？
➡️ 同一 Sidecar 内的**子 Session**：`sessions` 增加 `parent_session_id`，子代理的条目、Run、审批与恢复复用现有 Session 机制，经同一权限 gate、Seatbelt、进程登记与秘密脱敏。独立进程要另建一套 IPC、凭据传递与孤儿清理，子代理的条目也无法与 Goal 预算按同一口径派生。见 [ADR 0014](../../docs/adr/0014-subagents-as-child-sessions.md)。采纳。

**D1 定时任务的存储**：Session Entry（像 Goal）还是宿主表？
➡️ 宿主表 `schedules`（定义、规则、下次时间、最后一次投递）加原 Session 中的 `schedule_fire` 条目（每次投递的事实）。定时器要在启动时跨全部 Session 扫描到期项，从条目派生需要读每个 Session 的全部条目；DSH 同样单独存储。投递在同一 SQLite 事务中更新表行并追加条目，从而去重。见 [ADR 0015](../../docs/adr/0015-schedules-at-most-once-latest-catch-up.md)。采纳。

**E1 Handoff 的形状**：
➡️ 沿用 pi handoff 示例：`/handoff <下一步目标>` 或会话菜单"交接到新会话"，由模型从当前有效上下文生成一份自包含的交接摘要（背景与决定、涉及文件、未完成事项、下一步），在新 Session 的输入区作为**草稿**出现，用户修改后发送。摘要生成是源 Session 的一个 `trigger: handoff` 的 Run（与 `/compact` 同一模式：一次摘要请求，经请求前检查，用量计入 Goal 预算，可停止）。不复制消息（那是 Fork）。采纳。

**F1 worktree 的绑定方式**：会话中途切换 cwd（claude-code EnterWorktree、DSH worktree.create）还是创建时固定？
➡️ **创建时固定**。Session 的工作目录（Workspace 或其某个 worktree）在创建时确定，此后不变。中途切换会让 Checkpoint 的路径、权限规则的相对路径、指令与项目设置的来源在同一 Session 中前后不一致，回退与分叉也要知道每条条目当时的 cwd。"切换"就是在侧栏打开另一个绑定该 worktree 的会话；"在新 worktree 中继续"是 Handoff 的目标选项。不提供模型可调用的 Enter / ExitWorktree 工具。见 [ADR 0016](../../docs/adr/0016-session-cwd-fixed-worktrees.md)。采纳。

**G Agent Teams 与 Task**：M4 把带 owner / claimed 的 Task 推迟到"M5 Agent Teams"，地图把 Agent Teams 放在 M6。
➡️ **随 M6 的 Agent Teams 做**，M5 不做 Task。M5 的子代理是父级派发的一次性子 Session：任务由父级在 prompt 中给出，结果直接回到父级，没有"多个执行者从共享板认领"的场景；在 M5 做 owner 与认领，会重复 M4 已拒绝的"只有一个可能的 owner、认领没有并发方、无法验收"。M6 的会话内团队有具名 teammate 与共享任务板，Task 的认领、锁、`blockedBy` 与 TaskCreated / TaskCompleted Hook 在那里才有并发方。M5 的子代理各有自己的 Todo List（子 Session 内），不共享。地图建议见 H5。采纳。

## 第 2 轮

**B2 Hook 配置位置与项目 Hook**：
➡️ 全局 Hook 存设置键 `hooks`（SQLite，ADR 0003；经 `GET / PUT /api/hooks` 带 revision 整体替换，设置界面以 JSON 编辑）；项目 Hook 在 `<cwd>/.coko/settings.json` 的 `hooks` 键（与 claude-code 的项目 `settings.json` 同形）。项目 Hook 会在用户机器上执行仓库提供的命令，与项目 MCP Server 风险相同，因此按 ADR 0008 的做法**逐条批准**：摘要覆盖 event、matcher、if、command、timeout，改动后须重新批准；未批准的不运行。项目 Hook 只能收紧：其 allow 决定被忽略（当作没有决定），项目文件中的 `hooks.enabled: false` 以 `project-cannot-grant` 诊断忽略（全局 Hook 常是用户自己的守卫，项目不能关掉它）。能力开关 `hooks.enabled` 只在全局设置。见 [ADR 0013](../../docs/adr/0013-external-hooks-tighten-only.md)。采纳。

**B3 事件裁剪**：claude-code 27 个事件按 Coko 生命周期保留哪些？
➡️ 保留 10 个：

| 事件 | 触发 | matcher | 可阻断 |
| --- | --- | --- | --- |
| PreToolUse | 每次工具调用的权限判定时 | 工具名 | 是：deny / ask / allow |
| PostToolUse | 工具成功结果提交前 | 工具名 | 否；exit 2 的 stderr 或 additionalContext 追加给模型 |
| PostToolUseFailure | 工具错误结果提交前 | 工具名 | 同上 |
| PermissionRequest | 判定为 ask、审批卡出现之前 | 工具名 | 是：allow（只解决允许规则能解决的询问）/ deny |
| UserPromptSubmit | 用户提交（trigger submit）之前 | — | 是：拒绝提交 |
| Stop | 根 Session 的 Run 正常结束之前 | — | 是：要求继续（每 Run 至多 3 次） |
| SubagentStart | 子 Session 第一个 Run 开始前 | 子代理类型 | 否；additionalContext 进入子代理首条消息 |
| SubagentStop | 子 Session 的 Run 正常结束之前 | 子代理类型 | 是：要求子代理继续（至多 3 次） |
| PreCompact | 手动与自动压缩之前 | manual / auto | 是：阻止本次压缩（溢出恢复不可阻止）；stdout 追加为摘要要求 |
| Notification | Coko 发出桌面通知时 | 通知类别 | 否（只观测） |

不做：SessionStart / SessionEnd（Coko 的 Session 没有进程级的开始与结束，Run 开始时注入已有指令文件）；StopFailure、PermissionDenied、PostCompact、InstructionsLoaded、ConfigChange（只观测或与 Coko 无对应，增加事件即增加契约，YAGNI）；Setup、Elicitation*（Coko 没有对应流程）；CwdChanged（cwd 固定）、FileChanged（没有文件监视）；WorktreeCreate / WorktreeRemove（Coko 只支持 git worktree，不做非 git 的替代实现）；TeammateIdle、TaskCreated、TaskCompleted（M6 Agent Teams）。采纳。

**C2 子代理定义文件**：
➡️ 沿用 claude-code 的 Markdown frontmatter：用户级 `~/.coko/agents/*.md`、项目级 `<cwd>/.coko/agents/*.md`（ADR 0009：用户编写的资源为文件）。字段：`name`（必填，`[a-z0-9-]{1,64}`）、`description`（必填）、`tools`（逗号分隔或列表；省略为继承父级可用工具）、`disallowed-tools`、`model`（`inherit` 或 `<providerId>/<modelId>`，缺省 inherit）、`thinking`（推理档位）、`permission-mode`（read-only / default / accept-edits / full-access，只能收窄）、`max-turns`（1–200）；正文为子代理的角色提示。内置 `general`（全部可用工具）与 `explore`（read、grep、find、ls、bash，`permission-mode: read-only`，正文要求只调研、返回带文件与行号的结论）。同名覆盖 built-in < user < project（claude-code）。项目定义只是提示与收窄，按 ADR 0008"指令、Skills 与命令只提供上下文"无需批准；`permission-mode` 只能收窄，`tools` 只能在父级之内选。不支持 claude-code 的 `mcpServers`、`hooks`、`memory`、`isolation` 字段（前两项会启动进程；isolation 由调用参数决定）。诊断：`invalid-frontmatter`、`unknown-tool`（忽略该项）、`unknown-model`（回到 inherit）、`shadowed`、`agent-outside-workspace`（经符号链接指出 Workspace，不加载）。采纳。

**D2 规则**：
➡️ 四种：`after_seconds`（一次，正整数）、`at`（一次，带偏移的 RFC 3339，须在将来）、`every_seconds`（固定间隔 ≥ 60，按创建时刻对齐）、`cron`（五段 Vixie 表达式 + 显式 IANA 时区，DSH 的方言与 DST 规则：不存在的本地时刻跳过，重复的取较早一次）。不做 DSH 的 daily / weekly（cron 能表达）。不做 claude-code 的抖动与 7 天过期：Coko 只服务一个用户的一台机器，过期由用户在列表中删除。cron 解析自研纯 TS（表驱动测试），不新增依赖。每 Session 至多 20 个 active。采纳。

**E2 Handoff 的继承规则**：
➡️ 与 Fork 对齐并说明差异：继承模型、推理档位、权限模式与 Session 规则（同 `forkEntries` 复制的权限条目）；不继承 Goal、Todo、Plan、Job、子代理与定时任务（它们属于源 Session，其状态写进摘要文本）；源 Session 不变，提交 `handoff { targetSessionId, summary, instructions, usage }`；目标 Session 首条为 `handoff_origin { sessionId, seq }`。目标在同一 Workspace 的当前目录、新 worktree 或已有 worktree 中创建。摘要只作为草稿，发送前不进入模型上下文（用户可以删改）。采纳。

**F2 worktree 的位置与分支**：
➡️ 仓库根下 `.coko-worktrees/<name>`，分支 `coko/<name>`，从源 checkout 的 `HEAD` 创建（不复制暂存、未暂存与未跟踪的改动，创建前提示其数量）。不能用 `.coko/worktrees`：`.coko` 是受保护路径，worktree 内的每次写入都会询问并被 Seatbelt 拒绝；也不放在应用数据目录：用户看不到、编辑器打不开，误删时丢失未提交工作。首次创建时把 `/.coko-worktrees/` 写入仓库的 `.git/info/exclude`（本地、不提交），父 Session 的 grep / find / ls 不列出其内容。name 校验 `[a-z0-9][a-z0-9-]{0,47}`，缺省 `coko-<sessionId 前 8 位>-<4 位随机十六进制>`（DSH 的形状）；分支已存在时报错，不像 claude-code 用 `-B` 重置。Workspace 是仓库子目录时，worktree 会话的 cwd = worktree 根 + Workspace 相对仓库根的路径。`.coko-worktrees` 或其祖先是符号链接、或真实路径不在仓库根下时拒绝创建。采纳。

**F5 宿主执行 git**：
➡️ server `adapters/git.ts` 经 ExecPort 以 argv 运行 `git`（不经 shell），环境 `GIT_TERMINAL_PROMPT=0`、`LC_ALL=C`，超时 60 秒，登记为 `host_processes.kind = 'git'`（迁移 v8 重建该表以扩展 CHECK，同时加入 `hook`）。git 由用户界面或子代理的 `isolation` 触发，不是模型的 bash：不经 Seatbelt，但只在仓库根与 `.coko-worktrees/` 内操作。TECH_STACK 记"worktree 依赖系统 git（Xcode Command Line Tools），不随包分发"。采纳。

## 第 3 轮

**B4 输入输出 JSON**：
➡️ 输入（stdin 一行 JSON）：公共字段 `session_id`、`cwd`、`permission_mode`、`hook_event_name`，子 Session 另有 `parent_session_id`、`agent_type`；不提供 `transcript_path`（条目在 SQLite，不暴露库路径）。事件字段：工具事件 `tool_name`（注册名）、`tool_input`、`tool_use_id`，Post 另有 `tool_response`（与提交的结果相同、已按值脱敏）；UserPromptSubmit `prompt`；Stop / SubagentStop `stop_hook_active`；PreCompact `trigger`、`custom_instructions`；Notification `notification_type`、`title`、`message`；SubagentStart `agent_type`、`agent_id`。环境：Sidecar 的基础环境（与 bash 相同的处理，不注入 Secret）加 `COKO_PROJECT_DIR`（Workspace 根，worktree 会话中为原 Workspace）、`COKO_SESSION_ID`、`COKO_HOOK_EVENT`。输出（exit 0 且 stdout 为 JSON 对象时解析）：`continue`、`stopReason`、`decision: block`、`reason`、`systemMessage`（只显示给用户）、`hookSpecificOutput { hookEventName, permissionDecision?, permissionDecisionReason?, additionalContext? }`；PermissionRequest 为 `hookSpecificOutput.decision { behavior: allow | deny, message? }`。不支持 `updatedInput` / `updatedPermissions`（改写参数后须重新判定，且会让 Hook 绕过规则的写入路径；记为非目标）。exit 2：stderr 为阻断原因（各事件语义见 B3 表）。stdout / stderr 各截断到 64 KB，additionalContext 合计 ≤ 10 000 字符。采纳。

**B5 与权限判定的位置**：
➡️ PreToolUse 在权限 gate 内、`decide` 之前并行执行，得到聚合决定 H；`decide` 返回决定及其来源步骤 P。组合（ADR 0013）：H = deny → 拒绝（`Blocked by hook: <reason>`，Run 继续）；否则 P = deny → 拒绝；否则 P 来自询问规则、受保护路径或越出可写根（判定第 2–4 步）、或为提权 / plan 审批 → 询问（H 的 allow 不能免除）；否则 H = ask → 询问（没有建议规则）；否则 H = allow → 允许（与允许规则同位：只解决第 7 步的询问）；否则按 P。最终为 ask 且来自第 7 步时、出卡片之前运行 PermissionRequest：deny → 拒绝；allow → 允许；其余出卡片。`approval_decision` 增加 `by: hook`（v2）。claude-code 的 Hook allow 同样"只免对话框"。采纳。

**B6 聚合**：
➡️ 同一事件匹配的全部 Hook 并行执行，各自超时；决定按 deny > ask > allow 聚合；additionalContext 按配置顺序拼接；`continue: false` 任一为真即生效（Run 本批完成后停止，`run_end { status: paused, error: { code: hook_stopped } }`）。项目 Hook 的 allow 不参与聚合。`if` 条件复用权限规则匹配：复合命令拆分后任一子命令命中即匹配（与拒绝规则同义，guard Hook 不会因 `a && b` 漏掉）。采纳。

**B7 超时与失败**：
➡️ 缺省超时 60 秒、上限 600 秒（`timeout` 单位秒）；Notification 缺省 10 秒。claude-code 的 10 分钟在无人值守的 Goal Round 中会让每次工具调用最长卡 10 分钟。超时、非 0 非 2 的退出、exit 0 而 stdout 不是合法 JSON：视为没有决定（fail-open），记 `hook_run { outcome: timeout | error | invalid-output }`，Run 继续。理由：Hook 叠加在规则之上，规则、模式与沙箱仍完整生效；fail-closed 会让一个坏掉的 Hook 阻断全部工具。需要可靠拦截的用户写拒绝规则。采纳。

**B8 执行与进程**：
➡️ `/bin/bash -c <command>`，cwd 为 Session 的工作目录，独立进程组，登记 `host_processes.kind = 'hook'`，超时对进程组 SIGTERM、2 秒后 SIGKILL。Hook 命令不经 Seatbelt（与全局 MCP stdio Server 相同：是用户或已批准的配置，不是模型的命令）。stdin 写入后关闭。采纳。

**B9 记录与界面**：
➡️ 只对有结果的执行提交 `hook_run { event, hookId, source: global | project, command（脱敏）, outcome: blocked | asked | allowed | context | continued | stopped | timeout | error | invalid-output, exitCode?, durationMs, message?（≤ 2 KB） }`；什么都没做的执行只记 debug 日志，避免每次工具调用一条。时间线：被 Hook 阻断的工具卡标注"被 Hook 阻止"与命令；其余为紧凑行。设置 → Hooks 分区：开关、全局 JSON 编辑（校验与行内错误）、当前会话目录的项目 Hook 列表（逐条批准，显示完整命令）、按事件分组的已加载清单。采纳。

**C3 子代理的工具面**：
➡️ 三个工具（claude-code 的 Agent 加 TaskOutput / TaskStop 的子集）：
- `agent { description, prompt, subagent_type?, model?, run_in_background?, isolation?: 'worktree' }`：缺省 `general`。前台时等待子 Session 结束，结果 `<agent-result agent-id status turns tool-calls tokens cost duration-ms>最终文本</agent-result>`（最后一条非空 assistant 文本，≤ 50 000 字符，超出截断并注明子 Session id）；同一批多个 `agent` 调用并行执行。后台时立即返回 id，结束时以 `<agent-notification>` 送达（与 Job 通知相同的送达与挂起规则，不唤醒没有 Goal 的空闲 Session）。
- `agent_wait { agent_ids?, timeout_ms? }`：等待后台子代理结束（缺省 30 秒、上限 600 秒、追加指令到达时提前返回）；不给 id 时列出本 Session 的子代理及状态。
- `agent_cancel { agent_id }`：停止子代理（abort 其 Run）。
`agent_wait`、`agent_cancel` 只在本 Session 有子代理时注册（M4 update_goal 的做法，控制工具定义体积）。不做 DSH 的继续对话（send_message）：M5 的子代理一次性。采纳。

**C4 工具与模型配置**：
➡️ 子 Session 的工具 = 父级本 Run 可用工具 ∩ 定义的 `tools`（省略为全部）− `disallowed-tools` − 固定排除集（`agent`、`agent_wait`、`agent_cancel`、Goal 工具、`exit_plan_mode`、`schedule_*`、`job_*`，以及 bash 的 `run_in_background` / `tty`：子 Session 不能留下比自己活得久的进程）。深度固定为 1。MCP 工具在 `tools` 写出名字或省略 `tools` 时可用。模型：`agent.model` > 定义 `model` > 父 Session 当前模型；必须在 Model Catalog 中，否则错误结果。子 Session 照常加载 cwd 的指令文件、Skills 索引与 Memory（只读：不注册 memory_write / memory_delete），注入 `<subagent>` system section（类型、角色正文、"你的最终回复会原样交给父级，写成自包含的结论"）。`max-turns` 缺省 50（模型请求数），在子 Run 的请求前检查，耗尽以 `max_turns` 结束。采纳。

**C5 权限不宽于父级**：
➡️ 子 Session 的有效模式在**每次判定时**取 min(根 Session 当前模式, 定义的 `permission-mode`)，序为 read-only < default < accept-edits < full-access；根为 plan 时子级按 read-only（子级没有 exit_plan_mode，不进入 plan）。规则为根 Session 的 Session 规则 + 全局 + Workspace + project（子 Session 自己不保存规则）；子级审批选"本会话总是允许"写入根 Session 的规则。沙箱可写根按子 Session 的 cwd（isolation worktree 时为该 worktree）。`agent` 工具本身权限类 `agent`：所有模式放行（子级的每个调用各自判定），规则组名 `Agent`、内容为子代理类型（`Agent(general)` 的拒绝规则禁用该类型）；`isolation: worktree` 在 plan / read-only 下为错误结果，其余模式除 full-access 外询问（会写 `.git/worktrees`）。采纳。

**C6 审批（无界面时）**：claude-code 的异步子代理自动拒绝，`bubble` 模式冒泡给父终端。
➡️ **等待，不自动拒绝**。Coko 没有真正无界面的子代理：每个子 Session 都能在右栏打开，审批卡同时出现在子 Session 视图与父会话的输入区（标出"来自子代理 <类型>"）；PermissionRequest Hook 先于卡片运行，可以代替用户回答。前台子代理的等待使父级工具调用一起等；后台子代理与定时任务的 Run 等待时，若窗口不在前台则发桌面通知。等待本身不花 Token；自动拒绝会让无人值守的结果变成"每次都做不成"，需要无人值守执行的用户用允许规则或 PermissionRequest Hook 表达。审批只经用户界面与 Hook 回答，模型与工具输出无法构造回答。见 ADR 0014。采纳。

**C7 预算汇入 Goal**：
➡️ 子 Session 属于父 Session 中派发它的 Run；该 Run 属于某个 Goal（`goalRunIds`）时，子 Session 的全部 Run 计入该 Goal 的工具调用、Token、费用与时间（不计轮次），即 `goalUsage(..., { children })` 的现有口径。子 Run 的每次模型请求前与工具调用前同样检查根 Goal 的预算（含其他子 Session 的已用），耗尽时子 Run 停止、父级在下一个检查点停止。设了 `maxCost` 而子代理模型未定价时 `agent` 返回错误结果（不开始子 Session）。采纳。

**D3 投递与去重**：
➡️ 到期时在原 Session 开始 `trigger: schedule` 的 Run，输入 `<scheduled_task schedule-id title occurrence>prompt</scheduled_task>`（不按 `/` 命令展开，原文送达）。Session 有 Run 进行中时挂起，Run 结束后立即投递；同一定时任务至多挂起一次，挂起期间再到期的发生次不另投递。投递在一个事务中更新 `schedules.last_occurrence` 并追加 `schedule_fire { scheduleId, occurrence, status: started }`，之后才开始 Run；Run 没能开始时追加 `schedule_fire { status: skipped, reason }`。崩溃发生在两步之间时该发生次视为已投递（**至多一次**）：无人值守的重复花费比漏一次更难接受。采纳。

**D4 补跑**：
➡️ 启动扫描与运行中检查一致：每个 active 任务只补**最近一次**错过的发生次（DSH、地图），其余不逐一追加条目，只在补跑的 `schedule_fire` 中写 `missed: n`。一次性任务过期后补一次即 inactive。定时器：一个 `setTimeout` 指向最早到期的任务，另每 30 秒复查墙钟（睡眠唤醒、时钟调整后不需要 main 的 powerMonitor）。只在应用运行时投递：应用关闭期间不唤醒进程，记为限制。采纳。

**D5 运行准入**：
➡️ 到期时依次检查，不满足的记 `schedule_fire { status: skipped, reason }`：能力开关 `schedules.enabled`（project 只能关）；Session 存在且不是子 Session；工作目录存在（worktree 已移除时 `worktree-removed`）；模型已配置；该 Session 有处于非终态、非 paused 的 Goal 且任一预算维度已耗尽时 `budget`（不开始会被立即停止的 Run）。权限：Run 在 Session 当前模式下运行，询问照常等待（C6）。授权：`trigger: schedule` 的 Run 在 `runAuthority` 中为 none——不能创建或编辑 Goal、不能创建定时任务；它不恢复 paused 的 Goal（ADR 0011 的"重启后由人恢复"不因定时任务改变；prompt 中的 `/goal resume` 不会被展开为动作）。采纳。

**D6 模型可否创建定时任务**：
➡️ 可以，工具 `schedule_create { title, prompt, after_seconds | at | every_seconds | cron + time_zone }`、`schedule_list`、`schedule_update { id, … }`、`schedule_delete { id }`（DSH 的工具形状）。创建与修改是"在将来无人值守地开始 Run"，新权限类 `automation`：除 full-access 外各模式都询问，允许规则可放行（规则组名 `Schedule`），拒绝规则生效；list 为 context-read，delete 为 session-state。`trigger: schedule` 的 Run、子 Session 中调用以错误结果拒绝（DSH `subagent_session`），防止定时任务自我复制。采纳。

## 第 4 轮

**C8 取消、并发与重启**：
➡️ 每个根 Session 同时至多 4 个 running 子代理（第 5 个返回错误结果）。停止父 Run：abort 前台子代理，后台子代理继续（与 Job 一致）；取消 Goal：停止其 Run 派发的全部子代理并记入 `cleanup.agentsStopped`。重启：子 Session 的 Run 按现有中断恢复处理；父 Session 为没有 `agent_end` 的子代理提交 `agent_end { status: interrupted }`；父级被中断的 `agent` 调用不进入"结果确认"（它的副作用在子 Session 自己的条目中、各有执行记录），恢复时以 `interrupted; partial results in child session <id>` 作为结果。采纳。

**C9 卡片与右栏**：
➡️ 父时间线中 `agent` 工具卡显示类型、描述、状态、子代理当前的一行进度（最近的工具调用）、结束后的用量；后台子代理另有 chip。点击打开右栏 Agents tab：子代理列表（状态点、类型、描述、时长、用量）与选中项的只读时间线（复用 TimelineView）、停止按钮。会话标题栏"子代理"按钮带 running 数。子 Session 不出现在侧栏会话列表中，不能直接提交消息（409 `child-session`），审批可回答。设置 → Agents 分区（地图 08 票的"子代理预设"）：列出内置、用户、项目定义及诊断，只读（ADR 0009：编辑在文件中）。采纳。

**D7 通知**：
➡️ Sidecar 经控制通道发 `notify { kind, sessionId, title, body }`，main 在窗口不在前台时用 Electron `Notification` 显示，点击后聚焦窗口并打开该会话。类别：`schedule-run-ended`（定时任务的 Run 结束）、`approval-waiting`（`trigger: schedule` 的 Run 或后台子代理在等审批）、`agent-finished`（后台子代理结束）。设置 → 通知：总开关与每类开关（全局设置键 `notifications`），由 Sidecar 发送前读取。测试构建另把通知写入日志（`notification shown`），E2E 据此断言而不弹系统通知。采纳。

**D8 入口**：
➡️ 会话标题栏"定时任务"按钮（active 数）打开右栏 Schedules tab：该会话的任务（标题、规则的人类可读形式、下次时间与时区、状态、最近一次结果）、新建 / 编辑表单（一次 / 间隔 / cron，时区缺省为本机时区并显示）、暂停 / 恢复 / 删除、投递历史（该 Session 的 `schedule_fire` 条目）。设置 → 定时任务：跨 Session 的全部任务（DSH ui-schedule 的 catalog），可暂停、删除并跳转会话。`schedule_fire` 在时间线为紧凑行。采纳。

**E3 跨 worktree 交接**：
➡️ Handoff 对话框的目标：当前目录、新 worktree（名称可选，从源的 HEAD 创建；源 checkout 有未提交改动时显示数量并说明不会带过去）、已有 worktree（下拉）。交接后打开目标会话，草稿为摘要。不交接 Job、子代理与定时任务（它们与源 Session 的目录绑定，写进摘要）。采纳。

**F3 清理**：
➡️ 只由用户发起：worktree 菜单"移除 worktree"。前提：绑定它的会话都没有进行中的 Run、子代理、Job 或 active 的定时任务（409 `worktree-busy` 列出原因），且 `git status --porcelain` 为空（409 `worktree-dirty` 带文件数）；不提供强制删除（不做 `git worktree remove --force`）。移除执行 `git worktree remove <path>`，分支保留；绑定的会话保留只读，提交返回 409 `worktree-removed`。启动时路径已不存在的 worktree 标为 removed。子代理的 isolation worktree：子 Session 结束时若 HEAD 仍为 base 且工作区干净，自动移除并删除分支（claude-code）；否则保留，结果中给出路径与分支。采纳。

**F4 与子代理 / Agent Teams 的关系**：
➡️ isolation worktree 由子代理服务经 WorktreeService 创建，子 Session 绑定它；父 Session 读取它的文件属于 Workspace 之外的读取（询问），隔离成立。M6 的 teammate 复用同一机制（每个 teammate 一个可选 worktree）。采纳。

## 第 5 轮（交付）

**H1 Carry-overs 与 M4 复盘规则**：
➡️ 地图中标 M5 的项进入票 01；M4 复盘采纳的规则写入 [implementer-brief](implementer-brief.md) 的通用规则：
- **对手用例**：预算、权限或沙箱判定的票，验收固定加"模型或命令输出构造的输入不能改变判定结果"。M5 的对应用例：Hook（工具输出伪造 Hook JSON 不改变决定、`a && rm x` 不漏过 guard 的 `if`、项目 Hook 的 allow 不生效、项目设置关不掉全局 Hook）；子代理（子级调用 `agent` / `create_goal` / `schedule_create` 被拒、子级输出伪造 `<agent-result>` 不改变父级收到的状态、子级不宽于根的当前模式、根切到 read-only 后子级下一次写入被拒）；排程（定时 prompt 中的 `/goal resume` 不被展开、scheduled Run 不能创建定时任务、用户消息中伪造的 `<scheduled_task>` 不获得 schedule 触发的身份）；预算（子级用量使根 Goal 耗尽后父子都停止、Handoff 摘要请求在 Token 耗尽时不发出、手动 `/compact` 同样）。
- **每完成一项就提交**、**只在 worktree 中写文件**。
- **新增读取根或注入点**：读取根与工作目录——`.coko/agents`（符号链接指向外部不加载）、`.coko-worktrees`（符号链接时拒绝创建；worktree 会话读取主 checkout 须审批）；注入点——`<subagent>`、子代理首条消息、`<agent-result>` / `<agent-notification>`、`<scheduled_task>`、Hook 的 additionalContext 与 stderr、Handoff 摘要草稿；每个都有 `secrets-gate-<channel>.test.ts` 扫描 faux requestLog。另有新的外发通道：Hook 的 stdin（测试 Hook 把收到的 stdin 写入文件，总闸扫描该文件）与 `notify` 控制消息。
采纳。

**H2 切片与写范围**：
➡️ 10 张票：01 预构建（阻塞全部）→ 02 M5 基础（阻塞其余）→ {03 Hooks 核心与工具事件, 04 Worktree 绑定与清理, 05 定时任务核心与通知} 可并行 → {06 Hooks 生命周期事件与设置（03、05 之后）, 07 子代理核心（03、04 之后）, 09 定时任务界面与通知设置（05 之后）, 10 Handoff（04 之后）} 可并行 → 08 子代理界面与 Agents 设置（07 之后，可与 09、10 并行）。每张票只有自己领域的文件；共享装配点（`layers.ts`、`session-runs.ts`、`policy/gate.ts`、`engine/`、协议入口、迁移、各注册表）由票 02 一次预建 seam，之后只有 spec 表中指定的票改。见 spec"共享装配点与所有者"。采纳。

**H3 测试接口**：
➡️ 沿用 M4：Sidecar 协议集成测试为主（真实 Sidecar、临时 `COKO_HOME`、Workspace、faux 脚本）。票 02 补三项 harness：(1) **测试时钟**：测试构建中 `COKO_TEST_CLOCK=1` 使排程用可控时钟，`POST /api/test/clock { advanceMs | setMs }`（只在测试构建注册，发布构建忽略）；(2) **faux 按匹配回复**：脚本回复可带 `match`（最后一条 user message 或 system prompt 包含的子串），使并行子 Session 的回复确定；(3) **git 夹具**：临时仓库、临时 HOME、`GIT_CONFIG_GLOBAL=/dev/null`、固定 author，Sidecar 子进程继承同一环境；Hook 夹具为仓库内 node 脚本（记录 stdin、按参数退出、睡眠）。agent 层纯函数表驱动：Hook 配置解析、matcher 与 if、决定组合表、聚合；子代理定义解析与工具交集、有效模式；cron 解析与下次时间（含 DST）；补跑计算。Electron E2E 覆盖 Hooks 设置、Agents tab 与审批冒泡、Schedules tab、worktree 菜单、Handoff 对话框。不新增产物 smoke（M5 不新增原生依赖与打包资源）。采纳。

**H4 ADR 与术语**：
➡️ 满足三条标准（难以撤回、无上下文时令人意外、真实取舍）的四个：[0013](../../docs/adr/0013-external-hooks-tighten-only.md)（外部 Hook 只用 command 型，allow 与允许规则同位、不越过前四步，项目 Hook 逐条批准且只收紧，失败 fail-open）、[0014](../../docs/adr/0014-subagents-as-child-sessions.md)（子代理是同一 Sidecar 中的子 Session，权限取根当前模式与定义的较窄者，审批等待不自动拒绝，用量计入根 Goal）、[0015](../../docs/adr/0015-schedules-at-most-once-latest-catch-up.md)（定时任务存宿主表、投递在原 Session、至多一次、只补最近一次、不恢复 Goal）、[0016](../../docs/adr/0016-session-cwd-fixed-worktrees.md)（Session 工作目录创建时固定，worktree 在 `.coko-worktrees/`、只在干净时由用户移除）。Handoff（可逆，形状同 pi 示例）、通知、cron 方言、事件裁剪的具体名单不写 ADR。顺带：ADR 索引中 0011、0012 改为 implemented；0005 增一行指向 0013；0009 增一行"子代理定义同为文件"；0011 记"Scheduler 不恢复 Goal，重新审视条件未触发"。新增术语 Hook、Subagent、Subagent Definition、Schedule、Worktree、Handoff，更新 Run 与 Session 的定义，已写入 [GLOSSARY](../../GLOSSARY.md)。采纳。

**H5 地图建议**（地图不在本次写范围，由 lead 合并）：
- Carry-overs 中标 M5 的两项标为"→ 已分配 M5 票 01 / 写入 M5 implementer-brief"。
- 新增 Carry-over："M6：带 owner / 认领 / 锁的 Task、共享的 `blockedBy` 与 TaskCreated / TaskCompleted / TeammateIdle Hook 随 Agent Teams 交付（M5 规划裁决：M5 子代理是一次性派发，没有认领方）。"
- 新增 Carry-over："M6：Plugins 以同一 Hook schema 声明 Hook；prompt / http / agent 型 Hook 与 `updatedInput` 不在 M5（ADR 0013）。"
- 新增 Carry-over："M6：子代理的继续对话（send_message）；teammate 的 worktree 复用 ADR 0016 的机制。"

frontier 已空。
