# 01: 右栏改为按 Session 的单格 tab 容器

**What to build:** 右栏从固定的六个 tab 改为按 Session 区分的单格 tab 容器。每个 Session 有自己的 tab 列表、选中项和展开状态；本票只把它们保存在内存中，保存与恢复见 04。

- **引导页。** 右栏第一次展开时打开引导页“开始”，用卡片列出计划、后台任务、子代理、定时任务、团队、追踪，卡片只有图标和标题。点击卡片后，引导页原位换成该页面。
- **tab 条。** tab 条就是右栏的上沿，依次是：带关闭按钮的 tab 胶囊；“+”，只在本格没有引导页时出现；末端的“收起侧边栏”。原来的头部标题和 X 移除。
- **去重与关闭。** 同一种页面只开一个 tab，再次打开时聚焦已有的那个。关闭最后一个非引导页时整栏收起，下次展开时显示引导页。引导页是唯一的 tab 时，没有关闭按钮。
- **显示条件。** 没有选中 Session 时，不显示右栏，也不显示“打开侧边栏”。
- **入口。** 所有入口改为“打开或聚焦对应页面，必要时展开右栏”。
- **文案。** 界面上指右侧面板的“右栏”文案改为“侧边栏”。

**规格场景:** [spec](../spec.md) 的 AC-01、02、04、09、17，以及 AC-06 中关闭按钮的部分。对应 RP-01、02、03，RP-04（单例去重），RP-05，RP-06（tab 条的组成、几何与拖拽区），RP-07（关闭按钮与唯一 tab 规则），RP-09、16、18。

**设计依据:** [design](../design.md) 的“模块责任与依赖”（右栏布局 store、页面登记表、右栏组装、共享 tab 条与引导卡片），以及“关键路径与接口”中的“打开或聚焦页面”。现有入口都经过对话区的同一个打开函数，替换它的实现即可，不需要先单独做预重构。

**文档影响:** workbench 的右栏容器、入口与文案。plan-mode、jobs、subagents、teams、schedules、tracing 中“打开右栏并切到某个 tab”的描述，改为“打开或聚焦某个页面”。

**Blocked by:** 无，可以直接开始。前置的“对话状态栏与标题栏”规格已经交付，9 张票均已关闭（2026-11-05 核对）。

**Status:** ready-for-agent

**Closed:** true

- [x] 右栏布局 store 按 Session 保存 tab 列表、选中项和展开状态，本身不依赖 React。单例去重、引导页规则和唯一 tab 规则都集中在它的动作里，页面和入口不直接改写布局。取代现在整个窗口共用的“选中 tab”store 和 App 中的全局开关。
- [x] 第一次展开时显示引导页，六张卡片的顺序与 RP-01 相同。点击“追踪”后，引导页原位换成追踪页，tab 条上只有追踪 tab 和“+”。（AC-01、02）
- [x] 两个 Session 各自保留自己的 tab、选中项和展开状态。新对话页、插件页和定时任务内容页不显示右栏，也不显示“打开侧边栏”。（AC-04）
- [x] 唯一的引导页没有关闭按钮。用关闭按钮关闭最后一个其他页面时，整栏收起；再次展开时显示引导页。中键与右键菜单见 02。（AC-06）
- [x] 展开时，tab 条末端是“收起侧边栏”，Tooltip 与可访问名称沿用 HEAD-06。右栏没有标题行和 X。收起后焦点回到“打开侧边栏”。（AC-09）
- [x] RP-16 列出的全部入口都打开或聚焦对应的页面，右栏收起时会展开。计划审阅的新请求仍然自动打开一次计划页。（AC-17）
- [x] tab 条的高度与胶囊几何按 DeepSeek Harness 的实际尺寸（实施前从源码读取），圆角对齐 Coko 的圆角档位。tab 条空白处可以拖动窗口，交互控件退出拖拽区。
- [x] 界面上已有的“右栏”文案改为“侧边栏”，例如“在右栏查看”。新文案都走 zh/en 类型化字典。
- [x] 依赖旧右栏 DOM 的测试改用新入口：6 个 E2E（jobs、schedules、subagents、teams、terminal-details、trace），以及协作、追踪 tab、定时任务通知 3 个浏览器测试，修改原因记入 Comments。真实 App 的 Browser Mode 覆盖以上场景，包括 390px 宽度。
- [x] 按测试约定运行最小相关测试集与类型检查，同步上述文档；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户回复“全部采用推荐”，确认 12 张票及其阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05：完成 RP-01—03、RP-04 单例部分、RP-05、RP-06 容器与几何部分、RP-07 关闭按钮部分、RP-09、16、18。新增无 React 的 `layout-store.ts`，按 Session 保存有序页面、活动页与展开状态；共享 `PanelTabs` / `PanelStart` 负责上沿与引导卡片；六个正文继续使用原组件。标题栏与卡片入口使用 `openPage(sessionId, kind)`；最后一页关闭会收起并恢复标题栏入口焦点。新对话与内容页不显示右栏。
- 几何依据：实施前读取 DeepSeek Harness `packages/client/ui-dockkit/src/components/dockkit.module.css` 的 `.tabStrip` / `.tab`：控件 H28、顶部 10px 留白，总高 38px；胶囊 min 80px / max 170px，使用 Coko R8。只采用尺寸与布局规则，未复制其源码。本票不修改 `.pen`。
- TDD：先添加真实 App 的开始页切片，在旧实现运行 `pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx -t 'opens Start on demand'`：1 失败、31 跳过，原因是旧界面没有“Open sidebar”入口及开始页。实现后同命令 1 通过、31 跳过。随后补充按 Session 切换、非 Session 页面隐藏、390 CSS px 的 en/light 与 zh/dark 场景。测试全程使用真实 App、store 与内存协议后端。
- 测试迁移：固定六 tab 改为先打开开始页，再点击页面卡片；按 Session 的设置跳转断言改为目标 Session。修改协作、追踪、定时任务通知、dock、会话菜单和标题栏消费者；E2E 的 jobs / schedules / subagents / trace 及 session-download / conversation-status-header 改为新入口与文案，并将收起按钮限定在右栏内，避免英文左侧栏同名按钮。teams 与 terminal-details 已通过标题栏 / Job chip 直接打开页面，无需机械修改。Trace 浏览器测试补充 Toast 清理，防止前例的导出成功 Toast 在 390px 视口中遮挡下一例入口。共享 Browser Mode setup 清理模块级布局状态，避免不同用例共用 Session ID 泄漏布局。
- 最终检查（退出码均为 0）：`pnpm install --frozen-lockfile`；`pnpm run typecheck`；`pnpm run lint`；`pnpm run check:docs`（342 个 Markdown，0 问题）；`git diff --check`。以下最小相关集共 8 文件、117 用例通过（77 浏览器、40 样式守卫），0 跳过：
  ```sh
  pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/conversation/dock/dock.browser.test.tsx apps/desktop/src/renderer/features/settings/schedules-notifications.browser.test.tsx apps/desktop/src/renderer/features/right-panel/trace-tab.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-menu.browser.test.tsx apps/desktop/src/renderer/features/conversation/collaboration.browser.test.tsx apps/desktop/src/renderer/features/conversation/business-timeline.browser.test.tsx packages/ui/src/guards/style-guard.test.ts
  ```
- 文档影响：原位更新 workbench 的容器、入口、文案、几何与内存状态，以及 plan-mode / jobs / subagents / teams / schedules / tracing 的打开或聚焦语义；经 AGENTS → docs/README → 正文读回，归属、活动链接、实施范围与原有页面内容边界一致，正式文档不依赖任务材料。搜索旧入口和“在右栏查看”确认产品文案已替换；源码注释和历史测试说明中的旧术语不作为可见文案修改。
- 本票关闭表示上述容器切片与消费者迁移已交付。中键 / 菜单 / 排序 / 发光留给 02，宽度 / 全屏留给 03，保存留给 04。未运行真实模型、Electron E2E、agent-browser、原生拖拽 / 红绿灯、产物或 CI；真实 Electron 与静默窗口验收按集成流程在 12 统一执行，不能将本票 Browser Mode 结果当作这些入口已经通过。
