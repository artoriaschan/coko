# 04: Worktree：创建与会话绑定、工作目录、git 执行、移除与侧栏入口

**What to build:** 见 [规格](../spec.md)"Worktree"与 [ADR 0016](../../../docs/adr/0016-session-cwd-fixed-worktrees.md)：`adapters/git.ts`（argv、无提示、超时、登记 kind git）；`WorktreeService`（创建：仓库根、name 校验、符号链接与真实路径检查、exclude、`git worktree add -b coko/<name>`；移除：busy / dirty 检查、`git worktree remove`、分支保留；启动恢复标 removed；供子代理的 `createForSubagent` 与 `removeIfUnchanged`）；`SessionCwd` 的 worktree 实现（含 Workspace 为仓库子目录）；会话创建绑定 `worktreeId`、DTO 字段、removed 时提交 409；`GET /api/sessions/:id/git-status`；侧栏"在新 worktree 中新建会话"、分支 chip、worktree 列表与移除、只读提示。

**User stories:** 19

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `apps/server/src/application/worktrees.ts`、`adapters/git.ts`、`http/routes/worktrees.ts`、`packages/protocol/src/worktrees.ts`、`apps/server/src/application/session-cwd.ts`（若 02 将 `SessionCwd` 放在独立文件；否则在 Comments 说明位置）、`packages/i18n/src/dictionaries/domains/worktrees.ts`、renderer `features/sidebar/`、`features/conversation/{conversation-pane,worktree-chip}.tsx`、`stores/worktrees-store.ts`（新）、就近测试、`tests/integration/sidecar-worktrees.test.ts`（新）、`apps/desktop/e2e/worktrees.e2e.test.ts`（新）、`docs/subsystems/worktrees.md`（新）、`docs/TECH_STACK.md`（系统 git 一行）、`docs/adr/0016-session-cwd-fixed-worktrees.md`

- [ ] 集成（git 夹具）：创建后 `git worktree list` 含该路径、分支 `coko/<name>`、`.git/info/exclude` 含 `/.coko-worktrees/`（只追加一次）；非 git 400；非法 name 400；重名 409
- [ ] 集成：绑定 worktree 的会话中 bash `pwd -P` 为 worktree 路径（Workspace 为仓库子目录时为对应子目录）、write 落在 worktree 内、不被当作受保护路径（default 模式下 accept-edits 免审批写入成功、Seatbelt 允许）；指令文件读取 worktree 中的版本
- [ ] 集成：父 Workspace 会话的 grep / find / ls 不列出 `.coko-worktrees` 下的文件（内置 grep 与 ripgrep 两种实现都断言）
- [ ] 集成：移除——绑定会话有 running Job 时 409 `worktree-busy`；有未提交文件时 409 `worktree-dirty { files }` 且文件逐字节不变；干净时移除、分支仍在、会话提交 409 `worktree-removed`、读取照常；外部删除目录后重启标为 removed
- [ ] `removeIfUnchanged`：HEAD = base 且干净时目录与分支都删除；有新提交或未提交改动时都保留（单元或集成测试，供票 07）
- [ ] **对手用例（沙箱 / 权限）**：`.coko-worktrees` 是指向仓库外的符号链接、或其祖先是符号链接时 400 `unsafe-worktree-path` 且外部目录没有新文件；worktree 会话读取主 checkout 中的文件产生 approval_request（`outside-workspace`）；name 为 `../x`、`a/b`、大写或超长时 400
- [ ] git 进程登记为 kind git 并在结束后删除；超时用例（假的 git 可执行文件，经 `PATH` 只在测试中替换）在 60 秒上限内被终止（可用测试注入的较短超时）
- [ ] E2E：侧栏菜单在新 worktree 中新建会话、分支 chip 出现在会话行与标题栏、移除的确认与 dirty 提示、移除后的只读提示；明暗主题
- [ ] 秘密总闸：不适用新通道（git 输出只记摘要日志，Comments 写明）；符号链接用例见上
- [ ] worktrees.md 建立并可达；TECH_STACK 记系统 git；ADR 0016 补本票证据（0012 的证据行写进 Comments）；`check:docs` 通过

## Comments
