# 10: `complete_plan` 与完成报告

**What to build:** 模型做完后提交一份对照计划的完成报告，Plan 变为已完成。用户在时间线计划卡与右栏 Plan 页看到报告：每一项做了什么、怎么验证的、哪些没做或偏离。完成不需要用户审批；完成后 Plan chip 消失，模型不再被提醒这份计划。见 [规格](../spec.md) 的“阶段二：执行中与完成”与设计稿。

**User stories:** 52、53、54、55、56、57、58、59、66（完成部分）、68

**Blocked by:** 09

**Status:** ready-for-agent

Closed: true

- [x] `complete_plan` 在规划中或执行中开始的 Run 注册；Subagent 的子 Session 的工具集中没有它
- [x] 成功：依次提交已完成的 `plan` 条目（同 planId 与 revision，带报告）、计划阶段“无”与工具结果；结果文本按设计稿
- [x] 批准之后的同一个 Run 中调用成功
- [x] 不在执行中时调用、空报告、超过长度上限：返回错误结果，不提交条目，计划阶段不变
- [x] 四种 Permission Mode 下都不询问；拒绝规则与询问规则照常生效
- [x] 工具的说明与批准结果要求报告逐项对照计划写明做了什么、怎么验证、哪些没做或偏离；宿主不校验报告内容，不运行任何验证
- [x] 报告入库与推送前替换登记的 Secret 明文；条目、推送与工具结果中没有明文
- [x] 完成后的下一个 Run：执行中的 State Update 送达一次清空，之后不再发送；`<approved_plan>` 不再注入
- [x] 回退到完成之前的消息：计划阶段回到执行中，Plan 的状态回到已批准
- [x] 完成后用户继续对话是普通对话，没有活动的 Plan
- [x] 桌面：时间线计划卡与右栏 Plan 页显示“已完成”与完成报告；Plan chip 消失
- [x] Sidecar 集成测试与 renderer 浏览器测试覆盖以上各项
- [x] 文档：Plan Mode、权限判定与审批中的权限类清单、桌面工作台；`pnpm run check:docs` 通过

## Comments

### 2026-11-20 实施完成（未关闭）

- **交付。** `packages/agent/src/planning/complete-plan.ts`：`COMPLETE_PLAN_TOOL`、`createCompletePlanTool(port)`（`effect: 'side-effect'`、`timeoutMs: 0`），名称、描述、参数说明与 T9–T11 逐字一致；空报告（去掉首尾空白）与超过 `PLAN_MAX_CHARS` 的报告在 `execute` 中抛出 T10 参数错误，不交给宿主。`SUBAGENT_EXCLUDED_TOOLS` 加入 `complete_plan`。服务端：plan 贡献在 Run 开始时阶段为 planning 或 executing 时注册 `complete_plan`（session-state），`ruleTools` 增加它；`PlanHost.completePlan` 由 `SessionPermissions.completePlan` 实现：锁内现取阶段，不在执行中（或找不到活动计划）抛出 T10“没有执行中的 Plan”，否则依次提交 `plan { …被执行的 approved 条目, status: 'completed', report }` 与 `plan_phase { none }`。报告经 `runtimes.commit` 的既有替换处理登记明文。renderer：Plan tab 对带 `report` 的修订在正文前显示完成报告（`data-slot="plan-report"`，标题 `plan.report`，静态 Markdown）；状态标签沿用已有的 `plan.status.completed`；i18n 新增 `report`（中英同构）。chip 随 `plan_phase { none }` 消失、回退后回到执行中，均为既有派生。
- **与设计稿的偏离与补充。**
  1. 工具注册不按 `scope.parentSessionId` 判断，而与 `exit_plan_mode` 相同由子 Session 的固定排除去掉（`filterTools`）；结果与设计稿“子 Session 不注册”相同。
  2. 完成报告在 Plan tab 中放在计划正文之前（设计稿未规定位置）。时间线中被执行的 approved 卡保留（完成后显示“已批准”），completed 条目另成一张“已完成”卡，沿用“每条 plan 条目一张卡”的现有投影，未另行合并。
  3. 超长报告的错误结果只在 `planning.test.ts`（真实运行时）覆盖：faux 模型逐块流式输出 64 000 字符的工具参数使 Sidecar 用例超过 120 秒，Sidecar 用例只覆盖空报告。四种 Permission Mode 不询问、拒绝与询问规则生效同样在 `planning.test.ts` 覆盖，Sidecar 用例覆盖 default 下不询问。子 Session 没有该工具由 `definitions.test.ts` 覆盖（设计稿验证表所列）。
  4. `docs/README.md` 的 Plan Mode 摘要与 ADR 0028 的实施状态随本票同步（票面未列出）。
- **测试。** `planning.test.ts`：四种模式不询问且报告原样交给宿主、拒绝规则与询问规则、空与超长报告的 T10、宿主拒绝时的 T10 文本。`definitions.test.ts`：`complete_plan` 被固定排除。`sidecar-plan.test.ts` 新增两例：规划中调用为“没有执行中的 Plan”且不提交、首个请求同时注册 `exit_plan_mode` 与 `complete_plan`、批准所在的同一个 Run 中空报告出错、成功时 completed → `plan_phase none` → 工具结果（T11）、只有计划审阅一条审批、模式不变、读回 none、下一个 Run 没有两个工具与计划 section、从未送达的 plan State Update 不发清空；跨 Run 完成后下一个 Run 送达一次清空、再下一个不送达、不注入 `<approved_plan>`，回退到完成所在 Run 的用户消息后读回执行中与 approved。`secrets-gate-plan.test.ts`：报告含登记明文时 completed 条目为 `[REDACTED]`，`complete_plan` 的结果帧与库中没有明文。`plan.browser.test.tsx`：完成后 chip 消失、计划卡与 Plan tab 为“已完成”、显示完成报告、回退后回到执行中且报告消失。
- **验证（2026-11-20，darwin，合入 11 之后重跑）。**
  - `pnpm run typecheck` 通过；`pnpm run check:docs` 通过（449 个文件 0 个问题）；pre-commit 的 oxfmt 与 oxlint 通过。
  - 单元：`vitest run --project agent --project server --project scripts` 1866 例，1861 通过、5 失败，均为已知基线（`engine/host-stop` 2、`policy/approvals` 1、`policy/gate-hooks` 1、`instructions/shared` 1）；`scripts/source-references.test.ts` 2 例通过。
  - 集成（真实 Sidecar）：`sidecar-plan`、`secrets-gate-plan`、`sidecar-handoff`、`sidecar-rewind` 4 个文件 39 例通过。
  - Browser Mode：`plan.browser.test.tsx` 22 例通过。
  - 未验证：真实模型是否遵守 T9–T11；非 darwin 平台；Electron E2E 未跑（完成路径的端到端属阶段二验收）；需要真实指针或原生层的交互。
  - 11 的“Run 进行中放弃后本 Run 再调用 `complete_plan` 得到错误结果”：本票的实现在锁内现取阶段，放弃后返回 T10“没有执行中的 Plan”，但没有专门的 Sidecar 用例覆盖这一组合。

### 关闭（2026-11-20）

已合入集成分支 `feat/plan-lifecycle`（最终 HEAD ecfcbde8，含代码审查修复）。
