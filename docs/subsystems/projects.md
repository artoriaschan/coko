---
kind: reference
description: "项目模型、Workspace 迁移、多文件夹创建与编辑、项目详情与置顶、会话归属、侧栏交互与恢复，以及会话详情、菜单、重命名、置顶和永久删除。"
lifecycle: active
---

# 项目与会话列表

项目是组织会话的容器，主要文件夹对应一个 Workspace。本文描述项目数据、升级迁移、多文件夹创建、工作台列表及会话置顶的行为。归档和多文件夹权限尚未接入界面，不把存储字段等同于这些能力已经交付。

## 数据与迁移

[SessionStore](../../packages/session/src/types.ts) 提供独立的 ProjectRepository。Project 保存名称、主要 Workspace、有序的附加文件夹路径、主要目录在完整列表中的位置、置顶时间与创建时间；主要 Workspace 在项目间唯一，项目名称可重复。内存和 SQLite 实现共享契约测试。

SQLite v10 在一次前向迁移中建立 projects 表，并给 sessions 增加 project_id、pinned_at、archived_at。每个已有 Workspace 迁移为一个单文件夹项目，沿用名称和创建时间；其中的根会话（包括绑定 worktree 的会话）归入该项目，置顶与归档为空。子会话不单独保存项目归属。升级沿用现有迁移前 VACUUM INTO 备份及失败处理。

经 Workspace 登记接口添加目录时，服务端验证目录存在并解析为真实路径，再登记 Workspace 与单文件夹项目。相同目录经符号链接登记不会产生第二个 Workspace 或项目。此兼容入口保留，界面创建走下面的项目接口。

SQLite v11 追加主要目录位置字段，旧项目默认为列表第一项；不重写 v10，迁移前备份仍保留旧格式。这样用户把列表中间的目录设为主要时，其他目录和主要目录的顺序均可重启读回。

## 创建项目与主要文件夹

项目分类的“+”与新对话归属菜单底部的“新建项目”打开同一个[项目表单](../../apps/desktop/src/renderer/features/projects/project-form.tsx)。名称首次聚焦、最多 50 字符，非空名称及至少一个目录才可提交。空表单提供虚线添加区域，目录由 Electron 宿主选择；取消选择不改草稿。添加前通过 Sidecar 校验存在、可读取及可遍历，并取真实路径，同一目录经符号链接、末尾斜杠或 `..` 添加会提示“已添加”。失败说明保留在表单中，不新增目录行。

源文件夹保留添加顺序。第一个缺省为主要，非主要行在 hover 或焦点进入时显示“设为主要”，隐藏时保留按钮位置；点击只改草稿中的唯一主要标记。移除主要目录时由列表中的下一项接替，末项没有后继时取新的末项。名称、文件夹或主要标记改动后，取消、右上关闭与 Escape 均先询问“放弃更改？”，取消确认保留输入。提交期间锁定表单并阻止重复提交，保存失败保留草稿。

`POST /api/projects/check-folder` 校验绝对目录并返回规范真实路径；不可访问、非目录与相对路径以 `bad-request` 及可机读的 `reason` 拒绝。`POST /api/projects` 接受名称与带主要标记的有序目录，服务端再次验证名称、全部目录、去重和恰好一个主要标记；以主要 Workspace 唯一约束处理并发创建。返回 `status: created` 时带新项目；主要目录已属于项目时返回 `status: existing` 和原项目，不新增项目，也不合并草稿名称或附加目录。

应用级[弹窗宿主](../../apps/desktop/src/renderer/features/projects/project-dialogs.tsx) 更新同一份列表数据。分类创建或命中已有项目后进入新对话，预选该项目并聚焦输入区；归属菜单创建后只选择目标项目，保留同一份新对话草稿。已有项目结果通过应用级 Toast 告知项目名。表单也接受编辑初值和外部提交/完成回调，完成动作由调用方拥有，表单本身不创建会话或改变归属。编辑完成只更新同一份列表引用，不进入新对话或切换当前会话。

## 项目详情、编辑与菜单

[ProjectRow](../../apps/desktop/src/renderer/features/sidebar/project-row.tsx) 在整行 hover 或焦点进入时显示更多、新对话按钮和详情。卡片与更多菜单共用整行锚点，在空间足够时位于右侧 2px、顶部对齐；窗口边缘按共享浮层规则避让。指针可穿过间距进入卡片，卡片内的完整名称、未归档根会话数量、全部有序路径和主要标记均可读取，长路径换行并在卡片内部滚动。计数包含单独置顶的项目会话，不重复计数；点击更多先卸载详情，再打开菜单。

菜单依次提供重命名、编辑项目…、置顶 / 取消置顶、项目内新对话和在 Finder 中打开；ProjectMenuSlots.delete 为后续删除操作保留分隔线下的入口，不显示空项目。重命名复用 InlineRename，最多 50 字符，Enter 或失焦提交，Escape 取消，输入法组合期间不提交，空白及未变输入不发送请求。保存失败保留输入、焦点并显示 Toast，成功后列表、项目归属引用和详情同步。

卡片和菜单中的编辑打开同一个应用级项目表单，回填名称、全部有序文件夹和主要标记。可以添加、移除及更换主要文件夹；移除主要时由下一项接替，末项被移除时取新的末项。PUT /api/projects/:id 更新原项目并返回 `{ status: updated, project }`，不创建副本，不改变既有会话的 Workspace 或 worktree。文件夹按真实路径再次验证；新主要目录与另一个项目冲突时以 409 already-exists、details.reason 为 primary-conflict、details.project 为冲突项目拒绝，表单显示项目名并保留草稿。手动切换与移除后的接替均走同一约束；名称、目录和主要位置可重启读回。

PUT /api/projects/:id/name 只更新规范化名称；PUT /api/projects/:id/pin 接受布尔 pinned 并返回 Project。重复置顶保留原 pinnedAt，取消置顶清空。置顶分类混合项目树与单独置顶会话，按置顶时间降序排列，不分页；项目树从原分类移出，单独置顶会话继续独立显示且不会在树内复制。取消项目置顶恢复原分类、展开和分页状态，当前会话内容和草稿不重建。两个新对话入口使用已有的工作台导航，预选项目并聚焦输入框，不改变项目展开状态；菜单关闭不会把焦点抢回来源行。

Finder 通过受控 preload IPC 调用 [openDirectory](../../apps/desktop/src/main/open-directory.ts)。main 校验来源主 frame，再验证绝对路径存在且为目录后交给 shell.openPath，文件、不存在的路径及宿主打开失败返回 false；界面显示失败 Toast。打开目标为当前主要文件夹，已有会话仍使用自己的固定工作目录。

## 独立对话专属目录

独立对话没有项目归属，首次发送时才创建用户可见的专属目录并登记 Workspace，目录不是 Project。默认根目录为 `~/Coko/chats`，启动环境 `COKO_CHATS_ROOT` 可覆盖为另一个绝对路径；测试夹具为每个实例提供临时根目录。日期加随机后缀通过独占创建分配，不覆盖既有文件。

首次发送接受前失败时只回滚自己创建的会话、未被引用的 Workspace 和目录；接受后的模型错误仍属于已有会话。删除记录与目录是不同操作：存储的 `deleteSession` 清理会话树的条目、定时任务与进程登记，保留 Workspace 和 worktree；`deleteWorkspaceIfUnused` 只有在没有会话、项目、worktree、记忆引用时删除登记，不操作文件系统。独立会话后续被用户删除时，其工作文件仍应保留。首次发送的完整契约与验证见[工作台](workbench.md#新对话与首次发送)。

## 会话归属与列表协议

根会话在有项目的主要 Workspace 中创建时默认归入该项目；明确传入 projectId: null 时为独立会话。子会话的存储记录不单独保存归属，协议 DTO 沿父会话链读取根会话归属。分叉和交接显式继承来源的归属；它们不会重新根据工作目录决定归属。

归属和执行目录分离。组织字段的修改不改变 Workspace 或 worktree 绑定。会话的 updatedAt 表示最后记录时间：创建和追加条目会刷新，标题、模型及组织字段的修改不刷新。根会话列表按该时间降序、相同时间按 id 排列，子会话经子列表查询。

GET /api/projects 返回项目及源文件夹的主要标记、未归档根会话数、最近使用时间。最近使用取项目中根会话最后记录时间，没有会话时取项目创建时间。Session DTO 带项目归属、置顶和归档时间。

## 工作台列表

renderer 的 [list-store](../../apps/desktop/src/renderer/stores/list-store.ts) 持有项目、Workspace、根会话列表与加载状态；chat-store 保留会话内容与 Run 控制，新对话配置由独立 new-chat-store 持有，通过独立列表 store 更新组织视图。React 的 useLists 订阅列表数据，useCurrentSession 结合当前会话标识查询列表。

侧栏包含“置顶”“对话”和“项目”：置顶分类在有置顶会话或项目时显示；独立的未归档、未置顶根会话在“对话”下；项目行在原位展开或收起未单独置顶的所属会话，空项目显示“暂无对话”。项目内会话只缩进内容，整行背景与命中宽度保持一致。共享 SidebarListRow 提供 H32/R8 圆弧；行间距为 2px。列表不显示运行状态点或分支 chip，也不按运行状态上浮。侧栏不再提供 worktree 列表和移除入口。

项目行的新对话入口打开欢迎页、预选该项目并聚焦主输入框，不切换项目展开状态。归属选择与首次发送的主要 Workspace 行为见[工作台归属栏](workbench.md#新对话归属栏)。

## 会话详情、长标题与置顶

会话行在 hover 或键盘焦点进入时提供斜图钉与查看更多按钮。针尖朝左下，图标采用 14px 槽并在 24px 点击框中居中。查看更多先关闭详情并打开会话菜单；它不触发会话切换。

详情通过共享 HoverCard 脱离侧栏裁剪，以整行为锚点，首选位于行右侧 2px、顶部对齐；窗口边缘按 Radix 的可用空间避让，较长内容在卡片内部滚动。指针可跨过间距移入卡片，焦点进入卡片时保持打开。详情展示完整标题、最后记录时间的相对值与原有项目归属，置顶不改变归属。时间在一分钟内显示“刚刚”，之后为分钟、小时、天，超过七天展示本地化日期。点击更多、外部点击、离开或 Escape 关闭；已关闭的内容立即卸载，避免退场动画层拦截其他页面的 Escape。

共享 FadingTitle 保持单行，支持触控板、滚轮、拖动与所在行的方向键、Home、End 横向滚动。起点仅右侧渐隐，中间两侧渐隐，终点仅左侧渐隐，无溢出时无遮罩；渐隐不包含前导图标或行尾按钮。拖动不会打开或置顶会话。完整标题始终保留在行的可访问名称与详情卡中。

PUT /api/sessions/:id/pin 接受布尔值 pinned，返回更新后的 Session；只允许根会话。置顶写入 pinnedAt，重复置顶保留已有时间，取消置顶清空该值，不改变最后记录时间、工作目录或项目归属。失败保留原列表位置并给出 Toast。置顶会话在独立分类中按置顶时间降序排列，与活动时间无关；始终全部显示，不分页、不参与分类拖拽，标题栏没有右端操作。取消后回到原项目或独立分类，当前对话内容与编辑区不重建。

## 会话菜单与行内重命名

独立、项目内及置顶会话复用 [SessionMenu](../../apps/desktop/src/renderer/features/sidebar/session-menu.tsx)。点击更多以整行为锚点，首选位于行右侧 2px、顶部对齐；右键先关闭详情并阻止原生菜单，改用鼠标的视口坐标作为首选左上角。右键本身不会进入会话、置顶或新建。共享 RowMenu 通过 Radix portal、翻转、平移、至少 8px 窗口边距及可用高度内滚动（实际避让预留 1px，以容纳发丝分隔线引起的浮点取整）保持菜单可操作；外部点击、Escape、来源滚动或打开后窗口大小变化关闭菜单；打开前已发生、随后才送达的 resize 通知不关闭菜单。未进入改名时，菜单关闭后回到来源行的焦点，不重新打开详情。

菜单目前包含“重命名”“置顶 / 取消置顶”和分隔线下的危险色“删除对话”，根据当前置顶状态切换置顶文案。归档和移到项目通过具名插槽填入，未交付的项目不展示空菜单行。不展示导出为 MD、在飞书中继续、小窗打开或快捷键。所有前导图标使用居中的 14px 固定槽，斜图钉绕槽中心旋转，文字起点一致。

重命名将行标题替换为共享 [InlineRename](../../packages/ui/src/components/inline-rename.tsx)，聚焦并全选原始标题。Enter 或失焦提交，输入法组合期间 Enter 不提交，Escape 取消；保存前去除首尾空白，空值或没有变化时恢复原行、不发送请求。输入最多 200 字符，名称可以重复。保存期间输入只读，重复 Enter 或失焦不会重复提交；保存失败保留输入和焦点并显示应用级 Toast，可直接重试。成功响应更新列表 store 的同一份 Session，列表、当前会话引用与详情卡片同步，不重建会话内容。

PUT /api/sessions/:id/title 接受 title，校验字符串类型、非空及最多 200 字符，去掉首尾空白后调用存储标题写入能力，返回更新后的 Session。改名不追加记录、不改变最后记录时间、项目归属、置顶或工作目录，重启后仍可从列表与详情读回。

## 列表交互与本地恢复

分类标题和列表标题同为 13/20，文字左边缘一致。分类展开时，名称后的向下箭头及右端操作仅在标题 hover 或 focus 时显示；折叠时向右箭头常驻。标题与右端操作分别接收点击，操作按钮不折叠分类。共享业务标题组件 SidebarCategoryHeader 支持明确的操作插槽，置顶分类可不传操作。

“对话”和“项目”各有拖拽手柄，按住后拖到另一分类并释放才交换顺序；手柄不打开菜单，键盘聚焦手柄后也可用方向键调整顺序。置顶分类不参与换序。项目标题栏依次为展开/收起所有项目、拖拽、排序、创建项目；对话分类的创建入口由新对话界面接入。

独立会话、项目、各项目内会话分别默认显示 5 条，每次“展开”增加 5 条，“折叠”回到 5 条。还有剩余项时展示“展开”，显示超过 5 条时展示“折叠”；两个入口同排、左对齐、12/18 纯文字。分类折叠只隐藏内容，不重置项目展开或分页。项目分类的展开/收起所有项目只改变未置顶项目：任一项目展开时按钮为“收起所有项目”，否则为“展开所有项目”。

项目默认按最近使用排序，另可选择按创建时间；单选菜单显示当前项，选择后关闭。时间降序，相同时按创建时间降序、再按 id 升序。新追加的会话条目会立即更新项目最近使用排序；重命名、置顶等不改变会话最后记录时间。

列表 store 将分类顺序、分类和项目展开状态、项目排序、上次打开会话保存到本地浏览器存储。重启后恢复这些偏好，上次会话不存在或已归档时进入新对话；首次使用尚无记录时沿用最近会话的初始选择。偏好损坏或浏览器存储不可用时采用默认值，本窗口仍可操作。分页条数、菜单和浮层不保存。置顶、项目归属和归档仍由 Sidecar 持久化。

## 验证与相关设计

- [主要目录位置迁移](../../packages/session/src/sqlite/migrate-v11.test.ts)：v10 升级、旧数据默认位置、重启读回与备份。
- [项目编辑 Sidecar 用例](../../tests/integration/sidecar-edit-project.test.ts)：编辑及主要目录冲突、原会话 Workspace 固定、置顶时间、归档与置顶计数、非法输入及重启读回。
- [项目行浏览器用例](../../apps/desktop/src/renderer/features/sidebar/project-row.browser.test.tsx)：详情与菜单 2px 顶对齐、指针跨间距、完整路径、混合置顶树、失败与展开状态；[应用浏览器用例](../../apps/desktop/src/renderer/app/app.browser.test.tsx) 验证内容和草稿 DOM 稳定及共用编辑入口。
- [Finder 宿主单元用例](../../apps/desktop/src/main/open-directory.test.ts)：注入 shell 验证目录准入与失败；[项目编辑 Electron 用例](../../apps/desktop/e2e/project-edit.e2e.test.ts) 验证真实 preload/main 装配、编辑、重启及项目内新对话。
- [创建项目 Sidecar 用例](../../tests/integration/sidecar-create-project.test.ts)：多目录顺序、真实路径判重、已有结果、名称与目录拒绝及重启读回。
- [项目表单浏览器用例](../../apps/desktop/src/renderer/features/projects/project-form.browser.test.tsx)：主要标记与接替、hover/focus 几何、目录取消/失败、放弃确认、保存锁定、明暗主题与窄窗口。
- [创建项目 Electron 用例](../../apps/desktop/e2e/create-project.e2e.test.ts)：宿主目录选择、已有项目 Toast、新对话预选、归属菜单创建与首次发送归属。
- [存储契约](../../packages/session/src/repository-contract.ts)：主要 Workspace 唯一、完整组织字段的读写和最后记录时间。
- [迁移用例](../../packages/session/src/sqlite/migrate-v10.test.ts)：v9 升级、根会话和 worktree 归属、子会话字段及备份读回。
- [Sidecar 协议](../../tests/integration/sidecar-projects.test.ts)：真实目录判重、项目列表、创建会话、分叉和重启读回。
- [列表浏览器用例](../../apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx)：分类箭头与焦点、拖拽、独立分页、排序、重启偏好与实际几何。
- [列表 Electron 用例](../../apps/desktop/e2e/sidebar-lists.e2e.test.ts)：真实重启后恢复顺序、展开、排序与上次会话，以及目标已删除或归档时的新对话回退。
- [置顶 Sidecar 用例](../../tests/integration/sidecar-session-pinning.test.ts)：置顶、取消与重启读回，项目归属和最后记录时间不变。
- [会话行浏览器用例](../../apps/desktop/src/renderer/features/sidebar/session-row.browser.test.tsx)：浮层几何、滚动渐隐、固定操作、焦点、失败和窄窗口；[应用用例](../../apps/desktop/src/renderer/app/app.browser.test.tsx) 验证置顶不重建当前对话或草稿。
- [置顶 Electron 用例](../../apps/desktop/e2e/session-pinning.e2e.test.ts)：置顶项目会话后重启，详情保留归属，取消置顶回到原项目。
- [重命名 Sidecar 用例](../../tests/integration/sidecar-session-rename.test.ts)：标题修剪、重复、200 字符边界、非法请求、时间戳不变与重启读回。
- [菜单浏览器用例](../../apps/desktop/src/renderer/features/sidebar/session-menu.browser.test.tsx)：整行与鼠标定位、窗口避让、图标对齐、全选、提交、取消、空白与失败重试。
- [重命名 Electron 用例](../../apps/desktop/e2e/session-rename.e2e.test.ts)：真实右键菜单改名，重启后列表与项目详情卡片保持新标题。
- [ADR 0020](../adr/0020-projects-organize-workspaces.md)：组织关系与执行目录分离的理由。

## 永久删除对话

普通、项目内和置顶会话共用删除入口。选择“删除对话”先关闭菜单，再打开 [SessionDeleteDialog](../../apps/desktop/src/renderer/features/sidebar/session-delete-dialog.tsx)，它接收固定的 sessionId，也可由归档列表和搜索结果复用。确认弹窗为 W480、最小 H184、R28，狭窄窗口按可用宽度收缩；初始焦点在取消。取消、右上关闭和 Escape 保留会话并恢复来源行的焦点；确认期间禁止重复提交和关闭。失败留在弹窗显示原因，成功响应后才移除列表与内容订阅。删除当前打开会话时进入新对话，其他会话保持当前选择。

DELETE /api/sessions/:id 返回 `{ sessionIds }`，包括目标和所有后代的身份。存储在一个事务中删除会话树、它们的条目、绑定定时任务和进程登记；保留 Workspace、worktree 记录及目录、记忆、项目源目录和用户工作文件，独立对话的专属目录也保留。直接删除不会执行 worktree 清理或删除文件系统路径。

有进行中的 Run、子代理或运行中的 Job 时，以 409 `session-busy` 拒绝，details 为 `{ reasons, sessions }`：reasons 区分 `run`、`agent`、`job`（共享类型还为归档等操作保留 `schedule`），sessions 给出涉及的会话 id 和标题。仅启用的定时任务不阻止删除。旧回退接口的同名错误仍可没有这些 details。

[SessionService](../../apps/server/src/application/sessions.ts) 在检查前登记删除屏障，排斥新 Run 和子会话创建；异步输入准备、Run 准入及 Run 结束后的领域回调也计入忙碌。删除前等待定时投递和已结束 Job 的尾部写入，成功后释放运行时、权限、Job、子代理通知与定时监听缓存。失败释放屏障，以便重试。契约见 [Sidecar 集成测试](../../tests/integration/sidecar-delete-session.test.ts)、[并发边界测试](../../apps/server/src/application/session-delete.test.ts)、[浏览器菜单测试](../../apps/desktop/src/renderer/features/sidebar/session-menu.browser.test.tsx) 与 [Electron 重启测试](../../apps/desktop/e2e/session-delete.e2e.test.ts)。
