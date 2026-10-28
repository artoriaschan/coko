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
