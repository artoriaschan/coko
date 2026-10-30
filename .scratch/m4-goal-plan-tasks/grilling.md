# M4 目标与任务：设计树与采纳记录

Map: [Coko 桌面应用](../desktop-app/map.md) · [里程碑划分](../desktop-app/issues/06-grill-milestone-route.md) · 规格：[spec.md](spec.md)

2026-10-30，planner。用户于 2026-10-30 指示"继续实施 M4"。按用户常设指示（2026-10-28 goal：讨论问题直接采用推荐答案，优先沿用参考项目决策；packages/agent 参考 pi coding-agent v1.4.0 与 claude-code，apps/desktop 的 UI 参考 deepseek-harness），本文每个问题都由 Agent 给出推荐并**按常设指示采纳**，不是用户逐条确认。参考材料：[claude-code 研究](../desktop-app/research/claude-code-agent-logic.md) §3（Plan Mode）、§4（TodoWrite / Task）、§12（后台 Bash）；[DSH 研究](../desktop-app/research/dsh-desktop-architecture.md) §3.3（composer dock、Plan chip、Goal 卡）；[pi 研究](../desktop-app/research/pi-agent-core-and-coding-agent.md) §1.3（finishTurn、prepareRequest）与 bash 的进程组；DSH 源码 `packages/goal/{goal,goal-round-driver,tool-goal,command-goal}`、`packages/plan/plan-mode`、`packages/todo/tool-todo`、`packages/jobs/{jobs,jobs-local,tool-jobs}`、`packages/terminal`、`packages/subprocess/subprocess-local`、`packages/client/{ui-goal,ui-plan,ui-jobs}`；[M3 复盘](../m3-context-instructions/retro.md)；[模型服务 PRD](../model-service-settings/spec.md)。

## 已核对的事实

- **结构债现状。** `apps/server/src/application/sessions.ts` 596 行，仍含 `CONTRIBUTED_TOOLS`、`#hostToolNames`（用 `process.cwd()` 构造工具集取名字）、`#rememberContributed`（J1）。`packages/agent/src/engine/runtime.ts` 826 行，压缩编排（`summarize`、`compactNow`、`autoCompact`、`recoverOverflow`、手动 `compact()`）在 `createAgentRuntime` 闭包内（J5）。`application/context/mcp.ts` 507 行（J2）。J4、J6、J7 未做（[M3 Standards 评审](../m3-context-instructions/review-standards.md) 处理结果表）。`ContextContribution` 没有 `beforeRequest` 与 `ruleTools`。
- **pi-agent-core 1.4.0** 有 `finishTurn`（返回 end 结束、continue 再请求一次）、`prepareRequest`、`steer`；没有 Goal、Plan、Todo、Job。pi coding-agent 1.4.0 的 bash 以 detached 进程组启动、abort 时 `killProcessTree`，没有后台任务与 PTY。
- **claude-code（社区还原版）。** Plan 是权限模式 `plan`，进入时记 `prePlanMode`，只读靠提示注入加正常审批，`ExitPlanMode` 要求用户确认并恢复原模式；TodoWrite 整表替换，V2 Task 带 blocks/blockedBy、owner 与文件锁；后台 bash 有任务记录、落盘输出、`<task-notification>` 注入下一轮、TaskOutput（可阻塞）与 TaskStop。
- **DSH。** Goal：每 Session 一个，`goal/change` 事件带完整快照与 revision（compare-and-set），四个持久阶段 active / paused / blocked / complete，"已布防"只在进程内、会话恢复或分叉后须人恢复；只有轮次上限（默认 256），没有 Token / 费用 / 时间预算；自主轮次中模型"blocked"须连续 3 轮；create / edit / pause / resume 须本轮有直接人类消息。Plan：`/plan`、`exit_plan_mode` 交用户审阅（批准 / 继续规划），**只是提示、不限制工具**。Todo：`todo_write` 整表替换，项只有 content 与三态 status。Jobs：`<kind>-<uuid>` id、owner 为 Session、256KB 环形输出、`job_output`（游标读、可 wait）、`job_list`、`job_kill`、完成通知（忙时注入下一步、空闲时唤醒）、进程内、重启即丢。PTY：`node-pty` **1.2.0-beta.15**（DSH 打了补丁：spawn-helper 的外部路径与 Windows ConPTY 退出），`allowBuilds: node-pty: true`，postinstall 恢复 spawn-helper 的可执行位，electron-builder 解包 `*.node` 与 `spawn-helper`。UI：composer dock 依次 Todo（order 0）→ Goal → Queue；Plan chip 蓝色、hover 变 ×、计划在右栏自动打开一次。
- **node-pty 包元数据**（2026-10-30 经公司 Artifactory `pnpm view`）：latest 1.1.0（2025-12-22），beta 1.2.0-beta.18（2026-10-23）；1.2.0-beta.15 发布于 2026-08-03；依赖 `node-addon-api ^7.1.0`（N-API，不绑定 Node ABI）；install 脚本 `node scripts/prebuild.js || node-gyp rebuild`。是否在本机解出 darwin-arm64 预编译、能否在 Electron 41.0.3 的 `ELECTRON_RUN_AS_NODE` 下加载，**未实测**，由票 02 验证。
- **Coko 打包。** Sidecar 以 `extraResource` 放在 `Resources/sidecar`（不在 asar 内），`asar: true` 只装 main / preload / renderer；`packagerConfig.tmpdir` 已按检出路径区分。因此 node-pty 放进 `Resources/sidecar` 时不需要 asar 解包，DSH 补丁中把 `app.asar` 换成 `app.asar.unpacked` 的部分不适用。TECH_STACK 已选的 `@electron-forge/plugin-auto-unpack-natives` 未写入 manifest。
- **模型价格。** `packages/agent/src/models/registry.ts` 把每个模型的 `cost` 固定为 0；Model Catalog（ADR 0010）没有价格字段。不加价格就无法实现费用预算与费用显示。
- **进程。** `ports/local-exec.ts` 以 `detached: true` 启动 bash，停止时 `process.kill(-pid)`；`adapters/mcp.ts` 的 stdio 传输暴露 `pid()`。macOS 没有 PDEATHSIG。
- **其他。** bash 工具参数只有 `command`、`timeout`、`sandbox_permissions`、`justification`（没有 workdir）。`forkEntries` 只复制 message、permission_mode、permission_rule。内置命令在 `instructions/commands/builtin.ts`（只有 compact）。renderer 的追加指令在 `chat-store` 的 `steering` 数组中，送达后移除、Run 结束退回输入区。`docs/adr/README.md` 中 ADR 0007 的 implementation 为 not-started，而 0007 文件 frontmatter 为 implemented（M3 票 07 已实施）：索引过时。

## 设计树

```text
M4
├── A 预构建 ── A1 范围（J1、J2、J4–J7）── A2 拆分目标 ── A3 与 M4 基础票的关系
├── B Goal ── B1 每 Session 几个 ── B2 存储 ── B3 状态机 ── B4 推进与去重 ── B5 授权
│         ├── B6 预算口径 ── B7 预算检查点 ── B8 费用与价格 ── B9 完成判定
│         └── B10 重启恢复 ── B11 停止传播 ── B12 /goal 命令 ── B13 与回退、分叉、压缩
├── C Plan Mode ── C1 模式还是覆盖层 ── C2 工具限制 ── C3 计划存储 ── C4 退出与审阅 ── C5 入口 ── C6 压缩后
├── D Todo / Task ── D1 两者都做吗 ── D2 项的形状 ── D3 注入
├── E Background Jobs ── E1 发起方式 ── E2 Job 模型 ── E3 输出 ── E4 读取与订阅 ── E5 取消 ── E6 完成回传 ── E7 归属与重启
├── F Execution Runtime ── F1 PTY 与 stdin 接口 ── F2 node-pty 版本与构建 ── F3 打包 ── F4 孤儿进程
├── G 权限 ── G1 新权限类 ── G2 job_input
├── H UI ── H1 dock ── H2 Plan chip 与右栏 ── H3 后台任务视图 ── H4 费用与预算
└── I 交付 ── I1 Carry-overs ── I2 ADR 0007 索引 ── I3 切片与写范围 ── I4 测试接口 ── I5 ADR 与术语
```

## 第 1 轮（根节点）

**A1 预构建范围**：结构债 J1、J2、J4–J7 是否全部在 M4 第一张票做？
➡️ 是。J1（贡献工具的权限类由 `ContextContribution.ruleTools` 声明，删除 sessions.ts 的 `CONTRIBUTED_TOOLS` 与 `process.cwd()`）、J2（McpManager 拆出 McpAdmin，每个 Run 只 `#load` 一次）、J4（路由经 application 层取作用域，`MemoryService` 由 Application 持有）、J5（压缩编排抽出 driver）、J6（`CommandSourceContribution.list` 返回 `SourcedCommand[]`）、J7（Credential 与 Secret 的 IPC 通道合并为两个工厂）。不改变行为。采纳。

**A3 预构建与 M4 基础的关系**：一张票同时拆分并预建 M4 扩展点，还是两张？
➡️ 两张。票 01 只做行为不变的拆分，验收为"已有测试只改导入路径即通过"；票 02 预建 M4 的条目 kind、协议领域文件、迁移 v7、运行时 seam、权限类、依赖与 UI 容器。分开使 01 的评审只看结构，02 的评审只看新契约；M3 把两者放在一张票里，评审时难以区分行为改动。采纳。

**B1 每 Session 几个 Goal**：
➡️ 一个当前 Goal（DSH）。未进入终态的 Goal 存在时不能创建新的；完成或取消后可以创建新 Goal。并行目标不做。采纳。

**B2 Goal 存储**：单独的表，还是 Session Entry？
➡️ Session Entry `goal`，每次变更一条完整快照、revision 递增，更新须带当前 revision（DSH compare-and-set）。预算用量从条目派生，不另存计数器。采纳，见 [ADR 0011](../../docs/adr/0011-goal-state-as-session-entries.md)。

**C1 Plan Mode 是权限模式还是覆盖层**：DSH 只做提示、不限制工具；claude-code 是权限模式并记 `prePlanMode`。
➡️ 权限模式 `plan`（claude-code）：用户要求"工具限制、退出需确认并恢复原权限模式"，DSH 的纯提示做不到前者；[ADR 0005](../../docs/adr/0005-permission-mode-and-sandbox.md) 已写明"Plan 模式（M4）作为新的模式取值加入，沿用同一判定顺序"，一个 Session 仍只有一个模式。进入时把当前模式记在 `permission_mode` 条目的 `prior` 字段。属于 ADR 0005 已预告的扩展，不另写 ADR。采纳。

**D1 整表替换的 Todo 与带依赖的 Task 都做吗**：
➡️ M4 只做 Todo List（整表替换，DSH / claude-code V1），但项带稳定 id、可选 `blockedBy` 与完成时的 `result`，覆盖"拆分、依赖、状态与结果"。带 owner 认领、加锁与跨代理共享的 Task（claude-code V2）留给 M5 的 Agent Teams：M4 只有一个 Agent，owner 只有一个可能的值，认领与锁没有并发方，做了也无法验收。"负责人"在 M4 恒为当前 Session 的 Agent，不进 payload。采纳。

**E1 后台任务的发起方式**：
➡️ bash 新增 `run_in_background`（claude-code）；不做超时后自动转后台、不做"阻塞超过 15 秒转后台"。PTY 任务由同一参数加 `tty: true` 发起（见 F1）。采纳。

**F2 node-pty 版本**：
➡️ 沿用 DSH 的 **1.2.0-beta.15**，精确锁定；不带 DSH 的补丁：补丁的 spawn-helper 外部路径与 asar 路径替换服务于 DSH 的嵌入式运行时与 asar 内的原生模块，Windows 部分不在首发范围，Coko 的 node-pty 位于 `Resources/sidecar`（不在 asar 内）。`allowBuilds` 放行 `node-pty: true`；预编译 spawn-helper 丢失可执行位的问题（DSH 以 postinstall 修复）由 Coko 的构建步骤 `chmod 0755` 处理并由测试断言。登记在 TECH_STACK 并附包元数据。采纳。

**I2 ADR 0007 的索引**：
➡️ 不一致：0007 文件 frontmatter 为 `implemented`（M3 票 07 实施，证据在该 ADR 与 mcp.md），`docs/adr/README.md` 仍写 `not-started`。本次规划提交中把索引改为 implemented，其余行与文件一致（0001 partial、0003 partial、其余 implemented）。采纳。

## 第 2 轮

**A2 拆分目标**：
➡️ sessions.ts 拆出 `session-models.ts`（默认模型、档位、`setModel`、`contextModel`）与 `session-runs.ts`（`#start`、运行时构造、Run 上下文；之后 Goal Round 与 Job 通知经它开始 Run），sessions.ts 只留 DTO 与转交，目标 ≤ 300 行；runtime.ts 拆出 `engine/compaction-driver.ts`（J5）与 `engine/system-message.ts`（system sections 的替换），目标 ≤ 450 行；本票新建或改动的文件都不超过 500 行。采纳。

**B3 Goal 状态机**：
➡️ 九个阶段，与 agent-runtime 的列表一一对应：`running`、`waiting-input`、`waiting-external`、`paused`、`blocked`、`complete`、`cancelled`、`failed`、`budget-exhausted`。每次进入非 running 阶段都带 `reason { code, message }`。终态只有 complete 与 cancelled；paused、blocked、failed、budget-exhausted 可由用户恢复（budget-exhausted 须先调高耗尽的那一项）；waiting-input 在用户下一次提交消息或回答审批后回到 running；waiting-external 在等待的 Job 全部结束后回到 running。转换表见 spec。采纳（DSH 的四阶段把预算耗尽、执行错误、等待人都压进 blocked，界面无法区分，agent-runtime 已要求九种状态）。

**B4 推进与去重**：
➡️ server 内 `GoalDriver`：Session 的 Run 结束（`run_end` 已提交）后，若 Goal 为 running、没有待回答的结果确认、没有未送达的追加指令、预算与轮次有余量，则发起下一个 Goal Round。每个 Session 的推进串行化；预留键为 (goalId, revision, round)，开始前重读 Goal，revision 变了就放弃；`#start` 遇到 Run 进行中（用户先提交了）就放弃这次预留，用户的 Run 优先；`run_start` 带 `goal { goalId, round }`，启动时若最后一个同 goalId 的 run_start 已是该 round 则不再发起。Goal Round 的输入是一条 user message（DSH `<goal_round>`，带目标、成功条件、轮次与上限）。采纳。

**B5 Goal 的授权**：谁可以创建、编辑、暂停、恢复、完成、阻塞？
➡️ 沿用 DSH：`create_goal`、编辑、暂停、恢复只在当前 Run 由用户提交触发、或本 Run 送达过用户的追加指令时被接受；Goal Round 中调用以错误结果拒绝。`complete` 与 `blocked` 在两种 Run 中都可以，但 Goal Round 中的 `blocked` 只在自上次恢复或编辑以来至少 3 个 Goal Round 之后被接受（DSH 阈值 3）。用户经界面或 `/goal` 直接操作不受这些限制。采纳。

**B6 预算口径**：
➡️ 五维，均可不设：
- 轮次：Goal Round 的个数（用户提交的 Run 不计）。
- 工具调用：Goal 处于非终态、非 paused 时开始的 Run 中的 toolResult 数（含用户提交的 Run，因为它们服务于同一目标）。
- Token：同一组 Run 中 assistant 消息 usage 的 input + output + cacheRead + cacheWrite，加压缩摘要请求的 usage。
- 费用：同一组 usage 按模型价格计算（B8）。
- 时间：同一组 Run 的 `run_end.createdAt − run_start.createdAt` 之和，含等待审批的时间、不含 Run 之间的空闲。
子代理的消耗在 M5 以同一口径汇入（按 goalId 关联的子 Session），M4 提供汇总接口但没有子 Session。缺省限额：轮次 50、其余不设。采纳。

**B8 费用与价格**：
➡️ Model Catalog 的每个模型增加可选价格 `price { input, output, cacheRead?, cacheWrite? }`（每百万 token，数值），设置模型服务的模型选项中填写；货币为全局设置（USD / CNY，缺省 USD），只决定显示符号。注册表把价格写进 pi-ai 的 `model.cost`，用 pi-ai 计算每条 assistant 的 `usage.cost`。没有价格的模型费用显示"未定价"；设置了费用上限的 Goal 遇到未定价模型时不发请求，Goal 以 blocked（`cost-unpriced`）停下。这是对模型服务 PRD 第 9 节"费用统计不在本轮"的后续扩展，不改其已确认的规则。采纳。

**C2 Plan 的工具限制**：
➡️ plan 模式的"模式放行"与 read-only 相同（Workspace 与额外读取根内的读取、context-read、session-state），命令的沙箱档位为 read-only；写入、bash、MCP、memory-write 照常询问，不直接拒绝（claude-code：其余写操作照常审批）。另提示注入 `<plan_mode>` system section。`exit_plan_mode` 只在 plan 模式的 Run 中注册。采纳。

**D2 Todo 项的形状**：
➡️ `todo_write { items: [{ id?, content, status, blockedBy?, result? }] }`，整表替换。status：pending / in_progress / completed / cancelled；id 省略时按位置生成 `t1`…；content 1–500 字符且不重复；至多 50 项；同时至多一个 in_progress（单 Agent，DSH `allowParallelInProgress: false`）；`blockedBy` 只能引用表内 id、不能成环，有未完成的前置项时不能为 in_progress 或 completed；`result` ≤ 1000 字符，只允许在 completed / cancelled 项上。不合规则时整次调用以参数错误返回，原表不变。采纳。

**E2 Job 模型**：
➡️ `{ id: job-<8 位十六进制>, kind: bash | pty, label, command, sessionId, toolCallId, goalId?, status: running | stopping | completed | failed | killed | lost, exitCode?, signal?, startedAt, endedAt?, outputBytes, outputPath }`。每 Session 同时至多 10 个 running + stopping，第 11 个以错误结果拒绝（DSH 默认）。采纳。

**F1 PTY 与 stdin 接口**：
➡️ agent 定义宿主端口 `PtyPort.spawn({ argv, cwd, env, cols, rows }) → { pid, write, resize, kill, onData, onExit }`，packages/agent 不依赖 node-pty（"不依赖随安装包分发的二进制"）；没有 PtyPort 时 `tty: true` 以错误结果返回 `pty-unavailable`。`tty: true` 必须同时 `run_in_background: true`；沙箱 argv 前缀与非 PTY 相同。stdin 只经 `job_input { job_id, text, submit? }` 写入（submit 追加 \r；另接受 `ctrl_c`）；非 PTY 的后台任务 stdin 关闭。用户在界面上不能输入（不是终端模拟器）。终端尺寸固定 120×30。采纳（DSH 的持久终端会话与 Linux 输入等待探测不做）。

**F4 孤儿进程**（Carry-over）：
➡️ SQLite 进程登记表 `host_processes`：spawn 后立即登记 pid、pgid（仅 detached）、`ps -o lstart` 的启动时间、类别、Session 与 Job；退出后删除；有序关闭先终止再删除；启动时（打开存储之后、启动恢复之前）核对 pid 与启动时间后对进程组发 SIGTERM，2 秒后 SIGKILL，pid 被复用的行只删除。MCP stdio 子进程登记其 pid（非 detached，只杀该 pid；经 npx 等派生的孙进程可能逃逸，记为限制）。采纳，见 [ADR 0012](../../docs/adr/0012-host-process-registry.md)。

**H1 dock**：
➡️ composer 上方 dock 固定顺序 Todo → Goal → Queue（DSH），每张卡为 panel elevation、可折叠，没有内容时不显示。Queue 是已发送、尚未送达的追加指令（chat-store 已有 `steering`），只显示，不能撤回（运行时不支持取消已排队的 steer）。采纳。

## 第 3 轮

**B7 预算检查点**：
➡️ 每次模型请求前（`beforeRequest`）检查 Token、费用、时间；每次工具调用前（权限判定之后的 hook）检查工具调用数，超出时该调用不执行、结果为 `Goal budget exhausted: tool calls`；每个 Goal Round 开始前检查全部五维。超出时 Run 在本批结束后停止，`run_end { status: paused, error: { code: budget_exhausted } }`，Goal 进入 budget-exhausted（reason 写明哪一维）。单次请求可能使用量略超上限（输出长度不可预知），超出量至多一次请求。采纳。

**B9 完成判定**：
➡️ `create_goal` 必须给出 1–10 条成功条件（`/goal <目标>` 展开为请模型调用 `create_goal` 的消息，因此条件也在创建时记录）。`update_goal { action: complete, evidence: [{ criterion, text, toolCallIds? }] }` 须覆盖每一条条件、text 非空；`toolCallIds` 中的每个 id 必须是本 Session 已提交、`isError: false` 的 toolResult，否则以参数错误拒绝。Run 正常结束不改变 Goal 阶段。用户可在 Goal 卡上直接"标为完成"（不需要证据，记 `source: user`）。采纳。

**B10 重启恢复**：
➡️ 启动恢复把 running、waiting-input、waiting-external 的 Goal 提交为 paused（`reason.code: restarted`）；waiting-external 等待的 Job 已随进程结束（记 lost）。不自动推进，用户在 Goal 卡或 `/goal resume` 恢复。采纳（见 ADR 0011 的备选方案）。

**B11 停止传播**：
➡️ 取消 Goal（用户经卡片或 `/goal cancel`）：停止进行中的 Run（等待其 run_end）、终止该 Session 中 `goalId` 为此 Goal 的 running Job（等待 job_end），然后提交 `goal` 快照（cancelled）并带 `cleanup { runsAborted, jobsKilled, failures }`。暂停 Goal：当前 Run 本批完成后停下（pause 语义），不杀 Job。子代理的传播在 M5 接入。采纳。

**B12 /goal 命令**：
➡️ 内置命令 `/goal`（DSH command-goal 的语法）：`/goal <目标>` 提交为普通 Run，展开文本请模型调用 `create_goal`；`/goal pause`、`/goal resume`、`/goal cancel`、`/goal complete` 是动作（不产生 user message，Run 进行中 pause / cancel 仍可用）；`/goal` 无参数打开 Goal 卡。控制词只在独占整段输入时识别。采纳。

**B13 与回退、分叉、压缩**：
➡️ 分叉不复制 `goal`、`todo_list`、`plan`、`job_*` 条目（新 Session 从无 Goal、无 Todo 开始；`permission_mode` 照常复制，因此 plan 模式会被继承）。回退对话不改变 Goal（goal 条目像 permission_mode 一样不属于被回退的对话）。压缩后：Goal 未终结时 `<goal>` system section 每个 Run 都注入（目标、成功条件、阶段、预算用量），不依赖被摘要的消息。采纳。

**C3 计划存储**：
➡️ Session Entry `plan { planId, revision, markdown, status: proposed | approved | rejected, feedback? }`；不写入 Workspace 文件（claude-code 的 plans 目录在 Coko 会成为受保护路径之外的又一个写入点）。markdown ≤ 64 000 字符。采纳。

**C4 退出与审阅**：
➡️ `exit_plan_mode { plan }`（权限类 plan-exit：任何模式都询问，允许规则不生效，拒绝规则生效）提交 `plan`（proposed）与 `approval_request { kind: 'plan', planId, revision }`。回答：
- 批准：可附 `editedPlan`（用户在右栏改过的文本）与 `mode`（缺省为进入前的模式，可选 default / accept-edits，不可选 full-access）；提交 `plan`（approved，必要时为新 revision）、`permission_mode { mode }`、toolResult "计划已批准……"并附最终计划，Run 在新模式下继续。
- 继续规划：带反馈的拒绝，提交 `plan`（rejected，feedback），toolResult 为反馈，Run 继续规划。
- 无反馈拒绝：沿用现有语义，本批结束后 Run 以 aborted 结束。
Goal Round 中出现 plan 审阅时 Goal 进入 waiting-input。采纳。

**C5 入口**：
➡️ 模式选择菜单增加"规划"；`/plan [消息]`（切换到 plan 并记 prior，有消息时随后作为普通提交）；`/plan off` 回到 prior；composer 底栏蓝色 Plan chip，hover 显示 ×（退出到 prior）。Shift+Tab 的循环不包含 plan（避免误入）。不提供模型可调用的"进入规划"工具（claude-code 的 EnterPlanMode 让模型自己进入，M4 只由用户进入）。采纳。

**C6 压缩后的计划**：
➡️ 已批准的最新计划的 `plan` 条目早于最后一个 compaction 的 firstKeptSeq 时，以 `<approved_plan>` system section 注入其 markdown（≤ 16 000 字符，超出截断并注明）；否则不注入（原文仍在上下文中）。plan 模式下 `<plan_mode>` 每个 Run 注入。采纳（claude-code 压缩后重注 plan）。

**D3 Todo 注入**：
➡️ 有未完成项时每个 Run 注入 `<todo_list>` system section（压缩后也在）；全部完成或为空时不注入。todo_write 的结果为计数与当前表的文本。采纳。

**E3 输出**：
➡️ 每个 Job 的输出：内存环形缓冲 256 KB（DSH）供模型游标读；完整输出写 `<dataDir>/jobs/<sessionId>/<jobId>.log`（目录 0700、文件 0600），上限 64 MiB，超出后停止写入并在末尾注明；写入前按值替换登记的 Secret 与 Credential 明文（与工具结果相同的按值脱敏）。日志目录不是读取根（不新增免审批读取范围）。采纳。

**E4 读取与订阅**：
➡️ 模型：`job_output { job_id, wait?, timeout_ms? }`（游标读，只返回上次读取之后的输出；wait 缺省 30 秒、上限 10 分钟，追加指令到达时提前返回；结果末尾 `[status: …]`；ANSI 控制序列去除；单次按工具输出截断规则）、`job_list`。界面：`GET /api/sessions/:id/jobs`、`GET /api/jobs/:id/output?offset=`（不消耗模型游标）、WebSocket progress `job_update` 与 `job_output { jobId, offset, chunk }`（每 Job 每 100 ms 至多一帧）。采纳。

**E5 取消**：
➡️ `job_kill { job_id, reason? }`、界面停止按钮、`POST /api/jobs/:id/kill`：对进程组 SIGTERM，5 秒后 SIGKILL，status 先 stopping 再 killed。停止 Run 不终止 Job；取消 Goal 终止其 Job；Sidecar 有序关闭终止全部 Job（job_end killed）。采纳。

**E6 完成回传**：
➡️ Job 结束时提交 `job_end`，并为模型生成一条通知（claude-code `<task-notification>` 形状：id、命令标签、状态、退出码、未读输出 ≤ 2 KB 时内联，否则提示用 job_output）。该 Session 有进行中的 Run 时作为追加指令送达（提交为 user message，条目前带 `job_notification`）；没有 Run 时挂起，在下一个 Run（用户提交或 Goal Round）的 user message 前部合并送达。不因 Job 完成而唤醒空闲的、没有 Goal 的 Session（避免意外消耗）；Goal 为 waiting-external 时由 GoalDriver 发起下一轮。模型在通知前已用 job_output 读到结束状态或用 job_kill 停止的 Job 不再通知（DSH）。采纳。

**E7 归属与重启**：
➡️ Job 属于 Session（另记 toolCallId 与 goalId）。重启后没有 job_end 的 Job 在启动恢复中提交 `job_end { status: lost }`，其进程由孤儿清理终止；日志文件保留。M4 不清理日志目录（与快照目录一致）。采纳。

**F3 打包**：
➡️ sidecar 的 tsdown 构建把 `node-pty` 保留为 external；构建步骤把 node-pty 的 `package.json`、`lib/` 与当前平台的 `prebuilds/darwin-arm64/`（含 `pty.node`、`spawn-helper`）复制到 `dist/sidecar/node_modules/node-pty/`，随 `extraResource` 进入 `Resources/sidecar`；`spawn-helper` 设 0755。不需要 asar 解包与 auto-unpack-natives 插件（desktop-delivery.md 同步说明）。产物 smoke 在打包应用中启动一个 PTY Job。采纳。

**G1 新权限类**：
➡️ `session-state`：todo_write、create_goal、update_goal、job_kill——只改本 Session 自己的记录或停止本 Session 启动的进程，所有模式放行（含 read-only 与 plan）。get_goal、job_output、job_list 归入已有的 context-read。`plan-exit`：exit_plan_mode，任何模式都询问。规则名沿用工具名。采纳。

**G2 job_input**：
➡️ 权限类 bash，权限判定看的对象是写入的文本（与 bash 命令同一套规则匹配），各模式行为与 bash 相同（default 询问、full-access 放行）；理由是向交互式 shell 写入等同于执行命令。采纳。

**H2 Plan chip 与右栏**：
➡️ 右栏新增 Plan tab：最新 revision 的 Markdown（静态模式）、修订下拉、状态；新的 proposed 计划自动打开一次（DSH）；编辑按钮把内容切换为 textarea（`packages/ui` 的 Textarea mono 变体），批准时随回答提交。composer 被审阅卡接管：主按钮"批准并执行"（显示将恢复的模式）、菜单项"批准并允许编辑"、"继续规划"（带反馈输入）、"在右栏查看"。时间线中 plan 条目显示为计划卡（标题、状态、打开右栏）。采纳。

**H3 后台任务视图**：
➡️ 会话标题栏"后台任务"按钮（有 running Job 时带数量），打开右栏 Jobs tab：列表（状态点、标签、时长、退出码）、选中项的输出（anser 渲染 ANSI SGR，局部横向滚动，自动跟随尾部，停止按钮）。时间线中后台 bash 的工具卡显示 Job chip（点击打开该 Job），`job_notification` 显示为紧凑行。采纳（DSH ui-jobs；不引入终端模拟器）。

**H4 费用与预算显示**：
➡️ Goal 卡：目标（可展开全文）、阶段徽标与原因、轮次 n/上限、成功条件清单（完成后显示证据）、预算条（每个已设置维度的已用 / 上限，越过 80% 为 warning、耗尽为 destructive）、操作（暂停、恢复、编辑预算与目标、标为完成、取消）。每个 Run 结束后时间线显示 Run 用量行（Token 与费用，未定价显示"未定价"）。会话标题栏显示 Session 累计费用（HoverCard 显示分项）。采纳（DSH 的 turn footer 显示用量）。

## 第 4 轮（交付）

**I1 Carry-overs**：
➡️ 结构债 → 票 01；孤儿进程 → 票 03（ADR 0012）；"新增读取根或注入点的票须附符号链接越界用例、秘密总闸扫描 requestLog" → 写入 implementer-brief 规则与各票验收。M4 新增的注入点（`<goal>`、`<todo_list>`、`<plan_mode>`、`<approved_plan>`、Job 通知）的内容来自条目或进程输出，不读取文件路径；M4 不新增读取根（Job 日志目录不是读取根）。因此符号链接越界用例只在涉及文件路径的票中适用：票 04（日志路径在 Workspace 之外：读取须审批，经 Workspace 内指向日志目录的符号链接同样审批）与票 05（PTY 的 cwd 为 Workspace 真实路径）；其余票在 Comments 写明不适用的理由。所有新增注入点的票都新增 `secrets-gate-<channel>.test.ts`，扫描范围含 faux requestLog。采纳。

**I3 切片与写范围**：
➡️ 11 张票：01 结构拆分（阻塞全部）→ 02 M4 基础（阻塞其余）→ {03 进程登记与孤儿清理, 07 Todo 与 Queue, 08 Plan Mode} 可并行 → 04 后台任务（03 之后）→ {05 PTY 与 stdin, 06 后台任务视图, 09 Goal 核心} 可并行（04 之后）→ 10 Goal 预算与费用（09 之后）→ 11 Goal 卡与预算显示（10 之后）。共享装配点的唯一所有者见 spec。采纳。

**I4 测试接口**：
➡️ 沿用 M3：Sidecar 协议集成测试为主（真实 Sidecar、临时 `COKO_HOME` 与 Workspace、faux 模型脚本）；agent 纯函数表驱动（Goal 状态机与转换表、预算派生、完成证据校验、Todo 校验、plan 判定）；进程测试以真实子进程与 SIGKILL；Electron E2E 覆盖 dock、Plan 审阅、后台任务视图与 Goal 卡；产物 smoke 覆盖 PTY。faux 模型脚本需要能表达"多轮 Goal Round"——票 02 让 faux 脚本可按轮次给出回复。采纳。

**I5 ADR 与术语**：
➡️ 满足三条标准（难以撤回、无上下文时令人意外、真实取舍）的为 [0011](../../docs/adr/0011-goal-state-as-session-entries.md)（Goal 状态记为条目、自动推进不跨进程保留）与 [0012](../../docs/adr/0012-host-process-registry.md)（子进程登记与启动清理）。Plan 作为权限模式已由 ADR 0005 预告，不另写；模型价格字段、Job 存为条目、Todo 不做 Task、node-pty 版本可逆或属选型，不写 ADR。新增术语 Goal、Goal Round、Goal Budget、Success Criterion、Plan Mode、Plan、Todo List、Background Job，并更新 Run 的定义，已写入 [GLOSSARY](../../GLOSSARY.md)。采纳。

frontier 已空。
