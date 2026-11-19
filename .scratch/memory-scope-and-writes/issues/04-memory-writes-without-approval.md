# 04: 记忆操作不经审批

**What to build:** 用户让 Agent 记住一件事时，Agent 直接记下，对话不被审批卡打断。记忆的写入、替换与删除在五种 Permission Mode 下都直接执行，包括 read-only 与 plan；时间线上照常出现“已记住”“已更新记忆”“已删除记忆”的工具卡，详情中可见正文。想收紧的用户仍然可以配置 `Memory` 的询问或拒绝规则，外部 Hook 也照常生效。

**规格场景:** [spec](../spec.md) 的 AC-12、AC-13、AC-14、AC-28；实现决定“权限”；用户故事 10、11、12、13。

**文档影响:** [权限判定与审批](../../../docs/subsystems/permissions.md) 的权限类表与规则组说明；[Plan Mode](../../../docs/subsystems/plan-mode.md) 中“memory-write 照常询问”的说法；[Memory](../../../docs/subsystems/memory.md) 的工具与权限、工具卡；[无界面运行](../../../docs/subsystems/headless.md) 中列举需要审批的调用处如提到记忆则同步。

**Blocked by:** 01 新增 ADR 与术语更新；02 工具层限制：保护用户手写条目，无界面运行只读；03 Memory 段：声明、来源标注与写入引导

**Status:** ready-for-agent

Closed: true

- [x] AC-12：default 模式且没有任何 `Memory` 规则时，模型调用 `memory_write`，没有审批请求，条目已保存，结果为成功；read-only、plan、accept-edits、full-access 下相同。
- [x] AC-13：同样条件下模型调用 `memory_delete` 删除一条 Agent 来源的条目，没有审批请求，条目已删除。
- [x] AC-14：全局有 `Memory` 询问规则时，模型调用 `memory_write` 出现审批请求；换成拒绝规则时调用被拒绝，条目未保存。项目设置文件中的同名规则同样生效。
- [x] 判定顺序不变：拒绝规则、询问规则与外部 Hook 先于模式放行；PreToolUse Hook 的 deny 仍能阻止记忆写入。
- [x] 已保存的 `Memory` 允许规则保持有效且不报错，不做清理。
- [x] AC-28：桌面应用 default 模式下模型写入记忆，不出现审批卡，时间线出现“已记住”工具卡，详情可见正文。按 [UI 调试约定](../../../AGENTS.md)静默验证，说明哪些交互未在真实指针或原生层验证。
- [x] 权限判定的单元测试覆盖 memory-write 在五种模式下放行、询问与拒绝规则仍生效；现有记忆的 Sidecar 用例与 Electron E2E 中依赖审批的步骤按新行为改写，不保留旧行为的断言。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-19：用户确认 9 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
- 本票排在 02、03 之后，使主分支上不出现“审批已取消、限制尚未到位”的中间状态。
- 2026-11-19：实施完成。`decide.ts` 的模式放行把 memory-write 与 context-read、session-state、team 并列为所有模式放行（含 read-only 与 plan），去掉 accept-edits 中的单列分支；判定顺序不变，拒绝、询问规则与 PreToolUse Hook 仍先于模式。不再询问也就不再产生 `Memory` 的建议规则；已保存的允许规则仍按允许规则匹配，没有清理。
  - 实际执行的检查：`packages/agent/src/policy/decide.test.ts`（memory-write 在四种模式与 plan 放行、`Memory` 询问 / 拒绝规则生效、旧允许规则不报错，先红后绿，97 通过）；`tests/integration/sidecar-memory.test.ts`（改写首个用例为 default、read-only 写入与 plan 删除都没有审批请求，AC-12、AC-13；新增用例：全局 `Memory` 询问规则在 full-access 下出审批卡、全局与项目 `.coko/settings.json` 的拒绝规则拒绝且未保存、全局 PreToolUse Hook 的 exit 2 阻止写入，AC-14；以旧 `decide.ts` 运行时首个用例在 approval_request 处超时，确认测试覆盖本改动；4 通过）；`COKO_E2E_BACKGROUND=1 pnpm exec vitest run --project desktop-e2e apps/desktop/e2e/memory.e2e.test.ts`（AC-28：default 模式不出审批卡，工具卡“已记住”且详情可见正文，2 通过）；`packages/agent/src/policy`、`context/memory`、`apps/server` 的 `permissions` 与 `context/memory`、`secrets-gate-memory`、`sidecar-context`、`sidecar-plan`、`headless`、`headless-approvals`、`sidecar-approvals` 合跑 4 个失败（`sidecar-approvals` ×2、`approvals`、`gate-hooks` 各 1，均为 bash 相关用例），在恢复旧 `decide.ts` 后逐条相同，属既有失败；`pnpm run typecheck`、`oxlint`、`node scripts/check-docs.ts` 通过。
  - 未验证：AC-28 只在后台模式（窗口透明、不接收鼠标）的 Electron 中经 Playwright 验证，真实指针与原生层未验证；真实模型未验证。
  - 文档影响：`docs/subsystems/permissions.md`（权限类表中 memory-write 改为所有模式放行，说明规则与 Hook 收紧、不再建议规则、旧允许规则不清理；验证段）；`docs/subsystems/plan-mode.md`（plan 放行 memory-write）；`docs/subsystems/memory.md`（工具与权限、工具卡标题、验证段）；`docs/subsystems/headless.md` 没有列举记忆的审批，无需改动。
