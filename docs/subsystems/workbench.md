---
kind: reference
description: "桌面工作台的外壳、导航、两行对话标题栏、对话消息与输入区当前行为。"
lifecycle: active
---

# 桌面工作台

本文说明桌面工作台外壳、内容区导航、对话消息与主输入区。会话数据与执行状态由对应的 store 和 Sidecar 持有；窗口内的导航历史不持久化。

## 外壳与导航

[App](../../apps/desktop/src/renderer/app/app.tsx) 组合左侧导航与列表、右侧内容及可选的右面板。[AppFrame](../../packages/ui/src/app-frame/app-frame.tsx) 负责侧栏伸缩、整列收起与抽屉、拖动分隔条以及四角裁剪，圆角使用共享的 R28 主面板档位。

右栏左缘提供可聚焦的分隔条。拖动或按左右方向键（16px 步长）、Home、End 调整宽度：默认帧宽的 45%，最小 300px，最大为帧宽的 70%，同时为中栏至少保留 400px。宽度偏好由 App 在当前窗口内存中保存，切换 Session 沿用，重新加载回到默认。左侧栏不为右栏让位；普通右栏放不下 300px 时，框架回写当前 Session 的收起状态，窗口变宽也不自动重新打开。

tab 条末端的“全屏 / 退出全屏”切换该 Session 的手动形态。全屏覆盖整个应用帧，保留普通形态的底层列宽和同一棵右栏正文 DOM，展开与滚动状态不丢失；此时没有右栏分隔条，背景主区与侧栏不可交互。帧宽小于 768px 时，打开右栏自动全屏，不占普通右栏列，也不写入手动全屏偏好；在此宽度退出全屏会收起右栏，变宽不重开。全屏 tab 条按窗口左侧安全区避让 macOS 控制按钮，交互控件仍退出窗口拖拽区。

启动时先渲染品牌加载屏（[startup-screen.tsx](../../apps/desktop/src/renderer/app/startup-screen.tsx)）：覆盖整个窗口、背景取 `--background`、顶部 48px 保持窗口拖拽，正文居中展示 250px 圆形品牌角色。渲染进程在 Sidecar 连接后读取设置，等设置进入 `ready` 或 `error` 后先应用已保存的语言与主题，并确定开发者页面的可用条件，再渲染工作台；因此首帧就是保存的语言，不再出现“系统英文 → 应用中文”的闪动。连接失败或超过 10 秒仍无设置时也进入工作台，由工作台展示连接错误，避免一直停在加载屏。

侧栏采用不透明淡青灰底色，右缘带柔和的中性渐变，与内容区通过细线分隔；固定、悬浮和抽屉形态使用同一表面。应用帧绘制内侧细边框，对话标题栏底部绘制细分隔线，配色与主题映射见[设计系统规格](../tech-stack/ui-design-system.md#材质边框与浮层)。侧栏顶部安全区依次放置收起侧栏、后退、前进按钮；macOS 为原生窗口控制按钮预留空间。下面三项导航为新对话、插件和定时任务，高度均为 32px。新对话右侧的搜索按钮打开共享模态搜索浮层，不创建会话。收起侧栏时整列隐藏，主内容左上角显示展开、后退、前进和新对话四个 28px 按钮；悬停展开按钮浮出侧栏卡片，点击则在宽窗口固定展开、在窄窗口打开抽屉。搜索、插件、定时任务与设置入口在展开的侧栏或抽屉中。列表在中间独立滚动，底部设置入口固定为 46px 底栏中的 36px 圆弧按钮：16px 齿轮图标加“设置”，常态透明，hover 使用共享 accent；点击打开整页设置。设置 → 常规可只读查看主数据根与对话/项目根，并打开目录；路径来源与错误处理见[存储位置](configuration.md#主数据根与启动路径)。

[导航 store](../../apps/desktop/src/renderer/app/workbench-navigation.ts) 保存当前窗口中的内容区位置：会话、新对话、插件或定时任务。新位置清空前进历史，连续访问同一位置不重复记录；后退和前进跳过当前列表中已经不存在的会话，因此删除或归档后的会话不会重新打开。首次列表加载不制造一次额外的历史访问。外部入口打开会话也更新内容区位置。

插件与定时任务在内容区复用已有设置分区，侧栏保持可见；切换内容页会隐藏对话区并保留其实例。设置页覆盖整个工作台，但不卸载它，也不进入内容区历史；关闭设置后回到原位置，草稿、列表与滚动状态保留。设置页与对话区各自维持原有的焦点恢复和键盘行为。

导航历史只保存在 renderer 内存中，重启后为空。分类状态和新对话草稿的持久化由各自功能负责；本节不定义它们的数据格式。独立新对话未发送时没有 Workspace；专属目录与会话只在首次发送时创建。项目草稿引用已有的主要 Workspace。

## 开发者设置

设置 → 常规的“开发者”卡片提供“会话数据诊断”开关，说明为“在侧边栏启用当前会话的原始数据和对话分组数据分析功能”。它是默认关闭的全局偏好，所有项目共用，发布构建中同样可用；经已有设置接口保存 `developer` 键 `{ sessionDiagnostics: boolean }`，重启后保持。[schema 与缺省值](../../packages/protocol/src/control.ts)由协议包提供，Sidecar 只通过通用设置库保存值，不读取开发者偏好的语义。无效值或启动读取失败按关闭处理。

[设置 store](../../apps/desktop/src/renderer/stores/settings-store.ts)分别保存服务端已确认的值／revision 与当前开发者选择。开关立即采用当前选择；保存冲突或失败时显示应用级 Toast，并保留选择，离开再返回设置页也不撤销。[偏好装配](../../apps/desktop/src/renderer/app/preferences.ts)在工作台首次渲染之前确定页面可用条件，避免已保存的诊断 tab 在恢复时被错误过滤。

启用后，各 Session 的“开始”页末尾增加“会话数据诊断”卡片，不会自动打开页面。关闭后立即移除所有已采用布局中的诊断 tab；它是唯一 tab 时整栏收起。未采用布局在日后恢复时过滤掉诊断页，过滤本身不批量改写其他 Session 的保存键。诊断页检查主区当前 Session，只读，也可用于归档或 worktree 已移除的会话；页面提供“展示形式”、类型筛选浮层与只读数据表格，不提供会话消息输入；已加载条目的 Run 与主时间线分组、实时增量、虚拟化、筛选、跟随、JSON/运行时对象详情与引用见[会话数据诊断](session-diagnostics.md)。

验证：[真实 App 开发者 Browser Mode](../../apps/desktop/src/renderer/features/settings/developer.browser.test.tsx)覆盖开关默认值、保存、无效值／读取失败、冲突／失败保留选择、跨 Session 关闭与恢复、390px 中英文及明暗主题；[Electron 重启用例](../../apps/desktop/e2e/developer-diagnostics.e2e.test.ts)覆盖设置保持与诊断页恢复／关闭链路。

## 对话标题栏

详情页顶部的标题行高 48px，使用窗口安全区的 `--frame-top-clearance`；右栏上沿是独立的 tab 条。标题为 14px、500 字重，单行截断且 `title` 保留全文；worktree 分支 chip 紧跟标题。后台任务、子代理、定时任务和团队的状态入口保留既有行为。下方是独立的 tab 行，包含“对话”和“轨迹”，切换主内容视图，共用输入框。tab 使用 13px、500 字重，选中项使用 link 色文字与 2px 下划线，底部有发丝分隔线；左右方向键与 Home/End 移动焦点，Enter/空格选中。选择按 Session 保存在内存中；切换保留草稿、对话阅读位置和已挂载的轨迹状态。新对话页不显示标题与 tab 行。

主区不宽于 560px 且侧栏收起时，既有的展开侧栏、后退、前进和新对话控制条移到 tab 行左侧，主视图 tabs 位于其后。控制条保持同一份 DOM、28px 命中区及原有键盘路径；标题行仍为 48px，保留原生窗口安全区，四个状态入口、“更多”和打开右栏均留在标题行。此局部重排避免全部状态入口同时出现时溢出，以及聚焦行尾按钮引发主区的隐藏横向滚动。

标题栏不再显示 Sidecar 连接点、连接文字、Session 费用按钮及其分项浮层。连接状态由常驻的视觉隐藏 `role="status"` 元素播报，详情与新对话页均保留 `data-connection` 就绪信号；启动失败仍由全屏提示层说明原因。Session 费用可在 [Trace](tracing.md#追踪) 查看，[Goal 卡](goal.md#界面)继续展示 Goal 费用；计量、定价和货币格式化规则保留。

右栏关闭时，标题行末尾显示 `panel-right` 图标按钮，可访问名称与 Tooltip 均为“打开侧边栏”。打开后入口隐藏，使用 tab 条末端同一 `panel-right` 图标的“收起侧边栏”收起，Tooltip 同样为“收起侧边栏”；两处 Tooltip 均不附加快捷键文案；关闭后焦点回到重新出现的打开按钮。左侧栏开关统一使用 `panel-left`，展开与收起保持同一图标。两侧栏开关与右栏打开按钮左侧的“更多”按钮均为 28px 点击框、16px 图标、1px 描边。状态按钮和计划入口打开或聚焦当前 Session 的对应页面，并展开右栏；时间线“查看”切换到标题栏轨迹 tab。共享 [IconButton](../../apps/desktop/src/renderer/app/icon-button.tsx) 的 Tooltip 缺省沿用可访问名称，也可单独传入已本地化的文案。

右栏是按 Session 区分的单格 tab 容器，由 [布局 store](../../apps/desktop/src/renderer/features/right-panel/layout-store.ts)集中持有页面列表、顺序、选中项、展开状态和手动全屏形态，并写入每个 Session 的 `coko.right-panel.v1.<sessionId>` localStorage 键。切换 Session 后使用该 Session 自己的布局；新对话、插件和定时任务内容页不显示右栏与开关。首次展开空布局显示“开始”，居中入口包含计划、后台任务、子代理、定时任务、团队；有专属目录的独立会话还在首位显示 Artifacts；点击后原位替换引导页。从其他入口直接打开页面不补引导页，同一种页面只开一个 tab。没有引导页时 tab 条提供“新标签页”按钮。

布局在正文首次渲染前同步恢复，[读回校验](../../apps/desktop/src/renderer/features/right-panel/layout-persistence.ts)检查字段类型、唯一的页面列表和选中项成员关系；损坏时只清除对应 Session 的键。轨迹已移至主内容区，旧布局中的 `trace` 与其他未知或不可用的页面被过滤，原选中项被过滤时选择第一个剩余项，列表为空时回到初始收起状态；过滤本身不重写键，下一次布局操作才保存当前值。页面内部的临时选择和窗口宽度偏好不保存，窄窗口的自动全屏也不改变保存的手动形态。写入失败不影响内存中的布局，并在当前 renderer 生命周期内只记录一次诊断日志。归档保留布局；永久删除按服务端返回的全部 Session 身份（含子 Session）清除内存布局及各版本的布局键。[真实 App 持久化 Browser Mode](../../apps/desktop/src/renderer/features/right-panel/layout-persistence.browser.test.tsx)覆盖读回、Session 切换、写入、损坏隔离、真实存储配额耗尽及归档／删除；原生重启路径见 [Electron E2E](../../apps/desktop/e2e/right-panel-persistence.e2e.test.ts)。

右栏没有独立标题行。共享 [PanelTabs 与 PanelStart](../../packages/ui/src/components/panel-tabs.tsx)承载 tab 胶囊、关闭按钮、引导卡片和末端收起按钮；tab 标题实时跟随界面语言。开始页以淡色罗盘和单列横向卡片呈现入口，图标与标题左对齐，窄或矮面板中卡片保持可滚动、可通过键盘到达；几何见[设计系统](../tech-stack/ui-design-system.md#右栏-tab-条与引导页)。关闭最后一个普通页面时整栏收起，下次展开重新显示“开始”；唯一的引导页没有关闭按钮。上沿总高 38px（顶部 10px 留白与 28px 控件），空白属于窗口拖拽区，按钮退出拖拽区。各页面的正文与数据来源继续遵循各子系统契约。

tab 条按手动激活的 WAI-ARIA tabs 模式工作：左右方向键与 Home/End 只移动焦点，Enter/空格选择页面；⌘/Ctrl+Shift+左右方向键移动聚焦的 tab 并保留活动页面。指针排序复用 `@dnd-kit/core`。tab 可以用关闭按钮、中键，或共享右键菜单中的“关闭”“关闭其他标签页”“关闭右侧标签页”关闭，批量关闭仅影响当前 Session；唯一的引导页中键与右键均无效。tab 溢出时横向滚动并按滚动位置渐隐，后面的新标签页与收起按钮不被压缩；实际截断的标题在悬停或键盘聚焦时通过 Tooltip 显示全文。

从外部入口重复打开已显示的活动页面时，共享 `PanelAttention` 在该格内发光约 600ms；切到后台页面或重新展开右栏不发光。减少动态效果时，同样保留 600ms 的静态提示。发光只重建覆盖层，正文不重新挂载。[真实 App 右栏 Browser Mode](../../apps/desktop/src/renderer/app/app.browser.test.tsx)覆盖排序、关闭、焦点、390px 明暗主题与中英文，以及真实浏览器 reduced-motion 偏好；[共享标签条 Browser Mode](../../packages/ui/src/components/panel-tabs.browser.test.tsx)覆盖长标题截断与全文 Tooltip。

右栏快捷键由 [关闭与快捷键命令](../../apps/desktop/src/renderer/app/right-panel-commands.ts)统一处理：⌘/Ctrl+Alt+B 展开或收起当前 Session 的右栏，展开后聚焦活动页面；焦点在右栏内时，⌘/Ctrl+Alt+Enter 切换全屏。没有当前 Session、处于插件或定时任务内容页、设置覆盖工作台、输入法组合期间或前台浮层打开时，这两个快捷键不改变右栏。收起后焦点回到标题栏的打开按钮，按钮以 Tooltip 与 `aria-keyshortcuts` 标出有效键位。延后聚焦前会重新核对当前 Session、页面和浮层，避免切换内容后抢回焦点。

应用菜单的 File → 关闭绑定 ⌘/Ctrl+W，并交给 renderer：前台弹窗、菜单或对话框先经过自己的 Escape 关闭规则，拒绝关闭时命令也不穿透；否则焦点在可见右栏内时关闭活动页面。唯一“开始”页收到关闭命令只收起右栏，保留引导页；关闭后仍展开时聚焦同一 Session 剩余活动页面，可连续关闭。焦点在右栏外时请求 main 关闭窗口，输入法组合期间忽略该命令。原生菜单、bridge 与未就绪回退见 [桌面交付](delivery.md#应用菜单与关闭)。对应入口用例为 [快捷键 Browser Mode](../../apps/desktop/src/renderer/app/right-panel-shortcuts.browser.test.tsx)与[原生菜单 E2E](../../apps/desktop/e2e/right-panel-menu.e2e.test.ts)。

详情页右侧常驻“更多”按钮，位于右栏开关左侧，归档 Session 与 390px 窗口下也可使用。菜单只有“Session 下载”，通过 Electron 默认下载保存为 `coko-session-<id>.jsonl`；内容包括本 Session 与子 Session 的脱敏条目，格式和 [Trace 导出](tracing.md#导出与回放)相同。菜单支持键盘打开与选择、Escape 关闭及焦点返回。“更多”与 Trace 的导出共用同一 Session 的导出锁、下载和 Toast 反馈。

验证：[真实 App 的标题与连接状态 Browser Mode](../../apps/desktop/src/renderer/app/app.browser.test.tsx)、[Session 汇总与标题栏费用移除](../../apps/desktop/src/renderer/features/conversation/session-cost.browser.test.tsx)、[真实 Electron 联合验收](../../apps/desktop/e2e/conversation-status-header.e2e.test.ts)（四个状态入口同时存在、zh/en、明暗主题、390px、控件命中区及主区无横向偏移）。

## 对话搜索

[搜索浮层](../../apps/desktop/src/renderer/features/sidebar/conversation-search.tsx) 每次打开清空关键词并聚焦搜索框，默认按最后记录时间降序显示最近 10 个未归档会话；输入非空关键词后显示全部标题包含匹配，忽略首尾空白和英文大小写。搜索不读取消息正文、附件或项目名称；独立、项目内、置顶会话按 Session 身份去重。清空恢复最近列表，没有会话与无匹配分别显示空状态。

浮层使用共享 Dialog 遮罩，基准为 640 × 432px、R28、12px 内边距；搜索框高 40px，结果行高 32px，仅结果区滚动。结果显示聊天气泡、标题命中高亮、真实项目标签（独立会话无标签）与最后记录时间；搜索和会话详情卡共用时间格式：七天内显示相对时间，超过七天显示本地化日期。截断标题仍保留完整可访问名称。项目改名、移动或移除组织关系后，标签随列表 store 更新。

方向键移动当前结果，Enter 或点击通过工作台导航打开同一个已有 Session，保留其项目和置顶状态。输入法组合期间不确认且不刷新匹配，组合结束后更新。Escape 与外部点击关闭浮层，未选择时原内容不变，焦点返回搜索入口；再次打开没有旧关键词。搜索框保持焦点时，ContextMenu 或 Shift+F10 为当前结果打开同一菜单，以结果行左下角定位并沿用窗口避让；关闭后返回搜索框。子菜单先关闭子层，删除取消和行内改名完成后保留查询并归还焦点。组合输入期间这些菜单命令不触发。右键复用会话菜单的鼠标定位和边缘避让，菜单动作保留目标身份，重命名、置顶、归档、移入移出项目和删除沿用同一套操作；归档成功从当前结果移除，失败保留查询与结果并反馈原因。删除确认使用共享会话删除弹窗并叠在搜索之上，取消后保留关键词与结果。

验证：[搜索 Browser Mode](../../apps/desktop/src/renderer/features/sidebar/conversation-search.browser.test.tsx)、[工作台入口 Browser Mode](../../apps/desktop/src/renderer/app/app.browser.test.tsx)、[真实 Electron 会话身份](../../apps/desktop/e2e/conversation-search.e2e.test.ts)。

## 对话消息与思考

[启动入口](../../apps/desktop/src/renderer/main.tsx)等待工作台异步模块及其 Markdown/CSS 依赖完成后才显示会话，期间沿用品牌启动屏。[Markdown 正文](../../apps/desktop/src/renderer/features/conversation/markdown.tsx)直接渲染，不再在加载阶段显示原始 Markdown 文本；初次恢复历史和切换会话的第一棵正文 DOM 已包含标题、列表、强调等结构及其样式。重型插件保留在工作台异步依赖中，不进入启动入口 chunk。[首次正文浏览器测试](../../apps/desktop/src/renderer/features/conversation/markdown-loading.browser.test.tsx)和[原生启动回归](../../apps/desktop/e2e/markdown-startup.e2e.test.ts)逐次观察正文首次提交，避免只检查最终排版而漏掉中间的无样式显示。

会话表格通过共享渲染器的 `tableMaxHeight={0}` 使用自然行高，移除 Streamdown 默认 300px 纵向限高；纵向由会话消息区滚动，横向溢出仍在表格内部滚动。表格离开视口后调整窗口、再滚回时，容器随实际行高重排，不保留独立纵向滚动位置。复制、下载和全屏入口继续保留。对应[明暗主题与离屏缩放浏览器用例](../../apps/desktop/src/renderer/features/conversation/markdown-table-resize.browser.test.tsx)和[真实窗口缩放用例](../../apps/desktop/e2e/markdown-table-resize.e2e.test.ts)使用长行内代码夹在短行之间的表格，检查容器高度、行内空白、全页横溢及实际捕获。

[消息时间线](../../apps/desktop/src/renderer/features/conversation/timeline-view.tsx)保持原始用户文本、命令调用和展开全文、文件引用、有效图片附件与回退操作。用户气泡为 14px/22px、10px/16px 内边距、R20，最大宽度取聊天列的 70.2% 与当前可用列的 82% 中较小者；消息区左右各留 32px。附件引用显示完整路径并可换行，不伪造文件尺寸或其他元数据。

[内容宽度](../../apps/desktop/src/renderer/features/conversation/conversation-width.tsx)参照 Harness 手动调宽时的可用范围，默认直接展开至 `max(680px, 会话列宽 − 176px)`，不再使用原来的 64% 比例与 920px 上限；用户于 2026-11-06 指出原默认宽度未调整后，采用此默认宽屏展示。消息列居中，输入框、Dock 与接管卡比消息列宽 32px；空间不足时缩至可用宽度。两侧拖动条位于正文外 24px、宽 10px，仅两侧余量足够时出现；拖动保持中心轴，手动宽度至少 640px，最大取默认展开宽度。偏好保存在本机 localStorage 的 `coko.conversation.contentWidth`，窗口缩窄仅限制显示宽度。键盘左右键每次调整总宽度 32px；Home 或双击恢复默认展开宽度。欢迎页仍沿用自己的 768px 宽度。

[轮次指示器](../../apps/desktop/src/renderer/features/conversation/turn-navigator.tsx)从主时间线的真实 Run 归属生成刻度，至少两轮时显示在会话详情左侧，距边缘 12px；不把回退历史和子 Session 混入主区。刻度间距 10px，当前轮由实际阅读位置决定，贴底时指向最后一轮；点击或键盘激活跳到该轮输入，没有输入时使用该轮已显示的首项。指针悬停与键盘聚焦显示输入和回复预览，离开关闭；预览复用共享 Markdown 渲染器，标题、加粗、行内代码、链接和列表显示为渲染后的内容，输入最多一行、回复最多三行，卡片最多 100px；预览为只读，不提供复制、下载和全屏控件；长列表在最多 420px 的独立区域内虚拟化并滚动，边缘渐隐。主区宽度不超过 964px 时隐藏，以匹配 Harness 在正文可用宽度不超过 900px 时的避让规则。跳转释放原阅读锚点，新增内容不会强制拉回底部；返回底部恢复跟随，减少动态效果时跳转不播放平滑滚动。

用户底栏依次显示发送时间、原文复制与回退，不再呈现用户分叉按钮。时间读取用户消息 Session Entry 的 `createdAt`，按本地时区显示紧凑标签：同一本地日为 24 小时 `HH:mm`，同年更早日期带月日，往年带年月日，跨过本地午夜后自动变宽；共享 Tooltip 在悬停及键盘聚焦时提供完整日期与秒，缺少可信时间不使用查看时刻补齐。时间、复制与回退作为一条底栏整体显隐：最后一条用户消息的底栏常显，较早的用户消息在支持 hover 的设备上随悬停或焦点进入整体显示，无 hover 时全部可见。复制使用用户原始文本（命令使用原始 `/name 参数`），不包含展开上下文、文件引用正文或图片二进制；成功短暂显示勾号与已复制提示，失败沿用应用错误反馈且不保留成功状态。回退沿用三模式确认、默认对话和代码、文件预览及原始草稿合并规则；旧用户锚点分叉协议继续保留。回退与旧分叉协议仍由原 Checkpoint、Run、审批和只读条件决定。助手正文使用现有 Streamdown 渲染器，消息局部样式适配 14px/24px 正文、标题与列表节奏、11px/19px 代码和行内代码、代码工具栏；静态文档的排版不受影响。

成功结束且有最终助手正文的 Run 只在最后一条回复的最后一个文本块下显示一个[助手底栏](../../apps/desktop/src/renderer/features/conversation/assistant-footer.tsx)；阶段回复和生成中的回复不显示结束底栏，原独立 Token／费用行已移除。复制会合并该条回复的原始 Markdown 文本块（块间保留空行），不含思考、工具或底栏；成功与失败沿用用户复制的反馈。底栏结束时间使用实际 `run_end.createdAt`，采用与用户消息相同的时间标签和日界，Tooltip 复用完整日期、秒与键盘路径。底栏的时间与操作整体显隐：最新底栏常显，历史底栏随消息 hover 或焦点显示；无 hover 时常显，详情通过 portal 打开期间保持操作可见，不替换原消息身份。

用量按钮使用数据库图标和紧凑读数（如 `Usage 1.3K tok`，紧凑值在三位以上取整：517、12.2K、517K、1.2M）；明确全零显示 `0 tok`，缺失显示未取得，部分统计不在底栏加文字标记，完整性只在详情卡说明。点击打开共享 Popover，优先位于按钮上方并按视口避让；再点按钮、外点和 Escape 均可关闭并返回焦点。详情卡标题左侧为图标与“本轮用量”，右侧为精确总数（千位分组）；行依次为提供方／模型（多模型用逗号连接）、缓存命中、未缓存输入、缓存读取、缓存写入、输出（推理子集内联在输出后，如“其中推理 N tok”）。未报告或为零的缓存分桶不占一行；已报告但来源未知的计数使用 ≥，未知且为零的必填分桶使用破折号。完整性只要求未缓存输入与输出，缓存桶按可选字段处理；缓存命中率与缓存行都只在缓存值大于零时显示，缓存缺失不会提示“不完整”，完整性说明只在输入或输出未知时出现。缓存命中率为缓存读取除以三种输入分桶之和，仅在完整且输入总量大于零时显示，部分命中不会四舍五入成 100%。汇总优先使用带 `requestId` 的请求事实；旧助手消息、压缩与交接的 usage 只在没有请求事实时回退，并与请求按四桶签名配对，配不上的本轮不再声称完整。计数必须是安全非负整数，声明的总量小于分桶和时该来源不计入。时间线一次遍历生成每个 Run 的汇总，底栏不再各自扫描全部条目。新底栏和详情不显示费用，费用与定价仍用于 Trace 和 Goal 预算。停止、失败与没有最终助手正文的 Run 在结束状态或已有内容后显示一个同样的底栏；只复制该轮最后实际产出的正文，完全无正文时没有复制。阶段回复不重复附加动作，停止、失败和暂停不提供成功分支。没有计量记录也保留“未取得用量”的详情入口，明确全零继续显示真实 0 tok。暂停与中断状态、错误重试和结果确认仍保留；中断恢复补写的时间不是实际结束时间，不显示为底栏时间。仅由进度得知而未成功提交结束记录时，底栏保留已报告计数但不伪造结束时间或开放重试。隐藏的重复结束位置不占过程列表尾部空间。

完整性还要求有可信的 Run 结束事实。中断恢复或结束记录未成功提交时，即使此前每条请求都完整报告，也不能证明没有丢失后续尝试；底栏保留已报告小计，完整性只在详情卡说明，各桶只显示已知下界或未知，不把先前的零当作整轮精确零。复制历史的成功最终回复来源证明仍可证明源 Run 已结束，不新增消费或补造结束时间。没有 canonical 请求的备用消息若已有 `usage.report`，同样尊重其 `known`／`complete`；只有真正没有报告元数据的旧记录才沿用历史兼容口径。旧 SDK 未报告 reasoning 时也可能填零，因此没有报告元数据的可选 reasoning 零不显示为实测值；可信正值和明确报告的零继续保留。

验证：[异常及无正文底栏 App Browser Mode](../../apps/desktop/src/renderer/features/conversation/ended-footers.browser.test.tsx)、[助手底栏 App Browser Mode](../../apps/desktop/src/renderer/features/conversation/assistant-footer.browser.test.tsx)、[请求计量兼容 App Browser Mode](../../apps/desktop/src/renderer/features/conversation/request-usage.browser.test.tsx)、[真实 Electron 剪贴板、无 hover 与重载](../../apps/desktop/e2e/message-footers.e2e.test.ts)。[真实协议至 Electron 的联合用例](../../apps/desktop/e2e/message-footers-protocol.e2e.test.ts)经自定义 Provider、真实 Sidecar 和 SQLite 验证重试／工具循环、标题与子 Session 排除、部分报告停止、成功与失败压缩、历史助手分支及应用重启；只有远程模型 HTTP/SSE 由本地可控服务替代。

[思考行](../../apps/desktop/src/renderer/features/conversation/reasoning-row.tsx)只显示非空白内容，流式与历史内容初始均收起。流式预览取最近一个首行已以换行结束的段落的首行；尚未完成的单行不产生预览。结算后预览显示首行，仅预览去掉 `**`，展开后的紧凑 Markdown 保持原文。标题行高 24px，展开正文从标题起点缩进 22px；悬停和键盘焦点显示开合箭头，运行中的文字扫光在 reduced-motion 下关闭。

[显示身份映射](../../apps/desktop/src/renderer/features/conversation/message-identities.ts)仅保存在当前视图内，已提交内容仍以条目序号和内容块索引标识。仅在同一 Session、同一真实 Run 和内容块索引能唯一对应时，把流式块的 React 身份延续到新提交块；不从文本推测归属，不因结算、增量或主题变化重置思考开合与选区。主区和右栏子 Session 均显式传递 Session 身份与真实条目（`TimelineSessionContext`）；业务行从这些调用方事实读取自己的来源，历史条目 key 不依赖已经加载的消息数量。此映射不写入数据库或协议。

验证：[真实 App 消息 Browser Mode](../../apps/desktop/src/renderer/features/conversation/messages.browser.test.tsx)覆盖预览、流式结算的 DOM/开合/选区、原文复制、外围几何、命令与附件、明暗主题和中英文的 390px 主内容区，以及 Markdown 排版；右栏现有[子代理](../../apps/desktop/src/renderer/features/right-panel/agents-tab.browser.test.tsx)和[团队成员](../../apps/desktop/src/renderer/features/right-panel/team-tab.browser.test.tsx)验证共用时间线消费者。

## 详细过程与三级折叠

[过程投影](../../apps/desktop/src/renderer/features/conversation/process-groups.ts)从扁平时间线的真实 Run 来源收集相邻思考和工具。可见助手回复、输入、独立业务行及不同或未知 Run 归属截断组；工具类别和模型请求变化不会拆组。无独立行的 Job 起止事实不拆组；曾真实显示的 Plan 审阅是独立阶段边界，即便 proposed 卡之后被批准或拒绝快照替代也保留该边界，避免结算时重新挂载已展开的工具及丢失焦点。消息、状态、审批、确认与用量入口仍独立显示；未送达追加指令仍由 Queue 唯一显示。

过程正文内，思考行与按请求组织的工具分组并列；同一助手消息中的相邻工具进入同一分组，消息序号变化或思考行会分隔分组。流式调用按现有进度批次展示，结算后使用实际助手消息序号；分组以首个调用 ID 保留显示身份。分组名称使用“操作类型 · 任务说明”，不再固定显示“工具调用 · N 个调用”：同类操作使用运行命令、读取文件、搜索代码等名称，混合文件／命令操作和实际 `run_code` 使用“代码”。说明优先取记录中的 `description`，缺失时回退到命令、路径、模式等真实参数；未知工具回退工具名。bash 参数新增可选 `description`，仅作展示，不进入执行命令或权限判定；单条 bash 行同样优先显示说明。图标保持类型标识，悬停或键盘聚焦时换成开合箭头。

外层活动摘要直接沿用 Harness 的类别计数与译文组合：真实调用按 ID 去重，按次数降序、同数按首次出现排序，显示前三类；两类中文仅在译文都以“已”开头时共享前缀。Coko 的 `find`、`ls` 纳入文件搜索类别。展示分组不补造 `run_code` 或父调用，因此只有实际代码调用才会让外层摘要出现“运行了代码”；全部为 bash 的历史仍如实归为命令。工具子项沿用 Harness 的 22px 外缩进、8px 内缩进与 0.5px 竖线，默认显示，可独立折叠；单条工具的输入输出仍按需打开。用户于 2026-11-06 选择采用此展示分组。整轮手动重置关闭单条明细，工具分组恢复默认展开；定位工具时同时揭示该展示分组。

验证：[详情 App Browser Mode](../../apps/desktop/src/renderer/features/conversation/conversation-detail.browser.test.tsx)覆盖明暗主题、真实嵌套几何、分组与单条开合、轮次预览和跳转、长刻度列表、宽度持有与重置，以及 390px 避让。

主区时间线在 layout effect 中发布本次实际提交的过程席位、显示身份、时间线项与 Run，供[会话数据诊断](session-diagnostics.md#对话分组)只读订阅；子 Session 与回退历史的嵌套时间线不发布。发布不改变过程计算、树的层级或阅读锚点，工具、思考和消息的语义根保留对应显示身份属性。语义根同时暴露 Run、来源 seq、toolCallId 与过程组 id。[主区展开入口](../../apps/desktop/src/renderer/features/conversation/timeline-reveal.tsx)按主时间线所有者路由定位请求，复用三级展开状态并保留 reset epoch；同 Session 的回退历史继承入口，子 Session 不注册。定位期间由阅读策略暂时释放旧锚点，按目标的实际布局逐层揭示，完成后保留新位置。高亮与瞄准位于 body 层，不增加消息树节点；完整匹配、回退与取消语义见[会话数据诊断](session-diagnostics.md#定位与瞄准)。

固定详细模式下，所属 Run 运行中的全部组直接平铺，包含已被阶段回复截断的早期组：无组头、无组级限高、4px 行距。正常结束且有过程、过程开始后没有中途可见输入、没有未处理授权/结果确认限制时，整轮默认收起全部过程，保留所有回复和输入；无需最终答案，纯回复不会产生空过程控件。失败、停止、暂停、中断、运行中或中途输入的 Run 不提供整轮折叠。未知未结束状态保持过程可见。

历史组头按真实工具调用身份计活动次数（包括失败），降序排列、同数按首次出现排序，只显示前三类，不把摘要当作成功证明；纯思考使用分析摘要。整轮展开后组正文初始收起，打开组后再按需打开单条工具或思考。历史组正文上限 `min(400px, 50vh)`，组头与正文间距 8px，按实际上下滚动方向应用 24px 渐隐；手动展开历史组从顶部开始，内部跟随独立于外层。

[稳定过程容器](../../apps/desktop/src/renderer/features/conversation/process-timeline.tsx)从首次运行显示起保持父子结构，先解析整份时间线的 live→committed 消息身份，再按成员重叠保留组身份。普通增量、结算和生命周期变化不重置详情；显式收起整轮才通过局部 reset 清空内部开合。自动完成不会隐藏当前键盘焦点；手动收起先聚焦对应控制项，焦点保留例外不阻止之后的手动组收起。

Run 状态和耗时读取真实开始/结束记录；缺失起点或可信终点时不显示已结束耗时。运行计时在连接断开时冻结、重连后追平，数字不参与持续状态播报。右栏子代理和团队成员使用相同分组投影与独立 Session 身份。完整长内容、尺寸变化和历史锚点协调不由此处的基本分组实现替代。 协作来源、Agent 手动详情与整轮重置、团队批量送达、定时指令、交接及父子 Session 隔离由[真实 App 协作用例](../../apps/desktop/src/renderer/features/conversation/collaboration.browser.test.tsx)验证。

消息区、Agents 与 Team 子 Session 的外层滚动共用按 Session 隔离的阅读策略。贴底时跟随条目与实际尺寸增长，包括展开通用详情、流式正文和结算后的尺寸；用户滚轮、触摸或键盘向上阅读后保留可见内容，回到物理底部恢复跟随；主消息区另有“返回底部”，主动返回时将焦点交回消息区。限高过程组有自己的跟随状态，手动展开总从顶部开始；组内到达边缘后允许滚轮继续传给外层。

高度变化与历史快照增补优先保留实际可见消息、思考、工具和独立业务行；隐藏项与整轮控制项不作为阅读锚点。更早过程成员加入限高组时先补偿组内位置，再补偿外层；手动重新展开释放旧内部锚点；若关闭已完成并真正隐藏正文，保留顶部初始化请求直到布局盒恢复，再重置位置，避免恢复隐藏前的旧内部滚动。现有订阅仍按 afterSeq 重放，未增加历史分页协议或入口。内容自身被折叠或剩余自然滚动范围不足时落在实际可用范围内，不添加底部空白占位。

整轮、历史组头及正文使用稳定容器上的 160ms 高度与透明度过渡：收起先淡出，50ms 后开始 110ms 高度收缩，70ms 完成淡出；组头出现与恢复限高沿同一布局帧变化。外层阅读策略跟随真实几何，结束时提交隐藏和最后位置，不再另行跳转。恢复限高期间，实际键盘焦点或本组门户的返回目标保持在组内可见范围；外层同步保留其原可见位置，包含高于限高的思考正文内部操作。新的阅读手势优先于这项保护。reduced-motion 下直接提交几何与可访问状态，焦点保护、门户锁和显式整轮重置规则保持有效。

验证：[阅读 App 测试](../../apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx)覆盖动态尺寸、嵌套跟随、早期快照与手动开合、子 Session、暂停/继续、真实折叠几何及 reduced-motion；[阅读 Electron 测试](../../apps/desktop/e2e/reading-position.e2e.test.ts)使用真实 Sidecar、滚轮、结算与 SQLite 重启回放。

[组合 App 验证](../../apps/desktop/src/renderer/features/conversation/integrated-detail.browser.test.tsx)将终端、读取、实际 diff、搜索与图片的正文增高同组内跟随、外层阅读锚点、更早快照、三层重置及返回底部组合；390px 的流式终端提交、阶段回复、图片门户和 reduced-motion 同时验证实体、选区与焦点。

验证：[真实 App 过程测试](../../apps/desktop/src/renderer/features/conversation/process-groups.browser.test.tsx)覆盖运行、回复、正常/异常结束、无最终答案、中途用户/团队输入、类别排序、焦点、三层重置、断线计时、结果确认、四种主题/语言的 390px 主区与右栏子 Session 隔离；[投影边界](../../apps/desktop/src/renderer/features/conversation/process-groups.test.ts)补充无归属与历史揭示；[对话 Electron 闭环](../../apps/desktop/e2e/chat.e2e.test.ts)验证真实 Sidecar 的运行平铺、审批、完成折叠及文件结果。

## 历史与只读检查

已有 Session Entry 直接派生消息与过程，不改写记录、不补造 Run 起点或归属。被回退区间在原位置独立折叠，嵌套区间继续递归；各层继承同一 Session 的完整不可变条目、真实 Run 状态与已有 Inspect 入口，组只按本层成员组织，不与当前有效过程混合。压缩分隔与摘要仍可展开；其中用户消息没有 Checkpoint 动作，历史错误不能重试。归档、运行中、待审批、待结果确认或 worktree 已移除时，受限消息动作不可用；打开的回退确认遇到新限制会关闭。查看、复制、展开与已有导航不触发执行。

首次打开通过既有订阅从 `afterSeq: 0` 接收历史，重连从已收到的 `lastSeq` 接收后续条目，没有向前分页入口。展示身份不依赖已加载数量；受控更早快照揭示中途输入时，重新计算整轮折叠资格，并保留可对应的原消息、过程组和工具开合。像素锚点与滚动协调属于阅读容器的独立职责。

验证：[真实 App 历史用例](../../apps/desktop/src/renderer/features/conversation/history.browser.test.tsx)覆盖缺失起点/归属、嵌套回退与压缩、只读矩阵、更早快照和稳定身份；[回退 Electron](../../apps/desktop/e2e/rewind.e2e.test.ts)与[回退协议](../../tests/integration/sidecar-rewind.test.ts)读取文件、原始条目与返回草稿，验证回退追加记录和 Fork 不修改源 Session；SQLite 和 Checkpoint 约定保持 [ADR 0003](../adr/0003-settings-and-sessions-in-sqlite.md)与 [ADR 0023](../adr/0023-assistant-reply-forks.md)。

## 新对话与首次发送

新对话显示已确认的 `brand/rukie-avatar.png` 形象、欢迎标题与说明，和已有会话共用同一主输入框。侧栏与对话分类的创建入口都打开同一份草稿并聚焦编辑区；没有任何 Workspace 时也可编辑、选择权限或模型。独立草稿不查询虚构目录的上下文，只显示不可用轨道；没有模型时仍经配置模型入口保留草稿。

[新对话 store](../../apps/desktop/src/renderer/stores/new-chat-store.ts) 独立保存草稿身份、归属与 Git 配置、模型、档位、权限与图片引用；`ChatStore` 的既有选择动作转交此 store，不复制另一份状态。配置存为 `coko.new-chat.v1`，文字与 File Reference 的 EditorState 存为 `coko.draft.new-chat`。切换会话、内容页或重启后恢复；旧的 `coko.draft.workspace.*` 键不再读取，初始化时清除。已有会话草稿仍按 Session 保存。新草稿模型显示第一个供应商目录中的第一个模型，档位关闭。

`POST /api/chats/first-send` 接收草稿身份、文字、图片、权限模式、模型与档位，以及可选的 `projectId`。选择项目时使用发送当时项目的主要 Workspace 并保存归属，不创建专属目录；项目不存在时拒绝。独立发送时，服务端在用户可见目录根（默认 `<Documents>/Coko`（desktop main 解析系统 Documents），可用绝对路径环境变量 `COKO_CHATS_ROOT` 覆盖）下按本地日期创建 `<yyyy-MM-dd>/chat-<sessionId 前 12 位>` 会话根与 `work/`、`outputs/`。短名冲突时回退完整 sessionId，已占用的完整名也不会覆盖。登记的 Workspace 是根，名称固定为“独立对话 · yyyy-MM-dd”；Session 保存 `directory` 与 `cwd=directory/work`，然后提交第一条消息。此路径不会自动创建项目。首条消息标题取去空白后的首行，按 Unicode 字符最多 20 个；只有 File Reference 或图片时用“附件：”加文件名，多个文件名用“、”连接。

[首次发送服务](../../apps/server/src/application/first-send.ts) 对同一草稿共享进行中的请求，以草稿身份的 SHA-256 派生内部会话键；已经持久化的首条用户消息与 Run 身份是重启后重试的结果凭证，不新增草稿映射表；v12 的 `sessions.directory/cwd` 记录实际分配目录与固定工作目录。HTTP 成功返回之前等待运行时已提交的用户消息事件，而不是同步 `run_start` 进度。重复提交不再启动 Run。目录、模型校验、Hook 拒绝或接受前失败时，删除本次新建会话、未被引用的 Workspace 与专属目录；首条消息接受后发生模型错误保留会话。清理不操作其他源目录。

renderer 提交期间禁止重复首次发送，失败时保留文字与配置并通过应用级 Toast 反馈；成功后清空提交的草稿并进入同一个会话，用户等待期间已打开其他会话时不抢回焦点。列表恢复仍由列表 store 管理，新欢迎页不会生成空会话。

首次发送保留服务端接受的 Run 身份，只有该 Run 中带 offset 0 的内容块才能开始实时展示；后续增量按块检查连续的 UTF-16 偏移。缺少开头、偏移缺口、不同 Run 或重连中的片段等待完整 assistant 条目，不把孤立后缀当作完整实时文本。Sidecar 按实际发出的脱敏文本重新计数，避免秘密替换或缓冲改变长度后破坏连续性。协议细节见 [WebSocket 进度契约](../../packages/protocol/README.md#进度事件)。

验证：[Sidecar 首次发送](../../tests/integration/sidecar-first-send.test.ts)、[新对话 Browser Mode](../../apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx)、[真实 Electron 首次发送与重启](../../apps/desktop/e2e/first-send.e2e.test.ts)。

## 首条消息的标题

首条用户消息持久化后，[标题服务](../../apps/server/src/application/session-titles.ts)在 Run 之外使用会话当前模型发一次请求。系统提示要求按用户语言概括意图、约 12 个字符；用户原始文字与附件文件名作为 JSON 数据传入，不展开 File Reference，不发送图片内容，不传工具，推理关闭。入请求之前替换登记的 Secret 值。结果取首行、去引号和首尾标点，按 Unicode 字符最多 20 个。

15 秒截止时间使用 Sidecar 时钟。停止 Run 不取消标题；失败、空结果与超时保留首条消息生成的标题。SQLite 与内存存储都以原占位标题作为原子条件更新，生成期间手动改名不会被覆盖。提交后的 `session_title` WebSocket 消息通知所有连接，使列表及已打开的详情卡片同步。renderer 保留列表刷新期间收到的标题更新，首次发送响应中的旧占位标题不覆盖已载入的新标题。删除会话先禁止新写入，再取消并收尾标题请求；不会向已删除的会话追加迟到条目。退出 Sidecar 同样取消标题工作。交接、分叉、子代理和同草稿重复提交不启动标题请求。

标题请求写为 `purpose: title`、`runId: null` 的 `model_request`，会话费用增加一次该请求的用量与总费用；Run 费用及普通回复的汇总口径不变。日志只记录耗时、用量与结果状态，不记录生成标题或消息正文。追踪的 Session 合计与 Run 列表的区别见[追踪](tracing.md#追踪)。

验证：[标题协议与失败路径](../../tests/integration/sidecar-titles.test.ts)、[标题秘密总闸](../../tests/integration/secrets-gate-titles.test.ts)、[列表与详情 Browser Mode](../../apps/desktop/src/renderer/features/sidebar/session-menu.browser.test.tsx)、[费用 Browser Mode](../../apps/desktop/src/renderer/features/conversation/session-cost.browser.test.tsx)、[真实 Electron 标题更新](../../apps/desktop/e2e/titles.e2e.test.ts)。

## 新对话归属栏

[归属栏](../../apps/desktop/src/renderer/features/conversation/destination-bar.tsx) 只在欢迎页主输入框顶部显示；已有 Session 没有此入口。独立状态使用统一聊天气泡、“对话”和箭头；选中项目后显示文件夹与项目名。按钮高 28px，前导图标 14px、箭头 12px，名称沿用 13/20 与下内边距 2px 的光学居中容器。hover 或键盘焦点时，在原文件夹槽显示关闭按钮，名称起点保持不变；关闭只清除归属，图标操作使用与可访问名称一致的本地化 Tooltip。

项目菜单通过共享 DropdownMenu 在归属栏上方 6px 打开，提供按项目名搜索、列表、当前勾选与“不在项目中工作”。同名项目在名称后以弱化文字附带主要文件夹目录名；唯一名称不附带目录名，搜索只匹配项目名。菜单使用共享窗口边缘避让；键盘可从搜索框向下进入项目列表，Escape 关闭。项目及移到项目的搜索框组合输入期间保留焦点，不执行方向导航或关闭菜单，组合结束后恢复普通键盘操作。新建项目菜单项由项目创建能力接入。

归属、分支与新建工作树配置同样保存在唯一新对话草稿中；换项目、关闭或选择“不在项目中工作”清除分支与工作树配置，文字、附件、模型与权限继续保留。侧栏项目行的新对话图标进入这份草稿、预选项目并聚焦输入区，不展开或折叠项目，也不创建 Session；独立创建入口清除项目与 Git 配置；从历史后退、前进返回新对话时保留现有配置。项目草稿的命令、File Reference 与上下文环使用主要 Workspace；独立草稿继续不查询未确定目录。

首次发送的项目归属由服务端解析，失败时只回滚本次新会话，保留既有 Workspace、项目和源文件。并发或重复草稿身份沿用首次发送去重；接受后的 Session 工作目录固定，归属栏不能修改它。

验证：[归属 Browser Mode](../../apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx)、[项目首次发送协议](../../tests/integration/sidecar-first-send.test.ts)、[真实 Electron 项目入口、草稿重启与主要目录写入](../../apps/desktop/e2e/destination.e2e.test.ts)。

## 项目配置菜单

归属栏右侧的 [项目配置菜单](../../apps/desktop/src/renderer/features/conversation/project-git-menu.tsx) 在栏上方打开，配置图标提供共享本地化 Tooltip，点击菜单后单次 Escape 关闭并归还入口焦点。独立状态仍可打开，分支项显示等待选择项目的说明；非 Git 主要文件夹与 Git 缺失分别说明原因。“新建工作树”开关位于分支项之前，仅更新本地草稿。关闭开关、清除归属与独立对话入口会清空工作树配置，首次发送时创建与失败清理的边界见 [Worktree](worktrees.md#新对话首次发送)。

分支子菜单保留父层，使用共享 `DropdownMenuStackedSubContent`：子层高于父层，从触发项边缘零间距展开，父菜单内边距保留几何重叠；新对话入口将子层底部与触发项对齐，使菜单位于归属栏上方。搜索只匹配本地分支名，当前分支勾选；组合输入状态、原生 isComposing 和 229 哨兵均抑制菜单导航与关闭，组合完成后方向键正常进入分支项。选中成功回显，失败保留原选择并区分 dirty 与忙碌。关闭子层时焦点返回分支触发项。从触发项直接移入叠加子菜单时保留子层，移到其他父项仍按共享规则关闭；退出动画中的分支子层不再接收指针，防止旧选项重新夺取已返回的焦点。

“创建并检出新分支…”关闭菜单再打开模态表单并聚焦名称，每次预填全局前缀。设置前缀在表单内编辑并保存；引用名校验预留固定高度，报错不改变弹窗和按钮几何。提交期间防止重复，失败保留名称与错误原因；关闭不操作 Git。成功后关闭表单并保存新分支草稿。开启新建工作树的配置使用基础分支选择，不切换主要文件夹并隐藏创建分支入口。

验证：[分支 Browser Mode](../../apps/desktop/src/renderer/features/conversation/branches.browser.test.tsx)、[真实 Electron 前缀、预填与 Git 读回](../../apps/desktop/e2e/branches.e2e.test.ts)。

## 主输入区

`apps/desktop/src/renderer/features/conversation/composer.tsx` 组合共享 Lexical `ComposerEditor` 与底部工具栏。欢迎页的输入区基准最大宽 768px；已有会话继续沿用消息列与输入列的原有宽度轴。主输入框基准高 120px、内边距 12px、R28 与 soft elevation；编辑区独立滚动，底部工具栏高 32px。压缩进度与图片缩略图各占一行，显示时输入框允许增高。

工具栏依次为附件、权限、仅计划模式出现的计划状态组、弹性间距、上下文环、模型与档位、发送。权限和模型分别有独立插槽；上下文环与模型选择保持其原接口。窄窗口中权限可仅显示图标，名称仍由 Tooltip 与可访问名称提供。

Run 中停止取代主发送位置，仍可暂停；有文字时另显示追加指令按钮，Enter 也提交追加指令。输入法组合期间不提交，Shift+Enter 换行。审批、确认、计划审阅接管时输入框保持挂载，草稿和选区保留。

### 会话状态栏与 Token 用量

已有 Session 的输入框、审批/结果确认卡或只读提示下方常驻 [SessionStatusBar](../../apps/desktop/src/renderer/features/conversation/session-status-bar.tsx)。它与输入框共用列宽，顶部间距 4px、行高 22px、距主区底部 4px；没有数据时仍保留空行，数据提交后不挤动输入框。新对话页没有状态栏，上下文环继续留在输入框工具栏。

左侧会话统计胶囊显示轮数、步数和可计算的输出速度。统计仅来自本 Session 已提交的主循环 `model_request`：至少有一次主循环请求的 Run 算一轮，用户提交和 Goal Round 同样计入；一次逻辑调用算一步，`retries` 标明的后续尝试不新增步数，重复请求也不重复累计。纯压缩、交接摘要和标题请求不计入轮步；缺少请求记录的旧会话不补造计数。模型用时仍累计每次实际主循环尝试的耗时，包含失败重试。

会话统计卡按顺序显示模型用时、工具调用用时、首 token 平均和输出速度；未知或为零的行省略。工具调用用时按调用所在助手条目到结果条目的提交时间计算，含审批等待，与 Trace 口径一致；未完成调用不补造耗时。首 token 平均只使用有记录的 TTFT；输出速度按可配对的已报告输出 token 与生成时间汇总计算，生成时间为请求耗时减 TTFT，缺失 TTFT、未上报输出或生成时间为零的请求不参与该比值。小于 60 秒的用时保留一位小数，否则显示分与整秒；速度小于 10 时保留一位小数，否则取整。派生与格式化由[纯函数](../../apps/desktop/src/renderer/features/conversation/session-statistics.ts)维护。

Token 胶囊只汇总本 Session 已提交的条目，包括主循环、压缩、交接摘要及标题请求，不合入子 Session。累计口径复用 Session 用量聚合、请求去重与服务商报告分桶；缺少报告时不制造零用量。文字使用紧凑总量与输入中的缓存命中比例，完整精确读数作为可访问名称，只有截断时显示 Tooltip。流式增量不更新数字；重复条目、重新打开和持久化回放不重复累计。

点击或键盘打开 Token 卡，展示精确总量、缓存命中、未缓存输入、缓存读取、缓存写入、输出与已报告的推理子集；没有输入时省略命中率，未上报的必要分项附不完整说明，不展示费用。字段与“本轮用量”共用 [UsageFields](../../apps/desktop/src/renderer/features/conversation/usage-fields.tsx)。两张详情卡互斥，可直接点击另一胶囊切换；共用 Popover 的门户、窗口避让和可用高度限制，默认位于胶囊上方，再次点击、外部点击或 Escape 关闭并归还焦点。两枚胶囊均单行截断，完整读数保留在可访问名称，仅在实际截断时显示 Tooltip。

验证：[纯函数用例](../../apps/desktop/src/renderer/features/conversation/session-statistics.test.ts)覆盖多轮、重试、辅助请求、工具等待和缺失计量；[真实 App 状态栏 Browser Mode](../../apps/desktop/src/renderer/features/conversation/session-status-bar.browser.test.tsx)覆盖空行几何、提交与重复回放、窄窗口浮层、两卡切换与键盘焦点、中文统计、审批/确认、归档及已移除 worktree；[协议 Electron E2E](../../apps/desktop/e2e/message-footers-protocol.e2e.test.ts)覆盖累计 Token 读数与子 Session 隔离及重启读回。

## 模型与推理档位

模型按钮读取设置中的可用目录，显示当前模型与档位摘要；档位名与设置中登记的档位一致（off、minimal 等，英文首字母大写）。首次打开时显示当前模型详情：当前档位、模型图标与名称、推理档位滑条；详情采用共享菜单表面，基准宽 280px、高 112px。点击名称区域以按供应商分组的模型列表替换详情，选择后返回详情；两种内容始终复用一个浮层。供应商分组不显示图标；模型行按模型名称（回退模型 ID 与供应商）显示单色品牌图标，未收录的品牌回退通用机器人图形；选中勾号在行尾。

[共享滑条](../../packages/ui/src/components/thinking-slider.tsx) 只提供模型配置的有效档位。拖动时滑块连续跟手，详情与按钮摘要同步预览；释放时吸附并提交一次选择，保存失败由既有模型操作反馈并恢复已保存值。键盘 Tab 可从名称区域进入滑条，方向键、Home 与 End 选择有效节点；Escape 关闭后焦点返回按钮。切换到不支持当前档位的模型时采用关闭。

填充区域遮住已覆盖的刻度。粒子从右向左流动，七档数量依次为 0、3、6、10、15、21、28，单轮时长为停止、4、3、2.2、1.6、1.1、0.75 秒；相邻三组粒子的速度相差 4%，半径按三组取 1.08、1.51、1.94px，垂直方向以 9 秒周期围绕中心摆动 ±6.72px，透明度以约 5.7 秒周期在 0.35–0.55 之间呼吸。已有粒子切档时保留相位，只改变播放速度；关闭菜单、不可见或页面隐藏、关闭档位以及减少动态效果会停止粒子，选择能力不受影响。

没有可用模型时仍显示“选择模型”，发送位置改为“配置模型”，打开模型服务设置并保留草稿。已被清空的会话模型不会自动代填，继续运行前显示重新选择提示。

## 文件附件

附件按钮经受控 preload 打开系统多文件选择，主进程校验发送者为应用主窗口主框架，重复打开共用一次对话框。选择、粘贴和拖入的普通文件作为显式附件，不再转换为 @ File Reference 或原路径文字；手动输入的 @ 引用继续按[上下文管理](context.md)展开。普通文件单个上限为 32 × 1024 × 1024 字节；选择的文件由主进程检查，浏览器 `File` 在读入前检查，超限在输入区说明原因。原生 File 有路径时仅保存路径；没有本机路径的粘贴 File 以 base64 暂存。

图片支持 PNG、JPEG、GIF 与 WebP，模型输入类型必须含 `image`。选择的图片经受控 `readPickedImage` IPC 读取，主进程只读取本窗口已经选择的路径，限制读取字节数；粘贴或拖入的图片直接读取浏览器 `File`。单张上限为 4.5 × 1024 × 1024 字节，不缩放。图片缩略图与普通文件标签都有可访问的移除按钮；只有附件没有文字也能发送。

[附件草稿存储](../../apps/desktop/src/renderer/stores/image-drafts.ts) 在 IndexedDB `coko.image-drafts` 分别保存图片与文件草稿，文字 EditorState 不嵌入二进制。新对话的 `imageRefs`、已有会话的 `.images` 键，以及文件草稿引用仅保存不透明 id。切换会话、重新挂载及重启后恢复；尚未发送时不写主数据根的附件目录。发送失败保留文字、附件与配置，接受后只删除本次提交的引用及 IndexedDB 条目。当前 Run 进行中时附件保留，追加指令只传文字并反馈等待原因。

首次发送和已有会话提交协议接收 `images` 与 `files`。普通文件的来源为 `{name,path}` 或 `{name,data}`，不会从用户文字解析任意路径进行复制。Sidecar 在 Run 与用户消息产生前独立校验图片能力、base64、签名和大小，并以有界读取把所有附件复制到 `data/attachments/<sessionId>/<随机 id>-<原名>`。部分复制或开始 Run 失败会移除本次副本，不发送消息；重试仍使用原草稿。只有动作命令的提交不能携带附件。

消息以 `<coko_attachment>` 文本块保存副本的名称与绝对路径，模型可据此读取当前会话的副本目录；该目录作为额外只读根，不授予写入权限。图片继续以原有 `{type:'image',data,mimeType}` 块持久化并传给模型。时间线保留图片预览，并将副本渲染为可用默认应用打开的附件标签，原文件移动或删除后历史仍指向副本。原生打开入口仅接受已有的绝对文件路径，打开失败在附件旁提示。分支会将边界内的副本复制到新会话目录并重写引用，因此删除源会话不影响分支附件；分支复制或条目提交失败时回滚新副本与新会话。旧图片消息无需转换。

Worktree 与主检出中的同名文件分别从实际选择的路径复制，不以 cwd 重写来源。验证见 [worktree 附件](../../apps/desktop/e2e/first-send-worktree.e2e.test.ts)。其他证据：[附件 Sidecar 协议](../../tests/integration/sidecar-attachments.test.ts)、[图片 Sidecar 协议](../../tests/integration/sidecar-images.test.ts)、[附件 Browser Mode](../../apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx)、[历史附件 Browser Mode](../../apps/desktop/src/renderer/features/conversation/messages.browser.test.tsx)、[真实 Electron 文件草稿、上限、副本与重启](../../apps/desktop/e2e/attachments.e2e.test.ts)、[图片选择与重启](../../apps/desktop/e2e/images.e2e.test.ts)。

## 对话工具摘要与详情

主时间线中的工具使用共享 `ToolCard` 的 `row` 变体：24px 摘要行、16px 前导绘制框（14px 图形）、13px/24px 常规字重，以及标题与原文摘要之间的圆点。运行时文字使用受 reduced-motion 控制的渐亮动画；悬停时业务图标变为向下箭头，展开后为向上箭头。其他未选用该变体的消费者保留卡片外观。

命令、编辑、未知工具和失败调用都初始收起，正文由用户点击或键盘 Enter / Space 展开。未知工具与 MCP 保留真实工具名称；通用输入/输出采用各自限高 150px 的可滚动分区，参数为格式化 JSON，已提交结果同时保留文本和结构化 details，不以其中一项覆盖另一项。已有专用正文、图片预览、审批决定、Hook 与沙箱标注继续由原功能提供。

文件工具展开后使用局部代码容器：读取按调用的有效 offset（缺省 1）显示实际返回文本的行号，读取与写入内容默认保留首尾共 8 行，编辑的实际 `details.diff` 默认保留首尾共 9 行，中间省略有键盘可达的全文入口。路径完整换行，代码保持原文并局部横向滚动，也可切换换行；复制读取/写入的内容不包含行号，复制编辑时保留实际编号 diff。读取工具的原始截断/继续 offset 提示保留在正文下方，不把继续提示画成文件内容。

文件语言提示只由记录中的路径扩展名派生：读取使用参考的短标签，已知类型通过现有代码高亮器延迟加载语法，以文件详情专用明暗 token 着色；未知扩展名和无扩展名保留 code 与纯文本。读取的实际行号、原始复制内容、当前选区、横向滚动和正文身份在语法加载及实时结果提交时保持；不把语言提示写回 Session Entry。写入和编辑仅使用路径派生语言标签，编辑保持实际编号 diff 的增删呈现，不重建缺失文件。

写入视图只在成功结果后显示调用中记录的 content，不推断原文件、旧内容或新增行统计。编辑只渲染结果提供的编号 diff，增删统计按实际 diff 行计算；缺失 diff、路径或内容时，以及失败、待审批、被拒绝或没有完成结果时，降级到完整真实输入/输出。读取图片仍沿用图片/通用结果路径。文件路径是记录标识，当前工具详情没有宿主文件打开回调；展开、复制和换行只操作显示，不读取或再次修改工作区文件。

工具图片由[独立图片详情模块](../../apps/desktop/src/renderer/features/conversation/tool-image-details.tsx)读取各自调用的原始结果块；单图、多图、解码尺寸、失败状态与全屏预览的行为和来源限制见 [MCP 图片详情](mcp.md#界面)。用户消息附件继续使用原有消费者。

搜索工具 `grep`、`find` 与目录工具 `ls` 在成功结果后显示原始结果容器：正文保留首尾共 8 行，可通过键盘展开、收起并复制完整结果。当前结果没有结构化匹配对象，正文不解析为文件分组、匹配位置、路径链接或结果计数；工具返回的空结果和截断提示保持原文。失败、尚无完成结果时继续显示通用输入/输出。

`lsp` 的请求操作、文件和可用行列按字段展示，明确标为“请求”；结果计数只取已记录的合法 count/total，原始结果文本继续显示，不把请求位置当成结果位置。`memory_write` / `memory_delete` 以结果中的实际 Memory Entry 展示操作、ID、范围和保存正文；列表与字段不完整的记录保留通用详情。所有搜索与结构化正文都有“输入 / 输出”入口，保留调用原始参数、完整结果文本及 details。没有宿主文件跳转回调时不生成文件按钮；Inspect 继续使用已有 Session 追踪入口。

工具调用沿用 `toolCallId` 形成的稳定展示 key；实时结果结算不切换正文实体，不因结算重置手动开合、输入选区或内部滚动。不同调用即使参数相同也各自显示。待审批和未完成为独立状态，不因缺失结果显示为成功。

命令详情采用终端排版：逐行显示真实命令，保留输出的 SGR 颜色与修饰，原始输出可复制并有成功反馈；尚未输出时可复制命令。代码字号为 11px，命令行高 18px、输出文字行高 16px 配 18px 行槽；命令栏内部最高 150px，输出在独立的 224px 高区域内横向与纵向滚动，所有已收到的输出均可检查。追加输出和结算保留展开状态、未变动输出行的选区及内部阅读位置。空结果、未完成和已停止/失败使用实际状态，待审批、Hook/沙箱阻断以真实输入/输出展示，不画成已运行的终端。

Electron 对网页权限仅放行自有主窗口、主框架、可信 Coko 地址的 `clipboard-sanitized-write`；剪贴板读取、其他权限及非自有框架继续拒绝。复制成功后才显示反馈，失败经 Toast 显示原因。

退出胶囊仅使用实际结构化输出中的非零退出码；缺失时不推断退出码或耗时，原有结果文本（包括退出、停止和完整输出文件提示）继续可见。当前运行库的已提交工具消息通常不保留结构化输出；同一调用仍存在实时结果时，可在展示投影中使用该实际结果，清除实时状态后不制造持久化字段。后台命令沿用既有 Job 身份和 chip，进入原右栏查看真实任务，详情不启动新命令或轮询。

验证：[命令详情 App 测试](../../apps/desktop/src/renderer/features/conversation/terminal-details.browser.test.tsx)、[真实 Electron 命令与后台任务](../../apps/desktop/e2e/terminal-details.e2e.test.ts)。

主时间线的展开详情提供 Inspect，中文为“查看”，携带当前 Session 和工具调用 ID 选中标题栏轨迹 tab，不改变右栏布局，清除搜索与时间选区、展开所属层级、滚动并聚焦对应工具行，同时打开详情。没有对应入口的子 Session 时间线不显示该按钮；查看与展开均不执行工具。追踪语义见[追踪、审计与评测](tracing.md#界面)。

## 从助手回复创建新对话分支

成功结束 Run 的最终助手回复底栏，在复制与用量之间提供“在新对话中分支”。最新和较早成功回复均可使用；阶段、流式、停止、失败及无正文回复不提供该入口。服务端重复校验有效回复资格、运行／审批／结果确认以及归档、已移除 Worktree 的只读限制，不能绕过隐藏按钮直接调用。

新 Session 包含所选回复及之前的有效模型上下文（含思考、工具调用与结果），先按边界截取再选择当时的压缩摘要，排除后来消息和摘要。自动打开且输入为空；源条目、源草稿与当前文件不变。沿用源 Project、模型、推理档位及实际 Worktree 目录；助手分支采用源当前权限状态，MCP 工具则只继承边界内的已加载记录（压缩前的加载保留），见[上下文管理](context.md#压缩)。分支共享当前文件，不创建 Worktree 或恢复旧代码。旧用户锚点 API 保持目标之前与回填原始调用的兼容语义。

复制消息的原提交时间、成功最终回复证明和来源计量存于 `fork_origin` 来源表。历史底栏复用同一计量汇总器读取来源事实，旧消耗不计入新 Session；可信复制回复可再次分支。旧 Fork 无法证明原消息时间或成功资格时不补造事实，复制落盘时刻不显示为原发送时间。后继决定见 [ADR 0023](../adr/0023-assistant-reply-forks.md)。验证：[App 分支](../../apps/desktop/src/renderer/features/conversation/assistant-branch.browser.test.tsx)、[Sidecar 上下文](../../tests/integration/sidecar-rewind.test.ts)、[静默 Electron](../../apps/desktop/e2e/message-footers.e2e.test.ts)。

## Artifacts 交付文件

拥有 `directory` 且不属于 Project 的独立会话，在右栏“开始”页提供 Artifacts。项目会话和没有专属目录的旧会话不显示该入口；会话移入项目后，已有的 Artifacts 页面也从该会话的可见标签中移除，当前页面回到其他可用页或“开始”。布局仍沿用每个 Session 的本地保存规则。

Artifact 以 `directory/outputs/` 的磁盘内容为唯一事实源，不写 Session Entry，也不保存历史版本。面板挂载时读取，完成每次读取后约一秒再扫描；关闭页面或切换会话会中止请求并清理计时器。手动刷新和重新打开同样重新扫描。空态说明 `outputs/` 暂无交付文件；读取失败时保留最近一次清单并提供刷新，删除的文件在下一次成功扫描后消失。

[Artifact 服务](../../apps/server/src/application/artifacts.ts)递归列出普通文件与目录，跳过隐藏项、符号链接和其他特殊文件；`outputs/` 自身被替换为符号链接时拒绝读取。文件树显示名称、相对路径和大小，目录可以展开与收起。文件名打开默认应用，行尾可以在 Finder 中显示或复制绝对路径。打开、显示与复制前，服务端重新解析路径并核对其仍处于当前 `outputs/` 内；条目已经消失或变成链接时拒绝操作并提示刷新。renderer 只经 HTTP 获取清单与解析结果，原生打开/显示由受控 preload bridge 转交 main。

协议位于 [artifacts.ts](../../packages/protocol/src/artifacts.ts)：`GET /api/sessions/:id/artifacts` 返回扁平清单，每项有 `path`（正斜线相对路径）、`name`、`kind`、`size` 和 `modifiedAt`（文件系统毫秒时间）；目录大小为 0。`POST /api/sessions/:id/artifacts/resolve` 接收相对 `path` 并返回当前绝对路径。项目/旧会话返回 404，非法路径返回 400，越界链接和被替换的根返回 403，已消失的条目返回 404。

验证：[真实 Sidecar 文件树与边界](../../tests/integration/sidecar-artifacts.test.ts)、[Browser Mode 文件操作、刷新、错误保留与窄面板](../../apps/desktop/src/renderer/features/right-panel/artifacts-tab.browser.test.tsx)、[后台 Electron 面板与原生 bridge](../../apps/desktop/e2e/artifacts.e2e.test.ts)。Electron 用例保留真实 preload/main 调用链，只在系统 `shell` 边界记录打开/显示路径，不启动用户的外部文件应用；Windows 实机及真实 Finder 前台交互未验证。

## 验证入口

- [工作台浏览器测试](../../apps/desktop/src/renderer/app/app.browser.test.tsx)：导航项几何、历史、无效会话跳过、设置返回、草稿保留及四角裁剪。
- [AppFrame 浏览器测试](../../packages/ui/src/app-frame/app-frame.browser.test.tsx)：侧栏宽度、窄窗口抽屉、右栏调整与空间不足时收起、保留正文和底层列宽的全屏。
- [工作台 Electron E2E](../../apps/desktop/e2e/workbench.e2e.test.ts)：真实 Sidecar 中两个会话与插件、定时任务之间的前进后退，以及设置返回后的草稿和列表。

- [模型选择 Browser Mode](../../apps/desktop/src/renderer/features/conversation/model-picker.browser.test.tsx)：互斥菜单、拖动预览、键盘与粒子生命周期。
- [模型选择 Electron E2E](../../apps/desktop/e2e/model-picker.e2e.test.ts)：更换供应商和档位后读回 Sidecar。
- [输入区 Browser Mode](../../apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx)：布局、文件选择/粘贴/拖入、运行控制与草稿。
- [文件与草稿 Electron E2E](../../apps/desktop/e2e/references-drafts.e2e.test.ts)：原生文件选择到持久化引用与模型请求。
- [权限判定与审批](permissions.md#界面)、[计划模式](plan-mode.md#界面)：权限选择与计划胶囊。
- [上下文管理](context.md)、[会话模型协议](../../packages/protocol/src/http.ts)：上下文统计与模型选择接口。

- [跨功能 Electron 验证](../../apps/desktop/e2e/conversation-workbench-closeout.e2e.test.ts)：创建项目到首次发送与模型标题、只发图片到提示词估算、归档到搜索排除、全部来源最终五项菜单、两主题窄窗口与已有会话的计划和自动压缩。

## 延伸阅读

- [界面约定](../tech-stack/ui.md)与[设计系统规格](../tech-stack/ui-design-system.md)：共享组件、布局与交互规则。
- [插件](plugins.md)与[定时任务](schedules.md)：所复用分区的业务行为。

文件详情的长读取与编号 diff 支持正文内部双向全文开合，键盘焦点返回当前开合控件并保留换行选择；成功 edit 的真实 `details.diff` 增删行数同时显示在紧凑工具行，缺失或错误结果不显示成功统计。过程摘要由稳定活动 ID 选择字典中的独立及连接片段。
