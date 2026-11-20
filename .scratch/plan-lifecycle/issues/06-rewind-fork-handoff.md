# 06: 回退、分叉与交接中的计划阶段

**What to build:** 计划阶段跟着对话内容走。回退到进入规划之前，Session 不在规划中；回退到批准之前，Session 回到规划中，写入再次被拒。从规划中的 Session 分叉或交接出的新 Session 也在规划中。Permission Mode 现有的回退行为不改。见 [规格](../spec.md) 的“阶段一：协议与入口”中的分叉、交接与回退两条。

**User stories:** 35、36、37

**Blocked by:** 04

**Status:** ready-for-agent

Closed: true

- [x] 计划阶段与 `plan` 条目的状态按有效条目回放；回退后服务端重新计算，不沿用回退前的结果
- [x] 回退到进入规划之前的消息：计划接口读回“无”，下一个 Run 没有 `<plan_mode>` 与提交工具，写入按 Permission Mode 判定
- [x] 回退到批准之前的消息：读回“规划中”，写入被拒，提交工具可用，被回退掉的已批准记录不再算作当前计划
- [x] 桌面的计划阶段派生与服务端同口径：回退后 Plan chip 与计划卡的显示和协议读回一致
- [x] 分叉：两种边界下，边界处在规划中的新 Session 以规划中开始，不在规划中的不带；`plan` 条目不复制
- [x] 交接：源在规划中时目标 Session 在规划中
- [x] Permission Mode 的回退行为保持现状，用例中明确断言这一点
- [x] Sidecar 集成测试覆盖以上各项，沿用现有的回退、分叉与交接测试
- [x] 文档：Plan Mode 的状态节，以及回退、分叉与交接所属文档中的计划阶段说明；`pnpm run check:docs` 通过

## Comments

### 2026-11-20 实施完成（未关闭）

- **交付。** 服务端：`SessionPermissions` 的计划阶段改为 `planPhaseOf(entries)`（有效条目）回放，模式与 Session 规则仍按原始条目；新增 `rewound(sessionId)`：清掉该 Session 的待审阅记录 `#plans`，已缓存状态时在锁内重读条目、原地更新 `phase`（运行时闭包持有同一个状态对象）。`SessionCheckpoints` 新增必填依赖 `permissions`（`Pick<SessionPermissions, 'rewound'>`，`sessions.ts` 传入），`rewind` 在提交 `rewind` 条目之后、`runtimes.discard` 之前调用；纯代码回退不提交 `rewind`，不调用。agent：`forkEntries` 的阶段改为边界口径 `planPhaseOf(prefix)`（user-before 为边界前，assistant-inclusive 为到边界为止），删掉票 02 的过渡口径；`handoffTargetEntries` 不变（票 02 已按有效条目取源当前阶段），本票补测试。renderer 不改代码：Plan chip 自票 04 起用 `planPhaseOf`，Plan tab 与计划卡的 `planHistory` 用有效条目，与服务端同口径，本票补浏览器测试。
- **改断言的现有用例。** `tests/integration/sidecar-rewind.test.ts` 原“从早期助手分支仍继承源当前的规划阶段，不能绕过后续收紧”断言助手边界分支在源之后进入规划时新 Session 也在规划中（过渡口径）。设计稿 §10.2 改为边界口径，原断言与新行为矛盾：改为“助手边界分支继承源当前的 Permission Mode，不能绕过后续收紧；计划阶段取边界处”，源在边界之后进入规划并把模式收紧为 default，边界在规划之前的分支读回 none、没有 `plan_phase`、模式为 default、写入询问后拒绝且文件不存在；边界在规划中的分支读回 planning。`packages/agent/src/agents/fork.test.ts` 的“过渡口径与 permission_mode 相同”同理改为边界口径用例（两种边界、边界之后进入或退出规划）。
- **新增断言。** `sidecar-plan.test.ts` 两例：回退到 `/plan` 消息本身仍在规划中；回退到进入规划之前读回 none、Permission Mode 仍为回退区间内切换的 accept-edits（现状不变）、下一个 Run 没有 `<plan_mode>` 与 `exit_plan_mode`（faux `requestDetailsLog` 的工具表）、写入按 accept-edits 直接成功无审批；回退到批准所在 Run 的用户消息读回 `{ planning, plan: null }`、模式不变、写入为 T3 拒绝、`<plan_mode>` 为 T1、提交工具可用、下一次提交为同一 planId 的 revision 2（沿用回退后最后一条 rejected 的 revision 1 续号）。`sidecar-handoff.test.ts`：源在规划中时目标条目为 `handoff_origin`、`permission_mode`、`plan_phase`，读回 planning、模式 default。`handoff.test.ts`：进入规划被回退后不追加、退出规划被回退后追加。`plan.browser.test.tsx`：回退条目到达后 chip 与 Plan tab 按有效条目变化（回退到批准之前 chip 出现、Plan tab 回到 revision 1 rejected；回退到进入规划之前 chip 消失、没有计划）。
- **与设计稿的偏离。**
  1. 回退场景的 Sidecar 用例放在 `sidecar-plan.test.ts`（复用其 `<plan_mode>`、T3 文本与审阅辅助函数），`sidecar-rewind.test.ts` 只改助手边界分叉用例；设计稿的测试文件列两者都列出，未规定用例归属。
  2. `rewound` 不重新判定待审批请求：回退以没有 Run 为前置条件（`session-busy`），此时没有等待中的审批。
  3. `sidecar-state-update-fork.test.ts` 不改：票 06 的范围内没有计划相关的 State Update（票 09 才加入）。
  4. `docs/README.md` 中 Plan Mode 的导航摘要仍写着“plan 权限模式、/plan 与 prior”（票 02、04 遗留），本票按文档生命周期一并改为当前行为，并在交接摘要中加入计划阶段。
- **文档。** `docs/subsystems/plan-mode.md`：计划阶段的口径改为有效条目（服务端与 renderer 同用 `planPhaseOf`），新增“回退”条目，“分叉与交接”改为边界口径，description 与验证节同步；`docs/subsystems/handoff.md`：目标创建步骤 4 与“与从此分叉的差异”表加入计划阶段；`docs/README.md` 导航摘要。`pnpm run check:docs` 通过（436 个文件 0 个问题）。
- **验证。** 见下一节。


### 验证（2026-11-20）

- `pnpm run typecheck` 通过；`pnpm run check:docs` 通过（436 个文件 0 个问题）。
- 单元：`pnpm exec vitest run packages/agent/src/agents packages/agent/src/planning packages/agent/src/entries apps/server/src/application`：45 个文件 347 例通过。
- 集成（真实 Sidecar，darwin）：`pnpm exec vitest run tests/integration/{sidecar-plan,sidecar-rewind,sidecar-handoff,sidecar-state-update-fork,sidecar-permissions,secrets-gate-plan,sidecar-first-send,sidecar-goal}.test.ts`：8 个文件 56 例通过；使用回退接口的其余集成测试 `tests/integration/{secrets-gate,sidecar-compaction,sidecar-standalone-write-roots,sidecar-todo,sidecar-tool-search-boundaries,sidecar-tool-search-catalog,sidecar-worktrees}.test.ts`：7 个文件 37 例通过。
- renderer Browser Mode：`pnpm exec vitest run --project desktop-renderer apps/desktop/src/renderer/features/conversation/plan.browser.test.tsx`：16 例通过。
- 红灯确认：`fork.test.ts` 的边界口径用例与 `sidecar-plan.test.ts` 的两个回退用例在实现前失败（分别为过渡口径追加了 `plan_phase`、回退后读回仍为回退前的阶段）；`handoff.test.ts` 与浏览器用例为既有行为补测试，实现前即通过。
- 未运行：Electron E2E；非 darwin 平台；全量单元与 renderer 测试（改动未触及 renderer 代码）。

### 关闭（2026-11-20）

已合入集成分支 `feat/plan-lifecycle`（最终 HEAD ecfcbde8，含代码审查修复）。
