# 03: 标题栏改为标题行与“对话”tab 行，移除连接状态与费用

**What to build:** 对话详情页的标题栏分两行。上面是标题行：标题、worktree 分支 chip，以及后台任务、子代理、定时任务、团队四个状态按钮。下面是 tab 行，只有一个选中的“对话”tab，采用下划线式。Sidecar 连接指示和 Session 费用按钮从标题栏移除：连接变化仍由只给读屏器的状态元素播报，启动失败时的全屏提示保留；Session 费用仍可在 Trace tab 和 Goal 卡中查看。

**规格场景:** [spec](../spec.md) 的 AC-07 中标题行与 tab 行的部分（“更多”和“打开侧边栏”分别由 05、06 交付，完整组合由 09 验证），以及 AC-08；对应 HEAD-01 至 HEAD-04。

**设计依据:** 规格本身，没有单独的设计。

**文档影响:** workbench 当前行为说明的标题栏部分；goal 中删除标题栏费用的契约。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Closed: true

- [x] 标题行保持 48px 高。标题为 14px、字重 500，单行截断，并能读到完整标题；分支 chip 紧跟在标题后面。四个状态按钮的行为不变。新对话页不显示标题和 tab 行。
- [x] tab 行只有一个选中的“对话”tab：下划线式，13px、字重 500，选中时文字与 2px 下划线均为 link 蓝，tab 行下方有一条细分隔线。保留 tab 列表与 tab 的语义；点击不切换内容。交互控件按共享规则退出窗口拖拽区。
- [x] Sidecar 连接指示（圆点与文字）不再出现在标题栏。连接变化仍由视觉隐藏的状态元素播报。先查清现有 E2E 依赖的就绪信号，保证它们继续可用：例如 first-send E2E 在新对话页上也会等待连接就绪，而新对话页的标题栏不渲染连接状态。启动失败时的全屏提示层照常出现。
- [x] Session 费用按钮及其悬停分项卡不再出现在标题栏。格式化、定价与货币函数保留；Trace、Goal 和 Subagent 中的费用展示不受影响。
- [x] 标题与 tab 的样式使用 Coko 现有的语义 token，不新增全局 token。文案走 zh/en 类型化字典。
- [x] 断言旧行为的测试同步修改，原因记入 Comments，例如断言费用按钮或可见连接文字的测试。真实 App 的 Browser Mode 测试覆盖：两行结构、tab 语义、两项移除，以及读屏状态元素。
- [x] 同步修改 workbench 与 goal 当前行为说明。实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-04：用户回复“确认”，确认 9 票及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。本票不改交接按钮（04）和右栏开关（06）。04—07 也会改对话区的同一个文件；实施时可以先把标题栏拆成独立组件来减少冲突，前提是可见行为不变。

- 2026-11-04：03 已实施（基线 `25d4228e`，独立 worktree `/tmp/coko-status-03`、分支 `codex/status-03`）。详情页保留 48px 标题行，标题与分支相邻；下方使用唯一选中的 13px 对话 tab 和 2px link 下划线。复用类型化字典 `frame.main`，没有新增全局 token。标题栏移除连接点、连接文字和费用按钮／HoverCard，保留用量汇总、定价与货币格式化；交接和右栏开关留待 04、06。
- TDD：先新增真实 App 的标题结构断言，`pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx -t 'details use a 48px'` 在实现前因找不到 Conversation tab 失败；实现后纳入完整 App 文件通过。连接状态移到标题栏外的常驻 `sr-only` `role=status` 元素，保留 `data-connection`，新对话切换不会卸载；失败层与连接阶段／语言更新另有 App 用例覆盖。
- 旧测试按获批行为同步：SessionCost 的 UI 断言改为不再存在，底层 Session／Run 合计仍有明确数值断言；request／attempt 用量回放保留每轮计数与去重断言，Goal E2E 保留 Goal 卡费用与真实接口比较。后续 Token 状态栏接管 Session 计量展示。另发现 App 字典检查把动态消息时间当成固定 chrome 文案；在原基线恢复四个实现文件后用 `pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx -t 'zh：界面 chrome'` 同样失败，现只排除 `<time>` 的动态文本与 aria-label，时间行为仍归 MessageTime 的测试。
- 检查：`pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx`，1 文件 29 测试通过，退出码 0；`pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-cost.browser.test.tsx apps/desktop/src/renderer/features/conversation/request-usage.browser.test.tsx apps/desktop/src/renderer/features/conversation/attempt-usage.browser.test.tsx apps/desktop/src/renderer/features/conversation/dock/goal-card.browser.test.tsx` 的另外 4 文件共 22 测试通过。该组合中的 App 语言切换曾在 Escape 关闭设置时超时，定位到具体用例单跑通过，随后完整 App 29 测试通过；未放宽 timeout 或重试断言。
- 真实 Electron：`pnpm run test apps/desktop/e2e/goal.e2e.test.ts apps/desktop/e2e/first-send.e2e.test.ts`，2 文件 3 测试通过，退出码 0；globalSetup 构建本次产物。后台模式下验证首次发送前的连接就绪、跨切换／重启的草稿与设置、Goal 卡和用量；没有使用真实模型或可见原生窗口。
- 文档影响：两行标题栏及隐藏连接状态 → `docs/subsystems/workbench.md` 原地更新；标题栏费用移除、保留的 Session／Goal 计量与测试 → `docs/subsystems/goal.md` 原地更新。搜索标题栏费用、连接指示、会话标题栏后修正当前正文；规格的问题陈述及历史已交付材料保留原始语义。按 AGENTS → docs/README → 两份正文读回：引用、语义同步、归属、生命周期、正式引用方向、入口可达与历史保留均通过，无新增目录或失效链接。
- 静态检查：`pnpm run typecheck` 退出码 0；`pnpm run check:docs` 检查 319 个 Markdown、0 问题、退出码 0；所改 10 个 TypeScript／TSX 文件经 `pnpm exec oxfmt --check` 通过。未运行全仓测试。明暗主题、390px 联合外观、真实指针／原生层与 agent-browser 的整体静默验收由 09 完成，本票不宣称已覆盖整份规格。
