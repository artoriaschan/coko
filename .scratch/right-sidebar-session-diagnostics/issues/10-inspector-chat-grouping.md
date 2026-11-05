# 10: 诊断页的对话分组

**What to build:** 诊断页的“对话分组”可以完整使用。

- **数据来源。** 主时间线每次提交后，把它算出的投影（时间线行、显示身份、过程分组和 Run）发布到按 Session 区分的发布点，诊断页订阅这个发布点。主时间线的计算方式不变。
- **行与列。** 过程分组是组行，成员放在它下面；其他时间线行是根行；时间线上不单独成行的项不出现。序号是投影身份，类型是过程分组或时间线行的种类，Run 是所属 Run 的序号，没有时间列。
- **详情。** 选中行后，详情用对象树显示该行在当前投影中的值：按需展开，集合分批展开，getter 只显示标记、不执行，循环引用显示祖先路径。
- **引用与面包屑。** Run、过程分组、时间线行和来源 Session Entry 都有引用按钮。点击后打开它当前的值，并增加一级面包屑；点击前面的面包屑，返回该级；第一级保留最初选中的行。引用有对应的表格行时，展开它的父级组，滚动定位并闪烁该行。目标被筛选排除时，先清除筛选。
- **更新。** 投影更新时，身份不变的行保留展开与选中状态；新增和更新的行用约 700ms 的背景淡出高亮，减少动态效果时不播放。
- **定位到时间线。** 见 11。

**规格场景:** [spec](../spec.md) 中 AC-24、25 的表格部分；对应 INS-07、14、15、16，以及 INS-06 中“引用导航时先清除筛选”的规则。

**设计依据:** [design](../design.md) 的“投影发布点”模块、“对话分组与定位”中的发布投影，以及备选方案中的“对话分组的数据”。

**文档影响:** 会话数据诊断当前行为说明中的对话分组；workbench 中关于主时间线发布投影的说明。

**Blocked by:** 07 — 诊断页的原始数据

**Status:** ready-for-agent

**Closed:** true

- [x] 组行、成员行与根行分别对应时间线的过程分组和时间线行。序号就是主时间线发布的身份。没有时间列。（AC-24）
- [x] 引用跳转与面包屑符合 INS-15：每跳一次增加一级，点击第一级回到最初的行；有对应的表格行时，展开父级组、定位并闪烁；目标被筛选排除时，先清除筛选。（AC-25）
- [x] 投影更新时，保留展开与选中状态，新增和更新的行高亮；减少动态效果时不播放。（AC-24）
- [x] 主时间线的渲染与交互不变：过程分组、显示身份和阅读位置的现有测试照常通过。
- [x] 对象树的展开规则有单测。真实 App 的 Browser Mode 覆盖以上场景。
- [x] 按测试约定运行最小相关测试集与类型检查，同步上述文档；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户回复“全部采用推荐”，确认 12 张票及其阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。


- 2026-11-05 实施：主区 `ConversationPane` 显式开启投影发布；`ProcessTimeline` 在 layout effect 中发布本次实际计算的 seats、identities、items、runs 与已渲染 key，`TimelineView` 附加当前 Session 的原始 entries。无第二次过程分组或身份计算；子 Session、回退历史未开启发布，卸载按挂载 owner 释放。Plan 的 null 判定与主渲染共用，空思考、隐藏底栏及 Job 生命周期不造诊断行，但保留过程边界。
- 对话分组直接引用本次投影中的原值，建立 Run/过程组/行/来源 Entry 的原对象索引；工具同时记录 assistant 调用来源与 toolResult 来源 seq。对象树按需展开、每批 50 项、描述符访问器标记、数组空槽/符号/Map/Set/二进制值、祖先循环路径和分支错误隔离已接入。额外用原生 Map/Set getter 屏蔽测试修正参考实现会读取覆盖 size/iterator getter 的缺口。
- 引用打开当前原值并追加面包屑，首级保留最初选择；共享表格的 `revealRequest` 展开祖先、滚动到虚拟行并用 700ms 高亮，不替换详情根。目标被筛掉时才清除筛选，上下文目标保留筛选；用户确认筛选调用 `onSelect(null)` 重置路径。投影更新保留同身份的选择/展开，变化按描述符比较，不序列化或仅凭席位对象分配高亮；700ms 变化提示遵守真实 Chromium reduced-motion 偏好。
- 各时间线原有语义根增加身份、Run、来源 seq 和工具调用 id 等属性，未新增 DOM 包装或改变阅读锚点。只提供后续定位所需的 `DiagnosticTarget` 元数据，本票不实现 11 的主区定位/瞄准。
- 红绿证据：对象值移植测试先因缺失模块失败，移植后 7/7；新增 Map/Set 覆盖 getter 测试先因 `must not read` 失败，改用内建访问器/迭代方法后 8/8。实际 App 分组测试先找不到工具行（原分组页为空），之后逐步覆盖引用、懒枚举、分页、循环、发布更新、空 Plan 边界、减少动态效果、筛选引用与真实虚拟行几何。所有业务 store 与 App 组装均为真实实现，fixture 只替代网络输入。
- 集成：已在本分支合并共同集成点 `d22b9135860449c445f9c347f2089360d51b4e22`（08+09+原生预检修复），保留 App 的 `DiagnosticProgressProvider`、原始模型的 progress augmentation、类型筛选强制上下文展开、所有同批文案与说明。冲突只在共同组装/表格/文档处，按双方意图解决。
- 检查（命令均从本 worktree 根、通过 rtk 执行）：`pnpm install --frozen-lockfile` 退出 0；`pnpm run typecheck` 退出 0；`pnpm run test apps/desktop/src/renderer/features/session-diagnostics/object-value.test.ts apps/desktop/src/renderer/features/session-diagnostics/type-filter.test.ts apps/desktop/src/renderer/features/session-diagnostics/progress-model.test.ts packages/i18n/src/domains.test.ts` 为 4 文件 25/25；`pnpm run test apps/desktop/src/renderer/features/session-diagnostics/object-value.test.ts apps/desktop/src/renderer/features/conversation/process-groups.test.ts apps/desktop/src/renderer/features/conversation/timeline.test.ts` 为 3 文件 24/24。新分组 App 用例单文件 7/7；原有过程、阅读、专用详情、协作 App 用例与分组前五例联合为 5 文件 63/63；最终合并后的联合 Browser Mode 检查结果见下条。
- 文档影响：主区投影所有权 → `docs/subsystems/workbench.md`；对话分组、对象树、引用、更新与验证入口 → `docs/subsystems/session-diagnostics.md`；总入口摘要 → `docs/README.md`。均原位更新，保留 08 类型筛选与 09 进度正文；正式文档不依赖本任务材料。`pnpm run check:docs` 检查 344 文件、0 问题，退出 0；从 AGENTS → docs/README → 两篇正文读回，路径/引用、语义、归属/权威、引用方向、生命周期、当前入口、新会话范围与历史保留均通过，无文档缺口。
- 范围限制：实际 Electron/CDP、打包资源和真实指针/原生层的最终联合验收按计划集中在 12；本票未执行这些入口，不把 Browser Mode 当成原生窗口验收。未运行真实模型、全仓测试或 CI。提交仅本地功能分支，不推送、不修改 main。

- 最终合并后联合验证：`pnpm run test apps/desktop/src/renderer/features/session-diagnostics/grouping.browser.test.tsx apps/desktop/src/renderer/features/session-diagnostics/raw-data.browser.test.tsx apps/desktop/src/renderer/features/session-diagnostics/live-progress.browser.test.tsx apps/desktop/src/renderer/features/conversation/process-groups.browser.test.tsx apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx apps/desktop/src/renderer/features/conversation/integrated-detail.browser.test.tsx apps/desktop/src/renderer/features/conversation/collaboration.browser.test.tsx` 选中 7 文件、73/73 通过，退出 0（含新增的虚拟成员引用揭示真实滚动几何）。`pnpm run typecheck` 再次退出 0；`pnpm run check:docs` 344 文件、0 问题、退出 0；所改诊断模块/投影/共享 ToolCard 的 `pnpm exec oxlint …` 与 `git diff --check` 退出 0。共享 ToolCard 浏览器消费者此前实际执行 2 例通过（与当时分组 3 例合计 2 文件 5/5），其实现之后未再改变。验收项依本票范围关闭，原生联合入口仍留给 12。
