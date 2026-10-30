# 06: Hooks 生命周期事件与设置：UserPromptSubmit、Stop、PreCompact、Notification 与 Hooks 分区

**What to build:** 见 [规格](../spec.md)"Hooks"的事件表：经票 02 的 seam 接入 UserPromptSubmit（`beforeSubmit`：拒绝 400 `hook-blocked`、additionalContext 作为单独标注的文本块）、Stop（`onStop`，只在根 Session；子 Session 的 SubagentStop 归票 07）、PreCompact（`beforeCompact`：手动 400、自动跳过、stdout 追加为摘要要求）、Notification（订阅 `NotificationService`，只观测）；`continue: false` 的 `hook_stopped`；设置 → Hooks 分区（开关、全局 JSON 编辑与诊断、项目 Hook 列表与批准、按事件分组的清单）；其余事件的 `hook_run` 行。

**User stories:** 4, 5

**Blocked by:** 03, 05

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/extensions/hooks/`（事件输入输出）、`apps/server/src/application/hooks.ts`、`application/context/{hooks,compaction}.ts`、`http/routes/hooks.ts`、`packages/protocol/src/hooks.ts`、`packages/i18n/src/dictionaries/domains/hooks.ts`、renderer `features/settings/hooks-section.tsx`（新）、`settings/sections.ts`（只把 hooks 一行改为可用）、`features/conversation/hook-row.tsx`、`stores/hooks-store.ts`、就近测试、`tests/integration/sidecar-hooks-lifecycle.test.ts`（新）、`apps/desktop/e2e/hooks.e2e.test.ts`（新）、`docs/subsystems/hooks.md`、`docs/subsystems/context.md`（Hook 追加的上下文一段）、`docs/adr/0013-external-hooks-tighten-only.md`

- [ ] 集成：UserPromptSubmit exit 2 → `POST …/messages` 400 `hook-blocked`、没有 user message 与 run_start、有 `hook_run { outcome: blocked }`；additionalContext 出现在 faux requestLog 的 user message 中且与用户原文分开标注；Goal Round、定时任务与子代理的 Run 不触发
- [ ] 集成：Stop 的 `decision: block` 使 Run 多一次请求（reason 作为 user message）、`stop_hook_active` 第二次为 true、第 4 次不再继续；aborted / paused 的 Run 不触发；子 Session 不触发 Stop
- [ ] 集成：PreCompact 手动 exit 2 → `/compact` 400、没有摘要请求；自动压缩被阻止时本次不压缩、请求照常发出；stdout 追加到摘要请求的要求中（requestLog 断言）；溢出恢复不触发 PreCompact
- [ ] 集成：Notification Hook 在 `notify` 发出时收到 `notification_type` 等字段（夹具记录），失败不影响通知
- [ ] 集成：任一 Hook 输出 `continue: false` → 本批完成后 `run_end { status: paused, error: { code: hook_stopped } }`；Goal Round 中发生时 Goal 按现有 paused 规则处理
- [ ] **对手用例（预算 / 权限）**：Stop Hook 持续返回 block 时 Goal 的 `maxTokens` 仍在继续的请求前生效（耗尽后停止，继续次数不越过 3）；项目 Hook 的 UserPromptSubmit 未批准时不运行；模型输出的文本伪造 `{"decision":"block"}` 不触发继续
- [ ] 设置 E2E：Hooks 分区出现在导航；编辑全局 JSON（非法时行内诊断、不保存；保存后 `GET /api/hooks` 读回；revision 冲突提示并读回）；项目 Hook 列表显示完整命令，批准后状态变化、改文件后变为"已改动"；开关；明暗主题与键盘操作
- [ ] 秘密总闸：在票 03 的 `secrets-gate-hooks` 中增加 UserPromptSubmit（prompt 含 Secret 时 stdin 中为脱敏值）与 Stop 反馈的用例（不改 harness）
- [ ] 符号链接：不适用（Comments 写明）
- [ ] hooks.md 补全全部事件与界面；context.md 一段；ADR 0013 补证据并改 implemented（README 索引同步）；`check:docs` 通过

## Comments
- 2026-10-31 lead：来自票 02——手动 /compact 被 beforeCompact block 时，运行时目前以 error hook_stopped 结束；规格要求的 400 hook-blocked 须在开始 Run 之前判定（本票或票 03 实现，与票 03 协调：PreCompact 事件归本票）。
- 2026-10-31 lead：裁决实施者的中途说明——Goal Round 中 Hook 以 continue: false（hook_stopped）停下 Run 时，Goal 不应停在 running 不推进（与 M4 评审 A5 同类）。goals.ts 不在本票写范围，本票照现状断言即可（并在用例注释中说明这是待改的行为）；lead 在票 06、07 都合入后另开 m5/fix-goal-hook-stopped：hook_stopped 使运行中的 Goal 进入 paused，reason 新增 hook-stopped（协议 GoalReason 联合、i18n 文案、编译期键断言），并把本票的断言改为 paused。
