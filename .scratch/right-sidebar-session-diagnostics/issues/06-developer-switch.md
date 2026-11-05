# 06: 开发者开关与诊断页外壳

**What to build:**

- **开关。** 设置 → 通用新增一张“开发者”卡片，只有一个开关“会话数据诊断”，说明文字为“在侧边栏启用当前会话的原始数据和对话分组数据分析功能”。开关默认关闭，全局生效，不区分项目，发布构建中也可以打开。开关经 Sidecar 设置库保存，重启后保持；冲突和保存失败时用 Toast 提示，并保留界面上的选择。
- **打开开关。** 各 Session 的引导页末尾出现“会话数据诊断”卡片，但不会自动打开诊断页。本票的诊断页只有标题“会话数据诊断”、工具栏中的“展示形式”下拉框，以及“暂无记录”空状态；表格从 07 开始实现。
- **关闭开关。** 所有 Session 中已经打开的诊断页一起关闭；诊断页是唯一的 tab 时，右栏收起。引导页不再列出诊断页，恢复已保存的布局时也去掉它。

**规格场景:** [spec](../spec.md) 的 AC-18；对应 DEV-01、DEV-02，以及 INS-01 中标题与只读的部分。

**设计依据:** [design](../design.md) 的“开发者设置”模块，以及“恢复”中关于关闭开关、设置读取失败时的处理。spec 的实施决定：新增全局设置键 `developer`，值为 `{ sessionDiagnostics: boolean }`，缺省为 false，schema 与缺省值放在协议包中；Sidecar 不读取这个键。

**文档影响:** workbench 中设置 → 通用的开发者卡片。

**Blocked by:** 01 — 右栏改为按 Session 的单格 tab 容器；04 — 右栏布局的保存与恢复（恢复时要去掉诊断页）

**Status:** ready-for-agent

**Closed:** true

- [x] 设置 → 通用显示“开发者”卡片和开关，文案符合 DEV-01，并走 zh/en 类型化字典。开关默认关闭；读到不符合 schema 的值时按缺省处理；冲突与保存失败时用 Toast 提示。
- [x] 打开开关后，引导页末尾出现诊断卡片，不自动打开诊断页。诊断页有标题、“展示形式”下拉框和空状态，没有输入框。
- [x] 关闭开关后，所有已采用布局中的诊断页立即关闭；诊断页是唯一的 tab 时，右栏收起。引导页不再列出诊断页。恢复已保存的布局时去掉诊断页，不逐个重写其他 Session 的键。
- [ ] 真实 Electron E2E 验证：开关在重启后保持；引导页的诊断卡片随开关出现和消失。（AC-18）
- [x] 不改协议消息和服务端，Sidecar 不读取这个键。
- [x] 按测试约定运行最小相关测试集与类型检查，同步上述文档；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户回复“全部采用推荐”，确认 12 张票及其阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。诊断页在本票中只有外壳，它位于默认关闭的开发者开关之后；表格从 07 开始实现。

### 2026-11-05 实现交付

- 基线为集成分支 `fdec7bff`；独立 worktree `/tmp/coko-right-sidebar-agents/ticket-06`、分支 `codex/right-sidebar-06`。实现提交 `8d75e940` 后合入最新集成分支 `de0da861`（第 05 票），自动合并 RightPanel 与 workbench，保留快捷键、原生菜单、28px 控件和布局持久化；合并提交 `bb360aa2`。本票实现关闭，实际 Electron 运行的跨票验收仍归 12，下列未运行项不算通过。
- 协议包新增 `DEVELOPER_SETTING`、`DeveloperSettings`、`DEFAULT_DEVELOPER_SETTINGS`，未改变协议消息或服务端。设置 store 的 `values` 保持已确认值／revision，`developer` 单独持有当前界面选择；`setDeveloperSettings` 先采用选择，再通过现有设置库串行保存。无效持久值／启动读取失败为默认关闭，冲突或失败 Toast 提示且不撤销选择。
- App 偏好装配在 Bootstrap 渲染工作台之前同步右栏可用页面，之后订阅同一 settings store。沿用 04 的 `setAvailableRightPanelPages`，不在 React 渲染期间广播布局变化；关闭开关过滤所有已采用／读回缓存中的诊断页，未采用键留待读回过滤，不批量改写键。默认页面常量仍仅包含开始与原六页，诊断页按开关显式加入。
- 页面登记表追加诊断页；引导页在开关启用时把它列在最后，不自动打开。外壳位于 `features/session-diagnostics/session-diagnostics.tsx`，含标题、共享菜单实现的“展示形式”（原始数据／对话分组）和空状态，无输入控件；新文案在类型化 `diagnostics` zh/en 领域字典。
- 首个真实 App tracer 在实现前因缺少 Developer group 失败，实现后通过开关 → 通用设置库保存 → 引导卡片 → 只读外壳。之后用真实 store／fixture 验证跨 Session 移除、已启用布局恢复、无效值和读取失败、冲突与网络失败保留选择、390px 中文深色／英文浅色。失败边界仅替换网络请求；布局、设置 store、投影容器及 UI 均使用真实实现。

### 验证与限制

- 合入最新集成后的最终命令：`rtk pnpm run test apps/desktop/src/renderer/features/settings/developer.browser.test.tsx apps/desktop/src/renderer/features/right-panel/layout-persistence.browser.test.tsx apps/desktop/src/renderer/app/preferences.test.ts apps/desktop/src/renderer/stores/settings-store.test.ts packages/ui/src/guards/style-guard.test.ts apps/desktop/src/renderer/app/app.browser.test.tsx packages/i18n/src/domains.test.ts packages/i18n/src/index.test.ts packages/protocol/src/control.test.ts apps/desktop/src/renderer/app/right-panel-shortcuts.browser.test.tsx`：10 文件、161 项通过、0 跳过，退出 0；其中新增开发者真实 App Browser Mode 11 项。包含既有 App、持久化、快捷键消费者、设置 store、偏好、协议、字典与样式守卫。
- `rtk pnpm run typecheck` 退出 0，包含 renderer 与新增 E2E 源码；改动 TS/TSX 的 `rtk pnpm exec oxfmt`、`rtk pnpm exec oxlint` 通过；`rtk pnpm run check:docs` 检查 342 文件、0 问题，退出 0；依赖独立执行 `rtk pnpm install --frozen-lockfile` 退出 0，未新增依赖。
- 新增 `apps/desktop/e2e/developer-diagnostics.e2e.test.ts`，使用真实 Sidecar／设置库、独立 userData 并重启，覆盖开关保持、诊断 tab 恢复与关闭后入口消失。**本票没有运行该 Electron E2E**，按集成安排由 12 统一执行，所以上方原生运行验收框暂未勾选。未运行 agent-browser、真实模型、原生指针或发布构建；不把 Browser Mode 或用例源码当作这些结果。

### 文档影响与读回

| 变化 | 所属正文／入口 | 同步与核对 |
| --- | --- | --- |
| 全局开发者开关、失败选择、布局可用条件及只读外壳 | `docs/subsystems/workbench.md` | 新增开发者设置，启动段补充先确定可用页面；链接源码与两类测试 |
| 从导航发现开发者设置 | `docs/README.md` | 工作台条目摘要补充开发者开关 |

已从 AGENTS → docs/README → workbench 读回，核对路径与引用、语义同步、归属与权威、引用方向、生命周期、当前入口、新会话读入、历史保留：均通过；没有新类别、替代链或归档变更，正式文档不依赖具体任务材料。既有规格／设计中的目标、历史说明与本票初始发布记录保留原意，未改写成当时已交付。后续诊断表格的当前契约由其实际实现同批更新；本票仅描述现有外壳。
