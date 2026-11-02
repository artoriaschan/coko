# 21: 新建工作树

**What to build:** 项目配置菜单在“分支”之前加入“新建工作树”开关。开关保存在新对话草稿中，首次发送时才应用，不在后台立即创建。开启时，“分支”表示新 worktree 的基础分支（缺省为当前分支），主要文件夹不切换，“创建并检出新分支…”隐藏。首次发送时，服务端从基础分支的最新提交创建 worktree 与 `coko/<name>` 分支，名称按现有规则自动生成 `wt-<6 位十六进制>`；Session 绑定这个 worktree，工作目录为它。任一步失败或 UserPromptSubmit Hook 拒绝时，删除 Session，并移除未改动的 worktree 与分支。关闭开关、清除归属或从对话分类入口新建对话时，清空工作树草稿。

- 行为依据：[规格](../spec.md) DEST-07、GIT-03（worktree 部分）、17.2 首次发送与 Git；[ADR 0021](../../../docs/adr/0021-new-chat-worktree-base-branch.md)、[ADR 0016](../../../docs/adr/0016-session-cwd-fixed-worktrees.md)。

**User stories:** 56

**Blocked by:** 20

**Status:** ready-for-agent

**Write scope:** apps/server 的 worktree 创建支持指定基础分支（现有接口只能从 HEAD 创建）、首次发送中创建 worktree 与失败清理；packages/protocol 的创建 worktree 请求（可选基础分支）与首次发送请求（新建工作树与基础分支）；renderer 的开关、新对话草稿字段与分支子菜单的基础分支语义；i18n；worktrees.md 的基础分支与首次发送一节。

- [ ] Sidecar 协议（git 夹具，测试使用临时 HOME）：开启时首次发送，worktree 从指定基础分支的最新提交创建，分支为 `coko/wt-` 加 6 位十六进制，主要文件夹的当前分支不变，Session 的工作目录是该 worktree；首次发送被 Hook 拒绝时不留会话，未改动的 worktree 与分支被移除；基础分支不存在时首次发送失败且不留痕迹（CW-65）。
- [ ] Browser Mode：开启后“创建并检出新分支…”隐藏，分支子菜单回显基础分支；只打开开关不发出任何请求；关闭开关与清除归属清空工作树草稿（CW-37）。
- [ ] Electron E2E：开启“新建工作树”后首次发送，worktree 目录存在，会话在其中运行。
- [ ] ADR 0021 的 implementation 改为 implemented 并链接本票与 20 的证据，ADR 索引同步；worktrees.md 更新；`check:docs` 通过。
