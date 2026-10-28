---
kind: reference
description: "当前的权限判定与审批契约：四种模式、判定顺序、规则语法与作用域、受保护路径、ApprovalBroker 状态与重新判定、审批条目、协议路由、拒绝语义、命令沙箱（Seatbelt）与单次提权、审批卡与模式选择。修改判定、规则、审批流程、沙箱或权限界面前查阅。"
lifecycle: active
---

# 权限判定与审批

本文说明当前代码中工具调用如何被判定、需要审批时如何等待与回答、规则与模式如何保存，以及命令如何在模式对应的 Seatbelt 沙箱档位内运行、被拒后如何单次提权。长期取舍（模式与沙箱叠加、提权不可保存）见 [ADR 0005](../adr/0005-permission-mode-and-sandbox.md)；本文只描述已实现的部分。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/policy/decide.ts` | 纯函数 `decide(call, { mode, rules, workspace, writableRoots, home? })` → allow / deny / ask（附建议规则） |
| `packages/agent/src/policy/rules.ts` | 规则内容的匹配：bash 拆分、env 前缀剥离、精确 / 前缀；gitignore 风格路径 |
| `packages/agent/src/policy/paths.ts` | 把工具参数解析为绝对路径与真实路径（经符号链接，含悬空链接）；模式对应的可写根（委托 sandbox.ts） |
| `packages/agent/src/policy/sandbox.ts` | 模式 → Sandbox Mode、可写根的唯一推导、提权参数校验 `checkEscalation`、模型可见的拒绝标记与提示文本 |
| `packages/agent/src/ports/exec.ts`、`local-exec.ts` | `ExecRequest.sandbox`、`SandboxUnavailableError`；本地执行经宿主给出的 `LocalSandbox` 包裹受限命令，没有时 fail-closed |
| `apps/server/src/adapters/seatbelt.ts` | Seatbelt profile、启动探测、`sandbox-exec -p <profile> --` 包裹 |
| `packages/agent/src/policy/broker.ts` | `ApprovalBroker`：每个运行时一个，提交请求与决定条目，等待回答或重新判定 |
| `packages/agent/src/policy/gate.ts` | 权限 hook，位于 `ToolHooks.beforeToolCall` 链首；执行前复核 `recheck`；本 Run 的沙箱拒绝记录；模型可见的拒绝文本 |
| `packages/agent/src/engine/runtime.ts` | `AgentRuntimeOptions.permissions`（每次调用读取模式与规则）、`answerApproval()`、`pendingApprovals`；调度器的执行前准备（复核、沙箱档位、Secrets、读取过滤） |
| `packages/agent/src/tools/builtin/read-filter.ts` | grep、find、ls 不列出被 Read 拒绝规则覆盖的路径 |
| `packages/protocol/src/permissions.ts` | 条目 payload、协议 DTO、`permissionPaths`、设置键、规则文本 `formatPermissionRule` / `parsePermissionRule` |
| `apps/server/src/application/permissions.ts` | `PermissionService`：默认模式、全局与 Workspace 规则的读入、缓存与写入 |
| `apps/server/src/application/sessions.ts` | Session 模式与规则的回放、保存"总是允许"、触发重新判定、Session `activity` |
| `packages/ui/src/approval/approval-card.tsx` | 共享审批卡（键盘、单次回答、"总是允许"菜单） |
| `apps/desktop/src/renderer/features/conversation/approval-panel.tsx` | 审批卡的业务组合：标题、命令 / 路径 / diff 摘要、建议规则；提权卡（目标档位与理由） |
| `apps/desktop/src/renderer/features/conversation/mode-picker.tsx` | 输入区的模式选择与 Shift+Tab 循环顺序 |
| `apps/desktop/src/renderer/features/settings/permissions-section.tsx` | 设置弹窗的 Permissions 分区 |

工具契约（`packages/agent/src/tools/types.ts`）有 `effect: 'read' | 'side-effect'`（缺省 side-effect）、`permissionSubject(args)` 与 `sandboxRequest(args)`（提权参数，只有 bash 声明）。内置工具：read、grep、find、ls 为 read，subject 是路径（缺省 `.`）；write、edit 为 side-effect，subject 是路径；bash 为 side-effect，subject 是命令。

## 模式

每个 Session 有一个 Permission Mode。模式决定判定中的"模式放行"一步（其余各步在所有模式下相同），也决定命令的沙箱档位；write / edit 的写入边界与 Seatbelt 使用同一组可写根。

| 模式 | 模式放行 | 命令的沙箱档位 | 可写根（write / edit 与命令共用） |
| --- | --- | --- | --- |
| read-only | Workspace 内的 read 组调用 | read-only | 无：文件写入都按越出可写根询问，命令不能写任何位置 |
| default | Workspace 内的 read 组调用 | workspace-write | Workspace、`/tmp`、`os.tmpdir()` 的真实路径 |
| accept-edits | 另加可写根内的 write / edit | workspace-write | 同 default |
| full-access | 全部调用 | danger-full-access（不包裹） | `/` |

workspace-write 的可写根与 DSH `packages/sandbox` 的默认集合相同：不含主目录及其下的包管理缓存（`~/.npm`、`~/.cache` 等），写这些位置的命令被拒绝后需要提权或切换模式。

新 Session 创建时提交一条 `permission_mode` 条目，取设置 `permissions.defaultMode`（缺省 default）；之后改默认模式不影响已有 Session。没有 `permission_mode` 条目的旧 Session 按 default。切换模式提交新的 `permission_mode` 条目（与当前相同时不提交），立即作用于下一次调用。

## 判定

判定只看工具名所属的组：read 组（read、grep、find、ls）、edit 组（write、edit）、bash；其他名字（宿主新增的工具）按原名判定。规则以组名书写：`Read`、`Edit`、`Bash`，宿主工具用注册名。

**工具名的写法。** 经 `/api/permissions` 与 `…/permission-rules` 写入时，工具名归一为规范名（`canonicalRuleTool`）：内置工具名与组名不区分大小写归为组名（`bash` → `Bash`，`write` / `edit` → `Edit`，`grep` → `Read`），宿主工具按注册名不区分大小写匹配；都不是时 400 `bad-request`，`details = { reason: 'unknown-tool', tool }`，设置分区在输入框下行内提示。库中已有的非规范写法在读入时归一；`decide` 也按组名、不区分大小写比较，旧规则不会静默失效。

顺序固定（ADR 0005）：

1. 拒绝规则 → deny，模型收到 `Permission denied by rule …`，Run 继续。
2. 询问规则 → ask（没有建议规则）。
3. edit 组写入受保护路径 → ask，没有建议规则；允许规则与模式都不能免掉。
4. edit 组写入越出可写根 → ask，没有建议规则（这次批准即这次提权）。
5. 模式放行（上表）。
6. 允许规则 → allow。
7. 其余 → ask。read 组读取 Workspace 之外为 `outside-workspace`，其他为 `approval-required`。

路径按真实路径判定：Workspace 内指向外部的符号链接按外部位置处理；Workspace 与可写根也是真实路径。

**受保护路径**：任意深度的 `.git`、`.coko`、`.vscode`、`.idea` 目录，以及任意位置的 `.bashrc`、`.zshrc`、`.profile`、`.bash_profile`、`.zprofile`、`.gitconfig`、`.ssh`、`.mcp.json`。比较前转小写；解析前或解析后的路径任一命中即受保护。判定只约束 edit 组（bash 的写入目标无法预知）；受限档位的命令由 Seatbelt 在可写根之下拒绝写入这些路径段（见下节），full-access 不受限制。

**目录工具与 Read 拒绝规则。** grep、find、ls 的判定对象是搜索根；拒绝规则覆盖搜索根之下的路径时，调用照常放行，结果中不列出被覆盖的文件（find 不进入被覆盖的目录），末尾注明 `[N path(s) omitted: denied by permission rules]`。按每个结果的路径与经搜索根真实路径换算后的路径判定。不带内容的 `Read` 拒绝规则在判定时就拒绝整个调用。

## 命令沙箱与提权

**档位与执行。** bash 每次执行时按当时的模式现算沙箱策略 `{ mode, writableRoots }`，经执行上下文（`ToolExecutionContext.sandbox`）交给执行端口。Sidecar 的 bash 由 `adapters/seatbelt.ts` 包裹为 `/usr/bin/sandbox-exec -p <profile> -- /bin/bash -c <command>`：

```text
(version 1) (allow default) (deny file-write*) (allow file-write* (literal "/dev/null")) (allow file-write* (subpath "<root>") …)
(deny file-write* (regex #"^<root>/(.*/)?([.][gG][iI][tT]|…)(/|$)") …)
```

SBPL 中后出现的规则优先：workspace-write 在可写根之后，对每个可写根下任意深度的受保护路径段（与判定相同的集合 `PROTECTED_PATH_NAMES`，不区分大小写）追加 deny，被拒后走提权。read-only 没有 subpath；danger-full-access 不包裹。沙箱只约束文件写入，不限制网络与读取。经审批或允许规则放行的命令同样在本档位内运行。

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

设置值在读入时按 schema 校验，不合格时按缺省（default / 空规则）处理并记 warn `permission setting ignored`。`permissions.*` 键只能经 `/api/permissions` 修改（通用设置接口 400），因此 `PermissionService` 的缓存与库一致。判定时规则顺序是 Session、全局、Workspace，顺序不影响结果。

## 审批状态与条目

判定为 ask 时，broker 先登记等待、再提交 `approval_request { requestId, toolCallId, toolName, kind: 'tool', subject, suggestions }`。状态只能前进一次：

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

- `POST /api/sessions/:id/approvals/:requestId`，body 为 `AnswerApprovalRequest`：`{ decision: 'allow', scope? }` 或 `{ decision: 'deny', feedback? }`。成功 204；请求不在等待中 409 `approval-not-pending`；scope 不可保存时 400；Session 不存在 404。
- `PUT /api/sessions/:id/permission-mode` `{ mode }`；`GET / POST / DELETE /api/sessions/:id/permission-rules`（POST / DELETE 的 body 为 `{ rule }`，已存在 / 不存在时不提交条目）。都返回 `SessionPermissionsResponse { mode, rules }`。
- `GET /api/permissions?workspaceId=…` 返回 `PermissionsResponse`：`defaultMode`、`global`，给出 workspaceId 时另有 `workspace`，各带 revision（未保存过为 0）。`PUT /api/permissions` 一次修改一项：`{ target: 'defaultMode', value }`、`{ target: 'global', rules }` 或 `{ target: 'workspace', workspaceId, rules }`，都带 `expectedRevision`；不合 schema 400，revision 不一致 409 `revision-conflict`，Workspace 不存在 404。规则最多 500 条，工具名非空且不含括号与空白，内容非空、最长 4000。
- Session DTO 的 `activity`：Run 进行中且有待审批请求为 `awaiting-approval`，否则 `running`；没有 Run 时的取值见 [启动恢复与结果确认](recovery.md#activity-与界面)。`inspect-quit` 的 `activeRuns` 包含等待审批的 Run。
- 重连：以 afterSeq 0 重新订阅即可看到仍在等待的 `approval_request`（没有对应 decision、所属 Run 未结束）。

## 界面

- **模式选择**：输入区底栏、模型选择旁，显示当前模式；菜单列出四种模式及说明。full-access 只能在菜单中选择，选中时按钮与图标为 destructive 色，菜单中显示警示。焦点在编辑区时 Shift+Tab 在 read-only → default → accept-edits 之间循环（从 full-access 回到 read-only），焦点不离开编辑区；焦点在其他控件上时 Shift+Tab 照常移动焦点。会话中切换立即显示，经协议提交，失败时撤回并提示；草稿中选的模式在创建 Session 后、提交第一条消息前切换。Run 中也可切换。
- **提权卡**：审批卡的变体，标题"允许以更宽的权限运行这条命令？"，明细为命令、目标档位与理由；没有"总是允许"。
- **审批卡**：最早的待审批请求接管输入区；输入区保持挂载（隐藏），草稿不丢。卡片出现时若焦点在输入区，焦点移到卡片本身。焦点在详情区时 Enter 允许一次、Esc 拒绝；Esc 被卡片处理后不再触发全局"停止 Run"。"拒绝并说明原因"展开输入框，其中 Enter 提交带反馈的拒绝，Esc 收起。有建议规则的工具请求另有"总是允许"菜单：显示将保存的规则，选本会话 / 本工作区 / 所有工作区；菜单内的 Enter 与 Esc 不触发卡片的允许与拒绝。键盘与指针共用一把锁，同一请求只回答一次。
- **工具卡**：等待时为 `awaiting` 状态，结束后标题行显示决定（已允许一次、以某档位允许一次（提权）、本会话 / 本工作区总是允许、总是允许、已拒绝及原因、已取消、已按新设置自动处理）；被沙箱拒绝的 bash 另显示"被沙箱拦截（档位）"。
- **侧栏**：`awaiting-approval` 的会话带徽标并排在所在 Workspace 组首。只有打开过（已订阅）的会话会随条目实时更新 activity。
- **Permissions 分区**（设置弹窗）：新会话的默认模式；全局规则与当前会话所在 Workspace 的规则（按允许、询问、拒绝分组，可增删；输入框按 `parsePermissionRule` 校验）；当前会话的 Session 规则（只读，可删除）。保存冲突时读回最新值并提示重试。

## 尚未实现

网络与读取的沙箱限制、Windows / Linux 沙箱不在 M2 范围。Sidecar 在等待审批时退出，重启后请求以 expired 结束，见 [启动恢复与结果确认](recovery.md)。

## 验证

- `packages/agent/src/policy/decide.test.ts`：判定顺序、四种模式 × 工具类型、拒绝与询问规则在 full-access 下生效、受保护路径不被允许规则免除、建议规则。
- `packages/agent/src/policy/rules.test.ts`：bash 精确 / 前缀、复合命令拆分、命令替换与 50 个子命令上限、env 前缀剥离（含 `LD_PRELOAD` 不剥）、拒绝规则命中拆分后的子命令；gitignore 路径、`~/`、绝对路径。
- `packages/agent/src/policy/decide.test.ts` 另覆盖规则工具名的大小写与别名（deny `bash(rm *)`、`Write(secret.txt)` 在 full-access 下生效）。`packages/agent/src/policy/execution-checks.test.ts`：目录工具的读取拒绝过滤、执行前复核（同批先建指向受保护文件的链接再 write）、缺失密钥不提交 `tool_exec`、提权须先被沙箱拒绝、暂停只改写被取消的审批、重新判定后重新询问；`tools/builtin/read-filter.test.ts`：grep、find、ls 的过滤。`sidecar-permissions.test.ts` 另覆盖规则工具名归一与 400 `unknown-tool`。
- `packages/agent/src/policy/approvals.test.ts`、`reevaluate.test.ts`：运行时上的请求、允许一次、拒绝两种语义、同批顺序、停止、重新判定为 superseded。
- `tests/integration/sidecar-approvals.test.ts`、`sidecar-permissions.test.ts`：真实 Sidecar 上的回答路由与 409；作用域保存、重启后规则与模式仍生效、Session 规则只影响该 Session；等待时切到 full-access 或新增拒绝规则后 superseded；默认模式、非法设置值 400、通用设置接口拒绝 `permissions.*`。`secrets-gate.test.ts` 驱动审批卡与"本 Workspace 总是允许"通道。
- `packages/agent/src/policy/sandbox.test.ts`（档位映射、提权参数、标记文本）、`escalation.test.ts`（运行时上四种模式的沙箱策略与可写根、提权请求替代普通审批且允许规则不能免掉、参数错误不询问、拒绝规则优先、拒绝提权；Secrets 注入）；`ports/local-exec.test.ts`（包裹接缝、拒绝签名、fail-closed）；`tools/builtin/bash.test.ts`（拒绝标记顺序、sandbox-unavailable）。
- `apps/server/src/adapters/seatbelt.test.ts`：profile 文本（含受保护路径的 deny）、探测；darwin 上真实 sandbox-exec 的写入放行与拒绝、可写根内 `.git` 与 `.coko` 被拒绝。`sidecar-sandbox.test.ts` 另覆盖 default 下已批准的命令不能写 `.git/hooks` 与 `.coko`、没有先被拒绝的提权为参数错误。`sidecar-boot.test.ts`：`--packaged` 时测试钩子变量被忽略。`tests/integration/sidecar-sandbox.test.ts`：真实 Sidecar 上 default 越界写入被拒而 Workspace 与 `/tmp` 成功、read-only 不能写 Workspace、提权卡与单次有效、拒绝提权、参数错误、`COKO_SANDBOX_EXEC` 不可用时 fail-closed、accept-edits 越界写入只能允许一次、Secrets 注入（Seatbelt 用例只在 darwin 运行，其他平台显式跳过）。`secrets-gate.test.ts` 另驱动沙箱拒绝输出、提权流程与 secret_probe。
- `packages/ui/src/approval/approval-card.browser.test.tsx`；`apps/desktop/src/renderer/features/conversation/approval-panel.browser.test.tsx`（提权卡）、`tool-cards.browser.test.tsx`（沙箱拦截标记）；`apps/desktop/src/renderer/stores/chat-store-approvals.test.ts`、`chat-store-permissions.test.ts`；`apps/desktop/e2e/approvals.e2e.test.ts`、`permissions.e2e.test.ts`（Shift+Tab 循环、full-access 警示、Permissions 分区增删规则、"总是允许"下拉）、`sandbox.e2e.test.ts`（darwin：沙箱拦截标记、提权卡、允许一次后写入），以及 `package-smoke.e2e.test.ts` 中打包产物里的一次允许与受限命令无法写 Workspace 之外。

## 延伸阅读

- [ADR 0005](../adr/0005-permission-mode-and-sandbox.md)：模式、沙箱与提权的决定。
- [apps/server README](../../apps/server/README.md)：协议总览。
- [Agent 执行约定](../tech-stack/agent-runtime.md)：统一接入链的约定。
