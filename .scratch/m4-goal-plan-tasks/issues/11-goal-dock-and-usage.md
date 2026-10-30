# 11: Goal 卡、Run 用量与 Session 费用显示

**What to build:** 见 [规格](../spec.md) "界面"一节：dock 的 Goal 卡（`dock-slots.ts` 的 goal 一行改为可用）——目标、阶段徽标与原因、轮次、成功条件与证据、预算条（≥ 80% warning、耗尽 destructive、未定价提示）、暂停 / 恢复 / 编辑目标与预算 / 标为完成 / 取消（确认框）；`/goal` 无参数时打开 Goal 卡；时间线 `goal` 条目的紧凑状态行；每个 Run 结束后的用量行（Token 合计、费用或"未定价"）；会话标题栏 Session 累计费用（`header-actions.ts` 的 cost 一行，HoverCard 分项）。只改 renderer。

**User stories:** 1, 3, 5, 16

**Blocked by:** 10

**Status:** ready-for-agent

**Write scope:** `apps/desktop/src/renderer/features/conversation/dock/{goal-card.tsx,dock-slots.ts（goal 一行）}`、`features/conversation/{goal-row,run-usage-row,session-cost（新）}.tsx`、`features/conversation/header-actions.ts`（cost 一行）、`stores/goal-store.ts`（新）、`packages/i18n/src/dictionaries/domains/{goal,usage}.ts`、`apps/desktop/src/renderer/**/goal*.browser.test.tsx`（新）、`apps/desktop/e2e/goal.e2e.test.ts`（新）、`docs/subsystems/goal.md`（界面一节）

- [x] Browser Mode：九个阶段的徽标与原因文案（zh / en）；预算条阈值；未定价时费用条显示提示而不是 0；取消需确认；key 为 goalId 与 criterionId
- [x] E2E（真实 Sidecar + faux 多轮脚本）：建立 Goal → Goal 卡出现在 Todo 与 Queue 之间 → 轮次随 Goal Round 增长 → 暂停后不再推进、恢复后继续 → 编辑预算后 budget-exhausted 的 Goal 可恢复 → 完成后显示证据
- [x] E2E：Run 用量行与标题栏累计费用与 `GET …/goal` 及条目中的 usage 一致；切换主题、窄窗口（390 px）与键盘操作下 Goal 卡可用（截图检查结果写在 Comments）
- [x] 不适用项：不新增注入点或读取根（Comments 写明）
- [x] goal.md 界面一节；`check:docs` 通过

## Comments
- 2026-10-30 lead：来自票 06——i18n 键 conversation.steeringPending 已不再使用（时间线"尚未送达"气泡已删除），本票从 zh / en 字典删除（越出写范围，已授权：packages/i18n/src/dictionaries/{en,zh}.ts）。
- 2026-10-30 lead：来自票 10——GoalResponse.usage 带 toolCalls / tokens / cost / durationMs / costUnpriced；@coko/protocol 的 USAGE_CURRENCY_SETTING 与 usageCurrencyOf；i18n 已有 usage.unpriced、usage.currency.*、usage.price.*；详见票 10 Comments。界面上显示"未定价"时与 Goal 的 cost-unpriced 阻塞原因保持同一措辞。
- 2026-10-30 implementer（m4/11-goal-dock-and-usage）：
  - **覆盖的验收：** 全部 5 项。Browser `dock/goal-card.browser.test.tsx`（11 例）：九个阶段的徽标与原因 zh / en 各一例（字面期望，不取字典）、阈值表（79.9% / 80% / 100%）、预算条 data-level、实际渲染颜色与 bg-warning / bg-destructive / bg-primary 一致、进度宽度按比例、meter 角色；未定价时 Goal 卡费用为"Unpriced"、费用条为提示且没有 meter；取消先确认（"保留目标"不发请求，确认后 cancel 带 revision、"正在停止"、清理结果）；同一 goalId 的新快照不重挂载卡片与 criterion 行，新 Goal 换节点；budget-exhausted 恢复不可用 → 编辑预算（校验、分钟换算）→ 可恢复；revision 冲突提示；`/goal` 打开空状态且不调用 submitMessage；Run 用量行与标题栏费用（未定价 / 已定价 / 部分未定价、键盘聚焦打开分项）。E2E `apps/desktop/e2e/goal.e2e.test.ts`（1 例，真实 Electron + Sidecar + faux，faux 设价格）：dock 顺序 todo → goal → queue；轮次 1 → 2；Goal Round 2 中暂停 → paused、Session 空闲、轮次与 run_start 数不变；恢复 → 第 3 轮后工具调用上限 3 耗尽 → budget-exhausted、恢复按钮禁用；键盘 Enter 收起 / 展开、Tab 到"编辑"、对话框中改上限为 6 并以 Enter 保存 → 恢复 → complete、两条证据；每个用量行的 tokens / cost 与条目 usage 逐 Run 相等，标题栏为总和，`GET …/goal` 的 tokens、cost 为建 Goal 之后各 Run 之和、rounds 4，Goal 卡费用与之相等；`/goal` 重新展开卡片且不增加用户消息。
  - **截图检查**（E2E 设 `COKO_E2E_SCREENSHOT_DIR` 保存，人工查看；缺省不保存）：明 / 暗 1280 px 与 390 px 的 budget-exhausted 卡片，亮色 1280 px 的完成卡片。两种主题下阶段点、warning / destructive 预算条、禁用的恢复按钮与 destructive 文字的"取消目标"可读；390 px 时标题行的徽标、轮次与费用换到第二行，操作按钮换行，没有裁剪或整页横向滚动（用例同时断言 scrollWidth ≤ 390、按钮在视口内）。390 px 时侧栏收起、设置入口不可见，用例在 1280 px 切换主题后再缩窄。
  - **负向确认（变异，均已还原）：** warning 阈值改为 90% → 阈值与预算条 2 例失败；Goal 卡费用不按未定价显示 → 未定价用例失败；chat-store 不处理 204 → 新用例失败。E2E 首次运行因 390 px 时找不到设置按钮失败（用例问题，已改）。
  - **不适用项：** 只改 renderer：不新增协议字段、条目、注入点、读取根或输出通道（只读已有的 `GET / POST …/goal` 与条目，已由 secrets-gate-goal 覆盖）；不读取文件路径，不需要符号链接用例。
  - **越出 Write scope 的改动：**
    - `apps/desktop/src/renderer/client/api.ts`（submitMessage 接受 204，返回 `{ done: true }`）与 `stores/chat-store.ts` 的 submit（done 时撤销乐观的运行中）、`stores/chat-store.test.ts` 一例。原因：Sidecar 对不开始 Run 的动作（`/goal pause`、`/plan` 无消息等）回 204，renderer 原先按 SubmitMessageResponse 校验失败，报 bad-response Toast 并停在运行中。这两个文件属于"只有 02 改"。
    - `features/conversation/conversation-pane.tsx`（约 10 行）："02 独占"。`/goal` 无参数时在 renderer 内打开 Goal 卡、不发送；Run 进行中的 `/goal pause` / `/goal cancel` 走 send（Sidecar 的 whileRunning 动作），不走 steer（steer 遇到动作返回 bad-request）。
    - `dock/dock.browser.test.tsx` 与 `dock/todo-cards.browser.test.tsx` 的注册表断言改为 goal、cost 已交付。
    - `packages/i18n/src/dictionaries/{en,zh}.ts` 删除 `conversation.steeringPending`（已授权）；usage 域删除未使用的 `usage.queue`。
    - `header-actions.ts` 删除不再使用的 `Unavailable` 占位。
  - **实施要点与取舍：** Goal 快照取自最新的 goal 条目（与 WS 同步），已用量在条目数变化时经 GET 重读（同一会话只采用最后一次请求）。未定价判定：回复的 provider / model 在设置的 Provider 目录中时看是否有 price，不在目录中（faux、已删除的 Provider）时看 cost.total > 0（与票 10"目录中显式写了价格即为已定价"一致）。Goal 卡费用按 `usage.costUnpriced`（当前模型）判定。Session 费用只计带 runId 的条目（分叉复制来的消息去掉 runId，费用属于原 Session）。终态 Goal 在下一个 Run 开始前显示，可关闭。卡片缺省收起，`/goal` 展开。编辑只开放目标与五维预算（规格写"编辑目标与预算"），成功条件与约束不在界面编辑。
  - **已知限制：** 只有 compaction 而没有 assistant 消息的 Run（手动 `/compact`）没有用量行，但其 usage 计入标题栏费用（时间线分发由票 02 按 assistant usage 决定）。草稿（尚无 Session）中输入 `/goal` 仍会发送并建 Session。部分未定价时只注明"部分未定价"，不列出哪些 Run 未定价（用量行逐 Run 显示）。
  - **实际运行（`git merge main` 已是最新，main 986f3a4）：** `pnpm install --frozen-lockfile`=0、`typecheck`=0、`lint`=0（0 warning）、`format:check`=0、`check:docs`=0（154 文件 0 问题）；全量 `pnpm run test`（等其他 vitest 结束后运行，含 desktop E2E 与 package-smoke）=0：250 文件、1916 通过、1 跳过（真实模型），无未处理错误。第一次全量中 goal.e2e 在 390 px 后只读一次按钮位置（重排未完成，443 > 390）而失败，改为轮询几何（ef9e297）后单独与全量均通过。
  - **未验证：** 真实模型（无凭据）；中文界面下的 Electron 截图（只在 Browser Mode 断言 zh 文案）。
  - **文档影响：** `docs/subsystems/goal.md` 增"界面"一节、描述与开头一句、验证两条；`check:docs` 0 问题。建议 Lead 把 docs/README.md 中 goal.md 一行补上"、Goal 卡与用量界面"（不在本票范围）。
- 2026-10-30 lead：实施者把票文件与截图写进了主仓库检出（未提交）；lead 保留主仓库里更完整的票记录，截图（304K PNG，临时产物）不入库已删除。评审后合入 main（1c958e8）。接受越界：client/api.ts 与 chat-store.ts 把 204 视为完成（修复了 /goal pause 等动作报错并停在运行中的缺陷）、conversation-pane.tsx 的 /goal 本地打开与运行中的 /goal pause / cancel 走 send、两个 dock 测试的注册表断言、删除 steeringPending 与未用的 usage.queue。合入后 main 连续四次全量各有 1 例失败，lead 逐个修复（均在独立分支，断言不放宽）：(1) local-exec.test.ts 的 kill 用例——信号在 bash 进入 wait 前到达时以 0 退出，改为 exec 前台 sleep；(2) goal-card.browser 的 /goal 用例——第一次以为是菜单时序、改错一次，读到实际失败值 "keep this draft/goal" 后确认是 app.browser.test.tsx 留在 localStorage 的草稿泄漏到本文件，改为每个用例前清空 localStorage，并与泄漏来源文件同跑 3 次验证；(3) goal.e2e 的 /goal 步骤——等命令菜单打开再按 Esc、关闭后再按 Enter。最终 main 全量 250 文件 1916 通过、1 跳过（真实模型），无页面重载、无未处理错误；check:docs 154 文件 0 问题。worktree 已清理。

Closed: true
