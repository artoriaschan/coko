# 02: 审批闭环：判定、审批请求与审批卡

**What to build:** 默认模式下的端到端审批：agent policy 的纯判定（此票模式固定为 default：Workspace 内读取放行；Workspace 外读取、write、edit、bash、未知工具询问；受保护路径写入询问）与 ApprovalBroker（pending → allowed / denied / cancelled，只答一次），经 `ToolHooks.beforeToolCall` 位于链首接入；工具契约增加 `effect` 与 `permissionSubject` 并为内置工具声明；`approval_request` / `approval_decision` 条目；拒绝无反馈结束 Run（aborted）、带反馈继续。server：`POST /api/sessions/:id/approvals/:requestId`、Session.activity 的 awaiting-approval、SessionService 扩展工厂 `extensions`（供 07 注册 checkpoint hook）。renderer：审批卡接管 composer（DSH ui-approval 交互），工具卡显示决定，侧栏徽标与上浮，重连后恢复待审批。新建 `docs/subsystems/permissions.md` 并登记导航。

**User stories:** 1, 2, 3, 4, 8（受保护路径）, 10, 11

**Blocked by:** 01

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/policy/`、`packages/agent/src/tools/types.ts`、`packages/agent/src/tools/builtin/`（只加 effect 与 permissionSubject 声明）、`packages/agent/src/extensions/`、`packages/agent/src/engine/`、`packages/agent/src/session-entries/permissions.ts`、`packages/protocol/src/permissions.ts`、`packages/protocol/src/runs.ts`、`apps/server/src/application/`、`apps/server/src/http/app.ts`、`apps/server/src/runtime/layers.ts`、`apps/server/README.md`、`apps/desktop/src/renderer/features/conversation/`、`apps/desktop/src/renderer/features/sidebar/`、`apps/desktop/src/renderer/stores/`、`packages/ui/src/`、`packages/i18n/src/dictionaries/`、`apps/desktop/e2e/`、`tests/integration/`、`docs/subsystems/permissions.md`、`docs/README.md`、`docs/DOCUMENTATION_SYSTEM.md`（仅登记 subsystems 目录，如尚未登记）、`docs/adr/0005-permission-mode-and-sandbox.md`、`docs/adr/README.md`

- [x] agent 表驱动测试：判定顺序（拒绝前置项、Workspace 内外读取、受保护路径大小写变体、未知工具询问）
- [x] 集成测试：bash 写文件 → 收到 `approval_request` 条目、activity 为 awaiting-approval、文件不存在；允许一次 → 文件写入、条目为 `approval_decision allowed once`；再次回答 409 `approval-not-pending`
- [x] 集成测试：无反馈拒绝 → toolResult 为拒绝错误、Run 以 aborted 结束、文件不存在；带反馈拒绝 → 反馈出现在 toolResult 中、Run 继续到下一次模型请求
- [x] 集成测试：同批两个需审批调用按调用顺序逐个出现；等待审批时 abort → 请求 cancelled、调用不执行
- [x] 集成测试：等待审批时重新订阅（afterSeq 0）能看到 pending 请求；inspect-quit 把等待审批的 Run 计为 1
- [x] Electron E2E：审批卡出现在 composer 位置，允许一次后工具卡完成并显示决定；拒绝带反馈后 Agent 继续；侧栏该会话带待审批徽标并位于组首
- [x] Browser Mode：焦点在详情时 Enter 允许一次、Esc 拒绝；同一请求点击两次只发一次回答；输入法组合中不触发
- [x] 产物 smoke：打包产物中一次审批允许
- [x] 秘密总闸追加驱动：审批卡参数为 `env` 命令时仍无明文
- [x] `docs/subsystems/permissions.md` 描述当前判定与审批契约并从导航可达；ADR 0005 implementation 改为 partial 并写明剩余项

## Comments
- 2026-10-29 lead：同意实施者提出的越界 1–6（protocol errors.ts 的 approval-not-pending、api.ts 的 sessionApproval 路径助手、renderer client/api.ts 的 answerApproval、chat-failure.ts 的 approval kind、fixture-chat.ts 桩、既有测试改为显式允许一次与 about.securityNote 文案）。

### 2026-10-29 实施者（分支 m2/02-approval-loop）

**覆盖的验收（全部 10 项）**
- 判定表驱动测试 `packages/agent/src/policy/decide.test.ts`（30 例）：拒绝规则先于 Workspace 内读取放行、询问规则与受保护路径；Workspace 内外读取（含相对路径越界、同名前缀兄弟目录、Workspace 内指向外部的符号链接）；受保护路径 `.GIT`、嵌套 `.Git`、`.VSCode`、`.BashRC`、`.SSH`、经符号链接写 `.git`；未知工具询问；允许规则不能免掉受保护路径与越出可写根的写入；建议规则。
- 运行时测试 `policy/approvals.test.ts`（8 例）与集成测试 `tests/integration/sidecar-approvals.test.ts`（5 例）：bash 写文件 → approval_request、activity awaiting-approval、文件不存在；允许一次 → 写入、`approval_decision { allowed, scope: once }`；再答 409 `approval-not-pending`；无反馈拒绝 → 拒绝错误、Run aborted、不再请求模型；带反馈拒绝 → 反馈进 toolResult、Run 继续到下一次模型请求；同批两个调用逐个出现；等待时停止 → cancelled、不执行；afterSeq 0 重新订阅看到 pending；inspect-quit 计 1。
- Browser Mode `packages/ui/src/approval/approval-card.browser.test.tsx`（8 例）：焦点在详情时 Enter 允许一次、Esc 拒绝且 defaultPrevented（不触发全局停止）；点击两次与键盘只回答一次；失败后解锁；IME 两种事件序列不触发；带原因拒绝。store 测试 `chat-store-approvals.test.ts`（3 例）：同一 requestId 只发一次请求、activity 随条目更新、侧栏组首。
- Electron E2E `apps/desktop/e2e/approvals.e2e.test.ts`（3 例）：审批卡在输入区位置且输入区被接管；允许一次后工具卡 done 并显示"已允许一次"；带原因拒绝后 Agent 继续；侧栏徽标与组首，回答后徽标消失。产物 smoke 在 `package-smoke.e2e.test.ts` 中增加一次 bash 写入的允许一次。
- 秘密总闸：`secrets-gate.test.ts` 的 bash `env` 经审批卡通道（请求条目、等待中读回详情与列表、经回答路由允许），断言请求与决定条目存在，扫描仍无明文。
- 文档：新建 `docs/subsystems/permissions.md`，`docs/README.md` 增加"当前行为"入口；ADR 0005 implementation 改为 partial 并写明剩余项；`docs/adr/README.md` 同步；`apps/server/README.md` 更新路由、activity、extensions 与限制。`docs/DOCUMENTATION_SYSTEM.md` 目标布局已含 subsystems，未改。

**实现要点（供 03、05、07）**
- `decide()` 只看工具名分组（Read / Edit / Bash，其余原名）；规则内容目前只做精确匹配，glob、前缀与复合命令拆分留给 03。`modeAllows` 已按 ADR 0005 写出四档，但只有 default 经测试，03 负责四档 × 工具的表。
- 路径按真实路径判定（`policy/paths.ts` 的 `realLocation` 解析悬空链接）；default 可写根为 Workspace、`os.tmpdir()`、`/tmp` 的真实路径。
- `AgentRuntimeOptions.permissions` 缺省时不判定（库调用方），server 总是传入（模式固定 default、规则为空，03 改为回放）。权限 hook 位于链首，其后是 `extensions` 的 hooks。
- broker 先登记等待再提交请求条目，决定条目排在请求条目之后；无反馈拒绝后同批其余调用直接得到跳过结果，`finishTurn` 结束 Run。
- 等待中停止时整批都不执行：pi 先逐个准备整批再执行，已允许的同批调用也尚未开始（集成测试已按此断言）。
- server 对 scope 非 once 回 400，03 实现保存规则后放开。
- `SessionService.extensions` 已接入但未注册任何扩展，也没有独立测试；07 注册 checkpoint hook 时覆盖。

**越出 Write scope 的改动**（Lead 已于 2026-10-29 同意 1–6）
- `packages/protocol/src/errors.ts`：ErrorCode 加 `approval-not-pending`。
- `packages/protocol/src/api.ts`：`apiPaths.sessionApproval`。
- `apps/desktop/src/renderer/client/api.ts`：`answerApproval`。
- `apps/desktop/src/renderer/app/chat-failure.ts`：failure kind `approval` 与 not-pending 文案。
- `apps/desktop/src/renderer/testing/fixture-chat.ts`：`answerApproval` 桩。
- 既有测试改为显式允许一次（sidecar-session、secrets-gate、chat.e2e；停止与关闭用例先允许再停止，仍覆盖正在运行的 bash 被停止）；about.securityNote 文案改为说明审批与"命令尚未在沙箱中运行"。

**实际运行的命令与结果**（worktree，已 `git merge main`，`unset ELECTRON_RUN_AS_NODE`）
- `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run lint`（0 错误）、`pnpm run format:check`、`pnpm run check:docs`（81 个文件 0 问题）：全部退出 0。
- `pnpm run test`：65 个文件，511 通过、1 跳过（真实模型），含 desktop E2E 6 个文件与产物 smoke。
- 负向确认：decide 测试先在模块缺失时失败；broker 初版"先提交后登记"使 6 个运行时用例失败（回答时 not pending），改为先登记后通过。
- 视觉检查：临时 E2E 截取浅色、深色、520px 窄窗口下的审批卡（edit diff 摘要），确认位置、对比度与按钮可达，截图未入库。

**未验证**：真实模型（无密钥）；CI；非 darwin 平台；未打开（未订阅）的会话 activity 只在列表重新加载时更新，未做实时推送。

**文档影响**：见上；GLOSSARY 已有 Approval Request、Protected Path 等术语，未改。
- 2026-10-29 lead：评审后合入 main（6abc17f）。main 上复核：install、typecheck、lint、format:check 退出 0；全量 test 65 文件 511 通过、1 跳过（真实模型），含 desktop E2E 与产物 smoke；check:docs 81 文件 0 问题。接受"等待审批时停止，整批都不执行"的行为（pi 先准备整批再执行）。worktree 已清理。

Closed: true
