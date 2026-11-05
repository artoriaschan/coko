---
kind: reference
description: "开发者开关下的会话数据诊断：已加载条目的 Run 分组、虚拟表格、跟随与锚定、JSON 详情及数据范围。"
lifecycle: active
---

# 会话数据诊断

设置 → 常规的“开发者”卡片提供默认关闭的“会话数据诊断”开关。开启后，当前 Session 右栏的“开始”页出现入口，不自动打开；关闭时，已采用布局中的诊断页被移除，未采用的布局在恢复时过滤。设置保存、失败与布局规则见[工作台](workbench.md)。

## 原始数据

页面只读当前主区 Session 在 chat store 中已经收到的 Session Entry；不读取数据库、不新增请求、不提供导出，也不加载更早数据。归档或 worktree 移除后只读的 Session 仍可查看。用户文本、登记 Secret 的替换标记与主时间线共用来源，诊断模块不再次脱敏。

每条真实条目以 seq 为身份，跳过的 seq 不补造。`run_start` 为组头，同一 Run 的其余条目按 seq 成为子行，整个组位于组头的位置；没有组头的 Run 条目和不属于 Run 的条目按 seq 作为根行。Run 列按加载条目中 Run 首次出现的顺序从 1 编号，非 Run 条目为空。

列为序号、类型、Run、UTC 毫秒时间与摘要；message 类型附角色。摘要省略已有独立列的顶层元数据，保留嵌套业务值，最多 240 字符。每行与表头固定为 30px，表格使用 Tanstack 虚拟化，保留当前吸顶祖先；序号可悬停或聚焦查看全文。超出面板宽度的列只在表格中横向滚动，工具栏可换行。

## 跟随与详情

默认跟随尾部；上滚或手动折叠暂停跟随。手动折叠前测量组头位置，折叠后保持其可见位置，把所需留白放到所有数据之后。自动收束后的新行先消耗尾部留白；“跟踪最新”清除留白并恢复跟随。没有“加载更早”按钮。

选中条目后，下方 JSON 详情默认占可用高度的 40%；上缘分隔条支持拖动、上下方向键及 Home/End，限制 15%～80%，换记录时保留高度。JSON 容器默认全部展开，可以逐层折叠；循环祖先为 `[Circular]`，共享的非循环对象分别展开，大整数显示为带 n 后缀的字符串。序列化失败只在详情内显示说明，表格和其他记录仍可使用；已不存在的选择显示移除或结算提示。

## 实现与验证入口

[诊断组装](../../apps/desktop/src/renderer/features/session-diagnostics/session-diagnostics.tsx)读取真实 chat store，[原始模型](../../apps/desktop/src/renderer/features/session-diagnostics/raw-model.ts)持有行与记录的只读投影，[表格](../../apps/desktop/src/renderer/features/session-diagnostics/diagnostic-table.tsx)拥有选择、折叠和滚动状态，[详情](../../apps/desktop/src/renderer/features/session-diagnostics/record-details.tsx)拥有高度与 JSON 树。

纯模型、层级、布局、摘要和序列化测试与源码相邻；[真实 App 浏览器测试](../../apps/desktop/src/renderer/features/session-diagnostics/raw-data.browser.test.tsx)覆盖实际几何、虚拟化、折叠、详情、双语主题与 390px。第三方许可与打包约定见[安装包](delivery.md#安装包)。
