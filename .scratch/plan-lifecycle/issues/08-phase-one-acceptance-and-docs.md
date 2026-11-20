# 08: 阶段一集成验收与文档

**What to build:** 在真实应用里走通阶段一的主路径，逐条核对规格的阶段一用户故事，并让术语表、ADR 状态与当前行为文档和实现一致。本票结束即阶段一可独立交付。见 [规格](../spec.md) 的 User Stories 1–44 与 Testing Decisions。

**User stories:** 1–44（核对）

**Blocked by:** 05、06、07

**Status:** ready-for-agent

Closed: true

- [x] Electron 端到端用例（后台模式）：在“完全访问权限”下 `/plan` 进入，模式菜单仍勾选该模式；模型提交计划后右栏自动打开；在审阅卡上把权限改为另一档；批准并执行；从协议读回的模式为改后的那一档，计划卡显示已批准
- [x] 同一用例或另一条：Plan chip 的 × 退出规划，从协议读回不在规划中、模式不变
- [x] 规格的用户故事 1–44 逐条对应到通过的测试或证据；没有对应的列为缺口并说明
- [x] 术语表：Plan Mode 改为“Session 的规划阶段，不改动 Workspace，不是 Permission Mode”；Plan 的定义留到 12
- [x] 新 ADR 的实施状态更新为阶段一已实施、阶段二未开始
- [x] 当前行为文档从导航入口读回核验，与实现一致：Plan Mode、权限判定与审批、子代理、无界面运行、外部 Hook、命令执行、上下文管理、追踪与审计、桌面工作台，以及两个包的 README；文档导航中 Plan Mode 的摘要同步
- [x] 证据按 [证据模板](../../../docs/templates/evidence.md) 记录：对象版本、精确命令、环境、结果与限制
- [x] 如实报告未验证项：真实模型是否遵守新的 `<plan_mode>` 文本、非 darwin 平台的沙箱行为、需要真实指针或原生层的交互
- [ ] `pnpm run typecheck`、`pnpm run check:docs` 与本阶段受影响的测试文件通过；报告实际选中的用例数

## Comments

### 2026-11-20 实施完成（未关闭）

- **交付。** `apps/desktop/e2e/plan.e2e.test.ts` 新增用例：完全访问权限下 `/plan` 进入，模式菜单仍勾选该模式；chip 的 × 退出后从协议读回不在规划中、模式不变；模型提交计划后右栏自动打开；在审阅卡上改为自动接受编辑并批准，读回的模式为 accept-edits、计划卡与 Plan tab 为 approved（后台模式，通过）。`tests/integration/sidecar-plan.test.ts` 补故事 28、29（无反馈拒绝后仍在规划中；abort 与 pause 时计划审批 cancelled、计划保持 proposed）。术语表 Plan Mode、ADR 0028 → partial（新增“实施状态与证据”）、ADR 0005 与 ADR 导航的状态、`plan-mode.md` 的界面与验证节。证据：[阶段一验收](../evidence/phase-one-acceptance.md)。
- **全量对比。** 分支 577 文件 4 206 例中 92 失败；基于本地 `main`（`19e0ac5c`）的基线 569 文件 4 117 例中 99 失败。分支失败而基线不失败 3 项：
  1. `scripts/source-references.test.ts`：02–07 在 21 处测试注释中写了票号（本分支引入），已改为引用 ADR 0028。
  2. `secrets-gate-schedules.test.ts`：集成分支带入的 `origin/main` `3b214565`（默认基础提示列出 `<scheduled_task>` 标签名）使计数偏多，在 `3b214565` 上同样失败；已把筛选收紧为带 `schedule-id=` 的输入块。
  3. `plan.e2e.test.ts` 原有用例：基线同名用例以同样原因（附件选择后等不到文件引用）失败，未修。
  其余失败两边相同，`sidecar-memory` 两边都通过。逐项说明见证据。
- **与票面的偏离。**
  1. 05 报告的审阅卡换行：真实 Electron 中主区约 390px 时“批准并执行”独自换到第二行。按“先重排，再截断”改为三个按钮成组换行（执行权限放不下时独占一行），主区窄于 560px 时“在侧边栏查看”只显示图标并加 Tooltip；Browser Mode 新增 390px / 720px 用例（旧布局下失败）。
  2. `secrets-gate-schedules.test.ts` 的修正不属于计划工作，为让本分支相对基线没有新增失败而做。
  3. 原有 Plan E2E 用例的附件步骤与“Usage unavailable”页脚问题是基线已有的 E2E 失败（`references-drafts`、`approvals` 等同类），本票没有修。
- **用户故事缺口。** 13（规划中真实调用记忆、Todo 与 Goal 工具）只有单元判定表；6（非写入调用的询问规则）与 14（read / grep 的真实调用）的一部分只有单元判定表；5 的 Shift+Tab 没有真实 Electron 用例。
- **验证。** `pnpm run typecheck` 通过；`pnpm run check:docs` 通过（437 个文件 0 个问题）；`sidecar-plan` 与 `source-references` 2 个文件 17 例通过；`secrets-gate-schedules` 1 例通过；Browser Mode `plan`、`approval-panel`、`business-timeline` 3 个文件 37 例通过；E2E `plan` 与 `conversation-workbench-closeout` 2 个文件 8 例，5 通过、3 失败（均为基线同样失败）。
- **未勾选的一项。** “受影响的测试文件通过”未完全满足：`plan.e2e.test.ts` 的原有用例在附件步骤失败（基线同样失败，未修），其余受影响文件通过，用例数见“验证”。
- **未验证。** 真实模型是否遵守新的 `<plan_mode>` 文本；非 darwin 平台的沙箱行为；需要真实指针或原生层的交互（E2E 只在后台模式中经 CDP 驱动）。审阅卡上选择模式后 Tooltip 随焦点打开、盖住正文一行，输入区的模式菜单同样如此，未改。

### 关闭（2026-11-20）

已合入集成分支 `feat/plan-lifecycle`（最终 HEAD ecfcbde8，含代码审查修复）。
唯一未勾项：`plan.e2e` 原有用例卡在附件步骤，main 上同样失败（见 evidence/phase-one-acceptance.md），不属于本功能；其余受影响测试均通过。
