---
kind: reference
description: "当前的交接（Handoff）契约：/handoff 与 POST /api/sessions/:id/handoff 的准入，trigger handoff 的摘要 Run（运行时的摘要模式、Goal 预算检查、摘要格式与上限），Run 正常结束后按目标（当前目录、新 worktree、已有 worktree）创建目标 Session（复制权限状态、首条 handoff_origin）与源的 handoff 条目，Goal 用量与之后请求的等待，界面的 slash 入口、失败 Toast 与重试、草稿与时间线行，以及与从此分叉的差异。修改交接的准入、摘要、目标创建或界面前查阅。"
lifecycle: active
---

# 交接（Handoff）

本文说明 Coko 当前如何把一个会话交接到新会话：模型把当前对话写成交接摘要，新会话以它为输入区草稿开始，用户修改后自己发送。界面使用当前目录；HTTP 接口也可以指定新的或已有 git worktree，见 [Worktree](worktrees.md)；摘要请求的预算检查见 [Goal](goal.md)；模型上下文见 [上下文管理](context.md)。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/agents/handoff.ts` | 摘要提示 `handoffPrompt`、准入 `hasUserMessage`、摘要截断 `handoffSummaryText`、目标条目推导 `handoffTargetEntries` |
| `apps/server/src/application/handoff.ts` | `HandoffService`：准入与目标校验、开始摘要 Run、Run 结束后创建目标、之后 Run 的请求等待 |
| `apps/server/src/application/context/handoff.ts` | 上下文贡献：`/handoff` 动作、`beforeRequest`、`onRunEnd` |
| `apps/server/src/http/routes/handoff.ts` | `POST /api/sessions/:id/handoff` |
| `packages/protocol/src/handoff.ts` | `HandoffPayload`、`HandoffOriginPayload`、`HandoffTarget`、`HandoffRequest`、`handoffPaths` |
| `apps/desktop/src/renderer/stores/handoff-store.ts` | renderer 的交接进度、git 状态、停止，完成时写草稿并切换会话 |
| `apps/desktop/src/renderer/features/conversation/handoff-effects.tsx`、`handoff-row.tsx` | 常驻交接效果与失败 Toast、时间线的交接行 |

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

Run 被停止、暂停或出错时什么都不创建（不建 worktree、不建 Session、不提交 handoff）。目标创建失败（例如校验之后 git 才发现分支已存在、绑定的 worktree 已被移除）时源 Session 以摘要 Run 的 runId 提交 `handoff_failed { instructions, summary, error, usage? }`：usage 照常计入 Goal，摘要保留在时间线的原始输入/输出中，客户端据此离开"正在创建"。

不继承：消息、MCP 工具加载记录、Goal、Todo、计划、后台任务、子代理、定时任务与 Checkpoint；源会话除摘要 Run 与 handoff 条目外不变，Goal 留在源会话：交接完成后 running 的 Goal 暂停（`handed-off`），用户可以恢复。

## Goal 用量

`handoff.usage` 与 `compaction.usage` 一样计入其 Run 所属 Goal 的 Token 与费用（摘要 Run 开始时 Goal 未终结且不是 paused 时属于该 Goal）。交接 Run 结束不发起 Goal Round；其他来源的 Run（例如用户恰在此时提交）在目标仍在创建时，该会话之后 Run 的模型请求先等 handoff 条目提交，再按 Goal 预算重查：交接的用量用尽预算时下一轮不发出请求，Goal 进入 budget-exhausted。

## 界面

- 界面只通过内置命令 `/handoff <下一步目标>` 发起交接，目标固定为当前目录。标题栏与窄窗口中没有交接按钮、交接对话框或旧的“更多操作”收起菜单；四个状态按钮在任何宽度下直接显示。HTTP 接口的 worktree 目标仍可用。
- 交接效果常驻对话区，不依赖标题栏或窗口宽度。收到 `handoff` 条目时把 `summary` 写入目标会话的输入区草稿（不发送），用户仍在源会话时切到目标会话；用户已离开时只写草稿。只处理订阅完成之后到达的新条目，打开会话时补发的历史不触发切换或失败 Toast。
- 摘要之后目标没能创建时，`handoff_failed` 条目使进度离开“正在创建新会话…”。每个失败 Run 弹出一次应用级错误 Toast，有已知错误码时显示本地化原因，并提供“重试”：读取该失败条目中的下一步目标，对源会话的当前目录重新发起摘要 Run。重试请求本身被拒绝时同样用 Toast 说明原因。原对话框的“复制摘要”入口已删除，摘要仍保留在时间线的原始输入/输出中。
- 时间线采用紧凑行，源与失败行可展开查看真实 instructions、summary 和结果字段；展开不创建 Session 或发送草稿，打开或返回按钮始终独立可达。源会话的 `handoff` 行“已交接到 <标题>”（目标为 worktree 时注明）可打开目标；目标会话的 `handoff_origin` 行“交接自 <标题>”可跳回源会话。失败行显示失败与原因，没有打开目标的按钮。

## 与从此分叉的差异

| | 从此分叉 | 交接 |
| --- | --- | --- |
| 入口 | 成功助手底栏“在新对话中分支”；`POST /api/sessions/:id/fork` 保留用户锚点兼容入口 | `/handoff`、`POST /api/sessions/:id/handoff` |
| 模型请求 | 无 | 一次摘要请求（trigger handoff，无工具，经 Goal 预算检查） |
| 新会话的上下文 | 助手包含／旧用户之前边界的有效消息（含当时有效压缩摘要） | 没有消息；摘要作为输入区草稿 |
| 首条条目 | `fork_origin`（来源、边界与复制历史证明） | `handoff_origin { sessionId, seq }` |
| 已加载的 MCP 工具 | 只继承所选边界之前的有效加载记录，包含压缩前的加载 | 不继承，新会话按需搜索 |
| 复制的权限状态 | `permission_mode`、`permission_rule`；助手分支使用源当前状态 | 源当前权限状态 |
| 工作目录 | 源会话实际目录（包含已绑定 Worktree） | 界面为当前目录；HTTP 接口也支持新 worktree 或已有 worktree |
| 源会话 | 不变 | 增加摘要 Run 与 `handoff` 条目 |
| 新会话的输入区 | 助手分支为空；旧用户边界返回目标文本 | 交接摘要 |
| 不复制 | Goal、Todo、计划、后台任务、Hook、子代理、定时任务与交接记录 | 相同，另外不复制任何消息 |

## 已知限制

- 目标在摘要之后才创建：校验之后才出现的冲突（例如同名分支）使交接失败。界面收到 `handoff_failed` 条目后以 Toast 显示错误与重试（见 [界面](#界面)）；重试会重新写一次摘要。
- 模型可见的摘要质量没有用真实模型验证。

## 验证与相关设计

- `tests/integration/sidecar-handoff.test.ts`：摘要请求（requestLog）、目标继承与不继承、新 worktree 与工作目录、已有 worktree 复用、git-status、409 / 400、停止时不创建，对手用例（预算耗尽时不发请求、交接用量计入 Goal 且之后的请求先计入它）。
- `tests/integration/secrets-gate-handoff.test.ts`：摘要请求、handoff 条目、目标标题与条目、HTTP、WS、库与日志中没有登记的 Secret 明文。
- `apps/server/src/application/handoff.test.ts`、`packages/agent/src/agents/handoff.test.ts`：准入、目标校验、目标条目（与分叉同一规则）、请求等待。
- `apps/desktop/src/renderer/stores/handoff-store.test.ts`、`features/conversation/handoff.browser.test.tsx`：进度、历史不切换或 Toast、草稿、目标创建失败（failed、原因、按原目标重试）、常驻效果与交接行（含失败行）。
- `apps/desktop/e2e/handoff.e2e.test.ts`：键盘提交 `/handoff`、当前目录、目标草稿、两边的交接行、明暗主题对比度。
