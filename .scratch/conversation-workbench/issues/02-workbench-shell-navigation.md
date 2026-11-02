# 02: 双栏外壳与导航

**What to build:** 工作台改为“左侧导航与列表 + 右侧内容”的双栏外壳。窗口四角都是圆角，右上与右下不被矩形内容层盖住；左上角在窗口控制按钮之后依次为收起侧栏、后退、前进；侧栏顶部为“新对话”“插件”“定时任务”三项，新对话行右侧有搜索图标；底部固定用户区（头像、用户名、设置入口，上方细分隔线），列表在中间滚动、不挤压用户区。“插件”“定时任务”在右侧内容区打开现有的设置分区，侧栏保持可见。后退、前进只记录右侧内容区去过的位置（会话、新对话、插件、定时任务），不含设置页；历史只在内存中，重启后为空；已不在列表中的会话（删除或归档后）自动跳过。

- 行为依据：[规格](../spec.md) NAV-01 至 NAV-05、NAV-07、13.1 的窗口、顶部安全区与用户区行、20.1 的工作台节点。
- 过渡：搜索图标暂时打开现有的标题过滤（22 换成搜索浮层）；“新对话”暂时沿用现有的草稿流程（11 换成欢迎页）。
- 收起侧栏后的形态沿用现有行为；右侧面板不变；设置为整页（NAV-05），返回后保留草稿与列表状态。

**User stories:** 1、2、3、4、5

**Blocked by:** 无（可立即开始）

**Status:** ready-for-agent

**Write scope:** renderer 的应用外壳与侧栏容器（顶部菜单、搜索入口、底部用户区、收起）、导航历史 store；packages/ui 的 AppFrame（窗口圆角与裁剪）；i18n；`docs/subsystems/workbench.md` 的外壳与导航一节（文件不存在时按 coko-docs 新建并在 docs/README 加入口）。

**跨票接口：** 侧栏容器在中间滚动区渲染 01 的列表组件。导航历史在会话从列表消失时自动跳过它，09 的删除与 10 的归档不需要调用它；11 与 22 经它打开位置。

- [x] Browser Mode：顶部三项 H32，没有专家、远程控制、更多与帮助入口；左上按钮的顺序与无历史时的禁用态；历史记录会话、新对话、插件与定时任务，不记设置页，跳过已不在列表中的会话；插件与定时任务在右侧显示对应的设置分区且侧栏可见；底部用户区固定；仅图标按钮有可访问名称与 Tooltip，不显示快捷键。
- [x] Electron E2E：窗口四角均为圆角，包括右上与右下；在两个会话、插件与定时任务之间切换后，后退、前进到达正确位置；打开设置再返回，草稿与列表状态保留（CW-01、CW-02）。
- [x] workbench.md 的外壳与导航一节；`check:docs` 通过。


**Closed:** true

## Comments

### 2026-11-03 实施与验证

- 外壳与导航已实现：顶部三项 H32，新对话行右侧独立搜索；左上收起、后退、前进依次排列；固定 H46 用户区、H36/R8 圆弧用户入口和 22px 头像。仅图标按钮沿用共享 IconButton 的可访问名称和 Tooltip，无快捷键文案。
- 新增窗口内存导航 store，记录会话、新对话、插件与定时任务，跳过列表中已删除或归档的会话；设置页不进入历史。插件与定时任务复用已有分区，内容区切换和整页设置保留对话组件与草稿。AppFrame 使用 R28 与 border-box clip-path，阻止矩形子层覆盖四角。
- 跨票接合：本提交暂保留原有中间列表和 helpers。01 号票提供 `SidebarLists({onAddWorkspace, search, onSelect, onNewSession})` 并完成列表数据拆分后，替换此插槽、移除旧 helpers，并把 app.tsx、sidebar-rail.tsx、workbench-navigation.ts 中的列表读取移至独立列表 store。外壳、顶部导航和底部用户区由本票提供。
- TDD：先运行新增 H32 浏览器用例，旧界面因缺少 Go back 按钮失败；增加实现后通过。四角命中测试还捕获到仅 overflow-hidden 时子层仍在角落命中，加入 border-box clip-path 后 Browser Mode 与真实 Electron 均通过。
- `rtk pnpm install --frozen-lockfile`：退出 0；未改 manifest 或锁文件。
- `rtk pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx packages/ui/src/app-frame/app-frame.browser.test.tsx packages/ui/src/guards/style-guard.test.ts`：退出 0，3 个文件、78 项通过。既有 app browser 用例仅把侧栏按钮的 New session/新会话 断言改为 New chat/新对话，conversation 标题保持当前行为，原因是 NAV-03 已明确更名。
- `rtk pnpm run test apps/desktop/e2e/workbench.e2e.test.ts`：退出 0，1 项通过。globalSetup 从本次源码生成 Electron/Sidecar/renderer 测试构建；真实 Electron 验证两个会话、插件与定时任务的前后跳转，设置返回后草稿与列表保留，以及四角无子层覆盖。
- `rtk pnpm run typecheck`：退出 0。
- `rtk pnpm run check:docs`：退出 0，245 个 Markdown 文件、0 问题；从 AGENTS → docs/README → workbench.md 读回，路径、语义、归属、引用方向、生命周期、导航与历史保留检查通过。新增 workbench.md 的外壳与导航正文，正式导航已接入；已有整页设置约定仍有效。搜索 `workbench.md`、`整页设置` 与 `三栏应用框架` 后未发现需替代的当前外壳正文。
- `pnpm exec oxfmt <本票 12 个 TS/TSX 文件>` 与 `pnpm exec oxlint <同一文件集>`：格式整理；lint 退出 0（若后续合并改变源码，需由合并批次重验相关范围）。Impeccable detector 对 5 个变更 UI 文件返回 `[]`。
- 限制：真实模型、发布构建 smoke 与 CI 未运行；本票不改变原生窗口管理策略。完整搜索浮层、新欢迎页和新的首次发送流程由后续票交付。
