# 04: `@` 菜单的会话组与草稿 chip

**What to build:** 用户在输入区输入 `@`，文件候选下方出现“会话”组，列出同一 Project 里最近的其他会话，继续打字按标题过滤。选中后输入区出现一个显示 `@会话标题` 的 chip，它整体选中与删除，随草稿保存；提交出去的文本是 `@session:<id>`。本票不依赖 Sidecar 的展开：没有 02 时提交的只是一段文本。

**User stories:** 9–24、26、27。

**规格：** [spec.md](../spec.md) 的“`@` 菜单”“草稿中的 Session Reference 节点”。

**Blocked by:** None（可立即开始；端到端效果需要 02）

**Status:** ready-for-agent

**Closed:** true

开始前按 [界面约定](../../../docs/tech-stack/ui.md) 检查输入区、`@` 文件菜单与 File Reference 节点的现有实现与样式。

- [x] `@` 菜单为一个列表两组：文件组在前、会话组在后，同一段查询同时过滤两组；文件组的候选、排序与目录 Tab 下钻不变
- [x] 会话候选来自界面已持有的会话列表，不新增接口
- [x] 候选范围：项目内的会话只列同一 Project 的会话（含 Worktree Session）；独立对话只列其他独立对话；新对话草稿按草稿所选的 Project
- [x] 当前会话、已归档的会话不出现
- [x] 按最近更新时间从新到旧；空查询显示 5 个；有查询时按标题匹配（不区分大小写，前缀在前、包含在后），最多 20 个
- [x] 条目显示标题与最近活动时间
- [x] 两组都没有匹配时菜单不出现；只有一组有匹配时只显示那一组；没有任何可引用的会话时菜单与现状相同
- [x] 键盘、Esc、输入法、定位与指针选择沿用现有 typeahead，现有 typeahead 测试继续通过
- [x] 选中会话后插入 Session Reference 节点并跟一个空格：chip 显示 `@会话标题`，样式与 File Reference chip 一致，整体选中与删除，不能在其中输入，不可点击
- [x] 节点的序列化文本为 `@session:<id>`：提交的文本、读出的纯文本与复制出的文本都是这个形式
- [x] 标题是选中时的快照，随草稿保存
- [x] 带会话节点的草稿在切换会话与重启后恢复；节点缺少 id 或标题时按现有“未知节点”规则丢弃草稿
- [x] 一条消息里可同时有文件节点与多个会话节点
- [x] “会话”组名与相关无障碍文案中英文齐全
- [x] renderer 的 Browser Mode 测试：两组的顺序、空查询的 5 个、标题过滤、范围过滤（另一个 Project、归档、当前会话都不出现）、只有一组有匹配时的显示；节点的显示、读出文本、整体删除与草稿往返
- [x] 当前行为文档同步：上下文管理的界面与草稿部分
- [x] 记录实际运行的检查，并按 UI 调试约定说明哪些交互在静默 CDP 或 Browser Mode 中验证、哪些未验证

## Comments

### 2026-11-21 实施与验证

- 在 worktree 分支 `session-reference/04-session-menu-chip` 实施，只改 renderer 与 `packages/ui`、`packages/i18n`；没有新接口、新依赖或新测试接缝。提交出去的是 `@session:<id>` 文本，Sidecar 的展开不在本票。
- **实现。** `packages/ui` 新增 Session Reference 节点（`composer/session-reference-node.ts`），`ComposerEditor` 注册它，typeahead 的替换结果增加 `{ sessionReference: { id, title } }`，条目增加可选的行尾文本 `trailing`（主文本放不下时截断，行尾文本保持完整）。`file-menu.tsx` 在文件组之后增加会话组，候选由传入的会话列表按范围、归档、当前会话过滤并排序；`conversation-pane.tsx` 把列表 store 的 `sessions` 与范围（当前会话的 `projectId`，新对话为草稿的 `projectId`）经 `Composer` 传入。
- **TDD。** 三个纵向切片各自先红后绿：节点（选项里还没有行尾文本与会话替换时失败）→ 菜单的会话组（没有会话组时失败）→ 应用内接线（`Composer` 未接会话列表时三例都失败）。另做一次变异核对：去掉“未归档、不是当前会话”的过滤后 `file-menu.browser.test.tsx` 有 3 例失败，恢复后通过。
- **实际运行的检查（均在本 worktree）：**
  - `pnpm exec vitest run --project ui-browser packages/ui/src/composer`：4 个文件 24 例通过（原有 typeahead、File Reference 节点、编辑区的 20 例继续通过，新增节点 4 例）；连续运行 3 次结果相同。
  - `pnpm exec vitest run --project desktop-renderer`，文件为 `features/conversation/` 下的 `file-menu.browser.test.tsx`、`session-reference.browser.test.tsx`、`composer.browser.test.tsx`、`new-chat.browser.test.tsx`、`context-ring.browser.test.tsx`：5 个文件 50 例通过（新增菜单 10 例、应用内 3 例）。
  - `pnpm exec vitest run --project desktop-renderer apps/desktop/src/renderer/features/conversation apps/desktop/src/renderer/app`（共享的 `Composer` 与 `ConversationPane` 有改动，扩大到这两个目录）：运行两次，51 个文件 428 例，分别 11 例与 13 例失败。其中 9 例两次都失败，在未改动的基线（`git stash -u` 后）同样失败：`file-tool-details.browser.test.tsx` 5 例、`terminal-details.browser.test.tsx` 4 例（`getByRole('button', { name: /Bash/ })` 解析到两个元素等，与本票无关）。其余失败两次不同（`conversation-detail`、`integrated-detail`、`right-panel-shortcuts` 中的 20 秒超时与过渡等待），当时机器负载均值 35–50（其他 worktree 同时在跑测试）；单独运行这三个文件两次，一次 20 例全过，一次另有 1 例超时。按不稳定记录，未修改这些用例。
  - `pnpm run typecheck`：退出 0。`pnpm exec oxlint`：退出 0。`pnpm exec oxfmt --check`：剩余 6 个文件都是基线已有的（`docs/ui/*.html` 5 个与 `process-timeline.css`），本票改动的文件无格式问题。
  - `pnpm exec vitest run packages/i18n scripts/browser-deps.test.ts`：3 个文件 16 例通过。`pnpm exec vitest run --project scripts`：28 例中 1 例失败（`source-references.test.ts`，列出的 5 处都在 auto-review 的既有测试文件中，基线已有）。
  - `pnpm run check:docs`：0 个问题。
- **界面验证的入口。** 全部在 Browser Mode（真实 Chromium，Playwright 输入事件）中验证：两组的顺序与标题、空查询 5 个、标题过滤与前缀优先、20 个上限、范围过滤（另一个 Project、独立对话、归档、当前会话）、只有一组与两组都无匹配、独立对话与新对话草稿的范围、Enter / Tab / 指针选择、chip 文本与 `@session:<id>` 读出、复制与粘贴、Backspace 与选区整体删除、chip 前后输入、与文件节点并存、chip 与 File Reference chip 的计算样式和高度一致、长标题截断而时间可见、中英文文案、草稿切换会话与重新挂载后恢复、缺少标题时丢弃。明暗主题下的菜单与 chip 另用临时截图目检后删除，未留快照。
- **未验证。** 没有连接 Electron 的 CDP，也没有运行 Electron E2E（票 06 的范围）：真实窗口中的指针 hover、浮层时序与原生层未验证。“重启后恢复”以同一 localStorage 下重新挂载应用验证，不是真实进程重启。输入法在 chip 旁的组合输入没有专门用例（现有 typeahead 的输入法用例继续通过）。`apps/desktop/e2e/references-drafts.e2e.test.ts` 只把菜单名称的匹配改为新名称，没有运行。
- **与规格的偏离与补充（请审阅）：**
  1. 规格写“token 模式的节点”，实现是 Lexical DecoratorNode。原因：chip 显示 `@标题` 而文本内容是 `@session:<id>`，两者长度不同；文本节点的选区偏移按显示文本计算，覆写文本内容会让部分选中时的切片与光标位置错位。外部行为与规格一致（整体选中与删除、不能输入、不可点击、读出 / 提交 / 复制为 `@session:<id>`），方向键直接越过 chip。可逆：节点类型只在 `packages/ui` 内部，草稿 JSON 的 `type` 为 `session-reference`、带 `id` 与 `title`。
  2. `@` 菜单列表的无障碍名称由“文件 / Files”改为“文件与会话 / Files and sessions”（菜单现在含两组），E2E 中按名称查找菜单的一处匹配随之更新。
  3. 没有标题的会话在菜单与 chip 中以“未命名 / Untitled”显示，并按这个显示标题参与匹配；快照的标题也是它。规格未提及。
  4. 会话候选是同步的、文件候选是异步的：文件结果到达前，菜单可以先只以会话组打开。此前没有文件结果时菜单不出现、Enter 直接发送；现在若有会话标题匹配，Enter 会选中会话。
  5. 菜单条目中放不下的会话标题以省略号截断，没有查看全文的入口（与侧栏搜索结果的做法相同）；时间始终完整。
  6. 从输入区复制再粘贴回来得到的是 `@session:<id>` 文本，不恢复成 chip（与回退后的表现一致）。
- **文档影响。** `docs/subsystems/context.md`：description、模块表、“界面”（@ 菜单两组、Session Reference 节点）、“草稿”（未知节点规则与节点保存的字段）与“验证”。`docs/tech-stack/ui.md` 中 composer 的例证补上 Session Reference 的序列化形式。术语表不在本票（票 02）。

### 2026-11-21 合并集成分支后

- `git merge feat/session-reference`（已含票 01、02）：`docs/subsystems/context.md` 的 description 一处冲突，两边的内容都保留；同一文档 Session Reference 小节中“`@` 菜单的会话候选、草稿与时间线的会话 chip 尚未实现”改为只有时间线的会话 chip 尚未实现。
- 合并后重跑：`pnpm run check:docs` 0 个问题；`pnpm run typecheck`、`pnpm exec oxlint` 退出 0；`pnpm exec oxfmt --check` 仍只有基线的 6 个文件；`pnpm exec vitest run --project ui-browser packages/ui/src/composer` 4 个文件 24 例通过；`pnpm exec vitest run --project desktop-renderer`（上文 5 个文件加票 01 的 `command-menu.browser.test.tsx`）6 个文件 54 例通过。
- 合并后没有重跑 Sidecar 集成测试与 Electron E2E：本票未改 Sidecar；“菜单选择 → 提交 → 模型收到记录”的端到端效果留给票 06。
