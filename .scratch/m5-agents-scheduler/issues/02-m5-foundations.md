# 02: M5 基础：条目与协议、迁移 v8、运行时与装配 seam、权限类、服务存根、UI 容器与测试 harness

**What to build:** 为后续票建立扩展点，自身不交付用户可见功能，见 [规格](../spec.md)"Session Entry 与事件""迁移 v8""运行时与装配 seam""共享装配点与所有者"：(1) 声明全部 M5 条目 kind 与 progress 事件（agent `session-entries/` 与 protocol 新领域文件），`run_start` v3、`approval_decision` v2，Fork 不复制新 kind；(2) 迁移 v8：`sessions.parent_session_id` / `worktree_id`、`worktrees`、`schedules` 表与 `recordFire` 事务、重建 `host_processes`（加 hook、git）；(3) 运行时 seam：新 trigger、摘要模式、`beforeCompact`、`onStop`（上限 3）、`hook_stopped` / `max_turns`；(4) 判定 seam：`decide` 返回来源步骤、gate 的 `PermissionHookPort`、权限类 `agent` 与 `automation`；(5) server：`ContextScope` / `ContextContribution` 的新字段与组合、`SessionCwd`、`PermissionScopeResolver`、子 Session 与 worktree 的创建参数与列表过滤、六个服务存根、四个贡献存根、五个空 router、`hook-runner` / `git` 存根、`clock`（含测试时钟与 `/api/test/clock`）、`layers.ts` 装配与关闭顺序、恢复钩子；`runAuthority` 对新 trigger 为 none、`goalUsage` 计入 `handoff.usage`；内置命令 `handoff` 占位；配置键 `hooks.enabled` / `agents.enabled` / `schedules.enabled`；(6) i18n 六个分域；(7) desktop：preload `onOpenSession`、main 的 `notify` 转交存根、注册表占位、时间线分发与空组件、`chat-store.subscribeSession`；(8) harness：测试时钟、faux `match`、git 夹具、Hook 夹具、总闸额外扫描目录、通知日志辅助。

**User stories:** 为 1–19 建立扩展点

**Blocked by:** 01

**Status:** ready-for-agent

**Write scope:** 规格"只有 02 改"中的全部文件；另 `packages/agent/src/policy/{decide,gate}.ts`、`packages/agent/src/goals/{state,budget}.ts`（runAuthority 与 handoff usage）、`packages/agent/src/extensions/hooks/`（新，类型与空 barrel；原 `extensions/hooks.ts` 移入并保留导出）、`packages/agent/src/agents/{definitions,tools,handoff}.ts`（新，类型）、`packages/agent/src/tasks/schedules/`（新，类型）、`packages/protocol/src/{hooks,agents,schedules,worktrees,handoff}.ts`（新）、`apps/server/src/application/{session-runs,session-permissions,permissions}.ts`、`application/{hooks,subagents,schedules,worktrees,handoff,notifications}.ts`（新，存根）、`application/context/{hooks,subagents,schedules,handoff}.ts`（新，空贡献）、`http/routes/{hooks,agents,schedules,worktrees,handoff,test-clock}.ts`（新）、`adapters/{hook-runner,git,clock}.ts`（新）、`apps/desktop/src/main/notifications.ts`（新，存根）、renderer `features/right-panel/tabs.ts`、`features/conversation/{header-actions.ts,conversation-pane.tsx,hook-row,agent-notification-row,schedule-fire-row,handoff-row}`（后四个新，空组件）、`features/settings/sections.ts`、`packages/i18n/src/dictionaries/domains/{hooks,agents,schedules,worktrees,handoff,notifications}.ts`（新）、`tests/integration/sidecar-m5-seams.test.ts`（新）、`tests/fixtures/{hooks,git}/`（新）、`docs/subsystems/{permissions,configuration,recovery}.md`（新权限类、配置键、迁移版本号）、`docs/adr/{0003,0012}*.md`、`docs/tech-stack/architecture.md`、`packages/{session,agent}/README.md`、`apps/server/README.md`

- [ ] 01 合入后的全部测试只改 kind 列表、schema 版本或导入路径即通过（逐条写入 Comments）
- [ ] 条目：protocol 与 agent 的新 kind 编译期比对（`entry-payloads.ts` 的 `Assert<Equal>`）；`run_start` v2 → v3、`approval_decision` v1 → v2 读回；renderer 收到新 kind 不报错、不渲染（chat-store 测试）；`forkEntries` 不复制新 kind（表驱动）
- [ ] 迁移 v8：v7 库升级到 8（`.backup-v7-*` 0600、STRICT、原数据与 host_processes 行可读）；`worktrees` / `schedules` 仓库契约测试在 SQLite 与内存实现上通过；`recordFire` 在事务中途抛错时表行与条目都不变（先红）；`listSessions` 不含子 Session
- [ ] 运行时（agent 测试，deferred 控制交叠）：`onStop` 返回 continue 时再请求一次、第 4 次被忽略；`beforeCompact` 的 block 使自动压缩跳过、溢出恢复不调用；摘要模式只发一次无工具的请求并经 `beforeRequest`；`stopAfterBatch(hook_stopped)` 的 run_end
- [ ] 判定：`decide.test.ts` 每个步骤返回正确的 `step`；`agent` 类在五种模式放行、`automation` 只在 full-access 放行、deny 规则生效；gate 没有 `PermissionHookPort` 时行为与 01 之后相同
- [ ] `runAuthority`：trigger schedule / subagent / handoff 为 none（表驱动）；`goalUsage` 计入同一 Goal Run 的 `handoff.usage`
- [ ] `sidecar-m5-seams.test.ts`：空贡献时 faux requestLog 与 01 之后相同；测试贡献的 `beforeSubmit` reject 得到 400、context 出现在 user message 中；`onStop` 测试贡献使 Run 多一次请求；`/handoff` 实现前 400；关闭顺序（定时器 → Run → Job → 贡献 → 登记进程 → 存储）由钩子调用顺序断言；`POST /api/test/clock` 只在测试构建注册（`--packaged` 时 404）
- [ ] harness 自测：faux `match` 在两个并行 Session 中各取到自己的回复；git 夹具的 Sidecar 中 `git config user.email` 为夹具值且没有读真实 `~/.gitconfig`；Hook 夹具记录 stdin 并按参数退出；总闸扫描额外目录后做一次负向确认
- [ ] i18n：新域 zh / en 键集合相同；注册表占位不显示（Browser Mode 断言）
- [ ] 文档：permissions.md 两个新权限类、configuration.md 三个开关、recovery.md 版本 8、ADR 0003 记 v8 表、ADR 0012 记 hook / git 类别、architecture.md 与 README 同步；`check:docs` 通过

## Comments
