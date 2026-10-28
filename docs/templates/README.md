---
kind: index
description: "按文档职责选择 Coko 的设计、决策、参考、指南、证据、升级及复盘模板。"
lifecycle: active
---

# 文档模板

先按 [文档体系](../DOCUMENTATION_SYSTEM.md) 确定归属，再复制相应模板。替换提示文字并删除模板注释；不适用章节可以删除，不为填满模板而编造事实。模板本身不代表已有产品设计或验证结果。

模板已带 `lifecycle: active`，复制后保留；它不代表设计获批或功能已实现；弃用、归档及引用同步遵循 [生命周期流程](../DOCUMENT_LIFECYCLE.md)。模板目录中的示例状态不参与产品状态判断。

| 模板 | 目的 |
| --- | --- |
| [设计提案](design.md) | 从规格推导责任、接口、状态、失败和验证方案 |
| [决策记录](decision.md) | 保存值得长期维护的选择、理由、后果与来源 |
| [当前参考](reference.md) | 描述实际架构、子系统或包契约 |
| [操作指南](guide.md) | 从读者起点走到可观察的结果 |
| [验证证据](evidence.md) | 记录实际检查、文档影响和结论限制 |
| [升级说明](upgrade-guide.md) | 说明外部不兼容变化与可验证的迁移步骤 |
| [事故复盘](postmortem.md) | 解释失效机制、漏检原因和防复发措施 |

规格和实施票使用新版 `to-spec`、`to-tickets` 的模板；术语使用 `domain-modeling` 的 GLOSSARY 格式。本目录不复制这些全局 skill 模板。
