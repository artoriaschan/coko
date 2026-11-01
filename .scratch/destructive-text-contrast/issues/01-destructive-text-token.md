# 01: 错误文字的颜色在卡片与 muted 背景上对比度不足 4.5

**Status:** needs-triage

**Category:** bug

**What:** 共用 token `--destructive`（`text-destructive`）作为小号文字颜色时，在若干背景上低于 WCAG AA 的 4.5:1。数值由 M6 收尾时实测（2026-11-01）：

| 主题 | 背景 | 对比度 |
| --- | --- | --- |
| 浅色 | 白色（card、background、popover） | 4.498 |
| 浅色 | muted | 4.304 |
| 深色 | 设置卡片填充（gray-800） | 4.238 |
| 深色 | popover | 4.775 |
| 深色 | muted | 5.233 |
| 深色 | background | 5.545 |

`text-destructive` 在 31 个文件中有 59 处使用；设置卡片上的小号错误文字在两种主题下都不达标，其他位置只在浅色下不达标。M6 中关于页、插件分区与交接行已改为中性色文字加 destructive 图标绕开。

**建议方向（待分拣确认）：** 仿照已有的 `--warning-text`，增加专用于文字的 `--destructive-text`，图标与边框继续用 `--destructive`；改动前按 [设计系统规格](../../../docs/tech-stack/ui-design-system.md) 处理 token，并逐处核对使用位置。

**来源：** M6 票 05、10、12 的实施者先后测到同样的数值，票 14 汇总了全部使用位置。

## Comments
