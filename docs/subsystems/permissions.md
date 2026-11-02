---
kind: reference
description: "当前的权限判定与审批契约：五种模式（含 plan）、权限类与额外读取根、判定顺序、规则语法与作用域（含只读的 project 作用域）、受保护路径、ApprovalBroker 状态与重新判定、审批条目、协议路由、拒绝语义、命令沙箱（Seatbelt）与单次提权、审批卡与模式选择。修改判定、规则、审批流程、沙箱或权限界面前查阅。"
lifecycle: active
---

# 权限判定与审批

本文说明当前代码中工具调用如何被判定、需要审批时如何等待与回答、规则与模式如何保存，以及命令如何在模式对应的 Seatbelt 沙箱档位内运行、被拒后如何单次提权。长期取舍（模式与沙箱叠加、提权不可保存）见 [ADR 0005](../adr/0005-permission-mode-and-sandbox.md)；本文只描述已实现的部分。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/policy/decide.ts` | 纯函数 `decide(call, { mode, rules, workspace, writableRoots, readRoots?, home? })` → allow / deny / ask（附建议规则）；权限类 `PermissionClass` |
| `packages/agent/src/tools/registry.ts` | `RegisterToolOptions.permissionClass`：宿主注册工具时给出权限类，`ToolRegistry.permissionClass(name)` 读回 |
| `packages/agent/src/policy/rules.ts` | 规则内容的匹配：bash 拆分、env 前缀剥离、精确 / 前缀；gitignore 风格路径 |
| `packages/agent/src/policy/paths.ts` | 把工具参数解析为绝对路径与真实路径（经符号链接，含悬空链接）；模式对应的可写根（委托 sandbox.ts） |
| `packages/agent/src/policy/sandbox.ts` | 模式 → Sandbox Mode、可写根的唯一推导、提权参数校验 `checkEscalation`、模型可见的拒绝标记与提示文本 |
| `packages/agent/src/ports/exec.ts`、`local-exec.ts` | `ExecRequest.sandbox`、`SandboxUnavailableError`；本地执行经宿主给出的 `LocalSandbox` 包裹受限命令，没有时 fail-closed |
| `apps/server/src/adapters/seatbelt.ts` | Seatbelt profile、启动探测、`sandbox-exec -p <profile> --` 包裹 |
| `packages/agent/src/policy/broker.ts` | `ApprovalBroker`：每个运行时一个，提交请求与决定条目，等待回答或重新判定；`recordHookAllowed` 提交由 PermissionRequest Hook 回答的请求 |
| `packages/agent/src/policy/gate.ts` | 权限 hook，位于 `ToolHooks.beforeToolCall` 链首；执行前复核 `recheck`；本 Run 的沙箱拒绝记录；模型可见的拒绝文本 |
| `packages/agent/src/engine/runtime.ts`、`permission-wiring.ts` | `AgentRuntimeOptions.permissions`（每次调用读取模式与规则）、`answerApproval()`、`pendingApprovals`；调度器的执行前准备（复核、沙箱档位、Secrets、读取过滤，在 `permission-wiring.ts`） |
| `packages/agent/src/tools/builtin/read-filter.ts` | grep、find、ls 不列出被 Read 拒绝规则覆盖的路径 |
| `packages/protocol/src/permissions.ts` | 条目 payload、协议 DTO、`permissionPaths`、设置键、规则文本 `formatPermissionRule` / `parsePermissionRule` |
| `apps/server/src/application/permissions.ts` | `PermissionService`：默认模式、全局与 Workspace 规则的读入、缓存与写入；经 `ProjectRuleSource`（`ConfigService`）取只读的 project 规则 |
| `apps/server/src/application/session-permissions.ts` | Session 模式与规则的回放、同一 Session 的修改串行、保存"总是允许"、触发重新判定 |
| `apps/server/src/application/sessions.ts`、`session-runs.ts` | Session `activity`；每个 Run 开始时把上下文装配给出的工具（带权限类）与额外读取根交给运行时（`session-runs.ts`）；规则工具名来自各贡献的 `ruleTools` |
| `packages/ui/src/approval/approval-card.tsx` | 共享审批卡（键盘、单次回答、"总是允许"菜单） |
| `apps/desktop/src/renderer/features/conversation/approval-panel.tsx` | 审批卡的业务组合：标题、命令 / 路径 / diff 摘要、建议规则；提权卡（目标档位与理由） |
| `apps/desktop/src/renderer/features/conversation/mode-picker.tsx` | 输入区的模式选择与 Shift+Tab 循环顺序 |
| `apps/desktop/src/renderer/features/settings/permissions-section.tsx` | 设置页的 Permissions 分区 |

工具契约（`packages/agent/src/tools/types.ts`）有 `effect: 'read' | 'side-effect'`（缺省 side-effect）、`permissionSubject(args)` 与 `sandboxRequest(args)`（提权参数，只有 bash 声明）。内置工具：read、grep、find、ls 为 read，subject 是路径（缺省 `.`）；write、edit 为 side-effect，subject 是路径；bash 为 side-effect，subject 是命令。

## 模式

每个 Session 有一个 Permission Mode。模式决定判定中的"模式放行"一步（其余各步在所有模式下相同），也决定命令的沙箱档位；write / edit 的写入边界与 Seatbelt 使用同一组可写根。

| 模式 | 模式放行 | 命令的沙箱档位 | 可写根（write / edit 与命令共用） |
| --- | --- | --- | --- |
| read-only | Workspace 内的 read 组调用 | read-only | 无：文件写入都按越出可写根询问，命令不能写任何位置 |
| default | Workspace 内的 read 组调用 | workspace-write | 本 Run 的 Workspace 根集合、`/tmp`、`os.tmpdir()` 的真实路径 |
| accept-edits | 另加可写根内的 write / edit | workspace-write | 同 default |
| full-access | 全部调用 | danger-full-access（不包裹） | `/` |
| plan（M4） | 与 read-only 相同 | read-only | 无 |

**权限类（M3）。** 宿主注册工具时给出权限类（`RegisterToolOptions.permissionClass`），工具对象自身不能声明（工具上的同名属性被忽略）。内置工具按名字归入 read、edit、bash，不受宿主给出的类影响；其他类在"模式放行"一步的行为：

| 权限类 | 工具 | 模式放行 |
| --- | --- | --- |
| context-read | skill、memory_list、list_mcp_resources、list_mcp_resource_templates、read_mcp_resource | 所有模式都放行 |
| memory-write | memory_write、memory_delete（规则组名 `Memory`） | accept-edits 与 full-access |
| external | `mcp__<server>__<tool>`；没有给出类的 `mcp__` 名字同样按 external | 只有 full-access |
| session-state（M4） | 只改本 Session 状态的工具：todo_write、create_goal、update_goal、job_kill | 所有模式都放行（含 read-only 与 plan） |
| plan-exit（M4） | exit_plan_mode | 无：任何模式都询问且不建议规则，允许规则不生效 |
| agent（M5） | agent（规则组名 `Agent`，内容为子代理类型；建议规则为 `Agent(<类型>)`） | 所有模式都放行；带 `isolation: 'worktree'` 时只有 full-access 放行，其余询问 |
| automation（M5） | schedule_create、schedule_update（规则组名 `Schedule`） | 只有 full-access |
| lsp（M6） | lsp（规则组名 `Lsp`）；判定对象为 `file_path`，与 read 同一套路径判定，`Read` 的拒绝、询问与允许规则同样适用 | 与 read 相同：Workspace 与额外读取根内所有模式放行，越出询问（`outside-workspace`，建议规则为 `Lsp(<路径>)`） |
| team（M6） | send_message、task_create、task_update、task_list（规则组名 `Team`） | 所有模式都放行；拒绝与询问规则照常生效 |
| bash（M4 增加） | job_input（判定对象为终端当前行加写入的 text，与 bash 命令同一套规则，规则组名 `Bash`；Job 启动时的沙箱宽于当前模式时 plan / read-only 拒绝、其余模式按提权询问，见 [PTY 与 stdin](execution.md#pty-与-stdin)） | 与 bash 相同 |

M5 的 agent_wait、schedule_list 按 context-read，agent_cancel、schedule_delete 按 session-state 注册（子代理与定时任务）。M6 的 lsp 与 team 两类已进入判定与规则名的归一（`canonicalRuleTool('lsp')` 为 `Lsp`）；`lsp` 工具由代码智能在有语言服务器时注册（见 [代码智能](lsp.md#权限与脱敏)），team 的工具尚未注册；带 `name` 的 agent 调用（teammate）与 agent 同类。子 Session（子代理）没有自己的模式与规则：每次判定时取根 Session 当前模式（plan 按 read-only）与定义 `permission-mode` 中较窄者，规则为根 Session 的规则加全局、Workspace 与 project 规则；根切换模式时子级的待审批请求重新判定，"本会话总是允许"写入根 Session，子 Session 的模式与规则接口返回 409 `child-session`。子代理保留的 isolation worktree 在父 Session 中另有不入库的询问规则 `Read(<path>)`。见 [子代理](subagents.md#有效权限与审批)。没有权限类的其他宿主工具照旧只在 full-access 放行。拒绝与询问规则对所有类照常生效。MCP Server 的工具由上下文装配以 external 注册（effect 一律 side-effect），规则可写全名或 `mcp__<server>`；连接与工具适配见 [MCP Server 连接与工具](mcp.md#工具)。session-state 的工具由 Todo、Goal 与后台任务注册；plan-exit 的 `exit_plan_mode` 只在 plan 模式的 Run 中注册，询问不受允许规则免除，拒绝规则照常生效，审批为 kind plan（见下文与 [Plan Mode](plan-mode.md)）。

## 每个 Run 的 Workspace 根

[SessionRuns](../../apps/server/src/application/session-runs.ts) 在 Run 准入时读取根 Session 的当前项目归属，取固定工作目录与该项目全部源文件夹的真实路径，去重并冻结为本次 Run 的 Workspace 根集合。子 Session 沿持久化父链取根会话归属；独立对话没有附加根，从别处移入项目的对话还包含项目主要文件夹。项目文件夹编辑或会话移入、移出仅影响下一个 Run，正在运行的工具和已经启动的 Job 保留自己的范围。

`RuntimePermissions.workspaceRoots()` 把同一份快照同时交给读取判定、文件写入边界与命令准备阶段的 Seatbelt 可写根；default 的读取免审批、写入仍询问，accept-edits 允许可写根内普通写入，read-only / plan 仍无可写根。模式和规则继续在每次调用时读取，目录集合不随待审批请求的重新判定改变。执行目录、相对规则锚点及按 Workspace 保存的批准和记忆保持原绑定。

worktree 会话始终排除其来源主检出；项目移动、主要文件夹更换以及包含来源主检出的重叠附加根不会重新授予主检出。固定 cwd 仍属于根集合，其他与来源仓库相交的项目根不加入。此行为见 [Worktree](worktrees.md#会话绑定与工作目录)。指令文件、项目设置、Hook、MCP 与 Skills 仍只由 cwd 发现，附加文件夹只授予文件能力。

拒绝和询问规则仍先于模式；受保护路径照常询问，受限命令仍不能写入。文件目标每次经真实路径解析，附加根中指向外部的符号链接不扩大权限；批准后目标被换成链接时仍执行写入前复核。配置发现与 Skill 读取根不因此成为可写根。

**额外读取根。** `RuntimePermissions.readRoots()`（每次判定现取，按真实路径比较）给出 Workspace 之外的读取根（Skill 目录）：其下的 read 组调用与 Workspace 内读取同样处理（各模式放行，不报 `outside-workspace`）。它不放开写入与命令，Read 拒绝规则仍生效。

workspace-write 在本 Run 的 Workspace 根集合之外，还允许 DSH `packages/sandbox` 的系统临时目录：不含主目录及其下的包管理缓存（`~/.npm`、`~/.cache` 等），写这些位置的命令被拒绝后需要提权或切换模式。

**plan（Plan Mode）。** 判定与 read-only 相同，命令沙箱 read-only；进入时 `permission_mode`（v2）带 `prior`（进入前的模式，已在 plan 时不变），`/plan off`、Plan chip 与批准计划回到它；从 plan 选择其他模式即退出。默认模式只能是四档之一；Shift+Tab 循环不含 plan。完整契约见 [Plan Mode](plan-mode.md)。

新 Session 创建时提交一条 `permission_mode` 条目，取设置 `permissions.defaultMode`（缺省 default）；之后改默认模式不影响已有 Session。没有 `permission_mode` 条目的旧 Session 按 default。切换模式提交新的 `permission_mode` 条目（与当前相同时不提交），立即作用于下一次调用。

## 判定

判定只看工具名所属的组：read 组（read、grep、find、ls）、edit 组（write、edit）、bash、Memory 组（memory-write 类）；其他名字（宿主新增的工具）按原名判定。规则以组名书写：`Read`、`Edit`、`Bash`、`Memory`，`skill` 工具为 `Skill`（内容为 Skill 名，见 [Skills](skills.md#权限)），宿主工具用注册名。规则 `mcp__<server>` 匹配该 Server 的全部工具（`mcp__<server>__*`），不匹配名字以它开头的其他 Server（`mcp__srv` 不匹配 `mcp__srv2__x`）。

**工具名的写法。** 经 `/api/permissions` 与 `…/permission-rules` 写入时，工具名归一为规范名（`canonicalRuleTool`）：内置工具名与组名不区分大小写归为组名（`bash` → `Bash`，`write` / `edit` → `Edit`，`grep` → `Read`，`skill` → `Skill`，后者即使本次 Run 未注册 skill 工具也接受），宿主工具按注册名不区分大小写匹配；按 Run 贡献的工具即使当前未注册也接受（`memory_write` / `memory_delete` → `Memory`，`memory_list`、`list_mcp_resources`、`list_mcp_resource_templates`、`read_mcp_resource` 按原名；之后新增的贡献工具在 Run 开始时登记）；`mcp__` 开头的名字即使当前未注册也原样接受（Server 可能尚未连接）；都不是时 400 `bad-request`，`details = { reason: 'unknown-tool', tool }`，设置分区在输入框下行内提示。库中已有的非规范写法在读入时归一；`decide` 也按组名、不区分大小写比较，旧规则不会静默失效。

**判定步骤。** `decideWithStep` 另给出作出判定的步骤：`deny-rule`、`ask-rule`、`protected`（受保护路径）、`outside-writable`（越出可写根，或没有目标的写入）、`mode`（模式放行；plan-exit 的总询问也记在这一步）、`allow-rule`、`default`（模式与规则都没有放行的询问）。`decide` 只返回判定。

**外部 Hook 的位置（M5）。** 权限 gate 接受 `PermissionHookPort { preToolUse, permissionRequest }`，由 Hook 的上下文贡献给出（[外部 Hook](hooks.md)，[ADR 0013](../adr/0013-external-hooks-tighten-only.md)）。PreToolUse 对每次调用在判定结果生效之前运行：Hook 的 deny 优先于一切（`Blocked by hook: <reason>`，结果带 `details.hostBlock { by: 'hook' }`）；之后是规则拒绝；第 2–4 步、提权与 plan-exit 的询问不能被 Hook 的 allow 免掉；Hook 的 ask 强制询问且没有建议规则（等待中模式放宽不使它消失）；Hook 的 allow 只能放行第 7 步的询问，与一条允许规则同位。最终为第 7 步的询问时，出卡片之前运行 PermissionRequest：deny 拒绝，allow 提交 `approval_request` 与 `approval_decision { by: hook }` 后执行，其余出卡片。没有 Hook 或 Hook 没有决定时 gate 的行为与之前相同。

顺序固定（ADR 0005）：

1. 拒绝规则 → deny，模型收到 `Permission denied by rule …`，Run 继续。
2. 询问规则 → ask（没有建议规则）。
3. edit 组写入受保护路径 → ask，没有建议规则；允许规则与模式都不能免掉。
4. edit 组写入越出可写根 → ask，没有建议规则（这次批准即这次提权）。
5. 模式放行（上表）。
6. 允许规则 → allow。
7. 其余 → ask。read 组读取 Workspace 与额外读取根之外为 `outside-workspace`，其他为 `approval-required`。

路径按真实路径判定：Workspace 内指向外部的符号链接按外部位置处理；Workspace 与可写根也是真实路径。

**受保护路径**：任意深度的 `.git`、`.coko`、`.vscode`、`.idea` 目录，以及任意位置的 `.bashrc`、`.zshrc`、`.profile`、`.bash_profile`、`.zprofile`、`.gitconfig`、`.ssh`、`.mcp.json`。比较前转小写；解析前或解析后的路径任一命中即受保护。判定只约束 edit 组（bash 的写入目标无法预知）；受限档位的命令由 Seatbelt 在可写根之下拒绝写入这些路径段（见下节），full-access 不受限制。

**目录工具与 Read 拒绝规则。** grep、find、ls 的判定对象是搜索根；拒绝规则覆盖搜索根之下的路径时，调用照常放行，结果中不列出被覆盖的文件（find 不进入被覆盖的目录），末尾注明 `[N path(s) omitted: denied by permission rules]`。按每个结果的路径与经搜索根真实路径换算后的路径判定。不带内容的 `Read` 拒绝规则在判定时就拒绝整个调用。

## 命令沙箱与提权

**档位与执行。** bash 每次执行时按当时的模式现算沙箱策略 `{ mode, writableRoots }`，经执行上下文（`ToolExecutionContext.sandbox`）交给执行端口。Sidecar 的 bash 由 `adapters/seatbelt.ts` 包裹为 `/usr/bin/sandbox-exec -p <profile> -- /bin/bash -c <command>`：

```text
(version 1) (allow default) (deny file-write*) (allow file-write* (literal "/dev/null")) (allow file-write* (subpath "<root>") …)
(deny file-write* (regex #"^/(.*/)?([.][gG][iI][tT]|…)(/|$)") …)
```

SBPL 中后出现的规则优先：workspace-write 在可写根之后，对绝对路径任意深度的受保护路径段（与判定相同的集合 `PROTECTED_PATH_NAMES`，不区分大小写）追加 deny，被拒后走提权。受保护段的正则不拼入用户提供的根路径，因此带引号、反斜杠、`]` 或 `^` 的文件夹仍受保护。read-only 没有 subpath；danger-full-access 不包裹。沙箱只约束文件写入，不限制网络与读取。经审批或允许规则放行的命令同样在本档位内运行。

**拒绝。** 受限命令非零退出且输出含 `operation not permitted`（大小写不敏感）时视为被沙箱拒绝：结果在退出码之前追加拒绝标记 `[sandbox: file access denied under <mode> mode]` 与提权提示（文本沿用 DSH，属于模型可见契约），`details.sandbox = { mode, denied: true }`；工具卡标题行显示"被沙箱拦截（档位）"。

**不可用（fail-closed）。** 启动时以 read-only profile 运行一次 `sandbox-exec … -- /usr/bin/true`；失败或可执行文件不存在（非 macOS）时记 warn `command sandbox unavailable`，Sidecar 照常启动。此后受限档位的命令不运行，结果为 `sandbox-unavailable: the command was not run because the <mode> sandbox is not available …`；full-access 不受影响。运行时包裹的可执行文件消失（spawn 报 ENOENT / EACCES）按同样方式处理。`@coko/agent` 的内置本地执行没有沙箱：宿主不提供 `LocalSandbox` 时受限档位一律 fail-closed。

**提权参数。** bash 有可选参数 `sandbox_permissions`（`workspace-write` / `danger-full-access`）与 `justification`。判定在拒绝规则之后：

| 参数 | 结果 |
| --- | --- |
| 都不给，或只有空白理由 | 不提权，按普通判定 |
| 档位等于当前档位 | 不提权（理由可缺），按普通判定 |
| 只给理由；只给档位或理由为空白；档位更窄 | 参数错误，调用不执行，不询问，Run 继续 |
| 档位不在取值内（如 `read-only`） | pi 的参数校验错误，不询问 |
| 严格更宽，但本 Run 中同一命令（合并空白后）没有被沙箱拒绝过 | 参数错误 `invalid escalation: sandbox_permissions only retries a command the sandbox denied in this run …`，不询问也不执行 |
| 严格更宽，且同一命令本 Run 中被沙箱拒绝过 | kind=escalation 的审批请求，替代该次调用的普通审批 |

**提权请求。** `approval_request { kind: 'escalation', subject: 命令, targetMode, justification, suggestions: [] }`。拒绝规则仍然先生效；允许规则与模式放行不能免掉提权审批。只能允许一次（scope 非 once 时 400）或拒绝；不随模式或规则变更重新判定。允许后该调用以目标档位（执行时模式档位更宽则取后者）运行，只对这一次调用有效，Run 结束时未用掉的授权作废。无反馈拒绝：调用得到 `The user rejected escalating this command to "<mode>"; it stays denied, so stop and explain instead of working around it.`，与普通无反馈拒绝一样 Run 在本批结束后以 aborted 结束；带反馈的拒绝把反馈交给模型，Run 继续。

**执行前复核。** pi 先逐个准备整批调用再执行，判定与执行之间同批前面的调用（例如 bash 新建符号链接）可能改变写入目标。write / edit 取得执行槽之后、提交 `tool_exec` 之前，按执行时的真实路径复核：与判定时相同则照常执行；不同则按当时的模式与规则重新判定，deny 时以规则拒绝、ask 时再提出一次审批（允许、拒绝与暂停的语义同上），被拒绝的调用不执行、不提交 `tool_exec`。复核期间暂停时该调用为"暂停前未批准"。

**write / edit 的提权。** 它们在 Sidecar 进程内执行，没有 Seatbelt；越出可写根的写入按判定第 4 步询问（kind=tool，没有建议规则，只能允许一次），这次批准即这次提权。

## 规则

规则是 `{ behavior: allow | ask | deny, tool, content? }`，文本形式为 `Tool` 或 `Tool(content)`（内容中的括号与反斜杠以反斜杠转义）。不带内容的规则匹配该工具的任何调用。

**Bash**：内容为精确命令，或以 ` *` 结尾的前缀（`git *` 匹配 `git` 与 `git …`，不匹配 `gitk`）；单独的 `*` 匹配任何命令。比较前合并空白。

- 复合命令按引号规则在 `&&`、`||`、`;`、`|`、`&`、换行处拆成子命令（`2>&1`、`&>`、`>|` 是重定向，不拆）。
- 子命令开头的 `NAME=value` 赋值被剥离后再匹配；`LD_*`、`DYLD_*`、`PATH`、`BASH_ENV`、`ENV`、`IFS`、`SHELLOPTS`、`BASHOPTS`、`PROMPT_COMMAND`、`NODE_OPTIONS`、`PYTHONPATH`、`PYTHONSTARTUP`、`PERL5OPT`、`PERL5LIB`、`RUBYOPT`、`RUBYLIB`、`GIT_SSH`、`GIT_SSH_COMMAND`、`GIT_EXEC_PATH` 不剥离。
- 拒绝与询问规则：完整命令或任一子命令（剥离前后两种形式）命中即生效。
- 允许规则：每个子命令都被某条带内容的允许规则覆盖才放行。含命令替换（`$(…)`、反引号，双引号内也算）、进程替换、子 shell 括号、未闭合引号，或子命令超过 50 个时，带内容的允许规则不放行（拒绝与询问规则仍按拆出的片段检查，替换内部的命令也是片段）。
- 建议规则：每个尚未被允许的子命令（剥离后）一条；不能可靠拆分的命令没有建议。

**Read / Edit**：内容是 gitignore 风格的路径模式（`ignore` 包，大小写不敏感），模式匹配一个目录即覆盖其下全部路径。

- 相对模式相对 Workspace 根：不含斜杠的模式匹配任意深度（`*.md`、`.env`），`./` 开头锚定在根，`src/**` 只匹配 Workspace 内的 `src`。
- `/` 开头为绝对路径（`/etc/**`）；`~/` 开头相对主目录（`~/notes`）。`.`、`~`、`/` 匹配该位置本身及其下。
- 拒绝与询问规则对解析前或真实路径任一命中即生效；允许规则按真实路径匹配。
- 建议规则：Workspace 内为相对路径（根下的文件以 `./` 锚定），Workspace 外为绝对路径；gitignore 特殊字符被转义。

## 作用域与持久化

| 作用域 | 保存在 | 生效范围 |
| --- | --- | --- |
| once | 只在 `approval_decision { scope: 'once' }` 中 | 这一次调用 |
| session | `permission_rule { op: add / remove, rule }` 条目 | 该 Session（重启后回放） |
| workspace | 设置键 `permissions.rules.workspace.<workspaceId>` | 该 Workspace 的所有 Session |
| global | 设置键 `permissions.rules` | 所有 Session |
| project（只读） | `<Workspace>/.coko/settings.json` 的 `permissions.deny` / `permissions.ask`（规则文本数组） | 该 Workspace 的所有 Session |

设置值在读入时按 schema 校验，不合格时按缺省（default / 空规则）处理并记 warn `permission setting ignored`。`permissions.*` 键只能经 `/api/permissions` 修改（通用设置接口 400），因此 `PermissionService` 的缓存与库一致。判定时规则顺序是 Session、全局、Workspace、project，顺序不影响结果。

**project 作用域（ADR 0008）。** 项目文件只能收紧：其中只有拒绝与询问规则生效，`permissions.allow` 与 `permissions.defaultMode` 被忽略并给出诊断 `project-cannot-grant`（见 [分层配置](configuration.md#项目设置文件)）。规则在每个 Run 开始时与 `GET /api/permissions` 时按 mtime 读取，判定时用最近一次读到的值；Workspace 第一次加载时另读一次。工具名按规范名读出（不检查是否已注册）。只能改文件，不能经协议增删，也不能用"总是允许"保存到这里。项目规则变化不触发待审批请求的重新判定（下一次判定按新值）。

| 作用域 | 允许 | 询问 | 拒绝 | 可经协议修改 |
| --- | --- | --- | --- | --- |
| session、workspace、global | 是 | 是 | 是 | 是 |
| project | 否（忽略并诊断） | 是 | 是 | 否 |

## 审批状态与条目

判定为 ask 时，broker 先登记等待、再提交 `approval_request { requestId, toolCallId, toolName, kind: 'tool', subject, suggestions }`。kind 另有 escalation（单次提权，见上文）与 plan（`exit_plan_mode` 提交的计划：询问前先提交 proposed 的 `plan` 条目，请求带 `planId`、`revision`，subject 为计划标题，不重新判定；见 [Plan Mode](plan-mode.md#提交与审阅)）。状态只能前进一次：

| 结局 | 何时 | approval_decision |
| --- | --- | --- |
| allowed | 用户允许 | `{ outcome: 'allowed', scope }`（once / session / workspace / global） |
| denied | 用户拒绝 | `{ outcome: 'denied', feedback? }`（反馈去掉首尾空白，最长 4000 字符） |
| cancelled | Run 被停止（abort signal） | `{ outcome: 'cancelled' }` |
| superseded | 模式或规则变更后重新判定为 allow 或 deny，或仍需询问但原因或建议规则变了（只对 kind=tool） | `{ outcome: 'superseded' }` |

决定条目提交完成后调用才继续；条目在 SQLite 提交后才推送。没有超时，没有订阅客户端时请求保持等待。同一批的多个调用由 pi 逐个准备，因此请求按调用顺序一个接一个出现。条目提交失败时 Run 以 `commit_failed` 结束。

**重新判定**：`answerApproval(requestId, { decision: 'reevaluate' })` 让 gate 按当时的模式与规则重新调用 `decide`：allow → superseded 并执行；deny → superseded，调用得到规则拒绝文本，Run 继续；仍需询问且原因与建议规则都没变 → 请求保持等待，不提交条目；原因或建议规则变了（例如切到 read-only 后写入变为越出可写根，不能再保存为规则）→ superseded，并按新判定提出新的请求（建议规则为新值，卡片不再提供过期的"总是允许"）。server 在以下时机对受影响 Session 的全部 `kind: 'tool'` 待审批请求发出它：切换该 Session 的模式、增删该 Session 规则、修改全局规则（所有 Session）、修改 Workspace 规则（该 Workspace 的 Session）、以 session / workspace / global 作用域回答审批之后（其余待审批请求）。

**保存"总是允许"**：scope 为 session / workspace / global 时，server 先把请求的 `suggestions` 保存到对应位置（session 的 `permission_rule` 条目排在 `approval_decision` 之前），再允许该请求。请求没有建议规则（受保护路径、越出可写根、询问规则命中、不能可靠拆分的命令）或不是 `kind: 'tool'` 时只能允许一次，否则 400 且请求保持等待。

**拒绝语义**：

- 无反馈的拒绝：该调用得到错误结果 `The user rejected this tool call. …`；同批其余调用不再询问，直接得到跳过结果；本批结束后不再请求模型，Run 以 `aborted` 结束。
- 带反馈的拒绝：反馈作为工具错误文本交给模型，Run 继续。
- 等待中停止：请求 cancelled，本批调用都不执行（pi 先准备整批再执行，已允许的同批调用也还没开始）。
- 等待中暂停：请求 cancelled，该调用为 `Not run: the user paused the run before this call was approved.`；同批被规则拒绝、参数错误或跳过的调用保留各自的文本。

## 协议

- `POST /api/sessions/:id/approvals/:requestId`，body 为 `AnswerApprovalRequest`：`{ decision: 'allow', scope?, editedPlan?, mode? }` 或 `{ decision: 'deny', feedback? }`；`editedPlan` 与 `mode`（default / accept-edits）只用于 kind plan，其他请求 400，kind plan 的 scope 只能是 once。成功 204；请求不在等待中 409 `approval-not-pending`；scope 不可保存时 400；Session 不存在 404。
- `PUT /api/sessions/:id/permission-mode` `{ mode }`；`GET / POST / DELETE /api/sessions/:id/permission-rules`（POST / DELETE 的 body 为 `{ rule }`，已存在 / 不存在时不提交条目）。都返回 `SessionPermissionsResponse { mode, prior?, rules }`（prior 只在 plan 模式时出现）。
- `GET /api/permissions?workspaceId=…` 返回 `PermissionsResponse`：`defaultMode`、`global`，给出 workspaceId 时另有 `workspace` 与 `project { workspaceId, path, rules }`（只读，没有 revision），可写的各带 revision（未保存过为 0）。`PUT /api/permissions` 一次修改一项：`{ target: 'defaultMode', value }`、`{ target: 'global', rules }` 或 `{ target: 'workspace', workspaceId, rules }`，都带 `expectedRevision`；不合 schema 400，revision 不一致 409 `revision-conflict`，Workspace 不存在 404。规则最多 500 条，工具名非空且不含括号与空白，内容非空、最长 4000。
- Session DTO 的 `activity`：Run 进行中且有待审批请求为 `awaiting-approval`，否则 `running`；没有 Run 时的取值见 [启动恢复与结果确认](recovery.md#activity-与界面)。`inspect-quit` 的 `activeRuns` 包含等待审批的 Run。
- 重连：以 afterSeq 0 重新订阅即可看到仍在等待的 `approval_request`（没有对应 decision、所属 Run 未结束）。

## 界面

- **模式选择**：输入框底部工具栏依次显示附件、权限、计划状态、弹性间距、上下文环、模型和发送。权限按钮没有箭头，H32、14px 图标与 13/20 文字，普通模式使用 muted-foreground，hover / open 使用 accent；default 使用手掌，accept-edits 使用盾牌与终端组合。菜单直接列出“请求批准”（default）、“帮我批准”（accept-edits）、“完全访问权限”（full-access）三个单选项及说明，没有标题说明区。选择后关闭并返回触发按钮，只打开或关闭不修改模式。read-only 仍如实显示；plan 时按钮显示进入前的 prior，菜单三项均不勾选，选择任意一项直接退出 plan。full-access 保持 destructive 色及浅危险色 hover。
- **模式切换**：焦点在编辑区时 Shift+Tab 在 read-only → default → accept-edits 之间循环（从 full-access 或 plan 回到 read-only），焦点不离开编辑区；其他控件上仍移动焦点。界面与 Tooltip 不展示快捷键。普通切换立即显示，失败撤回并提示；从 plan 退出须等服务端接受才移除计划状态，失败保留 plan。草稿所选模式在创建 Session 后、提交第一条消息前切换，Run 中也可切换。计划进入与胶囊见 [Plan Mode](plan-mode.md#界面)。
- **提权卡**：审批卡的变体，标题"允许以更宽的权限运行这条命令？"，明细为命令、目标档位与理由；没有"总是允许"。
- **审批卡**：最早的待审批请求接管输入区；输入区保持挂载（隐藏），草稿不丢。卡片出现时若焦点在输入区，焦点移到卡片本身。焦点在详情区时 Enter 允许一次、Esc 拒绝；Esc 被卡片处理后不再触发全局"停止 Run"。"拒绝并说明原因"展开输入框，其中 Enter 提交带反馈的拒绝，Esc 收起。有建议规则的工具请求另有"总是允许"菜单：显示将保存的规则，选本会话 / 本工作区 / 所有工作区；菜单内的 Enter 与 Esc 不触发卡片的允许与拒绝。键盘与指针共用一把锁，同一请求只回答一次。
- **工具卡**：等待时为 `awaiting` 状态，结束后标题行显示决定（已允许一次、以某档位允许一次（提权）、本会话 / 本工作区总是允许、总是允许、已拒绝及原因、已取消、已按新设置自动处理）；被沙箱拒绝的 bash 另显示"被沙箱拦截（档位）"。
- **侧栏**：`awaiting-approval` 的会话带徽标并排在所在 Workspace 组首。只有打开过（已订阅）的会话会随条目实时更新 activity。
- **Permissions 分区**（设置页）：新会话的默认模式；全局规则与当前会话所在 Workspace 的规则（按允许、询问、拒绝分组，可增删；输入框按 `parsePermissionRule` 校验）；该 Workspace 项目设置中的规则（project 作用域，只读，标出来源文件，没有删除入口与输入框）；当前会话的 Session 规则（只读，可删除）。保存冲突时读回最新值并提示重试。General 分区另有项目设置行，见 [分层配置](configuration.md#界面)。

## 尚未实现

网络与读取的沙箱限制、Windows / Linux 沙箱不在 M2 范围。Sidecar 在等待审批时退出，重启后请求以 expired 结束，见 [启动恢复与结果确认](recovery.md)。

## 验证

- [项目根的 Sidecar 协议用例](../../tests/integration/sidecar-project-permissions.test.ts)：附加根读取、模式写入、Run 快照、归属移动、子代理、worktree 来源排除、拒绝过滤、符号链接及 cwd 资源发现；其中 Seatbelt 用例仅在 darwin 运行。

- `packages/agent/src/policy/decide.test.ts`：判定顺序、四种模式 × 工具类型、拒绝与询问规则在 full-access 下生效、受保护路径不被允许规则免除、建议规则；权限类（context-read、memory-write、external、session-state 在四种模式下的放行，plan-exit 在四种模式下都询问且允许规则不生效，plan 模式与 read-only 的判定相同、plan-exit 在 plan 中询问、`permission_mode` v1 → v2，`mcp__srv` 规则的匹配范围，未注册的 `mcp__` 名字被接受）与额外读取根。`policy/permission-class.test.ts`：权限类与读取根经运行时的权限 gate 生效，工具对象自身声明的类不生效；`tools/registry.test.ts`：注册时给出的类。
- `packages/agent/src/policy/rules.test.ts`：bash 精确 / 前缀、复合命令拆分、命令替换与 50 个子命令上限、env 前缀剥离（含 `LD_PRELOAD` 不剥）、拒绝规则命中拆分后的子命令；gitignore 路径、`~/`、绝对路径。
- `packages/agent/src/policy/decide.test.ts` 另覆盖规则工具名的大小写与别名（deny `bash(rm *)`、`Write(secret.txt)` 在 full-access 下生效）。`packages/agent/src/policy/execution-checks.test.ts`：目录工具的读取拒绝过滤、执行前复核（同批先建指向受保护文件的链接再 write）、缺失密钥不提交 `tool_exec`、提权须先被沙箱拒绝、暂停只改写被取消的审批、重新判定后重新询问；`tools/builtin/read-filter.test.ts`：grep、find、ls 的过滤。`sidecar-permissions.test.ts` 另覆盖规则工具名归一与 400 `unknown-tool`；`sidecar-context.test.ts` 覆盖经 `PUT /api/permissions` 写入 Memory、`memory_list` 与 MCP 资源工具的拒绝规则后生效。
- `packages/agent/src/policy/approvals.test.ts`、`reevaluate.test.ts`：运行时上的请求、允许一次、拒绝两种语义、同批顺序、停止、重新判定为 superseded。
- `tests/integration/sidecar-mcp.test.ts`：真实 Sidecar 上 MCP 工具（external）在 default 下询问、Session 规则 `mcp__remote` 放行该 Server 的全部工具、full-access 免审批。
- `tests/integration/sidecar-config.test.ts`：项目 deny 规则（小写工具名）在 full-access 下拒绝调用且优先于全局允许规则、改文件后下一个 Run 生效、项目 allow 不放行、读取接口的 `project`；`apps/desktop/e2e/config.e2e.test.ts`：Permissions 分区的只读项目规则。
- `tests/integration/sidecar-approvals.test.ts`、`sidecar-permissions.test.ts`：真实 Sidecar 上的回答路由与 409；作用域保存、重启后规则与模式仍生效、Session 规则只影响该 Session；等待时切到 full-access 或新增拒绝规则后 superseded；默认模式、非法设置值 400、通用设置接口拒绝 `permissions.*`。`secrets-gate.test.ts` 驱动审批卡与"本 Workspace 总是允许"通道。
- `packages/agent/src/policy/sandbox.test.ts`（档位映射、提权参数、标记文本）、`escalation.test.ts`（运行时上四种模式的沙箱策略与可写根、提权请求替代普通审批且允许规则不能免掉、参数错误不询问、拒绝规则优先、拒绝提权；Secrets 注入）；`ports/local-exec.test.ts`（包裹接缝、拒绝签名、fail-closed）；`tools/builtin/bash.test.ts`（拒绝标记顺序、sandbox-unavailable）。
- `apps/server/src/adapters/seatbelt.test.ts`：profile 文本（含受保护路径的 deny）、探测；darwin 上真实 sandbox-exec 的写入放行与拒绝、可写根内 `.git` 与 `.coko` 被拒绝。`sidecar-sandbox.test.ts` 另覆盖 default 下已批准的命令不能写 `.git/hooks` 与 `.coko`、没有先被拒绝的提权为参数错误。`sidecar-boot.test.ts`：`--packaged` 时测试钩子变量被忽略。`tests/integration/sidecar-sandbox.test.ts`：真实 Sidecar 上 default 越界写入被拒而 Workspace 与 `/tmp` 成功、read-only 不能写 Workspace、提权卡与单次有效、拒绝提权、参数错误、`COKO_SANDBOX_EXEC` 不可用时 fail-closed、accept-edits 越界写入只能允许一次、Secrets 注入（Seatbelt 用例只在 darwin 运行，其他平台显式跳过）。`secrets-gate.test.ts` 另驱动沙箱拒绝输出、提权流程与 secret_probe。
- `packages/ui/src/approval/approval-card.browser.test.tsx`；`apps/desktop/src/renderer/features/conversation/approval-panel.browser.test.tsx`（提权卡）、`tool-cards.browser.test.tsx`（沙箱拦截标记）；`apps/desktop/src/renderer/stores/chat-store-approvals.test.ts`、`chat-store-permissions.test.ts`；`apps/desktop/e2e/approvals.e2e.test.ts`、`permissions.e2e.test.ts`（Shift+Tab 循环、full-access 警示、Permissions 分区增删规则、"总是允许"下拉）、`sandbox.e2e.test.ts`（darwin：沙箱拦截标记、提权卡、允许一次后写入），以及 `package-smoke.e2e.test.ts` 中打包产物里的一次允许与受限命令无法写 Workspace 之外。

## 延伸阅读

- [ADR 0005](../adr/0005-permission-mode-and-sandbox.md)：模式、沙箱与提权的决定。
- [ADR 0008](../adr/0008-project-files-only-tighten.md) 与 [分层配置](configuration.md)：project 作用域的来源与限制。
- [MCP Server 连接与工具](mcp.md)：external 类工具的来源、命名与结果。
- [apps/server README](../../apps/server/README.md)：协议总览。
- [Agent 执行约定](../tech-stack/agent-runtime.md)：统一接入链的约定。
