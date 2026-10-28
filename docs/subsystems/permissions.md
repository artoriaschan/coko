---
kind: reference
description: "当前的权限判定与审批契约：四种模式、判定顺序、规则语法与作用域、受保护路径、ApprovalBroker 状态与重新判定、审批条目、协议路由、拒绝语义、审批卡与模式选择。修改判定、规则、审批流程或权限界面前查阅。"
lifecycle: active
---

# 权限判定与审批

本文说明当前代码中工具调用如何被判定、需要审批时如何等待与回答、规则与模式如何保存。长期取舍（模式与沙箱叠加、提权不可保存）见 [ADR 0005](../adr/0005-permission-mode-and-sandbox.md)；本文只描述已实现的部分。当前限制：命令不在沙箱中运行，模式只决定审批范围（见文末"尚未实现"）。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/policy/decide.ts` | 纯函数 `decide(call, { mode, rules, workspace, writableRoots, home? })` → allow / deny / ask（附建议规则） |
| `packages/agent/src/policy/rules.ts` | 规则内容的匹配：bash 拆分、env 前缀剥离、精确 / 前缀；gitignore 风格路径 |
| `packages/agent/src/policy/paths.ts` | 把工具参数解析为绝对路径与真实路径（经符号链接，含悬空链接）；模式对应的可写根 |
| `packages/agent/src/policy/broker.ts` | `ApprovalBroker`：每个运行时一个，提交请求与决定条目，等待回答或重新判定 |
| `packages/agent/src/policy/gate.ts` | 权限 hook，位于 `ToolHooks.beforeToolCall` 链首；模型可见的拒绝文本 |
| `packages/agent/src/engine/runtime.ts` | `AgentRuntimeOptions.permissions`（每次调用读取模式与规则）、`answerApproval()`、`pendingApprovals` |
| `packages/protocol/src/permissions.ts` | 条目 payload、协议 DTO、`permissionPaths`、设置键、规则文本 `formatPermissionRule` / `parsePermissionRule` |
| `apps/server/src/application/permissions.ts` | `PermissionService`：默认模式、全局与 Workspace 规则的读入、缓存与写入 |
| `apps/server/src/application/sessions.ts` | Session 模式与规则的回放、保存"总是允许"、触发重新判定、Session `activity` |
| `packages/ui/src/approval/approval-card.tsx` | 共享审批卡（键盘、单次回答、"总是允许"菜单） |
| `apps/desktop/src/renderer/features/conversation/approval-panel.tsx` | 审批卡的业务组合：标题、命令 / 路径 / diff 摘要、建议规则 |
| `apps/desktop/src/renderer/features/conversation/mode-picker.tsx` | 输入区的模式选择与 Shift+Tab 循环顺序 |
| `apps/desktop/src/renderer/features/settings/permissions-section.tsx` | 设置弹窗的 Permissions 分区 |

工具契约（`packages/agent/src/tools/types.ts`）有 `effect: 'read' | 'side-effect'`（缺省 side-effect）与 `permissionSubject(args)`。内置工具：read、grep、find、ls 为 read，subject 是路径（缺省 `.`）；write、edit 为 side-effect，subject 是路径；bash 为 side-effect，subject 是命令。

## 模式

每个 Session 有一个 Permission Mode。模式只决定"模式放行"一步；其余各步在所有模式下相同。

| 模式 | 模式放行 | 可写根（write / edit 的边界） |
| --- | --- | --- |
| read-only | Workspace 内的 read 组调用 | 无：任何写入都按越出可写根询问 |
| default | Workspace 内的 read 组调用 | Workspace、`os.tmpdir()`、`/tmp` 的真实路径 |
| accept-edits | 另加可写根内的 write / edit | 同 default |
| full-access | 全部调用 | `/` |

新 Session 创建时提交一条 `permission_mode` 条目，取设置 `permissions.defaultMode`（缺省 default）；之后改默认模式不影响已有 Session。没有 `permission_mode` 条目的旧 Session 按 default。切换模式提交新的 `permission_mode` 条目（与当前相同时不提交），立即作用于下一次调用。

## 判定

判定只看工具名所属的组：read 组（read、grep、find、ls）、edit 组（write、edit）、bash；其他名字（宿主新增的工具）按原名判定。规则以组名书写：`Read`、`Edit`、`Bash`，未知工具用原名。

顺序固定（ADR 0005）：

1. 拒绝规则 → deny，模型收到 `Permission denied by rule …`，Run 继续。
2. 询问规则 → ask（没有建议规则）。
3. edit 组写入受保护路径 → ask，没有建议规则；允许规则与模式都不能免掉。
4. edit 组写入越出可写根 → ask，没有建议规则（这次批准即这次提权）。
5. 模式放行（上表）。
6. 允许规则 → allow。
7. 其余 → ask。read 组读取 Workspace 之外为 `outside-workspace`，其他为 `approval-required`。

路径按真实路径判定：Workspace 内指向外部的符号链接按外部位置处理；Workspace 与可写根也是真实路径。

**受保护路径**：任意深度的 `.git`、`.coko`、`.vscode`、`.idea` 目录，以及任意位置的 `.bashrc`、`.zshrc`、`.profile`、`.bash_profile`、`.zprofile`、`.gitconfig`、`.ssh`、`.mcp.json`。比较前转小写；解析前或解析后的路径任一命中即受保护。只约束 edit 组；bash 的写入目标无法预知，不受此检查。

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
| superseded | 模式或规则变更后重新判定为 allow 或 deny | `{ outcome: 'superseded' }` |

决定条目提交完成后调用才继续；条目在 SQLite 提交后才推送。没有超时，没有订阅客户端时请求保持等待。同一批的多个调用由 pi 逐个准备，因此请求按调用顺序一个接一个出现。条目提交失败时 Run 以 `commit_failed` 结束。

**重新判定**：`answerApproval(requestId, { decision: 'reevaluate' })` 让 gate 按当时的模式与规则重新调用 `decide`：allow → superseded 并执行；deny → superseded，调用得到规则拒绝文本，Run 继续；仍需询问 → 请求保持等待，不提交条目。server 在以下时机对受影响 Session 的全部 `kind: 'tool'` 待审批请求发出它：切换该 Session 的模式、增删该 Session 规则、修改全局规则（所有 Session）、修改 Workspace 规则（该 Workspace 的 Session）、以 session / workspace / global 作用域回答审批之后（其余待审批请求）。

**保存"总是允许"**：scope 为 session / workspace / global 时，server 先把请求的 `suggestions` 保存到对应位置（session 的 `permission_rule` 条目排在 `approval_decision` 之前），再允许该请求。请求没有建议规则（受保护路径、越出可写根、询问规则命中、不能可靠拆分的命令）或不是 `kind: 'tool'` 时只能允许一次，否则 400 且请求保持等待。

**拒绝语义**：

- 无反馈的拒绝：该调用得到错误结果 `The user rejected this tool call. …`；同批其余调用不再询问，直接得到跳过结果；本批结束后不再请求模型，Run 以 `aborted` 结束。
- 带反馈的拒绝：反馈作为工具错误文本交给模型，Run 继续。
- 等待中停止：请求 cancelled，本批调用都不执行（pi 先准备整批再执行，已允许的同批调用也还没开始）。

## 协议

- `POST /api/sessions/:id/approvals/:requestId`，body 为 `AnswerApprovalRequest`：`{ decision: 'allow', scope? }` 或 `{ decision: 'deny', feedback? }`。成功 204；请求不在等待中 409 `approval-not-pending`；scope 不可保存时 400；Session 不存在 404。
- `PUT /api/sessions/:id/permission-mode` `{ mode }`；`GET / POST / DELETE /api/sessions/:id/permission-rules`（POST / DELETE 的 body 为 `{ rule }`，已存在 / 不存在时不提交条目）。都返回 `SessionPermissionsResponse { mode, rules }`。
- `GET /api/permissions?workspaceId=…` 返回 `PermissionsResponse`：`defaultMode`、`global`，给出 workspaceId 时另有 `workspace`，各带 revision（未保存过为 0）。`PUT /api/permissions` 一次修改一项：`{ target: 'defaultMode', value }`、`{ target: 'global', rules }` 或 `{ target: 'workspace', workspaceId, rules }`，都带 `expectedRevision`；不合 schema 400，revision 不一致 409 `revision-conflict`，Workspace 不存在 404。规则最多 500 条，工具名非空且不含括号与空白，内容非空、最长 4000。
- Session DTO 的 `activity`：Run 进行中且有待审批请求为 `awaiting-approval`，否则 `running` / `idle`。`inspect-quit` 的 `activeRuns` 包含等待审批的 Run。
- 重连：以 afterSeq 0 重新订阅即可看到仍在等待的 `approval_request`（没有对应 decision、所属 Run 未结束）。

## 界面

- **模式选择**：输入区底栏、模型选择旁，显示当前模式；菜单列出四种模式及说明。full-access 只能在菜单中选择，选中时按钮与图标为 destructive 色，菜单中显示警示。焦点在编辑区时 Shift+Tab 在 read-only → default → accept-edits 之间循环（从 full-access 回到 read-only），焦点不离开编辑区；焦点在其他控件上时 Shift+Tab 照常移动焦点。会话中切换立即显示，经协议提交，失败时撤回并提示；草稿中选的模式在创建 Session 后、提交第一条消息前切换。Run 中也可切换。
- **审批卡**：最早的待审批请求接管输入区；输入区保持挂载（隐藏），草稿不丢。卡片出现时若焦点在输入区，焦点移到卡片本身。焦点在详情区时 Enter 允许一次、Esc 拒绝；Esc 被卡片处理后不再触发全局"停止 Run"。"拒绝并说明原因"展开输入框，其中 Enter 提交带反馈的拒绝，Esc 收起。有建议规则的工具请求另有"总是允许"菜单：显示将保存的规则，选本会话 / 本工作区 / 所有工作区；菜单内的 Enter 与 Esc 不触发卡片的允许与拒绝。键盘与指针共用一把锁，同一请求只回答一次。
- **工具卡**：等待时为 `awaiting` 状态，结束后标题行显示决定（已允许一次、本会话 / 本工作区总是允许、总是允许、已拒绝及原因、已取消、已按新设置自动处理）。
- **侧栏**：`awaiting-approval` 的会话带徽标并排在所在 Workspace 组首。只有打开过（已订阅）的会话会随条目实时更新 activity。
- **Permissions 分区**（设置弹窗）：新会话的默认模式；全局规则与当前会话所在 Workspace 的规则（按允许、询问、拒绝分组，可增删；输入框按 `parsePermissionRule` 校验）；当前会话的 Session 规则（只读，可删除）。保存冲突时读回最新值并提示重试。

## 尚未实现

Seatbelt 沙箱与提权（escalation）、sandbox-exec 不可用时拒绝执行、Sidecar 退出后请求过期（expired）。这些在 ADR 0005 的剩余项中跟踪。

## 验证

- `packages/agent/src/policy/decide.test.ts`：判定顺序、四种模式 × 工具类型、拒绝与询问规则在 full-access 下生效、受保护路径不被允许规则免除、建议规则。
- `packages/agent/src/policy/rules.test.ts`：bash 精确 / 前缀、复合命令拆分、命令替换与 50 个子命令上限、env 前缀剥离（含 `LD_PRELOAD` 不剥）、拒绝规则命中拆分后的子命令；gitignore 路径、`~/`、绝对路径。
- `packages/agent/src/policy/approvals.test.ts`、`reevaluate.test.ts`：运行时上的请求、允许一次、拒绝两种语义、同批顺序、停止、重新判定为 superseded。
- `tests/integration/sidecar-approvals.test.ts`、`sidecar-permissions.test.ts`：真实 Sidecar 上的回答路由与 409；作用域保存、重启后规则与模式仍生效、Session 规则只影响该 Session；等待时切到 full-access 或新增拒绝规则后 superseded；默认模式、非法设置值 400、通用设置接口拒绝 `permissions.*`。`secrets-gate.test.ts` 驱动审批卡与"本 Workspace 总是允许"通道。
- `packages/ui/src/approval/approval-card.browser.test.tsx`；`apps/desktop/src/renderer/stores/chat-store-approvals.test.ts`、`chat-store-permissions.test.ts`；`apps/desktop/e2e/approvals.e2e.test.ts`、`permissions.e2e.test.ts`（Shift+Tab 循环、full-access 警示、Permissions 分区增删规则、"总是允许"下拉），以及 `package-smoke.e2e.test.ts` 中打包产物里的一次允许。

## 延伸阅读

- [ADR 0005](../adr/0005-permission-mode-and-sandbox.md)：模式、沙箱与提权的决定。
- [apps/server README](../../apps/server/README.md)：协议总览。
- [Agent 执行约定](../tech-stack/agent-runtime.md)：统一接入链的约定。
