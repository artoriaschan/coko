# 13: 创建项目

**What to build:** 项目分类标题栏的“+”打开“创建项目”模态弹窗（替换 01 的过渡）。弹窗有标题、关闭按钮、项目名称（带文件夹图标，首次进入聚焦）、源文件夹区与取消、创建项目两个按钮。源文件夹为空时是虚线添加区与说明“添加可读取和编辑的文件夹”，经宿主的目录选择添加；可以添加多个，以列表显示名称与路径，保留“添加文件夹”入口，每行有移除按钮，主要文件夹带“主要”标记。非主要行 hover 或 focus 时，在移除按钮左侧显示“设为主要”，normal 时隐藏但保留位置；点击后主要标记转移。第一个添加的文件夹缺省为主要，移除主要文件夹时由下一个接替。名称非空且至少有一个文件夹时才能创建；同一项目里重复添加同一文件夹提示“已添加”、不新增行；无法访问的目录不能添加，并说明原因；项目名最多 50 个字符，可以重复。提交期间防止重复提交，失败时保留表单；取消、关闭或 Escape 时，表单有修改就先确认“放弃更改？”。主要文件夹已是另一个项目的主要文件夹时不新建：关闭弹窗，打开那个项目的新对话界面并在归属栏预选它，用 Toast 告知该文件夹属于哪个项目，表单内容不并入。归属栏项目菜单底部加入“新建项目”，复用本弹窗，创建成功后自动选中新项目。服务端按真实路径判断主要文件夹是否相同。

- 行为依据：[规格](../spec.md) PROJ-02 至 PROJ-07、PROJ-15（创建部分）、PROJ-16、PROJ-18（缺省与接替）、DEST-04、17.1 与 17.2 的项目服务；[ADR 0020](../../../docs/adr/0020-projects-organize-workspaces.md)。

**User stories:** 18、19、20、22（创建弹窗的放弃确认）

**Blocked by:** 06、12

**Status:** ready-for-agent

**Write scope:** apps/server 的项目创建与文件夹检查（真实路径判重、可访问性）；packages/protocol 的创建请求，以及区分“已创建 / 已存在”的结果；renderer 的项目表单与弹窗、项目分类的“+”、归属栏菜单的“新建项目”；i18n；projects.md 的创建项目与主要文件夹一节。

**跨票接口：** 项目表单组件支持创建与编辑两种模式，14 的编辑弹窗复用。弹窗的完成动作由调用方指定：项目分类入口为“打开新对话”，16 的“选择文件夹…”为“移动来源对话”；两种情形下命中已有项目都返回该项目。

- [ ] Sidecar 协议：创建多文件夹项目后读回名称、文件夹顺序与主要标记；主要文件夹已属于另一个项目时结果为“已存在”并带回该项目，不新增项目；同一目录经符号链接或不同写法（末尾斜杠、`..`）仍判为相同；无法访问的目录被拒绝并说明原因；名称超过 50 个字符被拒绝。
- [ ] Browser Mode：空状态与多文件夹列表；“设为主要”在 hover 与 focus 时出现，normal 时隐藏且不挤动内容，点击后标记转移，草稿中只有一个主要；移除主要文件夹后由下一个接替；重复添加提示“已添加”；取消目录选择不改变表单；有修改时的放弃确认（CW-11、CW-12、CW-67、CW-68）。
- [ ] Electron E2E：以另一个项目的主要文件夹创建，不新增项目，打开已有项目的新对话界面并出现 Toast（CW-59）；从归属栏“新建项目”创建后，归属栏选中新项目。
- [ ] projects.md 的相应一节；`check:docs` 通过。


## Comments

### 2026-11-03 实施与跨票接口

- 实施基线 `9f650408`。Sidecar 新增 `POST /api/projects`（`ProjectFields`，`CreateProjectResponse.status = created | existing`）与 `POST /api/projects/check-folder`；全部目录在服务端按 realpath、目录类型、R_OK/X_OK 检查，同项目真实路径去重，主要 Workspace 唯一约束裁决并发。已有结果不合并名称或附加目录。
- `features/projects/project-form.tsx` 导出 `ProjectFormDialog`，接受 `mode: create | edit`、`initial?: ProjectFields`、宿主 `pickDirectory`、可注入 `checkFolder`、`onSubmit: Promise<ProjectFormResult>`、`onComplete`、`onClose`；`ProjectFormResult` 兼容 created/existing 与 `{ status: updated, project }`。表单不创建或切换 Session，14 可复用编辑草稿；16 可用自定义完成动作移动来源会话。
- `ProjectDialogsProvider/useCreateProject` 在应用级持有创建请求，`useCreateProject()({ onComplete?: (project) => void })` 默认进入所选项目新对话，指定回调则把 created/existing 目标交回调用方。`projectApi.create/checkFolder` 为独立协议客户端，不扩展所有会话 API 夹具。`ListActions.upsertProject` 更新同一份项目/Workspace 引用；归属菜单底部入口只选择项目并保留新对话草稿。
- 对 01 存储的必要补充：它只有主要 Workspace 与有序附加目录，无法重建换主要目录后的完整顺序。本票增加 Project 自有 `primaryFolderIndex`（完整目录中的索引）；SQLite v11 追加列、旧记录默认 0，内存实现同步；不修改已应用的 v10。14 更新目录时应同时写 `additionalFolders`、`primaryFolderIndex` 与主要 Workspace。v10→v11 升级/备份/重启测试以及共享存储契约均覆盖。
- TDD：协议测试首次因缺少创建路由返回 404（预期 201）失败，补齐后通过。浏览器表单先因不存在的模块导入失败（0 tests，不计通过），随后实测空状态、唯一主要、重复与取消选择、保存失败和放弃确认。几何断言捕获了外框边框使 3 目录对话框变成 H434 的差异，改为 token inset ring 后达到画布 H432；动画中的 .95 缩放改为等待可观测最终几何，未放宽尺寸断言。
- `.pen` 经 Pencil MCP 读取 `docs/ui/双栏布局.pen` 的 WUwav、YD00b、C0pa1，未修改设计稿；空状态 W520/H360，3 目录 W520/H432，R28/P24，目录行 H56，“设为主要”H28/R8。真实浏览器图片 `.vitest/cw13-{light,dark}-{multi,narrow}.png` 与 `.vitest/cw13-light-empty.png` 已检查：390 CSS px 内错误/主要操作可达、完整路径可读，无横向溢出。Impeccable detector 返回 `[]`。
- 已有验证（合并最终集成前）：`pnpm run test apps/desktop/src/renderer/features/projects/project-form.browser.test.tsx apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx tests/integration/sidecar-create-project.test.ts tests/integration/sidecar-projects.test.ts packages/session/src/sqlite/migrate-v11.test.ts packages/session/src/sqlite/migrate-v10.test.ts packages/session/src/memory/memory.test.ts packages/session/src/sqlite/sqlite.test.ts packages/ui/src/guards/style-guard.test.ts`：10 files / 156 tests 通过；`pnpm run test apps/desktop/e2e/create-project.e2e.test.ts`：1 file / 1 test 通过（真实 Electron + Sidecar + 注入原生目录选择返回值；已有项目 Toast、新对话预选、归属菜单创建、首次发送归属）。`pnpm run typecheck`、受影响 TS/TSX 的 oxlint、`git diff --check` 均通过；`pnpm run check:docs`：246 Markdown / 0 问题。
- 文档事实归 `docs/subsystems/projects.md`，摘要同步 `docs/README.md` 与 ADR 0020 的当前实施范围；正式文档不反向依赖本票。将合并最新集成后读回文档并补最终验证，不在此时关闭。
