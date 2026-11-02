# 17: 附加文件夹的权限范围

**What to build:** 项目内的对话可以读写项目的其他源文件夹。每个 Run 开始时计算本次的 Workspace 根集合：工作目录加上项目的各源文件夹，worktree 会话不含主检出。这个集合同时用于判断读取是否需要审批、写入的判定（按当前权限模式）与 Seatbelt 的可写根；拒绝规则与受保护路径照常生效。于是在项目内新建的会话只多出主要文件夹以外的文件夹，worktree 会话保持 ADR 0016 的隔离，从别处移入的会话包含主要文件夹。指令文件、项目设置、Hook、MCP 与 Skills 仍只从工作目录读取。修改项目的文件夹列表，或把会话移入、移出项目，都从下一个 Run 开始生效；子智能体会话按根会话的归属计算。

- 行为依据：[规格](../spec.md) PROJ-17、17.2 权限范围；[ADR 0005](../../../docs/adr/0005-permission-mode-and-sandbox.md)、[ADR 0016](../../../docs/adr/0016-session-cwd-fixed-worktrees.md)、[ADR 0020](../../../docs/adr/0020-projects-organize-workspaces.md)。这是本规格唯一放宽免审批范围的票。

**User stories:** 26、62

**Blocked by:** 13、16

**Status:** ready-for-agent

**Write scope:** packages/agent 的路径判定与沙箱可写根；apps/server 每个 Run 的根集合计算与 Seatbelt 适配；`docs/subsystems/permissions.md`（Workspace 内的定义）、`docs/subsystems/worktrees.md`（worktree 会话不含主检出）与 projects.md 的权限范围一节。

- [x] Sidecar 协议（default 模式）：读取附加文件夹不询问；写入附加文件夹按模式询问，批准后 bash 能写入该文件夹（Seatbelt，仅 darwin）；受保护路径照常询问；Run 进行中修改文件夹列表，本次 Run 不变，下一个 Run 按新列表（CW-69、CW-70）。
- [x] Sidecar 协议：从别处移入的会话读写主要文件夹时读取不询问、写入按模式询问，工作目录仍是原专属目录（CW-85）；移出项目后，下一个 Run 收回附加文件夹；worktree 会话的根集合不含主检出；子智能体会话与根会话一致。
- [x] 对手用例：附加文件夹内命中拒绝规则的路径仍被拒绝；受保护路径不因位于附加文件夹而免审批；附加文件夹内指向外部的符号链接不扩大读写范围；附加文件夹中的指令文件、项目设置、Hook、MCP 与 Skills 不被加载。
- [x] Seatbelt 相关用例只在 darwin 运行，其他平台显式跳过并说明原因。
- [x] 文档按 Write scope 更新，ADR 0005 与 ADR 0016 的后继说明链接本票的证据；`check:docs` 通过。


**Closed:** true

## Comments

2026-11-03 实施完成（`codex/cw-17-permissions`，基于并合入当前集成 `a9d09dda`，含 13/14/16/18/20）：

- `SessionRuns` 在每个 Run 准入时沿持久化父链取根会话归属，冻结 cwd + 当前项目全部源文件夹的真实路径集合。`RuntimePermissions.workspaceRoots` 将同一份集合交给读取 gate、文件写入与命令 prepare 的 Seatbelt；Skill 的只读根、实时模式与实时规则仍分开。没有改变目录准入、删除屏障、工作目录、配置发现与 Workspace 保存作用域。
- worktree 来源取持久化 worktree.repoRoot，不取当前项目主要文件夹；排除与来源主检出相交的附加根，防止祖先、原根或后代目录重叠重新授予主检出。真实 Sidecar 证明移动项目后原 main checkout 文件仍保持不变，cwd 内写入和新项目主要根、附加根仍可用。
- `sidecar-project-permissions.test.ts` 共 13 例，通过真实 Electron Node Sidecar 协议、模型请求日志、审批和文件事实，覆盖 default 读取免审批与写入询问、accept-edits/read-only/plan、附加根拒绝与 grep 过滤、受保护路径、外向符号链接和批准后交换链接、独立对话移入、Run 中移出及下次收回、子会话根归属、worktree 重叠排除、文件夹编辑的本次旧根/本次拒绝新根/下次新根，以及指令、设置、Hook、MCP、Skills 只从 cwd 发现。请求日志保留 cwd 指令标记，附加根及其嵌套指令标记不进入模型；资源接口均成功返回且无额外资源。
- 在真实 darwin Seatbelt 上先重现已有漏洞：根路径含引号、反斜杠、`]`、`^` 时 `.git/config` 写入成功。现在受保护段正则不插入用户根路径，四种根中的普通写入成功而受保护写入被内核拒绝。Sidecar 中批准 bash 可写附加根，但保护路径、符号链接外部目标和 worktree 主检出保持不变。负例夹具在独占的用户目录下创建并清理，显式确认不在 Sidecar 有意允许的 `/tmp` 内；不会以临时目录能力掩盖越界。

红灯证据（实现之前）：

- `rtk pnpm run test tests/integration/sidecar-project-permissions.test.ts`：1 例失败，首个审批错误地是读取 `r1`，预期应为后续写入 `w1`。
- `rtk pnpm run test apps/server/src/adapters/seatbelt.test.ts -t '特殊字符'`：4 例失败，8 例因过滤未运行；四种特殊根下受保护写入都返回 exitCode 0，预期 exitCode 1 + sandboxDenied。

最终验证（darwin）：

```sh
rtk pnpm run test packages/agent/src/policy/execution-checks.test.ts packages/agent/src/policy/approvals.test.ts packages/agent/src/policy/escalation.test.ts packages/agent/src/policy/decide.test.ts packages/agent/src/policy/gate-hooks.test.ts packages/agent/src/policy/sandbox.test.ts apps/server/src/adapters/seatbelt.test.ts apps/server/src/application/session-cwd-scope.test.ts apps/server/src/application/session-delete.test.ts apps/server/src/application/branches.test.ts tests/integration/sidecar-project-permissions.test.ts tests/integration/sidecar-permissions.test.ts tests/integration/sidecar-sandbox.test.ts tests/integration/sidecar-subagents-permissions.test.ts tests/integration/sidecar-subagents-isolation.test.ts tests/integration/sidecar-worktrees.test.ts tests/integration/sidecar-delete-session.test.ts tests/integration/sidecar-branches.test.ts
```

18 文件、224 例通过，0 跳过，退出码 0；包含原有权限、提权、执行前复核、子代理、worktree、09 生命周期和 20 目录准入回归。新 Sidecar 文件 13 例和 Seatbelt 适配器 12 例均实际运行。Seatbelt 平台专属用例在非 darwin 明确 skip，并说明没有 sandbox-exec；本次没有执行其他平台。

- `rtk pnpm run typecheck`：退出码 0。
- `rtk pnpm run check:docs`：246 个 Markdown，0 问题，退出码 0。
- 对全部 9 个改动 TypeScript 文件运行 `rtk pnpm exec oxfmt`、`rtk pnpm exec oxlint`；`rtk git diff --check`：退出码 0。
- 正式正文原地同步 permissions、worktrees、projects；ADR 0005/0016 后继链接当前正文与代码测试，ADR 0020 当前实施范围同步。搜索旧的“多文件夹权限尚未”“附加权限待实施”结论并修正；ADR 0016 既有日期实施记录保留为历史，下方后继说明新范围。AGENTS → docs/README → 三份当前正文及 ADR 已读回：路径、语义、权威、引用方向、入口、生命周期与历史保留均通过，无正文依赖具体 scratch 材料。

本票没有新增界面；真实模型（无凭据）、完整桌面渲染/打包产物和 CI 未验证，不把 Sidecar/Seatbelt 证据当成这些范围的验证。所有改动仅本地提交，没有 push/PR。
