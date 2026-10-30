# 09: 定时任务界面与通知设置：Schedules tab、表单、投递历史、设置中的定时任务与通知分区

**What to build:** 见 [规格](../spec.md)"界面 · 定时任务与通知"：标题栏"定时任务"按钮、右栏 Schedules tab（列表、新建 / 编辑表单（一次 / 间隔 / cron，时区下拉与接下来 3 次时间）、暂停 / 恢复 / 删除、投递历史）、`schedule_fire` 紧凑行、设置 → 定时任务（全部会话）、设置 → 通知（总开关与三类开关，读写设置键 `notifications`）。

**User stories:** 16（设置）, 17

**Blocked by:** 05

**Status:** ready-for-agent

**Write scope:** renderer `features/conversation/{schedules-button（新）,schedule-fire-row}.tsx`、`header-actions.ts`（只改 schedules 一行）、`features/right-panel/{schedules-tab.tsx（新）,tabs.ts（只改 schedules 一行）}`、`features/settings/{schedules-section,notifications-section}.tsx`（新）、`settings/sections.ts`（只改 schedules、notifications 两行）、`stores/schedules-store.ts`（新）、`packages/i18n/src/dictionaries/domains/{schedules,notifications}.ts`、`packages/agent/src/tasks/schedules/`（只导出供 renderer 计算"接下来 3 次"的纯函数到 `@coko/agent/entries` 时，在 Comments 说明；否则改由 Sidecar 接口给出）、就近测试、`apps/desktop/e2e/schedules.e2e.test.ts`（新）、`docs/subsystems/schedules.md`（界面一节）、`docs/adr/0015-schedules-at-most-once-latest-catch-up.md`

- [x] browser：规则的本地化描述（after、at、every、cron）、下次时间与时区、状态与最近结果（started / 各 skipped 原因）；表单校验（every < 60 秒、at 在过去、cron 非法时行内错误）；cron 输入时显示接下来 3 次
- [x] browser：暂停 / 恢复 / 删除（确认框）；PATCH 的 revision 冲突提示并读回
- [x] E2E（测试时钟）：在会话中新建一个 cron 任务 → 列表显示下次时间 → `advanceClock` 后时间线出现 Run 与 `schedule_fire` 行、投递历史增加一条；暂停后推进时钟不投递
- [x] E2E：设置 → 定时任务列出全部会话的任务并可跳转；设置 → 通知关闭"定时任务结束"后推进时钟，日志中没有 `notification shown`（开启时有）
- [x] 界面验收：明暗主题、390 px 窗口、键盘可达；时区下拉缺省为本机时区
- [x] 秘密与符号链接：不新增通道与读取根（Comments 写明）
- [x] schedules.md 界面一节；ADR 0015 改 implemented（README 索引同步）；`check:docs` 通过

## Comments
- 2026-10-31 lead：接受越界修复 "fix(desktop): forward notify control messages to main"（sidecar-process.ts 控制消息 switch 加 case 'notify'）。这是票 05 留下的缺陷：main 上桌面通知从未显示——05 的单元测试直接调用 handleNotify、集成测试只看 Sidecar 侧的 notifyMessages，没有一个用例跨过控制通道；lead 合入 05 时也没有发现。本票的 schedules.e2e 在没有修复时 2/2 失败、修复后 2/2 通过，作为跨通道的回归用例。
- 2026-10-31 lead：运行全量 `pnpm run test` 前取得全量测试锁 `/tmp/coko-full-test.lock`（做法见 implementer-brief 的"全量测试锁"一节）；只跑单个文件不需要。之前多个 worktree 的全量互相重叠，负载到 20–40，真实进程与 Browser Mode 用例大面积超时。

- 2026-10-31 实施者（票 09）：
  - **覆盖的验收**（全部勾选）。browser：`features/right-panel/schedules-tab.browser.test.tsx`（16）——列表的 after / at / every / cron 描述、cron 的下次时间与时区（`Next Nov 2, 2026, 9:00 AM (UTC)`）、非 cron 注明本机时区、状态与最近结果（started、budget、worktree-removed、未执行；中文一例）；表单行内错误（间隔 0 与 1.5 分钟、一次性时刻在过去、cron `61 * * * *`、标题与指令为空），cron 输入时接下来 3 次、改时区为 UTC 后预览为 01:30Z；时区下拉缺省本机时区；暂停 / 恢复 / 删除（确认、取消不删）；行操作与编辑的 revision 冲突读回；编辑只发改动字段；投递历史；标题栏按钮（无任务隐藏、徽标只计 active、pendingOpen 只取一次）；投递行；明暗主题对比度 ≥ 4.5:1；390 px；键盘新建。`features/settings/schedules-notifications.browser.test.tsx`（6）——全部会话分组、暂停与删除、"打开会话"切会话并打开 Schedules tab、空状态；通知缺省全开、关闭"定时任务结束"写入设置键、总开关关闭时三类不可改、键盘、冲突读回不覆盖另一处写入、不合 schema 按缺省。`stores/schedules-store.test.ts`（5）。`packages/agent/src/entries/entries.test.ts`（+7：`upcomingOccurrences`，含 Asia/Shanghai 与 America/New_York 夏令时结束日取较早一次）。E2E `apps/desktop/e2e/schedules.e2e.test.ts`（2，真实 Electron + 测试时钟）：新建 cron → 下次时间 → 拨快后 Run、`schedule_fire` 行、历史 +1、通知一次；暂停后拨快一天不投递（同步点后 `lastOccurrence` 不变、历史仍 1）；390 px 真实窗口；设置跳转；关闭"定时任务结束"时该会话无 `notification shown`、重新开启后有。
  - **负向确认**。编辑冲突用例在修复前红（未改的 prompt 被读回值覆盖发送：先与读回值比较，改为与打开时的值比较）；导入守卫变异（cron.ts 加 `node:fs` 导入）红；去掉 `case 'notify'` 时 E2E 2/2 红；去掉冲突读回时 store 与 browser 冲突用例红。
  - **越出 Write scope 的最小改动**：(1) `apps/desktop/src/main/sidecar-process.ts` 加 `case 'notify'`（lead 已接受，见上一条）。(2) `packages/agent/src/entries/index.ts` 与 `entries.test.ts`：经 `@coko/agent/entries` 导出 `upcomingOccurrences`、`validateRule`、`ScheduleRuleError`、`CronError`、`isValidTimeZone`、`parseAt`、`SCHEDULE_MIN_EVERY_SECONDS`、`ScheduleRuleSpec`（票头允许的导出路径）；导入守卫增加登记的 entries/ 外纯模块 `tasks/schedules/{cron,rules}.ts`（其传递导入照样检查）。`upcomingOccurrences` 新增在 `tasks/schedules/rules.ts`。(3) `docs/tech-stack/architecture.md` 的 `@coko/agent/entries` 一句同步上述守卫（否则正文与守卫不符）。(4) 就近测试的注册表固定值：`features/settings/sections.browser.test.tsx`、`features/conversation/dock/dock.browser.test.tsx`（schedules / notifications 改为可用；合并 main 时与票 06 的 hooks 行取并集）。
  - **标题栏按钮的取舍**。规格写"定时任务按钮（active 数）"；始终显示时 390 px 的 `app.browser.test.tsx` 主区溢出 2 px（112 > 110），改为与后台任务按钮相同：会话有任务时显示，新建入口为右栏的 Schedules tab（始终可见）。conversation-pane 不在本票范围；之后再增加标题栏操作（agents、handoff）的票会遇到同样的宽度，需由 conversation-pane 的所有者处理。
  - **秘密与符号链接**：不适用。本票只在 renderer 读取已有接口（`/api/schedules`、设置键 `notifications`）与已入库条目，不新增协议字段、条目、日志、控制消息、system section 或读取根；title 与 prompt 的脱敏在票 05 的入库路径（`secrets-gate-schedules` 覆盖）。
  - **文档**：`docs/subsystems/schedules.md` 增加"界面"一节、结构入口与验证；ADR 0015 implementation → implemented 并补实施记录；`docs/adr/README.md` 索引同步；`docs/README.md` 当前行为一行补"通知设置、界面"（本票自己的一行）。`check:docs` 0 个问题。
  - **给 Lead**：(a) 时间线中定时任务的 user message 显示为原文 `<scheduled_task …>prompt</scheduled_task>` 气泡（截图确认）；可在 `timeline.ts`（只有 02 改）里像 `<job-notification>` 一样识别后只显示 prompt，留给后续。(b) main 的文件日志（logtape）按 8 KB 或"相隔 5 秒的下一条记录"写出，运行中轮询 `notificationsShown` 读不到；本票 E2E 在应用退出后读取。(c) `docs/subsystems/permissions.md:62` 与 `configuration.md:39` 仍写"定时任务尚未交付"，属其所有者的文档，本票未改。
  - **实际运行**（合并 main 409d3a5 之后，含票 06）：`pnpm run typecheck` 0、`pnpm run lint` 0（0 warnings）、`pnpm run format:check` 0、`pnpm run check:docs` 0（179 个文件 0 个问题）；`pnpm run test` test=0（287 个文件，2408 通过、1 跳过；开始时 load 6.6）。之前三次全量在其他 worktree 的全量同时运行（load 21–44）时各有 2–5 个超时失败，每次是不同的文件（worktrees.test.ts、sidecar-process.test.ts 的 inspectQuit、agent index.test.ts、cron 补跑封顶、模型目录与档位的 browser 用例），单独重跑均通过（33/33 ×2、99/99 ×2）；没有放宽断言或超时。E2E `schedules.e2e.test.ts` 单独 2/2。
  - **合并 main 107a39c（票 07、10）之后**：typecheck 0、lint 0、format:check 0、check:docs 0（181 个文件）；`pnpm run test`（取全量测试锁，pid 用 `$$`）test=1：302 个文件中 1 个失败，2496 通过、1 跳过。唯一失败为 `app/app.browser.test.tsx` 的"390px：无整页横向滚动"（app-frame-main scrollWidth 112 > clientWidth 110）。对照（整个文件运行）：handoff 按钮开时，schedules 开 4/4 失败、schedules 关 4/4 失败；handoff 关时，schedules 开 3/3 通过、schedules 关 3/3 通过。原因是票 10 始终显示的标题栏 handoff 按钮，不是本票；本票不改 handoff 的注册行与 conversation-pane。E2E `schedules.e2e.test.ts` 合并后 2/2。
  - **未验证**：真实系统通知的弹出与点击（测试构建只记日志）；真实模型；睡眠唤醒。
