# 21: 新建工作树

**What to build:** 项目配置菜单在“分支”之前加入“新建工作树”开关。开关保存在新对话草稿中，首次发送时才应用，不在后台立即创建。开启时，“分支”表示新 worktree 的基础分支（缺省为当前分支），主要文件夹不切换，“创建并检出新分支…”隐藏。首次发送时，服务端从基础分支的最新提交创建 worktree 与 `coko/<name>` 分支，名称按现有规则自动生成 `wt-<6 位十六进制>`；Session 绑定这个 worktree，工作目录为它。任一步失败或 UserPromptSubmit Hook 拒绝时，删除 Session，并移除未改动的 worktree 与分支。关闭开关、清除归属或从对话分类入口新建对话时，清空工作树草稿。

- 行为依据：[规格](../spec.md) DEST-07、GIT-03（worktree 部分）、17.2 首次发送与 Git；[ADR 0021](../../../docs/adr/0021-new-chat-worktree-base-branch.md)、[ADR 0016](../../../docs/adr/0016-session-cwd-fixed-worktrees.md)。

**User stories:** 56

**Blocked by:** 20

**Status:** ready-for-agent

**Write scope:** apps/server 的 worktree 创建支持指定基础分支（现有接口只能从 HEAD 创建）、首次发送中创建 worktree 与失败清理；packages/protocol 的创建 worktree 请求（可选基础分支）与首次发送请求（新建工作树与基础分支）；renderer 的开关、新对话草稿字段与分支子菜单的基础分支语义；i18n；worktrees.md 的基础分支与首次发送一节。

- [x] Sidecar 协议（git 夹具，测试使用临时 HOME）：开启时首次发送，worktree 从指定基础分支的最新提交创建，分支为 `coko/wt-` 加 6 位十六进制，主要文件夹的当前分支不变，Session 的工作目录是该 worktree；首次发送被 Hook 拒绝时不留会话，未改动的 worktree 与分支被移除；基础分支不存在时首次发送失败且不留痕迹（CW-65）。
- [x] Browser Mode：开启后“创建并检出新分支…”隐藏，分支子菜单回显基础分支；只打开开关不发出任何请求；关闭开关与清除归属清空工作树草稿（CW-37）。
- [x] Electron E2E：开启“新建工作树”后首次发送，worktree 目录存在，会话在其中运行。
- [x] ADR 0021 的 implementation 改为 implemented 并链接本票与 20 的证据，ADR 索引同步；worktrees.md 更新；`check:docs` 通过。


## Comments

- 2026-11-03：完成 newWorktree / baseBranch 首次发送与 baseBranch? 创建 worktree 协议。服务端发送时解析项目主要文件夹与基础分支最新提交，创建自动命名 worktree 与绑定 Session，保留既有标题、图片、权限配置、持久化接受边界及草稿去重。交接与子代理省略基础分支仍从 HEAD 创建。
- 失败复用 rollbackFirst + removeIfUnchanged。真实 Git 发现未合并基础分支派生的分支不能被 branch -d 删除，改为 update-ref -d 带创建时 baseCommit 比较删除；保留已修改的 worktree 和分支，避免误删后来改变的引用。缺失基础分支在目录、exclude 与记录写入前失败。
- 项目配置通过 20 的前置插槽接入共享开关，只更新本地草稿；开启时基础分支不检出且隐藏创建分支入口，关闭 / 清除归属 / 独立对话入口清空工作树草稿。
- [精确命令、数量、red/green 和文档读回](../evidence/21-new-worktree-first-send.md)：Sidecar 3 例、分支 Browser 4 例、真实 Electron 1 例、既有回归 60 例、样式与新对话 Browser 46 例通过；类型、文档、lint 与界面 detector 通过。ADR 0021 implemented，索引、Worktree / 工作台 / 总导航已同步；正式 ADR 以当前源码与本票 / 20 所属测试保存证据，不链接 scratch。

- 交付前以 a1b6add1 合入最新集成分支 a9d09dda，无冲突。合入后 8 文件 113 例、重新构建的真实 Electron 1 例、typecheck 和 check:docs（247 文档）均通过。

**Closed:** true
