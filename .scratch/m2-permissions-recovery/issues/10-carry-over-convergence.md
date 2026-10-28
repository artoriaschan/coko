# 10: 遗留项：Provider kind 映射、挂起请求超时与模态框中的 Toast

**What to build:** 地图 Carry-overs 中标 M2 的三项。(1) 评审 B1：Provider kind 与协议映射收敛到 agent 一处（`PROVIDER_KINDS`、`protocolOf(kind)`），server PROTOCOL 表、credentials KIND_ENV、renderer KINDS 改为引用它或协议 schema，protocol 的 ProviderKind 与 agent 类型之间加编译期等价断言。(2) 评审 B3：按 requestId 挂起并带超时的 4 处写法收敛为一个 `createRequestTracker()`（放 `packages/protocol/src/control.ts`，运行时无关），逐处保留原语义（拒绝 / 返回失败结果 / 断开时清理），Sidecar 退出时挂起的 credential.store 立即以 sidecar-unavailable 结束（评审 B11 第三项）。(3) M1 票 08：设置等模态框打开时 Toast 的动作可用键盘到达。

**User stories:** 32, 33

**Blocked by:** 05

**Status:** ready-for-agent

**Write scope:** `packages/protocol/src/http.ts`（ProviderKind）、`packages/protocol/src/control.ts`、`packages/agent/src/models/`、`packages/agent/src/index.ts`（只改 models 导出行）、`apps/server/src/application/providers.ts`、`apps/server/src/adapters/credentials.ts`、`apps/server/src/runtime/main.ts`、`apps/desktop/src/main/credentials.ts`、`apps/desktop/src/main/sidecar-process.ts`、`apps/desktop/src/renderer/features/settings/models-section.tsx`、`apps/desktop/src/renderer/app/app.tsx`、`packages/ui/src/components/sonner.tsx`、`packages/ui/src/components/dialog.tsx`

- [ ] 新增一种测试 kind 只需改 agent 一处（编译期断言在不一致时报错：临时引入不一致确认 tsc 失败，再撤销）
- [ ] 既有 Provider、凭据与设置的集成测试与 E2E 继续通过
- [ ] request tracker 单元测试：超时、按 id 结果、断开时全部以给定错误结束；main 侧 Sidecar 退出时挂起的 credential.store 立即结束（不等 10 秒）
- [ ] Browser Mode 或 E2E：设置弹窗打开时触发带动作的 Toast，Tab 能到达动作按钮并用 Enter 触发；关闭弹窗后焦点回到原位置
- [ ] 不修改 i18n 字典与对话区文件（若必须改，停下在 Comments 说明）
- [ ] 地图 Carry-overs 对应三条可勾除

## Comments
