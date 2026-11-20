# 09: 批准后进入执行中并持续提醒

**What to build:** 批准不再是计划的终点。批准后 Plan 为执行中，Plan chip 与计划卡显示“执行中”；模型被要求先把计划拆成 Todo List 再动手；执行跨多个 Run 时，每个 Run 都以 State Update 告诉模型有未完成的 Plan；计划正文被压缩掉之后重新提供。本票还没有结束计划的出口，完成与放弃分别在 10 与 11。见 [规格](../spec.md) 的“阶段二：执行中与完成”“阶段二：界面”与设计稿。

**User stories:** 45、46、47、48、49、50、51

**Blocked by:** 08

**Status:** ready-for-agent

Closed: true

- [x] 批准时提交的计划阶段为“执行中”并带该 Plan 的 planId，取代阶段一的“无”；计划接口读回执行中与活动的 Plan
- [x] 批准的工具结果按设计稿的阶段二文本：先用 `todo_write` 拆解，执行并验证，结束时调用 `complete_plan` 对照计划汇报
- [x] 宿主不检查是否拆了 Todo：批准后不调用 `todo_write` 直接写入照常放行
- [x] 执行中写入不再被拒，命令沙箱回到 Permission Mode 对应的档位
- [x] 执行中的 State Update：名称、值与渲染按设计稿；带新输入的 Run 开始时送达，块位于 user message 最前，前置对应的 `state_update` 条目；时间线不显示
- [x] State Update 的去重与重发遵循既有规则：值不变不重复；回退或压缩去掉旧的送达后重发
- [x] `<approved_plan>` 只在计划阶段为执行中、且该 Plan 的正文早于最后一次有效压缩时注入；历史上已批准、没有执行阶段的 Plan 不再注入
- [x] 有执行中的 Plan 而没有 Goal 时，Run 结束后宿主不发起新的 Run
- [x] 桌面：Plan chip 在执行中显示“执行中”，样式不变；时间线计划卡与右栏 Plan 页对执行中的 Plan 显示“执行中”，历史上已批准的仍显示“已批准”
- [x] 本票的过渡状态：执行中的退出动作只把计划阶段置为“无”，不改 `plan` 条目；由 11 改为放弃。写入本票的评论
- [x] Sidecar 集成测试与 renderer 浏览器测试覆盖以上各项
- [x] 文档：Plan Mode、上下文管理的 State Update 清单与 `<approved_plan>` 条件、桌面工作台；`pnpm run check:docs` 通过

## Comments

### 2026-11-20 实施完成（未关闭）

- **交付。** 批准时总是提交 `plan_phase { executing, planId }`（审阅等待期间已退出规划后再批准同样进入执行中），`GET …/plan` 读回执行中与被执行的计划；批准结果改为设计稿 T8（先 `todo_write` 拆解、执行并验证、`complete_plan` 对照计划汇报），宿主不检查是否拆了 Todo。执行中写入不再被拒、命令沙箱回到 Permission Mode 对应的档位（规划约束只看 `phase === 'planning'`，无需改判定）。`state_update` v2（agent 两版、v1 原样迁移；protocol 同形）增加 name `plan`，`STATE_UPDATE_NAMES` 末尾追加；渲染 `packages/agent/src/entries/plan-text.ts`（T12），清空用通用文本。plan 贡献的 `stateValues` 只对根 Session 给值（`PlanHost` 增加已有的 `sessionPlan`）。`approvedPlanToReinject` 只在执行中取该 planId 最新的 approved 条目。renderer：`displayedPlanStatus`（`plan-review-panel.tsx`）派生“执行中”，计划卡与 Plan tab 的标签与 `data-status` 用它；Plan chip 执行中显示 `plan.chipExecuting`；i18n 新增 `chipExecuting`、`status.executing`（中英同构）。
- **过渡状态（由 11 改为放弃）。** 执行中的退出动作（`POST …/plan { exit }`、`/plan off`、Plan chip 的 ×）只提交 `plan_phase { none }`，不改动 `plan` 条目（被执行的计划仍为 approved，不写 abandoned）；执行中的 `enter` 只提交 `plan_phase { planning }`。退出后计划卡与 Plan tab 显示“已批准”，下一个带新输入的 Run 送达一次 `plan` 清空。chip 在执行中的关闭按钮可访问名称仍为 `plan.exit`（“关闭计划模式”），`plan.abandon` 由 11 加入。T8 与 T12 已提到 `complete_plan`，但工具在 10 才注册。
- **测试。** `sidecar-plan.test.ts` 新增“批准后执行中”用例：读回执行中与活动计划、不先 `todo_write` 的写入按 default 询问并写入、写文件命令在 workspace-write 沙箱成功（darwin）、批准所在 Run 不送达、下一个 Run 首块为 T12 且 `state_update` 条目在同一 Run 的 user message 之前、值不变不重复、没有 Goal 时 Run 结束后 1.5 秒内没有新的 Run、执行中退出后 plan 条目不变且送达一次清空、之后不再送达；压缩用例改为执行中：压缩把送达摘要掉后重发提醒并注入 `<approved_plan>`，执行中再 `/plan` 后不注入且送达清空。原有用例中批准后的阶段读回、条目顺序、审计序列与结果文本改为执行中 / T8。`secrets-gate-plan.test.ts`：编辑后的计划标题含明文，`plan` State Update 的值、WS 帧与发给模型的块中没有明文。`state-updates.test.ts`（渲染、排序、去重、清空）、`session-entries.test.ts`（state_update v1→v2）、`planning.test.ts`（再注入只在执行中、T8）、`timeline.test.ts`（plan 块按配对隐藏）、`plan.browser.test.tsx`（chip 执行中且高度不变、× 调用退出、计划卡与 Plan tab 的执行中与历史已批准、退出后回到已批准）。`plan.e2e.test.ts` 的断言改为执行中。
- **与设计稿的偏离。**
  1. 计划卡与 Plan tab 的 `data-status` 也取显示状态（执行中为 `executing`），不只是标签；设计稿只规定了标签。
  2. 设计稿 §11.1 写 chip 关闭按钮执行中用 `plan.abandon`，但该键属于 11；本票执行中沿用 `plan.exit`。
  3. ADR 0028 的“实施状态与证据”与 `docs/README.md` 的 Plan Mode 摘要随本票同步（原文写“批准只结束规划”“阶段二未开始”），票面未列出。
- **验证（2026-11-20，darwin）。**
  - `pnpm run typecheck` 通过；`pnpm exec oxlint` 无问题；`pnpm run check:docs` 通过（437 个文件 0 个问题）。
  - 单元：`vitest run --project agent --project server --project protocol --project scripts` 1921 例，1915 通过、6 失败，均为已知基线（`engine/host-stop` 2、`policy/approvals` 1、`policy/gate-hooks` 1、`instructions/shared` 1、`protocol/entries` M2–M6 kind 1）；desktop 单元 `src/renderer` 312 例，308 通过、4 失败为已知基线 renderer store 4。
  - 集成（真实 Sidecar）：`sidecar-plan`、`secrets-gate-plan` 2 个文件 17 例通过；`sidecar-handoff`、`sidecar-rewind`、`sidecar-hooks`、`sidecar-goal`、`sidecar-compaction`、`sidecar-state-update-fork`、`secrets-gate-plan` 7 个文件 56 例通过。
  - Browser Mode：`plan`、`business-timeline`、`approval-panel`、`trajectory-view` 4 个文件 61 例通过（`trajectory-view` 的 system 行用例在一次批量中失败、单独与再次批量重跑通过，与本票无关）。
  - Electron E2E（后台模式）：`plan.e2e.test.ts` 2 例，执行中断言所在的完全访问权限用例通过；另一例在附件步骤失败，与基线相同（见 08 的评论）。
  - 未验证：真实模型是否遵守 T8 与 T12；非 darwin 平台；需要真实指针或原生层的交互。

### 关闭（2026-11-20）

已合入集成分支 `feat/plan-lifecycle`（最终 HEAD ecfcbde8，含代码审查修复）。
