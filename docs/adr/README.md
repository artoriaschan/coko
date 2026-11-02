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
| [0003](0003-settings-and-sessions-in-sqlite.md) | 设置与会话存储在 SQLite | accepted | implemented |
| [0004](0004-model-credentials-safe-storage.md) | 模型凭据由 main 用 safeStorage 加密 | accepted | implemented |
| [0005](0005-permission-mode-and-sandbox.md) | 权限模式同时决定审批范围与沙箱档位 | accepted | implemented |
| [0006](0006-file-checkpoints-and-rewind.md) | Checkpoint 只追踪文件工具，回退以追加记录实现 | accepted | implemented |
| [0007](0007-secrets-from-registered-entries.md) | Secret 只来自登记条目，项目文件不能引用 | accepted | implemented |
| [0008](0008-project-files-only-tighten.md) | 项目文件只能收紧，不能授予 | accepted | implemented |
| [0009](0009-user-authored-resources-as-files.md) | 用户编写的指令、Skills 与命令保存为文件 | accepted | implemented |
| [0010](0010-provider-one-shot-save.md) | Provider 与 Credential 一次提交、一次存储 | accepted | implemented |
| [0011](0011-goal-state-as-session-entries.md) | Goal 状态记为 Session Entry，自动推进不跨进程保留 | accepted | implemented |
| [0012](0012-host-process-registry.md) | Sidecar 登记子进程，启动时按身份清理孤儿 | accepted | implemented |
| [0013](0013-external-hooks-tighten-only.md) | 外部 Hook 只能收紧判定，allow 不越过规则 | accepted | implemented |
| [0014](0014-subagents-as-child-sessions.md) | 子代理是同一 Sidecar 中的子 Session | accepted | implemented |
| [0015](0015-schedules-at-most-once-latest-catch-up.md) | 定时任务至多一次投递，只补最近一次 | accepted | implemented |
| [0016](0016-session-cwd-fixed-worktrees.md) | Session 的工作目录创建时固定，worktree 只在干净时移除 | accepted | implemented |
| [0017](0017-plugins-declarative-user-installed.md) | 插件只声明资源，用户级安装，按可执行声明批准 | accepted | implemented |
| [0018](0018-agent-teams-in-root-session.md) | Agent Teams 在根 Session 中进行，任务板以 compare-and-set 协调 | accepted | implemented |
| [0019](0019-headless-runs-deny-approvals.md) | 无界面运行的审批自动拒绝，Provider 来自启动配置 | accepted | implemented |
| [0020](0020-projects-organize-workspaces.md) | 项目是组织容器，执行边界仍是 Workspace | accepted | not-started |
| [0021](0021-new-chat-worktree-base-branch.md) | 新对话的 worktree 在首次发送时从所选分支创建 | accepted | not-started |
| [0022](0022-project-removal-preserves-sessions.md) | 删除项目保留会话，局部替代 ADR 0020 的删除条款 | accepted | not-started |
