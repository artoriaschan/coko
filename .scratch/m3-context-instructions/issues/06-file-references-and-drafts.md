# 06: @ 文件引用与草稿持久化

**What to build:** agent `context/references/`：解析 `@path` / `@"path with space"` token，按 [规格](../spec.md#预算与数值) 的截断与上限读入 Workspace 内文件、列出目录，被 Read 拒绝规则覆盖、Workspace 外或二进制时只附说明，生成 `<file_reference path="…">` 文本块追加到同一条 user message。server `context/references.ts`（expandInput，排在命令之后）与 `GET /api/workspaces/:id/files`（模糊匹配，遵守忽略规则，复用 `tools/builtin/walk.ts`，最多 50）。packages/ui File Reference 节点（原子，序列化为 `@path`）；renderer `@` 文件菜单（词首触发，目录带 /，Tab 进入目录）与时间线的引用 chip（protocol `files.ts` 的识别函数）。草稿：`stores/draft-store.ts` 以 EditorState JSON 存 localStorage（键、防抖、清除与损坏处理见规格）。不安装 `@lexical/markdown`，改写 ui.md 对应句（Carry-over，M1 票 07）。

**User stories:** 17, 28

**Blocked by:** 04

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/context/references/`、`apps/server/src/application/context/references.ts`、`apps/server/src/http/routes/files.ts`、`packages/protocol/src/files.ts`、`packages/ui/src/composer/`、`packages/ui/src/index.ts`、`apps/desktop/src/renderer/features/conversation/composer.tsx`、`apps/desktop/src/renderer/features/conversation/file-menu.tsx`（新）、`apps/desktop/src/renderer/features/conversation/timeline.ts`、`apps/desktop/src/renderer/features/conversation/timeline-view.tsx`、`apps/desktop/src/renderer/stores/draft-store.ts`（新）、`packages/i18n/src/dictionaries/domains/references.ts`、`tests/integration/sidecar-references.test.ts`（新）、`apps/desktop/e2e/references-drafts.e2e.test.ts`（新）、`docs/subsystems/context.md`（新）、`docs/tech-stack/ui.md`

- [ ] agent 测试：token 解析（引号、标点结尾、邮箱等非引用不误判）；文件截断、目录列表上限、10 个 / 200KB 上限、拒绝规则与 Workspace 外与二进制的说明文本
- [ ] 集成测试：`看看 @src/a.ts` → 同一条 user message 含原文与 `<file_reference path="src/a.ts">` 块，faux requestLog 中可见；Read 拒绝规则覆盖的文件不附内容；`GET …/files?query=` 的结果遵守 .gitignore、不含 .git、目录带 /、有上限；命令与引用同时出现时先展开命令
- [ ] Browser Mode：File Reference 节点插入后作为整体删除；`getText()` 序列化为 `@path` / `@"a b"`；EditorState JSON 往返后节点仍在
- [ ] E2E：`@` 菜单搜索并插入文件，发送后时间线显示引用 chip；写一半的草稿（含引用）在切换会话后保留、在重启应用后保留，提交后清除；localStorage 中写入损坏 JSON 时输入区为空且不报错
- [ ] context.md 建立（File Reference 部分）并可达（导航行写在 Comments）；ui.md 改为"草稿保存 EditorState JSON；composer 为纯文本，支持富文本时再引入 @lexical/markdown"；`pnpm run check:docs` 通过

## Comments
