# 02: tab 条的完整交互

**What to build:** 在 01 的 tab 条上补齐其余交互：

- **关闭。** 中键关闭 tab。右键菜单提供“关闭”“关闭其他标签页”“关闭右侧标签页”，批量关闭只作用于本格。引导页是唯一的 tab 时，中键无效，右键不弹出菜单。
- **排序。** tab 可以拖拽排序。焦点在 tab 上时，也可以用键盘左移、右移；具体按键在本票确定，不能与“方向键在 tab 之间移动焦点”冲突。
- **溢出与截断。** tab 放不下时，tab 条横向滚动，不显示滚动条，两端渐隐，只有胶囊让出空间。过长的标题单行截断，截断后用 Tooltip 显示全文。
- **发光。** 再次打开一个已经显示在屏幕上的页面时，它所在的格向内发光约 600ms。需要切到后台 tab 或展开右栏时不发光。系统要求减少动态效果时，发光在同样时长内保持，不淡出。
- **语义。** tab 条按 WAI-ARIA tabs 的手动激活模式工作。

**规格场景:** [spec](../spec.md) 的 AC-03、05、07、08，以及 AC-06 中中键与右键的部分。对应 RP-04（发光）、RP-06（溢出与截断）、RP-07（中键与右键菜单）、RP-08、RP-17（tab 语义）。

**设计依据:** [design](../design.md) 的“共享 tab 条与引导卡片”；spec 的 Q19、Q20，以及参考差异中补充的键盘排序和标题截断。

**文档影响:** workbench 的右栏 tab 交互；ui-design-system 的右栏 tab 条几何、溢出渐隐与发光。

**Blocked by:** 01 — 右栏改为按 Session 的单格 tab 容器

**Status:** ready-for-agent

**Closed:** true

- [x] 中键关闭，以及右键菜单的三项，每种方式只关闭对应的 tab，批量关闭只作用于本格。没有撤销入口。唯一的引导页中键无效，右键不弹出菜单。（AC-05、06）
- [x] 拖拽和键盘两种方式都能改变 tab 的顺序，方向键在 tab 之间移动焦点不受影响。拖拽优先复用侧栏分类排序已经用到的拖拽库，不新增依赖。（AC-07）
- [x] tab 放不下时横向滚动，不显示滚动条，两端渐隐。长标题显示省略号，悬停时 Tooltip 显示全文。末端的按钮不被压缩或裁切。（AC-08）
- [x] 发光符合 RP-04：已经显示的页面被再次打开时发光；切到后台 tab 或展开右栏时不发光；减少动态效果时发光保持，不淡出。（AC-03）
- [x] tab 条采用 WAI-ARIA tabs 的手动激活模式，按钮都有可访问名称，键盘路径完整。
- [x] 共享组件的样式通过样式守卫。真实 App 的 Browser Mode 覆盖以上交互，包括明暗主题和 390px 宽度。
- [x] 按测试约定运行最小相关测试集与类型检查，同步上述文档；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户回复“全部采用推荐”，确认 12 张票及其阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05：由新的 implement_02 子代理在 `codex/right-sidebar-02` 独立 worktree 实施，基于集成提交 `4d9f4250`。完成 AC-03、05、06（中键与右键）、07、08，以及 RP-17 手动激活语义。键盘排序确定为 ⌘/Ctrl+Shift+Left/Right，普通 Left/Right 与 Home/End 只移动焦点，Enter/空格激活；tab 提供 `aria-keyshortcuts` 和本地化说明。
- 关闭与排序：中键关闭；共享 RowMenu/DropdownMenu 提供关闭、关闭其他、关闭右侧；唯一开始页不响应中键和右键。批量动作在按 Session 的布局 store 中执行。拖拽复用既有 `@dnd-kit/core@6.3.1`，UI 包显式声明同版本依赖，没有引入新库或新版本。两个 Browser Mode 配置预声明该依赖，避免首次加载时 Vite 动态优化重载测试页面。
- 几何与提示：tab 列表独立横向滚动，主题隐藏其滚动条，按滚动位置显示 12px 边缘渐隐；真实截断才显示完整标题 Tooltip。新标签页和收起按钮修正为 H28，与 H38 tab 条的内容区相符。活动页面重复打开时，PanelAttention 在格内用 ring 语义色发光 600ms；打开后台页面或重新展开时不发光。真实 Chromium reduced-motion 测试发现主题会把 CSS 动画缩短到 0.01ms，因此改用 WAAPI：读取主题中的组件局部持续时间，减少动态效果时保持静态 600ms，不重挂载正文。
- TDD：先观察 App 的方向键场景失败（焦点仍停在 Plan），再实现手动激活/键盘排序；中键场景先失败（Plan 未关闭）后通过；指针排序先失败（顺序未变化）后通过；溢出先失败（overflowX 是 hidden）后通过；长标题先失败（没有全文 Tooltip）后通过；重复打开先失败（没有发光覆盖层）后通过。真实 reduced-motion 分支先观察到 0.01ms 与预期 600ms 不符，修正后正常与 reduced 分支均通过。
- 最终检查均退出 0：`pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/right-panel apps/desktop/src/renderer/features/conversation/collaboration.browser.test.tsx apps/desktop/src/renderer/features/conversation/business-timeline.browser.test.tsx apps/desktop/src/renderer/features/conversation/dock/dock.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-menu.browser.test.tsx apps/desktop/src/renderer/features/settings/schedules-notifications.browser.test.tsx packages/ui/src/components/panel-tabs.browser.test.tsx packages/ui/src/guards/style-guard.test.ts scripts/browser-deps.test.ts`：14 个文件、163 项通过、0 跳过；包含真实 App 的中英文/明暗主题/390px、键盘与指针排序、批量关闭、手动激活、正常与真实 reduced-motion 发光，以及共享长标题 Tooltip。`pnpm run typecheck`、针对本次 TS/TSX 文件的 `pnpm run lint ...` 与 `pnpm run format:check ...`、`pnpm install --frozen-lockfile` 全部通过；`pnpm run check:docs` 检查 342 个 Markdown，0 问题。
- 文档影响：右栏交互 → `docs/subsystems/workbench.md` 原位补充；共享 tab 条几何/渐隐/发光 → `docs/tech-stack/ui-design-system.md` 新增同文件章节。搜索正式文档、项目技能及本功能任务中的旧固定 tab、唯一引导页、tab 排序与关闭描述；有效正文已同步，规格的问题陈述和已关闭 01 票保留原始历史语义，未改其他票的范围。已从 AGENTS → docs/README → 所属正文读回：路径与引用、语义同步、归属与引用方向、生命周期/当前入口、独立读入、历史保留均通过；未新增目录或正式文档反向依赖。
- 验证限制：本票没有运行 Electron E2E、agent-browser、真实鼠标/原生层、打包、真实模型或 CI；这些未作为本票通过证据。按集成编排，Electron 与静默 agent-browser 的最终验收由 12 票执行；保留该票依赖，未宣称整个规格已交付。
