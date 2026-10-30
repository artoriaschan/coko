# 04: Worktree：创建与会话绑定、工作目录、git 执行、移除与侧栏入口

**What to build:** 见 [规格](../spec.md)"Worktree"与 [ADR 0016](../../../docs/adr/0016-session-cwd-fixed-worktrees.md)：`adapters/git.ts`（argv、无提示、超时、登记 kind git）；`WorktreeService`（创建：仓库根、name 校验、符号链接与真实路径检查、exclude、`git worktree add -b coko/<name>`；移除：busy / dirty 检查、`git worktree remove`、分支保留；启动恢复标 removed；供子代理的 `createForSubagent` 与 `removeIfUnchanged`）；`SessionCwd` 的 worktree 实现（含 Workspace 为仓库子目录）；会话创建绑定 `worktreeId`、DTO 字段、removed 时提交 409；`GET /api/sessions/:id/git-status`；侧栏"在新 worktree 中新建会话"、分支 chip、worktree 列表与移除、只读提示。

**User stories:** 19

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `apps/server/src/application/worktrees.ts`、`adapters/git.ts`、`http/routes/worktrees.ts`、`packages/protocol/src/worktrees.ts`、`apps/server/src/application/session-cwd.ts`（若 02 将 `SessionCwd` 放在独立文件；否则在 Comments 说明位置）、`packages/i18n/src/dictionaries/domains/worktrees.ts`、renderer `features/sidebar/`、`features/conversation/{conversation-pane,worktree-chip}.tsx`、`stores/worktrees-store.ts`（新）、就近测试、`tests/integration/sidecar-worktrees.test.ts`（新）、`apps/desktop/e2e/worktrees.e2e.test.ts`（新）、`docs/subsystems/worktrees.md`（新）、`docs/TECH_STACK.md`（系统 git 一行）、`docs/adr/0016-session-cwd-fixed-worktrees.md`

- [x] 集成（git 夹具）：创建后 `git worktree list` 含该路径、分支 `coko/<name>`、`.git/info/exclude` 含 `/.coko-worktrees/`（只追加一次）；非 git 400；非法 name 400；重名 409
- [x] 集成：绑定 worktree 的会话中 bash `pwd -P` 为 worktree 路径（Workspace 为仓库子目录时为对应子目录）、write 落在 worktree 内、不被当作受保护路径（default 模式下 accept-edits 免审批写入成功、Seatbelt 允许）；指令文件读取 worktree 中的版本
- [x] 集成：父 Workspace 会话的 grep / find / ls 不列出 `.coko-worktrees` 下的文件（内置 grep 与 ripgrep 两种实现都断言）
- [x] 集成：移除——绑定会话有 running Job 时 409 `worktree-busy`；有未提交文件时 409 `worktree-dirty { files }` 且文件逐字节不变；干净时移除、分支仍在、会话提交 409 `worktree-removed`、读取照常；外部删除目录后重启标为 removed
- [x] `removeIfUnchanged`：HEAD = base 且干净时目录与分支都删除；有新提交或未提交改动时都保留（单元或集成测试，供票 07）
- [x] **对手用例（沙箱 / 权限）**：`.coko-worktrees` 是指向仓库外的符号链接、或其祖先是符号链接时 400 `unsafe-worktree-path` 且外部目录没有新文件；worktree 会话读取主 checkout 中的文件产生 approval_request（`outside-workspace`）；name 为 `../x`、`a/b`、大写或超长时 400
- [x] git 进程登记为 kind git 并在结束后删除；超时用例（假的 git 可执行文件，经 `PATH` 只在测试中替换）在 60 秒上限内被终止（可用测试注入的较短超时）
- [x] E2E：侧栏菜单在新 worktree 中新建会话、分支 chip 出现在会话行与标题栏、移除的确认与 dirty 提示、移除后的只读提示；明暗主题
- [x] 秘密总闸：不适用新通道（git 输出只记摘要日志，Comments 写明）；符号链接用例见上
- [x] worktrees.md 建立并可达；TECH_STACK 记系统 git；ADR 0016 补本票证据（0012 的证据行写进 Comments）；`check:docs` 通过

## Comments

### 实施者（票 04）

**提交（m5/04-worktree-binding）：** 1af93aa git 适配器；e99d512 WorktreeService、路由与装配；1ff5308 / 699b53d Sidecar 集成与单元测试；ba76034 renderer（菜单、chip、只读提示、store、i18n）；fe047c8 desktop E2E；4333274 文档；6c20d1f 删除误提交的 `tests/fixtures/git/index.d.ts`（tsc 产物）。

**逐项：**

- 创建：`sidecar-worktrees`「Worktree 创建」——`git worktree list --porcelain` 含路径与 `refs/heads/coko/feat-a`，exclude 中 `/.coko-worktrees/` 恰好一行（第二次创建后），父仓库 `git status` 为空；非 git 400 `not-a-git-repo` 且目录为空；`../x`、`a/b`、`Upper`、65 字符 400 `invalid-name`；重名与已存在的分支 409 `worktree-exists`。
- 工作目录：bash `pwd -P` 为 worktree 路径、子目录 Workspace 为 `<worktree>/pkg`；accept-edits 下 write 免审批并落在 worktree 内（主 checkout 没有该文件）；default 类 bash 经审批后在 Seatbelt 下写 worktree 成功（只在 darwin 运行，`it.skipIf(!darwin)`）；指令 section 含 worktree 的 AGENTS.md，不含主 checkout 的。
- grep / find / ls：内置与 ripgrep 两种都断言（`it.each`）。`ls` 只列一层，根下出现 `.coko-worktrees/` 目录本身，不列其中的文件（与 `.git/` 相同）。
- 移除：running Job 时 409 `{ reasons: ['job'] }`；dirty 时 409 `{ files: ['README.md', 'new/file.bin'], count: 2 }` 且两个文件逐字节不变；干净时 204、目录与 worktree 记录消失、分支仍在、提交 409 `worktree-removed`、详情照常；外部删除目录后重启标为 removed。
- `removeIfUnchanged`：`worktrees.test.ts` 中 HEAD = base 且干净时目录与分支都删；新提交、未跟踪文件、已跟踪文件被修改时都保留。
- 对手用例：`.coko-worktrees` 指向仓库外与指向仓库内其他目录两种都 400 `unsafe-worktree-path`，外部目录为空、没有新分支、exclude 不变；仓库根经符号链接（祖先是链接，单元测试以假的 `rev-parse --show-toplevel` 构造）400 且没有任何文件；worktree 会话以绝对路径与 `../../MAIN-ONLY.txt` 读取主 checkout 都产生 approval_request，拒绝后结果中没有文件内容。approval_request 条目没有 reason 字段，按建议规则为该文件的路径断言（越出 Workspace 的建议形态）。name 的四种非法写法见上。renderer：409 的 details 不合 schema 时不当作可显示的原因（store 单元测试）。
- git 进程：`git.test.ts` 中登记为 kind git（命令 `git status --porcelain`）并在结束后删除；假的 git（经 PATH 只在测试中替换，忽略 SIGTERM）以注入的 1.5 秒时限被终止，进程组不存在，登记删除；缺省时限 60 秒。环境剔除 `HOST_ENV_EXCLUSIONS`（夹具记录中 `COKO_SECRET_TOKEN` 为空）。
- E2E：`worktrees.e2e.test.ts` 键盘打开 Workspace 菜单与新建对话框（非法名称在对话框内报错）、chip 出现在会话行与标题栏、dirty 时确认框列出 `dirty.txt`、清理后移除、只读提示替换输入区；明暗两种主题下两个 chip 与提示文字的对比度 ≥ 4.5（canvas 转 sRGB 计算）。截图已人工查看（亮 / 暗各一张，未提交）。
- 秘密总闸：不新增输出通道。git 的 stdout / stderr 不进响应、条目或模型上下文，日志只记子命令、退出码、时长与字节数；host_processes 的命令文本经 `redactText`。worktree 的读取根就是工作目录，指令文件与 Skills 走已有的读取路径（已有 secrets-gate 覆盖），因此没有新增 `secrets-gate-*.test.ts`。
- 文档：新建 `docs/subsystems/worktrees.md`，`docs/README.md` 当前行为加一行；TECH_STACK 接入状态表加"M5 票 04"一行（系统 git，不新增依赖）；ADR 0016 增加实施记录，`implementation` 改为 `partial`（子代理接入前），`docs/adr/README.md` 的列同步为 partial（规格写的是 07 改 implemented；我认为 not-started 已不准确，请 Lead 裁决是否保留 partial）。`check:docs` 177 文件 0 问题。

**负向确认（变异）：** 去掉仓库根真实路径检查 → 祖先链接用例失败；去掉 HEAD = base 检查 → 新提交用例失败；不写 exclude → grep / find 两种实现的用例都失败；cwd 不按绑定解析 → pwd 用例失败；lstat / 非目录 / 真实路径三项检查一起去掉 → 两个符号链接用例失败（只去 lstat 时由真实路径检查兜底，用例仍通过）；去掉 removed 判断 → 两个移除用例失败。`removeIfUnchanged` 的未提交检查去掉后用例仍通过：`git worktree remove` 不加 `--force` 本身拒绝 dirty 的 worktree（纵深防御，保留）。

**ADR 0012 证据行（请 Lead 合并）：** git 子进程以独立进程组登记为 kind `git`（命令为 `git <参数>` 脱敏后），结束后删除；超时对进程组 SIGTERM、2 秒后 SIGKILL。证据 `apps/server/src/adapters/git.test.ts`。

**越出 Write scope 的改动（请裁决）：**

- `apps/server/src/runtime/layers.ts`（规格为"只有 02 改"）：装配 `WorktreeService({ store, git: createGitRunner({ env, track }), activity })`，并把 `worktrees.cwd` 作为 `SessionService` 的 `cwd`；为打破类型推断环，`worktrees` 与 `sessions` 两个常量加了类型注解。票 03 / 05 很可能也改这个文件（HookService / ScheduleService 的装配），合并时可能有文本冲突，语义上互不影响。
- `SessionCwd` 在 `session-runs.ts` 中定义（02 未拆独立文件），实现在 `application/worktrees.ts` 的 `WorktreeService.cwd`，没有改 `session-runs.ts`。
- 新增就近测试：`apps/server/src/adapters/git.test.ts`、`application/worktrees.test.ts`、`renderer/stores/worktrees-store.test.ts`；renderer 新文件 `features/sidebar/worktrees.tsx`（在 `features/sidebar/` 内）。

**已知限制 / 交给后续票：**

- `POST /api/sessions` 不拒绝绑定 removed 的 worktree（`sessions.ts` / `app.ts` 只有 02 改）；这样的会话从一开始就只读。
- `context-service.ts`（上下文用量）与 `recovery.ts`（结果探测）仍按 Workspace 目录取作用域；`PermissionService` 的项目 deny / ask 规则按 Workspace 目录读取。worktree 会话这几处可能读取主 checkout 的版本，已写进 worktrees.md 的已知限制。
- 在新 worktree 中新建的会话没有标题（显示"未命名"）。
- 子代理（07）接入 `createForSubagent` / `removeIfUnchanged`；Handoff（10）用 `GET /api/sessions/:id/git-status` 与 `WorktreeService.create`。
- `apps/server/README.md` 要点（交给 08 汇总）：新增 `adapters/git.ts`（`createGitRunner`）、`WorktreeService`（`SessionCwd` 的 worktree 实现）、routes/worktrees 的四个接口。

**未验证：** 真实模型（无凭据）；非 darwin 平台（bash / Seatbelt 部分跳过）；系统没有安装 git 的情况。
