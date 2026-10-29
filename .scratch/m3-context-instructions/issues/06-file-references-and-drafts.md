# 06: @ 文件引用与草稿持久化

**What to build:** agent `context/references/`：解析 `@path` / `@"path with space"` token，按 [规格](../spec.md#预算与数值) 的截断与上限读入 Workspace 内文件、列出目录，被 Read 拒绝规则覆盖、Workspace 外或二进制时只附说明，生成 `<file_reference path="…">` 文本块追加到同一条 user message。server `context/references.ts`（expandInput，排在命令之后）与 `GET /api/workspaces/:id/files`（模糊匹配，遵守忽略规则，复用 `tools/builtin/walk.ts`，最多 50）。packages/ui File Reference 节点（原子，序列化为 `@path`）；renderer `@` 文件菜单（词首触发，目录带 /，Tab 进入目录）与时间线的引用 chip（protocol `files.ts` 的识别函数）。草稿：`stores/draft-store.ts` 以 EditorState JSON 存 localStorage（键、防抖、清除与损坏处理见规格）。不安装 `@lexical/markdown`，改写 ui.md 对应句（Carry-over，M1 票 07）。

**User stories:** 17, 28

**Blocked by:** 04

**Status:** ready-for-agent（实施完成，待 Lead 合入）

**Write scope:** `packages/agent/src/context/references/`、`apps/server/src/application/context/references.ts`、`apps/server/src/http/routes/files.ts`、`packages/protocol/src/files.ts`、`packages/ui/src/composer/`、`packages/ui/src/index.ts`、`apps/desktop/src/renderer/features/conversation/composer.tsx`、`apps/desktop/src/renderer/features/conversation/file-menu.tsx`（新）、`apps/desktop/src/renderer/features/conversation/timeline.ts`、`apps/desktop/src/renderer/features/conversation/timeline-view.tsx`、`apps/desktop/src/renderer/stores/draft-store.ts`（新）、`packages/i18n/src/dictionaries/domains/references.ts`、`tests/integration/sidecar-references.test.ts`（新）、`apps/desktop/e2e/references-drafts.e2e.test.ts`（新）、`docs/subsystems/context.md`（新）、`docs/tech-stack/ui.md`

- [x] agent 测试：token 解析（引号、标点结尾、邮箱等非引用不误判）；文件截断、目录列表上限、10 个 / 200KB 上限、拒绝规则与 Workspace 外与二进制的说明文本
- [x] 集成测试：`看看 @src/a.ts` → 同一条 user message 含原文与 `<file_reference path="src/a.ts">` 块，faux requestLog 中可见；Read 拒绝规则覆盖的文件不附内容；`GET …/files?query=` 的结果遵守 .gitignore、不含 .git、目录带 /、有上限；命令与引用同时出现时先展开命令
- [x] Browser Mode：File Reference 节点插入后作为整体删除；`getText()` 序列化为 `@path` / `@"a b"`；EditorState JSON 往返后节点仍在
- [x] E2E：`@` 菜单搜索并插入文件，发送后时间线显示引用 chip；写一半的草稿（含引用）在切换会话后保留、在重启应用后保留，提交后清除；localStorage 中写入损坏 JSON 时输入区为空且不报错
- [x] context.md 建立（File Reference 部分）并可达（导航行写在 Comments）；ui.md 改为"草稿保存 EditorState JSON；composer 为纯文本，支持富文本时再引入 @lexical/markdown"；`pnpm run check:docs` 通过

## Comments
### 实施者报告（m3/06-file-references-and-drafts，2026-10-29）

**覆盖的验收**

1. agent：`packages/agent/src/context/references/parse.test.ts`（20：引号、结尾标点、中文标点、邮箱 / `(@a)` / `看看@a` 不是引用、token 位置、`formatFileReferenceToken` 往返）；`expand.test.ts`（12：文件块、不存在不产生块、去重与路径归一、属性转义、2000 行与 50KB 截断、目录列表与 200 项上限、Read 拒绝（带内容与不带内容）、询问规则不影响、Workspace 外（绝对路径与符号链接）、二进制、10 个上限、200KB 合计）；`search.test.ts`（4：.gitignore、无 .git、目录带 /、排序档位、`dir/` 查询、50 上限）。
2. 集成 `tests/integration/sidecar-references.test.ts`（4）：`看看 @src/a.ts` → 同一条 user message 两个块，faux requestLog 与读回条目一致；project 作用域 `Read(secret.txt)` 拒绝时只附说明且 requestLog 中无文件内容；无引用（邮箱、`@nobody`）时只有原文；`/explain @src/a.ts` 先展开命令再附引用块；`GET /api/workspaces/:id/files` 的 .gitignore、无 .git、目录带 /、`src/` 查询、limit、400 / 404。
3. Browser Mode `packages/ui/src/composer/file-reference-node.browser.test.tsx`（5）：插入后 Backspace 先删空格再整体删除节点；`getText()` 为 `@src/a.ts` / `@"docs/my notes.md"`；EditorState JSON 往返后节点仍在，非法 JSON、未知节点、path 非字符串被拒绝且内容不变；目录 Tab 进入、Enter 插入目录引用；onDraftChange 不随 setEditorState / clear 调用。
4. E2E `apps/desktop/e2e/references-drafts.e2e.test.ts`（2）：@ 菜单搜索插入、发送后时间线引用 chip、requestLog 含块、提交后草稿清除；两会话之间切换草稿（含引用节点）保留、重启应用后保留、提交后清除；localStorage 写入损坏 JSON 后输入区为空、无 pageerror、坏键被删除。
5. 文档：新建 `docs/subsystems/context.md`（File Reference 与草稿两部分；票 10、11 追加用量与压缩）；`docs/README.md` 当前行为导航加一行"上下文管理"（排在命令之后）；ui.md 第 17 行改为"草稿保存 Lexical EditorState JSON；composer 为纯文本（File Reference 节点序列化为 `@path` 文本），支持富文本时再引入 @lexical/markdown"；`pnpm run check:docs` 111 文件 0 问题。

**实际运行的命令与结果**（worktree，已 `git merge main`（7068503，含票 08））

- `pnpm install --frozen-lockfile` 0；`pnpm run typecheck` 0；`pnpm run lint` 0 警告 0 错误；`pnpm run format:check` 0；`pnpm run check:docs` 0 问题。
- `pnpm run test`：153 个文件通过，1127 通过、1 跳过（settings E2E 中已有的跳过），含 desktop E2E 16 个文件与产物 smoke（`package-smoke.e2e.test.ts` 2 个）。

**负向确认**

- 先红：agent 三个测试文件、Browser Mode 节点测试（5 个全红）、timeline 引用用例均先失败后实现。
- 集成：引用贡献恒返回 undefined → 3 个展开用例失败；忽略 `scope.permissionRules` → 拒绝规则用例失败；撤销后通过。
- E2E：去掉 composer 的 `onDraftChange` → 草稿用例失败；撤销后通过。
- 修正了两处我写错的测试期望（标点之后的 @ 按词首规则不是引用；命令模板的结尾换行被加载器去掉），未改实现语义。

**未验证项**

- 真实模型：无凭据，未运行。
- 只在 Chromium（Browser Mode 与 Electron）运行；Windows 路径分隔符只按 toPosix 处理，未在 Windows 运行。
- 很大的仓库只遍历前 20 000 项（文件候选），未做性能测量。

**越出 Write scope 的改动**（请 Lead 裁决）

- `apps/server/src/application/context/types.ts`（01）：`ContextScope.permissionRules?(): Promise<PermissionRule[]>`（引用需要当时生效的 Read 拒绝规则，含 Session 规则）。
- `apps/server/src/application/context/index.ts`（01）：`ContextAssembly.scope` 的输入类型改为 `Omit<ContextScope, 'config' | 'cokoHome'>`，使 permissionRules 透传（1 行）。
- `apps/server/src/application/sessions.ts`（01 → 11）：`#scope` 给出 `permissionRules`（复用 `SessionPermissions.runtimePermissions(...).rules()`，3 行）。
- `apps/desktop/src/renderer/features/conversation/conversation-pane.tsx`：给 Composer 传 `fileWorkspaceId`（1 行）。
- `packages/i18n/src/dictionaries/domains/index.ts`（01）：登记 `references` 域（2 行）。
- 新测试文件：`packages/agent/src/context/references/*.test.ts`、`packages/ui/src/composer/file-reference-node.browser.test.tsx`、`apps/desktop/src/renderer/stores/draft-store.test.ts`；`timeline.test.ts` 新增一个用例。
- `docs/README.md`：只加本票一行。

**文档影响**：新增 `docs/subsystems/context.md`；README 导航一行；ui.md 一句。TECH_STACK 未改：其"界面"选型表仍有"输入内容 Markdown 转换 | @lexical/markdown 0.52.0"一行（已选、未接入），与 ui.md 新的表述一致（支持富文本时再引入）；Lead 若认为应删除或标注，请在合入时处理。未新增依赖与深层导入（browser-deps 检查通过）。

### 供后续票

- **context.md（票 10、11）**：已有"File Reference"与"草稿"两节，用量与压缩各加一节，结构入口表追加行即可。
- **用量分项（票 10）**：File Reference 块在 user message 的 content 中（不是 system section），按消息估算；引用贡献没有 `report`。
- **composer（票 10、11）**：`ComposerEditorHandle` 新增 `getEditorState`、`setEditorState(json): boolean`、`clear`，`ComposerEditorProps.onDraftChange`；Composer 新增 `fileWorkspaceId`、`drafts`（测试注入）。草稿键与 commandTarget 相同（`draftKey`）。
- **typeahead**：`ComposerTypeahead` 新增 `onQuery(query)`（异步候选）；`onSelect(item, selection: 'enter' | 'tab' | 'pointer')` 可返回 `{ fileReference: path }` 插入节点；getItems 换新时光标仍在 token 中会重新匹配。
- **ContextScope.permissionRules**：任何贡献需要当时生效的规则时可复用；省略时（单元测试、草稿 Workspace 作用域）视为没有规则。
- **时间线**：user 项新增可选 `references: string[]`；`text` 不含 `<file_reference>` 块。
