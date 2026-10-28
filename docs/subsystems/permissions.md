---
kind: reference
description: "当前的权限判定与审批契约：判定顺序、受保护路径、ApprovalBroker 状态、审批条目、回答路由、拒绝语义与审批卡。修改判定、审批流程或审批界面前查阅。"
lifecycle: active
---

# 权限判定与审批

本文说明当前代码中工具调用如何被判定、需要审批时如何等待与回答。长期取舍（模式与沙箱叠加、提权不可保存）见 [ADR 0005](../adr/0005-permission-mode-and-sandbox.md)；本文只描述已实现的部分。当前限制：模式固定为 default、没有可保存的规则，命令不在沙箱中运行（见文末"尚未实现"）。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/policy/decide.ts` | 纯函数 `decide(call, { mode, rules, workspace, writableRoots })` → allow / deny / ask（附建议规则） |
| `packages/agent/src/policy/paths.ts` | 把工具参数解析为绝对路径与真实路径（经符号链接，含悬空链接）；模式对应的可写根 |
| `packages/agent/src/policy/broker.ts` | `ApprovalBroker`：每个运行时一个，提交请求与决定条目，等待回答 |
| `packages/agent/src/policy/gate.ts` | 权限 hook，位于 `ToolHooks.beforeToolCall` 链首；模型可见的拒绝文本 |
| `packages/agent/src/engine/runtime.ts` | `AgentRuntimeOptions.permissions`、`answerApproval()`、`pendingApprovals`；拒绝后结束 Run |
| `apps/server/src/application/sessions.ts` | 回答路由的应用层、Session `activity`、扩展工厂 `extensions` |
| `packages/ui/src/approval/approval-card.tsx` | 共享审批卡（键盘与单次回答） |
| `apps/desktop/src/renderer/features/conversation/approval-panel.tsx` | 审批卡的业务组合：标题、命令 / 路径 / diff 摘要 |

工具契约（`packages/agent/src/tools/types.ts`）增加 `effect: 'read' | 'side-effect'`（缺省 side-effect）与 `permissionSubject(args)`。内置工具：read、grep、find、ls 为 read，subject 是路径（缺省 `.`）；write、edit 为 side-effect，subject 是路径；bash 为 side-effect，subject 是命令。`effect` 目前只是声明，调度与执行记录由后续功能使用。

## 判定

判定只看工具名所属的组：read 组（read、grep、find、ls）、edit 组（write、edit）、bash；其他名字（宿主新增的工具）按原名判定。规则以组名书写：`Read`、`Edit`、`Bash`，未知工具用原名。

顺序固定（ADR 0005）：

1. 拒绝规则 → deny，模型收到 `Permission denied by rule …`。
2. 询问规则 → ask（没有建议规则）。
3. edit 组写入受保护路径 → ask，没有建议规则；允许规则不能免掉。
4. edit 组写入越出可写根 → ask，没有建议规则（这次批准即这次提权）。
5. 模式放行：default 与 read-only 下只有 read 组在 Workspace 内的读取。
6. 允许规则 → allow。
7. 其余 → ask。read 组读取 Workspace 之外为 `outside-workspace`，其他为 `approval-required`；建议规则为命令原文、Workspace 内的相对路径或 Workspace 外的绝对路径。

路径按真实路径判定：Workspace 内指向外部的符号链接按外部位置处理；Workspace 与可写根也是真实路径。default 的可写根是 Workspace、`os.tmpdir()` 与 `/tmp` 的真实路径。

**受保护路径**：任意深度的 `.git`、`.coko`、`.vscode`、`.idea` 目录，以及任意位置的 `.bashrc`、`.zshrc`、`.profile`、`.bash_profile`、`.zprofile`、`.gitconfig`、`.ssh`、`.mcp.json`。比较前转小写；解析前或解析后的路径任一命中即受保护。只约束 edit 组；bash 的写入目标无法预知，不受此检查。

规则内容目前只做精确匹配（命令原文；路径为 Workspace 相对路径、绝对路径或原样参数）。glob 路径、命令前缀与复合命令拆分属于后续功能。

## 审批状态与条目

判定为 ask 时，broker 先登记等待、再提交 `approval_request { requestId, toolCallId, toolName, kind: 'tool', subject, suggestions }`。状态只能前进一次：

| 结局 | 何时 | approval_decision |
| --- | --- | --- |
| allowed | 用户允许 | `{ outcome: 'allowed', scope: 'once' }` |
| denied | 用户拒绝 | `{ outcome: 'denied', feedback? }`（反馈去掉首尾空白，最长 4000 字符） |
| cancelled | Run 被停止（abort signal） | `{ outcome: 'cancelled' }` |

决定条目提交完成后调用才继续；条目在 SQLite 提交后才推送，与其他条目一样按 seq 补发。没有超时，没有订阅客户端时请求保持等待。同一批的多个调用由 pi 逐个准备，因此请求按调用顺序一个接一个出现。条目提交失败时 Run 以 `commit_failed` 结束。

**拒绝语义**：

- 无反馈的拒绝：该调用得到错误结果 `The user rejected this tool call. …`；同批其余调用不再询问，直接得到跳过结果；本批结束后不再请求模型，Run 以 `aborted` 结束。
- 带反馈的拒绝：反馈作为工具错误文本交给模型，Run 继续。
- 等待中停止：请求 cancelled，本批调用都不执行（pi 先准备整批再执行，已允许的同批调用也还没开始）。

## 协议

- `POST /api/sessions/:id/approvals/:requestId`，body 为 `AnswerApprovalRequest`：`{ decision: 'allow', scope? }` 或 `{ decision: 'deny', feedback? }`。成功 204；请求不在等待中 409 `approval-not-pending`；scope 不是 `once` 时 400（保存规则尚未实现）；Session 不存在 404。
- Session DTO 的 `activity`：Run 进行中且有待审批请求为 `awaiting-approval`，否则 `running` / `idle`。
- `inspect-quit` 的 `activeRuns` 包含等待审批的 Run。
- 重连：以 afterSeq 0 重新订阅即可看到仍在等待的 `approval_request`（没有对应 decision、所属 Run 未结束）。

## 界面

- 最早的待审批请求以审批卡接管输入区；输入区保持挂载（隐藏），草稿不丢。卡片出现时若焦点在输入区，焦点移到卡片本身（不是详情区，误触 Enter 不会允许）。
- 焦点在详情区时 Enter 允许一次、Esc 拒绝；Esc 被卡片处理后不再触发全局"停止 Run"。输入框与按钮保留自己的按键，输入法组合中不触发。"拒绝并说明原因"展开输入框，其中 Enter 提交带反馈的拒绝，Esc 收起。
- 键盘与指针共用一把锁，同一请求只回答一次；store 对同一 requestId 只发一次请求，失败后可重答，收到 `approval-not-pending` 后不再重答。
- 工具卡在等待时为 `awaiting` 状态，结束后标题行显示决定（已允许一次、已拒绝及原因、已取消）。
- 侧栏：`awaiting-approval` 的会话带徽标并排在所在 Workspace 组首，其次是运行中的会话。只有打开过（已订阅）的会话会随条目实时更新 activity，其余在下一次列表加载时更新。

## 尚未实现

模式选择与另外三种模式的界面、规则的保存与作用域（session / workspace / global）、模式或规则变更后的重新判定（superseded）、Seatbelt 沙箱与提权（escalation）、Sidecar 退出后请求过期（expired）。这些在 ADR 0005 的剩余项中跟踪。

## 验证

- `packages/agent/src/policy/decide.test.ts`：判定顺序、Workspace 内外读取、符号链接、受保护路径大小写变体、未知工具与建议规则。
- `packages/agent/src/policy/approvals.test.ts`：运行时上的请求、允许一次、拒绝两种语义、同批顺序、停止。
- `tests/integration/sidecar-approvals.test.ts`：真实 Sidecar 上的回答路由、409、activity、重新订阅与 inspect-quit；`secrets-gate.test.ts` 驱动审批卡通道。
- `packages/ui/src/approval/approval-card.browser.test.tsx`、`apps/desktop/src/renderer/stores/chat-store-approvals.test.ts`、`apps/desktop/e2e/approvals.e2e.test.ts`，以及 `package-smoke.e2e.test.ts` 中打包产物里的一次允许。

## 延伸阅读

- [ADR 0005](../adr/0005-permission-mode-and-sandbox.md)：模式、沙箱与提权的决定。
- [apps/server README](../../apps/server/README.md)：协议总览。
- [Agent 执行约定](../tech-stack/agent-runtime.md)：统一接入链的约定。
