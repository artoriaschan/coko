# 13: 团队界面：Team tab（名册、任务板、成员时间线）、标题栏按钮、消息与任务行、工具卡

**What to build:** 见 [规格](../spec.md)"Agent Teams"与 [grilling C9](../grilling.md#第-4-轮)：renderer `team-store`（`GET /api/sessions/:id/team` 与 `team_update`）、右栏 Team tab（注册表 `team` 一行改为可用）、标题栏"团队"按钮（running 成员数，`header-actions` 一行）、`team-message-row` 与 `team-task-row`（03 的空组件填实）、`send_message` / `task_*` 工具卡；成员时间线复用 Agents tab 的 TimelineView 并经 02 的 `subscribeSession` 订阅与释放。参考 DSH `client-ui-agent-team`。

**User stories:** 9

**Blocked by:** 06

**Status:** ready-for-agent

**Write scope:** renderer `features/right-panel/{team-tab.tsx,tabs.ts（只改 team 一行）}`、`features/conversation/{team-button.tsx,team-task-row.tsx,team-message-row.tsx,header-actions.ts（只改 team 一行）,tool-cards.tsx（只追加 team 分支）}`、`stores/team-store.ts`（新）、`packages/i18n/src/dictionaries/domains/teams.ts`、就近测试、`apps/desktop/e2e/teams.e2e.test.ts`（新）、`docs/subsystems/teams.md`（界面一节）、`docs/adr/0018-agent-teams-in-root-session.md`（改 implemented）、`docs/adr/README.md`（0018 一行）

**跨票接口：** 读取 06 写入的 `TeamSnapshot`、`team_task`、`team_message`（形状见规格，不改）；子 Session 订阅用 02 的 `subscribeSession(sessionId): () => void`，卸载时 release。

- [x] Browser Mode：名册的状态点与活动、任务板分组与"可认领"、重叠警告、阻塞关系；`team_message` 行显示发送方 → 接收方与 summary（不显示 `<team-message` 原文）；选中成员后订阅、切走后释放（订阅计数断言）
- [x] E2E（真实 Electron 与 Sidecar，faux）：lead 创建两个 teammate、建任务、各自认领与完成 → Team tab 实时显示名册与任务状态变化；标题栏按钮的 running 数；点成员看到其只读时间线；teammate 的审批在父会话输入区出现并可回答（复用 M5 冒泡）；明暗主题与键盘操作
- [x] teams.md 界面一节；ADR 0018 改 implemented（链接 06 与本票证据），README 索引同步；`check:docs` 通过

## Comments

### 实施回执（票 13，2026-11-01）

**覆盖的验收**

- Browser Mode：`features/right-panel/team-tab.browser.test.tsx`（4 例：注册表两行可用；名册的状态点、活动、用量与 worktree；任务板按 pending / in_progress / completed 分组、删除的不显示、owner、"可认领"、"等待 t1"；重叠警告与两项标记；`team_update` 实时替换；标题栏 running 数与无障碍名称；选中成员按 WebSocket subscribe / unsubscribe 计数断言订阅与释放：切到另一成员、关闭与卸载各释放一次；空状态与读取失败重试）。`features/conversation/team-rows.browser.test.tsx`（4 例：`team_message` 行发送方 → 接收方与 summary，`<team-message` 包装与正文不在 DOM 中，用户自己输入的同样文本照常成为气泡；`team_task` 行的创建 / 认领 / 更新 / 完成 / 删除；`send_message`、`task_*` 工具卡；中文文案）。`stores/team-store.test.ts`（4 例：读取与 `team_update` 替换、较早响应不覆盖、失败保留快照、订阅引用计数、HTTP schema 校验）。
- E2E：`apps/desktop/e2e/teams.e2e.test.ts`（真实 Electron + Sidecar，faux：lead 的回复按顺序、teammate 按 match）：lead 创建 alice、bob，建 t1 / t2，各发一条消息；Team tab 中两个任务变为 in_progress（owner 各自）；两人停在写入审批时标题栏 running 2；审批在父会话输入区出现（"来自子代理 general · <名字>"），逐个允许后 running 1 → 0、任务 completed、文件已写入；点 alice 看到只读时间线（lead → alice 的消息行与 summary，没有 `<team-message` 与 `ALICE-GO` 原文，write 工具卡，没有输入框，只有 alice 为 aria-current）；lead 时间线的任务行与两张 send_message 卡；明暗主题下名册次行、任务编号与任务行对比度 ≥ 4.5；键盘 Enter 选中名册成员、Tab 到关闭按钮、Enter 关闭。
- 文档：`docs/subsystems/teams.md` 增加"界面"一节（并更新 frontmatter description、开头一句、结构入口、已知限制与验证）；ADR 0018 改 implemented 并追加实施记录（链接本票证据，票 06 的记录保留在上一条）；`docs/adr/README.md` 0018 一行。`pnpm run check:docs` 通过。

**实际运行的命令与结果**

- `pnpm exec vitest run apps/desktop/src/renderer/stores/team-store.test.ts`：4 passed。
- `pnpm exec vitest run apps/desktop/src/renderer/features/right-panel/team-tab.browser.test.tsx`：4 passed；`…/team-rows.browser.test.tsx`：4 passed。
- `pnpm exec vitest run --project desktop-renderer`（合并 main 前）：38 files、236 passed。
- `pnpm exec vitest run apps/desktop/e2e/teams.e2e.test.ts`：修正后连续 5 次 passed，加 aria-current 断言后再 1 次 passed。
- `pnpm run typecheck`、`pnpm run check:docs`（215 个文件，0 个问题）：通过。
- 合并 main（ce7134d，票 08、12）后锁内全量 `pnpm run test`：372 files passed，2936 passed、4 skipped（evals 真实模型 3、settings.e2e 1，均为既有），`test=0`。

**负向确认**

- 先红：三个测试文件都在实现前运行并失败（模块或导出不存在；行组件为空时 `team-message` / `team-task` 为 0 行、工具卡标题为"Tool call"）。
- 变异：team-store 去掉版本比较 → "读取期间到达的 team_update 不被较早的响应覆盖"失败（`['alice']` ≠ `['alice','bob']`）；成员时间线的 effect 不返回 release → 订阅计数用例失败（unsubscribe 0 ≠ 1）。两处均已恢复。
- E2E 的不稳定先读实际值再修：(1) 两个 teammate 先各跑一轮"待命"，running 会短暂为 2 再回到 0，原来在这时断言无障碍名称会读到"Team"，改为在两人都认领、停在审批上之后断言；(2) 两个 teammate 并行派发，名册按 `agent_start` 提交顺序，alice / bob 谁在后不固定，原来固定聚焦 bob 时 Tab 会到 alice，改为聚焦名册最后一项。两处都是测试假设，界面行为未改。

**宿主注入的消息、秘密总闸与读取根**

- 本票只读取和渲染，不新增宿主注入的消息种类、输出通道或读取根：runAuthority 与 Goal 的用户输入判断不受影响（仍由票 06 的用例覆盖）。时间线一处由 team-rows 用例覆盖（包装按条目位置去掉，用户输入的同样文本照常显示）。不新增 `secrets-gate-*` 与符号链接用例。

**未验证**

- 390 px 窗口下的 Team tab 布局未单独断言（Agents tab 的 390 px 用例不覆盖它）。真实模型下的团队行为：未验证（需真实凭据）。非 darwin 平台：未验证。

**越出写范围的改动（请 Lead 裁决）**

- `apps/desktop/src/renderer/features/settings/sections.browser.test.tsx`：两条注册表断言从"team 不显示"改为显示，并把 team 加入可见 tab 与标题栏操作的列表（共同点，只动这几行）。
- `apps/desktop/src/renderer/features/conversation/dock/dock.browser.test.tsx`：注册表断言中 team 两行由 false 改为 true，应用中的 tab 列表加入 team。
- 提交 6d974c8 时这条 dock 断言仍是旧值（我的命令链没有在失败时停下），随后的 534a8e5 修正；之后的全量已通过。

**给 Lead / 票 14 的要点**

- 导航：`docs/subsystems/teams.md` 已在 `docs/README.md` 中，无需新增行。
- 导出：无新增共享导出。renderer 新文件 `stores/team-store.ts`；`team-button.tsx` 导出 `TeamStoreProvider`、`useTeamStoreApi`、`useTeam`、`useSessionTeam`、`MemberStatusDot`、`TeamButton`；`team-task-row.tsx` 导出 `taskChange`。
- 已知限制：teammate 同时出现在 Agents tab 与 Team tab；任务行只按快照判断动作，指派他人与改标题显示为"更新了任务"。

### Lead 合入（2026-11-01）

- 裁决：越出写范围的 `sections.browser.test.tsx`、`dock.browser.test.tsx`（team 改为可见的注册表断言）接受；`team-rows.browser.test.tsx` 是就近测试。E2E 早期的间歇失败来自用例假设（两个 teammate 首轮同时 running、名册顺序随并行启动变化），已改为等待可观察状态，修复后连续 6 次通过，接受。
- 实施者在合并 main（ce7134d）之后跑了锁内全量：`test=0`，372 个文件、2936 例通过、4 例跳过，没有 EAGAIN。报告末尾的 git-ai 后台进程有 4 个；lead 合入前复查只剩用户自己 HOME 的 1 个（59317），多出的 3 个是正常退出前的短暂进程。
- 以 331fa8a 合入 main，树与分支相同。合入后 `pnpm install --frozen-lockfile`、`typecheck`、`lint`、`format:check`、`check:docs` 退出 0；right-panel、conversation、sections、team-store、sidecar-teams 与 scripts 共 30 个文件、190 例通过。
- 未验证：390px 宽度下的 Team tab（留给票 14 的人工验证清单）、真实模型、非 darwin。

Closed: true
