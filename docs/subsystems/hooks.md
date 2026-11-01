---
kind: reference
description: "当前的外部 Hook 契约：配置形状与诊断、全局与项目 Hook（逐条批准、只收紧、已改动）、能力开关、matcher 与 if、执行（bash -c、进程组、登记、环境、超时与输出上限）、PreToolUse 与判定的组合表、PermissionRequest、PostToolUse(Failure) 的追加上下文、生命周期事件（UserPromptSubmit、Stop、PreCompact、Notification）、continue: false 的 hook_stopped、hook_run 条目、/api/hooks 与设置分区。修改 Hook 的配置、执行、组合、生命周期事件或记录前查阅。"
lifecycle: active
---

# 外部 Hook

本文说明 Coko 当前如何在工具调用前后、提交、Run 结束、压缩与桌面通知时运行用户配置的命令：Hook 可以拒绝、要求确认或放行一次调用，拒绝一次提交或压缩，让 Run 继续或停止，也可以追加给模型的文本。Hook 只能收紧判定，放行越不过规则、受保护路径、沙箱提权与计划审阅，取舍见 [ADR 0013](../adr/0013-external-hooks-tighten-only.md)。判定顺序见 [权限判定与审批](permissions.md#判定)；进程登记见 [命令执行与子进程登记](execution.md)。

当前交付的事件为 PreToolUse、PermissionRequest、PostToolUse、PostToolUseFailure、UserPromptSubmit、Stop、PreCompact、Notification、SubagentStart 与 SubagentStop（在子代理派发与结束时运行，见 [子代理](subagents.md)），以及团队事件 TaskCreated、TaskCompleted 与 TeammateIdle（没有 matcher，见 [团队事件](#团队事件)）。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/extensions/hooks/config.ts` | `parseHooksConfig(value, source, { parseRule?, path? })` → 加载的 Hook 与诊断；`hookDigest`、`hookTimeoutMs` |
| `packages/agent/src/extensions/hooks/matcher.ts` | `matcherMatches`、`selectHooks(hooks, event, { names, matchesRule })` |
| `packages/agent/src/extensions/hooks/output.ts` | `interpretHookResult(event, result)`：退出码与 stdout 的解释 |
| `packages/agent/src/extensions/hooks/combine.ts` | `aggregateVerdict`（deny > ask > allow）与 `combinePreToolUse`（组合表） |
| `packages/agent/src/policy/gate.ts`、`broker.ts` | gate 中运行 PreToolUse 与 PermissionRequest 并按组合表处理；`recordHookAllowed` 提交由 Hook 回答的审批 |
| `packages/protocol/src/hooks.ts` | `hook_run` payload、`HooksConfig`、`HooksResponse`、`UpdateHooksRequest`、`ApproveHookRequest`、`hookPaths`、设置键 |
| `apps/server/src/application/hooks.ts` | `HookService`：全局配置、项目 Hook 与批准、执行与记录、权限端口与观察 hook、生命周期事件（`userPromptSubmit`、`stop`、`preCompact`、`notification`）与 continue: false 的停止；`bind(HookSessionHost)` 在 SessionService 创建后接上停止 Run、权限模式与作用域 |
| `apps/server/src/application/context/hooks.ts` | 上下文贡献：每个 Run 一份 Hook 状态，给出 `permissionHooks`、`observeHooks`、`beforeSubmit`（UserPromptSubmit）、`onStop`（Stop）、自动压缩的 `beforeCompact`（PreCompact），以及 `beforeRequest` 中 UserPromptSubmit 的停止 |
| `apps/server/src/application/context/compaction.ts` | `/compact` 的动作：开始 Run 之前运行 PreCompact（trigger manual） |
| `apps/server/src/application/notifications.ts` | `NotificationService.observe`：Notification Hook 订阅发出的通知 |
| `apps/server/src/adapters/hook-runner.ts` | 执行端口：`/bin/bash -c`、进程组、登记、环境、超时与输出上限 |
| `apps/server/src/http/routes/hooks.ts` | `GET / PUT /api/hooks`、`POST /api/hooks/approvals` |
| `apps/desktop/src/renderer/features/conversation/hook-row.tsx`、`tool-cards.tsx` | 时间线的 `hook_run` 紧凑行；工具卡的"被 Hook 阻止"与"由 Hook 允许" |
| `apps/desktop/src/renderer/stores/hooks-store.ts` | renderer 的 Hook 视图（按会话或 Workspace 读取、保存全局配置、批准项目 Hook） |
| `apps/desktop/src/renderer/features/settings/hooks-section.tsx` | 设置 → Hooks 分区 |

## 配置

形状与 claude-code 相同：

```json
{
  "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "./guard.sh", "if": "Bash(rm *)", "timeout": 5 }] }]
}
```

- **全局**：设置键 `hooks`，只能经 `PUT /api/hooks` 修改（通用设置接口对 `hooks` 及其下的键 400）。
- **项目**：`<cwd>/.coko/settings.json` 的 `hooks` 键（与项目设置同一文件、同样按 mtime 读取，见 [分层配置](configuration.md#项目设置文件)）。worktree 会话读该 worktree 中的文件，批准按其 Workspace 判定。
- **插件**：已启用插件的 Hook（来源 `plugin`，ADR 0017）与全局同级参与加载与聚合（allow 与全局 Hook 相同对待，仍越不过判定前四步）；`hookId` 为 `plugin:<插件名>:<event>:<组序号>:<序号>`，诊断的 source 为 `plugin`。插件的安装与批准尚未接入，当前只有测试构建的 `COKO_TEST_PLUGINS` 提供插件。
- **能力开关** `hooks.enabled`（缺省 true）只在全局设置生效，关闭后全局与项目 Hook 都不运行；项目文件中的 `hooks.enabled` 以 `project-cannot-grant` 忽略，关不掉全局 Hook。

解析不抛出，问题作为诊断 `{ source: 'config', code, message, path? }` 返回，其余 Hook 照常加载：

| code | 何时 | 结果 |
| --- | --- | --- |
| `unsupported-hook-type` | `type` 不是 `command` | 忽略该 Hook |
| `unknown-event` | 不是支持的事件名 | 忽略该事件 |
| `invalid-matcher` | matcher 不是字符串，或不是名字、名字列表也不能编译为正则；TaskCreated、TaskCompleted、TeammateIdle 写了 matcher | 忽略该组 |
| `invalid-if` | `if` 不是合法的权限规则文本（`Tool` 或 `Tool(content)`） | 忽略该 Hook |
| `invalid-value` | 根、事件值、组或 Hook 的形状不对；命令为空；超时不是 1–600 的整数 | 忽略该项 |

`hookId` 为 `<source>:<event>:<组序号>:<序号>`；`digest` 为 event、matcher、if、command、timeout 的 SHA-256。

## 项目 Hook 的批准

未批准的项目 Hook 不运行。批准按 Workspace 与 digest 保存在设置键 `hooks.approvals.<workspaceId>`（`{ digest, hookId }` 列表，hookId 为批准时的位置；早期只存 digest 字符串，照常读取）；项目文件中任一字段改动后 digest 变化，回到未批准，同一位置曾经批准过时 `changed: true`（界面显示"已改动"）。项目 Hook 的 allow 不参与聚合（只收紧），`hook_run.outcome` 记为 `ignored`（PreToolUse 与 PermissionRequest；不是 `allowed`）并注明 `Ignored: a project hook cannot allow a call`，审批卡照常出现。

## 选择

每个 Run 在第一次需要时加载一次生效的 Hook（全局 Hook 加上已批准的项目 Hook）；Run 进行中修改配置或批准，从下一个 Run 生效。

- **matcher**（工具事件）：对象为工具注册名与规则组名（例如 `bash` 与 `Bash`、`write` 与 `Edit`），不区分大小写。省略、空与 `*` 匹配全部；只含字母、数字、`_` 与 `|` 时按名字或名字列表；其余按正则（不区分大小写）。
- **if**（工具事件）：与一条拒绝规则相同的匹配器（[规则语法](permissions.md#判定)）：Bash 复合命令的任一子命令命中即匹配（`Bash(rm *)` 命中 `echo ok && rm x`），路径按解析前或真实路径。

同一事件的匹配 Hook 并行执行。

## 执行

`/bin/bash -c <command>`，cwd 为 Session 的工作目录，独立进程组，登记为 kind `hook`（带 sessionId），进程组消失后删除登记。不经 Seatbelt：Hook 与已批准的 MCP stdio Server 处于同一信任级别。

- **环境**：Sidecar 的基础环境去掉 `COKO_*` 与凭据形态的变量（与 bash 工具相同），另加 `COKO_PROJECT_DIR`（Session 的工作目录：worktree 会话为该 worktree 中的对应目录，不是原 Workspace）、`COKO_SESSION_ID`、`COKO_HOOK_EVENT`；不注入 Secret。
- **stdin**：一行 JSON 后关闭。公共字段 `session_id`、`cwd`、`hook_event_name`、`permission_mode`；子 Session 另有 `parent_session_id`、`agent_type`。工具事件另有 `tool_name`（注册名）、`tool_input`、`tool_use_id`，PostToolUse(Failure) 另有 `tool_response`（`{ content, details? }`）与失败时的 `error`。整行按值替换登记明文后写入。
- **输出**：stdout 与 stderr 各保留前 64 KB。
- **超时**：缺省 60 秒（Notification 10 秒），配置上限 600 秒。超时或有序关闭时向进程组 SIGTERM，2 秒后仍有进程则 SIGKILL。
- **生命周期事件的输入**：`permission_mode` 为 Session 当前模式；UserPromptSubmit 另有 `prompt`（用户提交的原文，按值脱敏；`/<skill> 参数` 与命令不展开，不含 SKILL.md 或命令正文），Stop 另有 `stop_hook_active`，PreCompact 另有 `trigger`（`manual` / `auto`）与 `custom_instructions`（`/compact` 的参数，自动压缩为空串），Notification 另有 `notification_type`、`title` 与 `message`。

结果的解释：

| 进程结果 | 结论 |
| --- | --- |
| exit 2 | PreToolUse / PermissionRequest：拒绝，stderr 为原因；PostToolUse(Failure)：stderr 追加到结果；UserPromptSubmit / PreCompact：阻止，stderr 为原因；Stop：stderr 作为 user message 送达；Notification：没有作用 |
| exit 0，stdout 为 JSON | 按字段（下文）；没有决定字段时没有决定 |
| exit 0，stdout 为空 | 没有决定 |
| exit 0，stdout 不是 JSON 对象，或决定字段的值不合法 | 没有决定，记 `invalid-output`（PreCompact 的 stdout 按文本，见下文；Notification 忽略 stdout） |
| 其他退出码、被信号终止、启动失败 | 没有决定，记 `error` |
| 超时 | 没有决定，记 `timeout` |

JSON 字段（名字沿用 claude-code）：PreToolUse 为 `hookSpecificOutput.permissionDecision`（`allow` / `deny` / `ask`）与 `permissionDecisionReason`，也接受旧写法 `decision: approve / block` 与 `reason`；PermissionRequest 为 `hookSpecificOutput.decision { behavior: allow / deny, message? }`；PostToolUse(Failure) 与 UserPromptSubmit 为 `hookSpecificOutput.additionalContext`；UserPromptSubmit 与 Stop 另接受 `decision: block` 与 `reason`。`systemMessage` 只显示给用户（`hook_run.message`）；`continue: false` 记为 `stopped` 并停止 Run（见[停止](#continue-false-的停止)）。

## PreToolUse 与判定的组合

PreToolUse 在权限 gate 内、`decide` 的结果生效之前对每次调用运行。同一事件的决定聚合为 H（deny > ask > allow，项目 Hook 的 allow 不参与；原因取胜出决定的各 Hook 原因），与 `decideWithStep` 的结果 P 按顺序组合：

| 条件（按顺序） | 结果 |
| --- | --- |
| H = deny | 拒绝：`Blocked by hook: <reason>`，结果带 `details.hostBlock { by: 'hook', hookId, command }`，Run 继续 |
| P = deny | 按规则拒绝 |
| P 来自第 2–4 步（询问规则、受保护路径、越出可写根），或调用为 plan-exit | 按 P 询问（H 的 allow 无效） |
| 调用带提权参数或效果固定在更宽的沙箱中 | 照常走提权询问（H 的 allow 无效） |
| H = ask | 询问，没有建议规则 |
| H = allow | 允许（与一条允许规则同位） |
| 其余 | 按 P |

H = ask 的审批在等待中遇到模式或规则变更时，重新判定的结果与同一个 H 再组合（Hook 不重跑）：规则拒绝结束请求，模式放宽不使询问消失。

**PermissionRequest** 只在最终为第 7 步（default）的询问、出卡片之前运行：deny 拒绝（同上，带 `hostBlock`）；allow 依次提交 `approval_request` 与 `approval_decision { outcome: allowed, scope: once, by: hook }` 后执行；其余出卡片。询问来自询问规则、受保护路径、越出可写根或 Hook 的 ask 时不运行。

模型或命令输出构造的内容不能成为决定：决定只来自 Hook 进程自己的退出码与 stdout，`tool_input` 中出现的 Hook JSON 只是参数文本。

## PostToolUse 与 PostToolUseFailure

在登记明文替换之后、结果提交之前运行（观察 hook），收到的是已脱敏的结果；失败的调用为 PostToolUseFailure。被权限 gate 或 Hook 拦下的调用不运行。matcher 与 if 复用该调用 PreToolUse 时的规则组名与匹配器。各 Hook 的 `additionalContext` 与 exit 2 的 stderr 按配置顺序以空行连接，按值脱敏，合计至多 10 000 字符，作为一个文本块追加到结果末尾：

```text
<hook-feedback>
lint: 2 warnings

run the formatter
</hook-feedback>
```

## UserPromptSubmit

在 trigger submit 的输入展开之后、开始 Run 之前运行，收到的 `prompt` 是展开前的原文（`POST …/messages`；Run 进行中的追加指令、Goal Round、定时任务、子 Session 与动作不运行，`/compact` 等展开为动作的命令也不运行）。

- **阻止**：任一 Hook exit 2 或 `decision: block` → HTTP 400 `hook-blocked`，`message` 与 `details.reason` 为原因（各 Hook 的原因以换行连接，按值脱敏，≤ 2 KB；没有原因时 `Blocked by a UserPromptSubmit hook`）。不提交 user message，不开始 Run；`hook_run { outcome: blocked }` 不属于任何 Run（runId 为 null）。
- **追加上下文**：各 Hook 的 `additionalContext` 以空行连接，按值脱敏，至多 10 000 字符，作为同一条 user message 中用户原文之后的单独文本块：

```text
<hook-context>
branch is main
</hook-context>
```

  时间线的用户气泡不显示这个块（由 `hook_run` 行显示），回退时也不放回输入区；模型请求与压缩照常看到它。

## Stop

在根 Session 的对话 Run 正常结束之前运行（最后一轮只有文本；停止、暂停、拒绝、宿主停止与出错的 Run 不运行；trigger compact、handoff 与子 Session 的 Run 不运行，子 Session 的结束归 SubagentStop）。

- **继续**：任一 Hook exit 2（stderr）或 `decision: block`（`reason`）→ 以一条 user message 再请求一次，内容为 `Stop hook feedback:\n<原因>`（各 Hook 的原因以空行连接，按值脱敏，≤ 10 000 字符）；`hook_run { outcome: continued }`。继续的请求与其他请求一样经请求前检查（[Goal 预算](goal.md#预算)），预算耗尽时 Run 以 paused + `budget_exhausted` 结束。
- **上限**：每个 Run 至多继续 3 次（运行时执行）。之后 Stop 仍运行，`stop_hook_active` 为 true，block 被忽略：`hook_run { outcome: blocked, message: Ignored: the run already continued 3 times because of Stop hooks }`，Sidecar 记 warn。
- 决定只来自 Hook 进程自己的退出码与 stdout：模型回复中出现的 `{"decision":"block"}` 只是文本。

## 团队事件

[Agent Teams](teams.md#hook) 的三个事件没有 matcher，经 `HookService.taskEvent` / `teammateIdle` 运行，项目 Hook 照常只在批准后运行，结果记为 `hook_run`（Hook 作用域为发起者的 Session）。stdin 在公共字段之外：TaskCreated / TaskCompleted 为 `task_id`、`task_subject`、`task_description`、`teammate_name`（发起者，lead 为 `lead`）与 `team_name`（根 Session id），TeammateIdle 为 `teammate_name` 与 `team_name`。

- **TaskCreated**（`task_create` 提交之前）与 **TaskCompleted**（任务变为 completed 之前）：exit 2 或 `decision: block` 时阻止，`task_create` / `task_update` 为错误结果，原因（stderr 或 reason，按值脱敏，≤ 2 KB）在结果中；不提交条目，任务保持原状态。
- **TeammateIdle**（teammate 的 Run 正常结束之前，在 SubagentStop 之后，SubagentStop 要求继续时不运行）：exit 2 或 `decision: block` 时原因作为一条 user message 送达、Run 继续（`hook_run { outcome: continued }`）；与 SubagentStop 共用每 Run 3 次的继续上限，之后的 block 被忽略并记 warn。

## PreCompact

在手动与自动压缩之前运行（有可摘要的内容时；溢出恢复不运行），matcher 对象为 `manual` / `auto`。

- **手动**（`/compact [指示]`）：在开始 Run 之前运行。exit 2 → HTTP 400 `hook-blocked`（原因为 stderr），不开始 Run、不发摘要请求；`hook_run` 不属于任何 Run。运行时内部的手动压缩被阻止时 Run 以 `error` 加 `RunError.code: hook_blocked` 结束（与 `continue: false` 的 `hook_stopped` 区分；Goal 不因此暂停）。没有可摘要的内容时先 400 `nothing-to-compact`，不运行 Hook。
- **自动**：exit 2 → 跳过本次压缩，请求照常发出（用原上下文）；之后的请求越过阈值时再运行。
- **摘要要求**：exit 0 的 stdout 按文本（不解析 JSON），各 Hook 以空行连接，按值脱敏，至多 4 000 字符，追加到摘要请求的额外要求（手动时排在用户的指示之后）；`hook_run { outcome: context }`。

## Notification

Coko 产生桌面通知时运行（`NotificationService.notify` 先通知 Hook，再按设置决定是否发出：关闭通知总开关或该类别不影响 Hook，不论窗口是否在前台、通知是否显示），matcher 对象为通知类别（`schedule-run-ended`、`approval-waiting`、`agent-finished`）。只观测：exit 2 与 stdout 没有作用，不等待结果，Hook 的失败不影响通知；只有失败（`error`、`timeout`）提交 `hook_run`（不属于任何 Run）。

## continue: false 的停止

任一事件（Notification 与 PreCompact 除外）的 Hook 输出 `continue: false` 时，Run 在本批完成后以 `run_end { status: paused, error: { code: hook_stopped, message: <stopReason 或 Stopped by a hook> } }` 结束（`stopReason` 按值脱敏，≤ 2 KB）；`hook_run { outcome: stopped }`。

- 工具事件与 Stop：进行中的 Run 本批完成后停止（与 Goal 的工具调用上限相同的 stopAfterBatch，第一次为准）；本批的调用照常执行。
- UserPromptSubmit：提交照常（user message 入库、Run 开始），Run 在第一次模型请求之前停止。
- Goal 为 running 时（Goal Round 或用户提交的 Run）发生：Goal 进入 paused（`reason.code` 为 `hook-stopped`），不开始下一轮，用户恢复后照常推进；见 [Goal 的 Run 结束规则](goal.md#阶段与转换)。

## 记录

只有有结果的执行提交 `hook_run` v2：`{ event, hookId, source, plugin?, command, outcome, exitCode?, durationMs, message? }`（v2 的 `source` 增加 `plugin`、另带插件名 `plugin`，`event` 增加三个团队事件；v1 条目原样迁移），`outcome` 为 `blocked` / `asked` / `allowed` / `denied`（PermissionRequest 的拒绝）/ `context` / `continued`（Stop 使 Run 继续）/ `stopped` / `timeout` / `error` / `invalid-output` / `ignored`（项目 Hook 的 allow）。`command` 与 `message`（原因、`systemMessage` 或追加的文本，≤ 2 KB）按值与凭据形态脱敏，条目入库与推送前再经同一脱敏。没有决定的成功执行只记 debug 日志。工具事件与 Stop 的条目归属当前 Run（runId 在第一次模型请求前得知）；UserPromptSubmit、手动 PreCompact 与 Notification 发生在 Run 之外，runId 为 null。

## 协议

- `GET /api/hooks?sessionId=` 或 `?workspaceId=` → `{ enabled, global: { hooks, revision, diagnostics }, project? }`。给出 sessionId 时 `project = { path, entries: [{ hookId, event, matcher?, if?, command, timeout?, digest, approved, changed? }], diagnostics }`，读该 Session 的工作目录；只给 workspaceId 时（新会话草稿）读 Workspace 目录；命令为完整原文。
- `PUT /api/hooks { hooks, expectedRevision }`：整体替换全局配置，返回同形的响应（不含 project）。不合 schema 400；有诊断 400，`details.diagnostics` 为诊断列表；revision 不一致 409 `revision-conflict`。
- `POST /api/hooks/approvals { workspaceId, digest, sessionId? }` → 204。给出 sessionId 时读该 Session 的工作目录（须属于该 Workspace），否则读 Workspace 目录；digest 不在当前项目文件中 409 `digest-mismatch`。

## 界面

- **工具卡**：被 Hook 拦下的调用（`details.hostBlock.by === 'hook'`，运行时写入，工具自身给出的被去掉）在标题行标注"被 Hook 阻止"（title 为命令），明细开头显示该 Hook 的命令；由 PermissionRequest 允许的审批在标题行显示"由 Hook 允许"。
- **时间线**：`hook_run` 为紧凑行：事件名、结论（阻断与失败为警示色）、来源与退出码、命令（单行截断，title 为全文）、message（换行显示）。
- **时间线**的 `hook_run` 行：阻断、拒绝、停止与失败为警示色，要求继续、追加上下文与放行为常规色。
- **设置 → Hooks 分区**（插件分类，MCP 之后）：
  - 能力开关 `hooks.enabled`（写全局能力配置）；关闭时提示下面的配置不会运行。
  - 全局配置：mono 文本框编辑整份 JSON。保存前在本地解析，不是 JSON 或不是对象时行内提示、不发请求；服务端 400 时行内显示诊断（`code` 与原文）、不保存；revision 冲突时提示"已在别处修改"并换成读回的最新内容。保存成功后编辑区换成服务端读回的值。
  - 项目 Hook：当前会话目录（没有会话时为新会话草稿的 Workspace 目录）的项目文件路径与每条 Hook：事件、状态（已批准 / 待批准 / 已改动）、matcher、if、超时与完整命令（换行显示，不截断）；未批准的有"批准"按钮。分区每次打开时读取，文件改动后重新打开即可看到。
  - 已加载的 Hook：全局 Hook 与已批准的项目 Hook，按事件分组（事件顺序同协议），每行来源、matcher 与命令（单行截断，title 为全文）。

## 验证

- `packages/agent/src/extensions/hooks/hooks.test.ts`：配置解析与每种诊断、matcher、if（复合命令）、输出解释、聚合与组合表每一行（表驱动）。
- `packages/agent/src/policy/gate-hooks.test.ts`：运行时中的组合（Hook deny 在 full-access 下、allow 免掉第 7 步、对手用例：allow 不免掉询问规则 / 受保护路径 / 越出可写根，ask 不随模式放宽消失）与 PermissionRequest 的三种结论。
- `apps/server/src/adapters/hook-runner.test.ts`：stdin、环境过滤、输出上限、忽略 SIGTERM 时 2 秒后 SIGKILL 与登记释放（darwin）。
- `tests/integration/sidecar-hooks.test.ts`：真实 Sidecar 与 Hook 夹具，覆盖上述事件、并行聚合、超时与进程组终止（darwin）、非法输出、项目 Hook 的批准与改动、能力开关与对手用例（含提权与 plan-exit、伪造的 Hook JSON、`if: Bash(rm *)` 的 guard）。
- `tests/integration/sidecar-hooks-lifecycle.test.ts`：真实 Sidecar 与内联 bash Hook，覆盖 UserPromptSubmit（400 `hook-blocked` 且没有 user message 与 run_start、`<hook-context>` 块、continue: false、定时任务与 Goal Round 不运行）、Stop（继续与 stop_hook_active、第 4 次忽略、伪造的 Hook JSON 不继续、暂停与停止不运行）、PreCompact（手动 400 与 stdout 追加、自动跳过、溢出不运行）、Notification（输入字段、matcher、失败不影响通知）、PreToolUse 的 continue: false（含 Goal Round），以及对手用例：Stop 持续 block 时 Goal 的 maxTokens 在继续的请求前生效、未批准的项目 UserPromptSubmit 不运行、改动后为已改动。
- `apps/server/src/application/hooks.test.ts`：Stop 与 UserPromptSubmit 在子 Session 中不运行。
- `tests/integration/sidecar-teams-hooks.test.ts`：TaskCreated exit 2 时没有 `team_task` 条目、TaskCompleted exit 2 时任务保持 in_progress、TeammateIdle 的继续与第 4 次忽略、三个事件的 stdin、未批准的项目 Hook 不运行。
- `tests/integration/secrets-gate-hooks.test.ts`：Hook 的 stdin 记录、`hook_run`、`<hook-feedback>`、WS、库、日志与 faux requestLog 中没有登记明文，Hook 环境中没有 Secret；提示中输入的 Secret 在 UserPromptSubmit 的 stdin 与 requestLog 中为脱敏值，`<hook-context>` 与 Stop 反馈中的 Secret 在全部通道中替换。
- `apps/desktop/src/renderer/features/conversation/{tool-cards,hook-row}.browser.test.tsx`、`timeline.test.ts`、`features/settings/hooks-section.browser.test.tsx`、`stores/hooks-store.test.ts`：界面与 store（含明暗主题下状态文字的对比度与键盘批准）。
- `apps/desktop/e2e/hooks.e2e.test.ts`：真实 Electron 中的 Hooks 分区（诊断、读回、冲突、批准、已改动、开关、明暗主题与键盘）。

## 延伸阅读

- [权限判定与审批](permissions.md)：判定顺序、审批条目与审批卡。
- [分层配置](configuration.md)：项目设置文件与能力开关。
- [上下文管理](context.md#hook-追加的上下文)：Hook 追加给模型的文本与压缩前的 Hook。
- [Goal](goal.md#预算)：继续的请求与预算检查。
- [命令执行与子进程登记](execution.md)：进程登记、孤儿清理与有序关闭。
