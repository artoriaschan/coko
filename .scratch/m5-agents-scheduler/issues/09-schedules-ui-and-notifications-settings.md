# 09: 定时任务界面与通知设置：Schedules tab、表单、投递历史、设置中的定时任务与通知分区

**What to build:** 见 [规格](../spec.md)"界面 · 定时任务与通知"：标题栏"定时任务"按钮、右栏 Schedules tab（列表、新建 / 编辑表单（一次 / 间隔 / cron，时区下拉与接下来 3 次时间）、暂停 / 恢复 / 删除、投递历史）、`schedule_fire` 紧凑行、设置 → 定时任务（全部会话）、设置 → 通知（总开关与三类开关，读写设置键 `notifications`）。

**User stories:** 16（设置）, 17

**Blocked by:** 05

**Status:** ready-for-agent

**Write scope:** renderer `features/conversation/{schedules-button（新）,schedule-fire-row}.tsx`、`header-actions.ts`（只改 schedules 一行）、`features/right-panel/{schedules-tab.tsx（新）,tabs.ts（只改 schedules 一行）}`、`features/settings/{schedules-section,notifications-section}.tsx`（新）、`settings/sections.ts`（只改 schedules、notifications 两行）、`stores/schedules-store.ts`（新）、`packages/i18n/src/dictionaries/domains/{schedules,notifications}.ts`、`packages/agent/src/tasks/schedules/`（只导出供 renderer 计算"接下来 3 次"的纯函数到 `@coko/agent/entries` 时，在 Comments 说明；否则改由 Sidecar 接口给出）、就近测试、`apps/desktop/e2e/schedules.e2e.test.ts`（新）、`docs/subsystems/schedules.md`（界面一节）、`docs/adr/0015-schedules-at-most-once-latest-catch-up.md`

- [ ] browser：规则的本地化描述（after、at、every、cron）、下次时间与时区、状态与最近结果（started / 各 skipped 原因）；表单校验（every < 60 秒、at 在过去、cron 非法时行内错误）；cron 输入时显示接下来 3 次
- [ ] browser：暂停 / 恢复 / 删除（确认框）；PATCH 的 revision 冲突提示并读回
- [ ] E2E（测试时钟）：在会话中新建一个 cron 任务 → 列表显示下次时间 → `advanceClock` 后时间线出现 Run 与 `schedule_fire` 行、投递历史增加一条；暂停后推进时钟不投递
- [ ] E2E：设置 → 定时任务列出全部会话的任务并可跳转；设置 → 通知关闭"定时任务结束"后推进时钟，日志中没有 `notification shown`（开启时有）
- [ ] 界面验收：明暗主题、390 px 窗口、键盘可达；时区下拉缺省为本机时区
- [ ] 秘密与符号链接：不新增通道与读取根（Comments 写明）
- [ ] schedules.md 界面一节；ADR 0015 改 implemented（README 索引同步）；`check:docs` 通过

## Comments
- 2026-10-31 lead：接受越界修复 "fix(desktop): forward notify control messages to main"（sidecar-process.ts 控制消息 switch 加 case 'notify'）。这是票 05 留下的缺陷：main 上桌面通知从未显示——05 的单元测试直接调用 handleNotify、集成测试只看 Sidecar 侧的 notifyMessages，没有一个用例跨过控制通道；lead 合入 05 时也没有发现。本票的 schedules.e2e 在没有修复时 2/2 失败、修复后 2/2 通过，作为跨通道的回归用例。
