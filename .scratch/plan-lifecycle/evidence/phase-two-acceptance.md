---
kind: evidence
description: "计划阶段二（执行中、完成报告、放弃）验收：Electron E2E（后台模式）的完成与放弃路径、补齐 10 与 11 留下的集成缺口、用户故事 45–68 的证据映射与缺口、全量测试与基线失败的逐项对比、文档读回与未验证范围。"
lifecycle: active
---

# 计划阶段二验收

## 验证对象

- 规格与场景：[规格](../spec.md) 的用户故事 45–68 与 Testing Decisions 的阶段二部分；[设计](../design.md)。
- 实施票与相关决定：[12 号票](../issues/12-phase-two-acceptance-and-docs.md)；09–11 号票的逐票检查见各票 Comments；[ADR 0028](../../../docs/adr/0028-plan-phase-not-permission-mode.md)；阶段一见 [阶段一验收](phase-one-acceptance.md)。
- 基线与目标：目标为分支 `plan-lifecycle/12-phase-two-acceptance`，起点为集成分支 `feat/plan-lifecycle` 的 `0d0c191e`（01–11 已合入），加本票提交（提交标识以 Git 记录为准）。全量对比沿用阶段一的基线结果：本地 `main` 的 `19e0ac5c`（`git merge-base main feat/plan-lifecycle`），本票开始时本地 `main` 没有新提交，`origin/main` 仍为已并入集成分支的 `3b214565`，因此未重跑基线。全部为本地提交，未推送，CI 未运行。
- 环境：macOS 26.4（Darwin 25.4.0）arm64；Node 24.15.0；Electron 41.0.3。测试只替换模型服务（faux 脚本）与测试时钟；Sidecar、SQLite、HTTP / WebSocket、Seatbelt 沙箱与 Electron 为真实实现。Electron 用例以后台模式运行（harness 设置 `COKO_E2E_BACKGROUND=1`），不抢前台。

## 执行记录

| 命令或步骤 | 覆盖场景 | 实际范围与数量 | 结果 | 日志或产物 |
| --- | --- | --- | --- | --- |
| `pnpm exec vitest run --reporter=dot --reporter=json`（分支，加入本票新用例后、修复三项新增失败前） | 全量（含 desktop-e2e、evals、integration、Browser Mode） | 577 文件、4 234 例 | 98 失败、4 127 通过、9 跳过 | JSON reporter（未入库） |
| 阶段一的基线结果（本地 `main` `19e0ac5c` 的临时 worktree，未重跑） | 全量基线 | 569 文件、4 117 例 | 99 失败、4 006 通过、12 跳过 | JSON reporter（未入库） |
| 逐项对比两份 JSON 的失败用例 | 本分支新增的失败 | 分支失败而基线不失败 7 项 | 见“失败对比”：3 项为集成分支 08–10 引入（已修复），1 项为基线同样失败的用例改名，3 项为全量负载下的抖动（单独运行通过） | 本地终端 |
| `pnpm exec vitest run --project desktop-e2e apps/desktop/e2e/plan.e2e.test.ts -t "完成报告\|放弃"` | 票的两条 E2E（新增） | 2 例 | 通过；把 Plan tab 的 `data-slot="plan-report"` 改名、执行中 chip 的可访问名称改回 `plan.exit` 后两例分别失败（等不到报告；`expected 'Exit planning' to match …`），恢复后通过 | 本地终端 |
| `pnpm exec vitest run --project desktop-e2e apps/desktop/e2e/plan.e2e.test.ts apps/desktop/e2e/desktop-shell.e2e.test.ts`（全部修改之后） | Plan E2E 四例；桌面壳 | 2 文件 17 例 | 13 通过；4 失败均为基线同样失败的用例（见“E2E”） | 本地终端 |
| `pnpm exec vitest run tests/integration/sidecar-plan.test.ts -t "Run 进行中经计划接口放弃"` | 11 的缺口：Run 进行中放弃后本 Run 的 `complete_plan` | 1 例 | 通过；把 `completePlan` 改为找不到计划时静默返回后失败（`[false, "The plan is complete…"]`），恢复后通过 | 本地终端 |
| `pnpm exec vitest run tests/integration/sidecar-plan.test.ts -t "四种 Permission Mode"` | 10 的缺口：四种模式不询问；超长报告 | 1 例，约 2 秒 | 通过；把 `complete_plan` 的权限类改为 external 后失败（read-only 下出现第二条 `approval_request`，等待超时），恢复后通过 | 本地终端 |
| `pnpm exec vitest run tests/integration/sidecar-subagents-permissions.test.ts -t "规划中派发"` | 故事 68：子 Session 的工具表 | 1 例 | 通过；从 `SUBAGENT_EXCLUDED_TOOLS` 去掉 `complete_plan` 后失败（子级工具表含 `complete_plan`），恢复后通过 | 本地终端 |
| `pnpm exec vitest run` 受影响的 Node 测试：`sidecar-plan`、`sidecar-subagents-permissions`、`headless`、`secrets-gate-plan`、`sidecar-handoff`（integration），`style-guard`、`source-references`、`planning`、`definitions`、`fork` | 本票改动与修复涉及的文件 | 11 个文件项、171 例 | 通过 | 本地终端 |
| `pnpm exec vitest run --project desktop-renderer …/plan.browser.test.tsx …/business-timeline.browser.test.tsx` | Plan tab 报告区的边线改动 | 2 文件 38 例 | 通过 | 本地终端 |
| `pnpm run typecheck`、`pnpm run check:docs` | 类型、文档链接与结构 | 全仓 / 450 个 Markdown 文件 | 通过（0 个问题） | 本地终端 |

覆盖既有行为的补测没有可先失败的修复；上表以临时改坏实现（随后恢复）确认新断言能失败。

### 失败对比

分支失败、基线不失败的 7 项：

1. `tests/integration/headless.test.ts`“stream-json：每行是 ServerMessage…”：**集成分支引入（09）。** 09 把 `state_update` 升到 v2，该用例仍断言 `payloadVersion: 1`；单独运行稳定失败。断言改为 2，通过。
2. `packages/ui/src/guards/style-guard.test.ts`：**集成分支引入（10）。** Plan tab 完成报告区用了 `border-b`（`[material]` 违规）。改为与相邻页面相同的 `border-b-hairline border-border`，通过。
3. `apps/desktop/e2e/desktop-shell.e2e.test.ts`“Sidecar 重启连续失败达到上限…”：**集成分支引入（08 的 `bbbef0a4`：后台模式不弹原生错误框，只写日志）。** 该用例仍断言弹出一次对话框；08 的全量运行在这一提交之前，未发现。改为断言后台模式下没有对话框、`desktop.jsonl` 中恰有一条 `sidecar error dialog suppressed in e2e background mode { kind: crashed }`，其余（failed 状态、停止重连、4 个进程都已退出）不变，通过。同文件“Sidecar 启动失败时…”的用例基线也失败（日志目录 `/private/var/…` 与 `/var/…` 不一致），在分支上则先因对话框被抑制而失败；同样改为断言日志与窗口内的“打开日志文件夹”，现在只剩与基线相同的路径不一致，未修。两例改了标题。
4. `apps/desktop/e2e/plan.e2e.test.ts` 的原有用例：基线上同名用例标题不同（阶段一已改名），失败于同一个附件步骤（编辑区中等不到 `[data-file-reference="notes.txt"]`），属基线已有的失败，未修。
5. `conversation-workbench-closeout.e2e.test.ts` 的 CW-23/42/43、`integrated-detail.browser.test.tsx` 的 grep 高度用例、`apps/desktop/src/main/sidecar-process.test.ts` 的启动用例（5 秒超时）：单独运行均通过，判定为全量负载下的抖动，与计划改动无关。

两边都失败的 91 项（阶段一为 89 项）与本票无关：Electron E2E 30 项、设置页 Browser Mode 24 项、integration 10 项（`sidecar-approvals`、`sidecar-lsp`、`sidecar-recovery`、`sidecar-storage`、`sidecar-teams-restart`、`sdk-library`、`sidecar-attachments`、`sidecar-hooks-lifecycle`）、对话 Browser Mode 9 项、desktop main 6 项、renderer store 4 项及阶段一已列出的单元基线失败；比阶段一多出的 2 项是 `sidecar-process.test.ts` 的两例（基线同样失败）。只在基线失败的 8 项为基线自身问题或负载抖动。

### E2E

- 新增“批准后执行中 → 下一个 Run 拆待办并提交完成报告”：`/plan` 进入、提交任务、审阅卡上批准并执行；读回 `{ phase: executing, plan: approved }`，chip 为“执行中”，计划卡 `data-status="executing"`；再发一条消息，模型 `todo_write`（待办卡 1/2）后 `complete_plan`；读回 `{ phase: none, plan: null }`，chip 消失，计划卡 `data-status="completed"`，Plan tab 为 completed 且 `plan-report` 含报告中“没做”的一项。通过。
- 新增“执行中点 Plan chip 的 × 放弃”：模式菜单选自动接受编辑，规划、批准，模型写入 `draft.md`；读回执行中；chip 的可访问名称为“Abandon plan / 放弃计划”，点击后不弹确认、chip 消失，读回 `{ phase: none, plan: null }`，计划卡与 Plan tab 为 abandoned，`draft.md` 内容不变，模式仍为 accept-edits。通过。
- 阶段一的“完全访问权限下规划…”用例通过；原有用例失败于附件步骤（基线同样失败）。

### 补齐前序票的缺口

- **11：Run 进行中放弃后本 Run 再调用 `complete_plan`。** `sidecar-plan`“Run 进行中经计划接口放弃…”在写入之后加一次 `complete_plan`：错误结果为“No plan is being carried out…”，计划条目为 proposed、approved、abandoned，没有 completed，阶段序列为 planning、executing、none。
- **10：四种 Permission Mode 不询问、超长报告。** `sidecar-plan` 新增用例在同一个 Session 中依次以 read-only、default、accept-edits、full-access 规划、批准并 `complete_plan`：每轮只有计划审阅一条审批，完成后读回无、模式读回为该轮模式；read-only 一轮先提交 64 001 字符的报告，得到 `Invalid report: the report is longer than 64000 characters. …` 且不提交条目。超长参数按 faux 缺省的小块流式输出过慢（10 报告超过 120 秒），本票给 faux 脚本加了可选的 `tokenSize`（透传 pi-ai faux 的同名选项），该用例用 4 096 token 一块，约 2 秒。
- **规格列出、此前只有单元覆盖的两项。** 故事 67 的分叉：`sidecar-plan`“批准后执行中…”在执行中按最后一条用户消息分叉，新 Session 没有 `plan` 与 `plan_phase` 条目，读回 `{ phase: none, plan: null }`，源仍在执行中（交接已有 `sidecar-handoff` 用例）。故事 68：`sidecar-subagents-permissions` 的规划中派发用例断言根 Session 注册 `exit_plan_mode` 与 `complete_plan`，子 Session 的工具表两者都没有。

### 用户故事对照

| 故事 | 证据 |
| --- | --- |
| 45 | `sidecar-plan`“批准后执行中…”（读回执行中与活动计划）；`plan.browser`“执行中：chip 显示执行中…”；E2E 完成用例 |
| 46 | `sidecar-plan` 批准结果为 T8（先 `todo_write` 拆解）；E2E 完成用例（faux 先写待办，待办卡 1/2）。**未验证**：真实模型是否先拆 Todo |
| 47 | `sidecar-plan`“批准后执行中：不先调用 todo_write 的写入照常按模式询问并写入…” |
| 48 | `sidecar-plan`“批准后执行中…”（下一个带新输入的 Run 首块为 plan State Update，值不变不重复）；`state-updates.test` |
| 49 | `sidecar-plan`“执行中：压缩把计划摘要掉后注入 <approved_plan> 并重发 plan State Update…”；`planning.test`（只在执行中再注入） |
| 50 | `sidecar-plan`“批准后执行中…”（没有 Goal 时 Run 结束后 1.5 秒内没有新的 Run） |
| 51 | `plan.browser`“执行中：chip 显示‘执行中’且几何与规划中相同…”；E2E 两例 |
| 52 | `sidecar-plan`“complete_plan：…成功时依次提交 completed（带报告）…”；`planning.test`（工具说明 T9）；E2E 完成用例。**未验证**：真实模型是否在做完后调用、报告是否逐项对照计划 |
| 53 | 工具说明要求写明没做与偏离（`planning.test` 校验 T9 文本）；报告按原文保存与显示（`sidecar-plan`、E2E 中“Not done…”一项可见）。**未验证**：真实模型是否照写 |
| 54 | `plan.browser`“完成：…计划卡与 Plan 页显示‘已完成’，Plan 页显示完成报告…”；E2E 完成用例。按设计，计划卡显示状态、报告在 Plan 页 |
| 55 | `sidecar-plan` complete_plan 用例（只有计划审阅一条审批）；四种模式用例 |
| 56 | `sidecar-plan`“跨 Run 完成：下一个 Run 送达一次清空、不再注入计划…”；`plan.browser` 完成用例；E2E 完成用例（chip 消失） |
| 57 | `sidecar-plan` complete_plan 用例（完成后的 Run 没有提交与完成工具、没有计划 section）与跨 Run 完成用例 |
| 58 | `sidecar-plan` complete_plan 用例（规划中调用）；“Run 进行中经计划接口放弃…”（本票补）；`planning.test`（宿主拒绝时的文本） |
| 59 | `sidecar-plan`“complete_plan 在四种 Permission Mode 下都不询问…”（本票补）；`planning.test` |
| 60 | `sidecar-plan`“执行中 /plan off 放弃…”与“Run 进行中经计划接口放弃…”；`plan.browser` 放弃用例；E2E 放弃用例（chip ×） |
| 61 | `sidecar-plan`“执行中 /plan off 放弃…”（文件逐字节不变、Checkpoint 列表不变）；E2E 放弃用例（`draft.md` 仍在） |
| 62 | `plan.browser` 放弃用例；E2E 放弃用例 |
| 63 | `sidecar-plan`“执行中 /plan off 放弃…执行中再 /plan：旧计划放弃、进入规划…新计划新编号从修订 1 开始” |
| 64 | 同上（写入为 T3、文件不存在） |
| 65 | 同上（`GET` 只读回新的 proposed 计划）；`planning.test`（`activePlanOf`）；`plan.browser`（重新规划后 chip 为“计划”） |
| 66 | `sidecar-plan`“跨 Run 完成…回退到完成所在 Run 的用户消息后读回执行中”与“…回退到放弃之前回到执行中”；`plan.browser` 完成用例的回退 |
| 67 | `sidecar-handoff`“源在执行中：目标 Session 没有计划阶段…”；`sidecar-plan`“批准后执行中…”中的分叉（本票补）；`fork.test` |
| 68 | `sidecar-subagents-permissions` 规划中派发用例（子级工具表没有 `complete_plan`，本票补）；`definitions.test`（固定排除） |

规格 Testing Decisions 阶段二的集成覆盖项都有对应用例；完成报告的登记明文替换见 `secrets-gate-plan`（10）。没有无证据的故事；46、52、53 中依赖真实模型的部分未验证。

## 文档影响

| 行为或正文变化 | 所属文档 | 受影响引用、摘要与入口 | 已完成动作 | 检查结果与缺口 |
| --- | --- | --- | --- | --- |
| Plan 贯穿到结果反馈 | [GLOSSARY](../../../GLOSSARY.md) | 无 | 修改 Plan 的定义（五种状态、至多一份进行中） | 读回一致 |
| 阶段二已实施 | [ADR 0028](../../../docs/adr/0028-plan-phase-not-permission-mode.md) | [ADR 导航](../../../docs/adr/README.md) 的状态列 | `implementation` 改为 implemented，实施状态、验证与未验证项更新 | `check:docs` 通过 |
| 新增 E2E 与集成断言；修正结构表重复行与“计划卡显示报告”的说法 | [Plan Mode](../../../docs/subsystems/plan-mode.md) | [文档导航](../../../docs/README.md) 的 Plan Mode 摘要已含执行中、完成与放弃（09–11 同步），无需改 | 修改概述、结构入口、验证 | 读回一致 |
| Todo 与计划的关系 | [Todo List](../../../docs/subsystems/todo.md) | 无 | 新增“与计划的关系” | 与批准结果文本及实现一致 |
| Goal 与计划不新增关联 | [Goal](../../../docs/subsystems/goal.md) | 无 | 在阶段与转换中补一段 | 与 `goals.ts` 只处理计划审阅一致 |
| 审计中完成与放弃的表现 | [追踪与审计](../../../docs/subsystems/tracing.md) | 无 | `plan_phase` 行补充说明 | 与 `audit.ts` 一致 |
| faux 脚本的 `tokenSize` | `apps/server/README.md` | 无 | 补充脚本选项 | 读回一致 |
| 当前行为读回 | [上下文管理](../../../docs/subsystems/context.md)、[桌面工作台](../../../docs/subsystems/workbench.md)、`packages/agent` 与 `packages/protocol` 的 README | 无 | 从导航入口读回：State Update `plan`、`<approved_plan>` 只在执行中、输入区计划状态组的规划中与执行中、`complete_plan` 与条目版本，与实现一致；未改 | 无缺口 |

## 结论与限制

- 阶段二的票面验收在本地满足：两条 Electron E2E（完成与放弃）在后台模式通过；用户故事 45–68 均有对应证据，10 与 11 留下的集成缺口已补，故事 67 的分叉与 68 的子级工具表补了集成断言。
- 全量运行中相对基线新增的失败：3 项由集成分支引入并已修复（`state_update` v2 的 headless 断言、Plan tab 报告区的边线、后台模式不弹对话框后的桌面壳用例），其余为基线已有失败或负载抖动（单独运行通过）。修复后未再跑一次全量，只重跑了受影响的文件。
- 未验证：真实模型是否先拆 Todo、是否在做完后调用 `complete_plan`、报告是否逐项对照计划（只经 faux 请求日志与工具说明文本验证链路）；非 darwin 平台的沙箱行为；需要真实指针或原生层的交互（E2E 经 CDP 在后台模式驱动，没有真实鼠标，原生错误框在后台模式中被抑制，其内容不再由 E2E 覆盖）。
- 结论只对应上述本地提交；未推送、未合并到 main，CI 未运行。合入集成分支后的变化会使全量对比失效。
