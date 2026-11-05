# 05: 右栏快捷键与原生菜单

**What to build:**

- **Mod+Alt+B。** 展开或收起右栏。没有选中 Session 时无效。
- **焦点在右栏内时。** Mod+Alt+Enter 切换全屏。Mod+W 关闭当前页面：关闭唯一的引导页时，右栏收起，引导页保留；关闭后，焦点移到同一 Session 中仍然可见的右栏页面，所以连续按 Mod+W 仍然作用于右栏。
- **焦点不在右栏页面时。** Mod+W 照旧关闭窗口。
- **前台有弹层时。** 前台有弹窗、菜单或对话框时，由它们先处理关闭，后面的右栏和窗口都不关闭。
- **输入法与提示。** 输入法组合输入期间不响应这些快捷键。按钮通过 `aria-keyshortcuts` 和 Tooltip 标出有效的键位。
- **Mod+W 的实现。** 用自定义应用菜单实现：保留默认的应用、编辑、视图和窗口菜单；File → 关闭绑定 Mod+W，点击后把关闭命令交给 renderer 决定。renderer 没有登记监听，或者已经销毁时，main 直接关闭窗口。
- **不做的快捷键。** 不做“刷新页面”和“分栏”的快捷键。

**规格场景:** [spec](../spec.md) 的 AC-15、16；对应 RP-15，以及 RP-17 中快捷键之后的焦点。

**设计依据:** [design](../design.md) 的“应用菜单（main）”与“关闭命令（renderer）”两个模块、“Mod+W”时序图，以及备选方案中的“Mod+W”。

**文档影响:** workbench 的快捷键；delivery 中关于应用菜单的说明：自定义菜单取代了 Electron 的默认菜单。

**Blocked by:** 01 — 右栏改为按 Session 的单格 tab 容器；03 — 宽度、窄窗口与全屏（Mod+Alt+Enter 要切换全屏）

**Status:** ready-for-agent

**Closed:** true

- [x] Mod+Alt+B 与 Mod+Alt+Enter 按 RP-15 工作：没有选中 Session 时 Mod+Alt+B 无效，输入法组合输入期间不响应。（AC-15）
- [ ] 焦点在右栏页面时按 Mod+W，该页面关闭，窗口不关闭，焦点移到右栏中仍然可见的页面；连续按到只剩引导页时，右栏收起。焦点在时间线时按 Mod+W，窗口关闭。有对话框打开时，Mod+W 只作用于对话框。（AC-16）
- [x] 自定义菜单保留默认的编辑能力：输入框中的撤销、重做、剪切、复制、粘贴和全选仍然可用。视图与窗口菜单的默认项也保留。
- [x] bridge 只新增两个方法：“菜单关闭”的监听和“请求关闭窗口”，不暴露任意 IPC。renderer 未就绪时，Mod+W 直接关闭窗口。窗口的关闭按钮不经过菜单，行为不变。
- [ ] 真实 Electron E2E 触发 File → 关闭菜单项，验证三种结果：关闭页面、关闭窗口、交给对话框。菜单项绑定的是 Mod+W，由菜单定义的单测断言。renderer 中的快捷键在真实 App 的 Browser Mode 中验证。
- [x] 按测试约定运行最小相关测试集与类型检查，同步上述文档；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户回复“全部采用推荐”，确认 12 张票及其阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05 实现交付（独立分支 `codex/right-sidebar-05`，基线 `33f34989`）：新增 `src/main/application-menu.ts`，保留 Electron 标准 app/edit/view/window role 菜单，File → 关闭采用 `CmdOrCtrl+W` 自定义动作。main/preload 的监听握手仅作为两个 bridge 方法 `onMenuClose` / `requestCloseWindow` 的内部实现；校验窗口、主框架与 app 文档，跨文档导航、renderer 丢失、窗口关闭时清空登记（页内 hash 导航保留监听）。没有监听时直接关闭窗口，原生窗口关闭按钮不变。
- renderer 的 `app/right-panel-commands.ts` 在真实 App 装配中处理快捷键与菜单命令：无 Session 或非会话内容页不打开右栏；组合输入（包括原生菜单缺少 KeyboardEvent 时的 composition 生命周期）不触发；浮层先接收 Escape，其拒绝也不穿透，合成 Escape 在 document 冒泡阶段截住，避免触发窗口级停止 Run。右栏中关闭后聚焦同一 Session 的剩余页面，唯一开始页收起并保留。延后焦点回调重新核对 Session、活动页面、可见性和浮层，卸载时取消。
- 新增 `app/right-panel-shortcuts.browser.test.tsx`，真实 App / store / fixture 覆盖展开、活动页焦点、全屏几何、收起焦点返回、无 Session、非会话页、组合输入以及前台菜单/对话框优先。tab 关闭按钮只在它是活动页面时标出 Mod+W，展开/收起与全屏按钮均有 Tooltip 和 `aria-keyshortcuts`。旧 App 两项 tooltip 预期从“与按钮名称一致”迁移为 RP-15 要求的键位提示，按钮可访问名称不变。
- TDD：首个 Browser Mode 用例先因没有右栏快捷键而找不到 tabpanel 失败，补实现后通过；组合输入用例先观测到右栏错误展开（DOMRect 数量 1，预期 0），补 composition 生命周期后通过；菜单单测先因 File 下缺少关闭项失败，补自定义关闭项后通过。初次组合测试另有两项旧 Tooltip 预期失败，按上述已批准行为迁移后复核通过。
- 实际验证（全部从本票 worktree 运行）：`rtk pnpm install --frozen-lockfile` 退出 0；`rtk pnpm run test apps/desktop/src/renderer/app/right-panel-shortcuts.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/main/application-menu.test.ts packages/ui/src/components/panel-tabs.browser.test.tsx packages/ui/src/guards/style-guard.test.ts` 退出 0，5 文件、89 项通过（48 Browser Mode、40 样式守卫、1 菜单单测），0 跳过；`rtk pnpm run typecheck` 退出 0；受影响 15 个 TypeScript 文件的 `rtk pnpm run lint <文件清单>` 退出 0；`rtk pnpm run check:docs` 退出 0，342 Markdown、0 问题；`rtk pnpm run build:desktop` 退出 0（保留已有大 chunk 提示，没有调高限制）。
- 原生菜单验收源码为 `apps/desktop/e2e/right-panel-menu.e2e.test.ts`（2 例）：真实 File 关闭项连续关闭页面并保留焦点、唯一开始页收起、前台风险对话框关闭、组合输入忽略、时间线焦点关闭窗口，以及无 renderer 监听时的原生回退。**依集成编排，实际 Electron / 产物 smoke / agent-browser 执行统一留给 12，故上方原生 E2E 执行项未勾选；当前关闭表示实现交付，不冒充 AC-16 原生验收已通过。**真实模型、原生鼠标、发布签名与 CI 未运行。
- 文档影响：右栏快捷键、焦点与 Mod+W 路由 → `docs/subsystems/workbench.md` 原地更新；原生菜单、bridge 与未就绪回退 → `docs/subsystems/delivery.md` 新增所属章节；`docs/README.md` 的交付入口摘要同步。消费者搜索包含隐藏任务材料及正式正文，旧规格/历史票保留当时结论，正式文档不反向引用任务。已从 AGENTS → docs/README → 上述正文读回，生命周期、当前入口、语义同步、归属、引用方向、替代链与历史保留均通过；没有新目录、弃用或归档。

- 合入集成最新 `fdec7bff`（04 布局持久化）后，自动合并 workbench，保留持久化与本票快捷键正文，无代码冲突。组合复核命令：`rtk pnpm run test apps/desktop/src/renderer/app/right-panel-shortcuts.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/main/application-menu.test.ts packages/ui/src/components/panel-tabs.browser.test.tsx packages/ui/src/guards/style-guard.test.ts apps/desktop/src/renderer/features/right-panel/layout-persistence.browser.test.tsx apps/desktop/src/renderer/features/right-panel/layout-persistence.test.ts` 退出 0，7 文件、105 项通过、0 跳过；合并后 `rtk pnpm run typecheck`、`rtk pnpm run check:docs`（342 文件、0 问题）及 `rtk pnpm run build:desktop` 均退出 0。`rtk pnpm run format:check <上述 15 个 TypeScript 文件>` 与 `rtk git diff --check` 退出 0。本票代码提交 `22f1f77d`，合并提交 `f82cda28`；仅本地提交，未推送、未合 main。
