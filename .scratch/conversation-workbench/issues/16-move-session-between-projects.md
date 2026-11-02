# 16: 移到项目与移出项目

**What to build:** 会话菜单加入“移到项目”，右端保留向右箭头。二级菜单保留父菜单，以更高层级叠在“移到项目”右侧：左边缘紧贴触发项右边缘，间距 0px、顶部对齐；父菜单的 4px 右内边距使两个表面窄幅重叠；窗口右侧空间不足时才按共享规则翻转。子菜单有项目搜索、已有项目列表与当前项勾选（同名项目附带主要文件夹的目录名），分隔线后为“选择文件夹…”；只有对话实际有项目归属时才显示“移出项目”，与是否置顶无关。关闭子菜单时先回到“移到项目”，不连带关闭父菜单。选择项目后关闭菜单并更新归属；移动只改归属，不改工作目录、worktree 绑定与置顶状态。“选择文件夹…”先关闭菜单，打开 13 的创建项目弹窗；创建成功或命中已有主要文件夹的项目后，把原对话移入目标项目，不进入新对话页、不创建新 Session；取消或创建失败不改变原归属；项目已创建而移动失败时明确说明，不显示为已移动。“移出项目”清除归属：普通项目对话移到“对话”分类，已置顶的仍在置顶区，详情归属改为“对话”。

- 行为依据：[规格](../spec.md) CHAT-11、CHAT-19、CHAT-20、PROJ-20（移动菜单部分）、2.2 的二级菜单两行。

**User stories:** 28（移动菜单部分）、30

**Blocked by:** 08、13

**Status:** ready-for-agent

**Write scope:** apps/server 的移入、移出项目；packages/protocol；renderer 的“移到项目”菜单项、二级菜单与选择文件夹的完成动作；packages/ui 的叠加子菜单部件（保留父级、逐层关闭）；i18n；projects.md 的移动一节。

**跨票接口：** 叠加子菜单部件供 20 的分支子菜单复用，16 与 20 谁先合入谁提供；附加文件夹的权限变化由 17 负责，本票保证下一个 Run 能读到新的归属。

- [x] Sidecar 协议：移入、移出后读回归属；工作目录、worktree 绑定、置顶时间与最后记录时间都不变。
- [x] Browser Mode：子菜单紧贴触发项、间距 0px、顶对齐，箭头可见，父菜单仍在，关闭后焦点回到“移到项目”；“移出项目”的显示条件（独立、项目内、置顶的独立、置顶的项目对话四种）；置顶对话经“选择文件夹…”创建项目后归属新项目、仍置顶、没有副本；命中已有主要文件夹时移入已有项目、不进入新对话页；取消、创建失败与移动失败（CW-24、CW-78 至 CW-82、CW-84 的移动菜单部分）。
- [x] Electron E2E：用“选择文件夹…”把独立对话移入新项目后重启，它在新项目下，工作目录仍是原来的专属目录。
- [x] projects.md 的移动一节；`check:docs` 通过。


**Closed:** true

## Comments

### 2026-11-03 — 完成与验证

- 公共接口：`PUT /api/sessions/:id/project`，`MoveSessionRequest { projectId: string | null }`、`apiPaths.sessionProject`、renderer `api.moveSession` / `lists.moveSession`。仅修改根会话归属；无目标返回 404，非法请求 400；时间、Workspace、worktree 和条目不变。后续 Run 可以查询新的归属；附加文件夹权限接入由 17 负责。
- 菜单复用 20 提供并已集成的 `DropdownMenuStackedSubContent`，父级层 50、子级层 51，默认零间距、顶对齐、4px 表面重叠；适配可用宽度以避免 390px 窗口翻转后越界。Escape 逐层关闭并回到父触发项，保留箭头、搜索、当前项、同名主要目录区分。四种归属/置顶组合与直接移动失败重试均覆盖。
- “选择文件夹…”复用 13 的应用级弹窗宿主，完成 closure 捕获来源 ID。新建与 existing 结果都移动原 Session；取消、创建失败保持来源归属；已创建而移动失败明确 Toast。`useCreateProject` 的可选 `onComplete` 现额外接收结果 status，原单参数消费者兼容；已通知 14 的编辑项目实现保留此形状。
- TDD：`rtk pnpm run test tests/integration/sidecar-session-move.test.ts` 首次 1 例因接口 404 失败，接入后通过；`rtk pnpm run test apps/desktop/src/renderer/features/sidebar/session-move.browser.test.tsx` 首次 1 例因缺失 Move to project 项失败，接入后通过。扩展用例校正读取公开 DTO（Session worktree DTO 不含 path；CreateSession 响应后权限记录会刷新活动时间，应以 detail 读回为基准），不查询数据库。
- 最终检查（退出码均 0）：
  - `rtk pnpm run test apps/desktop/src/renderer/features/sidebar/session-move.browser.test.tsx`：1 文件、14 例通过；明/暗主题、正常桌面与 390px、菜单几何、焦点、搜索、四种显示条件、创建/existing/失败/取消/source identity。
  - `rtk pnpm run test apps/desktop/src/renderer/features/sidebar/session-menu.browser.test.tsx`：1 文件、18 例通过；旧菜单的精确项目与图标槽断言更新为包含本票新增菜单项，其余行为不变。
  - `rtk pnpm run test apps/desktop/src/renderer/features/conversation/branches.browser.test.tsx tests/integration/sidecar-session-move.test.ts`：2 文件、5 例通过（分支菜单共享消费者 3，移动 Sidecar 2），包括归属移入/移出/非法目标、置顶与时间不变、真实 worktree 绑定和条目保持、SQLite 重启读回。
  - `rtk pnpm run test apps/desktop/e2e/session-move.e2e.test.ts apps/desktop/src/renderer/features/conversation/project-git-menu.browser.test.tsx`：实际选中 1 文件、Electron 1 例通过；第二过滤路径不存在，随后以上一命令实际运行共享分支浏览器 3 例。真实 Electron 经主界面首次发送创建独立专属目录、选择文件夹创建项目、移动原会话、重启后读回新项目与原 cwd。
  - `rtk pnpm run typecheck`：通过。
  - `rtk pnpm run check:docs`：246 Markdown、0 问题；最终导航摘要修订后再次执行。
  - `rtk proxy /Users/chenzheng/.agents/skills/impeccable/scripts/impeccable detect --json apps/desktop/src/renderer/features/sidebar/session-move-menu.tsx`：`[]`；已检查 `.vitest/cw16-light.png`、`cw16-dark-390.png` 的实际输出。
- 文档：原地更新 `docs/subsystems/projects.md` 移动一节及菜单摘要、验证链接，`docs/README.md` 同步职责摘要。从 AGENTS → 文档导航 → 正文读回，引用方向、当前入口、语义与归属均通过；没有新建正式文档或引用具体任务材料。
- 分支已合并集成 tip `2ca3b57`（合并提交 `a1f1294`），共享 20 部件无重复；保留本票提供的接口。仅本地提交，无推送、PR 或真实模型调用；无需真实模型即可验证组织关系。
