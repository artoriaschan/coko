# 17: 附加文件夹的权限范围

**What to build:** 项目内的对话可以读写项目的其他源文件夹。每个 Run 开始时计算本次的 Workspace 根集合：工作目录加上项目的各源文件夹，worktree 会话不含主检出。这个集合同时用于判断读取是否需要审批、写入的判定（按当前权限模式）与 Seatbelt 的可写根；拒绝规则与受保护路径照常生效。于是在项目内新建的会话只多出主要文件夹以外的文件夹，worktree 会话保持 ADR 0016 的隔离，从别处移入的会话包含主要文件夹。指令文件、项目设置、Hook、MCP 与 Skills 仍只从工作目录读取。修改项目的文件夹列表，或把会话移入、移出项目，都从下一个 Run 开始生效；子智能体会话按根会话的归属计算。

- 行为依据：[规格](../spec.md) PROJ-17、17.2 权限范围；[ADR 0005](../../../docs/adr/0005-permission-mode-and-sandbox.md)、[ADR 0016](../../../docs/adr/0016-session-cwd-fixed-worktrees.md)、[ADR 0020](../../../docs/adr/0020-projects-organize-workspaces.md)。这是本规格唯一放宽免审批范围的票。

**User stories:** 26、62

**Blocked by:** 13、16

**Status:** ready-for-agent

**Write scope:** packages/agent 的路径判定与沙箱可写根；apps/server 每个 Run 的根集合计算与 Seatbelt 适配；`docs/subsystems/permissions.md`（Workspace 内的定义）、`docs/subsystems/worktrees.md`（worktree 会话不含主检出）与 projects.md 的权限范围一节。

- [ ] Sidecar 协议（default 模式）：读取附加文件夹不询问；写入附加文件夹按模式询问，批准后 bash 能写入该文件夹（Seatbelt，仅 darwin）；受保护路径照常询问；Run 进行中修改文件夹列表，本次 Run 不变，下一个 Run 按新列表（CW-69、CW-70）。
- [ ] Sidecar 协议：从别处移入的会话读写主要文件夹时读取不询问、写入按模式询问，工作目录仍是原专属目录（CW-85）；移出项目后，下一个 Run 收回附加文件夹；worktree 会话的根集合不含主检出；子智能体会话与根会话一致。
- [ ] 对手用例：附加文件夹内命中拒绝规则的路径仍被拒绝；受保护路径不因位于附加文件夹而免审批；附加文件夹内指向外部的符号链接不扩大读写范围；附加文件夹中的指令文件、项目设置、Hook、MCP 与 Skills 不被加载。
- [ ] Seatbelt 相关用例只在 darwin 运行，其他平台显式跳过并说明原因。
- [ ] 文档按 Write scope 更新，ADR 0005 与 ADR 0016 的后继说明链接本票的证据；`check:docs` 通过。
