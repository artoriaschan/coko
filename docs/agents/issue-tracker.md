---
kind: reference
description: "本地 Markdown tracker 的路径、读写操作及决策票与实施票的区别。"
lifecycle: active
---

# Issue tracker: Local Markdown

本项目的地图、规格和任务使用本地 Markdown tracker。所有路径相对于仓库根目录，引用相对于所在文档；按 [文档体系](../DOCUMENTATION_SYSTEM.md) 确定正文归属。

## 路径与操作

- 每个功能使用已有或新建的 `.scratch/<feature-slug>/`，同一功能沿用同一 slug。
- 规格保存在 `.scratch/<feature-slug>/spec.md`。
- 实施票一票一文件：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 01 按依赖顺序编号；`Blocked by:` 记录同目录票编号，跨目录依赖写完整相对路径。
- “publish to the issue tracker”表示保存对应 Markdown 文件；“fetch the ticket”表示读取票全文及 `## Comments`。同号跨目录时使用功能目录消歧。
- 评论和讨论追加在 `## Comments`；分拣角色写在票头 `Status:`，取值见 [分拣标签](triage-labels.md)。`to-spec`、`to-tickets` 直接生成的 ready-for-agent 材料不重复分拣。
- 实施票关闭时追加完成或拒绝依据并写 `Closed: true`；未设置或 false 表示未关闭。`Status:` 保留分拣角色，不能将完成状态冒充第六个分拣标签。依赖就绪须检查前置票实际交付了所需能力，wontfix 关闭不自动解除依赖。
- 保存文件、提交、推送和 PR 交付分别报告。使用本地 tracker 不限制后续使用 PR；本配置不初始化仓库或发布远程记录。

## Wayfinder 决策地图

按用户提供的任务引用定位地图；未指定时检查现有 `.scratch/<effort>/map.md`，结合任务主题确定对象，存在多个候选且无法判断时询问用户。本配置只定义查找规则，不维护具体地图清单。地图的决策票与功能实施票使用独立目录。

- 地图：`.scratch/<effort>/map.md`；子票：同目录 `issues/<NN>-<slug>.md`。
- 决策票的 `Type:`、`Label:` 表示类型；`Status:` 使用 open / claimed / resolved，`Assignee:` 使用 none 或实际认领者。它们不套用分拣角色或实施票 Closed 字段。
- 处理前读取所属地图。frontier 是 open、未认领且所有 Blocked by 票已 resolved 的票，按编号选择；遵守地图规定的讨论范围和单票会话边界。
- 开始工作前写入实际 Assignee 与 Status: claimed；解决后追加 `## Answer`，包含结论、依据和资产链接，再设置 resolved，并在地图 Decisions so far 添加摘要及具名链接。
- 不因配置完成认领或关闭任何票。决定解决不表示产品已实现。

## 相关产物与维护

研究结果保存在 `.scratch/<feature-slug>/research/<topic>.md`；功能设计和证据按 [文档体系](../DOCUMENTATION_SYSTEM.md) 保存。委派时明确仓库根目录、所属功能和输出路径。

项目已选技术继续归 TECH_STACK 与 tech-stack，术语和 ADR 见 [领域文档](domain.md)。文档移动、弃用或归档时执行 [生命周期流程](../DOCUMENT_LIFECYCLE.md)，同批更新活动引用、摘要和任务入口；保留历史结论的原意。

上述路径模式是 tracker 的操作协议，不是正式文档到具体任务的引用。任务材料可以引用正式文档；需要成为长期依据的结论先提炼到所属正式正文，避免正式文档依赖 `.scratch/` 中的文件或状态。
