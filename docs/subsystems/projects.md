---
kind: reference
description: "项目的持久化模型、Workspace 迁移、会话归属与侧栏基础列表；项目组织与固定执行目录的边界。"
lifecycle: active
---

# 项目与会话列表

项目是组织会话的容器，主要文件夹对应一个 Workspace。本文描述项目数据、升级迁移和工作台的基础列表。项目的编辑、归档、置顶和多文件夹权限尚未接入界面，不把存储字段等同于这些能力已经交付。

## 数据与迁移

[SessionStore](../../packages/session/src/types.ts) 提供独立的 ProjectRepository。Project 保存名称、主要 Workspace、有序的附加文件夹路径、置顶时间与创建时间；主要 Workspace 在项目间唯一，项目名称可重复。内存和 SQLite 实现共享契约测试。

SQLite v10 在一次前向迁移中建立 projects 表，并给 sessions 增加 project_id、pinned_at、archived_at。每个已有 Workspace 迁移为一个单文件夹项目，沿用名称和创建时间；其中的根会话（包括绑定 worktree 的会话）归入该项目，置顶与归档为空。子会话不单独保存项目归属。升级沿用现有迁移前 VACUUM INTO 备份及失败处理。

经 Workspace 登记接口添加目录时，服务端验证目录存在并解析为真实路径，再登记 Workspace 与单文件夹项目。相同目录经符号链接登记不会产生第二个 Workspace 或项目。此入口暂时作为创建项目的过渡入口。

## 会话归属与列表协议

根会话在有项目的主要 Workspace 中创建时默认归入该项目；明确传入 projectId: null 时为独立会话。子会话的存储记录不单独保存归属，协议 DTO 沿父会话链读取根会话归属。分叉和交接显式继承来源的归属；它们不会重新根据工作目录决定归属。

归属和执行目录分离。组织字段的修改不改变 Workspace 或 worktree 绑定。会话的 updatedAt 表示最后记录时间：创建和追加条目会刷新，标题、模型及组织字段的修改不刷新。根会话列表按该时间降序、相同时间按 id 排列，子会话经子列表查询。

GET /api/projects 返回项目及源文件夹的主要标记、未归档根会话数、最近使用时间。最近使用取项目中根会话最后记录时间，没有会话时取项目创建时间。Session DTO 带项目归属、置顶和归档时间。

## 工作台列表

renderer 的 [list-store](../../apps/desktop/src/renderer/stores/list-store.ts) 持有项目、Workspace、根会话列表与加载状态；chat-store 保留会话内容、草稿及 Run 控制，通过独立列表 store 更新组织视图。React 的 useLists 订阅列表数据，useCurrentSession 结合当前会话标识查询列表。

侧栏基础列表分为“对话”和“项目”：独立的未归档、未置顶根会话在“对话”下；项目行在原位展开或收起所属会话，空项目显示“暂无对话”。项目内会话只缩进内容，整行背景与命中宽度保持一致。共享 SidebarListRow 提供 H32/R8 圆弧；行间距为 2px。列表不显示运行状态点或分支 chip，也不按运行状态上浮。侧栏不再提供 worktree 列表和移除入口。

## 验证与相关设计

- [存储契约](../../packages/session/src/repository-contract.ts)：主要 Workspace 唯一、完整组织字段的读写和最后记录时间。
- [迁移用例](../../packages/session/src/sqlite/migrate-v10.test.ts)：v9 升级、根会话和 worktree 归属、子会话字段及备份读回。
- [Sidecar 协议](../../tests/integration/sidecar-projects.test.ts)：真实目录判重、项目列表、创建会话、分叉和重启读回。
- [列表浏览器用例](../../apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx)：排序、展开、空状态及实际几何。
- [ADR 0020](../adr/0020-projects-organize-workspaces.md)：组织关系与执行目录分离的理由。
