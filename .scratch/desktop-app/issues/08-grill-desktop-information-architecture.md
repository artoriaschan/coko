# 桌面端信息架构与关键交互

Type: grilling
Label: wayfinder:grilling
Status: resolved
Assignee: lead
Blocked by: 02, 03
Map: [Coko 桌面应用](../map.md)

## Question

沿用 DSH 的界面：主窗口布局、侧栏（项目/工作区与会话）、聊天区（流式消息、工具卡、diff、审批卡、计划、Todo、Goal 状态）、输入区（Lexical、@文件、/命令、模型与模式选择）、设置页分区。哪些页面属于哪个里程碑？

## Answer

按用户常设指示（2026-10-28 goal：讨论问题采用推荐，优先沿用参考项目决策）采纳，不是用户逐条确认。

沿用 [DSH 研究](../research/dsh-desktop-architecture.md) 的信息架构与几何，按 coko 技术栈重写 renderer（不移植 Cordis slot 运行时）：

- **窗口。** `titleBarStyle: hiddenInset`、红绿灯位置与 sidebar vibrancy 按 DSH；顶部安全区 48px。
- **三栏。** 侧栏 264–420（默认 280，rail 56，窗口 <1024 自动收起）：上方新会话 / 搜索，下方按工作区分组的会话列表（每组默认 5 行，运行中、待审批的会话上浮）。中栏 ≥400：会话标题栏、消息流（宽 clamp(680, 列宽×0.64, 920)）、composer。右栏 45%（≤70%，≥300）：diff、Plan 审阅、文件预览。
- **消息流。** Streamdown 流式渲染；工具卡按工具类型展示（bash 输出、edit diff、read 摘要），未知工具通用展示；错误与重试内联。
- **Composer。** Lexical；@ 文件引用、/ 命令；模型与权限模式选择；发送 / 停止；上方 dock 依次 Todo → Goal → Queue；审批卡与提问卡接管 composer。
- **设置。** modal，分区：General（主题、语言）、Models（provider 与凭据）、Permissions、MCP、Skills & Commands、Plugins、Agents（子代理预设）、About。各分区随所属里程碑出现，M1 只有 General、Models、About。
- **Toast。** 采用 shadcn 推荐的 Sonner，在 M1 引入时登记精确版本到 TECH_STACK。
- **里程碑归属。** M1：窗口、三栏骨架、会话列表、消息流、工具卡、基础 composer、设置（General / Models / About）、Toast。M2：审批卡、权限模式、Permissions 设置、rewind。M3：@ / / typeahead、Skills、MCP 设置、压缩提示。M4：Todo / Goal / Queue dock、Plan chip 与右栏审阅、后台任务视图。M5：子代理卡、调度设置、分叉入口、worktree 选择。M6：Plugins 设置、团队视图、LSP 诊断展示。

## 后续需求修订

2026-10-30，用户要求设置从 modal 改为占满窗口的整页，外壳按模型服务视觉稿实现：左侧设置导航含“返回应用”与菜单名称搜索，会话界面隐藏但不卸载。本票 Answer 中“设置。modal”保留为当时的决定；当前要求见 [模型服务 PRD](../../model-service-settings/spec.md) 2.1。
