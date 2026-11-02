# 01: 项目数据模型与侧栏两类列表

**What to build:** 升级后每个已有的 Workspace 成为一个单文件夹项目，原有的根会话都在其中。侧栏中间的列表改为“对话”“项目”两类：点击项目行在下方展开所属会话，空项目显示“暂无对话”，会话按最后记录时间排序；去掉会话行的状态点、分支 chip、按状态上浮，以及侧栏的 worktree 列表与移除入口。本票是全部侧栏与项目票的基础：本规格需要的持久化字段在这一个迁移中一次加齐，会话列表从 chat-store 拆出。

- 行为依据：[规格](../spec.md) 2.2（会话行状态、worktree 管理）、4.2（本票只渲染“对话”“项目”；“置顶”没有置顶项时不显示，由 07 渲染）、LIST-06、LIST-09、LIST-10、LIST-12、PROJ-06 的空状态、17.1；[ADR 0020](../../../docs/adr/0020-projects-organize-workspaces.md)。
- 数据与迁移：新增一个 schema 版本。Project 记录名称、创建时间、置顶时间、主要文件夹（对应一个 Workspace，跨项目唯一）与有序的附加文件夹；Session 增加项目归属、置顶时间与归档时间。置顶由 07 与 14、归档由 10、附加文件夹由 13 开始写入，本票只建字段并保证读写。其他票原则上不再新增迁移版本，确需新增时在其 Comments 说明。每个已有 Workspace 成为单文件夹项目，沿用名称与创建时间；其中的根会话（含绑定 worktree 的）归入该项目。迁移沿用现有的迁移前备份。
- 服务端：列表返回项目（含源文件夹、主要标记与派生的最近使用时间）与会话的新字段。经现有路径在有项目的 Workspace 中新建的会话归入该项目；分叉与交接产生的会话继承来源的归属；子智能体会话按根会话的归属，不单独记录。
- renderer：会话列表、项目与 Workspace 移到独立的列表 store，chat-store 只保留会话内容与 Run 控制。列表组件独立成文件，由 02 的侧栏容器渲染在中间滚动区。
- 过渡：项目分类的“+”暂时直接打开现有的目录选择，选中的目录成为单文件夹项目（13 换成创建项目弹窗）；项目行的“在此项目下新建对话”图标暂时沿用现有的草稿流程（12 换成归属栏）。

**User stories:** 6（对话、项目两类）、10、11（项目行展开）、61

**Blocked by:** 无（可立即开始）

**Status:** ready-for-agent

**Write scope:** packages/session（schema、迁移、仓库与内存实现、契约测试）；apps/server 的会话、Workspace 与项目列表及其路由；packages/protocol 的 Session 与 Project DTO；renderer 新的列表 store、chat-store 中对应部分、侧栏列表组件；i18n；新建 `docs/subsystems/projects.md`。

**跨票接口：** 02 拥有侧栏外框（顶部菜单、搜索入口、底部用户区、收起），本票提供列表组件；两票同时进行时只在侧栏容器的列表插槽处相交。06 至 10、13 至 16 在本票的列表 store 与列表组件上扩展。

- [x] packages/session：旧版本库升级后每个 Workspace 成为单文件夹项目，根会话（含绑定 worktree 的）归入其中，置顶与归档为空；迁移前备份存在；新字段在 SQLite 与内存实现中读写一致；主要文件夹的唯一约束生效。
- [x] Sidecar 协议：列表返回迁移后的项目与会话；经现有路径在项目的 Workspace 中新建的会话归入该项目；分叉与交接继承来源的归属；经“+”的过渡路径登记目录后出现一个单文件夹项目。
- [x] Browser Mode：只有“对话”“项目”两类；点击项目行展开与收起，文件夹图标切换；项目内会话只缩进内容、hover 背景仍为整行；行 H32、间距 2px、R8；空项目显示“暂无对话”；会话按最后记录时间降序，相同时按 id；会话行没有状态点与分支 chip，侧栏没有 worktree 列表（CW-09）。
- [x] Electron E2E：以含 Workspace 与会话的旧版本库启动（夹具的构造方式在 Comments 说明），侧栏的项目中列出原有会话，打开其中一个能继续对话。
- [x] 依赖旧分组、状态点、分支 chip 或侧栏 worktree 列表的已有 browser 与 E2E 用例随界面改写或删除，每处在 Comments 写明原因。
- [x] 按 coko-docs 新建 `docs/subsystems/projects.md`（数据模型、迁移、列表）并在 docs/README 加入口；ADR 0020 的 implementation 改为 partial 并记录已实施的部分，ADR 索引同步；`check:docs` 通过。


**Closed:** true

## Comments

- 2026-11-03：实现位于 `codex/cw-01-project-model`，以集成分支为基线，合入 02 外壳和 03 输入区后验证。SQLite v10 一次加入 Project 与 Session 组织字段；ProjectRepository 与 SQLite/内存共用契约；主要 Workspace 唯一。迁移前的 Workspace 直接成为单文件夹项目，根会话含 worktree 归入项目，子会话只通过根会话派生归属。
- 列表接口 `GET /api/projects` 返回主要标记、全部源文件夹、未归档会话数和最近使用时间。目录登记使用 realpath，符号链接不会重复建项目；创建、分叉和交接继承归属。标题、模型与组织编辑不刷新最后记录时间；追加记录会刷新，补发旧条目不倒退时间。
- 新增独立 `list-store.ts`、`useLists` / `useCurrentSession` / `useActiveWorkspaceId`，chat-store 只保留内容、草稿与 Run 控制，通过 `.lists` 访问列表。所有消费者和测试同步迁移。02 的导航订阅 chat 与 lists；等待首次会话选择就绪后初始化历史，避免加载过程成为一条历史。
- 旧用例适配（逐处说明）：`chat-store-approvals.test.ts` 改为最后记录时间排序，删除审批状态上浮期待；`app.browser.test.tsx` 的 Workspace 查询改为项目查询并迁移列表访问；`recovery.e2e.test.ts` 保留恢复/确认链路，侧栏状态徽标期待改为不存在；`approvals.e2e.test.ts` 验证较新的会话先排、审批卡仍可打开而侧栏无徽标；`worktrees.browser.test.tsx`、`worktrees.e2e.test.ts` 随侧栏 worktree 入口整体删除，真实生命周期仍由 `sidecar-worktrees.test.ts` 覆盖；`open-session.e2e.test.ts`、`schedules.e2e.test.ts`、`approvals.e2e.test.ts` 的顶部新对话按钮名称跟随 02 的 New chat / 新对话。其他 Browser Mode 和 chat-store 测试只更新列表订阅位置与新 DTO 必需字段，不改变验收行为。
- Electron 旧库夹具：`projects-migration.e2e.test.ts` 在独立 Node 进程内用 `MIGRATIONS.slice(0,9)` 创建真实 v9 SQLite，写入一个 Workspace 和一个带 faux 模型的根会话，关闭后通过真实 Electron 启动升级，验证项目/会话可见、打开并继续对话、备份存在。没有使用当前 schema 伪装旧库。
- TDD：项目契约先因缺少 ProjectRepository.create 失败后通过；旧条目补发回归先观察到 updatedAt 从 100 倒退至 1，再修正并通过。Browser Mode 实际测量浅色/深色 H32、R8、圆弧、2px 行距和嵌套整行宽度，验证展开/收起、空状态、排序和无状态/分支。
- 验证：存储、迁移、Sidecar、交接与 chat-store 相关 14 文件全部通过；Browser Mode 的 app / sidebar-lists / composer / plan 与 permissions-store 相关文件通过（最后变更按受影响文件重跑）；真实 Electron 的 projects-migration / approvals / recovery / workbench 共 4 文件、6 用例通过，globalSetup 以当前源码打包测试产物；`pnpm run typecheck`、`pnpm run lint`、`pnpm run check:docs`、`git diff --check` 通过。只验证 faux，无真实模型、CI、发布构建验收。
- 文档：新增 `docs/subsystems/projects.md` 并登记入口；ADR 0020 与 ADR 索引标记 partial；更新 worktrees / recovery 当前行为和 docs 导航。按 AGENTS → docs/README → 正文读回，生命周期、归属、引用、替代链均一致；长期文档无任务材料反向依赖。旧 m5 已关闭票的历史验收记录保留，不改写历史事实。


### 最终验证命令与范围

全部退出码为 0：

```sh
pnpm run test packages/session/src/memory/memory.test.ts packages/session/src/sqlite/sqlite.test.ts packages/session/src/sqlite/migrate-v8.test.ts packages/session/src/sqlite/migrate-v9.test.ts packages/session/src/sqlite/migrate-v10.test.ts tests/integration/sidecar-projects.test.ts apps/server/src/application/handoff.test.ts apps/desktop/src/renderer/stores/chat-store.test.ts apps/desktop/src/renderer/stores/chat-store-approvals.test.ts apps/desktop/src/renderer/stores/chat-store-m4-entries.test.ts apps/desktop/src/renderer/stores/chat-store-permissions.test.ts apps/desktop/src/renderer/stores/chat-store-recovery.test.ts apps/desktop/src/renderer/stores/chat-store-rewind.test.ts apps/desktop/src/renderer/stores/chat-store-run-control.test.ts
# 14 文件，146 用例通过
pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx apps/desktop/src/renderer/features/conversation/plan.browser.test.tsx apps/desktop/src/renderer/stores/chat-store-permissions.test.ts
# 合入 03 后 5 文件、56 用例通过；后续补发时间回归与明暗列表覆盖后，受影响范围另跑如下：
pnpm run test apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx
# 2 文件，27 用例通过
pnpm run test apps/desktop/e2e/projects-migration.e2e.test.ts apps/desktop/e2e/approvals.e2e.test.ts apps/desktop/e2e/recovery.e2e.test.ts apps/desktop/e2e/workbench.e2e.test.ts
# 合入 03 后 4 文件、6 用例通过，含当前测试构建产物
pnpm run typecheck
pnpm run lint
pnpm run check:docs
# 246 个 Markdown，0 个问题
git diff --check
```

产品运行时和新增契约均有实际入口证据；`open-session.e2e.test.ts` 与 `schedules.e2e.test.ts` 本票只修正被 02 更名的按钮查找，经过类型检查，完整场景未在本票重复运行。迁移来源含 worktree 的读取在存储迁移测试验证，Electron 夹具覆盖普通根会话；子 Session 归属、交接归属分别由契约/DTO 实现和真实 Sidecar + 交接单元用例覆盖。
