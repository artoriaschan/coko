# 20: 分支选择与创建并检出

**What to build:** 归属栏右侧加分支与工作树设置图标，点击后在归属栏上方打开项目配置菜单，菜单中有“分支”（“新建工作树”开关由 21 加入），不展示“环境”“无环境”等选项。独立对话状态也可以打开，但分支是待选择项目的状态，不对不明确的目录执行 Git 操作；主要文件夹不是 Git 仓库或没有安装 Git 时，“分支”不可用并说明原因。点击“分支”打开分支子菜单：父菜单保持打开，子菜单以更高层级叠在父菜单前方并与之重叠；子菜单有搜索、本地分支列表（当前分支在最前，其余按最近提交时间排序）、当前分支勾选与底部的“创建并检出新分支…”。选择分支后在父菜单回显，关闭子菜单时焦点回到“分支”。不开工作树时，选择分支立即在主要文件夹切换，不强制切换；有未提交的改动，或工作目录是主要文件夹的任一会话有进行中的 Run、子代理、运行中的后台任务或启用的定时任务时，拒绝切换并说明原因，区分这两类，原分支不变。“创建并检出新分支…”关闭菜单、打开弹窗并聚焦分支名称，名称预填全局前缀；弹窗内可以直接编辑前缀，保存为全局设置，默认为空，不影响 worktree 的 `coko/<name>` 分支。名称按完整的 Git 引用名规则校验，例如只有以 `/` 结尾的前缀时显示“分支名不能以‘/’结尾”并禁用主按钮；校验区域预留位置，弹窗不跳动。从当前 HEAD 创建并立即切换；同名分支已存在时报错，不重置；提交期间防止重复操作，失败时保留名称与表单并显示原因。

- 行为依据：[规格](../spec.md) DEST-05、DEST-06、GIT-01 至 GIT-07（worktree 部分由 21 负责）、PROJ-18（Git 不可用）、第 14 节的分支两行、17.2 Git。

**User stories:** 54、55、57

**Blocked by:** 12

**Status:** ready-for-agent

**Write scope:** apps/server 的 git 分支列表、切换、创建并检出与拒绝判断（经宿主执行的 git，使用参数数组、不经过 shell），设置中的分支名前缀；packages/protocol；renderer 的设置图标、项目配置菜单、分支子菜单与创建弹窗；i18n；worktrees.md 的分支一节与 workbench.md 的项目配置菜单一节。

**跨票接口：** 配置菜单在“分支”之前为 21 的“新建工作树”开关预留位置；开关开启时，分支子菜单的含义由 21 改为基础分支。会话忙碌的拒绝使用 09 约定的 `session-busy`，09 未合入时由本票按同一形式定义；未提交改动的拒绝为新的错误码 `git-dirty`，details 与现有的 `worktree-dirty` 相同。子菜单复用 16 的叠加子菜单部件，16 未合入时由本票提供同一部件。

- [x] Sidecar 协议（git 夹具，测试使用临时 HOME）：列表只含本地分支，当前分支在最前；有未提交改动时返回 `git-dirty`；工作目录是主要文件夹的会话有进行中的 Run 时返回 `session-busy`；两种情形下原分支都不变；创建并检出后 git 读回新分支，同名分支已存在时报错且原分支不被重置；以 `-` 开头或含非法字符的名称被拒绝，不会被 git 当作选项；非 Git 目录返回不可用；前缀作为全局设置读回（CW-64、CW-77）。
- [x] Browser Mode：独立状态为待选择项目；子菜单的层级、重叠与焦点返回；校验文案出现时弹窗几何不变；提交期间防止重复；失败时保留名称与旧选择（CW-36、CW-38 至 CW-40）。
- [x] Electron E2E：设置前缀后创建并检出，名称预填前缀，主要文件夹切到新分支。
- [x] 文档按 Write scope 更新；`check:docs` 通过。


**Closed:** true

## Comments

### 2026-11-03 — 实施与验证

- 已实现 `GET/POST /api/projects/:id/branches`；主要目录从 `primaryWorkspaceId` 解析，不依赖显示顺序。列表只包含本地引用，当前分支优先，其他按提交时间；参数数组调用宿主 Git，完整引用名校验后再 `check-ref-format --branch`，现有分支不重置，无强制切换或远端猜测。全局 `git.branchPrefix` 默认为空，只接受字符串，不改 worktree 的 `coko/` 前缀。
- 使用 09 的 `SessionBusyDetails` 与 `SessionRuns.busy()`；递归按固定 cwd 匹配根/子 Session，覆盖 Run、子代理、Job 和 active Schedule。`git-dirty` 复用 dirty details 上限。仓库根锁内持有目录准入屏障，`SessionRuns.useDirectoryAdmission` 在最终同步 Run launch 前检查，未来新建 Session 同样拒绝；完成和失败均释放。
- UI 已加入归属栏右侧设置、等待选择项目/非 Git/Git 不可用说明、本地搜索、当前项、叠加子菜单、创建表单、前缀编辑与保存、固定校验区域、防重复与保留失败名称。成功检出后回显，关闭子层焦点回分支。`ProjectGitMenu.worktreeSlot` 位于分支之前，可接收节点或 `{ available, pending, loading } => ReactNode`；21 可接开关。`newChat.newWorktree` 开启时只选择基础分支并隐藏创建入口。
- 16 复用的公共部件：`@coko/ui` 的 `DropdownMenuStackedSubContent`，默认 top 对齐、`sideOffset=0`，父表面的 4px 内边距保留重叠。使用共享 `--layer-menu` / `--layer-menu-submenu`；`alignEnd` 是归属栏的上方菜单变体。调用方持有 open 与焦点；关闭后在下一帧回触发项，关闭动画期间的第二次 Escape 继续关闭父菜单。
- TDD：初始 `pnpm run test tests/integration/sidecar-branches.test.ts` 选中 2 例并因端点 404 失败；实现后通过。真实 Session 目录准入回归的变异验证：临时移除最终 directory admission 调用后，`pnpm run test apps/server/src/application/branches.test.ts` 1 例因本应拒绝的提交实际返回 runId 而失败；原代码已恢复并绿灯。Browser 用例还捕获并修复异步检出后焦点丢失、关闭动画吞掉父层 Escape、错误区切换导致子层几何变化。
- 最终已合入当时最新 integration `7c9e5f6`（含 09、13）后验证：
  - `pnpm run test tests/integration/sidecar-branches.test.ts apps/server/src/application/branches.test.ts apps/server/src/application/session-delete.test.ts apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx`：4 文件、13 例通过。Sidecar 分支 4 例使用临时 HOME 和真实 Git；服务 1 例通过 barrier 验证目录准入覆盖真实 Session 提交及失败释放、子代理原因、Git 缺失。
  - `pnpm run test apps/desktop/src/renderer/features/conversation/branches.browser.test.tsx`：1 文件、3 例通过（明暗主题、等待项目、搜索、重叠与层级、焦点、稳定几何、防重复、失败保留、切换回显与基础分支选择）。截图保存在本地 `.vitest/cw20-*`，未提交截图产物。
  - `pnpm run test apps/desktop/e2e/branches.e2e.test.ts`：1 文件、1 例通过；globalSetup 本次打包测试构建，真实 Electron 保存前缀、再次预填、创建检出，并用真实 Git 和设置接口读回。
  - `pnpm run typecheck`：退出 0；`pnpm run check:docs`：246 个 Markdown，0 问题；`git diff --check`：退出 0。UI detector 对本次 UI 与共享菜单返回空 findings。
- 文档变化：`docs/subsystems/worktrees.md` 新增项目分支契约，`docs/subsystems/workbench.md` 新增项目配置菜单；导航摘要已同步。从 AGENTS → docs/README → 两个正文读回：路径/语义/归属/引用方向/生命周期/当前入口/历史保留均通过，无正式文档依赖具体任务材料。未涉及真实模型、远端推送或发布产物；本票要求的真实 Electron 已验证。仅本地提交，无推送。
