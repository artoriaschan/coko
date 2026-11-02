# 15: 删除项目并保留对话

**What to build:** 项目菜单分隔线下加入危险色的“删除项目”。点击后先关闭菜单，打开模态确认弹窗：标题“删除项目？”，说明“项目会从列表中移除，正在运行的对话会被停止。对话记录会保留，移到「对话」下；项目文件夹里的文件不会被删除。”；右上关闭、无描边且使用 muted 色的“取消”与浅红底红字的“删除”。首次焦点在取消；取消、关闭与 Escape 不改变数据，并把焦点还给触发入口。确认后先停止项目中进行中的 Run 及其子代理，全部停止后，在一个事务中清空成员会话的归属并删除项目；任一停止失败就不删除项目，已停止的执行不自动重启，界面说明原因并允许重试；提交期间防止重复确认。后台任务与定时任务随会话保留、不被停止。会话、子智能体记录、源文件夹、工作文件、绑定的 worktree，以及按 Workspace 保存的记忆与批准都保留。成功后，列表、置顶中的项目引用、搜索结果与归属栏同步；当前打开的对话继续保留，归属显示为“对话”；新对话草稿选择了该项目时清空这个选择。

- 行为依据：[规格](../spec.md) PROJ-19、第 14 节“删除项目停止或移除失败”、17.1 与 17.2 的删除项目、13.1 的删除项目确认行（W480/H208/R28）；[ADR 0022](../../../docs/adr/0022-project-removal-preserves-sessions.md)。

**User stories:** 27

**Blocked by:** 14

**Status:** ready-for-agent

**Closed:** true

**Write scope:** apps/server 的项目删除（先停止，再在一个事务中移除）；packages/protocol；renderer 的确认弹窗、菜单项与同步；i18n；projects.md 的删除项目一节。

- [x] Sidecar 协议：删除有对话的项目后，会话保留、归属为空，子会话的父子关系不变，源文件夹与 worktree 目录不变；有进行中的 Run 时先停止再删除；停止失败时（夹具的构造方式在 Comments 说明）项目保留并返回原因；运行中的后台任务随会话继续。
- [x] Browser Mode：弹窗文案与几何、首次焦点在取消；取消、关闭与 Escape 无副作用；提交期间不能重复确认；删除当前对话所在的项目后，对话内容保留、归属显示“对话”；新对话草稿中该项目的选择被清空（CW-72、CW-73 的项目部分、CW-86、CW-87）。
- [x] Electron E2E：删除一个有对话的项目，原有对话出现在“对话”分类，打开后能继续对话。
- [x] ADR 0022 的 implementation 改为 implemented 并链接正式实现/测试证据（遵守正式文档不反向依赖本票的边界），ADR 索引同步；projects.md 的相应一节；`check:docs` 通过。

## Comments

2026-11-03 实施记录：

- 使用规格第18节已确认的 Sidecar HTTP/WS、Browser Mode 和真实 Electron 公共边界。Red：`pnpm run test tests/integration/sidecar-delete-project.test.ts` 首次1例在 DELETE 项目返回404处失败；浏览器首例在缺少“删除项目”菜单项处失败。随后完成服务、确认和状态同步。
- SessionService 在项目删除开始时阻止归属变更，等待已开始的创建/移动/分叉；锁住成员及全部后代的新 Run/子会话。SessionRuns 等待准备、abort 及包含领域 onRunEnd 的完成 Promise，所有目标都结束后才调用 ProjectRepository 原子清空归属/删除，不复用 deleteSession。
- 显式保留子代理 isolation worktree：项目快照期间保护自然结束的子代理，取消期间保护全部目标，晚到的取消在超时之后仍保留目录。后台子代理也会停止；Job、Schedule、记忆、批准、父子关系、Workspace/工作目录及独立置顶保留。
- 停止失败夹具位于 faux 模型适配器：`abortDelayMs` 模拟 Provider 延迟确认取消，`abortLog` 观察真实 AbortSignal，使用 COKO_TEST_CLOCK 拨过10秒停止期限；没有绕过应用服务的测试HTTP成功/失败后门。协议例验证部分已停止的 Run 不自动重启、项目与归属保留、创建/移入/移出/新 Run 被拒绝、锁释放后可重试。真实 Job 经 fs.watch 等待释放文件，项目删除后再写文件与输出；Schedule 继续触发；Workspace 的真实批准规则和记忆读回不变。
- 确认宿主在项目行之外持有原身份，项目重排/置顶不会卸载或换目标；处理中禁止重复确认/取消/关闭/Escape，失败原因保留并可重试。成功仅补丁 projectId，不覆盖生成标题、图片附件或置顶状态；当前会话及内容保留，新草稿只清除失效项目及 Git 选择。旧列表响应不能恢复已删项目。
- 已执行：Sidecar文件3例通过；Browser文件3例通过；`pnpm run test apps/desktop/e2e/project-delete.e2e.test.ts` 真实Electron1例通过，包含原身份跨原生重启继续发送和源文件保留。扩展回归（session-delete、subagents-cancel、subagents-isolation、first-send及本票）5文件16例通过；Browser列表/项目行/会话菜单及样式守卫5文件78例通过。精确最终命令与合并验证结果在收尾时补记。
- `.vitest/cw15-delete-project.png`、`cw15-project-{light,dark}.png` 和 `cw15-project-{light,dark}-error-390.png` 已实际读图；普通中文480×208/R28、24px、首次取消焦点，明暗主题与390px失败/重试可达。Impeccable detector对修改UI返回`[]`。
- 正式文档证据链接当前实现和测试，不反向依赖本票；ADR0022与索引同步，projects.md与docs/README同步。文档检查246个Markdown文件0问题；typecheck通过。

2026-11-03 最终合并与验证：

- 已合并当前集成提交411cb244（含17权限根快照、21首次发送worktree和10归档），保留两侧的准入、完成等待和归档只读检查。删除项目同步清空`archivedSessions`，保护`loadArchived`/普通load/upsert/patch中的删除项目墓碑；Sidecar另验证已归档成员的归档时间和worktree绑定跨重启不变。
- 新的归档回归负向验证：临时撤掉removeProject的archivedSessions清理，运行`pnpm run test apps/desktop/src/renderer/features/sidebar/project-delete.browser.test.tsx -t 'deleted project references stay cleared'`，选中1例按预期失败（原projectId未清空），3例跳过；恢复后以下最终组全部通过，未保留临时违规代码。
- `pnpm run test tests/integration/sidecar-delete-project.test.ts tests/integration/sidecar-archive-session.test.ts tests/integration/sidecar-project-permissions.test.ts tests/integration/sidecar-first-send-worktree.test.ts tests/integration/sidecar-subagents-cancel.test.ts tests/integration/sidecar-subagents-isolation.test.ts tests/integration/sidecar-first-send.test.ts apps/server/src/application/session-delete.test.ts apps/server/src/application/session-archive.test.ts apps/desktop/src/renderer/stores/chat-store-archive.test.ts`：10文件42例通过，0跳过。
- `pnpm run test apps/desktop/src/renderer/features/sidebar/project-delete.browser.test.tsx apps/desktop/src/renderer/features/settings/archived.browser.test.tsx apps/desktop/src/renderer/features/sidebar/project-row.browser.test.tsx apps/desktop/src/renderer/features/sidebar/session-menu.browser.test.tsx apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx packages/ui/src/guards/style-guard.test.ts`：6文件82例通过，0跳过；本票4例包括晚到普通/归档列表、DTO、标题更新，不重新引入已删项目。
- `pnpm run test apps/desktop/e2e/project-delete.e2e.test.ts apps/desktop/e2e/session-archive.e2e.test.ts`：真实Electron2文件2例通过，0跳过。项目删除例核对当前内容、详情归属显示“对话”、原身份跨应用重启继续发送、源文件逐字不变。
- `pnpm run typecheck`退出0；修改源文件与测试的oxlint退出0；`git diff --check`退出0。`pnpm run check:docs`检查247个Markdown文件0问题。
- 文档读回：AGENTS → docs/README → projects.md删除项目一节 → ADR0022及ADR索引；路径/引用、语义同步、归属与权威、引用方向、生命周期、当前入口、新会话读入、历史保留均通过。保留ADR0020被局部替代的历史；无正式文档依赖具体scratch材料。
- 仅本地分支提交；没有push或PR。真实模型需凭据，未运行；不把本票的选定回归报告为全仓或发布产物矩阵。
