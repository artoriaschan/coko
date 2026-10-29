# 09: 设置菜单分组

**What to build:** 设置左侧菜单按个人（常规、外观、记忆）、环境（权限）、插件（插件、技能、MCP、Hook）、模型（模型服务）分组，“关于”在最底部且不属于任何分类。未交付的外观、插件、Hook 不显示；没有可显示菜单项的分类不显示标题。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉以 Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 为准（画面 01 的左侧菜单）。

- [ ] MS-01 通过
- [ ] 现有分区的打开、切换与 setSection 行为不变；未交付分区仍不能被打开
- [ ] 分类标题与菜单项的 zh / en 文案齐全
- [ ] 键盘导航与焦点可见，明暗主题正确
