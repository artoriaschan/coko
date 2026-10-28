---
kind: index
description: "Coko 长期决定（ADR）的索引。"
lifecycle: active
---

# 长期决定

ADR 的状态、实施字段与替代规则见 [文档体系](../DOCUMENTATION_SYSTEM.md#四-状态与晋升)。accepted 不代表已实现。

| 编号 | 决定 | status | implementation |
| --- | --- | --- | --- |
| [0001](0001-sidecar-on-electron-node.md) | sidecar 运行在 Electron 内置 Node.js，移除 Bun | accepted | partial |
| [0002](0002-local-service-access-auth.md) | 本地服务访问认证 | accepted | implemented |
| [0003](0003-settings-and-sessions-in-sqlite.md) | 设置与会话存储在 SQLite | accepted | partial |
| [0004](0004-model-credentials-safe-storage.md) | 模型凭据由 main 用 safeStorage 加密 | accepted | implemented |
| [0005](0005-permission-mode-and-sandbox.md) | 权限模式同时决定审批范围与沙箱档位 | accepted | implemented |
| [0006](0006-file-checkpoints-and-rewind.md) | Checkpoint 只追踪文件工具，回退以追加记录实现 | accepted | implemented |
| [0007](0007-secrets-from-registered-entries.md) | Secret 只来自登记条目，项目文件不能引用 | accepted | not-started |
| [0008](0008-project-files-only-tighten.md) | 项目文件只能收紧，不能授予 | accepted | not-started |
| [0009](0009-user-authored-resources-as-files.md) | 用户编写的指令、Skills 与命令保存为文件 | accepted | not-started |
