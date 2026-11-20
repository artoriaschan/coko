---
kind: evidence
description: "计划从权限模式剥离的阶段一验收：Electron E2E（后台模式）、用户故事 1–44 的证据映射与缺口、全量测试与基线失败的逐项对比、审阅卡窄宽度的修正、文档读回与未验证范围。"
lifecycle: active
---

# 计划阶段一验收

## 验证对象

- 规格与场景：[规格](../spec.md) 的用户故事 1–44 与 Testing Decisions 的阶段一部分；[设计](../design.md)。
- 实施票与相关决定：[08 号票](../issues/08-phase-one-acceptance-and-docs.md)；02–07 号票的逐票检查见各票 Comments；[ADR 0028](../../../docs/adr/0028-plan-phase-not-permission-mode.md)。
- 基线与目标：目标为分支 `plan-lifecycle/08-phase-one-acceptance`，起点为集成分支 `feat/plan-lifecycle` 的 `7cc98dd0`（01–07 已合入），加本票提交（提交标识以 Git 记录为准）。全量对比的基线为本地 `main` 的 `19e0ac5c`（即 `git merge-base main feat/plan-lifecycle`）；集成分支另含 `origin/main` 的 `3b214565`（记忆分层注入与默认基础提示），本地 `main` 未更新到它，个别差异用 `3b214565` 复核（见下）。全部为本地提交，未推送，CI 未运行。
- 环境：macOS 26.4（Darwin 25.4.0）arm64；Node 24.15.0；Electron 41.0.3。测试只替换模型服务（faux 脚本）与测试时钟；Sidecar、SQLite、HTTP / WebSocket、Seatbelt 沙箱与 Electron 为真实实现。Electron 用例以后台模式运行（harness 设置 `COKO_E2E_BACKGROUND=1`），不抢前台。

## 执行记录

| 命令或步骤 | 覆盖场景 | 实际范围与数量 | 结果 | 日志或产物 |
| --- | --- | --- | --- | --- |
| `pnpm exec vitest run --reporter=dot --reporter=json`（分支，改动前） | 全量（含 desktop-e2e、evals、integration、Browser Mode） | 577 文件、4 206 例 | 92 失败、4 105 通过、9 跳过 | JSON reporter（未入库） |
| 同上，在基于本地 `main`（`19e0ac5c`）的临时 worktree | 全量基线 | 569 文件、4 117 例 | 99 失败、4 006 通过、12 跳过 | JSON reporter（未入库） |
| 逐项对比两份 JSON 的失败用例 | 本分支新增的失败 | 分支失败而基线不失败 3 项 | 见下文“失败对比”：1 项为本分支引入（已修复），1 项为集成分支带入的 `origin/main` 改动（已修复），1 项为基线同样失败的用例改名 | 本地终端 |
| `pnpm exec vitest run --project desktop-e2e apps/desktop/e2e/plan.e2e.test.ts -t 完全访问权限` | 票的 E2E 主路径（新增用例） | 1 例 | 通过（多次） | 本地终端；截图见“审阅卡窄宽度” |
| `pnpm exec vitest run --project desktop-e2e apps/desktop/e2e/plan.e2e.test.ts apps/desktop/e2e/conversation-workbench-closeout.e2e.test.ts` | Plan E2E 两例；工作台收尾（含已有会话的规划与自动压缩） | 2 文件 8 例 | 5 通过（Plan 新增用例、收尾 4 例含 CW-66/88）、3 失败（均为基线同样失败的用例，见下文“E2E”） | 本地终端 |
| `pnpm exec vitest run tests/integration/sidecar-plan.test.ts scripts/source-references.test.ts` | 新增故事 28、29 的集成用例；源码中的任务材料引用 | 2 文件 17 例 | 通过 | 本地终端 |
| `pnpm exec vitest run tests/integration/secrets-gate-schedules.test.ts` | 定时任务秘密总闸 | 1 例 | 修改前失败（分支与 `3b214565` 都失败，`19e0ac5c` 通过）；修改后通过 | 本地终端 |
| `pnpm exec vitest run --project desktop-renderer apps/desktop/src/renderer/features/conversation/{plan,approval-panel,business-timeline}.browser.test.tsx` | 审阅卡、审批面板、时间线计划卡 | 3 文件 37 例 | 通过；新增的 390px / 720px 按钮行用例在旧布局下失败（`expected 2 to be 1`，按钮分两行），换回新布局后通过 | 本地终端 |
| `pnpm run typecheck`、`pnpm run check:docs` | 类型、文档链接与结构 | 全仓 / 436 个 Markdown 文件 | 通过（0 个问题） | 本地终端 |

### 失败对比

分支失败、基线不失败的 3 项：

1. `scripts/source-references.test.ts`“源码中没有任务材料引用”：**本分支引入。** 02–07 在 21 处测试注释中写了“票 03 / 04 / 06”，各票只跑了相关子集，未发现。已把这些注释改为引用 ADR 0028，改后通过。
2. `tests/integration/secrets-gate-schedules.test.ts`：分支上单独运行稳定失败（请求日志中含 `<scheduled_task` 的请求为 4 条而不是 2 条）。在 `3b214565`（`origin/main`，集成分支的祖先）上同样失败，在本地 `main` 上通过：默认基础提示的 system 文本列出了 `<scheduled_task>` 标签名，使不含该输入块的请求也被计入。不是计划工作引入，但相对给定基线是新增失败；已把筛选条件收紧为带 `schedule-id=` 的输入块，秘密扫描范围不变，改后通过。
3. `apps/desktop/e2e/plan.e2e.test.ts` 的原有用例：基线上同名用例（标题为“…模式恢复…”）以同样原因失败——附件选择后编辑区中等不到 `[data-file-reference="notes.txt"]`；`references-drafts.e2e.test.ts` 的同类步骤在两边也都失败。属于基线已有的失败，本票未修。

两边都失败的 89 项与本票无关，按类别：Electron E2E 约 30 项（多为最后一条助手消息的 `textContent` 带上了“Usage unavailable”页脚、以 `data-permission-mode` 读到 default 而非 full-access 的 dock / run-control 前置、窗口几何与附件选择）；Browser Mode 的设置页、文件与终端详情等约 40 项；以及各票已报告的基线失败（`engine/host-stop` 2、`policy/approvals` 1、`policy/gate-hooks` Hook deny 条目顺序 1、`instructions/shared` 1、renderer store 4、`protocol/entries` M2–M6 kind 1）。`sidecar-memory` 在两边都通过（07 已修）。只在基线失败的 9 项为基线自身问题或负载抖动。

### E2E

- 新增用例（`plan.e2e.test.ts`“完全访问权限下规划…”）：在模式菜单选完全访问权限并确认风险；`/plan` 进入后协议读回 `{ phase: planning, mode: full-access }`，模式按钮仍为 full-access，打开菜单时完全访问权限一项 `aria-checked="true"`；Plan chip 的 × 退出后读回 `{ phase: none, mode: full-access }`；再次进入并提交消息，模型提交计划后审阅卡出现、右栏自动打开且 Plan tab 选中，读回计划为 proposed；在审阅卡上用模式菜单改为自动接受编辑，读回模式为 accept-edits、审阅卡仍在；批准并执行后读回 `{ phase: none, mode: accept-edits }`，输入区模式按钮为 accept-edits、chip 不在、时间线计划卡与 Plan tab 为 approved。通过。
- 原有用例：失败于附件步骤（基线同样失败，见上）。
- `conversation-workbench-closeout.e2e.test.ts`：07 改过断言的 CW-66/88（已有会话的规划、上下文告警与自动压缩，`/plan` 后模式为 default）在全量运行与单独运行中都通过；同文件另 2 例（只发图片的提示词估算、窄宽度工作台几何）基线同样失败。

### 审阅卡窄宽度

05 号票报告窄宽度下“批准并执行”换行。在真实 Electron（后台模式）中截图：窗口 1280×820、左栏与右栏都展开时主区约 390px，原布局下“执行权限”、“在侧边栏查看”、“继续规划”在第一行，“批准并执行”独自换到第二行。按[界面约定](../../../docs/tech-stack/ui.md)“先重排，再截断”与仅图标的条件修正：三个按钮成组换行，放不下时“执行权限”独占一行；主区窄于 560px 时“在侧边栏查看”与模式菜单一样只显示图标，保留可访问名称并加 Tooltip。修正后同一窗口中为两行（执行权限 / 三个按钮），窗口 1000×820 时全部在一行。截图在会话 scratchpad（未入库）。Browser Mode 用例断言 390px 时三个按钮同一行、执行权限在其上方、标签不可见，720px 时全部同一行、标签可见。

另见：审阅卡上选择模式后焦点回到触发按钮，Radix Tooltip 随焦点打开并盖住正文一行，直到焦点移开。输入区的模式菜单是同一组件、同一行为，本票未改。

### 用户故事对照

| 故事 | 证据 |
| --- | --- |
| 1 | `sidecar-plan` “/plan 进入不改变模式…”“计划接口…”；E2E 新增用例 |
| 2 | `sidecar-plan` “完全访问权限下规划…”；`sidecar-tool-search-keywords` “while planning under full-access…” |
| 3 | `sidecar-plan` “/plan 进入不改变模式…”（default 下命令询问）；`sidecar-tool-search-keywords` “…under default, an MCP call asks” |
| 4 | `plan.browser`（模式菜单勾选当前模式）；E2E 新增用例（`aria-checked`） |
| 5 | `sidecar-plan` “/plan off…；规划中切换模式不退出规划…”；`chat-store-permissions` “规划中切换模式（含 Shift+Tab 的下一档）…”。真实 Electron 中规划时按 Shift+Tab 未覆盖（`permissions.e2e` 的 Shift+Tab 用例基线即失败） |
| 6 | `decide.test` “Permission Mode × 是否规划中 × 工具类型”（拒绝规则先于规划步；非写入调用与不在规划中逐项相同）、memory-write 的询问与拒绝规则；`sidecar-hooks`（Hook deny 优先）。**部分缺口**：非写入调用的询问规则在规划中生效只在单元判定表中以“与不在规划中相同”覆盖，没有专门的集成用例 |
| 7 | `sidecar-plan` 首例与“/plan 进入…”（T3、无审批、文件不存在） |
| 8 | `sidecar-plan` 首例（允许规则）；`sidecar-hooks` “全局 Hook 的 allow 不免掉规划中的写入” |
| 9 | `sidecar-plan` 首例与“完全访问权限下规划”（darwin 只读沙箱拒绝） |
| 10 | `sidecar-plan` 首例（提权参数直接出错、不询问）；`escalation.test` |
| 11 | `sidecar-plan`（T3 全文） |
| 12 | `sidecar-pty` “Job 在较宽档位启动、之后进入规划…” |
| 13 | `decide.test`（memory-write、session-state 在规划中与不在规划中相同）；`sidecar-tool-search-keywords` “Plan Mode can search…”。**缺口**：规划中真实调用 `memory_write`、`todo_write` 与 Goal 工具没有集成用例 |
| 14 | `decide.test`（读取、grep 与不在规划中相同）；`sidecar-plan` “完全访问权限下规划”（`ls` 成功）。**部分缺口**：规划中 read / grep 工具的真实调用没有专门的集成断言 |
| 15 | `sidecar-plan` “/plan 进入…”“计划接口…” |
| 16 | `sidecar-plan` “/plan off 与计划接口退出…”；`plan.browser`（chip ×）；E2E 两例 |
| 17 | `sidecar-plan` “计划接口…首次发送拒绝 plan，/plan 消息以规划开始” |
| 18 | `sidecar-plan` “…Run 进行中 /plan 为 409” |
| 19 | `plan.browser` “退出失败：chip 保留…”；`chat-store-permissions` |
| 20 | `sidecar-plan` “计划接口：…GET / POST 读回；校验与 404” |
| 21 | `sidecar-plan` “带反馈拒绝…切换接口拒绝 plan”“计划接口…” |
| 22 | `planning.test` “必须以 # 标题开头…”“计划没有 # 标题”；`sidecar-plan` |
| 23 | `plan.browser` `plan-review-permission`；E2E 新增用例 |
| 24 | `plan.browser` `plan-review-permission`；`sidecar-plan` 审阅等待中放宽与收紧两例；E2E 新增用例 |
| 25 | `sidecar-plan` “/plan 进入…”“完全访问权限下规划”；E2E 新增用例 |
| 26 | `sidecar-plan` “/plan 进入…编辑后批准：新 revision”；`plan.browser`（右栏编辑随批准提交） |
| 27 | `sidecar-plan` “带反馈拒绝…” |
| 28 | `sidecar-plan` “无反馈拒绝后 Run 结束、仍在规划中…”（本票新增）；`planning.test` |
| 29 | `sidecar-plan` 同一用例的 abort 与 pause 两例（本票新增：审批 cancelled、计划保持 proposed、仍在规划中） |
| 30 | `sidecar-goal` “Goal Round 中的计划审阅：Goal 进入 waiting-input（plan-review）…” |
| 31 | `sidecar-subagents-permissions` “根 Session 规划中派发的子代理…” |
| 32 | 同上；`agents/definitions.test` |
| 33 | `sidecar-subagents-isolation` “…规划中为错误结果”；`subagents-dispatch.test` |
| 34 | `sidecar-subagents-permissions`（system 中是子 Session 的 `<plan_mode>`）；`subagents` 工具排除集 |
| 35 | `sidecar-plan` “…分叉规划中的 Session”；`sidecar-handoff` “源在规划中…”；`sidecar-rewind`；`fork.test` / `handoff.test` |
| 36 | `sidecar-plan` “回退到 /plan 消息本身仍在规划中；回退到进入规划之前…”；`plan.browser`（回退条目） |
| 37 | `sidecar-plan` “回退到批准所在 Run 的用户消息…” |
| 38 | `sidecar-schedules` “规划中的 Session 上到期的定时任务…” |
| 39 | `headless.test` “--permission-mode plan 是参数错误…” |
| 40 | `sidecar-hooks`（Hook 收到的 permission_mode 是真实模式） |
| 41 | `sidecar-plan` “旧数据…”；`session-permissions.test`；`decide.test` v2 → v3 |
| 42 | `sidecar-plan` “旧数据…已提交的计划仍可读”；`plan.browser`（旧数据 Session） |
| 43 | `sidecar-plan` “旧数据…不在规划中、没有 <plan_mode> 与 exit_plan_mode” |
| 44 | `new-chat-store.test`；`chat-store-permissions.test` |

## 文档影响

| 行为或正文变化 | 所属文档 | 受影响引用、摘要与入口 | 已完成动作 | 检查结果与缺口 |
| --- | --- | --- | --- | --- |
| Plan Mode 改为 Session 的规划阶段 | [GLOSSARY](../../../GLOSSARY.md) | Plan 的定义留到阶段二 | 修改定义与 Avoid | 读回一致 |
| 阶段一已实施 | [ADR 0028](../../../docs/adr/0028-plan-phase-not-permission-mode.md)、[ADR 0005](../../../docs/adr/0005-permission-mode-and-sandbox.md) | [ADR 导航](../../../docs/adr/README.md) 的状态列 | 0028 改为 partial 并新增“实施状态与证据”；0005 两处“未实施”改为阶段一已实施 | `check:docs` 通过 |
| 审阅卡按钮行的重排；E2E 与新增集成用例 | [Plan Mode](../../../docs/subsystems/plan-mode.md) | [文档导航](../../../docs/README.md) 的 Plan Mode 摘要已是计划阶段（06、07 同步），无需改 | 修改“界面”与“验证”，去掉验证节中的票号 | 读回一致 |
| 当前行为文档读回核验 | [权限判定与审批](../../../docs/subsystems/permissions.md)、[子代理](../../../docs/subsystems/subagents.md)、[无界面运行](../../../docs/subsystems/headless.md)、[外部 Hook](../../../docs/subsystems/hooks.md)、[命令执行](../../../docs/subsystems/execution.md)、[上下文管理](../../../docs/subsystems/context.md)、[追踪与审计](../../../docs/subsystems/tracing.md)、[桌面工作台](../../../docs/subsystems/workbench.md)、`apps/server`、`packages/agent` 与 `packages/protocol` 的 README | 无 | 从导航入口读回：规划不改模式、规划中写入拒绝与只读沙箱、子代理有效模式、`--permission-mode plan` 参数错误、Hook 的真实模式、PTY 输入拒绝、`<approved_plan>`（阶段一不变）、`plan_phase` 审计事件、输入区计划状态组，与实现一致；未改 | 无缺口 |

## 结论与限制

- 阶段一的票面验收在本地满足：E2E 主路径（完全访问权限、审阅卡切换权限、chip 退出，均从协议读回）通过；用户故事 1–44 均有对应证据，13 与 6、14 的一部分只有单元判定表、没有集成用例，5 的 Shift+Tab 没有真实 Electron 用例。
- 全量运行中本分支新增的失败已修复（源码注释中的票号；随集成分支带入的 `origin/main` 基础提示使定时任务秘密总闸计数偏多）。其余失败基线同样存在，包括 `plan.e2e.test.ts` 原有用例的附件步骤。
- 未验证：真实模型是否遵守新的 `<plan_mode>`、写入拒绝与批准结果文本（只经 faux 请求日志验证链路）；非 darwin 平台上规划中命令的沙箱行为；需要真实指针或原生层的交互（E2E 在后台模式中经 Playwright 驱动，没有真实鼠标）。
- 结论只对应上述本地提交；未推送、未合并到 main，CI 未运行。合入集成分支后的变化会使全量对比失效。
