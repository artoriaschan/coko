---
kind: evidence
description: "右栏与会话数据诊断最终集成：真实 App、Electron/Sidecar、当前打包资源、静默 CDP 与逐项 AC 证据及限制。"
lifecycle: active
---

# 最终集成验收（2026-11-05）

## 验证对象与边界

基线为已合并 01—11 的 `83d575c19ccc7fdf220653f206a045348cd38fd2`；独立工作树 `/tmp/coko-right-sidebar-agents/ticket-12`，分支 `codex/right-sidebar-12`。本票增加原生已提交工具记录定位断言，迁移 Jobs 窄窗口等待、下载 Trace 入口及附件测试的原生 bridge 桩；唯一产品补丁为固定窄列的序号表头补共享 Tooltip 和键盘焦点。没有改变模型、协议、store 或布局算法。

macOS arm64，Node 24.15.0、pnpm 12.15.0、Electron 41.0.3。Browser Mode 为真实 Chromium 和真实 App/store/投影；Electron 使用真实 Sidecar、临时数据根、faux 模型与可控时钟，工具用真实文件屏障。未执行真实模型、CI、Developer ID 签名、公证或 ZIP/DMG 发布验证。源码路径、构建配置和实际 scripts 已读取，冻结依赖安装退出 0；未共享其他工作树的可写 node_modules。

## 执行记录

### B1：相关组合

```sh
rtk pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/app/right-panel-shortcuts.browser.test.tsx apps/desktop/src/renderer/app/startup-screen.browser.test.tsx apps/desktop/src/renderer/features/conversation/collaboration.browser.test.tsx apps/desktop/src/renderer/features/conversation/history.browser.test.tsx apps/desktop/src/renderer/features/conversation/integrated-detail.browser.test.tsx apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx apps/desktop/src/renderer/features/conversation/process-groups.browser.test.tsx apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx apps/desktop/src/renderer/features/right-panel/agents-tab.browser.test.tsx apps/desktop/src/renderer/features/right-panel/jobs-tab.browser.test.tsx apps/desktop/src/renderer/features/right-panel/layout-persistence.browser.test.tsx apps/desktop/src/renderer/features/right-panel/layout-persistence.test.ts apps/desktop/src/renderer/features/right-panel/schedules-tab.browser.test.tsx apps/desktop/src/renderer/features/right-panel/team-tab.browser.test.tsx apps/desktop/src/renderer/features/right-panel/trace-tab.browser.test.tsx apps/desktop/src/renderer/features/session-diagnostics/format.test.ts apps/desktop/src/renderer/features/session-diagnostics/grouping.browser.test.tsx apps/desktop/src/renderer/features/session-diagnostics/live-progress.browser.test.tsx apps/desktop/src/renderer/features/session-diagnostics/object-value.test.ts apps/desktop/src/renderer/features/session-diagnostics/progress-model.test.ts apps/desktop/src/renderer/features/session-diagnostics/raw-data.browser.test.tsx apps/desktop/src/renderer/features/session-diagnostics/raw-json.test.ts apps/desktop/src/renderer/features/session-diagnostics/raw-model.test.ts apps/desktop/src/renderer/features/session-diagnostics/table-hierarchy.test.ts apps/desktop/src/renderer/features/session-diagnostics/table-layout.test.ts apps/desktop/src/renderer/features/session-diagnostics/timeline-matching.test.ts apps/desktop/src/renderer/features/session-diagnostics/timeline-navigation.browser.test.tsx apps/desktop/src/renderer/features/session-diagnostics/type-filter.test.ts apps/desktop/src/renderer/features/settings/developer.browser.test.tsx apps/desktop/src/renderer/features/sidebar/conversation-search.browser.test.tsx apps/desktop/src/renderer/features/sidebar/project-delete.browser.test.tsx apps/desktop/src/renderer/features/sidebar/project-row.browser.test.tsx apps/desktop/src/renderer/features/sidebar/session-menu.browser.test.tsx apps/desktop/src/renderer/features/sidebar/session-move.browser.test.tsx apps/desktop/src/renderer/features/sidebar/session-row.browser.test.tsx apps/desktop/src/renderer/features/sidebar/sidebar-activity.browser.test.tsx apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx packages/i18n/src/domains.test.ts packages/ui/src/app-frame/app-frame.browser.test.tsx packages/ui/src/app-frame/frame-layout.test.ts packages/ui/src/components/panel-tabs.browser.test.tsx packages/ui/src/guards/style-guard.test.ts scripts/browser-deps.test.ts apps/desktop/src/renderer/features/conversation/business-timeline.browser.test.tsx apps/desktop/src/renderer/features/conversation/permission-states.browser.test.tsx
```

46 文件、459 项通过、0 跳过，退出 0，63.76s。包含全部诊断纯模型和 Browser Mode、App、右栏与快捷键、侧栏消费者、共享 PanelTabs/AppFrame、过程/阅读/历史/协作、developer、字典、浏览器依赖和样式守卫。该批次在序号表头补丁之前；局部补丁由 B2 与 E2 重验，其他消费者代码没有变化。

### B2：局部补丁与其余直接消费者

```sh
rtk pnpm run test apps/desktop/src/renderer/features/session-diagnostics/raw-data.browser.test.tsx
rtk pnpm run test apps/desktop/src/renderer/features/conversation/plan.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-status-bar.browser.test.tsx apps/desktop/src/renderer/features/settings/schedules-notifications.browser.test.tsx packages/ui/src/guards/style-guard.test.ts scripts/browser-deps.test.ts packages/i18n/src/domains.test.ts
```

分别 1 文件 7 项通过（11.55s）和 6 文件 76 项通过（9.89s），均 0 跳过、退出 0。表头修复先运行 `rtk pnpm run test apps/desktop/src/renderer/features/session-diagnostics/raw-data.browser.test.tsx -t 'renders loaded Entry'`，实际因缺失 `Sequence` Tooltip 失败（1 失败、6 按名称过滤），然后仅补共享 Tooltip，完整该文件 7 项通过。静默 CDP 也实际悬停得到 `Sequence` 全文。

### E1：有界完整原生批次

```sh
rtk pnpm run test --project desktop-e2e apps/desktop/e2e/jobs.e2e.test.ts apps/desktop/e2e/schedules.e2e.test.ts apps/desktop/e2e/subagents.e2e.test.ts apps/desktop/e2e/teams.e2e.test.ts apps/desktop/e2e/terminal-details.e2e.test.ts apps/desktop/e2e/trace.e2e.test.ts apps/desktop/e2e/right-panel-persistence.e2e.test.ts apps/desktop/e2e/right-panel-menu.e2e.test.ts apps/desktop/e2e/developer-diagnostics.e2e.test.ts apps/desktop/e2e/diagnostic-progress.e2e.test.ts apps/desktop/e2e/third-party-notices.e2e.test.ts apps/desktop/e2e/conversation-status-header.e2e.test.ts apps/desktop/e2e/session-download.e2e.test.ts
```

13 文件、17 项通过、0 跳过，退出 0，105.66s。globalSetup 从当前源打包；声明测试逐字比较当前 app Resources 与仓库的完整 DeepSeek/MIT 声明。诊断用例保留思考、工具实时进度、结算与重新加载清空的断言，并选择已提交 toolResult，先确认真实工具处在隐藏 Run 中，再确认同一调用的 Run/组/工具展开、卡片几何进入消息视口与 body 高亮。此批次打包在仅表头 Tooltip 的局部补丁前，E2 在关闭 Forge 后重新打包验证当前源。

### E2：当前最终源码原生检查

```sh
rtk pnpm run test --project desktop-e2e apps/desktop/e2e/diagnostic-progress.e2e.test.ts apps/desktop/e2e/developer-diagnostics.e2e.test.ts apps/desktop/e2e/third-party-notices.e2e.test.ts
```

3 文件、3 项通过、0 跳过，退出 0，28.27s。先完全关闭静默 Forge/watch，确认端口与自有进程退出，再执行本次 package；没有 watch 与打包并行。

### 其他检查

`rtk pnpm run typecheck` 退出 0。六个变动 TS/TSX 的 `rtk pnpm exec oxlint` 退出 0；同一清单的 `rtk pnpm exec oxfmt` 退出 0。`rtk pnpm run check:docs` 退出0，345个Markdown、0问题；`rtk git diff --check`退出0。已从 AGENTS → docs/README → 正文读回，结果见本文文档影响与第12票Comments。

## 初始失败及归因范围

初始 44 文件组合为 426 通过、7 失败：5 个附件场景只替换了 `window.coko.pickFiles`，新增菜单订阅方法缺失导致 `onMenuClose is not a function`。补充该原生边界的取消订阅桩后，四文件组合（business-timeline、permission-states、new-chat、timeline-navigation）47 项通过，最终 B1 也全部通过；没有修改产品为适应不完整桩。此前 03 票的中文 IME 焦点信号在这两次组合中未再出现，不能据此推断旧失败的唯一原因。

另两个初始失败为 AppFrame 测试第二次 pointer click 被侧栏 peek 覆盖，以及持续其他 Run 动画场景未在轮询内看到 locator 高亮；AppFrame 独立 17 项、四文件组合及最终 B1 均在未改这两处测试/产品的情况下通过。其原因未确证，保留为未复现的不确定性，不声称已修复或已经证明是基线问题。

初始 E1 为 14 通过、3 失败。Jobs 的停止按钮右边界读为 727.4609375，而 innerWidth 已是 390；改为等待实际右栏宽度 390，保留原按钮边界断言。下载场景还在点击原静态 Trace tab，改为真实开始页的 Trace 卡片。Teams 在 `teams.e2e.test.ts:231`（`last.focus()`、Enter 后）成员详情 `data-agent-id` 未在轮询内等于名册最后成员的 id；初始输出没有 activeElement 或实际 id，无法确认焦点原因。Teams 源码与断言没有修改，随后三文件四项（29.56s）及完整 E1 通过；该初始 Teams 信号仍属未复现的不确定性。未添加 retry、固定等待、timeout 放宽、skip 或较弱断言。

较早 48 个消费者扩展中 41 个模型设置旧失败已有基线记录；本票未把这组报告成通过、未跳过用例，也未扩大产品修复。B1/B2 是上面明确列出的相关范围，不是全仓通过。

## 静默 agent-browser（独立于自动化测试）

读取项目 stub、已安装 core/electron 工作流；唯一命名会话 `coko-ticket12-final`，连接自有 9222。Forge 用 `COKO_E2E_BACKGROUND=1`，独立 mkdtemp userData/COKO_HOME/chats/faux；未设置 visible、未 open -a、未占前台。通过实际界面打开 Session、开发者设置、开始页、诊断，运行 read 工具，再使用实际悬停、点击、键盘和 CDP 指针坐标：

- 普通 1280×820：左栏 280、右栏 576、主列 424；tab 条 38、胶囊 28、末端按钮 28，拖拽空白为 `drag`、tab/按钮为 `no-drag`。七个 tab 的滚动区宽 456、内容 771，末端收起/全屏分别位于 1210—1238/1246—1274，保持可达；Meta+Shift+Right 实际将诊断与计划换序，单独 Right 只移动焦点而不激活页面。标题截断与共享全文 Tooltip 的完整路径另由 PanelTabs Browser Mode 验证。
- 选原始 toolResult 6 后，`acceptance-read` 同一调用从折叠 Run 展开，卡片 rect 312,305.5,356,195 位于消息 port 280,86.5,424,583.5；真实 read 结果与 JSON 详情一致。分组中选择工具、沿 Run 引用增加面包屑，瞄准后悬停出现相同工具卡几何；点击选中工具并重置面包屑根，工具本来展开且仍展开，没有触发底层工具按钮。
- 分组筛选 `text` 后用瞄准选工具，筛选清除、计数恢复 5 行、选中 `tool:acceptance-read`。点击无身份的消息边缘显示原文未命中提示并继续等待，Esc 清除蒙层。轮轮事件已交给消息区，但此手动短会话没有可滚动距离，不能作为实际位移证据；真实嵌套内外滚轮由 B1 locator 用例验证。
- 全屏 rect 0,0,1280,820，同一个 `#right-panel-tabpanel`，底层主列仍 424，宽度分隔条消失；tab 条 leading padding 84。退出保留详情。CDP 检查安全区与 app-region 仅证明 CSS/几何，不能证明原生红绿灯命中或真实窗口拖拽。
- 亮色英文与暗色中文均实际查看；390×820 最终右栏 rect 为 0,0,390,820、整页 scrollWidth 390，无纵向列宽分隔条；表格横向滚动属于局部设计。双语/主题与其他组合、筛选键盘、细节调整、reduced-motion 由 B1/B2 实际 App 用例覆盖。

已捕获且逐张实际查看：[开始](start-light-en.png)、[原始定位与全文 Tooltip](raw-located-light-en.png)、[分组与选中](grouping-light-en.png)、[全屏](fullscreen-light-en.png)、[暗色中文](grouping-dark-zh.png)、[390px 暗色中文](390-dark-zh.png)、[溢出与键盘焦点](tab-overflow-dark-zh.png)。后两张暗色截屏在语言 Toast 消失后重新捕获并读回，避免把暂态遮挡当作最终布局。

清理：命名 agent-browser close；自有 Forge Ctrl-C 正常收尾（退出 1 为中断状态）；自有 Electron/Sidecar/Helper pid 87070、87071、87072、87073、87110 全部不存在，lsof 9222 无监听。没有结束用户的个人应用。原生真实指针、红绿灯点击、窗口拖拽、原生材质的屏幕合成效果仍未验证：后台透明且忽略 OS 鼠标，不把 CDP 几何当作原生命中。第 12 票明确允许记录这类限制。

## 文档影响与读回

当前行为归 `docs/subsystems/session-diagnostics.md`，共享几何归 `docs/tech-stack/ui-design-system.md`；本票只原位补充序号表头 Tooltip 与原生工具定位用例入口。AGENTS → docs/README → workbench/diagnostics/delivery，以及 plan-mode/jobs/subagents/teams/schedules/tracing、TECH_STACK 的入口与约定逐项读回；正文保持只依赖正式资料/源码，没有指向本证据或其他 scratch。原有调查与批准历史保留，最终规格的 AC 逐行映射见其交付章节。
