---
kind: evidence
description: "17 个任务工作树的最终清理、测试产物归档与保留分支。"
lifecycle: active
---

# 最终工作树清理

2026-11-04，本任务创建的 **17 个临时工作树均已移除**，不包含用户原 main 与集成 checkout。此前 16 个的逐项审计见 [历史审计](cleanup-completed.json) 与 [回执](cleanup-completed.md)；本轮补齐 review-fix 后的完整合并记录见 [最终机器审计](cleanup-final.json)。

review-fix 在移除前实时核对：HEAD 为 `28f9b22ab4160cb56682e686c5b1cb9f56d9bb59`，是集成祖先，tracked/untracked status 为空；ignored 只有已知依赖、构建与缓存。`ps` 完整命令及 `lsof` cwd 审计均无其所属进程，未停止任何进程。28 个 `.vitest` 文件共 897,597 bytes 先归档并逐文件 SHA-256 读回校验，再移除工作树；归档为仓库外 `/tmp/coko-conversation-detail/worktree-backups/review-fix-vitest.tar.gz`，archive SHA-256 为 `4fd96c687d637e286828382ac053ed4b42ebb9c23d92b2b02a35be52a93d5a44`。已知 node_modules、dist/out、类型构建缓存及 Husky 生成目录随后随工作树丢弃。

前后共归档 347 个测试产物、14,074,136 bytes，仓库外备份仍保留。16 个已合并临时分支均以普通 `git branch -d` 删除；重开诊断原分支 `codex/conversation-detail-reopen-diagnosis` 保留提交 `1b6d4070`，其 stable patch ID 与已合入 `f9e34e87` 相同，两个改动源码文件相等，不丢弃该历史。

最终仅保留：

- 原 main checkout `/Users/artorias_chan/Workspaces/person/coko`，main 仍为 `6e57ed0a7605996ec96173c897b1546c57ed42aa`。
- 集成 checkout `/Users/artorias_chan/.codex/worktrees/0898/coko`，分支 `codex/conversation-detail`。

外部参考仓库、参考 harness、原始日志备份、诊断笔记、用户原有应用与数据均保留。这里只清理任务临时资源；没有推送、合并 main 或发布。
