# 07: 会话行：详情卡片、长标题与置顶

**What to build:** hover 独立对话或项目内对话时，行尾出现置顶 / 取消置顶与查看更多按钮（菜单由 08 提供），并在该行右侧显示详情卡片：第一行是完整标题与相对时间，第二行是归属（独立对话为聊天图标与“对话”，项目内会话为文件夹与项目名，置顶后仍显示原项目）。卡片与行顶部对齐、表面间距 2px，指针穿过间距或焦点进入卡片时保持打开。标题单行，溢出时可用触控板、滚轮、拖动与键盘横向滚动，按滚动位置显示两侧渐隐：起点只弱化右侧，中间两侧弱化，终点只弱化左侧，没有溢出时没有遮罩；行尾按钮不随滚动移动，拖动标题不进入会话也不置顶。点击斜图钉把会话移出原列表、放入“置顶”分类：置顶区按置顶时间排列、最近置顶的在上，之后不随活动重排；没有置顶项时整个分类连同标题都不显示；置顶标题栏只有展开收起箭头，没有右端按钮；置顶会话显示聊天图标。取消置顶后恢复原分类与项目关系，当前打开的对话内容不卸载、不重建。

- 行为依据：[规格](../spec.md) 4.2、CHAT-01 至 CHAT-06、CHAT-08、CHAT-09（会话部分；整个项目的置顶由 14 负责）、LIST-12 的相对时间、13.1 的图钉、置顶行与详情卡片行。

**User stories:** 6（置顶分类）、13、14、16（会话部分）、17

**Blocked by:** 06

**Status:** ready-for-agent

**Write scope:** apps/server 的会话置顶与取消置顶；packages/protocol；renderer 的会话行、详情卡片、可滚动渐隐标题与置顶分类；packages/ui 中行右侧 2px 顶对齐的浮层定位与渐隐标题部件；i18n；projects.md 的置顶一节。

**跨票接口：** 浮层定位与渐隐标题部件供 08 的菜单、14 的项目卡片复用；置顶分类组件由 14 扩展为同时显示项目树。

- [x] Sidecar 协议：置顶与取消置顶后读回置顶时间；最后记录时间与项目归属不变。
- [x] Browser Mode：卡片在行右侧、间距 2px、顶部偏移 0px，两种归属显示正确；三种渐隐状态与无溢出时无遮罩，按钮固定；拖动标题不进入会话、不置顶；置顶后原分类不再出现该会话，置顶区按置顶时间排列，空置顶区不显示；取消置顶后当前对话的内容不重建；图钉斜向右上、针尖朝左下（CW-17 至 CW-20、CW-22 的会话部分）。
- [x] Electron E2E：置顶一个项目内会话后重启，它仍在置顶区，详情卡片显示原项目；取消置顶后回到该项目的会话列表。
- [x] projects.md 的置顶一节；`check:docs` 通过。


Closed: true

## Comments

2026-11-03：完成本票；从集成分支 `daa2d0a` 开始，使用规格第 18 节已确认的 Sidecar、Browser Mode 和真实 Electron 接口做 TDD。复用 01 的组织字段，不增加迁移。

- 协议：`PUT /api/sessions/:id/pin` 与 `SetSessionPinRequest`，根会话置顶、重复置顶保留时间、取消置顶；不追加条目，不改变最后记录时间或项目归属。列表 store 只在成功响应后合并结果，失败保留原位置并显示 Toast。
- 界面：独立 `SessionRow` 提供详情、固定的 24px 操作、14px/45° 图钉；置顶分类在换序分类之外，全部显示、按置顶时间排列、无右端操作。项目关系与当前对话/编辑器 DOM 保留。
- 共享部件：`RowHoverCardContent` 与 `rowOverlayPosition` 提供整行右侧 2px/顶部对齐、portal、窗口避让和可用高度内滚动；`FadingTitle` 与 `FadingTitleHandle.handleKeyDown` 提供键盘、触控板、滚轮和拖动及三种渐隐。行主按钮转交键盘事件，不引入嵌套可聚焦控件。滚动条规则在主题样式表维护，无样式守卫例外。
- 后继接口：08 在 `SessionRow` 的查看更多按钮处接入菜单，按钮已经先关闭详情；14 可复用浮层位置和标题部件，并扩展置顶分类为项目树。当前更多按钮不切换会话；菜单内容不在本票交付。

TDD 与回归证据：先观察 pin 路由 404、缺少置顶按钮、缺少详情区域、缺少滚动标题的失败，再逐片实现。窄窗口用例先得到详情底部 1072px 超出 300px 窗口的失败，修为可用高度内滚动；图标测量先得到 12px 而非 14px，修为显式 SVG 尺寸。联合 App 测试复现关闭中的 HoverCard 退场层拦截设置页首次 Escape，确认 `data-state=closed` 后改为立即卸载已关闭的卡片；没有放宽原设置返回断言。标题拖动时不把整行视为卡片外部点击，保证拖动后仍能阅读卡片。

最终验证（退出码均为 0）：

- `pnpm run test tests/integration/sidecar-session-pinning.test.ts tests/integration/sidecar-projects.test.ts apps/desktop/src/renderer/features/sidebar/session-row.browser.test.tsx apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx packages/ui/src/guards/style-guard.test.ts`：6 文件、84 项通过（2 项真实 Sidecar、8 项会话行、8 项原列表、26 项应用、40 项样式守卫）。
- `pnpm run test apps/desktop/e2e/session-pinning.e2e.test.ts apps/desktop/e2e/sidebar-lists.e2e.test.ts apps/desktop/e2e/workbench.e2e.test.ts`：3 文件、5 项真实 Electron 通过；globalSetup 构建并打包本次测试产物，使用真实 Sidecar。项目会话置顶后重启仍只有一行，卡片保留原项目，取消后回到项目。
- `pnpm run typecheck`、`pnpm run lint`、`pnpm run check:docs`（246 个 Markdown，0 问题）、`git diff --check` 均通过；Impeccable 机械检查结果 `[]`。
- 浅/深色截图已生成并读回：完整长标题、滚动中的渐隐、固定操作、336px 卡片与共享材质；自动测量覆盖起点、中间、终点三种渐隐。截图为本地忽略输出，可重跑浏览器用例生成。普通窗口实测 2px 间距、顶部偏移 0；390×300 边缘场景完整内容可在卡片内滚动。日期、相对时间与图标名称来自字典/用户数据，示例标题中性，无参考图个人数据。

已有用例调整：`fixture-chat` 补充真实协议形状的置顶响应；App 只新增当前内容与草稿 DOM 保留用例，其余旧断言保留。Sidecar 用例在创建后先读回 Session 作为时间戳基线，因为创建响应 DTO 在初始权限条目写入前构造，不能把该条目的时间戳刷新误判为置顶导致。

文档影响：详情、标题与置顶 → `docs/subsystems/projects.md` 原地更新 → `docs/README.md` 同步摘要；ADR 0020 的当前实施范围补充会话置顶，保留 partial（项目完整管理与附加目录仍待后续票）。搜索 `projects.md`、旧“两类基础列表”及“置顶尚未”结论，更新当前正文，已完成票的历史记录及规格目标保持原意。按 AGENTS → docs/README → projects 正文读回：路径与引用、语义同步、归属与权威、引用方向、生命周期、当前入口、新会话读入、历史保留八项均通过，无正式文档反向依赖任务材料。

未运行真实外部模型、发布构建 smoke 或 CI；本票为本地实施与提交，未推送。
