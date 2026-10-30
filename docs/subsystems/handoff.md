---
kind: reference
description: "当前的交接（Handoff）契约：/handoff 与 POST /api/sessions/:id/handoff 的准入，trigger handoff 的摘要 Run（运行时的摘要模式、Goal 预算检查、摘要格式与上限），Run 正常结束后按目标（当前目录、新 worktree、已有 worktree）创建目标 Session（复制权限状态、首条 handoff_origin）与源的 handoff 条目，Goal 用量与之后请求的等待，界面的对话框、进行中与停止、草稿与时间线行，以及与从此分叉的差异。修改交接的准入、摘要、目标创建或界面前查阅。"
lifecycle: active
---

# 交接（Handoff）

本文说明 Coko 当前如何把一个会话交接到新会话：模型把当前对话写成交接摘要，新会话以它为输入区草稿开始，用户修改后自己发送。目标目录可以是新的 git worktree，见 [Worktree](worktrees.md)；摘要请求的预算检查见 [Goal](goal.md)；模型上下文见 [上下文管理](context.md)。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/agents/handoff.ts` | 摘要提示 `handoffPrompt`、准入 `hasUserMessage`、摘要截断 `handoffSummaryText`、目标条目推导 `handoffTargetEntries` |
| `apps/server/src/application/handoff.ts` | `HandoffService`：准入与目标校验、开始摘要 Run、Run 结束后创建目标、之后 Run 的请求等待 |
| `apps/server/src/application/context/handoff.ts` | 上下文贡献：`/handoff` 动作、`beforeRequest`、`onRunEnd` |
| `apps/server/src/http/routes/handoff.ts` | `POST /api/sessions/:id/handoff` |
| `packages/protocol/src/handoff.ts` | `HandoffPayload`、`HandoffOriginPayload`、`HandoffTarget`、`HandoffRequest`、`handoffPaths` |
| `apps/desktop/src/renderer/stores/handoff-store.ts` | renderer 的交接进度、git 状态、停止，完成时写草稿并切换会话 |
| `apps/desktop/src/renderer/features/conversation/handoff-dialog.tsx`、`handoff-row.tsx` | 标题栏"交接"按钮与对话框、时间线的交接行 |

## 入口与准入

- 内置命令 `/handoff <下一步目标>`：目标为当前目录。
- `POST /api/sessions/:id/handoff { instructions, target }` → 202 `{ runId }`。`target` 为 `{ kind: 'current' }`、`{ kind: 'new-worktree', name? }` 或 `{ kind: 'worktree', worktreeId }`。

按顺序拒绝（都不开始 Run）：

1. Session 不存在 404；子 Session（子代理）409 `child-session`。
2. 有 Run 进行中，或上一次交接的目标仍在创建：409 `run-in-progress`。
3. 下一步目标为空 400 `bad-request`；有效上下文（回退区间之外）没有用户消息 400 `nothing-to-hand-off`。
4. 目标校验：已有 worktree 不存在 404、属于别的 Workspace 400、已移除 409 `worktree-removed`；新 worktree 的名字不合法 400 `invalid-name`、会话目录不在 git 仓库中 400 `not-a-git-repo`、同名 worktree 已存在 409 `worktree-exists`。

## 摘要 Run

交接开始一个 `trigger: handoff` 的 Run（运行时的摘要模式）：只发一次模型请求，内容为该会话的有效上下文（与普通 Run 相同的 system sections 与消息，登记的 Secret 已替换）加摘要提示，不注册工具；Run 只提交 `run_start` 与 `run_end`，对话记录不变。摘要请求之前照常经请求前检查：Goal 为 running 且预算已耗尽时不发出请求，Run 以 `paused` + `budget_exhausted` 结束，Goal 进入 budget-exhausted，不创建目标。

摘要提示要求模型只回复 Markdown 的四个小节：`## Context`（决定与做法）、`## Files`（读过或改过的文件）、`## Open items`（未完成的工作与 Goal、Todo、后台任务、子代理与定时任务的状态）、`## Task`（下一步目标改写成的具体步骤），至多 12 000 字符；下一步目标在提示末尾的 `<next-goal>` 中。摘要去掉首尾空白，超过上限时截断。模型试图调用工具或回复为空时 Run 以 error 结束。

## 目标 Session

摘要 Run 以 `completed` 结束后：

1. 按目标取得 worktree：当前目录沿用源会话绑定的 worktree（没有时不绑定）；已有 worktree 为所选的；新 worktree 此时才经 [Worktree](worktrees.md#创建) 创建（不复制未提交的改动）。
2. 创建目标 Session：同一 Workspace、模型与推理档位，标题为下一步目标的首行（登记的 Secret 与凭据形态已替换，至多 60 字符）。
3. 源 Session 以摘要 Run 的 runId 提交 `handoff { targetSessionId, instructions, summary, target: current | worktree, usage? }`；`usage` 为摘要请求的 usage。
4. 目标 Session 依次提交首条 `handoff_origin { sessionId, seq }`（指向源 handoff 条目）与源会话有效条目中的 `permission_mode`、`permission_rule`（去掉 runId，顺序不变）。

Run 被停止、暂停或出错时什么都不创建（不建 worktree、不建 Session、不提交 handoff）。目标创建失败（例如校验之后 git 才发现分支已存在）只记 warn，源会话不变。

不继承：消息、Goal、Todo、计划、后台任务、子代理、定时任务与 Checkpoint；源会话除摘要 Run 与 handoff 条目外不变，Goal 照常留在源会话。

## Goal 用量

`handoff.usage` 与 `compaction.usage` 一样计入其 Run 所属 Goal 的 Token 与费用（摘要 Run 开始时 Goal 未终结且不是 paused 时属于该 Goal）。摘要 Run 结束后 Goal 可能立即开始下一轮；目标仍在创建时，该会话之后 Run 的模型请求先等 handoff 条目提交，再按 Goal 预算重查：交接的用量用尽预算时下一轮不发出请求，Goal 进入 budget-exhausted。

## 界面

- 标题栏"交接"按钮（子 Session 不显示）打开对话框：下一步目标（⌘↩ 提交）、新会话的目录（当前目录 / 新 worktree（名称可选）/ 已有 worktree（列出 active 的）；不在 git 仓库时只能选当前目录）、源会话有未提交文件时的提示（按 `GET /api/sessions/:id/git-status` 的 `dirtyFiles`，按目标说明新会话是否看到这些改动）。被拒绝时在对话框内显示原因，输入保留。
- 提交后对话框显示"正在写交接摘要…"与停止，摘要 Run 正常结束后为"正在创建新会话…"；按钮在进行中显示进度。停止后提示没有创建新会话。进度由源会话的条目派生：`trigger: handoff` 的 `run_start` 开始，`run_end` 结束，`handoff` 条目完成。
- 收到 `handoff` 条目时把 `summary` 写入目标会话的输入区草稿（不发送），用户仍在源会话时切到目标会话（对话框随之关闭）。只处理订阅完成之后到达的条目，打开会话时补发的历史不触发切换。
- 时间线：源会话的 `handoff` 行"已交接到 <标题>"（目标为 worktree 时注明）可打开目标；目标会话的 `handoff_origin` 行"交接自 <标题>"可跳回源会话。

## 与从此分叉的差异

| | 从此分叉 | 交接 |
| --- | --- | --- |
| 入口 | 时间线中某条用户消息的"从此分叉" | 标题栏"交接"、`/handoff`、`POST /api/sessions/:id/handoff` |
| 模型请求 | 无 | 一次摘要请求（trigger handoff，无工具，经 Goal 预算检查） |
| 新会话的上下文 | 目标之前的有效消息（含最后一个压缩摘要） | 没有消息；摘要作为输入区草稿 |
| 首条条目 | `fork_origin { sessionId, seq }` | `handoff_origin { sessionId, seq }` |
| 复制的权限状态 | `permission_mode`、`permission_rule` | 相同（同一规则） |
| 工作目录 | 源会话的 Workspace | 当前目录、新 worktree 或已有 worktree |
| 源会话 | 不变 | 增加摘要 Run 与 `handoff` 条目 |
| 新会话的输入区 | 目标消息的文本 | 交接摘要 |
| 不复制 | Goal、Todo、计划、后台任务、Hook、子代理、定时任务与交接记录 | 相同，另外不复制任何消息 |

## 已知限制

- 目标在摘要之后才创建：校验之后才出现的冲突（例如同名分支）使交接失败，界面停在"正在创建新会话…"，关闭对话框即可；源会话有 warn 日志。
- 交接之后源会话的 Goal 照常推进（交接不暂停它）。
- 模型可见的摘要质量没有用真实模型验证。

## 验证与相关设计

- `tests/integration/sidecar-handoff.test.ts`：摘要请求（requestLog）、目标继承与不继承、新 worktree 与工作目录、已有 worktree 复用、git-status、409 / 400、停止时不创建，对手用例（预算耗尽时不发请求、交接用量计入 Goal 且之后的请求先计入它）。
- `tests/integration/secrets-gate-handoff.test.ts`：摘要请求、handoff 条目、目标标题与条目、HTTP、WS、库与日志中没有登记的 Secret 明文。
- `apps/server/src/application/handoff.test.ts`、`packages/agent/src/agents/handoff.test.ts`：准入、目标校验、目标条目（与分叉同一规则）、请求等待。
- `apps/desktop/src/renderer/stores/handoff-store.test.ts`、`features/conversation/handoff.browser.test.tsx`：进度、历史不切换、草稿、对话框与交接行。
- `apps/desktop/e2e/handoff.e2e.test.ts`：键盘操作的对话框、新 worktree、进行中、目标草稿、两边的交接行、明暗主题对比度。
