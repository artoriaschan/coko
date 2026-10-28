# 02: 审批闭环：判定、审批请求与审批卡

**What to build:** 默认模式下的端到端审批：agent policy 的纯判定（此票模式固定为 default：Workspace 内读取放行；Workspace 外读取、write、edit、bash、未知工具询问；受保护路径写入询问）与 ApprovalBroker（pending → allowed / denied / cancelled，只答一次），经 `ToolHooks.beforeToolCall` 位于链首接入；工具契约增加 `effect` 与 `permissionSubject` 并为内置工具声明；`approval_request` / `approval_decision` 条目；拒绝无反馈结束 Run（aborted）、带反馈继续。server：`POST /api/sessions/:id/approvals/:requestId`、Session.activity 的 awaiting-approval、SessionService 扩展工厂 `extensions`（供 07 注册 checkpoint hook）。renderer：审批卡接管 composer（DSH ui-approval 交互），工具卡显示决定，侧栏徽标与上浮，重连后恢复待审批。新建 `docs/subsystems/permissions.md` 并登记导航。

**User stories:** 1, 2, 3, 4, 8（受保护路径）, 10, 11

**Blocked by:** 01

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/policy/`、`packages/agent/src/tools/types.ts`、`packages/agent/src/tools/builtin/`（只加 effect 与 permissionSubject 声明）、`packages/agent/src/extensions/`、`packages/agent/src/engine/`、`packages/agent/src/session-entries/permissions.ts`、`packages/protocol/src/permissions.ts`、`packages/protocol/src/runs.ts`、`apps/server/src/application/`、`apps/server/src/http/app.ts`、`apps/server/src/runtime/layers.ts`、`apps/server/README.md`、`apps/desktop/src/renderer/features/conversation/`、`apps/desktop/src/renderer/features/sidebar/`、`apps/desktop/src/renderer/stores/`、`packages/ui/src/`、`packages/i18n/src/dictionaries/`、`apps/desktop/e2e/`、`tests/integration/`、`docs/subsystems/permissions.md`、`docs/README.md`、`docs/DOCUMENTATION_SYSTEM.md`（仅登记 subsystems 目录，如尚未登记）、`docs/adr/0005-permission-mode-and-sandbox.md`、`docs/adr/README.md`

- [ ] agent 表驱动测试：判定顺序（拒绝前置项、Workspace 内外读取、受保护路径大小写变体、未知工具询问）
- [ ] 集成测试：bash 写文件 → 收到 `approval_request` 条目、activity 为 awaiting-approval、文件不存在；允许一次 → 文件写入、条目为 `approval_decision allowed once`；再次回答 409 `approval-not-pending`
- [ ] 集成测试：无反馈拒绝 → toolResult 为拒绝错误、Run 以 aborted 结束、文件不存在；带反馈拒绝 → 反馈出现在 toolResult 中、Run 继续到下一次模型请求
- [ ] 集成测试：同批两个需审批调用按调用顺序逐个出现；等待审批时 abort → 请求 cancelled、调用不执行
- [ ] 集成测试：等待审批时重新订阅（afterSeq 0）能看到 pending 请求；inspect-quit 把等待审批的 Run 计为 1
- [ ] Electron E2E：审批卡出现在 composer 位置，允许一次后工具卡完成并显示决定；拒绝带反馈后 Agent 继续；侧栏该会话带待审批徽标并位于组首
- [ ] Browser Mode：焦点在详情时 Enter 允许一次、Esc 拒绝；同一请求点击两次只发一次回答；输入法组合中不触发
- [ ] 产物 smoke：打包产物中一次审批允许
- [ ] 秘密总闸追加驱动：审批卡参数为 `env` 命令时仍无明文
- [ ] `docs/subsystems/permissions.md` 描述当前判定与审批契约并从导航可达；ADR 0005 implementation 改为 partial 并写明剩余项

## Comments
- 2026-10-29 lead：同意实施者提出的越界 1–6（protocol errors.ts 的 approval-not-pending、api.ts 的 sessionApproval 路径助手、renderer client/api.ts 的 answerApproval、chat-failure.ts 的 approval kind、fixture-chat.ts 桩、既有测试改为显式允许一次与 about.securityNote 文案）。

