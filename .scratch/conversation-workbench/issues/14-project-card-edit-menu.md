# 14: 项目详情卡片、编辑与项目菜单

**What to build:** hover 项目行时整行出现背景，右侧显示“更多项目操作”与“在此项目下新建对话”按钮，同时在该行右侧显示详情卡片（顶部对齐、间距 2px）：文件夹与项目名、右上角置顶 / 取消置顶、对话数（不计已归档的，单独置顶的会话仍计入原项目）、全部源文件夹路径（可换行或滚动读取）、底部“编辑项目”。指针从行移入卡片时保持打开。点击更多先收起卡片，再在行右侧打开菜单（顶部对齐、间距 2px），菜单项依次为重命名、编辑项目…、置顶 / 取消置顶、在此项目下新建对话、在 Finder 中打开；分隔线下的“删除项目”由 15 加入。重命名在行内进行（复用 08 的部件），项目名最多 50 个字符，保存后列表、归属栏与卡片同步。编辑项目复用 13 的表单，回填名称、完整源文件夹列表与主要标记，可以添加、移除文件夹与更换主要；保存更新原项目，不改变已有会话的工作目录。把主要文件夹改成另一个项目的主要文件夹，或移除主要文件夹后接替者已是另一个项目的主要文件夹时，保存失败并指出是哪个项目，表单保留。置顶项目把整个项目树移入置顶分类，已单独置顶的会话仍只出现一次；取消置顶后恢复原分类与展开状态。“在 Finder 中打开”打开主要文件夹。

- 行为依据：[规格](../spec.md) PROJ-08 至 PROJ-13、PROJ-15（编辑部分）、PROJ-18（Finder 与接替冲突）、CHAT-07、LIST-11、13.1 的列表项浮层行。

**User stories:** 16（项目部分）、21、22（编辑部分）、23（项目部分）、24（菜单部分）、25

**Blocked by:** 08、13

**Status:** ready-for-agent

**Write scope:** apps/server 的项目编辑与置顶；packages/protocol；renderer 的项目行 hover、详情卡片、项目菜单、编辑弹窗与置顶分类中的项目树；宿主（main 与 preload）新增“在 Finder 中打开”；i18n；projects.md 的项目详情与编辑一节。

**跨票接口：** 项目菜单为 15 的“删除项目”预留分隔线下的位置；卡片与菜单定位复用 07 的浮层部件；“在此项目下新建对话”调用 12 的入口。

- [x] Sidecar 协议：编辑后读回名称、文件夹与主要标记，已有会话的工作目录不变；两种主要文件夹冲突时保存失败并返回冲突的项目；项目置顶与取消置顶后读回置顶时间；对话数不计已归档会话、计入单独置顶的会话。
- [x] Browser Mode：卡片与菜单在行右侧、间距 2px、顶部偏移 0px，指针穿过间距不关闭，点击更多先收起卡片；路径可以完整读取；置顶项目后整棵树进入置顶区，单独置顶的会话不重复，取消后恢复；行内重命名后各处名称同步；从卡片与菜单进入同一编辑弹窗（CW-13 至 CW-16、CW-21 与 CW-22 的项目部分、CW-71 的编辑部分）。
- [x] 宿主能力的单元测试（注入 shell）：“在 Finder 中打开”只打开已存在的目录，文件与不存在的路径被拒绝。
- [x] projects.md 的相应一节；`check:docs` 通过。


**Closed:** true

## Comments

### 2026-11-03 — 完整实施与验收

- 测试边界沿用规格第 18 节：真实 Sidecar HTTP；Browser Mode 的真实 DOM、几何及交互；注入 shell 的宿主单元边界；真实 Electron 装配（shell 在系统边界替换，测试不启动 Finder）。未重复要求许可。
- 项目详情与行复用 07/08 的 RowHoverCardContent、RowMenu、FadingTitle、InlineRename。卡片及菜单有空间时右侧 2px、顶部 0px；指针从行进入卡片保持打开，全部路径换行/滚动可读，更多先卸载卡片。名称最多 50 字符。ProjectMenuSlots.delete 在分隔线下为 15 留槽，未提供时无空行。
- PUT /api/projects/:id 接受 ProjectFields，返回 `{status: updated, project}`；PUT /api/projects/:id/name 只改名；PUT /api/projects/:id/pin 读写 pinnedAt，重复置顶保留时间。编辑验证真实目录、去重及唯一主要；两种主要冲突均以 409 already-exists / primary-conflict 返回具名 Project，表单保留。完整顺序和主要位置持久化，既有 Session 的 Workspace 不变。
- 置顶分类混合项目树与单独置顶 Session，按 pinnedAt 排序；项目在原分类移除，单独置顶 Session 只出现一次，取消后保留展开和分页。计数只含未归档根 Session，保留单独置顶成员的原归属与计数。当前会话与草稿 DOM 保持同一对象。
- ProjectDialogsProvider 新增 useEditProject()，两个编辑入口共用 13 表单；useCreateProject 保留 16 需要的 `(project,status)` 完成回调。项目新对话使用既有导航；真实 Electron 暴露了菜单关闭后焦点回来源行的问题，已令新对话/编辑动作跳过来源焦点恢复，输入框焦点回归通过。
- main / preload 新增受控 openDirectory，来源主 frame 检查后只把已存在的绝对目录交给 shell.openPath；文件、不存在、非法路径及 shell 拒绝/抛错返回 false，界面失败 Toast。
- 已合并最新集成 e8e918e，保留 16 的 moveSession 及 18 的 title 事件、ListStore 字段所有权和过期列表保护。

| 验证 | 精确命令 | 结果 |
| --- | --- | --- |
| Red | `rtk pnpm run test tests/integration/sidecar-edit-project.test.ts` | 新编辑入口在实现前 404，1 用例失败 |
| 宿主 Red | `rtk pnpm run test apps/desktop/src/main/open-directory.test.ts` | 新宿主模块未实现，suite 加载失败；实现后用例通过 |
| Browser Red | `rtk pnpm run test apps/desktop/src/renderer/features/sidebar/project-row.browser.test.tsx` | 实现前缺 Project details，1 用例失败 |
| Sidecar、宿主、字典 | `rtk pnpm run test tests/integration/sidecar-edit-project.test.ts tests/integration/sidecar-create-project.test.ts tests/integration/sidecar-projects.test.ts apps/desktop/src/main/open-directory.test.ts packages/i18n/src/index.test.ts packages/i18n/src/domains.test.ts` | 6 文件，18 用例；17 通过，旧字典文案断言 1 失败。后者已同步到当前“新对话 / New chat”字典 |
| 字典修复复验 | `rtk pnpm run test packages/i18n/src/index.test.ts` | 1 文件、10 用例通过；未重复无变更的其余 5 文件 |
| Browser 回归 | `rtk pnpm run test apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx apps/desktop/src/renderer/features/sidebar/session-row.browser.test.tsx apps/desktop/src/renderer/features/sidebar/session-menu.browser.test.tsx apps/desktop/src/renderer/features/sidebar/session-move.browser.test.tsx apps/desktop/src/renderer/features/sidebar/project-row.browser.test.tsx apps/desktop/src/renderer/features/projects/project-form.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx` | 7 文件、88 用例通过，包含 CW-13 至 CW-16、CW-21/22 项目部分和 CW-71 编辑部分，以及现有会话菜单/移动回归 |
| Electron | `rtk pnpm run test apps/desktop/e2e/project-edit.e2e.test.ts apps/desktop/e2e/create-project.e2e.test.ts apps/desktop/e2e/session-move.e2e.test.ts` | 3 文件、3 用例通过；globalSetup 本次 package 构建后运行。编辑冲突保留、主要更换、固定工作目录、改名/置顶重启、真实 preload/main 目录路径与项目新对话焦点均通过 |
| 类型 | `rtk pnpm run typecheck` | 退出 0 |
| 设计检测 | `rtk proxy /Users/chenzheng/.agents/skills/impeccable/scripts/impeccable detect --json apps/desktop/src/renderer/features/sidebar/project-row.tsx apps/desktop/src/renderer/features/sidebar/sidebar-lists.tsx apps/desktop/src/renderer/features/projects/project-dialogs.tsx apps/desktop/src/renderer/features/projects/project-form.tsx` | `[]`，明暗主题截图已读回：`.vitest/cw14-project-light.png`、`.vitest/cw14-project-dark.png`；完整路径 `.vitest/cw14-project-details.png` |

文档影响：项目编辑/详情/置顶/Finder → `docs/subsystems/projects.md` 原地增加当前行为、接口失败与验证入口；ADR 0020 的当前实施范围同步；原“尚未接入”说明移除。AGENTS → docs/README → projects.md 已读回；路径、引用方向、语义、权威、生命周期、正式入口、新会话可判定性和历史保留均通过，正式资料不依赖本任务材料。`rtk pnpm run check:docs` 检查 246 个 Markdown，0 问题；`rtk git diff --check` 退出 0；所改 TypeScript 经 Oxfmt / Oxlint，退出 0。没有运行全仓测试、真实模型、实际 Finder 或发布构建产物 smoke；这些不属于本票测试边界。
