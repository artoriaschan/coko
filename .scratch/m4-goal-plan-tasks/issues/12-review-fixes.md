# 12: M4 两轴评审的修复

**What to build:** 修复 [Standards 评审](../review-standards.md)（A*）与 [Spec 评审](../review-spec.md)（数字编号）中 Lead 列入清单的项，按优先级：无人值守花费（Spec 1、A3、A2、A4、A5、A6）→ 权限与沙箱（A1、Spec 3）→ Plan Mode（Spec 6、7、8）→ 控制通道（A7）→ 测试与界面（A8–A14、B14）→ 小项（Spec 9、Spec 17）。重叠：A1 = Spec 4，A3 = Spec 2，A4 = Spec 5，A6 = Spec 13，A7 = Spec 10 / 11，A10 = Spec 15，A11 = Spec 14，A12 = Spec 12。

**User stories:** 2, 5, 7, 9

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11

**Status:** ready-for-agent

**Write scope:** 评审各项所指的文件（agent engine / goals / policy / planning / tasks/jobs，server application 与 control，protocol http / permissions，desktop main 的 sidecar-process、renderer 的 plan / jobs / goal 界面与 browser setup，ui 主题样式表），对应测试，`docs/subsystems/{goal,plan-mode,jobs,execution,permissions}.md`、`docs/tech-stack/{testing,ui-design-system}.md`、ADR 0005，`.scratch/m4-goal-plan-tasks/{review-standards,review-spec,spec}.md`

- [x] 无人值守花费：Spec 1、A3、A2、A4、A5、A6
- [x] 权限与沙箱：A1、Spec 3
- [x] Plan Mode：Spec 6、7、8
- [x] 控制通道：A7
- [x] 测试与界面：A8、A9、A10、A11、A12、A13、A14、processes.test 的固定 sleep（B14）
- [x] 小项：Spec 9、Spec 17
- [x] 两份评审文件末尾"处理结果"；受影响的 ADR 与正式文档同步；`check:docs` 通过

## Comments

- 2026-10-30 implementer（m4/12-review-fixes，接续者）：
  - **前任完成的部分：** 9 个未提交文件（engine 的 compaction-driver / runtime / types、compaction.test、host-stop.test、extensions/hooks、goals/budget 与 budget.test、index），即 A2 的运行时结构化标记 `details.hostBlock` 与 `RunError.dimension`、A4 的压缩与溢出恢复前检查。盘点后 agent 侧测试 235 例通过，但 server 仍按文本识别；本人补 server 侧（hostBlock、dimension、删除 `budgetDimension`）、run_end 条目与进度不带 dimension（协议 strict），与前任改动一并提交为 3799caf。
  - **本人完成：** 其余全部项，每项一个提交（afa3b60、194dc9b、df98f62、8c698ae、a08424b、f1bdf07、049fbd2、2d7b227、171a2d0、fe85414、1030edc、a653f94、1ba9e82、cc49c4b、e9215f9）；逐项的做法与测试见两份评审文件末尾的"处理结果"。
  - **负向确认：** 除纯文档项外均先写失败测试并确认先红（A2 伪造前缀、Spec 1、A3 的 200、A5 三例、A6 file_backup、A1 / Spec 3 三例、Spec 7 三例与 400、Spec 6、A7 三例、Spec 9、A14 两例、A12 两例）；A10 的泄漏断言用临时用例（留下 aria-hidden 与 pointer-events）确认使用例失败后删除。
  - **取舍：** Spec 6 用方案一（同一 Run 内 wait-input 与 wake）。Spec 7 按用户故事 9：批准 mode 可为 read-only，宽于 prior 为 400，spec.md L118 已改；审阅卡只在 prior 为 full-access 时给出"批准并允许编辑"。Spec 8 用 toolResult 文本加 `PlanReview.active()`，不刷新同一 Run 的 system sections。A1 选"宽于当前档位时 plan / read-only 拒绝、其余模式按提权询问"，未禁止 tty 与 sandbox_permissions 同用。A5 以 goal-driver 单元测试覆盖，未写删除 Provider 的集成用例。A12 只改 jobs-tab 与 goal-card；context-ring、mcp-section、rewind-dialog 中 `text-warning` 作文字的位置未改，建议后续改为 `text-warning-text`。
  - **未处理：** B1–B12、B15（judgement，不在清单；HTTP helper 与每 Session 锁的收敛为可选，未做）。手动 `/compact` 不经预算检查，已写入 goal.md。
  - **越出 Write scope：** 无超出上面所列范围的改动。
  - **供后续票：** `ContextContribution.admissionHooks`（只拦截、无副作用的 hook，排在扩展之前）；`CokoTool.fixedSandbox`；`ToolBlockResult.hostBlock` / `HostBlock`（@coko/agent 导出）；`RunError.dimension`；`PlanReview.active()`；desktop Browser Mode 的 `src/renderer/testing/browser-setup.ts`；ui token `text-success-text`、`text-warning-text`、`text-terminal-*`。
  - **实际运行（main e0f129b 已合入，Already up to date）：** `pnpm run lint` 0 warnings / 0 errors；`pnpm run format:check` 通过；`pnpm run typecheck` 退出 0；`pnpm run check:docs` 157 个文件 0 问题；全量 `pnpm run test`（运行前等其他 vitest run 结束）退出 0：250 个文件，1951 通过、1 跳过，含 desktop E2E 与 package-smoke（3 例），无未处理错误。第一次全量有 1 例失败（jobs.e2e 仍以 destructive 色比较 ANSI 红，A12 的预期变化），改为 terminal-red 后单独重跑 2/2 通过，第二次全量通过（7f200d5）。
  - **未验证：** 非 darwin 平台（PTY 与 Seatbelt 用例按既有方式跳过）；A12 的颜色只按计算样式测量，没有人工截图检查。
