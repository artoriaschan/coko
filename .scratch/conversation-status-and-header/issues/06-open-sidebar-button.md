# 06: “打开侧边栏”按钮

**What to build:** 右栏开关改为“打开侧边栏”按钮，只在右栏关闭时显示，使用面板样式图标。Tooltip 为“打开侧边栏”，可访问名称为“打开右侧边栏”。右栏打开后，标题栏不再显示这个按钮；关闭右栏用右栏自带的 X，它的 Tooltip 改为“收起侧边栏”，可访问名称为“收起右侧边栏”。

**规格场景:** [spec](../spec.md) 的 AC-10；对应 HEAD-06。

**设计依据:** 规格本身，包括其中“图标按钮支持单独的 Tooltip”这一工程决定。

**文档影响:** workbench 当前行为说明的标题栏与右栏入口。

**Blocked by:** 03 — 标题栏改为标题行与“对话”tab 行（两票都修改标题栏右侧）

**Status:** ready-for-agent

Closed: true

- [x] 右栏关闭时，“打开侧边栏”显示在标题栏右侧。点击后右栏打开，按钮消失；用右栏的 X 关闭后，按钮重新出现。
- [x] Tooltip 与可访问名称符合规格；右栏 X 的 Tooltip 为“收起侧边栏”，可访问名称为“收起右侧边栏”。文案都来自 zh/en 类型化字典。
- [x] 共享的图标按钮支持单独传入 Tooltip 文字，不传时与可访问名称相同；其他使用方的行为不变。
- [x] 关闭右栏后，焦点回到重新出现的“打开侧边栏”按钮，不落到 `body`。
- [x] 现有的打开右栏并切换 tab 的入口照常工作：状态按钮、时间线的“查看”、计划入口。
- [x] 断言旧开关文案的测试同步修改，原因记入 Comments。真实 App 的 Browser Mode 测试覆盖：按钮的显示与隐藏、Tooltip、可访问名称和焦点。
- [x] 同步修改 workbench 当前行为说明。实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-04：用户回复“确认”，确认 9 票及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。本票不改右栏内容和 tab 样式。

- 2026-11-04：完成 HEAD-06 / AC-10。打开入口只在右栏关闭时显示，X 关闭后以 DOM ref 在布局阶段恢复焦点。`IconButton` 增加可选 `tooltip`，缺省使用 label；zh/en 分别维护短 Tooltip 与完整可访问名称。原有状态、计划与时间线入口未改动。
- TDD：`pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx -t 'Tooltip 独立于名称'` 在实现前 2 例因找不到新入口失败；实现后连同标题行用例 3 例通过（退出码 0）。真实 App 的 zh/en 测试验证 hover Tooltip、键盘打开、打开入口卸载、X 收起及焦点返回。
- 浏览器回归：`pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/conversation/collaboration.browser.test.tsx apps/desktop/src/renderer/features/conversation/dock/dock.browser.test.tsx apps/desktop/src/renderer/features/conversation/plan.browser.test.tsx apps/desktop/src/renderer/features/conversation/business-timeline.browser.test.tsx apps/desktop/src/renderer/features/right-panel/trace-tab.browser.test.tsx` 首轮 79 例中 77 通过，dock 的 2 例仍断言已移除费用/交接及全页仅有右栏 tab；按 03/04 的已确认行为更新注册表期望，并把 tab 查询限定右栏。`pnpm run test apps/desktop/src/renderer/features/conversation/dock/dock.browser.test.tsx` 随后 4/4 通过（退出码 0）。其余 5 文件 75 例通过。
- Electron：迁移 Subagents、Jobs、Schedules 的新按钮名称。`pnpm run test apps/desktop/e2e/jobs.e2e.test.ts apps/desktop/e2e/schedules.e2e.test.ts apps/desktop/e2e/subagents.e2e.test.ts` 首轮 Subagents 1 例通过，Jobs/Schedules 4 例因 article 包含已交付消息底栏而失败（如 `Started.Usage unavailable20:46`）；将回复读取限定现有 `assistant-message-body`，用户消息限定 `user-bubble`，未改变产品行为。Schedules 后续 2/2、`pnpm run test apps/desktop/e2e/jobs.e2e.test.ts` 2/2 通过（退出码 0）。
- 交叉修复：03 的 2px tab 下划线原用 `border-b-2`，触发既有中性边框守卫；改为独立 2px `bg-link` 指示条，保留总高度并用实际高度与颜色断言。`pnpm run test packages/ui/src/guards/style-guard.test.ts` 40/40 通过，未调整守卫或 token。`pnpm run typecheck` 退出码 0。
- 文档影响：标题栏入口、关闭路径、焦点与共享 IconButton 说明原地更新 `docs/subsystems/workbench.md`；从 AGENTS → docs/README → 正文读回，路径、语义、归属与引用方向均通过。`pnpm run check:docs` 检查 319 Markdown、0 问题（退出码 0）。真实 Electron agent-browser 与整体视觉留给 09；未验证原生层。
