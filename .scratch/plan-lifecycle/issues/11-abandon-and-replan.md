# 11: 放弃与重新规划

**What to build:** 用户可以明确结束一份执行中的计划。执行中用 `/plan off` 或 Plan chip 的 × 放弃，Plan 标为已放弃，已做的改动原样保留；执行中再输入 `/plan` 则先放弃旧计划，再进入新一轮禁止写入的规划，新计划使用新的编号。一个 Session 同一时刻只有一份活动的 Plan。见 [规格](../spec.md) 的“阶段二：执行中与完成”中的放弃、重新规划与分叉三条。

**User stories:** 60、61、62、63、64、65、66（放弃部分）、67

**Blocked by:** 09

**Status:** ready-for-agent

Closed: true

- [x] 执行中的退出动作（`/plan off`、Plan chip 的 ×、计划接口）：依次提交已放弃的 `plan` 条目与计划阶段“无”；Workspace 文件逐字节不变，不产生 Checkpoint 操作；取代 09 的过渡行为
- [x] 放弃不弹确认；失败时界面保留状态并提示
- [x] Run 进行中放弃：之后本 Run 再调用 `complete_plan` 得到错误结果
- [x] 执行中的进入动作（`/plan`、计划接口）：先按放弃处理当前 Plan，再提交“规划中”；之后写入被拒；新提交的计划使用新的 planId、修订从 1 开始
- [x] 规划中的退出不改动待审阅的 `plan` 条目，行为与阶段一相同
- [x] 任一时刻至多一份活动的 Plan：规划中没有执行中的 Plan，执行中不能同时规划
- [x] 放弃后的下一个 Run：执行中的 State Update 送达一次清空；`<approved_plan>` 不再注入
- [x] 回退到放弃之前的消息：计划阶段回到执行中，Plan 的状态回到已批准
- [x] 分叉与交接：从执行中的 Session 得到的新 Session 没有计划阶段，也没有活动的 Plan
- [x] 桌面：时间线计划卡与右栏 Plan 页显示“已放弃”；Plan chip 消失；重新规划后 chip 显示“计划”
- [x] Sidecar 集成测试与 renderer 浏览器测试覆盖以上各项
- [x] 文档：Plan Mode、命令（`/plan` 的语义）、桌面工作台；`pnpm run check:docs` 通过

## Comments

### 2026-11-20 实施完成（未关闭）

- **交付。** `SessionPermissions.planAction`：执行中的 `exit` 与 `enter` 先放弃被执行的计划——在同一把锁内依次提交 `plan { planId, revision, markdown, status: 'abandoned' }`（取 `activePlanOf`，与执行中的 approved 条目相同）与 `plan_phase { none }`，`enter` 随后提交 `plan_phase { planning }`；不触碰文件与 Checkpoint，不改 Permission Mode。取代 09 的过渡行为（只转换阶段）。规划中的退出与阶段一相同。新计划的新 planId、修订 1 由既有 `nextPlanRef`（遇到 `plan_phase planning` 即新建）保证；回退、分叉、交接与 renderer 的“已放弃”标签已由 06、09 的派生覆盖，无需改代码。renderer：Plan chip 执行中的关闭按钮可访问名称为 `plan.abandon`（“放弃计划” / “Abandon plan”，i18n 新键，中英同构），点击即放弃、不弹确认。
- **“Run 进行中放弃后本 Run 的 `complete_plan` 出错”留待 12 验收补测。** 本票实施时 10 尚未合入集成分支，`complete_plan` 未注册；该条复选框未勾。服务端行为由 10 的 `port.complete` 在锁内现取阶段保证（放弃后阶段为 none）。其余 Run 进行中放弃的事实（等待中的写入审批照常回答、写入按模式执行、之后读回无且没有活动的 Plan）已覆盖。
- **测试。** `sidecar-plan.test.ts` 新增两例：① `/plan off` 放弃（abandoned → `plan_phase none` 的顺序与内容、文件逐字节不变、Checkpoint 列表不变、模式不变、重复 exit 不提交）→ 下一个 Run 首块为清空且没有 `<approved_plan>` → 回退到放弃之前的消息读回执行中与 approved → 执行中再 `/plan`（abandoned、none、planning；写入为 T3、文件不存在；新 planId、修订 1；`GET` 读回规划中与新的 proposed；system 中 T1）；② Run 进行中经计划接口放弃。原有两例的过渡断言改为放弃（`/plan off` 后多一条 abandoned）。`sidecar-handoff.test.ts`：源在执行中时目标只有 `handoff_origin` 与 `permission_mode`，读回无且没有计划。`fork.test.ts`：边界处执行中不追加阶段、不复制 `plan`。`plan.browser.test.tsx`：执行中 chip 的可访问名称为“Abandon plan”、点击不弹对话框、放弃条目到达后 chip 消失、计划卡与 Plan tab 显示 Abandoned、重新规划后 chip 为“Planning”；放弃失败时 chip 保留“Executing”并可再次点击。
- **文档。** `docs/subsystems/plan-mode.md`（概述、进入退出、回退、分叉与交接、Plan chip、Plan tab 状态、验证清单）、`commands.md`（内置命令清单原写“目前为空”已过时，补上四个内置命令与 `/plan` 的语义）、`workbench.md`（计划状态组的 ×）、`handoff.md`（执行中不追加）；ADR 0028 实施状态与 `docs/README.md` 的 Plan Mode 摘要同步。
- **与设计稿的偏离。** 无行为偏离。设计稿 §8.3 未写执行中而找不到对应计划（不应发生）的情况：此时只提交 `plan_phase { none }`，不写 abandoned。
- **验证（2026-11-20，darwin）。** `pnpm run typecheck` 通过；`pnpm run check:docs` 通过（449 个文件 0 个问题）；`scripts/source-references.test.ts` 2 例通过。集成（真实 Sidecar）：`sidecar-plan`、`sidecar-rewind`、`sidecar-handoff`、`sidecar-compaction`、`sidecar-state-update-fork`、`secrets-gate-plan` 6 个文件 46 例通过。单元：`packages/agent/src/agents`、`packages/agent/src/planning`、`session-permissions.test.ts` 6 个文件 125 例通过；`packages/i18n` 14 例通过。Browser Mode：`plan`、`business-timeline`、`approval-panel` 3 个文件 39 例通过。未运行 Electron E2E（12 验收）。未验证：真实模型行为；非 darwin 平台；需要真实指针或原生层的交互。

### 关闭（2026-11-20）

已合入集成分支 `feat/plan-lifecycle`（最终 HEAD ecfcbde8，含代码审查修复）。
“Run 进行中放弃后本 Run 的 `complete_plan` 出错”由 12 补的 Sidecar 集成用例覆盖（见 evidence/phase-two-acceptance.md）。
