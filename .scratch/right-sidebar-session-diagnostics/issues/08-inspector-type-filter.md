# 08: 诊断表格的类型筛选

**What to build:**

- **打开浮层。** 点击类型列表头的筛选图标，打开编辑浮层。浮层跟随表头按钮定位，定位后聚焦输入框。
- **候选与确认。** 候选从所有已加载的行中异步更新。按 Enter 或“确认筛选”，确认输入的片段；点击候选，或用方向键选中候选后按 Enter，确认该类型。
- **匹配规则。** 不区分大小写，默认为包含匹配，首尾的 `*` 写不写都一样。
- **草稿。** 只编辑不会改变表格。按 Esc、点击取消或点击浮层外部，放弃草稿。清空后确认，恢复全部类型。
- **筛选结果。** 保留匹配行和它们的父级上下文。上下文行显示为淡色，强制展开，不计入匹配数。计数显示“匹配数 / 总数”。新到达的行沿用已确认的筛选。
- **确认之后。** 重置选中、手动折叠与尾部留白，并回到顶部。

**规格场景:** [spec](../spec.md) 的 AC-21；对应 INS-06。目标被筛选排除时先清除筛选，这条规则在引用导航（10）和瞄准（11）中分别验收。

**设计依据:** [design](../design.md) 的“诊断功能模块”，其中筛选规则是移植过来的纯逻辑。

**文档影响:** 会话数据诊断当前行为说明中的类型筛选。

**Blocked by:** 07 — 诊断页的原始数据

**Status:** ready-for-agent

**Closed:** true

- [x] 浮层的定位、聚焦、候选更新、键盘选择和放弃草稿符合 INS-06。
- [x] 匹配规则、上下文行、计数，以及新行沿用筛选，都符合 INS-06；确认后回到顶部。（AC-21）
- [x] 移植筛选规则的单测。真实 App 的 Browser Mode 覆盖浮层交互和键盘路径，包括浏览器缩放和滚动时浮层仍然跟随表头按钮。
- [x] 按测试约定运行最小相关测试集与类型检查，同步上述文档；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户回复“全部采用推荐”，确认 12 张票及其阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。


- 2026-11-05：实施完成。移植 `DiagnosticTypeFilter` 的包含匹配、边界星号规范化、祖先保留、仅匹配计数与异步完整类型候选；`DiagnosticTable` 持有已确认筛选，候选编辑使用共享 `PopoverContent`/`Input`/`Button`，在实际定位后聚焦，按草稿与候选来源双重校验并取消过期请求。上下文强制展开，筛选期间忽略手动折叠且禁止再次收起。确认重置选择、手动折叠、尾部留白和顶部位置，新行沿用筛选。
- 接口交接：`DiagnosticTableRevealRequest { key, nonce }` / `revealRequest` 只在目标不属于保留结果时清除筛选，展开祖先后滚动并高亮，不改变原先详情选择。10 负责真实引用导航调用与面包屑联合验收，11 负责瞄准调用；本票没有实现瞄准。减少动态效果时跳过表格高亮。
- TDD：先运行新增 `type-filter.test.ts`，因缺少模块失败；移植后通过。真实 App 新筛选场景先因缺少筛选按钮失败，实现后通过。新到达 assistant 夹具最初缺少协议必需的 `stopReason`，修正合法网络夹具后通过。新增筛选按钮改变类型列的可访问名称，既有详情拖动测试同步改为 `Type Filter types`。
- 实际验证（均在独立 ticket-08 worktree）：`rtk pnpm install --frozen-lockfile` 成功；`rtk pnpm exec vitest run --project desktop-renderer apps/desktop/src/renderer/features/session-diagnostics/raw-data.browser.test.tsx` **7/7 通过**。包含完整真实 App 装配、真实 store、协议 fixture、片段与点击/方向键候选确认、Esc/取消/外部点击、IME Enter、强制祖先、新行与候选刷新、重置详情/折叠/尾部留白/顶部、390px en/light 与 zh/dark、窗口变化、真实 Chromium 125% 页面缩放与滚动锚定；没有替换投影/模型/布局内部逻辑。
- 补充检查：`rtk pnpm exec vitest run --project desktop-renderer apps/desktop/src/renderer/features/settings/developer.browser.test.tsx --project desktop apps/desktop/src/renderer/features/session-diagnostics/type-filter.test.ts apps/desktop/src/renderer/features/session-diagnostics/table-model.test.ts apps/desktop/src/renderer/features/session-diagnostics/table-layout.test.ts --project scripts scripts/browser-deps.test.ts` 实际选中 **4 文件 / 29 用例，全通过**（本仓层级测试文件名不叫 `table-model.test.ts`，该路径未额外选中用例；本次相关纯筛选7例、布局与开发者/依赖守卫已执行）。`rtk pnpm exec vitest run --project ui packages/ui/src/guards/style-guard.test.ts` **40/40 通过**；该守卫最初发现 listbox，现登记精确例外：候选已经由共享 PopoverContent 的菜单表面承载，不能再嵌一层表面。没有修改守卫规则或放宽整个目录。
- 类型、格式与 lint：`rtk pnpm run typecheck` 通过。对本票10个 TS/TSX/CSS 文件执行格式检查通过，对相关9个 TS/TSX 文件执行 lint 通过（精确命令如下）；`rtk git diff --check` 通过。精确文件范围为筛选纯逻辑/测试/编辑器、表格、原始数据浏览器测试、browser-commands、Browser Mode 配置、diagnostics 字典、样式守卫例外（CSS 不参与 lint）。仓库没有 `.github/workflows`，未宣称 CI 已运行。
- 文档影响：类型筛选契约 → `docs/subsystems/session-diagnostics.md` 原地新增类型筛选及引用定位协调说明；导航摘要 → `docs/README.md` 同步；工作台“没有输入框” → `docs/subsystems/workbench.md` 精确为不提供会话消息输入，允许类型筛选编辑器。`rtk pnpm run check:docs` 检查 **344 文件，0 问题**；按 AGENTS → docs/README → 正文读回，路径与引用、语义、唯一归属、引用方向、生命周期、当前入口、新会话可读及历史保留均通过，无新增正式文档目录。
- 范围与未验证：本票未启动 Electron、未运行产物 smoke 或 agent-browser；按统一执行计划由12最终运行真实 Electron/CDP/产物验收。125% 缩放通过 Chromium CDP `Emulation.setPageScaleFactor` 并读回 visualViewport.scale 验证，先前 CSS zoom 探索不作为浏览器缩放通过证据。引用和瞄准的跨功能行为由10/11验证，不以本票的 API 实现替代联合验收。


本票格式与 lint 的精确命令：

```sh
rtk pnpm exec oxfmt --check apps/desktop/src/renderer/features/session-diagnostics/type-filter.ts apps/desktop/src/renderer/features/session-diagnostics/type-filter.test.ts apps/desktop/src/renderer/features/session-diagnostics/type-filter-editor.tsx apps/desktop/src/renderer/features/session-diagnostics/diagnostic-table.tsx apps/desktop/src/renderer/features/session-diagnostics/diagnostic-table.css apps/desktop/src/renderer/features/session-diagnostics/raw-data.browser.test.tsx apps/desktop/src/renderer/testing/browser-commands.ts apps/desktop/vitest.browser.config.ts packages/i18n/src/dictionaries/domains/diagnostics.ts packages/ui/src/guards/style-guard-exceptions.ts
rtk pnpm exec oxlint apps/desktop/src/renderer/features/session-diagnostics/type-filter.ts apps/desktop/src/renderer/features/session-diagnostics/type-filter.test.ts apps/desktop/src/renderer/features/session-diagnostics/type-filter-editor.tsx apps/desktop/src/renderer/features/session-diagnostics/diagnostic-table.tsx apps/desktop/src/renderer/features/session-diagnostics/raw-data.browser.test.tsx apps/desktop/src/renderer/testing/browser-commands.ts apps/desktop/vitest.browser.config.ts packages/i18n/src/dictionaries/domains/diagnostics.ts packages/ui/src/guards/style-guard-exceptions.ts
```

- 集成核对：交付前 `rtk git merge codex/right-sidebar-session-diagnostics-integration` 返回 `Already up to date.`，集成头为 `1496184b`；未改动 native preflight 修复与其证据。

- 补充正确的层级测试路径：`rtk pnpm exec vitest run --project desktop apps/desktop/src/renderer/features/session-diagnostics/table-hierarchy.test.ts` **4/4 通过**。最终类型检查、文档检查与 diff 空白检查再次通过。
