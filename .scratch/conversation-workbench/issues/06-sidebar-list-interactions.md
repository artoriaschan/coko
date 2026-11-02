# 06: 侧栏列表交互与状态恢复

**What to build:** 分类标题与下方列表的内容左边缘对齐，字号与会话名称相同（置顶标题用弱化颜色）。分类展开时，向下箭头只在标题栏 hover 或 focus 时出现在名称后；分类折叠时向右箭头常驻；点击标题或箭头切换。标题栏右端按钮只在 hover 或 focus 时显示，点击它们不触发折叠。按住拖拽手柄上下拖动可调换“对话”与“项目”两类的顺序，置顶固定在最上方、没有拖拽入口。对话、项目与项目内会话三个列表各自默认显示 5 条，每次“展开”多显示 5 条，“折叠”回到 5 条，使用左对齐的小号纯文字；还有未显示的项时才出现“展开”，超过 5 条时才出现“折叠”；置顶分类始终全部显示。项目分类的“收起所有项目 / 展开所有项目”只作用于项目分类内的项目：只要有一个项目展开就显示“收起所有项目”。项目排序菜单提供“按创建时间”“按最近使用”两个单选项，当前项勾选，选择后重排并关闭；默认按最近使用（取项目内会话的最后记录时间，没有会话时取创建时间），都按时间降序，相同时依次按创建时间和 id。重启后恢复分类顺序、分类与项目的展开状态、项目排序方式和上次打开的会话，它已不在列表中时打开新对话；“展开”多显示的条数与打开着的菜单、浮层不保存。

- 行为依据：[规格](../spec.md) LIST-01 至 LIST-05、LIST-07、LIST-08、5.1 的分类表、PROJ-01、STATE-01（新对话草稿由 11 负责）、13.1 的展开与折叠行。
- 标题栏右端按钮按 5.1 的表预留位置：对话分类的“创建新对话”由 11 加入；项目分类的“+”沿用 01 的过渡入口，13 换成弹窗。

**User stories:** 7、8、9、11（展开与收起所有项目）、12、15

**Blocked by:** 01

**Status:** ready-for-agent

**Write scope:** renderer 的侧栏列表组件与分类标题栏、列表 store 中的本地显示状态；i18n；projects.md 的列表交互一节。

**跨票接口：** 分类标题栏组件按 5.1 的表固定右端按钮的顺序与插槽；07 的置顶分类、11 的创建新对话、13 的创建项目使用同一组件。

- [x] Browser Mode：标题与列表左边缘一致、同为 13/20；两种箭头状态；右端按钮只在 hover 或 focus 时出现，点击不折叠分类；拖动手柄调换两类、不误开菜单；三个列表的“展开 / 折叠”各自独立、每次 5 条；“收起所有项目”与“展开所有项目”的切换条件，且不影响置顶区的项目；排序菜单的两个单选项、勾选与关闭（CW-03 至 CW-08、CW-10）。
- [x] Electron E2E：调换分类顺序、收起一个项目、改为按创建时间并打开一个会话后重启，这些状态都恢复；记录的上次会话已不在列表中时打开新对话。
- [x] projects.md 的列表交互一节；`check:docs` 通过。


Closed: true

## Comments

2026-11-03：基于集成分支 `88fb961` 实施，源码提交 `2cc47f7`，交付前合入 `b9811b2`（包含 01 至 05）。仅 docs/README 的相邻摘要冲突，保留模型/推理档位与列表交互/恢复两项。全部改动仅本地提交，未推送。

- TDD：先观察旧列表显示第 6 行导致分页用例失败，再实现分页；标题按钮、排序菜单、拖拽手柄分别先出现缺失入口的失败，再逐项实现。追加条目后项目最近使用排序未更新的回归也先失败，再将当前会话最后记录时间并入项目排序。测试接口沿用规格第 18 节已批准的 Browser Mode 与真实 Electron。
- 独立列表 store 保存分类顺序、分类/项目展开、项目排序与上次会话到 `coko.workbench.lists.v1`；分页不持久化。偏好读取校验结构，损坏或不可用回到默认。根会话首次加载恢复原选择，目标已删除或归档则进入新对话。共享 `SidebarCategoryHeader` 提供 07/11/13 的标题及操作插槽。
- 画布核对：读取 `i3Xq1` 分类四态与 `O19dq` 项目标题/排序。分类标题与行同为 13/20、左边缘一致；H32，分类操作点击框24px/图标14px；底部展开/折叠为12/18纯文字、同排20px间距。浅色/深色实际 Chromium 画面已读回；行与标题不跳动、右端操作完整。一次截图输出尝试被 Vite 的文件访问边界拒绝，改读该轮自动产生的真实渲染截图；临时截图探针已移除，未放宽 Vite 配置。
- Browser Mode 覆盖：每层独立5条分页、分类折叠保留分页、标题和行对齐、hover/focus操作与箭头、原生浏览器 dragAndDrop 换序、不打开菜单、项目排序单选/勾选/关闭、展开所有与收起所有、置顶项目展开不受影响、重新挂载恢复偏好但不恢复分页、会话条目刷新项目最近使用排序。
- Electron 夹具：真实 Sidecar 经协议登记两个临时目录和会话，操作分类/项目/排序及选择旧会话，完整关闭后复用用户目录重启读回。缺失目标的两个场景在应用已关闭时用独立 Node SQLite 进程构造删除/归档状态（删除同时移除该会话的初始化条目），再用真实窗口确认进入新对话。本票没有提前实现 09/10 的产品操作。
- 合入最新集成分支后：`pnpm run test apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx packages/ui/src/guards/style-guard.test.ts apps/desktop/src/renderer/stores/chat-store.test.ts apps/desktop/src/renderer/features/conversation/model-picker.browser.test.tsx apps/desktop/src/renderer/features/conversation/context-ring.browser.test.tsx`，6文件106项通过，退出0。
- 合入后：`pnpm run test apps/desktop/e2e/sidebar-lists.e2e.test.ts apps/desktop/e2e/workbench.e2e.test.ts`，2文件4项通过，退出0（本票3项，工作台1项）；globalSetup 重建当前 main/preload/renderer/Sidecar 后验证真实 Electron。
- `pnpm run typecheck` 通过，退出0；`pnpm run lint` 通过，退出0；`pnpm run check:docs` 通过（246个Markdown，0问题）；`git diff --check` 通过。Impeccable detector 对修改的列表源文件返回 `[]`。
- 文档：更新 projects.md 的交互、本地恢复与验证入口，docs/README 同步摘要；搜索旧基础列表说明及 projects.md 的消费者，ADR0020仍正确描述基础能力并保持partial，01的历史实施记录保留。按 AGENTS → docs/README → projects.md 读回，生命周期、归属、引用与状态一致，无正式文档反向依赖任务材料。
- 未运行真实模型、CI与发布构建测试；本票验证本地源码、浏览器与测试构建的真实 Electron。
