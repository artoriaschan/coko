---
kind: reference
description: "开发者开关下的会话数据诊断：已加载条目的 Run 分组、主时间线发布的对话分组、虚拟表格、对象与 JSON 详情及数据范围。"
lifecycle: active
---

# 会话数据诊断

设置 → 常规的“开发者”卡片提供默认关闭的“会话数据诊断”开关。开启后，当前 Session 右栏的“开始”页出现入口，不自动打开；关闭时，已采用布局中的诊断页被移除，未采用的布局在恢复时过滤。设置保存、失败与布局规则见[工作台](workbench.md)。

## 原始数据

页面只读当前主区 Session 在 chat store 中已经收到的 Session Entry；不读取数据库、不新增请求、不提供导出，也不加载更早数据。归档或 worktree 移除后只读的 Session 仍可查看。用户文本、登记 Secret 的替换标记与主时间线共用来源，诊断模块不再次脱敏。

每条真实条目以 seq 为身份，跳过的 seq 不补造。`run_start` 为组头，同一 Run 的其余条目按 seq 成为子行，整个组位于组头的位置；没有组头的 Run 条目和不属于 Run 的条目按 seq 作为根行。Run 列按加载条目中 Run 首次出现的顺序从 1 编号，非 Run 条目为空。

列为序号、类型、Run、UTC 毫秒时间与摘要；message 类型附角色。摘要省略已有独立列的顶层元数据，保留嵌套业务值，最多 240 字符。每行与表头固定为 30px，表格使用 Tanstack 虚拟化，保留当前吸顶祖先；序号可悬停或聚焦查看全文。超出面板宽度的列只在表格中横向滚动，工具栏可换行。

## 对话分组

“对话分组”订阅当前主时间线在提交后发布的时间线项、显示身份、过程席位和 Run，直接读取已计算出的值；诊断页不再次调用时间线或过程分组算法。只有主区的 TimelineView 显式发布，右栏的子 Session 与回退历史的嵌套时间线不覆盖它；主区卸载时只释放该挂载拥有的投影。

过程组是组行，成员紧随其后；其余独立显示项是根行。排队中的追加指令、Job 起止事实、被替代后不渲染的 Plan、空思考和被助手底栏替代的 Run 用量席位不另造行。Plan 边界仍留在原过程计算中，保持已挂载工具的身份和阅读位置。序号取实际显示身份，Run 列沿用已加载 Run 的顺序，不显示时间列。

详情保留原始对象，根节点默认展开，嵌套字段按需展开，集合每批 50 项；数组空槽、显式 undefined、符号键、Map 的真实键和 Set 的值分别保留。访问器只显示标记，不执行 getter；循环祖先显示 `$` 路径，相同对象在兄弟位置仍可独立展开。枚举失败仅在该分支提示，其他字段可继续查看；展开后的枚举在下一次投影发布前复用，发布后能看到原地更新。

Run、过程组、时间线项与来源 Session Entry 可以沿引用查看；工具同时保留 assistant 调用和实际 toolResult 的来源 seq。每次引用增加一级面包屑，返回前级截断后面的路径，第一级始终是最初选中的行。点击表格行会重新开始路径。引用对应表格行时，交给共用表格展开祖先、定位并闪烁；筛选排除目标时先清除筛选。本模块提供定位元数据；从诊断页定位到主区与瞄准的实际交互另行接入。

投影发布后，同身份的行保留选择与折叠。变化比较不序列化对象，不把新分配的过程席位本身当作变化；新增或更新的行使用 700ms 背景淡出，系统要求减少动态效果时不播放。

## 跟随与详情

默认跟随尾部；上滚或手动折叠暂停跟随。手动折叠前测量组头位置，折叠后保持其可见位置，把所需留白放到所有数据之后。自动收束后的新行先消耗尾部留白；“跟踪最新”清除留白并恢复跟随。没有“加载更早”按钮。

选中条目后，下方 JSON 详情默认占可用高度的 40%；上缘分隔条支持拖动、上下方向键及 Home/End，限制 15%～80%，换记录时保留高度。JSON 容器默认全部展开，可以逐层折叠；循环祖先为 `[Circular]`，共享的非循环对象分别展开，大整数显示为带 n 后缀的字符串。序列化失败只在详情内显示说明，表格和其他记录仍可使用；已不存在的选择显示移除或结算提示。

## 实现与验证入口

[诊断组装](../../apps/desktop/src/renderer/features/session-diagnostics/session-diagnostics.tsx)读取真实 chat store，[原始模型](../../apps/desktop/src/renderer/features/session-diagnostics/raw-model.ts)持有行与记录的只读投影，[表格](../../apps/desktop/src/renderer/features/session-diagnostics/diagnostic-table.tsx)拥有选择、折叠和滚动状态，[详情](../../apps/desktop/src/renderer/features/session-diagnostics/record-details.tsx)拥有高度与 JSON 树。[投影发布点](../../apps/desktop/src/renderer/features/conversation/timeline-projection.ts)只保存已提交主区值，[分组模型](../../apps/desktop/src/renderer/features/session-diagnostics/grouping-model.ts)建立行与原始对象引用，[运行时树](../../apps/desktop/src/renderer/features/session-diagnostics/object-tree.tsx)按需检查字段。

纯模型、层级、布局、摘要和序列化测试与源码相邻；[真实 App 浏览器测试](../../apps/desktop/src/renderer/features/session-diagnostics/raw-data.browser.test.tsx)覆盖实际几何、虚拟化、折叠、详情、双语主题与 390px。[分组 App 测试](../../apps/desktop/src/renderer/features/session-diagnostics/grouping.browser.test.tsx)覆盖身份、引用面包屑、懒枚举、分页、getter、循环、发布更新与减少动态效果；对象值纯测试移植原生集合的边界案例。第三方许可与打包约定见[安装包](delivery.md#安装包)。
