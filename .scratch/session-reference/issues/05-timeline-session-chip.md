# 05: 时间线上的会话引用

**What to build:** 一条带会话引用的用户消息在时间线上显示 `@会话标题` 而不是一串 id；气泡下方有一个会话 chip，点击打开那次会话。附上的记录不出现在气泡正文里。被引用的会话后来改名或删除，历史消息仍显示提交时的标题。

**User stories:** 49–54。

**规格：** [spec.md](../spec.md) 的“时间线”。

**Blocked by:** 02

**Status:** ready-for-agent

Closed: true

开始前按 [界面约定](../../../docs/tech-stack/ui.md) 检查时间线用户消息与文件、目录 chip 的现有实现与样式。

- [x] 用户消息的会话引用块不进入气泡正文
- [x] 气泡正文中的 `@session:<id>` 在该消息带有对应的会话引用块时显示为 `@标题`，标题取自块；没有对应块时原样显示
- [x] 会话引用块按出现顺序显示为气泡下方的会话 chip，与文件、目录 chip 同一行列，图标能与文件区分
- [x] 点击会话 chip 打开该会话
- [x] 被引用的会话不在会话列表中（已删除）时 chip 不可点击，仍显示提交时的标题
- [x] 未附上的说明块同样显示 chip
- [x] chip 可用键盘聚焦与激活，有无障碍名称
- [x] 相关文案中英文齐全
- [x] renderer 的 Browser Mode 测试：气泡显示 `@标题`、下方有会话 chip、点击切换会话、会话不在列表中时不可点击、没有对应块时原样显示、文件与会话 chip 混排的顺序
- [x] 当前行为文档同步：上下文管理的“引用 chip”
- [x] 记录实际运行的检查，并说明哪些交互在 Browser Mode 中验证、哪些未验证

## Comments

### 2026-11-21 实施完成（票 05）

- 落点（只改 renderer 与文案）：
  - 派生：`apps/desktop/src/renderer/features/conversation/timeline.ts`。用户消息的 `references` 由 `string[]` 改为 `(string | SessionReference)[]`，按块出现的顺序混排；`<session_reference id="…" title="…">` 开头的文本块不进入 `text`。新增 `withSessionTitles`：显示用的文本替换，`item.text` 保持原文。
  - 渲染：`timeline-view.tsx` 的 `SessionReferenceChip`，与文件 chip 在同一个 `<ul>` 中，沿用 `conversation-file-reference` 的 240×64 外框，图标为 `IconMessageCircle`（侧栏与目标栏表示对话的图标）。chip 是原生 `<button>`，会话不在 `chat.lists` 的 `sessions` 中时 `disabled`；打开会话用 `chat.getState().openSession`，与交接行相同。
  - 文案：`packages/i18n/src/dictionaries/domains/references.ts` 新增 `sessionChipLabel`（“引用的会话 {title}” / “Referenced session {title}”）。
- 规格没有写明、由本票定下的做法：
  - 列表的无障碍名称 `references.attached` 由“引用的文件 / Referenced files”改为“引用 / References”：列表现在可以同时含文件与会话。没有测试断言旧文案。
  - 归档的会话同样不可点击。界面的会话列表（`lists.sessions`）不含归档会话，归档列表只在打开设置的归档页后才读取；规格写的是“不在会话列表中”，票的检查项只举了已删除。
  - 块中标题为空（被引用的会话当时未命名）时，chip 与气泡显示“未命名”（`sidebar.untitled`）。
  - 命令消息的参数与展开全文中的 `@session:<id>` 同样显示为 `@标题`。
  - 复制消息得到的仍是原文 `@session:<id>`；回退动作传给上层的文本没有改动（返回文本属于票 03）。
  - 气泡里的 `@标题` 是纯文本，不是链接色 chip，也不可点击。
  - `@session:<id>` 的 token 规则（词首、空白或中文标点处结束、去掉结尾标点）在 `timeline.ts` 中另写了一份正则：`@coko/agent/entries` 这个浏览器安全入口没有导出 `parseSessionReferences`，本票没有扩大它的导出面。两处规则需要一起改。
- 没有做：
  - 轮次导航器（`turn-navigator.tsx`）的提示词预览仍显示原文 `@session:<id>`，规格与票都只要求气泡。
  - 没有为 `timeline.test.ts` 增加会话引用的派生用例，派生由 Browser Mode 测试经真实渲染覆盖。
- 实际运行（均在本 worktree，2026-11-21）：
  - `pnpm exec vitest run apps/desktop/src/renderer/features/conversation/messages.browser.test.tsx -t "session reference"`：第一条用例先红（气泡显示 `@session:s-2.` 与整个块）后绿。
  - `pnpm exec vitest run apps/desktop/src/renderer/features/conversation/messages.browser.test.tsx apps/desktop/src/renderer/features/conversation/timeline.test.ts`：2 个文件、33 通过。
  - 混排与不可点击的用例写出时即通过（实现已随第一条用例落地），因此做了两次临时破坏确认它能失败：去掉 token 正则的词首条件，`me@session:s-3` 被替换，中英文两条失败；把 chip 的 `disabled` 固定为 `false`，`toBeDisabled` 失败。两处随后复原。
  - `pnpm exec vitest run packages/ui/src/guards/style-guard.test.ts packages/i18n/src`：3 个文件、54 通过。
  - `pnpm run typecheck`、`pnpm run lint`、`pnpm run check:docs`（460 个文件，0 个问题）通过；改动的文件经 `oxfmt --check` 通过。
- 在 Browser Mode（Chromium，经真实的 `App` 装配与内存协议后端）中验证的交互：
  - 气泡显示 `@标题`，标题取自块而不是会话列表里的当前标题，属性中的 `&amp;`、`&quot;` 被还原；附上的记录与未附上的说明都不出现在消息里。
  - 没有对应块的 `@session:<id>`、不在词首的 `me@session:<id>` 原样显示，且没有 chip。
  - 文件与会话 chip 按块的顺序混排，三个 chip 的外框都是 240×64，会话图标与文件图标不同；未附上的说明块有 chip。
  - 从消息 Tab 到 chip、Enter 打开会话；指针点击打开会话。两者都断言活动会话与标题栏的标题。
  - 不在列表中的会话：按钮为停用状态，触发 click 后活动会话不变，仍显示块中的标题。
  - 中英文下 chip 与列表的无障碍名称。
  - 另用一次性截图用例目视检查了亮色与暗色 1280px、亮色 390px 下的常态、hover 与键盘焦点环（长标题换行、390px 下主内容区没有横向滚动）；截图用例没有提交，这些外观没有自动断言。
- 未验证：
  - 没有启动 Electron，也没有运行 E2E：真实窗口中的指针 hover、点击 chip 后的会话切换都没有验证。端到端的一条在票 06。
  - 测试中的块是按 `packages/agent/src/context/references/session.ts` 的 `sessionReferenceBlock` 手写的，没有经真实 Sidecar 生成后再由 renderer 显示。
  - Space 激活、暗色主题与 390px 宽度下的自动断言、对比度都没有测试。
  - 回退区间（只读时间线）与子代理时间线中的会话 chip 没有单独测试；没有对话 store 时 chip 为停用状态，这一分支没有测试。
- 合并 `feat/session-reference`（已含票 04）：`docs/subsystems/context.md` 与 `packages/i18n/src/dictionaries/domains/references.ts` 各有一处冲突，两侧内容都保留；Session Reference 开头的实现状态改为菜单候选、草稿 chip 与时间线 chip 均已实现。合并后重跑：
  - `pnpm exec vitest run apps/desktop/src/renderer/features/conversation/messages.browser.test.tsx apps/desktop/src/renderer/features/conversation/timeline.test.ts apps/desktop/src/renderer/features/conversation/file-menu.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-reference.browser.test.tsx packages/ui/src/composer/session-reference-node.browser.test.tsx packages/i18n/src packages/ui/src/guards/style-guard.test.ts`：8 个文件、104 通过。
  - `pnpm run typecheck`、`pnpm run lint`、`pnpm run check:docs`（460 个文件，0 个问题）通过。
  - 草稿中经 `@` 菜单选出的会话 chip 提交后在时间线上的显示，没有连起来验证（票 06 的 E2E）。
- 文档：`docs/subsystems/context.md` 的“界面”更新了“引用 chip”并新增“会话 chip 与 `@标题`”，Session Reference 开头的实现状态与测试列表同步。
