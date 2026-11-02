# 08: 会话菜单：更多、右键与重命名

**What to build:** 点击查看更多，先关闭详情卡片，再在该会话行右侧打开菜单：顶部对齐、间距 2px，不锚定到按钮下方。右键独立、项目内或置顶的对话打开同一菜单：阻止原生菜单，以鼠标的视口坐标为锚点，靠近窗口边缘时按共享规则避让；右键本身不进入会话，也不触发删除、置顶或新建。菜单项的顺序固定为：重命名、置顶 / 取消置顶、归档（10 加入）、移到项目（16 加入）、分隔线、删除对话（09 加入）；置顶状态决定文案；不展示导出为 MD、在飞书中继续、小窗打开与快捷键。所有前导图标在 14px 图标槽中居中，斜图钉不产生偏移。重命名在行内进行：标题变成输入框并全选，Enter 或失焦保存，Escape 取消；保存前去掉首尾空白，结果为空时恢复原名、不保存；会话标题最多 200 个字符，可以重复；保存失败时保留输入并用 Toast 提示；保存后列表与详情卡片同步。

- 行为依据：[规格](../spec.md) CHAT-10、CHAT-12、CHAT-17（会话部分）、13.1 的对话菜单图标对齐与标准菜单行。

**User stories:** 23（会话部分）、29

**Blocked by:** 07

**Status:** ready-for-agent

**Write scope:** apps/server 的会话改名操作与路由（session 包已有写标题的能力，尚无调用方）；packages/protocol；renderer 的会话菜单与右键锚定；packages/ui 的行内重命名部件；i18n；projects.md 的会话菜单与重命名一节。

**跨票接口：** 会话菜单按上述顺序预留菜单项插槽，09、10、16 只填自己那一项；行内重命名部件供 14 的项目重命名复用；22 的搜索结果右键复用本菜单。

- [x] Sidecar 协议：改名后读回标题；超过 200 个字符被拒绝；改名不改变最后记录时间。
- [x] Browser Mode：点击更多时菜单在行右侧、2px、顶对齐；在同一行的不同位置右键，锚点随鼠标变化，靠近窗口边缘时仍可操作，不出现原生菜单、不切换会话；菜单图标槽对齐；行内重命名的全选、Enter、失焦、Escape、空白恢复原名与失败提示（CW-54、CW-83）。
- [x] Electron E2E：右键一个项目内会话并重命名，重启后列表与详情卡片中都是新标题。
- [x] projects.md 的相应一节；`check:docs` 通过。

Closed: true

## Comments

2026-11-03：从集成 `77b79d4` 实施本票，按规格第 18 节已确认的 Sidecar HTTP、Browser Mode 和真实 Electron 接口进行验证。

- 协议：新增 `RenameSessionRequest`、`apiPaths.sessionTitle` 与 `PUT /api/sessions/:id/title`，修剪标题、拒绝空白和超过 200 字符、允许重复，成功返回完整 Session。复用已有存储标题操作，SQLite 只写 title，内存实现的 touch 只合并字段；不追加记录、不刷新 updatedAt，无须修改存储契约。
- renderer：更多菜单以整行定位，右键菜单以鼠标视口坐标定位；详情先关闭，不改变当前会话。菜单顺序为 rename、pin、archive 插槽、moveToProject 插槽、分隔线与 delete 插槽；当前仅展示已实施的改名和置顶，不提前展示后继票的空项。14px 固定槽居中容纳斜图钉，文字起点相同；Escape / 外部点击恢复来源行焦点，滚动或 resize 关闭来源菜单。
- 跨票接口：`SessionRow.menuSlots` 与 `SessionMenuSlots` 的 archive / moveToProject / delete 供 09、10、16 填充；`SessionMenu` 及 `SessionMenuIcon` 供 22 复用；UI 的 `RowMenu` 接收 point（鼠标坐标或 null 整行）、open / onOpenChange、label、onCloseAutoFocus、children，在 relative 行内使用；`InlineRename` 接收 value、label、maxLength、onSave（Promise<boolean>）和 onComplete，供 14 复用。错误 Toast 由业务 onSave 提供，失败保留输入与焦点。
- TDD：Sidecar 用例先观察缺少标题路由导致 404，浏览器用例先观察缺少菜单，再实现至通过。几何断言等待真实浮层布局及动画收敛：首次测量读到缩放中的 13.3px 槽及尚未定位的 left=0，改为等待实际几何条件，没有固定 sleep 或放宽数值。浅/深色截图已生成并读回（本地忽略输出 `.vitest/cw08-menu-{light,dark}.png`）；2px/顶对齐、14px 槽、旋转中心、文字起点均通过实际浏览器测量。

本轮验证（退出码均为 0）：

- `pnpm run test tests/integration/sidecar-session-rename.test.ts tests/integration/sidecar-session-pinning.test.ts apps/desktop/src/renderer/features/sidebar/session-menu.browser.test.tsx apps/desktop/src/renderer/features/sidebar/session-row.browser.test.tsx apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx packages/ui/src/guards/style-guard.test.ts`：7 文件、93 项通过。其后仅新增浏览器输入法、200 字符实际输入与保存中去重断言，再运行菜单文件：1 文件、10 项通过。协议覆盖非法类型、空值、空白、201 字符、200 字符边界、重复名称、not-found、时间戳与重启读回。
- `pnpm run test apps/desktop/e2e/session-rename.e2e.test.ts`：1 文件、1 项真实 Electron 通过，本次构建产物与真实 Sidecar；在项目内会话实际右键、全选、改名，重启后列表只有一行且详情显示同一新标题与原项目。
- `pnpm run typecheck`、`pnpm run lint`、`pnpm run check:docs`（246 个 Markdown，0 问题）通过；Impeccable 对四个变更 UI 源文件的机械检查返回 `[]`。
- 07 的旧 browser 用例在更多菜单打开后增加 Escape 关闭，保留原详情关闭断言，遵守共享页面清理规则；fixture-chat 增加完整协议形状的标题响应。

文档变化：会话菜单、鼠标位置、行内改名与协议 → projects.md 新增一节并修正“更多仅关闭详情”的旧结论 → docs/README 同步摘要与测试入口。搜索 projects.md、旧结论和新章节，已关闭票保留历史证据，后继票保留自己的目标义务。按 AGENTS → docs/README → projects 正文读回，路径与引用、语义同步、归属与权威、引用方向、生命周期、当前入口、新会话读入、历史保留均通过。没有正式文档依赖具体任务材料。

最终集成验证：合入最新 `defd472`（含 11 的首次发送与 new-chat-store），只有 docs/README 导航摘要冲突，合并保留双方入口；没有覆盖新对话字段、存储清理和首次发送逻辑。再次按入口读回 projects.md，单份新对话草稿与菜单/重命名描述同时成立。全部退出码为 0：

- `pnpm run test tests/integration/sidecar-session-rename.test.ts tests/integration/sidecar-session-pinning.test.ts tests/integration/sidecar-first-send.test.ts apps/desktop/src/renderer/features/sidebar/session-menu.browser.test.tsx apps/desktop/src/renderer/features/sidebar/session-row.browser.test.tsx apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx packages/ui/src/guards/style-guard.test.ts`：9 文件、101 项通过。
- `pnpm run test apps/desktop/e2e/session-rename.e2e.test.ts apps/desktop/e2e/session-pinning.e2e.test.ts apps/desktop/e2e/first-send.e2e.test.ts`：3 文件、4 项真实 Electron 通过，globalSetup 使用本次合并源码构建测试产物。
- `pnpm run typecheck`、`pnpm run lint`、`pnpm run check:docs`（246 文件，0 问题）、`git diff --check` 通过，无未解决冲突。

本票全部验收完成，设置 Closed；仅本地提交，未推送。未运行真实外部模型、发布构建 smoke 或 CI，这些不属于本票菜单与改名的本地验收范围。
