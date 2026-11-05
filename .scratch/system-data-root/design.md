---
kind: design
description: "主数据根、独立会话目录与交付文件的跨进程责任、持久化和失败保证。"
lifecycle: active
status: approved
---

# 主数据根与独立会话目录设计

## 问题与范围

实现[已批准规格](spec.md)中的用户故事 1–34。统一业务数据根，分离独立会话的工作文件与交付文件，提供 Artifact、附件副本、工具结果落盘和保守删除。旧数据迁移、项目目录分层、Artifact 历史、Windows ACL 不在范围内。

## 来源与约束

产品语义来自规格确认记录；实现授权来自用户于 2026-11-05 调用 implement-spec。工程判断在该授权内，测试接缝沿用规格 Testing Decisions。遵循[架构约定](../../docs/tech-stack/architecture.md)、[测试约定](../../docs/tech-stack/testing.md)、[界面约定](../../docs/tech-stack/ui.md)、[文档体系](../../docs/DOCUMENTATION_SYSTEM.md)。SQLite 保管业务状态，renderer 不访问文件系统，主进程承载 Electron 原生文件操作。ADR 0005/0016 的生效语义须随新实现同步，不迁移用户数据。

## 模块责任与依赖

| 模块或进程 | 责任与所有权 | 消费者 |
| --- | --- | --- |
| Desktop main / preload | 解析 Electron Documents；保留 userData；把隔离的数据与日志目录传给 Sidecar；承载打开、显示文件等原生能力 | Sidecar 启动；renderer shell bridge |
| Server config / runtime | 解析 COKO_HOME、dataDir、chatsRoot，装配附件、工具结果和 MCP 存储根 | 应用服务与 HTTP |
| FirstSendService / Session 服务 | 独立会话目录分配、Workspace 与 Session 原子创建、失败补偿；cwd 固定与指令注入 | 首次发送、Agent 运行 |
| Session SQLite / protocol | v12 directory/cwd 与旧值兼容；DTO 暴露 directory；插件相对路径存储 | Server、SDK、renderer |
| Agent policy / host sandbox | 区分权限读取根与允许写根；当前会话工具结果目录只读 | 文件工具、bash、审批、checkpoint |
| Server 文件服务 | 附件复制与大小限制、截断结果落盘、Artifact 扫描与路径约束、保守删除 | HTTP、模型工具结果、原生打开入口 |
| Renderer | Artifacts 树、空白项目、删除路径提示、设置存储展示；网络和错误状态在应用层 | 用户 |

## 关键路径与接口

首次发送：renderer 提交稳定草稿 id → FirstSendService 在 chatsRoot/本地日期 下选择短 id 或完整 id → 创建会话根及 work/outputs → 登记根 Workspace、Session.directory 与 Session.cwd → 启动 Run。系统指令仅在该类 Session 中说明工作/交付位置。项目会话沿用 Workspace 或 Worktree cwd。

Artifact：按会话读取 directory/outputs，扫描结果经会话级 HTTP 返回相对路径、名称、大小和修改时间；过滤隐藏项、越界符号链接，不持久化清单。renderer 刷新磁盘事实并通过现有 bridge 打开或显示经约束的路径。

附件：发送前校验所有附件与大小 → 复制到 data/attachments/sessionId → 消息只引用副本 → 成功后清理草稿。复制失败不启动消息，清理本次部分副本并保留草稿。

工具结果：只有将被截断的正文写入 tool-results/sessionId/toolCallId.txt；32 MB 限制和截断标记同时反映在文件与模型文本中；加入当前会话只读根。MCP stdio 启动前提供独立数据目录及环境变量，显式 cwd 优先。

## 状态 持久化与失败

会话根与 cwd 是本机绝对路径，随 Session 保持固定；旧值为空时继续回退到 Workspace。主数据根不做旧位置回退，不移动旧库。插件新记录相对主根解析，兼容既有绝对值；更新/删除仍执行根内校验。

首次发送与空白项目创建失败补偿仅清理本次新建资源，不覆盖已存在目录。重发通过稳定会话 id 与已存 directory 复用目录，不因跨天或标题改名。目录碰撞时短名回退完整 id，不认领其他 Session 的目录。

删除保守处理：仅在根除 work/outputs 外为空且二者为空时清理；有文件则保留根及 Workspace；Project 目录不删除。附件和工具结果随 Session 删除，MCP 数据保留。归档只更新状态。磁盘删除与数据库删除无法构成跨系统事务，失败必须可见，不将未知结果当成功，检查与删除间仍以文件系统最终结果防止误删。

## 备选方案与选择

业务数据继续跟随 Electron userData 被批准规格替换为 COKO_HOME；Electron 自身数据保持原位置。独立目录整根可写被 work/outputs 写根替换。Artifact 清单选择即时扫描而非数据库与历史版本，保证磁盘为唯一事实源。具体理由由对应 ADR 保存。

## 验证与实施顺序

| 规格场景 | 接缝 | 观察结果 | 依赖与文档影响 |
| --- | --- | --- | --- |
| 1–4、32–34 | 配置测试、Sidecar、后台 Electron | 路径、旧库保留、隔离与日志 | 主根 ADR、配置/交付正文 |
| 5–10、21 | 迁移、首次发送与权限集成 | 目录、cwd、指令、写根审批、旧会话 | Session 与沙箱 ADR |
| 11–15 | Artifact HTTP、Browser Mode、后台 Electron | 树、过滤、更新、文件操作 | 工作台正文 |
| 16–20 | Sidecar 真实装配 | 复制、上限、截断内容与可读取路径 | 上下文/执行正文 |
| 22–28 | MCP/插件/项目集成与 UI | cwd/env、移动根、名称与冲突 | MCP/插件/项目正文 |
| 29–31、33 | 删除/归档集成、Browser Mode、后台 Electron | 空目录清理、保留提示、存储展示 | 项目/设置正文 |

按实施票依赖图推进，票独立 worktree 汇入一个集成分支。最终对固定基线做 Standards/Spec 两轴评审。Windows 仅做代码与测试层假设审查，实机、真实模型和原生前台操作单独报告。

## 待决问题与确认

没有阻塞产品问题。文件系统竞态、附件持久化格式与刷新方式属于授权内工程细节，由实现与接缝证据收敛；不放宽规格失败保证。发生产品语义变化时重新向用户确认。
