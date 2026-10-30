---
kind: decision
description: "Session 的工作目录（Workspace 或其某个 git worktree）在创建时固定、之后不变；worktree 放在仓库根的 .coko-worktrees/<name>、分支 coko/<name>，由宿主以 argv 执行 git，只在干净且无运行中工作时由用户移除，分支保留。修改 Session 与目录的绑定、worktree 的位置、创建或清理时回看。"
status: accepted
implementation: implemented
lifecycle: active
category: architecture
---

# Session 的工作目录创建时固定，worktree 只在干净时移除

## 上下文

M5 让 Session 在 git worktree 中工作，使并行的会话与子代理互不干扰。当前每个 Session 的工作目录就是其 Workspace 的目录，权限判定、命令沙箱的可写根、指令文件与项目设置都从它推导，Checkpoint 记录的是该目录下的路径。参考项目的做法：claude-code 的 EnterWorktree 把当前会话切换到 `.claude/worktrees/<slug>`（分支 `worktree-<slug>`，以 `-B` 重置同名分支），子代理的隔离 worktree 没有改动时自动删除；deepseek-harness 的实验包在 `<checkout>/.agents/worktrees/<name>` 创建并进入，离开时保留。

Coko 的 `.coko` 是受保护路径，命令沙箱在可写根下拒绝写入它。用户于 2026-10-28 的常设指示要求讨论问题采用推荐方案并优先沿用参考项目；本决定于 2026-10-31 规划 M5 时按该指示采纳，未经用户逐条确认。

## 决定

- **创建时固定。** Session 在创建时绑定 Workspace 本身或其某个 worktree，之后工作目录不变；没有中途进入或离开 worktree 的操作。在另一个 worktree 中继续工作是新建会话或交接到新会话。
- **位置与分支。** worktree 在仓库根的 `.coko-worktrees/<name>`，分支 `coko/<name>`，从源 checkout 的当前提交创建，不复制未提交的改动；分支已存在时报错，不重置。首次创建时把该目录写入仓库本地的 `.git/info/exclude`。目录或其祖先是符号链接、或真实路径不在仓库根下时拒绝创建。
- **宿主执行 git。** server 以 argv 运行系统 git（不经 shell、不弹凭据提示、有超时），进程登记在进程登记表中；不提供模型可调用的 worktree 工具。
- **清理。** 只由用户移除，且须绑定的会话都没有进行中的 Run、子代理、后台任务或启用的定时任务，worktree 没有未提交或未跟踪的改动；不提供强制删除，分支保留。移除后绑定的会话只读。子代理的隔离 worktree 在子代理结束时没有新提交且干净则自动移除并删除分支，否则保留。

## 理由与备选方案

- **会话中途切换工作目录（claude-code、deepseek-harness）。** 同一 Session 的 Checkpoint 路径、相对路径的权限规则、指令与项目设置的来源会前后不一致，回退与分叉需要知道每条条目当时的目录。固定绑定的代价是"换个 worktree 继续"要多一次交接。
- **放在 `.coko/worktrees`。** 与 Coko 的项目目录同处，但 `.coko` 受保护，worktree 中的每次写入都会被询问并被沙箱拒绝。
- **放在应用数据目录。** 不污染仓库，但用户在编辑器中找不到它，卸载或清理数据时会连同未提交的工作一起删除。
- **自动或强制清理。** 会删除用户未提交的工作；保留分支使已提交的工作总能找回。

## 后果与验证

- 仓库中多出一个被本地排除的目录；父 Session 读取 worktree 中的文件是 Workspace 之外的读取，须审批。M6 的团队成员复用同一机制。依赖本机安装的 git。
- implementation 变为 implemented 前需要：以临时 git 仓库的真实 Sidecar 覆盖创建（分支、exclude、Workspace 为仓库子目录时的工作目录）、worktree 会话的命令与写入落在 worktree 内且不被当作受保护路径、父 Session 的 grep 不列出 worktree 内容、读取另一 checkout 须审批、`.coko-worktrees` 为符号链接时拒绝创建、有未提交改动或运行中工作时移除被拒、移除后会话只读、子代理隔离 worktree 的自动移除与保留。

## 实施记录

- 2026-10-31，worktree 的绑定与移除：创建、会话绑定、工作目录（含 Workspace 为仓库子目录）、exclude、符号链接拒绝、busy / dirty / removed 与启动恢复、宿主 git 执行与侧栏入口已实现，当前行为见 [Worktree](../subsystems/worktrees.md)。证据：`tests/integration/sidecar-worktrees.test.ts`、`apps/server/src/application/worktrees.test.ts`、`apps/server/src/adapters/git.test.ts`、`apps/desktop/e2e/worktrees.e2e.test.ts`。子代理隔离 worktree 的自动移除与保留只有 `removeIfUnchanged` 的单元测试，接入子代理后补齐。
- 2026-10-31，子代理的 isolation worktree：子代理不改文件时 worktree 与分支被移除、有提交时保留并在结果中给出路径与分支、父 Session 读取保留的 worktree 须审批（`.coko-worktrees/` 在 Workspace 之内，由不入库的询问规则保证，重启后重新登记），见 [子代理](../subsystems/subagents.md#isolation-worktree)。证据：`tests/integration/sidecar-subagents-isolation.test.ts`。implementation 改为 implemented。
- 与上文"读取另一 checkout 须审批"一致的实现方式：worktree 会话的 Workspace 根就是其工作目录，主 checkout 的读取按越出 Workspace 处理。

## 来源与后继

- 参考实现：claude-code 社区还原版 `src/utils/worktree.ts`、`packages/builtin-tools/src/tools/EnterWorktreeTool`；deepseek-harness `packages/experimental/worktree`。本页已提炼所需结论。
- 受保护路径与可写根见 [ADR 0005](0005-permission-mode-and-sandbox.md)；进程登记见 [ADR 0012](0012-host-process-registry.md)；Checkpoint 见 [ADR 0006](0006-file-checkpoints-and-rewind.md)。
