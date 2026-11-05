---
kind: reference
description: "当前的 Todo List 契约：todo_write 工具（整表替换、校验规则、id 生成、结果文本、权限类 session-state）、todo_list 条目、有未完成项时在 Run 开始按变化送达的 State Update，以及输入区上方 dock 的待办卡与追加指令队列卡。修改 Todo 的校验、注入、条目或 dock 卡片前查阅。"
lifecycle: active
---

# Todo List

本文说明 Coko 当前如何让 Agent 维护一张可见的步骤清单（[Todo List](../../GLOSSARY.md)）：模型用 `todo_write` 整表替换，表作为 Session 条目保存，有未完成项时在下一个 Run 开始通过 State Update 看到它，用户在输入区上方的待办卡中看到进度。同一位置的队列卡显示尚未送达的追加指令（[Steering](../../GLOSSARY.md)）。owner、认领与跨代理共享的 Task 尚未实现。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/tasks/todo/` | `normalizeTodoItems`（校验与 id 生成）、`todoResultText`、`todoListSection`、`createTodoTool(port)`、`TodoPort`、`TodoValidationError` 与上限常量 |
| `packages/agent/src/session-entries/tasks.ts`、`packages/protocol/src/todo.ts` | `todo_list` v1 的 payload schema `{ items: [{ id, content, status, blockedBy?, result? }] }` |
| `apps/server/src/application/context/todo.ts` | 上下文贡献 `todoContribution`：注册 `todo_write`、`todo_list` 当前状态贡献、`currentTodoItems` |
| `apps/server/src/application/context/types.ts` 的 `SessionEntryAccess`、`runtime/layers.ts` | 领域提交自己的条目：经 `toNewEntry` 脱敏后入库，再经 hub 推送 |
| `apps/desktop/src/renderer/features/conversation/dock/todo-card.tsx`、`queue-card.tsx`、`dock-slots.ts` | dock 的待办卡与队列卡 |

## todo_write

参数 `{ items: [{ id?, content, status, blockedBy?, result? }] }`，每次调用以整张表替换当前表。status 为 pending、in_progress、completed、cancelled。

- **规范化。** id 省略时按位置生成 `t1`、`t2`…；content 与 result 去掉首尾空白；空的 result、空的或重复的 blockedBy 引用省略。
- **校验。** 违反任一条时调用以错误结果返回（`isError: true`），不提交条目，当前表不变：至多 50 项；content 1–500 字符（UTF-16 码元）且不重复；id 不重复（给出的 id 与生成的 id 相撞也算）；至多一个 in_progress；blockedBy 只引用表内 id、无环（含引用自己）；前置项未完成（completed、cancelled 之外）时不能为 in_progress 或 completed；result 不超过 1000 字符且只能在 completed 或 cancelled 项上。空表合法，用于清空。
- **结果。** `Updated todo list: <p> pending, <i> in progress, <c> completed, <x> cancelled.`，空一行后每项一行 `- [status] id: content`，有前置项时加 ` (blocked by t1, t2)`，有 result 时下一行缩进 `  result: …`；空表为 `(empty)`。结果取自入库后的表，因此已替换登记明文。
- **权限。** 权限类 session-state：所有模式放行（含 read-only），拒绝与询问规则照常生效，规则名为 `todo_write`，见 [权限判定与审批](permissions.md)。工具按 side-effect 调度（与同批其他写入串行），执行前提交 `tool_exec`。工具只在有 Session 的 Run 中注册。

## 条目

`todo_list` 条目在 `tool_exec` 之后、该调用的 toolResult 之前提交，不带 runId（与 `permission_mode` 相同）。payload 与运行时条目一样经 `redactSecretsDeep` 替换登记的 Secret 与 Credential 明文后入库并推送。当前表是该 Session 最新的 `todo_list` 条目；回退对话不改变它，分叉不复制它（新 Session 从无表开始）。

## 注入

每个带新输入的对话 Run（submit、goal、schedule、subagent）开始时读取当前表。有 pending 或 in_progress 项时，`todo_list` 当前值为 `{ items }`，否则为 null。当前值与有效模型上下文中最近一次配对送达的值不同才发送；工具结果不算已送达。块为 `<state_update name="todo_list">`，正文与 todo_write 的结果相同，放在 user message 的最前面；每块前置一条 `state_update` v1 `{ name, value }` 条目。全部完成时送达一次清空；从未送达且为空时不发送。

待办不再进入 system section，因此写待办不会改变下一个 Run 的系统消息。Run 内写入到下一个 Run 才送达，模型先从工具结果得知变化。回退和压缩会使移出有效上下文的送达记录失效；下一个 Run 自然重发当前表。retry、手动 compact 与 handoff 不发送新状态。来源配对、隐藏和降级见 [上下文管理](context.md#state-update)。

## 界面

- **待办卡**（dock 第一张）：标题"待办 c/n"（c 为 completed 与 cancelled 之和）与当前 in_progress 项；点击展开整张表：状态图标、cancelled 加删除线、pending 项的前置项未完成时显示"等待 t2"、有 result 的项可再展开看 result。展开状态只存在 renderer 内存中、按会话区分，缺省收起。全部完成或取消时只显示"全部完成"一行，之后的下一个 Run 开始时隐藏；没有表或表为空时不显示。
- **队列卡**（dock 最后一张）：本窗口在 Run 中发出、尚未送达的追加指令（chat-store 的 `steering`），标题"待送达 n"与说明"当前步骤结束后送达"；每条单行截断，悬停或聚焦时 HoverCard 显示全文。送达后由 user 条目替代并消失；Run 结束时未送达的追加指令照旧退回输入区。不能撤回。时间线中不再另显示待送达气泡，队列卡是唯一呈现。
- dock 的顺序为待办 → Goal → 队列；Goal 卡见 [Goal](goal.md#界面)。

## 验证

- `packages/agent/src/tasks/todo/todo.test.ts`：每条校验规则一例（违反时抛出、端口没有被调用）、边界值、id 生成、结果文本、section 的有无、结果取自端口保存的表。
- `tests/integration/sidecar-todo.test.ts`：真实 Sidecar 上 todo_write 提交 todo_list（位置与生成的 id）、下一个 Run 的 faux requestLog 含 `state_update`、系统消息不变、值不变去重与完成清空、不合规则的调用为错误结果且不提交条目、全部完成后不再注入、default 与 read-only 模式都没有审批、`/compact` 之后下一个 Run 重发当前表，并覆盖 retry、回退与伪造标签。
- `tests/integration/secrets-gate-todo.test.ts`：todo 内容与 result 含登记 Secret 时 todo_list 条目、工具结果、WebSocket 帧、HTTP 响应、库、requestLog 与日志中没有明文。
- `apps/desktop/src/renderer/features/conversation/dock/todo-cards.browser.test.tsx`：待办卡的计数、当前项、展开、等待提示、result、全部完成与下一个 Run 后隐藏；队列卡的截断、HoverCard 全文、送达后消失与 dock 顺序。
- `apps/desktop/e2e/dock.e2e.test.ts`：Electron 中的待办卡与队列卡、停止后追加指令回到输入区。

## 延伸阅读

- [上下文管理](context.md)：system section 的组合与压缩。
- [权限判定与审批](permissions.md)：session-state 权限类。
