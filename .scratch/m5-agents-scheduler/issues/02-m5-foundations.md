# 02: M5 基础：条目与协议、迁移 v8、运行时与装配 seam、权限类、服务存根、UI 容器与测试 harness

**What to build:** 为后续票建立扩展点，自身不交付用户可见功能，见 [规格](../spec.md)"Session Entry 与事件""迁移 v8""运行时与装配 seam""共享装配点与所有者"：(1) 声明全部 M5 条目 kind 与 progress 事件（agent `session-entries/` 与 protocol 新领域文件），`run_start` v3、`approval_decision` v2，Fork 不复制新 kind；(2) 迁移 v8：`sessions.parent_session_id` / `worktree_id`、`worktrees`、`schedules` 表与 `recordFire` 事务、重建 `host_processes`（加 hook、git）；(3) 运行时 seam：新 trigger、摘要模式、`beforeCompact`、`onStop`（上限 3）、`hook_stopped` / `max_turns`；(4) 判定 seam：`decide` 返回来源步骤、gate 的 `PermissionHookPort`、权限类 `agent` 与 `automation`；(5) server：`ContextScope` / `ContextContribution` 的新字段与组合、`SessionCwd`、`PermissionScopeResolver`、子 Session 与 worktree 的创建参数与列表过滤、六个服务存根、四个贡献存根、五个空 router、`hook-runner` / `git` 存根、`clock`（含测试时钟与 `/api/test/clock`）、`layers.ts` 装配与关闭顺序、恢复钩子；`runAuthority` 对新 trigger 为 none、`goalUsage` 计入 `handoff.usage`；内置命令 `handoff` 占位；配置键 `hooks.enabled` / `agents.enabled` / `schedules.enabled`；(6) i18n 六个分域；(7) desktop：preload `onOpenSession`、main 的 `notify` 转交存根、注册表占位、时间线分发与空组件、`chat-store.subscribeSession`；(8) harness：测试时钟、faux `match`、git 夹具、Hook 夹具、总闸额外扫描目录、通知日志辅助。

**User stories:** 为 1–19 建立扩展点

**Blocked by:** 01

**Status:** ready-for-agent

**Write scope:** 规格"只有 02 改"中的全部文件；另 `packages/agent/src/policy/{decide,gate}.ts`、`packages/agent/src/goals/{state,budget}.ts`（runAuthority 与 handoff usage）、`packages/agent/src/extensions/hooks/`（新，类型与空 barrel；原 `extensions/hooks.ts` 移入并保留导出）、`packages/agent/src/agents/{definitions,tools,handoff}.ts`（新，类型）、`packages/agent/src/tasks/schedules/`（新，类型）、`packages/protocol/src/{hooks,agents,schedules,worktrees,handoff}.ts`（新）、`apps/server/src/application/{session-runs,session-permissions,permissions}.ts`、`application/{hooks,subagents,schedules,worktrees,handoff,notifications}.ts`（新，存根）、`application/context/{hooks,subagents,schedules,handoff}.ts`（新，空贡献）、`http/routes/{hooks,agents,schedules,worktrees,handoff,test-clock}.ts`（新）、`adapters/{hook-runner,git,clock}.ts`（新）、`apps/desktop/src/main/notifications.ts`（新，存根）、renderer `features/right-panel/tabs.ts`、`features/conversation/{header-actions.ts,conversation-pane.tsx,hook-row,agent-notification-row,schedule-fire-row,handoff-row}`（后四个新，空组件）、`features/settings/sections.ts`、`packages/i18n/src/dictionaries/domains/{hooks,agents,schedules,worktrees,handoff,notifications}.ts`（新）、`tests/integration/sidecar-m5-seams.test.ts`（新）、`tests/fixtures/{hooks,git}/`（新）、`docs/subsystems/{permissions,configuration,recovery}.md`（新权限类、配置键、迁移版本号）、`docs/adr/{0003,0012}*.md`、`docs/tech-stack/architecture.md`、`packages/{session,agent}/README.md`、`apps/server/README.md`

- [x] 01 合入后的全部测试只改 kind 列表、schema 版本或导入路径即通过（逐条写入 Comments）
- [x] 条目：protocol 与 agent 的新 kind 编译期比对（`entry-payloads.ts` 的 `Assert<Equal>`）；`run_start` v2 → v3、`approval_decision` v1 → v2 读回；renderer 收到新 kind 不报错、不渲染（chat-store 测试）；`forkEntries` 不复制新 kind（表驱动）
- [x] 迁移 v8：v7 库升级到 8（`.backup-v7-*` 0600、STRICT、原数据与 host_processes 行可读）；`worktrees` / `schedules` 仓库契约测试在 SQLite 与内存实现上通过；`recordFire` 在事务中途抛错时表行与条目都不变（先红）；`listSessions` 不含子 Session
- [x] 运行时（agent 测试，deferred 控制交叠）：`onStop` 返回 continue 时再请求一次、第 4 次被忽略；`beforeCompact` 的 block 使自动压缩跳过、溢出恢复不调用；摘要模式只发一次无工具的请求并经 `beforeRequest`；`stopAfterBatch(hook_stopped)` 的 run_end
- [x] 判定：`decide.test.ts` 每个步骤返回正确的 `step`；`agent` 类在五种模式放行、`automation` 只在 full-access 放行、deny 规则生效；gate 没有 `PermissionHookPort` 时行为与 01 之后相同
- [x] `runAuthority`：trigger schedule / subagent / handoff 为 none（表驱动）；`goalUsage` 计入同一 Goal Run 的 `handoff.usage`
- [x] `sidecar-m5-seams.test.ts`：空贡献时 faux requestLog 与 01 之后相同；测试贡献的 `beforeSubmit` reject 得到 400、context 出现在 user message 中；`onStop` 测试贡献使 Run 多一次请求；`/handoff` 实现前 400；关闭顺序（定时器 → Run → Job → 贡献 → 登记进程 → 存储）由钩子调用顺序断言；`POST /api/test/clock` 只在测试构建注册（`--packaged` 时 404）
- [x] harness 自测：faux `match` 在两个并行 Session 中各取到自己的回复；git 夹具的 Sidecar 中 `git config user.email` 为夹具值且没有读真实 `~/.gitconfig`；Hook 夹具记录 stdin 并按参数退出；总闸扫描额外目录后做一次负向确认
- [x] i18n：新域 zh / en 键集合相同；注册表占位不显示（Browser Mode 断言）
- [x] 文档：permissions.md 两个新权限类、configuration.md 三个开关、recovery.md 版本 8、ADR 0003 记 v8 表、ADR 0012 记 hook / git 类别、architecture.md 与 README 同步；`check:docs` 通过

## Comments

### 实施者（票 02）

**提交（m5/02-m5-foundations）：** e25dd76 条目 / 协议 / 配置开关；876664b 迁移 v8 与仓库；9abecc3 运行时 seam；b10ca1d 判定步骤、权限类、runAuthority、handoff usage；6b55d83 server seam、存根、时钟与 desktop；4cbc19e sidecar-m5-seams 与 harness；d31f0af 文档。

**逐项：**

- 已有测试只改了 kind 列表、schema 版本或导入路径，全部通过：
  - `agent/session-entries.test.ts`、`protocol/entries.test.ts`：kind 列表加 8 个 M5 kind。
  - `agent/config/merge.test.ts`（新增一例）、`instructions/shared/shared.test.ts`、`desktop/stores/config-store.test.ts`：默认能力配置增加 hooks / agents / schedules 三个键。
  - `session/sqlite/migrate-v4.test.ts`、`migrate-v5.test.ts`：toEqual 的 Session 增加 `parentSessionId: null`、`worktreeId: null`；`migrate-v7.test.ts` 与 `tests/integration/sidecar-recovery.test.ts`：版本 7 → 8。
  - `tests/integration/sidecar-commands.test.ts`：内置命令列表增加 handoff。
  - `tests/integration/sidecar-config.test.ts`：有效能力配置增加三个开关键。
  - `apps/desktop/e2e/desktop-shell.e2e.test.ts`：bridge 的键列表增加 `onOpenSession`（规格要求的 preload 接口；仍只有受控的方法，不暴露令牌）。
  - `apps/desktop/src/renderer/features/conversation/dock/dock.browser.test.tsx`：注册表列表增加 M5 的占位行（available: false）。
  - `tests/integration/sidecar-m4-seams.test.ts`：关闭顺序断言改为只比 M4 的四步的相对顺序（新顺序在 sidecar-m5-seams 中完整断言）。
  - `agent/extensions/hooks.ts` 移到 `extensions/hooks/tool-hooks.ts`，导入路径改为 `extensions/hooks/index.ts`，包入口导出不变。
- 条目：两侧新领域文件 `{hooks,agents,schedules,handoff}.ts`，`entry-payloads.ts` 的 `Assert<Equal>` 未改即通过（kind 与 payload 编译期一致）；run_start v2 → v3、approval_decision v1 → v2 原样迁移（session-entries.test.ts 的版本用例）；renderer：chat-store.test 新增"新 kind 通过信任边界、时间线只给出空组件的分发项"；fork.test 的表加入 8 个 M5 kind。
- 迁移 v8：`migrate-v8.test.ts`（备份 0600、STRICT、Session / 条目 / host_processes 行原样、hook / git 可登记、foreign_key_check 为空）；契约测试新增 7 例（子 Session、worktree ×2、schedules、recordFire ×2、hook/git 类别）在 SQLite 与内存实现上通过；`recordFire` 先红（方法不存在），并做了变异：把任务行更新放到单独的事务里，两例 recordFire 测试失败，已还原。
- 运行时：`engine/m5-seams.test.ts` 14 例（deferred 控制交叠，不用 sleep）。变异：去掉继续上限检查 → "第 4 次被忽略"失败；溢出恢复也调用 beforeCompact → "溢出恢复不调用"失败；均已还原。摘要模式的工具清空经系统消息的 toolsRemoved 声明，之后的请求恢复工具、对话记录中不留系统消息（已断言）。
- 判定：`decide.test.ts` 新增步骤表（11 行）与 M5 权限类 4 例；`decide` 的返回形状不变（新函数 `decideWithStep` 返回 `{ decision, step }`，`decide` 取其 decision），因此已有 61 处断言未改。gate 没有 PermissionHookPort 时行为不变：policy 与 engine 的全部已有测试未改即通过；运行时总是装一个转交端口，没有贡献时返回空结论，gate 目前不调用它（组合表由票 03 实现）。
- runAuthority：表驱动新增 4 行（含对手用例：定时任务 prompt 中写 `/goal resume`、Run 中送达"create a goal"都仍为 none，改动前为 user，先红）；goalUsage 计入 handoff.usage（先红；变异：去掉 handoff 分支 → 失败）。
- sidecar-m5-seams.test.ts：M5 装配 6 例 + harness 自测 4 例（见下）。测试贡献在 `adapters/m5-test-seams.ts`（COKO_TEST_TOOLS=1 时装配，按文本标记触发）。
- harness：faux `match`（两个并行 Session，提交顺序与脚本顺序相反）；`tests/fixtures/git/` 的 `createGitWorkspace()`（Sidecar 中 bash 的 `git config --show-origin user.email` 为 `file:.git/config` 的夹具值，HOME 为夹具 HOME）；`tests/fixtures/hooks/hook.mjs`（--record、--exit、--stdout、--stderr、--sleep、--ignore-term；忽略 SIGTERM 后 SIGKILL 结束，只终止本测试启动的进程，连跑 3 次通过）；`persisted(dirs, { extraDirs })`（负向确认：不给额外目录时不报告，给出时报告 `hooks/stdin.jsonl`）；`advanceClock` / `setClock`、`notifyMessages`、`hookCommand`；desktop E2E 的 `notificationsShown(dir)`（读 desktop.jsonl 的 `notification shown`）。
- i18n：六个新域，`domains.test.ts` 的键集合用例未改即通过；注册表占位：`sections.browser.test.tsx` 新增一例（设置菜单不含 agents / schedules / notifications，setSection 回到常规；右栏 tab 与标题栏操作只有已交付的项）。
- 文档：permissions.md（两个权限类、M5 的 context-read / session-state 工具、判定步骤与 Hook 端口）、configuration.md（三个开关；hooks.enabled 只在全局）、recovery.md（M5 恢复钩子、版本 8）、ADR 0003（v8 表）、ADR 0012（hook / git 类别）、architecture.md（M5 服务与关闭顺序）、三个 README；`pnpm run check:docs` 0 问题。

**设计说明（Lead 请过目）：**

- 关闭顺序在日志中记为 `timers → runs → jobs → contributions → processes → storage`（HTTP 先于这些停止，HttpLive 的 release 不记 step）。
- 测试时钟只在 `config.testClock && !config.packaged` 时开启：源码运行（集成测试）为测试构建；`--packaged` 即使在测试构建中也不挂载（按验收"--packaged 时 404"）。COKO_TEST_CLOCK 属于 `COKO_TEST_*`，打包的发布构建已按既有规则忽略。
- 摘要模式不提交 user / assistant 消息（源 Session 不变）；usage 在 `RunResult.summaryUsage`，由票 10 写进 handoff 条目。
- 手动 `/compact` 被 beforeCompact block 时运行时以 error `hook_stopped` 结束；规格要求的 400 `hook-blocked` 需要票 03/06 在开始 Run 前先跑 PreCompact（或据此 code 映射）。
- `onStop` 第 4 次仍被调用（宿主据 `continuations` 记 warn），其 continue 被忽略。
- 建议规则：agent 类建议 `Agent(<类型>)` 而不是整组 `Agent`（更窄）。
- `/handoff` 以内置命令登记、动作占位抛 400 `bad-request`，所以它出现在命令目录中（sidecar-commands 的列表因此加了一项）。票 10 实现时替换动作即可。
- `filterTools` 经 `layeredTools.allow()` 过滤基础与贡献的工具；没有领域过滤时不限（与之前相同）。
- 能力开关的设置界面没有新增开关（不属于本票）。

**越出 Write scope 的改动（请裁决）：**

- `packages/protocol/src/config.ts`：能力配置的三个开关（server 的 `CapabilityConfigsAgree` / `ProjectValuesAgree` 编译期比对要求两侧一致）。
- `packages/agent/src/config/merge.ts`（03 的文件）：`hooks` 为只在全局的分区（`GLOBAL_ONLY_SECTIONS`），项目文件的 `hooks.enabled` 以 project-cannot-grant 忽略、事件键不报 unknown-key。票 03 解析项目 Hook 时在此基础上扩展。
- `apps/server/src/application/errors.ts`：新错误码的状态映射（编译期 Record 要求）；StoreError `invalid-input` 映射为 400 bad-request（此前落到 500）。
- `apps/server/src/config.ts`：`COKO_TEST_CLOCK`（testClock）。
- `apps/server/src/adapters/m5-test-seams.ts`（新，测试贡献）与 `apps/server/src/adapters/clock.test.ts`、`application/permission-scope.test.ts`、`packages/agent/src/engine/m5-seams.test.ts`、`packages/session/src/sqlite/migrate-v8.test.ts`（就近测试）。
- `apps/desktop/src/shared/bridge.ts`（IPC.openSession 与 `CokoBridge.onOpenSession` 类型；preload 只实现它）、`apps/desktop/src/renderer/main.tsx`（一行 `bindOpenSession`）与 `renderer/app/open-session.ts`（`app/` 内）。
- 已有测试的上述改动（见第一项）。

**对手用例：** runAuthority 的定时任务 / 子 Session / 交接 Run 中送达的文本（含伪造的 `/goal resume`）不授予权限（先红）；判定步骤让票 03 区分"Hook 的放行不能越过第 2–4 步"；`agent` 带 isolation 的调用只有 full-access 放行。新读取根或注入点：本票没有（`<hook-context>` 的文本来自测试贡献的固定文本；真实注入由 03/06 的 secrets-gate 用例覆盖）；新输出通道 `notify`：NotificationService 发出前按值脱敏，`secrets-gate-notifications.test.ts` 随实际发出通知的票（05/09）添加。

**需要 Lead 合并时处理：** 没有新的导航行；协议的新导出经 `index.ts` 的 `export *`（agents、handoff、hooks、schedules、worktrees）。

**未验证：** 真实模型（无凭据）；Electron 中点击真实桌面通知（测试构建只记日志，显示与点击由 05 接入）；睡眠唤醒。

