# 06: Hooks 生命周期事件与设置：UserPromptSubmit、Stop、PreCompact、Notification 与 Hooks 分区

**What to build:** 见 [规格](../spec.md)"Hooks"的事件表：经票 02 的 seam 接入 UserPromptSubmit（`beforeSubmit`：拒绝 400 `hook-blocked`、additionalContext 作为单独标注的文本块）、Stop（`onStop`，只在根 Session；子 Session 的 SubagentStop 归票 07）、PreCompact（`beforeCompact`：手动 400、自动跳过、stdout 追加为摘要要求）、Notification（订阅 `NotificationService`，只观测）；`continue: false` 的 `hook_stopped`；设置 → Hooks 分区（开关、全局 JSON 编辑与诊断、项目 Hook 列表与批准、按事件分组的清单）；其余事件的 `hook_run` 行。

**User stories:** 4, 5

**Blocked by:** 03, 05

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/extensions/hooks/`（事件输入输出）、`apps/server/src/application/hooks.ts`、`application/context/{hooks,compaction}.ts`、`http/routes/hooks.ts`、`packages/protocol/src/hooks.ts`、`packages/i18n/src/dictionaries/domains/hooks.ts`、renderer `features/settings/hooks-section.tsx`（新）、`settings/sections.ts`（只把 hooks 一行改为可用）、`features/conversation/hook-row.tsx`、`stores/hooks-store.ts`、就近测试、`tests/integration/sidecar-hooks-lifecycle.test.ts`（新）、`apps/desktop/e2e/hooks.e2e.test.ts`（新）、`docs/subsystems/hooks.md`、`docs/subsystems/context.md`（Hook 追加的上下文一段）、`docs/adr/0013-external-hooks-tighten-only.md`

- [x] 集成：UserPromptSubmit exit 2 → `POST …/messages` 400 `hook-blocked`、没有 user message 与 run_start、有 `hook_run { outcome: blocked }`；additionalContext 出现在 faux requestLog 的 user message 中且与用户原文分开标注；Goal Round、定时任务与子代理的 Run 不触发
- [x] 集成：Stop 的 `decision: block` 使 Run 多一次请求（reason 作为 user message）、`stop_hook_active` 第二次为 true、第 4 次不再继续；aborted / paused 的 Run 不触发；子 Session 不触发 Stop
- [x] 集成：PreCompact 手动 exit 2 → `/compact` 400、没有摘要请求；自动压缩被阻止时本次不压缩、请求照常发出；stdout 追加到摘要请求的要求中（requestLog 断言）；溢出恢复不触发 PreCompact
- [x] 集成：Notification Hook 在 `notify` 发出时收到 `notification_type` 等字段（夹具记录），失败不影响通知
- [x] 集成：任一 Hook 输出 `continue: false` → 本批完成后 `run_end { status: paused, error: { code: hook_stopped } }`；Goal Round 中发生时 Goal 按现有 paused 规则处理
- [x] **对手用例（预算 / 权限）**：Stop Hook 持续返回 block 时 Goal 的 `maxTokens` 仍在继续的请求前生效（耗尽后停止，继续次数不越过 3）；项目 Hook 的 UserPromptSubmit 未批准时不运行；模型输出的文本伪造 `{"decision":"block"}` 不触发继续
- [x] 设置 E2E：Hooks 分区出现在导航；编辑全局 JSON（非法时行内诊断、不保存；保存后 `GET /api/hooks` 读回；revision 冲突提示并读回）；项目 Hook 列表显示完整命令，批准后状态变化、改文件后变为"已改动"；开关；明暗主题与键盘操作
- [x] 秘密总闸：在票 03 的 `secrets-gate-hooks` 中增加 UserPromptSubmit（prompt 含 Secret 时 stdin 中为脱敏值）与 Stop 反馈的用例（不改 harness）
- [x] 符号链接：不适用（Comments 写明）
- [x] hooks.md 补全全部事件与界面；context.md 一段；ADR 0013 补证据并改 implemented（README 索引同步）；`check:docs` 通过

## Comments
- 2026-10-31 lead：来自票 02——手动 /compact 被 beforeCompact block 时，运行时目前以 error hook_stopped 结束；规格要求的 400 hook-blocked 须在开始 Run 之前判定（本票或票 03 实现，与票 03 协调：PreCompact 事件归本票）。
- 2026-10-31 lead：裁决实施者的中途说明——Goal Round 中 Hook 以 continue: false（hook_stopped）停下 Run 时，Goal 不应停在 running 不推进（与 M4 评审 A5 同类）。goals.ts 不在本票写范围，本票照现状断言即可（并在用例注释中说明这是待改的行为）；lead 在票 06、07 都合入后另开 m5/fix-goal-hook-stopped：hook_stopped 使运行中的 Goal 进入 paused，reason 新增 hook-stopped（协议 GoalReason 联合、i18n 文案、编译期键断言），并把本票的断言改为 paused。
- 2026-10-31 lead：来自票 09——main 进程的文件日志（logtape rotating file sink）按 8 KB 或"相隔 5 秒的下一条记录"写出，运行中轮询 harness 的 notificationsShown（或其他读 desktop.jsonl 的辅助）读不到刚记的行。断言桌面通知或 main 日志时，在应用退出（dispose 写出缓冲）之后读取，或等待界面可观察状态；不要靠加长等待。另：main 上的桌面通知转发由票 09 修复，合入前在你的分支上看不到通知是这个原因。
- 2026-10-31 implementer（票 06 完成）：
  - 覆盖：全部 10 项验收。集成 `tests/integration/sidecar-hooks-lifecycle.test.ts`（9 个用例：UserPromptSubmit ×2、Stop ×2、continue: false、PreCompact ×3、Notification）；`apps/server/src/application/hooks.test.ts`（子 Session 不运行 Stop 与 UserPromptSubmit）；`secrets-gate-hooks.test.ts` 新增一个用例（UserPromptSubmit stdin、`<hook-context>`、Stop 反馈；harness 未改）；renderer `hooks-section.browser.test.tsx`（3）、`hook-row.browser.test.tsx`（+1）、`timeline.test.ts`（+1）、`hooks-store.test.ts`（+1）、`sections.browser.test.tsx`（hooks 进入导航后更新）；E2E `apps/desktop/e2e/hooks.e2e.test.ts`。
  - 设计要点：手动 PreCompact 在 `/compact` 动作中、开始 Run 之前运行（400 hook-blocked，stdout 并入 instructions），运行时的 beforeCompact 只处理 auto，因此不再出现 02 记录的 error hook_stopped。UserPromptSubmit 的 continue: false 记为待停止，Run 在第一次请求前经 beforeRequest 停下。Stop 的继续文本为 `Stop hook feedback:\n<原因>`。项目 Hook 的批准改存 `{ digest, hookId }`（旧的字符串照常读），据此给出 `changed: true`；`GET /api/hooks` 另接受 `?workspaceId=`（新会话草稿）。Notification 的 exit 2 / stdout 不产生结论，只记失败。
  - 命令与结果：合并 main（a203b29）之后 `pnpm install --frozen-lockfile`=0、`pnpm run typecheck`=0、`pnpm run lint`=0（787 文件 0 问题）、`pnpm run format:check`=0、`pnpm run check:docs`=0（179 文件 0 问题）、`pnpm run test`=0（283 文件，2369 通过、1 跳过）。E2E `vitest run --config vitest.e2e.config.ts e2e/hooks.e2e.test.ts` 1 通过。
  - 负向确认：去掉 hooks 贡献的 beforeSubmit / onStop / 自动 beforeCompact 后，生命周期集成用例 5 个失败（UPS ×2、Stop ×2、自动 PreCompact），恢复后全过。浏览器用例先红：已批准状态用 `text-success` 时浅色主题对比度 2.28，改为 `text-success-text`。先红的集成：Goal 耗尽后定时任务被准入以 budget 跳过——调整用例顺序（不是实现问题）。
  - 未验证：子代理的 Run 不触发 UserPromptSubmit / Stop 只有单元级证据（parentSessionId 守卫），子 Session 的集成随票 07；真实模型未跑（无凭据）；桌面通知在 main 侧的显示不在本票（Notification Hook 只断言 Sidecar 侧的 notify 消息与 Hook 记录）。
  - 符号链接：不适用。本票没有新增读取根：项目 Hook 仍读已有的 `<cwd>/.coko/settings.json`（与项目设置同一文件），全局配置在设置键中。新增的注入点（`<hook-context>`、Stop 反馈、PreCompact 的摘要要求）由秘密总闸覆盖。
  - 越出 Write scope 的最小改动：`apps/server/src/runtime/layers.ts`（AppLive 中 `hooks.bind(...)` 与 `notifications.observe(...)`，约 9 行；HookService 需要 SessionService 创建之后的停止 Run、权限模式与作用域）；`apps/server/src/application/notifications.ts`（`observe()`，Notification Hook 订阅）；`apps/desktop/src/renderer/features/conversation/timeline.ts`（用户气泡不显示 `<hook-context>` 块，与 `<job-notification>` 同法）；`docs/subsystems/configuration.md` 一句（hooks.enabled 的开关已在 Hooks 分区）；`docs/README.md` hooks 一行的摘要更新；`apps/server/src/http/routes/hooks.ts` 在范围内。
  - Goal 与 hook_stopped：按 lead 裁决照现状断言 running（用例注释注明待改），留给 m5/fix-goal-hook-stopped。
  - 导出 / README 要点（交给票 08 汇总）：server README——HookService 的生命周期事件与 `bind(HookSessionHost)`、`NotificationService.observe`；agent README——`interpretHookResult` 对 Notification 只记失败。
