# 07: Todo List 与 Queue：todo_write、注入、dock 的 Todo 卡与 Queue 卡

**What to build:** 见 [规格](../spec.md) "Todo List"与"界面"一节：agent `tasks/todo/`（校验、id 生成、结果文本、`<todo_list>` 文本）；`todo_write`（权限类 session-state）；`todo_list` 条目；server `context/todo.ts`（注册工具、有未完成项时的 system section）；renderer dock 的 Todo 卡与 Queue 卡（`dock-slots.ts` 两行改为可用）。Queue 卡显示 chat-store 中未送达的追加指令。

**User stories:** 10, 11

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/tasks/todo/`、`packages/agent/src/session-entries/tasks.ts`、`packages/protocol/src/todo.ts`、`apps/server/src/application/context/todo.ts`、`apps/desktop/src/renderer/features/conversation/dock/{todo-card,queue-card}.tsx`、`dock/dock-slots.ts`（todo、queue 两行）、`packages/i18n/src/dictionaries/domains/todo.ts`、`tests/integration/{sidecar-todo,secrets-gate-todo}.test.ts`（新）、`apps/desktop/src/renderer/**/todo*.browser.test.tsx`（新）、`apps/desktop/e2e/dock.e2e.test.ts`（新）、`docs/subsystems/todo.md`（新）、`docs/subsystems/context.md`（压缩后重新注入一段）

- [x] agent 表驱动：规格列出的每条校验（重复、超长、> 50 项、两个 in_progress、未知 blockedBy、环、前置未完成时 in_progress / completed、result 位置与长度）各一例，违反时原表不变；id 生成
- [x] 集成：faux 调用 todo_write → `todo_list` 条目；下一个 Run 的 requestLog 含 `<todo_list>`；全部完成后不再注入；read-only 与 default 模式都不出现审批；压缩后 `<todo_list>` 仍在
- [x] 秘密总闸 `secrets-gate-todo.test.ts`：todo 内容含登记 Secret 时条目、WS、库与 requestLog 中没有明文
- [x] E2E：Todo 卡显示 c/n、当前项、blocked 提示、result；Run 中发出的追加指令出现在 Queue 卡、送达后消失、Run 结束退回输入区（沿用现有行为）；dock 顺序为 Todo → Goal → Queue（Goal 槽此时不显示）
- [x] 不适用项：本票不读取文件（Comments 写明不需要符号链接用例）
- [x] todo.md 建立并可达（导航行写在 Comments）；context.md 增加 `<todo_list>` 重新注入一段；`check:docs` 通过

## Comments
- 2026-10-30 implementer：完成（e22c114、d08b8dd、38747f2、4fde570）。
  - **验收逐项：** (1) `packages/agent/src/tasks/todo/todo.test.ts` 24 例：16 条校验各一例（重复 content / 去空白后重复 / 重复 id / 给出 id 与生成 id 相撞 / 空 content / > 500 / > 50 项 / 两个 in_progress / 未知 blockedBy / 自引用 / 环 / 前置未完成时 in_progress / completed / result 在 pending、in_progress 上 / result > 1000），另有边界值、id 生成、结果文本、section 有无，以及违反时端口未被调用（原表不变）。(2) `tests/integration/sidecar-todo.test.ts` 2 例：todo_list 在 tool_exec 与 toolResult 之间提交、生成的 id；下一个 Run 的 requestLog 含 `<todo_list>`；不合规则为错误结果且不提交；全部完成后不注入；default 与 read-only 都没有 approval_request；`/compact` 摘要掉调用之后 section 仍在。(3) `tests/integration/secrets-gate-todo.test.ts`：content 与 result 含登记 Secret（非凭据形态），扫描 WS 帧、HTTP 响应、requestLog、todo_list 行、落盘文件与 stderr。(4) `apps/desktop/e2e/dock.e2e.test.ts` 2 例 + `dock/todo-cards.browser.test.tsx` 3 例：c/n、当前项、"等待 t2"、展开 result、全部完成后下一个 Run 隐藏；Queue 卡出现、送达后消失、停止后退回输入区；dock 顺序 Todo → Queue，没有 goal-card。(5) 本票不读取文件路径：注入内容来自条目，不新增读取根，不需要符号链接用例。(6) `docs/subsystems/todo.md` 新建，从 context.md 的新小节"压缩后的 `<todo_list>`"链接可达；`check:docs` 0 问题。
  - **命令与结果：** `git merge main`（已是最新）后：install=0、typecheck=0、lint=0、format:check=0、check:docs=0（150 文件 0 问题）、`pnpm run test`=0：221 文件、1540 通过、1 跳过（settings.e2e 原有 skip），含 desktop-e2e 全部文件与 package-smoke 2/2，无未处理错误。
  - **负向确认：** 各测试先红（agent 24 例、integration 2 例在实现前失败）。变异：todo_list 入库不经 toNewEntry 时总闸失败；`todoListSection` 在全部完成时仍注入时 sidecar-todo 与 agent 各 1 例失败。均已还原。
  - **越出 Write scope（最小改动）：** ① `apps/server/src/application/context/types.ts`：`ContextContributionOptions.entries?: SessionEntryAccess`（`list` / `commit`）。现有贡献没有提交条目的途径，todo_write 需要提交 todo_list。② `apps/server/src/runtime/layers.ts` Assembly 层约 10 行：用 `store` 与 `jobs.hub` 实现 entries（`toNewEntry` 脱敏 → appendEntries → publishEntry）并传给 `createContributions`；票 03 也改 layers.ts，合入时可能需要手工合并（位置在 `const extra = …` 与 `createContributions` 之间）。③ `dock/dock.browser.test.tsx`：注册表断言的 todo、queue 改为 true；"没有 dock"一例改为 dock 存在但 `display: none`（两张卡已挂载、无内容）。票 06 / 08 改同一文件的其他行。
  - **未验证：** 真实模型（无凭据）。窄窗口只在约 414px 的 Browser Mode 截图中看过明暗两种主题，没有在 Electron 中逐状态检查。
  - **文档影响 / 需要 Lead 处理：** `docs/README.md` 当前行为导航加一行："- [Todo List](subsystems/todo.md)：todo_write 的校验与权限类、todo_list 条目、有未完成项时注入的 <todo_list>（压缩后仍在）、dock 的待办卡与队列卡。" `packages/agent/README.md` / `apps/server/README.md` 要点（交给票 10 汇总）：agent `tasks/todo/` 导出 `createTodoTool`、`TodoPort`、`normalizeTodoItems`、`todoListSection`、`todoResultText`、`TodoValidationError`；server 新增 `SessionEntryAccess` 贡献选项。
  - **供后续票：** 需要在工具或动作中提交自己条目的领域（08 的 plan、09 / 10 的 goal）可以用 `options.entries.commit(sessionId, entry)`：条目不带 runId，与运行时条目同样脱敏并推送，返回入库后的条目（取脱敏后的 payload）。时间线中原有的"待送达"气泡仍在，与 Queue 卡重复显示；是否去掉由 Lead 决定（`timeline-view.tsx` 不在本票范围）。
