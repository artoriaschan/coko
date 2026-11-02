---
kind: reference
description: "当前的 Worktree 契约：在仓库根的 .coko-worktrees/<name> 创建 git worktree 与分支 coko/<name>，支持基础分支与新对话首次发送回滚，Session 创建时绑定、工作目录固定（Workspace 为仓库子目录时为对应子目录），宿主执行 git（argv、无提示、超时、登记 kind git），info/exclude，符号链接检查，移除的 busy / dirty 检查与只读会话，启动恢复，供子代理的 createForSubagent / removeIfUnchanged，HTTP 接口与会话界面。修改 worktree 的创建、绑定、移除或 git 执行前查阅。"
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
| `apps/desktop/src/renderer/features/conversation/worktree-chip.tsx` | 标题栏分支 chip、只读提示 |

Worktree 没有自己的 Session Entry kind，也没有模型可调用的工具。

## 创建

`POST /api/workspaces/:id/worktrees { name?, baseBranch? }` → 201 `Worktree { id, workspaceId, name, path, branch, baseCommit, status, createdBy, sessionCount }`。按顺序：

1. Workspace 不存在 404。`git rev-parse --show-toplevel` 取仓库根；Workspace 目录不存在或不在 git 仓库中 400 `not-a-git-repo`。
2. `name` 给出时校验：小写字母、数字、`.`、`_`、`-`，以字母或数字开头，至多 64 个字符，不含 `..`，不以 `.` 或 `.lock` 结尾；否则 400 `invalid-name`。省略时生成 `wt-<6 位十六进制>`。
3. `baseBranch` 给出时只接受合法的本地分支名，先解析 `refs/heads/<分支>^{commit}`，不存在时 400 `bad-request`；解析失败不创建目录、分支或记录，也不修改 exclude。省略时从当前 HEAD 创建，交接与子代理继续使用此缺省行为。
4. 安全位置：git 报告的仓库根的真实路径必须与报告相同（祖先没有经过符号链接）；`<仓库根>/.coko-worktrees` 不存在时创建；存在时不能是符号链接、必须是目录、真实路径必须就是它自己。否则 400 `unsafe-worktree-path`，不写任何文件、不建分支。
5. 分支 `coko/<name>` 或目录 `.coko-worktrees/<name>` 已存在：用户给出的名字 409 `worktree-exists`；生成的名字换一个后重试。
6. 向 `git rev-parse --git-common-dir` 的 `info/exclude` 追加 `/.coko-worktrees/`（已有这一行时不追加）。
7. `git worktree add -b coko/<name> <path> <基础提交或 HEAD>`（不复制未提交的改动），记录 `base_commit`（worktree 的 HEAD）。

同一仓库的创建、移除与 `removeIfUnchanged` 串行执行。

## 新对话首次发送

归属栏的项目配置菜单在“分支”前提供“新建工作树”开关。没有项目、主要文件夹非 Git 仓库或 Git 不可用时禁用；读取分支、检出或发送期间同样不可操作。开关和基础分支随单份新对话草稿持久化，修改开关只更新本地配置；关闭开关清空基础分支，清除归属、切换项目或从独立对话入口新建时清空 worktree 配置。开启时分支子菜单缺省回显主要文件夹的当前分支，选择只更新基础分支，隐藏“创建并检出新分支…”。

`POST /api/chats/first-send` 接受 `newWorktree?: boolean` 与 `baseBranch?: string`。开启时必须有有效项目，服务端以项目的 `primaryWorkspaceId` 创建自动命名的 `wt-<6 位十六进制>` worktree 和 `coko/<name>` 分支；在发送时解析所选基础分支的最新提交，源 checkout 的分支、文件和未提交改动不变。未选基础分支时使用当前 HEAD。随后创建绑定该 worktree 的 Session，并按原首次发送边界等待首条用户消息持久化；保留项目归属、模型、权限模式、图片和同草稿并发与重启去重行为。

首条消息被接受前发生模型校验失败、UserPromptSubmit Hook 拒绝等错误时，删除新建 Session，并调用 `removeIfUnchanged` 清理刚创建且仍然干净、没有新提交的 worktree 及分支；Hook 已经修改文件或产生提交时保留它们。首条消息已接受后的模型错误保留 Session 和 worktree。这个回滚例外及基础分支语义见 [ADR 0021](../adr/0021-new-chat-worktree-base-branch.md)。

验证：[真实 Sidecar 首次发送与回滚](../../tests/integration/sidecar-first-send-worktree.test.ts)、[浏览器开关与草稿](../../apps/desktop/src/renderer/features/conversation/branches.browser.test.tsx)、[真实 Electron 菜单到运行目录](../../apps/desktop/e2e/first-send-worktree.e2e.test.ts)。

## 会话绑定与工作目录

`POST /api/sessions { workspaceId, worktreeId }` 绑定同一 Workspace 的 worktree（其他 Workspace 的 400）；Session DTO 带 `worktree { id, name, branch, status }`。工作目录在创建时确定，之后不变：worktree 路径加上 Workspace 相对仓库根的路径（Workspace 为仓库子目录 `pkg` 时为 `.coko-worktrees/<name>/pkg`）。

工作目录固定为该会话的 cwd：bash 的 cwd、文件工具的相对路径、指令文件、项目设置与 Skills 都从它推导。每个 Run 的 Workspace 根集合还可以包含当前项目的其他源文件夹，读取、文件写入与 Seatbelt 共用该快照，见[权限范围](permissions.md#每个-run-的-workspace-根)。`.coko-worktrees` 不是受保护路径（受保护的是路径段 `.coko`），worktree 根的 `.git` 文件仍受保护。主 checkout 在 worktree 会话的工作目录之外：读取它须审批（绝对路径与 `../..` 相同）。来源仓库记录决定排除范围，不根据当前项目主要文件夹猜测；移动项目、更换主要文件夹，或附加包含主检出的祖先/后代目录，都不会把来源主检出加入根集合。

父 Workspace 的会话：`info/exclude` 使内置 grep / find 与 ripgrep 都不进入 `.coko-worktrees`，`git status` 也不列出它；`ls` 只列一层，根下显示该目录本身。

## 移除与只读

`DELETE /api/worktrees/:id` → 204。按顺序：

移除在同一仓库的锁内先登记该 worktree 为"移除中"，再做下列检查；登记期间会话工作目录的解析（开始 Run、作用域）为 409 `worktree-busy`，因此检查之后、git 之前提交的消息不会开始 Run。移除结束或失败（含 git 失败）时撤销登记。

1. 绑定的会话（含子 Session）有进行中的 Run（子 Session 记为 `agent`）、running 的后台任务或 active 的定时任务：409 `worktree-busy { reasons }`，`reasons` 为 `run` / `agent` / `job` / `schedule` 的集合。
2. `git status --porcelain --untracked-files=all` 非空：409 `worktree-dirty { files, count }`（`files` 至多 200 个），不改动任何文件。被忽略的文件不算改动，移除时随目录删除。
3. `git worktree remove <path>`（不加 `--force`），分支保留，记录标为 `removed`。目录已不存在时只 `git worktree prune` 并标记。已是 removed 时 204。

绑定 removed worktree 的会话：开始任何 Run（提交、重试、继续、Goal Round 等）409 `worktree-removed`；条目、详情与列表照常读取。启动恢复把路径已不存在的 active worktree 标为 removed。

## 供子代理

- `createForSubagent(workspaceId, sessionId)`：名字为 `agent-<子 Session id 的前 8 个字母数字>`，冲突时加后缀，`createdBy: subagent`。
- `removeIfUnchanged(id)`：HEAD 仍为 `base_commit` 且没有未提交与未跟踪的文件时 `git worktree remove` 与 `git update-ref -d refs/heads/<分支> <base_commit>`（按提交比较后删除，不依赖基础分支是否已合并，并拒绝删除后来改变的引用），返回 `{ removed: true }`；否则保留，返回 `{ removed: false, path, branch }`。

子代理的 `isolation: 'worktree'` 经这两个方法创建与清理，见 [子代理](subagents.md#isolation-worktree)。

## git 执行

`createGitRunner` 以 argv 运行系统 `git`（经 `PATH` 解析，不经 shell）：环境为 Sidecar 环境剔除 `HOST_ENV_EXCLUSIONS`（与 bash 相同），再设 `GIT_TERMINAL_PROMPT=0`、`LC_ALL=C`；独立进程组，登记为 kind `git`（命令为 `git <参数>`，按值脱敏后入库），结束后删除。超时缺省 60 秒：对进程组 SIGTERM，2 秒后 SIGKILL，以 `GitTimeoutError` 失败。日志只记子命令、退出码、时长与输出字节数，不记参数与输出文本。

## 项目分支

[BranchService](../../apps/server/src/application/branches.ts) 通过项目的 `primaryWorkspaceId` 解析主要文件夹，不依赖文件夹显示顺序。`GET /api/projects/:id/branches` 返回 `{ available, reason?, current?, branches }`；只列本地 `refs/heads`，当前分支在前，其余按最近提交时间排序。主要文件夹非 Git 仓库或 Git 不可用时返回可解释的不可用状态。

`POST /api/projects/:id/branches { name, create? }` 在主要文件夹立即切换；`create: true` 从当前 HEAD 创建并检出。名称先按 Git 引用名规则校验，再由宿主 `git check-ref-format --branch` 核验；拒绝前导 `-`、`HEAD`、非法引用，不经过 shell。普通切换只接受已存在的本地分支且不猜测远端；创建遇到同名分支为 `already-exists`，不会重置引用，也不强制切换。

切换按仓库根串行，主要文件夹的目录准入屏障覆盖忙碌检查、dirty 检查到 Git 完成。任何工作目录正好是主要文件夹的根或子 Session 有进行中 Run、后台任务或启用的定时任务时，返回 `session-busy { reasons, sessions }`；归属已改变也不绕过固定 cwd。后到的 Run 在真正启动前同步检查目录屏障，失败或成功后解除。仓库有未提交或未跟踪文件时返回 `git-dirty { files, count }`，与 `worktree-dirty` 使用相同的文件上限；两种拒绝均保留原分支和文件。

全局设置 `git.branchPrefix` 默认为空字符串，沿用设置 revision 的乐观并发，只接受字符串。该前缀只预填用户创建分支的名称，不改变 worktree 的 `coko/<name>` 命名。

验证：[Sidecar 分支协议](../../tests/integration/sidecar-branches.test.ts)、[目录准入与失败释放](../../apps/server/src/application/branches.test.ts)、[真实 Electron 前缀与检出](../../apps/desktop/e2e/branches.e2e.test.ts)。

## HTTP 接口

| 接口 | 结果 |
| --- | --- |
| `GET /api/workspaces/:id/worktrees` | `Worktree[]`（含 removed，按创建顺序；`sessionCount` 为绑定的会话数） |
| `POST /api/workspaces/:id/worktrees` | 见 [创建](#创建) |
| `DELETE /api/worktrees/:id` | 见 [移除与只读](#移除与只读)；不存在 404 |
| `GET /api/sessions/:id/git-status` | `{ repo, branch?, dirtyFiles }`：会话工作目录的分支与未提交文件数；不在 git 仓库中或 worktree 已移除时 `repo: false` |

## 界面

- 侧栏按项目组织会话，不再提供 worktree 列表、创建与移除入口，也不在会话行显示分支 chip。
- 绑定 worktree 的已有会话继续在标题栏显示分支 chip；worktree 已移除时 chip 加删除线，输入区换成只读提示。
- worktree 的创建、列表与移除协议仍可用，交接与子代理继续使用原有服务。新对话通过归属栏开关在首次发送时创建 worktree。

会话创建的唯一入口（`SessionService.createRecord`：新建、子代理、交接）拒绝绑定已移除的 worktree（409 `worktree-removed`）。worktree 会话的项目 deny / ask 规则、启动恢复的结果探测、回退的边界、上下文用量（`GET /api/sessions/:id/context` 的指令、Skills 分项）与 MCP 连接（池键含工作目录）都按会话的工作目录；批准与 Workspace 作用域规则仍按 Workspace。

## 已知限制

- 工作台不提供 worktree 列表与移除入口；外部移除后通过启动恢复标记只读。

## 验证与相关设计

- [项目根 Sidecar 用例](../../tests/integration/sidecar-project-permissions.test.ts)：worktree 移入另一项目后仍保持 cwd 和来源主检出隔离，重叠附加根不能扩大范围；darwin 上经批准的受限命令也不能改主检出。

- `tests/integration/sidecar-worktrees.test.ts`：创建、exclude、校验、重名；bash `pwd -P`、write、Seatbelt、指令文件、子目录 Workspace；grep / find / ls（内置与 ripgrep）；busy / dirty / removed、重启标记；读取主 checkout 须审批与 `.coko-worktrees` 为符号链接时拒绝。
- `apps/server/src/application/worktrees.test.ts`：`removeIfUnchanged`、名字校验、仓库根经符号链接、子目录工作目录、启动恢复。
- `apps/server/src/adapters/git.test.ts`：argv、环境、登记与超时终止。
- `tests/integration/sidecar-first-send-worktree.test.ts`：所选分支最新提交、自动命名、源文件与分支不变、运行 cwd、并发与重启去重、Hook 与模型校验失败清理、缺失基础分支不留痕迹，以及修改过的 worktree 保留。
- `apps/desktop/src/renderer/features/conversation/branches.browser.test.tsx`：草稿开关、基础分支选择、隐藏创建入口与草稿清理；`apps/desktop/e2e/first-send-worktree.e2e.test.ts`：真实 Electron 从菜单配置到首次发送和磁盘工作目录。
