# 22: 对话搜索浮层

**What to build:** 点击新对话行右侧的搜索图标，在当前工作台前方打开共享模态浮层（共享遮罩，背景仍可识别），输入框聚焦，placeholder 为“搜索对话…”；替换 02 的过渡标题过滤，不触发新对话。每次打开时关键词为空，只展示“最近对话”分组与最近 10 个对话，没有“加载更多”，不显示 Tabs、建议操作或快捷键。输入非空关键词后即时切换为“对话”匹配结果：标题包含关键词即命中，忽略首尾空白与英文大小写，列出全部匹配；只匹配标题，不匹配消息正文、项目名称或附件。范围包含独立、项目内与置顶的对话，同一 Session 只出现一行，已归档的不参与；最近列表与匹配结果都按最后记录时间降序。结果行为聊天气泡、标题（命中部分高亮）、右侧项目标签（仅项目内会话）与相对时间；长标题截断时保留完整标题的可访问名称。清空关键词恢复最近对话；无匹配时保留输入，显示“未找到匹配的对话”与“试试其他关键词”；没有最近会话时显示“暂无最近对话”。方向键移动当前行，Enter 确认，Escape 与外部点击关闭；中文输入法组合期间不确认，组合结束后更新结果。点击或确认后关闭浮层并打开该会话，保留项目关联与置顶；未选择而关闭时内容不变，焦点回到搜索按钮。结果超过可用高度时只滚动结果列表。结果项右键打开 08 的会话菜单；从中删除时，09 的确认弹窗显示在浮层之上，取消后保留关键词与结果。

- 行为依据：[规格](../spec.md) 4.3（SEARCH-01 至 SEARCH-11）、NAV-06、CHAT-12 与 CHAT-14 的搜索部分、13.1 的对话搜索浮层行。

**User stories:** 35、36、37、38

**Blocked by:** 02、08、09

**Status:** ready-for-agent

**Write scope:** renderer 的搜索浮层与侧栏搜索入口（移除 02 的过渡过滤）；i18n；workbench.md 的搜索一节。

**跨票接口：** 数据来自 01 的列表 store，默认不含已归档会话；右键菜单复用 08，删除复用 09；打开会话经 02 的导航。

- [ ] Browser Mode：默认 10 个最近对话，没有 Tabs、建议与快捷键；标题片段命中并高亮，只有项目标签或正文含该词时不返回；置顶与项目内会话各只一行、项目标签正确；无匹配与清空后的状态；长列表内部滚动、输入框可见；方向键与 Enter 打开同一个会话；中文输入法组合期间不确认；未选择而关闭时焦点回到搜索按钮；结果的右键菜单对应正确的 Session，删除确认在浮层之上，取消后保留关键词（CW-46 至 CW-53、CW-55 与 CW-57 的搜索部分、CW-74）。
- [ ] Electron E2E：有多个对话时搜索并打开其中一个，打开的是同一个已有会话，没有新建会话。
- [ ] workbench.md 的搜索一节；`check:docs` 通过。


## Comments

- 2026-11-03：在 `codex/cw-22-search` 实施。已读取完整票、SEARCH-01～11、NAV-06、CHAT-12/14 与测试约定；规格第 18 节已授权 renderer Browser Mode 与真实 Electron/Sidecar HTTP 的可观察边界，不再次询问 seam。
- TDD：先新增搜索 Browser 用例，`pnpm run test apps/desktop/src/renderer/features/sidebar/conversation-search.browser.test.tsx` 因搜索组件不存在失败；随后实现并绿。扩展右键编辑用例暴露菜单关闭抢走 inline rename 焦点，使用动作引用保留编辑焦点后通过。窄窗口右键用例暴露模态 transform 对 fixed 鼠标锚点的影响，菜单 portal 到 body 且保留 DialogContent 的 React 事件祖先后通过；没有修改共享菜单定位业务。
- 已替换过渡侧栏过滤，sidebar/rail 共用 640×432 搜索 Dialog，默认最近 10 条、全部标题命中、身份去重、归档过滤、项目标签/时间/完整标题可访问名称、IME/方向键/Enter/Escape/外部关闭和焦点恢复；复用 SessionMenu、SessionMoveMenu、SessionDeleteDialog，删除取消保留查询与结果，目标身份不随列表重排改变。
- 当前验证：`pnpm run test apps/desktop/src/renderer/features/sidebar/conversation-search.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx packages/i18n/src/index.test.ts` 4 文件 52 例通过；`pnpm run test apps/desktop/src/renderer/features/sidebar/conversation-search.browser.test.tsx apps/desktop/e2e/conversation-search.e2e.test.ts` 2 文件 6 例通过（当时搜索 Browser 5 例 + 原生 1 例，后增加到 Browser 7 例）；`pnpm run typecheck`、受影响源码 `oxlint`、`git diff --check` 均退出 0。
- 文档归属：当前搜索行为原地更新 `docs/subsystems/workbench.md`，同步 `docs/README.md` 摘要。已搜索“标题过滤”“完整的搜索浮层”、`searchSessions/noMatches/searchPlaceholder` 消费者；旧 M1 证据与已关闭 02 票保留历史含义。`pnpm run check:docs` 检查 247 Markdown、0 问题。无正式文档反向依赖任务材料。
- 归档菜单槽位待 10 的共享 SessionArchiveMenuItem 合入后接入，再执行最终合并后检查；本票此时尚未关闭。

- 边界补强：重复标题片段逐处高亮、超过 7 天仍使用相对时间。新增 Browser 用例先因只高亮首处失败，再修复到 8 例通过。结果行改用共享 `SidebarListRow` 保持 H32/R8 圆弧。样式守卫首次运行 39 通过/1 失败，原因是可访问 combobox 必须配套 `role="listbox"` 而规则默认仅允许 dropdown-menu.tsx；按正式例外机制仅登记搜索组件的精确文件与该角色，理由为已批准的共享 Dialog 搜索列表，不叠加另一菜单材质，没有修改守卫逻辑或扩大豁免。`pnpm run test packages/ui/src/guards/style-guard.test.ts apps/desktop/src/renderer/features/sidebar/conversation-search.browser.test.tsx` 2 文件 48 例通过。
