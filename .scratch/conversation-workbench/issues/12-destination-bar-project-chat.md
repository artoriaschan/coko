# 12: 归属栏：在项目中新建对话

**What to build:** 新对话的主输入框顶部加会话归属栏，已有对话不显示。独立状态显示统一的聊天气泡、“对话”与下拉箭头；点击后在归属栏上方 6px 打开项目菜单：项目搜索、项目列表、当前项勾选与“不在项目中工作”；同名项目在名称后用弱化文字显示主要文件夹的目录名，名称不重复的不显示。选择项目后归属栏显示文件夹与项目名；hover 时文件夹位置换成关闭按钮，名称起点不动；点击名称仍可更换项目，点击关闭只清除归属、不打开菜单。关闭或选“不在项目中工作”恢复独立状态，并清除分支与工作树草稿。项目行的“在此项目下新建对话”图标改为进入欢迎页、预选该项目并聚焦输入框（替换 01 的过渡），不触发项目展开收起。在项目中首次发送时，Session 的工作目录为主要文件夹，并归入该项目；项目草稿的上下文环使用该 Workspace 的上下文查询。

- 行为依据：[规格](../spec.md) 8.1（项目两行）、DEST-01 至 DEST-04（“新建项目”由 13 加入）、DEST-08、PROJ-14（项目行部分）、PROJ-20（归属栏部分）、13.1 的主输入区行。

**User stories:** 24（项目行部分）、28（归属栏部分）、40

**Blocked by:** 11

**Status:** ready-for-agent

**Write scope:** apps/server 的首次发送支持项目归属；packages/protocol 的首次发送请求增加归属；renderer 的归属栏、项目选择菜单、新对话草稿的归属字段与项目行入口；i18n；workbench.md 的归属栏一节。

**跨票接口：** 归属栏右侧的设置图标与项目配置菜单由 20 加入；项目菜单底部的“新建项目”由 13 加入；项目更多菜单中的“在此项目下新建对话”由 14 加入，调用本票的入口。

- [x] Sidecar 协议：以项目归属首次发送，Session 的工作目录是主要文件夹，并归属该项目；失败时同样不留下会话。
- [x] Browser Mode：菜单在归属栏上方 6px，搜索、勾选与回填正确；hover 出现关闭按钮且名称起点不变，关闭后恢复独立并清空分支与工作树草稿；图标与文字的光学居中按 DEST-01；同名项目附带目录名；从项目行进入时预选项目、聚焦输入、不切换项目展开状态（CW-16 的项目行部分、CW-25、CW-34、CW-35、CW-84 的归属栏部分）。
- [x] Electron E2E：从项目行新建对话并发送，会话出现在该项目下，工作目录为主要文件夹。
- [x] workbench.md 的归属栏一节；`check:docs` 通过。


Closed: true

## Comments

### 2026-11-03 — 完整实施与验证

- 在独立 managed worktree `cw-12-destination/coko` 的 `codex/cw-12-destination` 实施；从 `defd472` 开始，代码提交 `af4a1f5` 后合并最新 integration `33acb845`，合并提交 `5e04a96`。
- `FirstSendRequest.projectId` 为可选字段，服务端按当前项目的主要 Workspace 建立归属 Session，独立发送仍独占创建专属目录。复用首次发送的接受确认、持久化去重与失败回滚；项目失败保留项目、Workspace 和原文件。没有引入迁移版本。
- `NewChatState` 加入 `projectId` / `branch` / `newWorktree`，`selectProject` 切换归属并清除 Git 草稿。`startDraft(workspaceId?)` 用于明确创建入口；`resumeDraft()` 用于历史返回，不清除已保存配置。项目行现有回调因此进入同一欢迎页、预选项目、聚焦，不触发展开。
- `DestinationBar` 复用共享菜单；H28、14px 图标、12px 箭头、13/20 名称与 2px 光学下内边距；上方 6px、搜索、勾选、同名主要目录弱化显示、hover 关闭与名称稳定均经真实 Browser Mode 断言。关闭按钮与名称触发器是独立控件。已有 Session 不显示归属栏。
- `useActiveWorkspaceId` 在草稿时解析主要 Workspace；命令、File Reference 和上下文环使用该 Workspace，Electron 观察到对应 `/api/workspaces/:id/context` 请求。菜单新建项目项归 13，右侧配置归 20，项目更多入口归 14；未扩展这些票的范围。
- Red：`pnpm run test tests/integration/sidecar-first-send.test.ts -t 项目首次` 初始 1 失败（`projectId` 被旧协议拒绝为 bad-request），再实现服务。`pnpm run test apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx -t 归属菜单` 初始 2 失败（没有归属入口）。历史返回用例先观察 1 失败（归属被清空），再引入 resumeDraft。图标尺寸断言捕获实际 16px，改为明确 14px 后通过。
- Green（合并最新 integration 后）：
  - `pnpm run test tests/integration/sidecar-first-send.test.ts apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/stores/chat-store.test.ts packages/ui/src/guards/style-guard.test.ts`：6 文件、105 用例全部通过。包括 standalone 回滚与重启去重、项目 Hook 拒绝/修正重试/并发去重/无效项目、浅深主题菜单与归属、项目行聚焦、历史返回与独立入口重置。
  - `pnpm run test apps/desktop/e2e/destination.e2e.test.ts apps/desktop/e2e/first-send.e2e.test.ts`：2 文件、3 用例全部通过，globalSetup 本次打包产物，后台真实 Electron 与 Sidecar。项目归属和文字跨重启恢复，发送后项目下读回 Session，并重新读取主要目录内工具写出的 `project-result.txt`；已有独立发送与 Hook 失败流程仍通过。
  - `pnpm run typecheck`、`pnpm run lint`：退出 0。
  - `pnpm run check:docs`：退出 0，246 Markdown、0 问题。
  - `git diff --check`：退出 0；Impeccable detect 检查两个目标组件返回 `[]`。浅深主题和菜单/hover 截图位于 git 忽略的 `.vitest/cw12-*.png`，已人工查看菜单和名称定位。
- 文档归属：workbench 的新对话/归属栏为正文；projects 加项目行入口引用；ADR 0020 的当前实施范围同步，仍保留 partial；导航摘要同步。检索词含归属栏、项目行新对话、首次发送 Workspace；AGENTS → docs/README → workbench 已读回。生命周期完成表的路径引用、语义同步、权威、引用方向、生命周期、当前入口、新会话读入、历史保留均通过；未新增目录、未改历史确认状态。正式正文只引用当前代码/测试/正式文档。
- 实际保存状态：本地提交，无 push/PR。真实外部模型和发布安装包未运行；本票模型边界使用 faux，真实 Electron 构建/运行已覆盖。
