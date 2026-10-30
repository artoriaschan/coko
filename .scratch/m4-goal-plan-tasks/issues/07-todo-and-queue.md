# 07: Todo List 与 Queue：todo_write、注入、dock 的 Todo 卡与 Queue 卡

**What to build:** 见 [规格](../spec.md) "Todo List"与"界面"一节：agent `tasks/todo/`（校验、id 生成、结果文本、`<todo_list>` 文本）；`todo_write`（权限类 session-state）；`todo_list` 条目；server `context/todo.ts`（注册工具、有未完成项时的 system section）；renderer dock 的 Todo 卡与 Queue 卡（`dock-slots.ts` 两行改为可用）。Queue 卡显示 chat-store 中未送达的追加指令。

**User stories:** 10, 11

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/tasks/todo/`、`packages/agent/src/session-entries/tasks.ts`、`packages/protocol/src/todo.ts`、`apps/server/src/application/context/todo.ts`、`apps/desktop/src/renderer/features/conversation/dock/{todo-card,queue-card}.tsx`、`dock/dock-slots.ts`（todo、queue 两行）、`packages/i18n/src/dictionaries/domains/todo.ts`、`tests/integration/{sidecar-todo,secrets-gate-todo}.test.ts`（新）、`apps/desktop/src/renderer/**/todo*.browser.test.tsx`（新）、`apps/desktop/e2e/dock.e2e.test.ts`（新）、`docs/subsystems/todo.md`（新）、`docs/subsystems/context.md`（压缩后重新注入一段）

- [ ] agent 表驱动：规格列出的每条校验（重复、超长、> 50 项、两个 in_progress、未知 blockedBy、环、前置未完成时 in_progress / completed、result 位置与长度）各一例，违反时原表不变；id 生成
- [ ] 集成：faux 调用 todo_write → `todo_list` 条目；下一个 Run 的 requestLog 含 `<todo_list>`；全部完成后不再注入；read-only 与 default 模式都不出现审批；压缩后 `<todo_list>` 仍在
- [ ] 秘密总闸 `secrets-gate-todo.test.ts`：todo 内容含登记 Secret 时条目、WS、库与 requestLog 中没有明文
- [ ] E2E：Todo 卡显示 c/n、当前项、blocked 提示、result；Run 中发出的追加指令出现在 Queue 卡、送达后消失、Run 结束退回输入区（沿用现有行为）；dock 顺序为 Todo → Goal → Queue（Goal 槽此时不显示）
- [ ] 不适用项：本票不读取文件（Comments 写明不需要符号链接用例）
- [ ] todo.md 建立并可达（导航行写在 Comments）；context.md 增加 `<todo_list>` 重新注入一段；`check:docs` 通过

## Comments
