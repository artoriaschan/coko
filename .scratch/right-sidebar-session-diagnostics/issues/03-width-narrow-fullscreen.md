# 03: 宽度、窄窗口与全屏

**What to build:**

- **分隔条与宽度。** 右栏左缘新增分隔条：可以拖动，也可以聚焦后用方向键、Home、End 调整，键盘步长与左侧栏分隔条相同。首次打开时宽度为帧宽的 45%，下限 300px，上限为帧宽的 70%，中栏至少保留 400px。宽度偏好只记在窗口内存中，重新加载后回到 45%。
- **空间不够时。** 列宽算法照搬 DeepSeek Harness：左侧栏不为右栏让位；右栏先缩到 300px，仍然放不下就整栏收起，并写入该 Session 的展开状态。右栏不再覆盖中栏。
- **全屏。** tab 条末端新增“全屏 / 退出全屏”按钮。全屏面板覆盖整个窗口，底层的列宽不变。普通与全屏形态共用同一棵内容树，切换时页面不重新挂载。宽度拖拽区只在普通形态显示。全屏面板遵守窗口安全区与拖拽区约定。
- **窄窗口。** 帧宽小于 768px 时，打开右栏会自动全屏。在这种窄窗口下退出全屏，右栏随之收起；窗口变宽后不会自动重新打开。

**规格场景:** [spec](../spec.md) 的 AC-10、11、12、13；对应 RP-10、11、12、13。

**设计依据:** [design](../design.md) 的“三栏几何”模块。spec 的“已知后果”记录了一种情况：窗口宽度接近 1024px 而左侧栏被拉宽时，右栏可能打不开，并静默收起；design 的待决问题决定照搬这种静默收起。

**文档影响:** workbench 的应用框架与右栏几何；ui-design-system 的右栏分隔条与全屏。

**Blocked by:** 01 — 右栏改为按 Session 的单格 tab 容器

**Status:** ready-for-agent

**Closed:** true

- [x] 拖动和键盘调整都限制在上下限之内，中栏不少于 400px。分隔条有 separator 语义与可访问名称，只在普通形态显示。重新加载后宽度回到 45%。（AC-11）
- [x] 左侧栏拉宽到 420px 后缩小窗口：右栏先缩到 300px，然后整栏收起；左侧栏不收起，右栏也不覆盖中栏；窗口变宽后右栏不自动打开。原来的两个步骤“侧栏为右栏收起”和“右栏覆盖中栏”删除。（AC-12）
- [x] 窗口宽 700px 时打开右栏，自动全屏；退出全屏后右栏收起；拉宽窗口后不自动打开。（AC-13）
- [x] 进入和退出全屏时，页面不重新挂载，展开状态与滚动位置保留。全屏面板按窗口安全区排版，交互控件不落入拖拽区。与原生红绿灯的实际关系由 12 检查。（AC-10）
- [x] 断言旧几何的 AppFrame 测试随行为一起修改，原因记入 Comments。AppFrame 浏览器测试和真实 App 的 Browser Mode 都断言实际几何。
- [x] 按测试约定运行最小相关测试集与类型检查；AppFrame 是共享接口，所以范围扩大到使用它的浏览器测试。同步上述文档；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户回复“全部采用推荐”，确认 12 张票及其阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

### 2026-11-05 实施完成

- 基线为集成分支 `4d9f4250`；独立分支 `codex/right-sidebar-03`、worktree `/tmp/coko-right-sidebar-agents/ticket-03`。实现提交 `f58904c` 后合并集成分支的第 02 票 `a6e34b7a`；RightPanel 的导入与工具按钮冲突保留两侧能力，包含排序、关闭、发光，以及 28px 的收起/全屏按钮。
- `computeFrameLayout` 删除“左侧栏让位”和局部覆盖形态；AppFrame 经 `onRightOpenChange(false)` 回写放不下的收起状态。右栏分隔条沿用 16px 键盘步长，左右箭头按分隔条的物理移动方向调整宽度，Home/End 为上下限；指针释放、取消、失焦和卸载均释放新增的拖动监听。
- App 在内存中持有右栏宽度偏好，首次挂载默认 45%，不写存储。布局 store 增加按 Session 的 `mode` 与 `setRightPanelMode`，仅保存手动形态；框架派生小于 768px 的自动全屏。全屏使用同一个 section 和正文树、保留普通列宽，背景 inert，左侧安全区避让窗口控制按钮。窄窗口退出全屏同时收起。
- TDD：首个几何单测先观察到 1119px 帧宽、420px 左侧栏时旧实现把左侧栏收起的失败，再以保持 420px/关闭右栏通过；真实 AppFrame 的状态回写、宽度分隔条、全屏，以及真实 App 全屏按钮均观察到对应旧行为失败后通过。几何断言使用真实 DOM 边界，验证 300px、400px、45%、70%、700px 自动全屏、展开与滚动及 DOM 身份保留。
- 旧 AppFrame “覆盖中栏”测试改为收起并不重开；business-timeline 的 Plan 导航与 permission-states 的 Inspect 导航后，先收起右栏再用键盘操作主区，避免键盘穿透窄窗口的全屏面板。保留原有审批与 Goal 断言。

### 验证与限制

- 合入 02 后运行 `rtk pnpm install --frozen-lockfile`（退出 0）。
- 最终命令 `rtk pnpm run test packages/ui/src/app-frame/frame-layout.test.ts packages/ui/src/app-frame/app-frame.browser.test.tsx packages/ui/src/guards/style-guard.test.ts packages/ui/src/components/panel-tabs.browser.test.tsx scripts/browser-deps.test.ts apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/conversation/dock/dock.browser.test.tsx apps/desktop/src/renderer/features/conversation/business-timeline.browser.test.tsx apps/desktop/src/renderer/features/conversation/permission-states.browser.test.tsx`：9 文件、137 项通过、0 跳过，退出 0。包含明暗主题、zh/en、390 CSS px 的真实 App 消费者与共享 tab 条。
- `rtk pnpm run typecheck` 退出 0；改动 TS/TSX 经 `pnpm exec oxfmt` 与 `pnpm exec oxlint` 通过；`rtk pnpm run check:docs` 检查 342 文件、0 问题，退出 0；`rtk git diff --check` 通过。
- 因 AppFrame 是共享接口，另运行 `rtk proxy sh -c 'rtk pnpm run test $(rg -l "import.*App.*from|import.*renderApp|import.*renderFixtureApp" apps/desktop/src/renderer --glob "*.browser.test.tsx")'`：48 文件、388 项，341 通过、47 失败，退出 1，不能报告整个扩展集通过。其中 5 项为本次全屏导致的背景操作旧假设，已按上文迁移并由最终批次通过；41 项位于既有设置页、分区和模型服务表单测试。集成基线 `4d9f4250` 独立复核 settings-page 的 2 项、sections 的 5 项和 model-catalog 的 5 项失败，分别是旧滚动槽居中、菜单/标题栏期待及旧模型表单入口，未扩大本票产品改动；其他同类表单失败保留为扩展集缺口。
- 另 1 项为未改动的 new-chat 中文 light 场景 IME 焦点断言（第 161 行）：与本票消费者组合运行时失败，单文件命令 `rtk pnpm run test apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx` 的 11 项通过，单场景通过；集成基线 `a6e34b7a` 的 business-timeline/permission-states/new-chat 组合也通过 37 项。尚未建立本票代码的因果关系，未改产品、未放宽断言或延长超时；组合隔离问题交 12 继续核对，不计作已解决。
- 本票未运行真实 Electron 重启、agent-browser 或原生指针/红绿灯验证；按集成安排交 12。宽度不持久化由 App 内存所有权及新挂载默认几何覆盖，真实重载与原生层仍需集成验收，不以 Browser Mode 代替。

### 文档影响与读回

| 变化 | 所属正文 | 动作与核对 |
| --- | --- | --- |
| 右栏宽度、收起、Session 手动形态与自动全屏 | `docs/subsystems/workbench.md` | 更新当前契约、AppFrame 测试摘要 |
| 分隔条、38px 条、安全区及全屏几何 | `docs/tech-stack/ui-design-system.md` | 原位增加右栏小节，无新全局 token |
| 删除“窄窗口右栏浮层”旧结论 | `docs/subsystems/jobs.md` | 改为自动全屏/空间不足收起，链接工作台正文 |

已从 AGENTS → docs/README → workbench/jobs，以及专项导航 → ui-design-system 读回。路径与引用、语义同步、归属与权威、引用方向、生命周期、当前入口、新会话读入、历史保留均通过；没有新目录、替代链或归档修改，正式文档没有新增具体任务反向引用。搜索命中设计/规格中的基线描述保留历史语境，未把目标说明改写为过去已实现。原生验证与扩展集缺口如上。

### 2026-11-05 原生 E2E 提前补验

- 集成基线 `19578a20` 的旧页面 Electron 批次发现 schedules / subagents / trace 在缩到 390px 后立即读取控件边界，读到过渡中的旧列宽。独立 worktree `native-preflight-fix` 重新运行 terminal-details / trace：2 文件、2 失败（退出 1，46.01s），复现原始信号。临时几何探针确认帧已经是 390px、`data-right=fullscreen`，但网格列宽过渡中的导出按钮右缘仍为 840px；只等形态字段不足。等待真实面板边界 `[x, width] = [0, 390]` 后，原来的控件可达性与整页无横向滚动断言通过。三个用例现在等待这一外部几何条件；没有增加 sleep、重试或超时，也没有修改布局实现。
- terminal-details 的首段进度可能在首次发送的响应与 Session 订阅完成前发出；这些进度按当前契约不会回放。文件 `ready` 证实命令已经启动，CDP 临时探针证实订阅建立后的 `tool_update` 正常携带真实 ANSI 与换行。夹具增加 `emit` 文件屏障：真实命令就绪且工具卡已打开后才放行首段输出，仍由 `release` 放行第二段和退出码 7；命令使用 POSIX 引号而非把 JSON 序列化当作 shell 转义。回复断言改为 `assistant-message-body`，避免将先前交付的消息页脚计入正文；原始复制、ANSI 红色、连续输出、错误状态、后台 Job 身份与输出断言保留并通过。所有 `[DEBUG-native-preflight-*]` 探针已移除。
- 最终命令：`rtk pnpm run test --project desktop-e2e apps/desktop/e2e/terminal-details.e2e.test.ts apps/desktop/e2e/trace.e2e.test.ts apps/desktop/e2e/schedules.e2e.test.ts apps/desktop/e2e/subagents.e2e.test.ts`，4 文件、5 项通过、0 跳过，退出 0，45.67s。每次 globalSetup 均从此 worktree 构建产物，真实 Electron / Sidecar / faux 模型，独立临时目录、后台模式。`rtk pnpm run typecheck` 与四份改动测试的 `rtk pnpm exec oxlint ...` 退出 0。
- 文档影响：产品行为没有变化，只补充本票及集成验收票的检查证据；正式正文无需变更。测试同步遵循测试约定的“等待可观察状态”和“测试随行为演进”。本次没有验证真实鼠标、原生红绿灯或签名发布构建；第 12 票仍须对最终集成代码核对整体证据。

- 补充检查：`rtk pnpm run format:check apps/desktop/e2e/terminal-details.e2e.test.ts apps/desktop/e2e/trace.e2e.test.ts apps/desktop/e2e/schedules.e2e.test.ts apps/desktop/e2e/subagents.e2e.test.ts` 退出 0；`rtk pnpm run check:docs` 检查 342 个 Markdown、0 问题，退出 0；`rtk git diff --check` 通过。由 AGENTS → docs/README → 测试约定读回，测试接缝、同步方法、证据边界与本次改动相符；没有正式文档的失效引用或需迁移结论。
