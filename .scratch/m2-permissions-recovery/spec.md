# M2 安全与恢复：规格

Status: ready-for-agent
Spec status: delivered（2026-10-29，main 09f5193；真实模型与发布构建产物 E2E 未验证，遗留项见地图 Carry-overs）
Map: [Coko 桌面应用](../desktop-app/map.md) · [里程碑划分](../desktop-app/issues/06-grill-milestone-route.md) · 讨论：[grilling.md](grilling.md)

## Problem Statement

M1 的 Agent 不经审批直接读写任何路径、执行任何命令，这是已知安全缺口；bash 不受沙箱约束，工具所需凭据没有受控注入方式。Sidecar 崩溃或被强杀时，进行中的 Run 不留结束记录，重启后无法判断哪些写入或命令已经生效，也无法安全继续。用户不能在 Run 中途追加指令或暂停，也不能把对话与文件退回到之前某条消息。Session Entry 的 payload 只做类型断言，没有注册的 schema 与版本。

## Solution

交付 Permissions / Approvals、Seatbelt 沙箱与 Secrets 声明、工具并发调度、Steering 与暂停/继续、启动恢复与幂等、payload 注册、Checkpoint / Rewind 与"从此分叉"。用户在 composer 选择 Permission Mode；需要授权的调用以审批卡接管 composer，可允许一次或保存规则；命令在模式对应的沙箱档位内运行，被拒后可单次提权；Run 中可追加指令、暂停、继续；崩溃重启后中断的 Run 被识别，结果不明的副作用等待用户确认；每条用户消息都是 Checkpoint，可以退回对话、代码或两者，或从该处分叉。决定见 [ADR 0005](../../docs/adr/0005-permission-mode-and-sandbox.md)、[ADR 0006](../../docs/adr/0006-file-checkpoints-and-rewind.md)；术语见 [GLOSSARY](../../GLOSSARY.md)。

## User Stories

**权限与审批**

1. As a 用户, I want Agent 写文件、执行命令或读取 Workspace 之外的文件前先征得我同意, so that 它不会在我不知情时改动系统。
2. As a 用户, I want 审批卡接管输入区并显示工具、命令或路径以及写入的 diff 摘要, so that 我能看清要批准什么。
3. As a 用户, I want 允许一次或拒绝，拒绝时可写一句原因让 Agent 换个做法, so that 我能纠正方向而不只是叫停。
4. As a 用户, I want 无原因拒绝后 Run 停下, so that Agent 不会绕道达成被我拒绝的事。
5. As a 用户, I want 把"总是允许"保存到本 Session、本 Workspace 或全局, so that 同类调用不再反复询问。
6. As a 用户, I want 在输入区选择 Permission Mode（只读、默认、自动接受编辑、完全访问）并用 Shift+Tab 循环前三档, so that 我能按任务调整授权。
7. As a 用户, I want 在设置的 Permissions 分区查看和删除规则、设置新 Session 的默认模式, so that 我能管理已授予的权限。
8. As a 用户, I want 拒绝规则在任何模式下都生效、写 .git 等受保护路径总要审批, so that 关键文件不会被意外改动。
9. As a 用户, I want 等待审批时切换模式或新增规则，待审批请求按新设置自动判定, so that 不必再点一次。
10. As a 用户, I want 键盘可以完成审批（焦点在详情时 Enter 允许一次、Esc 拒绝）, so that 不必依赖鼠标。
11. As a 用户, I want 等待审批的会话在侧栏上浮并带标记、重连或重开窗口后审批卡仍在、退出确认把它算作活动 Run, so that 我不会漏掉待处理的请求。

**沙箱与 Secrets**

12. As a 用户, I want 默认与自动接受编辑模式下命令只能写 Workspace 与临时目录、只读模式下命令不能写任何位置, so that 即使批准了命令，破坏面也有限。
13. As a 用户, I want 命令因沙箱被拒时 Agent 可以说明理由请求以更宽档位重试一次，由我批准且只对这一次有效, so that 必要的越界经过我同意且不会延续。
14. As a 用户, I want 本机无法启用沙箱时受限命令不运行并给出明确错误, so that 不会在我以为受保护时无保护地运行。
15. As a 开发者, I want 工具声明所需的密钥名、宿主只在该次调用中注入，密钥不出现在协议、库、日志与快照中, so that 凭据不外泄。

**并发**

16. As a 用户, I want 多个只读调用并行执行但不超过并发上限，写入与命令按调用顺序独占执行, so that 结果快且不会互相踩踏。

**Steering / Interrupt**

17. As a 用户, I want Run 进行中发送的消息在当前步骤结束后送达 Agent, so that 我能中途修正方向而不必停止。
18. As a 用户, I want 暂停 Run 时当前步骤完成后停下、不杀进程，之后点继续接着做, so that 我能先检查再放行。
19. As a 用户, I want 停止时未送达的追加指令回到输入区、待审批请求被取消且不执行, so that 停止的结果是可预期的。

**恢复与幂等**

20. As a 用户, I want 应用或 Sidecar 崩溃后重开，中断的会话显示"上次运行已中断"并可继续, so that 工作能接上。
21. As a 用户, I want 恢复时未执行或只读的调用不会重复产生副作用，结果不明的写入或命令先让我确认是否已生效, so that 不会重复执行危险操作。
22. As a 用户, I want 中断时待审批的请求失效，继续后需要重新审批, so that 旧授权不会在新的情境下生效。
23. As a 开发者, I want 副作用工具在执行前提交带幂等键的执行记录, so that 恢复能区分"没开始"和"可能已执行"。

**Session Persistence**

24. As a 开发者, I want 每种 Session Entry 都有注册的 payload schema 与版本，写入不合格时拒绝、读取旧版本时迁移, so that 记录可演进。
25. As a 用户, I want 个别损坏的条目被跳过并记录，而不是整个会话打不开, so that 局部损坏不扩散。
26. As a 开发者, I want 库迁移、损坏隔离与版本过高拒绝都经真实 Sidecar 验证, so that ADR 0003 的承诺有证据。

**Checkpoint / Rewind**

27. As a 用户, I want 在某条消息上选择回退对话、回退代码或两者, so that 我能撤销一段走偏的工作。
28. As a 用户, I want 回退代码前看到将恢复和删除的文件，并标出 Agent 之外改动过的文件, so that 我不会误覆盖自己的修改。
29. As a 用户, I want 回退对话后原消息回到输入区可修改，被回退的内容折叠保留可查看, so that 我能换种说法重来且不丢记录。
30. As a 用户, I want 从某条消息分叉出新会话而原会话不变, so that 我能尝试另一条路线。
31. As a 用户, I want 界面说明命令造成的文件变化不会被回退，Run 进行中或待审批时不能回退, so that 我了解回退的边界。

**遗留项**

32. As a 用户, I want 设置等模态框打开时 Toast 的动作仍可用键盘到达, so that 键盘用户不被困住。
33. As a 开发者, I want Provider kind 映射只有一处来源、挂起请求的超时写法只有一份, so that 新增 kind 或请求类型不必散改多处。

## Implementation Decisions

讨论记录：[grilling.md](grilling.md)，全部按常设指示采纳。长期决定见 ADR 0005、0006；ADR 0003 的 payload 注册与迁移证据在本里程碑补齐。

**Session Entry 种类**（payload 由 agent 定义并注册，session 校验；全部 append-only）

| kind | 何时提交 | payload 要点 |
| --- | --- | --- |
| `run_start` | 每个 Run 第一次模型请求前 | `trigger`: submit / retry / continue |
| `message` | 同 M1；追加指令送达时也是 user message | 模型可见消息 |
| `run_end` | Run 结束 | `status`: completed / aborted / error / paused / interrupted；`error?`；`undeliveredSteering?: string[]` |
| `permission_mode` | 模式切换（含新 Session 初始模式） | `mode` |
| `permission_rule` | Session 作用域规则增删 | `op`: add / remove；`rule` |
| `approval_request` | 判定为 ask 时 | `requestId`、`toolCallId`、`toolName`、`kind`: tool / escalation、`subject`（命令或路径）、`targetMode?`、`justification?`、`suggestions` |
| `approval_decision` | 用户回答或系统结束请求 | `requestId`、`outcome`: allowed / denied / cancelled / expired / superseded、`scope?`、`feedback?` |
| `tool_exec` | side-effect 调用取得执行槽后、执行前 | `toolCallId`、`toolName`、`idempotencyKey` |
| `confirmation_request` / `confirmation_answer` | 恢复时结果不明 / 用户回答 | `toolCallId`；answer 为 applied / not-applied / unknown |
| `file_backup` / `file_change` | write、edit 某锚点下首次改某路径前 / 改完 | `anchorSeq`、`path`、`blob` 或 `absent`、`untracked?` / `afterHash` |
| `rewind` | 回退对话 | `targetSeq` |
| `fork_origin` | 分叉后新 Session 第一条 | `sessionId`、`seq` |

**packages/session**
- 注册接口：`PayloadRegistry`（kind → 当前版本、各版本 schema 校验函数、逐版迁移）；SQLite 与内存实现共用契约测试。appendEntries 对未注册 kind 或不合 schema 的 payload 以 `invalid-payload` 拒绝，整批不提交。listEntries 返回迁移到当前版本的 payload；仍不合格的条目跳过并记 warn（返回中不出现，库中保留）。session 不导入 agent。
- 迁移 v2：索引 `session_entries(session_id, kind, seq)`；查询"有 run_start 而无其后 run_end 的 Session 与 runId"。
- 新入口 `@coko/session/blobs`：内容寻址文件存储（见 ADR 0006）。

**packages/agent**
- 领域 barrel（票 01 建立，`src/index.ts` 只加 re-export 一次）：`policy/index.ts`、`recovery/index.ts`、`checkpoints/index.ts`、`session-entries/index.ts`（按领域分文件：`runs.ts`、`permissions.ts`、`tools.ts`、`checkpoints.ts`）。
- RunEntry 改为通用 `{ kind, runId?, payload }`，server 直接按注册表提交，新增 kind 不再改 server 映射。
- 工具契约（`tools/types.ts`）增加：`effect: 'read' | 'side-effect'`（缺省 side-effect）、`permissionSubject(args)`（路径或命令；read/grep/find/ls/write/edit 返回路径，bash 返回命令）、`secrets?: string[]`、`probeOutcome?(args, cwd)` → applied / not-applied / unknown。
- policy：纯判定 `decide(call, { mode, rules, workspace, writableRoots })` → allow / deny / ask(+suggestions)，顺序见 ADR 0005；规则语法与匹配见 grilling A4；受保护路径见 grilling A11。`ApprovalBroker`：每个 runtime 一个，pending 请求按 requestId 等待 `answer()`，abort/pause 时 cancelled，模式或规则变更时重新判定。经 `ToolHooks.beforeToolCall` 接入，位于 hook 链首。
- 调度：并发上限默认 10（`AgentRuntimeOptions.toolConcurrency`）；read 共享、side-effect 独占屏障；包住 execute。side-effect 调用取得执行槽后提交 `tool_exec`，失败则不执行并以 commit_failed 结束 Run。
- 运行控制：`steer(text)`（送达时提交 user message）、`pause()`（finishTurn 返回 end，不发新请求）、`continue()`（新 Run，trigger continue；上一 Run 须为 paused / interrupted 且无待确认）、`abort()` 取消 pending 审批并退回未送达追加指令。
- 沙箱：ExecRequest 增加 `sandbox: { mode, writableRoots }`；提权阶梯与拒绝标记、提示文本（沿用 DSH `[sandbox: file access denied under <mode> mode]` 与 escalation hint）在 `policy/sandbox.ts`；bash 增加 `sandbox_permissions`、`justification`。内置 local exec 不实现沙箱（没有系统二进制依赖）；收到受限档位而宿主未提供沙箱时 fail-closed。
- recovery：纯函数 `planRecovery(entries, tools)` → 要提交的条目（expired 决定、补齐的 toolResult、confirmation_request、run_end interrupted），分类见 grilling E3。
- checkpoints：tracker 经 beforeToolCall（位于权限 hook 之后）在首次修改前备份，afterToolCall 记录 file_change；`planRewind(entries, targetSeq, mode)` 与有效上下文计算（跳过 rewind 区间）。

**packages/protocol**（票 01 建立领域文件并在 `index.ts` 一次性 re-export：`permissions.ts`、`runs.ts`、`checkpoints.ts`；RunStatus 与 Session.activity 移到 `runs.ts` 并预先声明全部取值）
- SessionEntry 按 kind 判别，payload 用各 kind 的 schema（解决评审 A20）。
- 新路由：`POST /api/sessions/:id/approvals/:requestId` { decision: allow / deny, scope?: once / session / workspace / global, feedback? }（非 pending 409 `approval-not-pending`）；`PUT /api/sessions/:id/permission-mode`；`GET/PUT /api/permissions`（默认模式、全局与 Workspace 规则，带 revision）；`POST/DELETE /api/sessions/:id/permission-rules`；`POST /api/sessions/:id/steer`（无 Run 时 409 `no-active-run`）；`POST …/pause`；`POST …/continue`（409 `nothing-to-continue` / `confirmation-pending`）；`POST …/confirmations/:toolCallId`；`GET …/checkpoints`；`POST …/rewind` { targetSeq, mode: conversation / code / both, dryRun? }；`POST …/fork` { targetSeq }（Run 进行中、待审批、待确认 409 `session-busy`）。
- Session DTO 增加 `activity`；保留 `running`。

**apps/server**
- SessionService 增加扩展工厂 `extensions: (ctx) => { hooks?, onEntry? }`（票 02 引入），checkpoint 等能力经 layers.ts 注册，不改 sessions.ts。
- 权限状态：模式与 Session 规则从条目回放；全局与 Workspace 规则读设置键 `permissions.rules`、`permissions.rules.workspace.<id>`，默认模式 `permissions.defaultMode`；设置键有 schema 校验，只能经 `/api/permissions` 修改。
- 沙箱：`adapters/seatbelt.ts`：profile `(version 1)(allow default)(deny file-write*)(allow file-write* (literal "/dev/null"))` + 可写根 `(subpath …)`（Workspace、`/private/tmp`、`realpath(os.tmpdir())`）；启动探测 `sandbox-exec -p <read-only profile> -- true`；拒绝判定为非零退出且输出含 `operation not permitted`；测试用 `COKO_SANDBOX_EXEC` 覆盖可执行路径（仅测试）。
- Secrets：SecretProvider 端口；声明的变量只注入该次调用；HOST_ENV_EXCLUSIONS 不变。
- 恢复：打开存储后、开始监听前运行启动扫描，提交 planRecovery 的条目；正常关闭不触发。
- 退出确认：等待审批的 Run 计入 activeRuns。

**apps/desktop renderer**（UI 遵循 [界面约定](../../docs/tech-stack/ui.md)，参考 DSH ui-approval / ui-conversation）
- 审批卡、提权卡、结果确认卡接管 composer，同一时刻一张；键盘与单次回答规则见 grilling H1。
- composer：模式选择（Shift+Tab 循环前三档、full-access 显式选择）；Run 中可输入追加指令、显示待送达；停止与暂停并列；paused / interrupted 横幅带"继续"。
- 时间线：工具卡显示审批决定与沙箱拒绝；rewind 区间折叠；用户消息的"回退到此处"、"从这里分叉"动作与确认对话框（dry-run 清单、bash 不追踪说明）。
- 侧栏：awaiting-approval / awaiting-confirmation / interrupted 徽标并上浮。
- 设置：Permissions 分区。

**共享装配点与所有者**（M2 期间）
- `packages/protocol/src/index.ts`、`packages/agent/src/index.ts`：只有票 01 改（建立领域文件与 barrel 的 re-export）；票 10 可在 agent index 中调整 models 的导出行。其余票只改领域文件。
- `packages/session/src/sqlite/schema.ts`（迁移列表）：只有票 08。
- `apps/server/src/application/sessions.ts`、`http/app.ts`：主干票串行（01 → 02 → 03 → 05 → 06 → 08 → 09）；04、07、10 不改。
- `apps/server/src/runtime/layers.ts`：01 → 02 → 05 → 07 → 08 串行；10 只改 `runtime/main.ts`。
- `apps/desktop/src/main/index.ts`、`preload/index.ts`、`shared/bridge.ts`：M2 不需要新 IPC，默认无票修改；票 10 若收敛挂起请求需要改 main，只改 `main/credentials.ts`、`main/sidecar-process.ts`。
- `packages/i18n/src/dictionaries/*`、renderer `features/conversation`、`features/sidebar`、`stores`、`packages/ui/src/index.ts`：主干票串行；04、07、10 不改。
- `tests/integration/sidecar-harness.ts`、`apps/desktop/e2e/harness.ts`：主干票可改；并行票只新增测试文件。
- 文档：`apps/server/README.md` 由主干票更新；agent README 由票 04 新建，05、06、08 更新；`packages/session/README.md` 由 01、07、08；`docs/subsystems/permissions.md` 由 02 新建，03、05 更新；`docs/adr/README.md` 的行按 ADR 归属更新。TECH_STACK 接入状态表只增本票的行（M2 预计不新增依赖）。

## Testing Decisions

- 好的测试只断言外部事实：协议响应与事件、重新读回的条目、Workspace 文件内容与不应变化的文件逐字节不变、进程退出、窗口中实际渲染与交互。
- 测试接口（沿用 M1，由高到低）：
  1. **Sidecar 协议**（主接口）：`ELECTRON_RUN_AS_NODE=1` 启动真实 Sidecar（faux 脚本），覆盖审批流、模式与规则持久化、重新判定、Seatbelt 拒绝与提权、并发观察、steering / pause / continue、SIGKILL 后重启恢复与确认、迁移 v2、损坏与版本过高、checkpoint 与 rewind / fork、秘密不外泄总闸。
  2. **packages/agent 运行时**：faux + 临时 Workspace；判定流水线与规则匹配的表驱动用例；调度屏障（deferred 控制交叠，不用 sleep）；steering 注入顺序；暂停边界；planRecovery、planRewind 纯函数。
  3. **packages/session**：payload 注册契约（SQLite 与内存）；迁移 v2；blob 存储原子写与权限；未完成 Run 查询。
  4. **Electron E2E**：审批卡（允许一次、总是允许、拒绝带反馈）、模式选择、Permissions 设置、追加指令与暂停继续、SIGKILL Sidecar 后中断横幅与确认卡、回退与分叉、模态框中 Toast 的键盘可达。
  5. **产物 smoke**：`electron-forge package` 产物中一次审批允许与受限命令无法写 Workspace 之外。
- Browser Mode：审批卡键盘（Enter / Esc / 单次回答）、composer 在 Run 中可输入。
- Seatbelt 用例只在 darwin 运行，其余平台显式跳过并说明。
- 秘密不外泄总闸（M1 retro 第 3 条）是票 01 的验收；之后引入新输出通道的票在同一测试文件追加驱动步骤，保持全绿。
- 真实模型：具备环境变量凭据时跑一条带审批的真实对话，否则报告未验证。

## Out of Scope

- 网络与读取的沙箱限制；Windows / Linux 沙箱。
- 项目级权限配置文件（`.coko/settings.json`）、策略锁定、auto / classifier 模式、Hook 的权限决定（M5）、子代理审批冒泡（M5）、headless 的 never 策略（M6）。
- Plan 模式（M4）；bash 改动的快照与回退；回退的撤销；快照清理与 Session 删除；分叉的配置与权限继承、Handoff（M5）。
- 外部能力的幂等键使用（M3 MCP 起）；真实 Secrets 使用者（M3）。
- 签名与公证。

## Further Notes

- workspace-write 下写用户目录缓存（例如 `~/.npm`、`~/.cache`）的命令会被沙箱拒绝，需要提权或切换模式；工具卡与拒绝提示要能让用户看懂。
- sandbox-exec 是 macOS 已弃用但仍随系统提供的工具；Apple 移除后受限档位将 fail-closed（ADR 0005）。
- 并行窗口内的票只在写范围不重叠时由 Lead 同时派发；每票合入前做该票 diff 的轻量 Spec 评审，里程碑末做两轴全量评审（M1 retro）。
- 实施须知：[implementer-brief.md](implementer-brief.md)。
