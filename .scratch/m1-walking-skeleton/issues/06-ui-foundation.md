# 06: 界面基础：设计 token、组件与三栏骨架

**What to build:** packages/ui：按 [界面约定](../../../docs/tech-stack/ui.md) 与 [设计系统规格](../../../docs/tech-stack/ui-design-system.md) 落地 token、Tailwind 4 主题、`cn()`、所需 shadcn 组件、MarkdownRenderer（Streamdown + 插件）、Sonner Toast（登记版本）；packages/i18n 的 zh / en 字典；renderer 三栏布局（侧栏、中栏、右栏、rail、窄窗口收起）与主题 / locale 切换，使用静态数据。几何沿用 [信息架构决定](../../desktop-app/issues/08-grill-desktop-information-architecture.md)。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Browser Mode 测试：明暗主题、侧栏宽度范围与 <1024 自动收起、390px 中栏无整页横向滚动
- [ ] MarkdownRenderer 渲染代码、表格、数学与 mermaid
- [ ] 所有文案来自 i18n 字典，切换语言即时生效
- [ ] 样式守卫（若已接入）通过；没有字面量颜色

## Comments
