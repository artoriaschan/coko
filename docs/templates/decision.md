---
kind: decision
description: "填写这个长期决定及何时需要回看其理由。"
status: proposed
lifecycle: active
category: architecture
---

# 填写决定标题

<!-- 复制到 docs/adr/NNNN-slug.md；编号扫描现有记录后分配，集成前检查冲突。简单 ADR 可压缩为一段，但保留真实上下文、决定、理由与来源。 -->
<!-- category 可选 architecture、feature、testing、process、simplification、bug-fix；只有决定满足长期记录标准时才创建。 -->

## 上下文

说明问题、约束和为什么这个选择值得长期记录。来自任务讨论的必要背景与确认依据提炼在本页，记录确认主体、日期和适用范围；引用可长期访问的正式材料，不反向链接任务工作区。背景应能独立于所选方案成立。

## 决定

写明采用什么、由谁负责及明确不承诺什么。proposed 使用提案语气；accepted 记录确认依据，并增加 implementation: not-started、partial 或 implemented。只有实施证据支持时才写成当前行为。

## 理由与备选方案

只记录真实考虑过的替代方案及其没有采用的原因。缺少历史依据时说明缺口，不虚构论证来填模板。

## 后果与验证

说明获得什么、承担什么、哪些条件变化时需要重新审视，以及如何验证必须保持的行为。implementation 变为 implemented 时链接真实实现和检查结果。

## 来源与后继

链接正式确认记录、所属当前文档和必要后继 ADR；确认只发生在任务讨论中时，将必要信息提炼在本页，由原任务链接本 ADR。改变决定时新建后继并双向链接；原决定标记 superseded。仅更新旧决定的路径、名称等事实时不创建新决定。归档规则见文档体系，不因文件年代久远自动归档。
