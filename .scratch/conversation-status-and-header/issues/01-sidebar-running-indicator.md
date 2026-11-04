# 01: 侧栏“执行中”转圈（Session 行与项目行）

**What to build:** 用户在侧栏看得出哪些 Session 正在执行。Session 的 Run 正在执行时，它的行右侧显示转圈；收起的项目中有执行中的未置顶成员时，项目行显示同样的转圈。鼠标悬停或键盘焦点进入时，转圈换回原有的操作按钮；开启减少动态效果时转圈不转动。本票只用列表现有的 `running` 字段，所以当前窗口没打开过的 Session 要等列表刷新才更新；实时更新以及后台 Subagent 和 Teammate 由 02 补上。

**规格场景:** [spec](../spec.md) 的 AC-15、AC-16，以及 AC-18 中侧栏的部分；对应 RUN-02、RUN-03、RUN-04、RUN-06。

**设计依据:** 规格本身，没有单独的设计。

**文档影响:** projects 当前行为说明中“列表不显示运行状态点”改为“执行中”规则。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Closed:** true

- [x] `running` 为真（包括 Run 内等待审批）的 Session 行，右侧对齐显示 12px 的转圈：弱化色，位置与悬停操作按钮相同，可访问名称为“运行中”。
- [x] 鼠标悬停或键盘焦点进入行时，转圈消失，显示置顶和更多按钮；离开后转圈恢复。行菜单打开期间，操作区保持显示、转圈保持隐藏。
- [x] 在无悬停能力、操作按钮常显的设备上不显示转圈。开启减少动态效果时图标不转动。
- [x] 项目收起、且其中有执行中的未置顶成员时，项目行右侧显示同样的转圈，悬停或焦点进入时换成“更多项目操作”和“新建会话”。项目展开后，转圈只显示在成员行上。
- [x] 置顶的 Session 在置顶区显示自己的转圈，不计入所属项目；置顶的项目按同样的规则处理。执行中的 Session 被分页藏起来，或整个分类被收起时，不做特殊处理。
- [x] “执行中”不改变列表排序，也不把执行中的项上浮。
- [x] “执行中”的判断只写在一处，02 只需在这里加入 `agentsRunning`。
- [x] 明暗主题下，转圈不与标题或操作按钮重叠，长标题照常截断。
- [x] 锁定旧行为的侧栏测试同步修改，原因记入 Comments。真实 App 的 Browser Mode 测试覆盖：Session 行、项目行（收起与展开）、悬停与键盘焦点下的替换、减少动态效果、置顶，以及排序不变。
- [x] 同步修改 projects 当前行为说明。实际执行的检查（精确命令、实际数量、退出码、未验证项）和文档影响记入 Comments。

## Comments

- 2026-11-04：用户回复“确认”，确认 9 票及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-04 实施完成（基线 `25d4228e`）：Session 行与收起项目行复用 `SidebarActivity` 和唯一的 `sessionExecuting` 判断；指示与原操作共用行尾列，菜单打开期间持续让位。无 hover / 粗指针隐藏指示并显示操作，减少动态效果停止旋转。项目只聚合未归档且未单独置顶的成员，不更改排序、分页或分类行为。
- TDD：真实 App 装配的 light/dark 用例先失败于缺少 `Running`，Session 实施后通过；项目用例先失败于收起项目缺少 `Running`，聚合实施后通过。保留真实 store、App、列表和共享浮层，只使用现有内存协议边界。媒体偏好通过 Chromium CDP 实际模拟并断言 `matchMedia` 状态。
- 验证：`pnpm install --frozen-lockfile` 退出 0；`pnpm run test --project desktop-renderer apps/desktop/src/renderer/features/sidebar/sidebar-activity.browser.test.tsx apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx apps/desktop/src/renderer/features/sidebar/session-row.browser.test.tsx apps/desktop/src/renderer/features/sidebar/project-row.browser.test.tsx` 退出 0，4 文件 / 33 测试通过。新活动用例为真实 App 的 4 测试，覆盖明暗主题、12px 读数、长标题让位、hover/焦点/菜单替换、置顶与收起项目、排序、减少动态效果和无 hover。`pnpm run typecheck` 退出 0（曾发现并移除重复 JSX 菜单属性）；`pnpm run check:docs` 退出 0，319 Markdown / 0 问题；`git diff --check` 退出 0。
- 文档影响：原地更新 `docs/subsystems/projects.md` 的工作台列表与长标题规则；旧列表测试的“无运行标记”改为检查唯一运行指示，因为本票明确改变该行为。搜索 `不显示运行状态|没有运行标记|运行状态点` 的正式文档命中仅该正文；spec 与票中旧措辞保留为原行为/来源说明。按 AGENTS → docs/README → projects 读回，路径、语义、唯一归属、引用方向、生命周期与历史保留通过。
- 范围与限制：本票只消费现有 `running`，未订阅会话广播、后台 Subagent / Teammate 由 02 继续；Electron 静默组合验收与原生层验证由 09 统一记录。本票未运行真实模型、打包产物、CI 或全仓测试；没有相关配置/模型改动，无扩大范围理由。未推送、未发布。
