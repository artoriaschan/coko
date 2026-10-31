---
kind: reference
description: "当前的 Worktree 契约：在仓库根的 .coko-worktrees/<name> 创建 git worktree 与分支 coko/<name>，Session 创建时绑定、工作目录固定（Workspace 为仓库子目录时为对应子目录），宿主执行 git（argv、无提示、超时、登记 kind git），info/exclude，符号链接检查，移除的 busy / dirty 检查与只读会话，启动恢复，供子代理的 createForSubagent / removeIfUnchanged，HTTP 接口与侧栏界面。修改 worktree 的创建、绑定、移除或 git 执行前查阅。"
lifecycle: active
---

# Worktree

本文说明 Coko 当前如何让一个 Session 在 git worktree 中工作，使并行的会话互不改动同一个目录。长期决定见 [ADR 0016](../adr/0016-session-cwd-fixed-worktrees.md)；子进程登记见 [命令执行与子进程登记](execution.md)；权限判定与可写根见 [权限判定与审批](permissions.md)。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `apps/server/src/adapters/git.ts` | `createGitRunner`：以 argv 运行系统 git，独立进程组，登记 kind `git`，超时终止 |
| `apps/server/src/application/worktrees.ts` | `WorktreeService`：创建、列表、移除、`createForSubagent`、`removeIfUnchanged`、`gitStatus`、启动恢复；`cwd` 为 `SessionCwd` 的 worktree 实现 |
| `apps/server/src/http/routes/worktrees.ts` | HTTP 接口 |
| `packages/protocol/src/worktrees.ts` | `Worktree`、`SessionWorktree`、`CreateWorktreeRequest`、`GitStatusResponse`、`WorktreeBusyDetails`、`WorktreeDirtyDetails`、`worktreePaths` |
| `packages/session` | `worktrees` 表与仓库；`sessions.worktree_id`（迁移 v8） |
| `apps/desktop/src/renderer/stores/worktrees-store.ts` | renderer 的 worktree 列表、新建会话与移除 |
| `apps/desktop/src/renderer/features/sidebar/worktrees.tsx`、`features/conversation/worktree-chip.tsx` | Workspace 菜单与对话框、分支 chip、只读提示 |

Worktree 没有自己的 Session Entry kind，也没有模型可调用的工具。

## 创建

`POST /api/workspaces/:id/worktrees { name? }` → 201 `Worktree { id, workspaceId, name, path, branch, baseCommit, status, createdBy, sessionCount }`。按顺序：

1. Workspace 不存在 404。`git rev-parse --show-toplevel` 取仓库根；Workspace 目录不存在或不在 git 仓库中 400 `not-a-git-repo`。
2. `name` 给出时校验：小写字母、数字、`.`、`_`、`-`，以字母或数字开头，至多 64 个字符，不含 `..`，不以 `.` 或 `.lock` 结尾；否则 400 `invalid-name`。省略时生成 `wt-<6 位十六进制>`。
3. 安全位置：git 报告的仓库根的真实路径必须与报告相同（祖先没有经过符号链接）；`<仓库根>/.coko-worktrees` 不存在时创建；存在时不能是符号链接、必须是目录、真实路径必须就是它自己。否则 400 `unsafe-worktree-path`，不写任何文件、不建分支。
4. 分支 `coko/<name>` 或目录 `.coko-worktrees/<name>` 已存在：用户给出的名字 409 `worktree-exists`；生成的名字换一个后重试。
5. 向 `git rev-parse --git-common-dir` 的 `info/exclude` 追加 `/.coko-worktrees/`（已有这一行时不追加）。
6. `git worktree add -b coko/<name> <path> HEAD`（不复制未提交的改动），记录 `base_commit`（worktree 的 HEAD）。

同一仓库的创建、移除与 `removeIfUnchanged` 串行执行。

## 会话绑定与工作目录

`POST /api/sessions { workspaceId, worktreeId }` 绑定同一 Workspace 的 worktree（其他 Workspace 的 400）；Session DTO 带 `worktree { id, name, branch, status }`。工作目录在创建时确定，之后不变：worktree 路径加上 Workspace 相对仓库根的路径（Workspace 为仓库子目录 `pkg` 时为 `.coko-worktrees/<name>/pkg`）。

工作目录是该会话的 Workspace 根：bash 的 cwd、文件工具的相对路径、可写根与 Seatbelt 的可写根、指令文件、项目设置与 Skills 都从它推导。`.coko-worktrees` 不是受保护路径（受保护的是路径段 `.coko`），worktree 根的 `.git` 文件仍受保护。主 checkout 在 worktree 会话的工作目录之外：读取它须审批（绝对路径与 `../..` 相同）。

父 Workspace 的会话：`info/exclude` 使内置 grep / find 与 ripgrep 都不进入 `.coko-worktrees`，`git status` 也不列出它；`ls` 只列一层，根下显示该目录本身。

## 移除与只读

`DELETE /api/worktrees/:id` → 204。按顺序：

1. 绑定的会话（含子 Session）有进行中的 Run（子 Session 记为 `agent`）、running 的后台任务或 active 的定时任务：409 `worktree-busy { reasons }`，`reasons` 为 `run` / `agent` / `job` / `schedule` 的集合。
2. `git status --porcelain --untracked-files=all` 非空：409 `worktree-dirty { files, count }`（`files` 至多 200 个），不改动任何文件。被忽略的文件不算改动，移除时随目录删除。
3. `git worktree remove <path>`（不加 `--force`），分支保留，记录标为 `removed`。目录已不存在时只 `git worktree prune` 并标记。已是 removed 时 204。

绑定 removed worktree 的会话：开始任何 Run（提交、重试、继续、Goal Round 等）409 `worktree-removed`；条目、详情与列表照常读取。启动恢复把路径已不存在的 active worktree 标为 removed。

## 供子代理

- `createForSubagent(workspaceId, sessionId)`：名字为 `agent-<子 Session id 的前 8 个字母数字>`，冲突时加后缀，`createdBy: subagent`。
- `removeIfUnchanged(id)`：HEAD 仍为 `base_commit` 且没有未提交与未跟踪的文件时 `git worktree remove` 与 `git branch -d`，返回 `{ removed: true }`；否则保留，返回 `{ removed: false, path, branch }`。

子代理的 `isolation: 'worktree'` 经这两个方法创建与清理，见 [子代理](subagents.md#isolation-worktree)。

## git 执行

`createGitRunner` 以 argv 运行系统 `git`（经 `PATH` 解析，不经 shell）：环境为 Sidecar 环境剔除 `HOST_ENV_EXCLUSIONS`（与 bash 相同），再设 `GIT_TERMINAL_PROMPT=0`、`LC_ALL=C`；独立进程组，登记为 kind `git`（命令为 `git <参数>`，按值脱敏后入库），结束后删除。超时缺省 60 秒：对进程组 SIGTERM，2 秒后 SIGKILL，以 `GitTimeoutError` 失败。日志只记子命令、退出码、时长与输出字节数，不记参数与输出文本。

## HTTP 接口

| 接口 | 结果 |
| --- | --- |
| `GET /api/workspaces/:id/worktrees` | `Worktree[]`（含 removed，按创建顺序；`sessionCount` 为绑定的会话数） |
| `POST /api/workspaces/:id/worktrees` | 见 [创建](#创建) |
| `DELETE /api/worktrees/:id` | 见 [移除与只读](#移除与只读)；不存在 404 |
| `GET /api/sessions/:id/git-status` | `{ repo, branch?, dirtyFiles }`：会话工作目录的分支与未提交文件数；不在 git 仓库中或 worktree 已移除时 `repo: false` |

## 界面

- 侧栏 Workspace 组标题的"更多操作"菜单：在新 worktree 中新建会话（对话框，名称可选；校验失败在对话框内提示），worktree…（列表：名称、分支、会话数、移除）。
- 移除先确认；busy 时显示原因，dirty 时显示文件数与文件列表，原因来自 409 的 details（按 schema 校验，不合格的按普通失败提示）。
- 绑定 worktree 的会话在侧栏会话行与标题栏显示分支 chip；worktree 已移除时 chip 加删除线，输入区换成只读提示。

会话创建的唯一入口（`SessionService.createRecord`：新建、子代理、交接）拒绝绑定已移除的 worktree（409 `worktree-removed`）。worktree 会话的项目 deny / ask 规则、启动恢复的结果探测、回退的边界与 MCP 连接（池键含工作目录）都按会话的工作目录；批准与 Workspace 作用域规则仍按 Workspace。

## 已知限制

- 上下文用量接口（`GET /api/sessions/:id/context`）仍按 Workspace 目录取作用域，worktree 会话的用量分项可能来自主 checkout 的指令文件。
- 在新 worktree 中新建的会话没有标题，显示为"未命名"。

## 验证与相关设计

- `tests/integration/sidecar-worktrees.test.ts`：创建、exclude、校验、重名；bash `pwd -P`、write、Seatbelt、指令文件、子目录 Workspace；grep / find / ls（内置与 ripgrep）；busy / dirty / removed、重启标记；读取主 checkout 须审批与 `.coko-worktrees` 为符号链接时拒绝。
- `apps/server/src/application/worktrees.test.ts`：`removeIfUnchanged`、名字校验、仓库根经符号链接、子目录工作目录、启动恢复。
- `apps/server/src/adapters/git.test.ts`：argv、环境、登记与超时终止。
- `apps/desktop/e2e/worktrees.e2e.test.ts`：侧栏菜单（键盘）、分支 chip、dirty 提示、移除后只读、明暗主题对比度。
