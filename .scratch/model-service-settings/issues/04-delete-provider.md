# 04: 删除供应商

**What to build:** 用户点击某供应商的“删除”后看到二次确认，确认框写明引用它的 Session 数量。确认后供应商与其 Credential 被删除，引用它的 Session 模型字段被清空并在下次运行前提示重新选择模型，默认模型指向它时回退为第一个可用模型。

**Blocked by:** 03

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉以 Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 为准；确认框沿用设计系统已有组件。

- [ ] MS-32、MS-33 通过
- [ ] 确认框显示的引用数量与库中实际一致；取消时不做任何修改
- [ ] 删除后用相同 ID 重新创建，原 Session 不会自动使用新供应商
- [ ] 删除后 Sidecar 的明文缓存被清除；库中没有该 Credential
