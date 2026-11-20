# 12: 阶段二集成验收与文档

**What to build:** 在真实应用里走通“规划、批准、执行、完成报告”与“执行中放弃”两条路径，逐条核对规格的阶段二用户故事，并让术语表、ADR 状态与当前行为文档和实现一致。本票结束即整份规格交付完成。见 [规格](../spec.md) 的 User Stories 45–68 与 Testing Decisions。

**User stories:** 45–68（核对）

**Blocked by:** 10、11

**Status:** ready-for-agent

Closed: true

- [x] Electron 端到端用例（后台模式）：`/plan` 进入，提交并批准后 Plan chip 显示“执行中”；模型写 Todo List 并提交完成报告；计划卡与右栏 Plan 页显示“已完成”与报告，chip 消失
- [x] Electron 端到端用例：执行中点 Plan chip 的 × 放弃，计划卡显示“已放弃”，从协议读回没有活动的 Plan，已写入的文件仍在
- [x] 规格的用户故事 45–68 逐条对应到通过的测试或证据；没有对应的列为缺口并说明
- [x] 术语表：Plan 改为贯穿到结果反馈的方案，状态为待审阅、已拒绝、执行中、已完成、已放弃
- [x] 新 ADR 的实施状态更新为已实施
- [x] 当前行为文档从导航入口读回核验，与实现一致：Plan Mode（阶段、`complete_plan`、放弃、界面）、上下文管理、Todo List 中与计划的关系、Goal 中“不新增关联”的说明、追踪与审计、桌面工作台，以及两个包的 README；文档导航中 Plan Mode 的摘要同步
- [x] 证据按 [证据模板](../../../docs/templates/evidence.md) 记录
- [x] 如实报告未验证项：真实模型是否先拆 Todo、是否在做完后调用 `complete_plan`、报告是否逐项对照计划
- [x] `pnpm run typecheck`、`pnpm run check:docs` 与本阶段受影响的测试文件通过；报告实际选中的用例数

## Comments

### 2026-11-20 验收完成（未关闭）

- **E2E（后台模式）。** `apps/desktop/e2e/plan.e2e.test.ts` 新增两例：批准后 chip 为执行中、下一个 Run 写待办并 `complete_plan` 后 chip 消失、计划卡与 Plan tab 为已完成且 Plan tab 显示报告、读回没有活动的 Plan；自动接受编辑下批准并写入文件后点 chip 的 ×（“放弃计划”）放弃，计划卡与 Plan tab 为已放弃、读回没有活动的 Plan、文件内容不变。临时改坏报告区与 chip 名称时两例分别失败。
- **补齐前序缺口。** 11：Run 进行中放弃后本 Run 再调用 `complete_plan` 为“没有执行中的 Plan”且不提交。10：同一 Session 依次在四种 Permission Mode 下规划、批准、完成，都只有计划审阅一条审批；超长报告（64 001 字符）为错误结果且不提交，faux 脚本新增可选 `tokenSize`（透传 pi-ai faux）使该用例约 2 秒。另补故事 67（执行中分叉的新 Session 没有活动的 Plan）与 68（子 Session 工具表没有 `complete_plan`）的集成断言。
- **全量回归。** 577 文件 4 234 例，98 失败；与阶段一的基线（本地 `main` `19e0ac5c`，未重跑：`main` 无新提交）逐项对比，分支独有失败 7 项：3 项由集成分支引入并已修复——`headless.test.ts` 仍断言 `state_update` v1（09 升为 v2）、Plan tab 报告区的 `border-b` 违反样式守卫（10）、`desktop-shell.e2e` 两例仍断言后台模式中已被抑制的原生错误框（08 的 `bbbef0a4`），改为断言日志；1 项为基线同样失败的 `plan.e2e` 原有用例（附件步骤）；3 项单独运行通过（负载抖动）。修复后重跑受影响文件，未再跑全量。
- **文档。** GLOSSARY 的 Plan；ADR 0028 改为 implemented（含导航状态列）；`plan-mode.md`（结构表重复行、报告在 Plan 页而非计划卡、验证清单）；`todo.md` 新增“与计划的关系”；`goal.md` 补“与计划不新增关联”；`tracing.md` 的 `plan_phase` 行；`apps/server/README.md` 的 faux `tokenSize`。上下文管理、桌面工作台与 agent、protocol 的 README 读回一致未改；导航摘要已由 09–11 同步。
- **验证。** `pnpm run typecheck` 通过；`pnpm run check:docs` 通过；受影响的 Node 测试 11 个文件项 171 例通过；Browser Mode `plan`、`business-timeline` 38 例通过；E2E `plan` 与 `desktop-shell` 17 例中 13 通过、4 例为基线同样失败。证据见 [阶段二验收](../evidence/phase-two-acceptance.md)。
- **未验证。** 真实模型是否先拆 Todo、是否在做完后调用 `complete_plan`、报告是否逐项对照计划；非 darwin 平台；需要真实指针或原生层的交互（后台模式下原生错误框的内容不再由 E2E 覆盖）。

### 关闭（2026-11-20）

已合入集成分支 `feat/plan-lifecycle`（最终 HEAD ecfcbde8，含代码审查修复）。
