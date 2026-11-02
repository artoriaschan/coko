---
kind: evidence
description: "新对话基础分支 worktree 的首次发送、失败回滚与草稿菜单验收。"
lifecycle: active
---

# 新建工作树首次发送验证

## 验证对象

[票 21](../issues/21-new-worktree-first-send.md)、[规格](../spec.md) DEST-07 / GIT-03 / CW-37 / CW-65、[ADR 0021](../../../docs/adr/0021-new-chat-worktree-base-branch.md)。基线 `e8e918e2`，分支 `codex/cw-21-new-worktree`，交付前合入最新集成分支。环境为 macOS、真实 Electron Sidecar / SQLite / Git、Browser Mode Chromium（1280 × 960，亮暗主题）与后台真实 Electron；Git 使用独立临时 HOME，模型边界为 faux。

## 执行记录

| 精确命令 | 实际范围与数量 | 结果 |
| --- | --- | --- |
| `rtk pnpm run test tests/integration/sidecar-first-send-worktree.test.ts` | 3 例：最新基础提交、自动命名、源检出与文件不变、bash cwd、并发及重启去重；缺失基础分支不改 exclude / 不建目录和记录；Hook 与模型校验失败清理（含未合并基础分支）；Hook 写入后保留 worktree | 通过 |
| `rtk pnpm run test apps/desktop/src/renderer/features/conversation/branches.browser.test.tsx` | 4 例：亮暗主题原有分支交互、基础分支不检出、开关禁用 / 草稿 / 隐藏创建入口 / 关闭及归属清理 | 通过 |
| `rtk pnpm run test apps/desktop/e2e/first-send-worktree.e2e.test.ts` | 1 例：当次 Forge 构建，真实 Electron 菜单开启、选择 feature、首次发送，磁盘目录、基础提交、bash cwd 和原检出读回 | 通过 |
| `rtk pnpm run test apps/server/src/application/worktrees.test.ts tests/integration/sidecar-first-send.test.ts tests/integration/sidecar-worktrees.test.ts apps/desktop/src/renderer/stores/chat-store.test.ts` | 4 文件 60 例：既有 worktree / 首次发送 / 草稿回归 | 通过 |
| `rtk pnpm run test packages/ui/src/guards/style-guard.test.ts apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx` | 2 文件 46 例：样式守卫与新对话归属、失败和草稿回归 | 通过 |
| `rtk pnpm run typecheck` | 根 tsc -b | 通过 |
| `rtk pnpm run check:docs` | 正式与任务文档 | 通过 |
| `rtk pnpm exec oxlint`（全部 12 个改动 TS / TSX 文件） | 目标源代码与测试 | 通过 |
| `rtk proxy /Users/chenzheng/.agents/skills/impeccable/scripts/impeccable detect --json apps/desktop/src/renderer/features/conversation/destination-bar.tsx` | 目标界面 | 通过：[] |

首个 Sidecar 用例修改前因协议拒绝新字段（400 ≠ 201）失败。回滚用例发现 git branch -d 无法移除未合并基础分支派生的分支，改成带期望 baseCommit 的 update-ref -d 比较删除后通过。浏览器用例修改前因不存在 switch 失败，接入后通过。git、目录、Session 持久化、Hook、提交与运行目录均为真实实现。

浏览器截图 `.vitest/cw21-toggle.png` 已人工读回：开关位于分支前，标签与基础分支无错位或遮挡；既有分支用例另产生亮暗主题截图。截图仅为本地运行产物。

## 文档影响与读回

Worktree 记录基础分支、首次发送、失败边界与提交比较删除；工作台、docs README、ADR 0021 与 ADR 索引同步，implementation 为 implemented。正式正文只链接当前代码、测试或正式文档，不反向依赖 scratch。消费者搜索覆盖 docs、任务材料与 .agents；旧“首次发送待接入”、当前 git branch -d 说明均已更新，历史票保留原结论。

从 AGENTS → docs README → Worktree / 工作台 → ADR 0021 与索引读回：路径引用、语义同步、归属权威、引用方向、生命周期、当前入口、新会话读入、历史保留均通过；无迁移或归档材料。

## 结论与限制

本票的 Sidecar、Browser Mode 与真实 Electron 验收有证据；未运行全仓测试、真实模型、CI、发布构建矩阵。本地提交，无推送或 PR。
