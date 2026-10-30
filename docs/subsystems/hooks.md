---
kind: reference
description: "当前的外部 Hook 契约：配置形状与诊断、全局与项目 Hook（逐条批准、只收紧）、能力开关、matcher 与 if、执行（bash -c、进程组、登记、环境、超时与输出上限）、PreToolUse 与判定的组合表、PermissionRequest、PostToolUse(Failure) 的追加上下文、hook_run 条目、/api/hooks 与界面。修改 Hook 的配置、执行、组合或记录前查阅。"
lifecycle: active
---

# 外部 Hook

本文说明 Coko 当前如何在工具调用前后运行用户配置的命令：Hook 可以拒绝、要求确认或放行一次调用，也可以向工具结果追加给模型的文本。Hook 只能收紧判定，放行越不过规则、受保护路径、沙箱提权与计划审阅，取舍见 [ADR 0013](../adr/0013-external-hooks-tighten-only.md)。判定顺序见 [权限判定与审批](permissions.md#判定)；进程登记见 [命令执行与子进程登记](execution.md)。

当前交付的事件为 PreToolUse、PermissionRequest、PostToolUse 与 PostToolUseFailure。UserPromptSubmit、Stop、SubagentStart / SubagentStop、PreCompact 与 Notification 已在配置与协议中声明（配置可以写，解析不报诊断），但还没有调用方，配置了也不会运行；设置中的 Hooks 分区也尚未交付。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/extensions/hooks/config.ts` | `parseHooksConfig(value, source, { parseRule?, path? })` → 加载的 Hook 与诊断；`hookDigest`、`hookTimeoutMs` |
| `packages/agent/src/extensions/hooks/matcher.ts` | `matcherMatches`、`selectHooks(hooks, event, { names, matchesRule })` |
| `packages/agent/src/extensions/hooks/output.ts` | `interpretHookResult(event, result)`：退出码与 stdout 的解释 |
| `packages/agent/src/extensions/hooks/combine.ts` | `aggregateVerdict`（deny > ask > allow）与 `combinePreToolUse`（组合表） |
| `packages/agent/src/policy/gate.ts`、`broker.ts` | gate 中运行 PreToolUse 与 PermissionRequest 并按组合表处理；`recordHookAllowed` 提交由 Hook 回答的审批 |
| `packages/protocol/src/hooks.ts` | `hook_run` payload、`HooksConfig`、`HooksResponse`、`UpdateHooksRequest`、`ApproveHookRequest`、`hookPaths`、设置键 |
| `apps/server/src/application/hooks.ts` | `HookService`：全局配置、项目 Hook 与批准、执行与记录、权限端口与观察 hook |
| `apps/server/src/application/context/hooks.ts` | 上下文贡献：每个 Run 一份 Hook 状态，给出 `permissionHooks` 与 `observeHooks` |
| `apps/server/src/adapters/hook-runner.ts` | 执行端口：`/bin/bash -c`、进程组、登记、环境、超时与输出上限 |
| `apps/server/src/http/routes/hooks.ts` | `GET / PUT /api/hooks`、`POST /api/hooks/approvals` |
| `apps/desktop/src/renderer/features/conversation/hook-row.tsx`、`tool-cards.tsx` | 时间线的 `hook_run` 紧凑行；工具卡的"被 Hook 阻止"与"由 Hook 允许" |
| `apps/desktop/src/renderer/stores/hooks-store.ts` | renderer 的 Hook 视图（读取、保存全局配置、批准项目 Hook） |

## 配置

形状与 claude-code 相同：

```json
{
  "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "./guard.sh", "if": "Bash(rm *)", "timeout": 5 }] }]
}
```

- **全局**：设置键 `hooks`，只能经 `PUT /api/hooks` 修改（通用设置接口对 `hooks` 及其下的键 400）。
- **项目**：`<cwd>/.coko/settings.json` 的 `hooks` 键（与项目设置同一文件、同样按 mtime 读取，见 [分层配置](configuration.md#项目设置文件)）。worktree 会话读该 worktree 中的文件，批准按其 Workspace 判定。
- **能力开关** `hooks.enabled`（缺省 true）只在全局设置生效，关闭后全局与项目 Hook 都不运行；项目文件中的 `hooks.enabled` 以 `project-cannot-grant` 忽略，关不掉全局 Hook。

解析不抛出，问题作为诊断 `{ source: 'config', code, message, path? }` 返回，其余 Hook 照常加载：

| code | 何时 | 结果 |
| --- | --- | --- |
| `unsupported-hook-type` | `type` 不是 `command` | 忽略该 Hook |
| `unknown-event` | 不是支持的事件名 | 忽略该事件 |
| `invalid-matcher` | matcher 不是字符串，或不是名字、名字列表也不能编译为正则 | 忽略该组 |
| `invalid-if` | `if` 不是合法的权限规则文本（`Tool` 或 `Tool(content)`） | 忽略该 Hook |
| `invalid-value` | 根、事件值、组或 Hook 的形状不对；命令为空；超时不是 1–600 的整数 | 忽略该项 |

`hookId` 为 `<source>:<event>:<组序号>:<序号>`；`digest` 为 event、matcher、if、command、timeout 的 SHA-256。

## 项目 Hook 的批准

未批准的项目 Hook 不运行。批准按 Workspace 与 digest 保存在设置键 `hooks.approvals.<workspaceId>`（digest 列表）；项目文件中任一字段改动后 digest 变化，回到未批准。项目 Hook 的 allow 不参与聚合（只收紧），记录为 `allowed` 并注明 `Ignored: a project hook cannot allow a call`。

## 选择

每个 Run 在第一次需要时加载一次生效的 Hook（全局 Hook 加上已批准的项目 Hook）；Run 进行中修改配置或批准，从下一个 Run 生效。

- **matcher**（工具事件）：对象为工具注册名与规则组名（例如 `bash` 与 `Bash`、`write` 与 `Edit`），不区分大小写。省略、空与 `*` 匹配全部；只含字母、数字、`_` 与 `|` 时按名字或名字列表；其余按正则（不区分大小写）。
- **if**（工具事件）：与一条拒绝规则相同的匹配器（[规则语法](permissions.md#判定)）：Bash 复合命令的任一子命令命中即匹配（`Bash(rm *)` 命中 `echo ok && rm x`），路径按解析前或真实路径。

同一事件的匹配 Hook 并行执行。

## 执行

`/bin/bash -c <command>`，cwd 为 Session 的工作目录，独立进程组，登记为 kind `hook`（带 sessionId），进程组消失后删除登记。不经 Seatbelt：Hook 与已批准的 MCP stdio Server 处于同一信任级别。

- **环境**：Sidecar 的基础环境去掉 `COKO_*` 与凭据形态的变量（与 bash 工具相同），另加 `COKO_PROJECT_DIR`（工作目录）、`COKO_SESSION_ID`、`COKO_HOOK_EVENT`；不注入 Secret。
- **stdin**：一行 JSON 后关闭。公共字段 `session_id`、`cwd`、`hook_event_name`、`permission_mode`；子 Session 另有 `parent_session_id`、`agent_type`。工具事件另有 `tool_name`（注册名）、`tool_input`、`tool_use_id`，PostToolUse(Failure) 另有 `tool_response`（`{ content, details? }`）与失败时的 `error`。整行按值替换登记明文后写入。
- **输出**：stdout 与 stderr 各保留前 64 KB。
- **超时**：缺省 60 秒（Notification 10 秒），配置上限 600 秒。超时或有序关闭时向进程组 SIGTERM，2 秒后仍有进程则 SIGKILL。

结果的解释：

| 进程结果 | 结论 |
| --- | --- |
| exit 2 | PreToolUse / PermissionRequest：拒绝，stderr 为原因；PostToolUse(Failure)：stderr 追加到结果 |
| exit 0，stdout 为 JSON | 按字段（下文）；没有决定字段时没有决定 |
| exit 0，stdout 为空 | 没有决定 |
| exit 0，stdout 不是 JSON 对象，或决定字段的值不合法 | 没有决定，记 `invalid-output` |
| 其他退出码、被信号终止、启动失败 | 没有决定，记 `error` |
| 超时 | 没有决定，记 `timeout` |

JSON 字段（名字沿用 claude-code）：PreToolUse 为 `hookSpecificOutput.permissionDecision`（`allow` / `deny` / `ask`）与 `permissionDecisionReason`，也接受旧写法 `decision: approve / block` 与 `reason`；PermissionRequest 为 `hookSpecificOutput.decision { behavior: allow / deny, message? }`；PostToolUse(Failure) 为 `hookSpecificOutput.additionalContext`。`systemMessage` 只显示给用户（`hook_run.message`）；`continue: false` 记为 `stopped`，但停止 Run 尚未接入。

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

## 记录

只有有结果的执行提交 `hook_run` v1：`{ event, hookId, source, command, outcome, exitCode?, durationMs, message? }`，`outcome` 为 `blocked` / `asked` / `allowed` / `denied`（PermissionRequest 的拒绝）/ `context` / `stopped` / `timeout` / `error` / `invalid-output`（`continued` 留给生命周期事件）。`command` 与 `message`（原因、`systemMessage` 或追加的文本，≤ 2 KB）按值与凭据形态脱敏，条目入库与推送前再经同一脱敏。没有决定的成功执行只记 debug 日志。条目归属当前 Run（runId 在第一次模型请求前得知）。

## 协议

- `GET /api/hooks?sessionId=` → `{ enabled, global: { hooks, revision, diagnostics }, project? }`。给出 sessionId 时 `project = { path, entries: [{ hookId, event, matcher?, if?, command, timeout?, digest, approved }], diagnostics }`，读该 Session 的工作目录，命令为完整原文。
- `PUT /api/hooks { hooks, expectedRevision }`：整体替换全局配置，返回同形的响应（不含 project）。不合 schema 400；有诊断 400，`details.diagnostics` 为诊断列表；revision 不一致 409 `revision-conflict`。
- `POST /api/hooks/approvals { workspaceId, digest, sessionId? }` → 204。给出 sessionId 时读该 Session 的工作目录（须属于该 Workspace），否则读 Workspace 目录；digest 不在当前项目文件中 409 `digest-mismatch`。

## 界面

- **工具卡**：被 Hook 拦下的调用（`details.hostBlock.by === 'hook'`，运行时写入，工具自身给出的被去掉）在标题行标注"被 Hook 阻止"（title 为命令），明细开头显示该 Hook 的命令；由 PermissionRequest 允许的审批在标题行显示"由 Hook 允许"。
- **时间线**：`hook_run` 为紧凑行：事件名、结论（阻断与失败为警示色）、来源与退出码、命令（单行截断，title 为全文）、message（换行显示）。
- `hooks-store.ts` 提供读取、保存（revision 冲突时读回）与批准；设置 → Hooks 分区尚未交付。

## 验证

- `packages/agent/src/extensions/hooks/hooks.test.ts`：配置解析与每种诊断、matcher、if（复合命令）、输出解释、聚合与组合表每一行（表驱动）。
- `packages/agent/src/policy/gate-hooks.test.ts`：运行时中的组合（Hook deny 在 full-access 下、allow 免掉第 7 步、对手用例：allow 不免掉询问规则 / 受保护路径 / 越出可写根，ask 不随模式放宽消失）与 PermissionRequest 的三种结论。
- `apps/server/src/adapters/hook-runner.test.ts`：stdin、环境过滤、输出上限、忽略 SIGTERM 时 2 秒后 SIGKILL 与登记释放（darwin）。
- `tests/integration/sidecar-hooks.test.ts`：真实 Sidecar 与 Hook 夹具，覆盖上述事件、并行聚合、超时与进程组终止（darwin）、非法输出、项目 Hook 的批准与改动、能力开关与对手用例（含提权与 plan-exit、伪造的 Hook JSON、`if: Bash(rm *)` 的 guard）。
- `tests/integration/secrets-gate-hooks.test.ts`：Hook 的 stdin 记录、`hook_run`、`<hook-feedback>`、WS、库、日志与 faux requestLog 中没有登记明文，Hook 环境中没有 Secret。
- `apps/desktop/src/renderer/features/conversation/{tool-cards,hook-row}.browser.test.tsx`、`stores/hooks-store.test.ts`：界面与 store。

## 延伸阅读

- [权限判定与审批](permissions.md)：判定顺序、审批条目与审批卡。
- [分层配置](configuration.md)：项目设置文件与能力开关。
- [命令执行与子进程登记](execution.md)：进程登记、孤儿清理与有序关闭。
