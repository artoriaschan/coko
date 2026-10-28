---
kind: reference
description: "单领域术语表、ADR 的读取位置，以及与技术选型和实现说明的边界。"
lifecycle: active
---

# Domain docs

采用 single-context 布局：根目录 `GLOSSARY.md` 与 `docs/adr/NNNN-slug.md`。代码使用多个 workspace 不自动意味着多个业务领域；本次不创建 GLOSSARY-MAP 或空领域文档。

## 读取与使用

探索领域、生成规格/票或修改代码前，读取已存在的 GLOSSARY 及与当前主题相关的 ADR。文件不存在时正常继续，不为占位创建正文；首次术语确定或决定满足记录标准时，由 domain-modeling 按需创建。

输出中的领域概念使用术语表定义，避免未经确认的同义替换。术语含义冲突时先澄清；GLOSSARY 只保存定义，不保存字段、存储方案和实现流水。

ADR 保存重要取舍的上下文、决定与理由。只读取主题相关记录，并按 [文档生命周期](../DOCUMENT_LIFECYCLE.md) 区分当前、弃用与历史材料。提出与有效 ADR 冲突的方案时明确指出冲突和重开理由，不静默覆盖。

## 归属与状态

需求与功能设计、用户已选技术和当前实现说明按 [文档体系的边界](../DOCUMENTATION_SYSTEM.md#需求已选型与实现的边界) 分别维护。研究结论不自动成为用户决定，已选技术不因尚未实现迁入需求目录。

ADR 的 status、implementation、确认依据及候选方案的处理，以 [状态与晋升](../DOCUMENTATION_SYSTEM.md#四-状态与晋升) 为唯一规则；accepted 不代表 implemented，lifecycle: active 也不代表已批准。创建或更新 ADR 时使用项目 [决策模板](../templates/decision.md) 并保留该规则要求的来源与后继关系。

新建正式文档和术语表必须从所属正式导航可达；更新、替代、归档时同步相关引用与摘要。ADR 自身提炼必要背景、确认依据和理由，遵守 [引用方向](../DOCUMENTATION_SYSTEM.md#正式文档与任务材料的引用方向)，不反向链接 `.scratch/` 中的具体材料。
