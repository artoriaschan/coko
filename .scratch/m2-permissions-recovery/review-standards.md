# M2 评审：Standards 轴

- 范围：`git diff 82c34f6...HEAD -- . ':!pnpm-lock.yaml' ':!.scratch'`（184 个文件，+15045/−478），提交 `af0b040`…`84e3061`。
- 依据：AGENTS.md、docs/TECH_STACK.md、docs/tech-stack/*.md（architecture、agent-runtime、ui、observability、testing）、docs/DOCUMENTATION_SYSTEM.md（引用方向）、ADR 0003–0006、docs/subsystems/permissions.md 与 recovery.md、GLOSSARY.md、packages/agent、packages/session、apps/server 的 README。
- 严重度：**hard** 表示违反了已写明的仓库规则；**judgement** 表示风险或 Fowler 坏味道，需要评审者判断。
- 已排除：各票 Comments 中 Lead 已接受的偏离，以及 oxlint、oxfmt、tsc、check:docs、样式守卫能发现的问题。这些项目不重复报告，见文末“有意不报”。
- 本评审只读。除本文件外没有改动仓库，也没有运行测试。

## 摘要

| # | 严重度 | 主题 | 位置 |
| --- | --- | --- | --- |
| H1 | hard | 正式代码注释依赖 `.scratch` 中的 grilling 编号或票号 | 约 15 个源文件 |
| H2 | hard | Fork 标题在 Sidecar 中硬编码英文 `Untitled` / ` (fork)`，并写入库 | apps/server/src/application/sessions.ts:669 |
| H3 | hard | 日志字段 `requestId` 被挪作审批请求 id，与统一关联字段冲突 | sessions.ts:410、579、587 |
| H4 | hard | agent 目录结构与 agent-runtime.md 不一致（Fork 放在 checkpoints/，新目录未登记） | packages/agent/src/checkpoints、session-entries |
| H5 | hard | 用 effect 把 store 状态镜像到组件或 composer | conversation-pane.tsx:102、117；rewind-dialog.tsx:45 |
| J1 | judgement（高） | 回退代码写文件时跟随符号链接，越过权限判断中的写入边界 | packages/agent/src/checkpoints/rewind.ts:211–216 |
| J2 | judgement（高） | 提权不要求“同一命令先被沙箱拒绝”，与 ADR 0005 和 GLOSSARY 的措辞不符 | packages/agent/src/policy/gate.ts:89–94 |
| J3 | judgement（中） | Run 暂停后，规则拒绝的文本被改写成“暂停前未批准” | packages/agent/src/engine/runtime.ts:266–274 |
| J4 | judgement（中） | Secrets 端口声称 bash 看不到密钥，但宿主环境剔除只靠名字模式 | apps/server/src/adapters/credentials.ts:62–71、108–110 |
| J5 | judgement（低） | 缺少密钥时，失败发生在 `tool_exec` 已提交之后 | runtime.ts:220–240 与 scheduler.ts:107–112 |
| J6 | judgement（低） | 待确认状态有两个来源，注释称两处判断相同，实际不同 | sessions.ts:505 与 596–607 |
| S1 | judgement | Duplicated Code：protocol 与 agent 两份条目 schema，已出现差异，没有等价断言 | protocol/src/{runs,permissions,checkpoints}.ts 与 agent/src/session-entries/* |
| S2 | judgement | Duplicated Code：条目派生逻辑在 agent、server、renderer 各写一份 | chat-store.ts:78–186 等 |
| S3 | judgement | Divergent Change：SessionService 768 行，承担 6 类职责 | apps/server/src/application/sessions.ts |
| S4 | judgement | Primitive Obsession：读取 payload 时普遍用 `as` 断言 | sessions.ts、rewind.ts、tracker.ts |
| S5 | judgement | Repeated Switches：工具名分组在多处重复 | decide.ts:13、approval-panel.tsx:76–111 |
| S6 | judgement | Data Clumps：回退文件四元组与 RewindReport 重复 | sessions.ts:635 |
| S7 | judgement | 审批请求的 kind 不是判别联合，提权字段对所有 kind 都可选 | protocol/src/permissions.ts:26–38 |
| S8 | judgement | 模型可见文本在多处重复写成字面量 | gate.ts:52、59、61、112、118 |
| S9 | judgement | Feature Envy：server 自己解析 file_backup 并逐条调用 planRewind | sessions.ts:615–625 |
| S10 | judgement | 错误码到文案的 if 链 | chat-failure.ts:22–32 |
| S11 | judgement | 小项：Speculative Generality、Mysterious Name、平台 hack | 见正文 |

---

## 一、违反已写明的规则（hard）

### H1 正式代码注释引用 `.scratch` 中的具体材料

- 规则：docs/DOCUMENTATION_SYSTEM.md:54。“`.scratch/` 外的文件不得……要求读取其中的具体文件才能理解正文。”第 56 行另要求模块 README 等正式正文“必须独立成立”。AGENTS.md 第 5 条重申了这一点。
- 证据：下列注释用 grilling 编号、票号或 US 编号说明代码的依据。读者不打开 `.scratch/m2-permissions-recovery/grilling.md` 或票文件，就不知道这些编号指什么。
  - packages/agent/src/policy/rules.ts:1（grilling A4）、sandbox.ts:63（B2）、gate.ts:64（US 4）、gate.ts:87（B2）、policy/index.ts:1 与 11（票 02、03、05，票 01）。
  - packages/agent/src/ports/secrets.ts:2（B3）、recovery/plan.ts:1（E3 / E4）、checkpoints/rewind.ts:1、34、223（G3、G4）、checkpoints/index.ts:1（票 07、09）。
  - apps/server/src/application/sessions.ts:202、504、628、660（E3、E4、G3、G4），apps/server/src/adapters/credentials.ts:105（B3）。
  - packages/protocol/src/permissions.ts:76（票 03），apps/desktop/src/renderer/features/conversation/confirmation-panel.tsx:27（E4），packages/agent/src/index.ts 中 “后续票只改各自目录”。
- 修复：删去这些编号，改为引用正式出处，例如 “ADR 0005”“permissions.md#命令沙箱与提权”“recovery.md#判定分类”。注释里需要的理由要能独立读懂，例如 gate.ts:87 写成“提权在拒绝规则之后检查，允许规则与模式放行都不能免掉它（ADR 0005）”。barrel 文件里关于票号和写范围的注释属于过程信息，应当删除。可以用 `rg 'grilling|票 ?[0-9]|（票|US [0-9]' --glob '!.scratch'` 加入 check:docs 或 lint 守卫，防止再次出现。

### H2 Fork 标题是硬编码的英文产品文案

- 规则：docs/tech-stack/ui.md:30。“所有产品文案……都通过类型化的 zh/en 字典提供……用户输入、模型输出、协议值和代码内容保持原文。”
- 证据：apps/server/src/application/sessions.ts:669 把 `` `${source.title.trim() || 'Untitled'} (fork)` `` 写进库。renderer 对空标题用的是 `t('sidebar.untitled')`（sidebar.tsx:201、conversation-pane.tsx:127）。所以 zh 界面里，源 Session 显示“未命名”，分叉出的 Session 却显示 `Untitled (fork)`，而且这个标题成了持久数据，之后切换语言也改不回来。票 09 的 Lead 注释把这一项交给本次评审判断。
- 修复（选一种）：（a）新 Session 的 title 只存源标题，空标题时为空；协议增加 `forkedFrom` 字段，或由 renderer 读取首条 `fork_origin`，再用 `t('sidebar.forkTitle', { title })` 渲染后缀。（b）在 `ForkRequest` 中加入 `title`，由 renderer 用当前 locale 生成后传给 Sidecar。推荐（a），因为标题不会把某一时刻的 locale 固化进库。

### H3 日志字段 `requestId` 的含义被改写

- 规则：docs/tech-stack/observability.md:20。关联字段 `requestId`、`sessionId`、`runId`、`toolCallId` 是统一字段。HTTP 中间件在 apps/server/src/http/app.ts:69–79 中把 `requestId` 定义为每个 HTTP 请求的 UUID。
- 证据：sessions.ts:410（`approval re-decision failed`）、579（`permission rules saved`）、587（`approval answered`）都把审批的 `requestId` 写进同名字段。按 `requestId` 关联日志时，HTTP 请求和审批请求会混在一起。在 579 和 587 两处，同一条日志所在的 HTTP 请求本身就有一个 `requestId`，两个值在语义上相互覆盖。
- 修复：审批 id 改用 `approvalRequestId` 记录，并在 observability.md 的字段清单中登记。如需把 HTTP 的 requestId 带进这些日志，由路由层传入，或绑定到日志上下文中。

### H4 agent 模块结构偏离 agent-runtime.md

- 规则：docs/tech-stack/agent-runtime.md:79–99 的目录约定写的是 “agents/ # Subagents、Teams、Fork、Handoff”“ports/ # 执行、工作区、凭据等宿主接口”。DOCUMENTATION_SYSTEM.md:50 要求新增职责目录前先登记。
- 证据：`forkEntries` 放在 packages/agent/src/checkpoints/rewind.ts:227。新目录 `checkpoints/` 与 `session-entries/` 没有写进目录图。宿主端口 `SnapshotPort`（tracker.ts:12）和 `RewindFiles`（rewind.ts:158）定义在 checkpoints/ 中，没有放进 ports/；而同一批的 `SecretProvider` 放在了 ports/secrets.ts。本批确实修改过 agent-runtime.md（只在第 109、113 行加了 ADR 链接），但没有同步目录图。
- 修复：在 agent-runtime.md 的目录图中登记 `checkpoints/`（Checkpoint、Rewind）和 `session-entries/`（条目 payload），并说明 Fork 暂时与 Rewind 共用条目逻辑、M5 时迁到 agents/。或者现在就把 `forkEntries` 移到 agents/。`SnapshotPort` 与 `RewindFiles` 移到 ports/checkpoints.ts，与 exec、secrets 并列。

### H5 用 effect 镜像 store 状态

- 规则：docs/tech-stack/ui.md:45。“派生值直接计算，不用 effect 在父子组件或多个 store 间镜像同步。”
- 证据：
  - conversation-pane.tsx:117–121 用 effect 把 `conversation.returnedDraft` 推给 composer，再调用 `takeReturnedDraft` 清空 store。这是一个“store → 组件命令式状态 → store”的同步回路。
  - conversation-pane.tsx:102 用 effect 在 `activeSessionId` 变化时把 `rewindTarget` 设为 null。
  - rewind-dialog.tsx:45–49 用 effect 在 `seq` 变化时重置 mode 与 submitting。
- 修复：第 102 行改为把 `rewindTarget` 与 sessionId 绑定（`{ sessionId, seq, text }`），渲染时比较 sessionId，不一致就视为 null。RewindDialog 让调用方传 `key={target?.seq}`，靠重新挂载重置本地状态。returnedDraft 改由 store 动作在产生时直接调用 composer 的 handle，或者让 Composer 用 `useSyncExternalStore` 订阅一个只消费一次的 draft 槽。确实保留 effect 的地方，应在注释中说明这是对命令式编辑器的必要桥接。

---

## 二、风险与正确性（judgement）

### J1 回退代码在写入时跟随符号链接

- 依据：ADR 0005 规定 write 与 edit 的写入边界由权限判断执行，越出可写根要审批。ADR 0006 规定回退把路径“恢复最早的一份备份”。permissions.md 规定按真实路径判定。
- 证据：packages/agent/src/checkpoints/rewind.ts:211–216 对备份时记录的真实路径直接执行 `mkdir(..., { recursive: true })`、`writeFile` 和 `rm`。备份之后，bash 可以把路径中的某个目录换成指向 Workspace 之外的符号链接（例如 `ln -s ~/.ssh dir`），ADR 0006 也说明 bash 的改动不追踪。之后执行回退，写入就会跟随链接落到可写根之外或受保护路径上，既没有审批，也不经沙箱。`writeFile` 是截断后再写，进程中途退出会留下半截文件。
- 修复：写入和删除前，用 `realLocation(path)` 重新解析路径，并确认解析结果仍等于记录的路径（与 tracker.ts:135 的推导相同）。不一致时不写入，在报告中把该路径归入 `diverged`，或另列为 `skipped`。写入改为先写同目录临时文件、fsync、再 rename（与 blobs/store.ts:85–111 相同）。同时把写入和删除也放进 `RewindFiles` 端口（见 S9），这样可以用替身测试这些情况。

### J2 提权与“先被沙箱拒绝”没有关联

- 依据：ADR 0005:31 写的是“被沙箱拒绝的命令只能以更宽档位重试一次”。GLOSSARY.md:81 对 Escalation 的定义是“被沙箱拒绝的调用经用户批准、以更宽沙箱档位重试一次”。
- 证据：gate.ts:89–94 只检查 `checkEscalation` 中的档位和理由，不检查同一 Run 内这条命令是否刚被沙箱拒绝过。模型第一次调用任何 bash 时都可以请求 `danger-full-access`。只要用户在提权卡上点允许，命令就不经 workspace-write 档位直接执行。docs/subsystems/permissions.md 的提权参数表与代码一致，问题在于 ADR 和 GLOSSARY 的措辞更严格。
- 修复：二选一并在同一批交付中统一。（a）代码向 ADR 看齐：gate 记录本 Run 内被拒绝的 `(command, mode)`，例如运行时观察带 `details.sandbox.denied` 的 toolResult；没有被拒绝过的命令带提权参数时返回 `invalid escalation: …not denied…`。（b）如果有意允许预先提权，就修改 ADR 0005 的决定句和 GLOSSARY 的定义，写成“请求以更宽档位单次运行，每次都要批准”，并记录日期与理由。

### J3 暂停覆盖了规则拒绝的文本

- 证据：runtime.ts:266–274 中，只要 `run.paused` 为真且 gate 返回 block，就把原因改写成 `PAUSED_BEFORE_APPROVAL_TEXT`。暂停之后才准备的同批调用，即使被拒绝规则拦下、因参数错误被拦下，或因 `rejected()` 被跳过，模型收到的文本也都会变成“the user paused the run before this call was approved”。packages/agent/README.md 的契约只说“等待中的审批以 cancelled 结束……toolResult 为 PAUSED_BEFORE_APPROVAL_TEXT”。
- 修复：只在 broker 的 resolution 为 `cancelled`、且取消原因是暂停信号时改写。可以让 `gate` 在这种情况下返回 `{ block: true, reason: CANCELLED_MARKER }`，或者 gate 接收 `pauseSignal` 后由它自己决定文本。补一个用例：暂停后同批的拒绝规则调用仍得到 `Permission denied by rule …`。

### J4 Secrets 隔离依赖名字模式

- 依据：packages/agent/src/ports/secrets.ts:2–4 的契约是“other calls, including bash, do not see them”。apps/server/README.md 的“Secrets”一条描述了同样的语义。
- 证据：`createEnvSecretProvider(env)`（credentials.ts:108–110）从 Sidecar 自身的环境读取密钥。bash 的环境只按 `HOST_ENV_EXCLUSIONS`（62–71 行）的名字模式剔除变量。当前只有 `COKO_TEST_SECRET`，它恰好被 `^COKO_` 剔除。M3 的 MCP 如果声明 `NPM_REGISTRY_PASS` 或 `SENTRY_DSN` 这类不匹配模式的名字，bash 用 `env` 就能读到。
- 修复：Secrets 只从专用前缀读取，例如 `COKO_SECRET_<NAME>`，这个前缀已被 `^COKO_` 剔除；或者把所有已注册工具声明的 `secrets` 名字动态加入 bash 的剔除列表。同时在 credentials.ts 写明这个不变量，并在 secrets-gate 中加一个不匹配名字模式的密钥用例。

### J5 缺少密钥时 `tool_exec` 已经提交

- 依据：packages/agent/README.md 的工具契约写的是“缺失时调用失败且不执行”。执行记录的含义是“有 `tool_exec` 而没有 toolResult 的调用可能已执行”。
- 证据：包装顺序是 `withScheduling(withTimeout(withContext(tool)))`（runtime.ts:242），所以 `recordExecution`（scheduler.ts:108）先于 `resolveSecrets`（runtime.ts:233）执行。声明了 secrets 的 side-effect 工具缺少密钥时，Session 中先有 `tool_exec`，再有错误结果。这条执行记录表达的“开始执行”并不成立。M3 的 MCP 是 side-effect 工具，届时会遇到这种情况。
- 修复：在 gate 之后、调度之前解析密钥，例如放进 beforeToolCall，或者在 `withScheduling` 调用 `recordExecution` 之前做一次预检。补一个 side-effect 加 secrets 缺失的用例，断言没有 `tool_exec`。

### J6 待确认状态有两个事实来源

- 证据：`#start`（sessions.ts:505）判断的是内存中的 `#awaitingConfirmation`。这个集合由启动扫描建立，在 `answerConfirmation` 中以 `pending.length === 1` 为条件移除。`#exclusively`（607 行）判断的是 `unansweredConfirmations(entries)`。596–597 行的注释说两者是“与 #start 同一判断：unansweredConfirmations”，与代码不符。目前 `confirmation_request` 只由启动扫描产生，所以还没有出错。但任何新的写入路径都会让两个来源不一致。
- 修复：统一成一个来源。可以把 `#awaitingConfirmation` 改成由条目派生的缓存，每次 commit 或 publish `confirmation_*` 时更新；或者 `#start` 也读条目。同时修正注释。

---

## 三、坏味道（judgement）

### S1 Duplicated Code：两份条目 schema 已经出现差异

- 证据：packages/protocol/src/{runs,permissions,checkpoints}.ts 与 packages/agent/src/session-entries/{runs,permissions,checkpoints,tools}.ts 各自定义了 RunStatus、PermissionMode、SandboxMode、PermissionRule、ApprovalRequest/Decision、FileBackup 等。已经出现的差异：protocol 的 assistant message 有 `errorMessage`（protocol runs.ts:49），agent 的没有（agent runs.ts:41）；protocol 的 toolResult 有 `details`，agent 的没有；agent 的 file_backup 内联写了 `Type.String({ minLength: 1 })`，protocol 用的是 `Path` 常量。票 10 已为 ProviderKind 加了 `ProviderKindsAgree` 编译期断言（apps/server/src/application/providers.ts:22–23），这批条目 schema 没有同类保护。如果某一侧收紧了 schema，renderer 会在信任边界（chat-store.ts 中 `Value.Check(SessionEntry, record)`）静默跳过条目，这类故障很难排查。
- 修复：在 apps/server 增加 `type EntryPayloadsAgree = Assert<Equal<SessionEntryPayloads[K], Static<SESSION_ENTRY_PAYLOAD_SCHEMAS[K]>>>`，逐个 kind 比较，至少覆盖非 message 的 kind。再加一个测试：用 agent 的 schema 生成合法 payload，确认它们能通过 protocol 的 `SessionEntry` 校验。

### S2 Duplicated Code：条目派生逻辑写了三份

| 概念 | agent / server | renderer |
| --- | --- | --- |
| 被回退区间与有效条目 | agent checkpoints/rewind.ts:17–26 | chat-store.ts:78–88 |
| 上一 Run 状态 | server sessions.ts:112–119 | chat-store.ts:90–97 |
| 未回答的确认 | agent recovery/plan.ts:127–136 | chat-store.ts:145–159 |
| 规则回放与 sameRule | server permissions.ts:25–32、sessions.ts:318–323 | chat-store.ts:108–120（重复添加时移到末尾，server 保留原位） |
| 用户消息文本 | runtime.ts:163（用 `''` 连接）、rewind.ts:81（用 `\n`） | chat-store.ts:258、timeline.ts:67（各一份，都用 `\n`） |
| `isRecord` / `str` | plan.ts:47、rewind.ts:78 | approval-panel.tsx:20、tool-cards.tsx:20、confirmation-panel.tsx:12 |

- 后果：ADR 0006 要求时间线与模型上下文一致（chat-store.ts:82 的注释也这样写）。目前一致只靠两份代码同步修改来维持。
- 修复：把只依赖条目信封的纯函数（`rewoundRanges`、`effectiveEntries`、`lastRunStatus`、`unansweredConfirmations`、`replaySessionRules`、`userMessageText`）放进 protocol。protocol 运行时无关，renderer 与 server 都可以依赖。agent 由于不依赖 protocol，可以保留自己的实现，但要与 protocol 版本跑同一组共享 fixture。`contentText` 的两份 renderer 实现合并为 timeline.ts 中的一份。

### S3 Divergent Change：SessionService 承担过多职责

- 证据：apps/server/src/application/sessions.ts 有 768 行，包含运行时创建与缓存（711–767）、Run 控制（456–559）、权限状态回放与串行锁（302–416）、审批回答与规则保存（566–591）、启动恢复与结果确认（207–280）、回退与分叉（593–694），以及模型解析。每张 M2 票都修改过这个文件，这正是 Divergent Change 的表现。docs/tech-stack/architecture.md 只规定 application 是“业务入口”，没有限制大小，所以这一项是 judgement。
- 修复：按职责拆出 `SessionPermissions`（state、lock、reevaluate）、`RecoveryService`（recover、answerConfirmation）、`CheckpointService`（checkpoints、rewind、fork、exclusive）。它们共用一个 `SessionRuntimes` 注册表，提供 get、discard 和 publisher。`SessionService` 只保留 Run 控制与 DTO。

### S4 Primitive Obsession：payload 普遍用 `as` 断言

- 证据：sessions.ts:116、232、277、319、321、618、620；rewind.ts:18、110、114、122、126、149；tracker.ts:74。票 01 已在 renderer 的 timeline.ts 中去掉 payload 的 `as` 断言（A20），server 与 agent 在本批却新增了 15 处以上。这些值虽然已经过存储读取时的 schema 校验，类型系统仍然看不到 kind 与 payload 的对应关系。
- 修复：在 agent 导出 `type StoredEntryOf<K extends SessionEntryKind> = { kind: K; payload: SessionEntryPayloads[K]; seq; runId }`，以及一个类型守卫 `isEntry(entry, kind)`。server 与 checkpoints/recovery 改为基于这个守卫收窄类型。

### S5 Repeated Switches：工具名分组写在多处

- 证据：内置工具到 read、write、command 组的映射，在 decide.ts:13 写了一次，在 approval-panel.tsx:76–111 的 `switch` 和 `TITLE` 表中又写了一次。effect（read 或 side-effect）在各内置工具上还声明了一次。新增内置工具时，至少要改 3 处。
- 修复：在 protocol 导出 `BUILTIN_TOOL_GROUPS`（`{ read: ['read','grep','find','ls'], edit: ['write','edit'], bash: ['bash'] }`），decide.ts 和 approval-panel 都从这里读取。或者在 `ApprovalRequestPayload` 中带上 `group`，renderer 按 group 选择标题和明细，不再判断工具名。

### S6 Data Clumps：回退文件四元组

- 证据：`{ restored, deleted, diverged, untracked }` 在 agent 中定义为 `RewindReport`（rewind.ts:166），在 sessions.ts:635 又以内联字面量重建一遍，protocol 的 `RewindResponse` 中也有一份。
- 修复：sessions.ts 使用 `RewindReport` 类型和一个 `emptyRewindReport()` 工厂。protocol 中可以用 `Type.Object({ ...RewindFilesShape })` 复用字段定义。

### S7 审批请求不是判别联合

- 证据：protocol permissions.ts:26–38 与 agent session-entries/permissions.ts:28–43 中，`targetMode` 和 `justification` 对 kind=tool 和 kind=escalation 都是可选字段，所以 approval-panel.tsx:52 需要写 `request.targetMode ? … : ''`。一个 kind=escalation 但缺少 targetMode 的条目能通过校验。
- 修复：改为 `Type.Union([Tool{kind:'tool', suggestions}, Escalation{kind:'escalation', targetMode, justification, suggestions: []}])`。这是 payload v2，需要提供一个 `migrate`（v1 原样保留）。

### S8 模型可见文本在多处重复

- 证据：`'Operation aborted'` 在 gate.ts:59、61、118 写成字面量，scheduler.ts:9 已导出 `OPERATION_ABORTED`，timeout.ts:44 和 paths.ts:20 也各写了一次。`'Run stopped: the record could not be saved'` 在 gate.ts:52 和 112 重复。gate.ts:58–61 的 cancelled 与 superseded 两个分支完全相同。
- 修复：这些字符串属于模型可见契约，与 REJECTED_TEXT 等放在一起导出为常量，并合并重复的分支。

### S9 Feature Envy：checkpoint 的计算和写入不在同一处

- 证据：sessions.ts:615–625 的 `checkpoints()` 在 server 中自己解析 `file_backup` 的 payload，并对每条用户消息调用一次 `planRewind`。每次调用都会重算 `effectiveEntries`，复杂度为 O(n²)，而 server 只需要其中的 text。另外，`RewindFiles` 端口只覆盖读取（hashFile、readBlob），写入和删除在 rewind.ts:213–216 直接调用 node:fs，因此端口只做了一半。
- 修复：在 agent 导出 `listCheckpoints(entries)`，一次遍历返回 `{ seq, text, createdAt, paths }`。`RewindFiles` 增加 `writeFile` 和 `remove`，由 Sidecar 实现，并同时完成 J1 的真实路径复核。

### S10 错误码映射用 if 链

- 证据：apps/desktop/src/renderer/app/chat-failure.ts:24–30 中，每加一个错误码都要多写一行 `if (failure.error.code === …)`。同一文件已经用 `KIND_KEYS` 表处理 kind。
- 修复：增加 `const CODE_KEYS = { … } as const satisfies Partial<Record<ErrorCode, MessageKey>>`，写成 `return t(CODE_KEYS[code] ?? KIND_KEYS[kind])`。

### S11 小项

- Speculative Generality：`CheckpointTrackerOptions.tools`（tracker.ts:36）与 `RewindPlanOptions.tools`（rewind.ts:75）只用默认值 `CHECKPOINT_TOOLS`，没有调用方传入。可以先删除，等宿主工具需要追踪时再加。
- Mysterious Name：`SessionService.#pending`（sessions.ts:162）存的是“正在创建的运行时”，容易与 `pendingApprovals` 混淆。建议改为 `#runtimeCreations`。
- Duplicated Code：mode-picker.tsx:20 的 `PERMISSION_MODES` 手写了四个模式，可以从 `PermissionMode.anyOf` 派生，票 10 对 `ProviderKind` 就是这样处理的。
- 平台 hack：rewind-dialog.tsx:24–30 的 `displayPath` 用 `/private` 前缀字符串处理 macOS 的 realpath 差异。建议由 Sidecar 在 `RewindResponse` 或 `Checkpoint` 中返回相对 Workspace 真实路径的路径，renderer 不再自己推断。

---

## 有意不报（Lead 已接受，或属于已记录的取舍）

- protocol 中 `createRequestTracker` 的位置（票 10 规格就是这样要求的），以及 `COKO_TEST_HOLD_*` 测试开关直接读环境变量（票 08、09 已接受）。
- bash 可以写 Workspace 内的 `.git` 等受保护路径（ADR 0005 规定受保护路径只约束 edit 组），非 darwin 平台上受限档位 fail-closed，无反馈拒绝提权时结束 Run，`~/.npm` 与 `~/.cache` 不默认可写。
- 恢复补齐的结果不提交 file_change，被中断 Run 的路径不标记为 diverged，M1 库中没有 run_start 的 Run 不被识别，待确认结果不存在时返回 404 `not-found`。
- 同批调用中，后一个调用的 file_backup 可能排在前一个调用的 tool_exec 之前；分叉不复制 Run 生命周期条目。
- 各票越出 Write scope 的最小改动（errors.ts、client/api.ts、chat-failure.ts、fixture 等）。

## 未读或只抽样的部分

- **逐行读过**：packages/agent 中的 policy/*（decide、rules、paths、sandbox、gate、broker、index）、engine/runtime.ts 与 types.ts 的 diff、ports/*、tools/types.ts、scheduler.ts、timeout.ts、builtin/bash、write、edit 的 diff、session-entries/*、recovery/plan.ts、checkpoints/*；packages/protocol 中的 permissions、runs、checkpoints、entries、control 与 http、ws 的 diff；packages/session 中的 blobs/store.ts、sqlite/recovery.ts、payloads.ts、types.ts 的 diff；apps/server 中的 sessions.ts、permissions.ts、layers.ts、http/app.ts、adapters/{seatbelt,credentials,checkpoints,test-tools}.ts、config.ts；apps/desktop 中的 main/{credentials,sidecar-process,index} 的 diff、renderer 的 client/api.ts 与 chat-store.ts 的 diff、chat-failure.ts、approval-panel、rewind-dialog、mode-picker、confirmation-panel、timeline.ts 与 conversation-pane.tsx 的 diff。
- **只用 grep 抽样（检查 i18n 字面量、sleep、跨测试导入、临时目录）**：packages/ui 的 approval-card、confirmation-card、dialog、sonner、composer-editor，desktop 的 permissions-section、tool-cards、timeline-view、composer、sidebar、settings-store，以及新增的测试文件。
- **没有读**：所有 `*.test.ts(x)` 与 e2e 的用例主体（只做了上述 grep），tests/integration/* 与 sidecar-harness.ts，tests/fixtures/v1-database.ts，packages/i18n 的字典（由 tsc 的 MessageKey 检查一致性），packages/session 的 sqlite/{open,repositories,schema}.ts、internal.ts、memory/index.ts、repository-contract.ts，apps/server 的 adapters/{faux,ripgrep}.ts、application/{hub,providers,settings,errors}.ts，agent 的 models/registry.ts，以及 vitest 配置。
- **没有执行**：本评审没有运行任何测试或检查命令，结论均来自源码阅读。

## 处理结果

2026-10-29，票 11（分支 `m2/11-review-fixes`）。

| 编号 | 处理 | 测试 |
| --- | --- | --- |
| H1 | 源码与测试注释中的票号、grilling 编号与"后续票只改本目录"之类过程信息删除，必要依据改写为 ADR 0004–0006、permissions.md、recovery.md。未加 lint 守卫（可选项，check:docs 只查 Markdown，留给 Lead 决定） | 全仓 `grilling|票 ?[0-9]|（票|US [0-9]` 检索为空（`.scratch` 除外） |
| H2 | 分叉标题由 renderer 按当前语言生成（`sidebar.forkTitle`），经 `ForkRequest.title` 传入；省略时 Sidecar 沿用原标题，不再写英文后缀 | `sidecar-rewind.test.ts`（给定 title 与省略）、`chat-store-rewind.test.ts`、`rewind.e2e.test.ts` |
| H3 | 审批日志改用 `approvalId`；observability.md 登记：`requestId` 只表示 HTTP 请求 | 代码检索 |
| H4 | `forkEntries` 移到 `agents/fork.ts`；`SnapshotPort`、`RewindFiles` 移到 `ports/checkpoints.ts`；agent-runtime.md 目录图登记 `checkpoints/`、`session-entries/` | typecheck、agent 全部测试 |
| H5 | rewind 目标与 sessionId 绑定，切换会话视为关闭；RewindDialog 每次打开以 key 重新挂载，去掉重置用的 effect；退回草稿改为订阅 store 的退回槽交给命令式编辑器，注释说明这是必要桥接 | renderer 单元测试、`rewind.e2e.test.ts`、`run-control.e2e.test.ts` |
| J1 | 写入侧见 Spec 评审 F5，回退侧见 F6 | 同上 |
| J2 | 采用 (a)：gate 记录本 Run 中被沙箱拒绝的命令（合并空白后），没有被拒绝过的命令带提权参数为参数错误，不询问 | `execution-checks.test.ts`、`escalation.test.ts`（改为先被拒绝再提权）、`sidecar-sandbox.test.ts` |
| J3 | 只有被暂停取消的审批（gate 返回 `OPERATION_ABORTED_TEXT`）改写为"暂停前未批准"；复核审批同样处理 | `execution-checks.test.ts` |
| J4 | 不做。当前唯一的 Secret 使用者是测试工具，真实使用者（M3 的 MCP）接入时要重新决定密钥来源与映射；F8 已堵住读取 Provider Credential 的口子 | — |
| J5 | Secrets 在调度器新增的执行前准备中解析，早于 `tool_exec` | `execution-checks.test.ts` |
| J6 | `#awaitingConfirmation` 是条目派生的缓存，`#commitBatch` 提交 `confirmation_*` 时重算；`#start`、`#exclusively`、toDto 都经 `#awaitsConfirmation` 读取；注释修正 | `sidecar-recovery.test.ts`、`sidecar-rewind.test.ts`（confirmation-pending） |
| S1 | 做。`apps/server/src/application/entry-payloads.ts` 编译期断言 kind 集合相等、message 以外各 kind 的 payload 类型相等（临时改动 protocol 的 RunEndPayload 确认 tsc 失败后撤销）；message 用共享样例比较两侧判定，发现并对齐了差异（agent 的 assistant 缺 `errorMessage`、toolResult 缺 `details`） | `entry-payloads.test.ts` |
| S2 | 不做。把派生函数移入 protocol 会改动 renderer、server、agent 三处共享装配点，属于重构；S1 的等价断言先挡住 schema 漂移 | — |
| S3 | 不做。拆分 SessionService 是独立的结构重构，适合放在 M3 改动 sessions.ts 之前单独一票 | — |
| S4 | 不做。类型守卫要随 S3 一起设计，本票只在新代码中避免新增 `as` | — |
| S5 | 不做。工具分组表移入 protocol 会改变 agent 不依赖 protocol 的方向，需要先决定归属 | — |
| S6 | 部分：sessions.ts 改用 agent 的 `emptyRewindReport()`；protocol 侧字段复用未做 | — |
| S7 | 不做。判别联合是 payload v2，需要迁移，超出评审修复范围 | — |
| S8 | 部分：gate 的 `Operation aborted` 与记录失败文本改为导出常量，cancelled 与 superseded 分支合并；timeout.ts、paths.ts 中的字面量未动 | — |
| S9 | 部分：`RewindFiles` 增加 `writeFile`、`remove`，回退写入经端口完成（见 F6）；`listCheckpoints` 未做 | — |
| S10 | 不做。错误码映射多了一行 `recovery-failed`，表驱动改写留给下次整理 | — |
| S11 | 不做（小项） | — |
