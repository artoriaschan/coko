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

- [ ] packages/session：旧版本库升级后每个 Workspace 成为单文件夹项目，根会话（含绑定 worktree 的）归入其中，置顶与归档为空；迁移前备份存在；新字段在 SQLite 与内存实现中读写一致；主要文件夹的唯一约束生效。
- [ ] Sidecar 协议：列表返回迁移后的项目与会话；经现有路径在项目的 Workspace 中新建的会话归入该项目；分叉与交接继承来源的归属；经“+”的过渡路径登记目录后出现一个单文件夹项目。
- [ ] Browser Mode：只有“对话”“项目”两类；点击项目行展开与收起，文件夹图标切换；项目内会话只缩进内容、hover 背景仍为整行；行 H32、间距 2px、R8；空项目显示“暂无对话”；会话按最后记录时间降序，相同时按 id；会话行没有状态点与分支 chip，侧栏没有 worktree 列表（CW-09）。
- [ ] Electron E2E：以含 Workspace 与会话的旧版本库启动（夹具的构造方式在 Comments 说明），侧栏的项目中列出原有会话，打开其中一个能继续对话。
- [ ] 依赖旧分组、状态点、分支 chip 或侧栏 worktree 列表的已有 browser 与 E2E 用例随界面改写或删除，每处在 Comments 写明原因。
- [ ] 按 coko-docs 新建 `docs/subsystems/projects.md`（数据模型、迁移、列表）并在 docs/README 加入口；ADR 0020 的 implementation 改为 partial 并记录已实施的部分，ADR 索引同步；`check:docs` 通过。
