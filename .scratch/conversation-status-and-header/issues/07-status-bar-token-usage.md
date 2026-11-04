# 07: 输入框底部状态栏与 Token 用量

**What to build:** 对话详情页的输入框卡片下方出现状态栏，水平居中，与输入框共用列宽；输入框卡片底边到主区底边的距离从 16px 增加到 30px。状态栏先显示 Token 胶囊，内容是整个 Session 的用量（不含 Subagent 的子 Session），格式为 `45.2K tok · 缓存命中 90%`。点击胶囊打开 Token 卡，显示精确总量和各分项，不显示费用。Session 已归档、worktree 已移除的只读状态下，以及审批卡或结果确认卡占用输入位置时，状态栏照常显示。没有数据时输入框不跳动。

**规格场景:** [spec](../spec.md) 的 AC-01 中 Token 与布局的部分、AC-03、AC-04、AC-05 中单张卡的部分、AC-06；对应 STAT-01、STAT-02、STAT-03、STAT-06 至 STAT-10。

**设计依据:** 规格本身，没有单独的设计。

**文档影响:** workbench 当前行为说明的输入区与状态栏。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Closed:** true

- [x] 状态栏只在详情页出现，新对话页不显示。在 Session 详情页的整个生命周期内保持挂载：输入框、审批卡、结果确认卡与归档/只读提示之间切换时，不重新挂载。
- [x] 尺寸：输入框卡片底边到状态栏 4px，状态栏高 22px，状态栏到主区底边 4px，合计 30px。胶囊为 12px 弱化色文字，胶囊之间间距 12px；图标 14px、stroke 1。空间不够时用省略号截断，不换行。没有数据时保留 22px 空行。
- [x] Token 总量复用现有的 Session 级汇总：包括主循环、压缩、交接摘要与标题生成请求，不包括 Subagent 的子 Session；只累计服务商已上报的分桶。胶囊显示 `45.2K tok · 缓存命中 90%`，图标为数据库。没有输入时省略缓存命中部分；没有任何用量计数时不显示胶囊。
- [x] Token 卡的标题行：左侧为数据库图标加“Token 用量”，右侧为带千位分隔的精确总量。之后依次为缓存命中、未缓存输入、缓存读取、缓存写入、输出，以及推理（确有数据时才显示）。只在有未上报的分项时显示“数据不完整”说明。不显示费用。
- [x] 把“本轮用量”卡的字段渲染抽成两张卡共用的部分；“本轮用量”卡的外观与行为不变。
- [x] 点击胶囊打开或关闭卡片；点击外部或按 Escape 关闭，焦点回到胶囊。同一时间只开一张卡。卡片默认出现在上方，靠近视口边缘时自动调整位置，不被裁剪。胶囊的可访问名称包含完整读数，只在文字被截断时显示 Tooltip。
- [x] 数值随条目提交更新，流式输出过程中不变化；重新加载与重启后与持久化事实一致，不重复计数。上下文环留在输入框工具栏的原位。
- [x] 状态栏的行结构要允许 08 把会话统计胶囊加在 Token 胶囊之前。
- [x] 断言输入区底部间距的测试同步修改，原因记入 Comments。真实 App 的 Browser Mode 测试覆盖：读数、卡片、交互、视口边缘，以及归档/只读/卡片占用三种状态。代表性的 E2E 检查 faux Run 之后的读数。
- [x] 同步修改 workbench 当前行为说明。实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-04：用户回复“确认”，确认 9 票及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。本票不新增服务端接口或进度事件。

- 2026-11-04 实施完成：`SessionStatusBar` 常驻详情页底部，空行几何为 4 + 22 + 4px；胶囊及 Portal 卡片按已提交 Session 用量聚合，详情与助手底栏共用 `UsageFields`。旧底栏字段与交互保持原行为；状态栏只在 Session 切换时重置，输入区接管/只读切换保留组件身份。新文案写入类型化 zh/en usage 字典。
- TDD：先运行新增真实 App 状态栏测试，因缺少状态栏失败；实现后连同既有助手底栏 Browser Mode 测试 19/19 通过。新增 faux adapter 报告转发用例先因 report 丢失失败，加入显式可选 `usage.report` 后通过；未提供报告仍保持未知。
- 验证：`pnpm run test apps/desktop/src/renderer/features/conversation/session-status-bar.browser.test.tsx apps/desktop/src/renderer/features/conversation/assistant-footer.browser.test.tsx`，2 文件 19 例，退出 0（包含 7 个真实 App 场景：空行/精确读数/键盘、390px 浮层与提交回放、审批、结果确认、归档、worktree 移除及缺项/新对话）。`pnpm run test packages/ui/src/guards/style-guard.test.ts apps/desktop/src/renderer/features/conversation/session-cost.test.ts` 实际只选中 style guard 1 文件 40 例，退出 0；后者路径不存在，不作为其验证证据。`pnpm run typecheck` 退出 0。`pnpm run check:docs` 检查 319 个 Markdown，0 问题，退出 0。改动源码/测试的 `pnpm exec oxlint <改动文件>` 退出 0。
- Electron：`pnpm run test apps/desktop/e2e/message-footers-protocol.e2e.test.ts` 当前构建上 3/3 通过，退出 0。通过真实 Electron/Sidecar 与受控协议模型验证 Token 胶囊累计含标题、排除子 Session 与复制历史、重复读取及应用重启。原测试在 25d4228e 的 `[data-usage-part] dd` 选择器与源码中的 dd 自身属性已不一致，同时期待零缓存行、未知缓存的精确值及不带推理后缀的输出；对照该基线 `assistant-footer.tsx` 修正为原有“省略零缓存、未知下界、推理为输出子集”的断言，并把 SessionCost 入口断言迁到 Token 胶囊。未改变底栏实现语义。
- 文档影响：workbench 原地加入状态栏、用量口径与交互；server README 记录仅测试用 faux `usage.report` 的显式报告接缝。从 AGENTS → docs/README → workbench 读回：路径、职责、引用方向、当前入口及历史保留均通过，正式文档不反向引用任务材料。未修改视觉稿或上下文环。
- 未验证/后续组合：无真实模型凭据；原生保存框不涉及本票。默认 faux 没有报告分桶，不能把字符估计值冒充统计；新增显式 `usage.report` 驱动供 09 联合 faux Run 读数使用，本票的完整读数与重启证据来自上述更严格的受控协议 Electron 测试。agent-browser、四种主题/语言及两胶囊互斥由 08/09 组合验收。
