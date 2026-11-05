---
kind: reference
description: "开发者开关下的会话数据诊断：已加载条目的 Run 分组、虚拟表格、类型筛选、跟随与锚定、JSON 详情、Run 实时增量及数据范围。"
lifecycle: active
---

# 会话数据诊断

设置 → 常规的“开发者”卡片提供默认关闭的“会话数据诊断”开关。开启后，当前 Session 右栏的“开始”页出现入口，不自动打开；关闭时，已采用布局中的诊断页被移除，未采用的布局在恢复时过滤。设置保存、失败与布局规则见[工作台](workbench.md)。

## 原始数据

页面只读当前主区 Session 在 chat store 中已经收到的 Session Entry；不读取数据库、不新增请求、不提供导出，也不加载更早数据。归档或 worktree 移除后只读的 Session 仍可查看。用户文本、登记 Secret 的替换标记与主时间线共用来源，诊断模块不再次脱敏。

每条真实条目以 seq 为身份，跳过的 seq 不补造。`run_start` 为组头，同一 Run 的其余条目按 seq 成为子行，整个组位于组头的位置；没有组头的 Run 条目和不属于 Run 的条目按 seq 作为根行。Run 列按加载条目中 Run 首次出现的顺序从 1 编号，非 Run 条目为空。

列为序号、类型、Run、UTC 毫秒时间与摘要；message 类型附角色。摘要省略已有独立列的顶层元数据，保留嵌套业务值，最多 240 字符。每行与表头固定为 30px，表格使用 Tanstack 虚拟化，保留当前吸顶祖先；序号可悬停或聚焦查看全文。超出面板宽度的列只在表格中横向滚动，工具栏可换行。

## 实时增量

只在主区当前 Session 的诊断 tab 存在期间订阅 chat store 已有的 `onProgress`；隐藏右栏、切换到同一 Session 的其他 tab 或切换展示形式仍继续收集。切换 Session、关闭诊断 tab、关闭开发者开关或重新加载会清空这些内存子行。打开之前已经发出的进度不回放；不读取聊天的实时正文状态来补造旧增量，也不新增网络请求。后台任务、子代理、定时任务、团队与代码智能等脱离 Run 的进度不进入诊断。

未结算进度位于对应 Run 末尾的“实时进度”下。助手按内容块 `contentIndex` 分组，工具按 `toolCallId` 分组；生成中的组默认展开。思考与工具参数块折叠后显示最多 240 字符的拼接片段。`offset` 是 UTF-16 位置：重复或一致重叠片段不重复拼接，缺前缀、空缺或冲突时不生成误导性的拼接预览，原始帧仍能逐条检查。所有增量行的 UTC 时间列为空。

每条助手消息提交时，其前一条助手消息以来的块转到该条目下；工具进度按调用 id 转到工具结果下；压缩与 Run 起止进度归入对应条目。提交后的增量默认收起，但 Run 组头自身保持展开（起始进度使用独立收起的子组）。重试、上下文用量与未匹配的帧继续保留在实时进度下。事件顺序并非统一的先进度后条目：`run_end`、`compaction_end` 可以在条目之后到达，所以既处理新条目转交，也让迟到的结束进度匹配已经提交的条目。

## 跟随与详情

默认跟随尾部；上滚或手动折叠暂停跟随。手动折叠前测量组头位置，折叠后保持其可见位置，把所需留白放到所有数据之后。自动收束后的新行先消耗尾部留白；“跟踪最新”清除留白并恢复跟随。没有“加载更早”按钮。

选中条目后，下方 JSON 详情默认占可用高度的 40%；上缘分隔条支持拖动、上下方向键及 Home/End，限制 15%～80%，换记录时保留高度。JSON 容器默认全部展开，可以逐层折叠；循环祖先为 `[Circular]`，共享的非循环对象分别展开，大整数显示为带 n 后缀的字符串。序列化失败只在详情内显示说明，表格和其他记录仍可使用；已不存在的选择显示移除或结算提示。

## 类型筛选

类型表头的筛选按钮打开共享浮层；浮层跟随按钮定位，定位完成后才聚焦输入框。候选异步读取全部已加载的行，包含被折叠或当前筛选隐藏的类型；新数据到达后更新候选，过期的查询结果不会替换当前草稿的候选。

输入只改变草稿。Enter 确认片段，方向键循环选择候选后 Enter 或直接点击候选则确认完整类型；“确认筛选”始终确认片段。输入法组合期间的 Enter 不提交。Esc、“取消筛选”、外部点击或窗口失焦放弃草稿，重新打开时恢复已确认的片段；“清空草稿”后确认恢复全部类型。

匹配不区分大小写，使用包含匹配；首尾空白与可选的 `*` 不影响匹配，空白或只有边界星号表示不过滤。筛选保留匹配行和它们的祖先；仅作为上下文的祖先使用次级字色，强制展开且不能手动收起。计数为“匹配数 / 总数”，上下文不计入匹配数；新行沿用当前已确认的筛选。每次确认清除选中、手动折叠与尾部留白，暂停跟随并回到顶部。

共享表格的引用定位请求只在目标被筛选排除时清除筛选，再展开祖先、滚动并短暂高亮；上下文中已有的目标保留筛选。定位请求不改变原先的详情选择，减少动态效果时不播放高亮动画。

## 实现与验证入口

[诊断组装](../../apps/desktop/src/renderer/features/session-diagnostics/session-diagnostics.tsx)读取真实 chat store，[原始模型](../../apps/desktop/src/renderer/features/session-diagnostics/raw-model.ts)持有行与记录的只读投影，[表格](../../apps/desktop/src/renderer/features/session-diagnostics/diagnostic-table.tsx)拥有选择、折叠和滚动状态，[详情](../../apps/desktop/src/renderer/features/session-diagnostics/record-details.tsx)拥有高度与 JSON 树。

实时增量由 [生命周期订阅](../../apps/desktop/src/renderer/features/session-diagnostics/progress-capture.tsx)与[纯模型](../../apps/desktop/src/renderer/features/session-diagnostics/progress-model.ts)维护，不修改 chat store。纯模型、层级、布局、筛选、摘要和序列化测试与源码相邻；[真实 App 浏览器测试](../../apps/desktop/src/renderer/features/session-diagnostics/raw-data.browser.test.tsx)覆盖实际几何、虚拟化、折叠、详情、筛选键盘与取消、窗口变化和浏览器缩放、双语主题与 390px。第三方许可与打包约定见[安装包](delivery.md#安装包)。

[真实 App 进度回放](../../apps/desktop/src/renderer/features/session-diagnostics/live-progress.browser.test.tsx)覆盖分组、转交、空时间列与 tab/Session 生命周期；[真实 Sidecar Electron 用例](../../apps/desktop/e2e/diagnostic-progress.e2e.test.ts)在已创建并订阅的 Session 中打开诊断后运行 faux 模型，用模型时钟屏障和真实工具文件屏障观察流式与结算。用例源码不代表已经执行桌面验收。
