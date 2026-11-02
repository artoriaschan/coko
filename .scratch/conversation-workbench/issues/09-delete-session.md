# 09: 删除对话

**What to build:** 会话菜单的分隔线下加入危险色的“删除对话”。从更多菜单或右键菜单点它，先关闭菜单、打开模态确认弹窗：标题“要删除对话吗？”，说明“此操作将永久删除该对话及其子智能体对话，且无法撤销。”，右上关闭、中性的“取消”与浅危险色底面的“删除”。初始焦点在取消；取消、关闭或 Escape 保留目标及其子智能体对话，并恢复触发上下文。确认后永久删除目标 Session、它的子智能体 Session 与绑定的定时任务；保留绑定的 worktree 记录与独立对话的专属目录，不删除项目源目录与用户工作文件。目标有进行中的 Run、子代理或运行中的后台任务时，删除失败，弹窗说明原因，数据保留。所有入口绑定同一个目标身份，不因后续 hover 改变；提交期间防止重复操作，失败不提前显示成功。成功后从普通列表、项目列表与置顶中同步移除；删除的是当前打开的对话时回到新对话入口（11 合入前为现有的新会话草稿）。

- 行为依据：[规格](../spec.md) CHAT-13 至 CHAT-15、第 14 节“删除对话被拒绝”、17.1 删除、13.1 的删除对话确认行（W480/H184/R28）。

**User stories:** 32、33（删除部分）

**Blocked by:** 08

**Status:** ready-for-agent

**Write scope:** apps/server 的会话删除（在一个事务中删除会话、子会话、它们的条目与相关记录、绑定的定时任务）与拒绝判断；packages/session 的删除操作；packages/protocol 的删除请求与拒绝错误；renderer 的确认弹窗、菜单项与列表同步；i18n；projects.md 的删除一节。

**跨票接口：** 确认弹窗与删除操作供 10 的已归档列表、22 的搜索结果复用。会话忙碌的拒绝沿用现有 `worktree-busy` 的形式：新的错误码 `session-busy`，details 为 `{ reasons, sessions }`，reasons 取 run、agent、job、schedule，sessions 列出涉及会话的 id 与标题。10 的归档与 20 的切换分支使用同一个错误码；09 与 20 谁先合入谁定义，另一张沿用。

- [x] Sidecar 协议：删除后会话、子会话、它们的条目与绑定的定时任务都不存在，worktree 记录与专属目录保留；有进行中的 Run、子代理或运行中的 Job 时返回 `session-busy` 且原因可区分，数据不变。
- [x] Browser Mode：弹窗文案与几何、初始焦点在取消；取消、关闭与 Escape 不删除并恢复上下文；提交期间不能重复确认；失败时保留数据并显示原因；成功后从各列表移除；删除当前对话后回到新对话（CW-56 至 CW-58、CW-73 的会话部分）。
- [x] Electron E2E：删除一个带子智能体对话的会话后重启，列表中没有它，项目源目录中的文件不变。
- [x] projects.md 的删除一节；`check:docs` 通过。


## Comments

### 2026-11-03 实施与验收

- 已实现 `DELETE /api/sessions/:id` → `{ sessionIds: string[] }`。沿用 11 的 `SessionRepository.deleteSession` 单次事务；根、所有层级子会话、条目、定时任务与 host_processes 登记一起删除，Workspace、worktree、目录、用户文件和记忆不删除。SQLite 故障触发器在根记录删除时抛错，证明之前已删除的子记录/条目/定时任务全部回滚。
- 准入先于 busy 检查登记删除屏障；`SessionRuns.busy(id)` 同时覆盖异步 submit/start、runtime 和 onRunEnd 收尾，子创建、回退与分叉的异步窗口也被排斥。Run / agent / running 或 stopping Job 分别拒绝。删除前按 Session → Schedule 的既有锁序等待本树投递，不等待无关定时任务；等待已结束 Job 尾部写入后才提交删除。成功清理 runtime/status、permissions/plan/recovery、Job、Goal watch、subagent live/notification/isolation-rule、Schedule watch/suspended/run 缓存。失败释放屏障，未修改目标数据。
- 全部列表共用同一数据；删除响应后移除已删除身份、内容与订阅，当前会话转新对话。列表 tombstone 阻止删除之前开始的 refresh 和迟到的 upsert 恢复已删除行。非当前删除保持当前打开内容。
- 弹窗按固定 sessionId 工作，复用共享 Dialog/Button；先关菜单、取消初始焦点、取消/关闭/Escape 恢复来源焦点，pending 防重且不能退出，失败保留并显示涉及会话标题和 Run/agent/job 原因。中英文文案、W480/H184/R28、padding24、标题20/28、按钮H36/R12，以及390px与明暗主题均经真实 Browser Mode 检查。
- 新危险项引入0.5px分隔线后暴露 Popper 对 fractional menu height 的取整；RowMenu 避让预留9px，保证至少8px窗口边距，没有放宽原边界断言。保留08 eb40aa7的延迟resize修复，并只在来源行实际移动时响应scroll。

### 跨票接口与合入

- `@coko/protocol` 导出 `SessionBusyReason` / `SessionBusyDetails` schema 与 type：`{ reasons: ('run' | 'agent' | 'job' | 'schedule')[], sessions: { id: string; title: string }[] }`。09仅因实际进行中工作拒绝，启用但尚未投递的schedule可一并删除；旧rewind/fork的`session-busy`允许没有details，保持兼容。10/20复用这个错误形状。
- `SessionDeleteDialog`：`apps/desktop/src/renderer/features/sidebar/session-delete-dialog.tsx`，props为 `{ sessionId, open, onOpenChange, onCloseAutoFocus? }`；10归档列表、22搜索保持目标身份后直接复用。删除操作为 `ChatStore.getState().deleteSession(id): Promise<void>`，失败抛出ApiError，成功更新所有普通/项目/置顶列表与当前内容；`ListStore.removeSessions(ids)` 维护删除标记。
- `SessionService.assertAdmission(id): void` 检查删除屏障；`SessionRuns.useAdmission((id) => void)` 已由SessionService构造时接线，其他票不可覆盖它。`SessionRuns.busy(id)` 可复用为 busy 事实。20的目录切换需要独立目录屏障，在最终同步launch前按解析后的cwd检查，不能只封锁切换前已有session id。`useLifecycle({ runningJobs, quiesce, forget })` 仅是删除领域的装配接口，`forget` 为同步内存清理。
- 18后续标题请求必须自行使用存在性/条件写入边界：Session删除后不得再追加model_request或写标题；仅停止Run仍不得取消标题。该独立请求尚未由本票实现，不把Run忙碌等同于标题请求。
- 已将当前integration `eb40aa7` 合入本分支，保留12的`startDraft/resumeDraft/selectProject`与19的images参数/校验；解决SessionRow、chat-store、SessionRuns.submit和docs/README的加法冲突，没有回退图片与归属行为。

### Red → Green 与最终检查

测试边界沿用规格第18节预授权：公开仓库接口、SessionService并发准入、真实Sidecar协议、Browser Mode、真实Electron。

- Red：新增Sidecar删除用例先因未实现DELETE而404；新增Browser确认用例先因没有“Delete conversation”菜单项超时；新增stale refresh回归先观察到删除后列表被旧响应恢复。均修复后通过。
- `rtk pnpm exec vitest run apps/desktop/src/renderer/features/sidebar/session-menu.browser.test.tsx apps/desktop/src/renderer/stores/chat-store-delete.test.ts apps/server/src/application/session-delete.test.ts tests/integration/sidecar-delete-session.test.ts tests/integration/sidecar-first-send.test.ts tests/integration/sidecar-images.test.ts`：6文件、34用例通过（Browser18、删除store2、并发2、Sidecar删除4，以及首次发送/图片8）。
- `rtk pnpm exec vitest run packages/session/src/memory/memory.test.ts packages/session/src/sqlite/sqlite.test.ts apps/desktop/src/renderer/stores/chat-store-delete.test.ts packages/ui/src/guards/style-guard.test.ts apps/desktop/src/renderer/stores/chat-store.test.ts apps/desktop/src/renderer/stores/chat-store-rewind.test.ts tests/integration/sidecar-schedules.test.ts tests/integration/sidecar-subagents-cancel.test.ts`：8文件、162用例通过；仓库实现单独完整运行2文件80用例通过，含多层级删除、无关会话保留及SQLite故障回滚。
- `rtk pnpm exec vitest run apps/desktop/src/renderer/stores/chat-store-delete.test.ts packages/ui/src/guards/style-guard.test.ts apps/desktop/src/renderer/app/app.browser.test.tsx`：3文件68用例通过，覆盖收尾缓存与完整工作台导航。
- `rtk pnpm exec vitest run apps/desktop/e2e/session-delete.e2e.test.ts`：1文件1用例通过。真实Electron、真实Sidecar、faux父Run真实派发子智能体；先证实子Session200，再由当前父会话的右键菜单确认删除，UI进入新对话；重启后父/子协议都404、列表为空、源文件逐字节不变。globalSetup构建本次main/preload/renderer/sidecar产物，使用默认后台Electron。
- `rtk pnpm run typecheck`：通过。`rtk pnpm run check:docs`：246份Markdown、0问题。改动文件oxlint、oxfmt及`git diff --check`通过；Impeccable detector对两个变更业务UI文件返回空数组。
- Browser截图：`.vitest/cw09-delete-zh-{light,dark}.png` 与 `.vitest/cw09-delete-zh-{light,dark}-390.png`；已人工读回light桌面和dark390截图，标题/说明/关闭/取消/浅危险删除均完整且无溢出。该目录为本地验证产物。
- 文档归属：原地更新`docs/subsystems/projects.md`删除一节与原菜单描述，`docs/README.md`摘要同步；从AGENTS→导航→正文读回，路径/语义/归属/引用方向/生命周期/当前入口/历史保留通过，无正式文档反向依赖具体scratch文件。
- 保存状态：本地提交，不推送。未运行全仓测试、真实Provider、CI、发布构建/跨平台矩阵；本票要求的Sidecar、Browser和真实Electron范围均已执行，无验收缺口。

Closed: true
