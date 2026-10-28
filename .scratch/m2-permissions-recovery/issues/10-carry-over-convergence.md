# 10: 遗留项：Provider kind 映射、挂起请求超时与模态框中的 Toast

**What to build:** 地图 Carry-overs 中标 M2 的三项。(1) 评审 B1：Provider kind 与协议映射收敛到 agent 一处（`PROVIDER_KINDS`、`protocolOf(kind)`），server PROTOCOL 表、credentials KIND_ENV、renderer KINDS 改为引用它或协议 schema，protocol 的 ProviderKind 与 agent 类型之间加编译期等价断言。(2) 评审 B3：按 requestId 挂起并带超时的 4 处写法收敛为一个 `createRequestTracker()`（放 `packages/protocol/src/control.ts`，运行时无关），逐处保留原语义（拒绝 / 返回失败结果 / 断开时清理），Sidecar 退出时挂起的 credential.store 立即以 sidecar-unavailable 结束（评审 B11 第三项）。(3) M1 票 08：设置等模态框打开时 Toast 的动作可用键盘到达。

**User stories:** 32, 33

**Blocked by:** 05

**Status:** ready-for-agent

**Write scope:** `packages/protocol/src/http.ts`（ProviderKind）、`packages/protocol/src/control.ts`、`packages/agent/src/models/`、`packages/agent/src/index.ts`（只改 models 导出行）、`apps/server/src/application/providers.ts`、`apps/server/src/adapters/credentials.ts`、`apps/server/src/runtime/main.ts`、`apps/desktop/src/main/credentials.ts`、`apps/desktop/src/main/sidecar-process.ts`、`apps/desktop/src/renderer/features/settings/models-section.tsx`、`apps/desktop/src/renderer/app/app.tsx`、`packages/ui/src/components/sonner.tsx`、`packages/ui/src/components/dialog.tsx`

- [x] 新增一种测试 kind 只需改 agent 一处（编译期断言在不一致时报错：临时引入不一致确认 tsc 失败，再撤销）
- [x] 既有 Provider、凭据与设置的集成测试与 E2E 继续通过
- [x] request tracker 单元测试：超时、按 id 结果、断开时全部以给定错误结束；main 侧 Sidecar 退出时挂起的 credential.store 立即结束（不等 10 秒）
- [x] Browser Mode 或 E2E：设置弹窗打开时触发带动作的 Toast，Tab 能到达动作按钮并用 Enter 触发；关闭弹窗后焦点回到原位置
- [x] 不修改 i18n 字典与对话区文件（若必须改，停下在 Comments 说明）
- [x] 地图 Carry-overs 对应三条可勾除

## Comments

- 2026-10-29 implementer（分支 m2/10-carry-over-convergence）：

  **覆盖的验收**
  - B1：`packages/agent/src/models/registry.ts` 只有一张 kind 表（协议、独立运行的密钥变量、预设），导出 `PROVIDER_KINDS`、`MODEL_PROTOCOLS`、`protocolOf(kind)`、`apiKeyEnvOf(kind)`。server 的 `PROTOCOL` 表与 credentials 的 `KIND_ENV` 已删除，改为调用它们；renderer 的 `KINDS` 改为 `ProviderKind.anyOf` 的 const。编译期等价断言放在 `apps/server/src/application/providers.ts`（`ProviderKindsAgree`、`ModelProtocolsAgree`），因为 agent 不依赖 protocol，server 是同时引用两者的一层。临时改动核验：只在 agent 加 `test-kind` 时 tsc 在断言处失败（TS2344）；只在 protocol 加时断言与 renderer 的 i18n 键同时失败；两侧都加时只剩 renderer 的 `providers.kinds.test-kind` 缺翻译（MessageKey 类型检查，设计如此：标签是翻译，不放进 agent）。已撤销并确认 tsc 通过。
  - B3：`packages/protocol/src/control.ts` 新增 `createRequestTracker()` 与 `RequestTimeoutError`（只用 setTimeout 与 AbortSignal）。迁移的三处逐处保留语义：server `createIpcCredentialStore` 的 decrypt（拒绝；signal 中止；IPC 断开时全部拒绝）、main `createCredentialBridge` 的 credential.store（超时返回 `timeout` 失败结果）、`SidecarProcess.inspectQuit`（超时拒绝；子进程 close 时以 "Sidecar exited" 全部拒绝）。评审列出的第 4 处 `apps/server/src/runtime/main.ts:57` 是 inspect-quit 的应答方，没有挂起状态，未改。
  - B11 第三项：`CredentialChannel` 增加必填的 `onUnavailable`，main 用 `supervisor.onUnexpectedExit` 接上；Sidecar 意外退出时挂起的 credential.store 立即以 `sidecar-unavailable` 结束。
  - M1 票 08：`dialog.tsx` 中的 `ToastFocusBridge` 用 Radix 1.2 的 `FocusScope.useFocusScopeBranch`（经 `radix-ui/internal`，未新增依赖）把 Toaster 宿主登记为对话框焦点范围的分支，并在捕获阶段的 keydown 中衔接 Tab 顺序：对话框最后一个元素 → Toast → 对话框第一个元素，Shift+Tab 反向；没有 Toast 时保持原有循环。`sonner.tsx` 用回调 ref 发布宿主节点（`useToasterHost`）。Toast 的 section 带 aria-live，aria-hidden 的 hideOthers 本来就不隐藏它。

  **越界的最小改动**（请 Lead 裁决）
  - `apps/desktop/src/main/index.ts`：给 `createCredentialBridge` 的 channel 加一行 `onUnavailable`。这个字段是必填的，不加则 typecheck 失败；也只有这里能拿到 supervisor。
  - 测试文件：`packages/protocol/src/control.test.ts`、`apps/desktop/src/main/credentials.test.ts`、`apps/desktop/src/main/sidecar-process.test.ts`、`packages/agent/src/models/models.test.ts`（追加用例）；新增 `packages/ui/src/components/dialog.browser.test.tsx`。
  - 地图 `.scratch/desktop-app/map.md` 未改：三条 Carry-over 已满足，可由 Lead 勾除。

  **先红**
  - tracker 5 例：在实现前因 `createRequestTracker` 不存在而失败。
  - main credentials 用例"Sidecar 在确认前退出时……立即以 sidecar-unavailable 结束"：在修复前 5 秒后测试超时。
  - Browser Mode 3 例（Tab 到达动作、来回衔接、关闭后焦点回到原位置）：修复前报 "focus never reached the target"。"没有 Toast 时 Tab 仍在对话框内循环"修复前后都通过（回归保护）。

  **实际运行的命令与结果**（基于 main 3879bf9，`git merge main` 为 Already up to date）
  - `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run lint`（0 警告 0 错误）、`pnpm run format:check`：均退出 0。
  - `pnpm run test`：81 个文件，671 例通过，1 例跳过（真实模型，无密钥），含 desktop E2E（settings、chat、desktop-shell、permissions、approvals、sandbox 等）与 package-smoke 产物 smoke。
  - 本票新增：protocol tracker 5 例、main credentials 1 例、sidecar-process 1 例（挂起的 inspectQuit 在子进程退出时立即拒绝）、agent kind 表 2 例、ui Browser Mode 4 例。
  - 冷 Vite 依赖缓存（删除 `packages/ui/node_modules/.vite` 后）重跑 dialog Browser Mode 4 例也通过。在旧缓存上首次运行时 Vite 发现新导入 `radix-ui/internal` 后重新加载页面，出现过一次 `useContext` null；之后不再出现。

  **未验证项**
  - 设置弹窗中的 Toast 键盘可达只在 Browser Mode（通用 Dialog + Toaster，与应用装配相同的兄弟结构）中验证，没有新增 Electron E2E 用例。
  - Toast 动作执行后被移除、焦点落到 body 时，下一次 Tab 回到对话框（桥接中有分支处理），没有单独的用例。

  **文档影响**
  - 无正文变化：apps/server README 中 decrypt 的 10 秒超时与 `*_API_KEY` 的说明仍然准确；main 侧 credential.store 的超时与退出语义在正式文档中没有描述。可选：ui.md 的"Toast 宿主比弹层活得更久"可补一句"弹层打开时 Toast 动作仍可用键盘到达"，不在本票写范围内，未改。
- 2026-10-29 lead：合入 main（2dbfd8b）。合入后首次全量 test 有 27 个 Browser Mode 用例失败：新增的 radix-ui/internal 深层导入在旧的 Vite 预构建缓存上被运行中发现，触发页面重载。重跑通过；lead 在两个 browser 配置加 optimizeDeps.include（radix-ui/internal、sonner）并合入（9d88f91）。注：清空缓存后未能复现旧缓存场景，修复依据是 Vitest 的提示与重载日志。接受越界：main/index.ts 的 onUnavailable 接线、4 个测试文件追加用例、新增 dialog.browser.test.tsx。main 上复核：typecheck、lint、format:check 退出 0；全量 test 84 文件 686 通过、1 跳过（真实模型），无页面重载；check:docs 0 问题。worktree 已清理。

Closed: true
