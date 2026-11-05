---
kind: spec
description: "主数据根与独立会话目录规格：macOS/Windows 统一使用 ~/.coko，独立会话落在 Documents/Coko/<日期>/<会话>/ 下并以 work/、outputs/ 分层，Artifact 展示交付文件，附件、工具结果、MCP、插件与删除清理的落点。"
status: approved
lifecycle: active
---

# 主数据根与独立会话目录规格

Status: ready-for-agent

## 来源、确认与实施状态

本规格按 `to-spec` 汇总 2026-11-04 至 2026-11-05 本会话经 `grill-me` 多轮确认的需求。用户在访谈中明确：Windows 与 macOS 的主数据根目录接口都参考程小帮；独立会话目录放到 `sessions/` 下，随后改为 `<Documents>/Coko/<yyyy-MM-dd>/<sessionId>`；`work/` 为 Agent 工作目录，`outputs/` 为交付文件目录；交付约束采用 Instructions、Sandbox、Artifact Manager 三层；删除会话时只有整个会话目录为空、且 `work/` 与 `outputs/` 都为空才清理目录；目录名截短为 `chat-<前 12 位>` 并在库中另存实际目录。其余问题均采用访谈中的推荐答案。

既有约束见 [ADR 0003](../../docs/adr/0003-settings-and-sessions-in-sqlite.md)（业务状态在 SQLite）、[ADR 0005](../../docs/adr/0005-permission-mode-and-sandbox.md)（权限模式决定审批与沙箱）、[ADR 0006](../../docs/adr/0006-file-checkpoints-and-rewind.md)（文件 checkpoint）、[ADR 0016](../../docs/adr/0016-session-cwd-fixed-worktrees.md)（会话 cwd 创建时固定）、[ADR 0017](../../docs/adr/0017-plugins-declarative-user-installed.md)（插件由用户安装）、[ADR 0020](../../docs/adr/0020-projects-organize-workspaces.md)（项目是组织容器，独立会话在专属目录）。当前实现说明见 [Headless](../../docs/subsystems/headless.md)、[后台任务](../../docs/subsystems/jobs.md)、[MCP](../../docs/subsystems/mcp.md)、[插件](../../docs/subsystems/plugins.md)、[Skills](../../docs/subsystems/skills.md) 与[分层配置](../../docs/subsystems/configuration.md)。

本规格替代此前讨论中“应用数据放在 Electron userData”的现有行为，但不改变 Electron 自己的 userData、Cache 与 Cookies。旧数据迁移不在本次范围。

## Problem Statement

用户的数据现在分散在两个地方：业务数据在 Electron userData 的 `data/` 下，独立会话的工作目录在 `~/Coko/chats` 下。macOS 上两者路径不同，Windows 上又各自按平台惯例落位，用户很难找到、备份或整体迁移。独立会话目录只有日期前缀，没有按日期分层，会话一多就难以定位。

Agent 在独立会话中没有明确的工作区约定：中间产物和最终交付文件混在一起，用户无法知道哪些文件是最终成果。超长工具结果被截断后完整内容丢失；粘贴或拖入的附件只保留原路径引用，原文件移动后历史消息就无法回看；MCP Server 没有稳定的运行时数据目录；插件记录保存绝对路径，主数据根一旦移动就失效。删除会话时目录又完全不会被清理，留下无法辨认的孤儿目录。

## Solution

把 Coko 的应用数据统一到一个主数据根 `~/.coko`（macOS 与 Windows 同一接口），Electron 自己的 userData 不变。独立会话的目录放在用户可见的 `<Documents>/Coko/<yyyy-MM-dd>/<会话目录>/` 下，内部固定分为 `work/`（Agent 工作目录）与 `outputs/`（交付文件目录）。

三层约束：

- **Instructions**：独立会话的系统上下文说明中间产物写 `work/`、交付文件写 `outputs/`、不要在会话根其他位置创建文件。
- **Sandbox**：权限根是会话根，Agent 的 cwd 是 `work/`，写根是 `work/` 与 `outputs/`，会话根其他位置只读。
- **Artifact Manager**：右栏新增 Artifacts tab，实时展示 `outputs/` 的文件树，支持打开、在 Finder 中显示和复制路径。

附件在发送时复制到主数据根下的附件目录，超长工具结果在截断时完整落盘，MCP Server 获得稳定的数据目录，插件路径改为相对主数据根记录。删除会话时按“目录是否真正为空”决定是否清理，并让用户知道哪些文件被保留。

## User Stories

1. 作为 macOS 用户，我希望 Coko 的业务数据统一放在 `~/.coko`，这样我可以直接备份和迁移整个目录。
2. 作为 Windows 用户，我希望 Coko 使用与 macOS 相同的主数据根接口 `C:\Users\<用户>\.coko`，这样两端行为一致，不必记住平台差异。
3. 作为需要多套配置的用户，我希望用 `COKO_HOME` 整体重定向主数据根，这样测试、开发和日常使用可以互不干扰。
4. 作为用户，我希望桌面日志、sidecar 日志和服务日志都进 `~/.coko/data/logs/`，这样排查问题只需要看一个地方。
5. 作为用户，我希望独立会话按首次发送日期分到 `Documents/Coko/<yyyy-MM-dd>/`，这样几个月后还能按日期找到对话产生的文件。
6. 作为用户，我希望每个独立会话有稳定的目录名 `chat-<短 id>`，这样目录不会因为标题变化而改名。
7. 作为用户，我希望同一草稿重发时复用同一个会话目录，这样不会产生重复目录。
8. 作为用户，我希望在 Finder 中打开会话目录时能清楚看到 `work/` 和 `outputs/` 两个子目录。
9. 作为用户，我希望 Agent 以 `work/` 为工作目录运行，这样它生成的中间文件和脚本不会污染交付目录。
10. 作为用户，我希望最终交付文件放在 `outputs/`，这样我不必在几十个中间文件里翻找结果。
11. 作为用户，我希望右栏有 Artifacts tab 列出 `outputs/` 的文件，这样我可以在应用内确认交付物。
12. 作为用户，我希望从 Artifacts tab 直接用默认应用打开文件，或在 Finder 中显示，这样我能立即查看成品。
13. 作为用户，我希望 Artifacts 支持 `outputs/` 下的子目录，这样按章节或批次组织的大量交付文件仍可浏览。
14. 作为用户，我希望 Artifacts 不显示隐藏文件和指向目录外的符号链接，这样列表里不会出现无关或危险的路径。
15. 作为用户，我希望 `outputs/` 里的文件被覆盖或删除后，Artifacts 列表实时反映变化，这样我看到的就是磁盘上的真实内容。
16. 作为用户，我希望粘贴或拖入的附件在发送后被复制到应用数据目录，这样原文件移动或删除后历史消息仍能回看。
17. 作为用户，我希望图片附件保持 4.5 MB 上限、普通文件放宽到 32 MB，这样既能处理常用文档，又不会意外写入超大文件。
18. 作为用户，我希望超长工具结果被截断时完整正文保存到磁盘，这样我可以按路径查看完整输出。
19. 作为用户，我希望只有被截断的结果才落盘，未截断的普通结果不产生额外文件，这样数据目录不会迅速膨胀。
20. 作为用户，我希望落盘文件有 32 MB 上限并在超出时明确标注截断，这样单次命令不会写满磁盘。
21. 作为用户，我希望 Agent 能直接读取当前会话的工具结果落盘文件，而不必每次都弹审批，这样它能基于完整输出继续工作。
22. 作为用户，我希望 MCP Server 有稳定的 `data/mcp/<serverName>/` 目录，这样需要持久化状态的 Server 不会把文件写到工作区。
23. 作为用户，我希望 MCP 数据目录通过环境变量和默认 cwd 提供给 Server，但配置里显式写了 cwd 时不覆盖，这样现有配置行为不变。
24. 作为用户，我希望后台命令的输出仍然保存在 `data/jobs/` 下，这样现有的 Job 排查方式不变。
25. 作为用户，我希望移动 `COKO_HOME` 后已安装插件仍然可用，这样备份和迁移不会破坏插件。
26. 作为用户，我希望在侧栏直接新建空白项目，目录自动创建在 `Documents/Coko/projects/<名称>`，这样我不必先手动建文件夹。
27. 作为用户，我希望空白项目重名时自动追加 `-2`、`-3`，这样不会覆盖已有目录。
28. 作为用户，我希望项目目录就是工作目录，不再套 `work/` 和 `outputs/`，这样项目内相对路径保持简单。
29. 作为用户，我希望删除会话时，只有目录确实为空才被清理，这样有内容的目录不会被误删。
30. 作为用户，我希望删除会话但目录有内容时，确认框告诉我目录保留在哪里，这样我知道文件没有丢。
31. 作为用户，我希望归档会话不会删除任何文件，这样归档只是收起，不是销毁。
32. 作为用户，我希望旧版本创建的会话仍然能打开，这样升级不会让历史对话消失。
33. 作为用户，我希望设置界面能看到 `~/.coko` 和 `Documents/Coko` 的实际路径并可打开，这样我不用猜数据在哪里。
34. 作为开发者，我希望测试不会读写真实的 `~/.coko` 或 Documents，这样并行测试和本地开发互不干扰。

## Implementation Decisions

### 主数据根

- 根目录接口与程小帮同构：`COKO_HOME ?? join(homedir(), '.coko')`，macOS 与 Windows 都走这一条，Windows 上是 `C:\Users\<用户>\.coko`，不读取 `%APPDATA%` 或 `%LOCALAPPDATA%`。
- 根下布局为 `data/`、`skills/`、`plugins/`，不再建 `sessions/`。
- `data/` 下包含：`coko.db`、`blobs/`、`logs/`、`jobs/`、`attachments/<sessionId>/`、`tool-results/<sessionId>/`、`mcp/<serverName>/`。
- `desktop.jsonl` 与 `sidecar.jsonl` 写入 `data/logs/`；Electron 的 userData、Cache、Cookies、IndexedDB、Local Storage 保持在平台默认位置。
- `COKO_USER_DATA_DIR` 只控制 Electron 的 userData；数据根由 `COKO_HOME` 或显式 `--data-dir` 控制，不保留旧路径回退。
- 不做旧数据迁移：旧库和旧 `~/Coko/chats` 原样保留，新版本从新数据根开始；旧库中的会话不会出现在新库中。

### 独立会话目录

- 目录为 `<Documents>/Coko/<yyyy-MM-dd>/<会话目录>/work/` 与 `outputs/`。
- Documents 由桌面 main 用 `app.getPath('documents')` 解析后传给 sidecar；`COKO_CHATS_ROOT` 作为显式覆盖，默认值为 `<Documents>/Coko`。
- 日期按首次成功发送时的本地日期确定，目录创建后不随跨天或标题变化移动。
- 会话目录名为 `chat-<sessionId 前 12 位>`；若同一天该目录已存在，确定性地回退为完整 `sessionId`，保证同一草稿幂等。
- `sessions` 表新增 `directory`（会话根本地路径）与 `cwd`（`work/` 的路径）两列；旧独立会话两列为空，cwd 继续回退到 `workspace.path`。
- Session DTO 暴露 `directory`，`outputs` 由 `directory/outputs` 派生；不单独暴露 `work`。
- 独立会话的 Workspace 名称固定为“独立对话 · yyyy-MM-dd”，不随标题变化，也不出现在项目列表。

### 权限与 Instructions

- 独立会话的权限根是会话根；Agent 的 cwd 是 `work/`；写根是 `work/` 与 `outputs/`；会话根其他位置只读。
- 项目会话保持现状：cwd 是项目根，权限根与 cwd 一致，不受 `work/outputs` 影响。
- Instructions 只对独立会话注入：说明中间产物写 `work/`、交付文件写 `outputs/`、不要在会话根其他位置创建文件；项目会话不注入。
- `Sandbox` 的写根从单一 workspace 扩展为“权限根 + 额外可写根”的表达，越界写入仍按现有审批规则处理。

### Artifact Manager

- Artifact 以实时扫描 `outputs/` 为唯一事实源，不新增会话条目、不保留历史版本、不显示“已删除”占位。
- 新增右栏 `artifacts` tab，展示文件树，支持用默认应用打开、在 Finder 中显示、复制路径；空态说明 `outputs/` 为空。
- 只对独立会话启用；项目会话不显示 Artifacts tab；旧会话（`directory` 为空）不显示。
- 列表包含 `outputs/` 下所有普通文件与子目录，跳过以 `.` 开头的隐藏文件，不跟随指向 `outputs/` 外的符号链接。
- Artifact 列表通过 sidecar 的 HTTP 接口读取，renderer 不直接访问文件系统。

### 附件与工具结果

- 所有粘贴或拖入的附件在发送时复制到 `data/attachments/<sessionId>/<id>-<文件名>`，消息引用副本；发送前的图片草稿仍保存在 IndexedDB，发送成功后清理草稿。
- 图片单文件上限保持 4.5 MB；普通文件上限 32 MB；超限在输入区报错，不静默截断。
- 工具结果只在被截断时把完整正文写入 `data/tool-results/<sessionId>/<toolCallId>.txt`，并在返回给模型的文本末尾附上路径。
- 工具结果单文件上限 32 MB，超过时只写前 32 MB 并在文件末尾和返回文本中标注 `[truncated]`。
- 当前会话的 `data/tool-results/<sessionId>/` 加入只读根，Agent 可以直接读取；跨会话目录不可读。

### MCP、Job 与插件

- `data/mcp/<serverName>/` 为 MCP Server 的运行时数据目录；启动时注入 `COKO_MCP_DATA_DIR`，仅在配置未指定 `cwd` 时把该目录作为 cwd。
- 后台命令的输出继续保存在 `data/jobs/<sessionId>/<jobId>.log`，不改为 `shell-outputs`。
- 插件安装路径在 `plugins` 表中改为相对 `COKO_HOME` 的记录，读取时解析为绝对路径；已有绝对路径记录按原样使用。
- `data/mcp/` 下的数据按 Server 保留，不随会话删除。

### 项目与删除

- 侧栏新增“新建空白项目”入口：输入名称后创建 `<Documents>/Coko/projects/<名称>`；名称去掉首尾空白、路径分隔符和前导点，空名称回退为“新项目”，重名追加 `-2`、`-3`；创建后注册 Project 与 Workspace 并打开新会话。
- 项目目录就是工作目录，不套 `work/` 与 `outputs/`。
- 删除会话时，只有会话目录除 `work/`、`outputs/` 外没有其他内容且两者都为空，才删除目录，并删除无其他会话引用的 Workspace 记录。
- 目录有内容时保留，删除确认框显示保留路径并允许复制。
- 删除会话时同时清理 `data/attachments/<sessionId>/` 与 `data/tool-results/<sessionId>/`；不清理 `data/mcp/`。
- 归档不删除目录；不做按天自动过期。

### 协议与设置

- Session DTO 新增 `directory`（可为空）。
- 新增会话级 Artifact 列表接口，返回 `outputs/` 的相对路径、名称、大小与修改时间。
- 创建项目接口扩展“空白项目”模式，由 sidecar 创建目录并注册 Project 与 Workspace。
- 设置界面增加存储区域，只读显示 `COKO_HOME` 与 `<Documents>/Coko` 的实际路径，并提供“打开目录”；路径修改仍由 `COKO_HOME` 环境变量控制。

### 平台

- Windows 上 `chmod` 调用保留但视为尽力而为，不额外引入 ACL。
- 不启用 `\\?\` 长路径前缀；`Documents/Coko/<日期>/chat-<12>` 的长度作为已知限制记录。

## Testing Decisions

好的测试只验证外部行为：用真实 Sidecar 启动、通过 HTTP 操作、检查磁盘上的目录与文件；不测试私有函数如何拼路径。以下接缝按“尽量少、尽量高”选择：

- **主接缝：Sidecar 集成测试。** 复用现有的真实 Sidecar harness（临时 `COKO_HOME`、`COKO_CHATS_ROOT`、独立 `--data-dir`），覆盖：首次发送后的目录结构与日期分层、Session DTO 的 `directory`、`work/` 为 cwd、写根限制、Artifact 接口的过滤与实时性、附件复制、截断结果落盘与只读根、MCP 目录与 `COKO_MCP_DATA_DIR`、删除时目录与 Workspace 的清理。先例是现有的首次发送、权限、Jobs、MCP 与插件集成测试。
- **桌面 e2e：** 复用现有 e2e harness（已支持 `COKO_HOME` 与 `COKO_CHATS_ROOT`），覆盖 Artifacts tab、新建空白项目的入口与重名、删除确认中的保留路径、设置页的存储路径展示。默认 Documents 的派生的路径不写真实 Documents：e2e 用 `COKO_CHATS_ROOT` 隔离。
- **单元：** 纯函数覆盖目录名与日期派生、`chat-<12>` 冲突回退、Artifact 过滤（隐藏文件、越界符号链接）、插件相对路径解析、附件大小上限。
- **Schema：** 新增 v12 迁移测试，验证旧库升级后有 `directory`/`cwd` 列、旧会话值为空且仍可读取；沿用现有 `migrate-vN` 测试模式。
- 不新增 renderer 直接读文件系统的接缝；Artifact 一律经 sidecar HTTP。

## Out of Scope

- 旧数据迁移（旧库、旧 `~/Coko/chats` 目录）。
- 按天自动过期或自动清理会话。
- Artifact 的历史版本、删除占位与审计。
- 项目会话的 `work/`、`outputs/` 与 Artifacts tab。
- 把 `data/jobs` 改名为 `shell-outputs`。
- Windows ACL 与长路径前缀改造。
- 修改 Electron 的 userData、Cache、Cookies 或 IndexedDB 位置。

## Further Notes

- 本次会改变会话 cwd 的派生方式（从 `workspace.path` 派生改为新增 `sessions.cwd`），并扩展沙箱写根的表达，二者都影响 ADR 0016 与 ADR 0005 的现有描述，实施前需要新建或修订对应 ADR。
- 开发阶段明确不迁移旧数据；升级后旧会话不出现在新库中是预期行为。
- `sessions.directory`/`cwd` 的值为本机绝对路径，跨机器恢复时需要重新映射；本次不处理跨机器迁移。
- 写根扩展会影响文件工具、checkpoint 与审批路径，实施票需要按这三点分别验证。
