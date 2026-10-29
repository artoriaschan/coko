# M3 里程碑 Spec 轴评审（只读）

范围：`git diff 9cd5675...HEAD`（不含 pnpm-lock.yaml、.scratch），对照 [spec.md](spec.md)、[grilling.md](grilling.md) 与 issues/01–12 及其 Comments。已在票 Comments 中被 Lead 接受的偏离不再列出，除非其实现本身有误。

严重度：**hard** = 违反规格条文、安全边界或产生错误结果，合入前应修；**judgement** = 规格未明说或属风险取舍，建议修。

验证方式：逐文件阅读代码与测试；另在 `/tmp` 写了两个探针脚本（未改仓库文件），用 node 直接调用仓库源码复现 F2、F3、F4；运行了 `rules.test.ts`、`rewind.test.ts`、`compaction.test.ts`、`entries.test.ts`（4 个文件 83 例通过，说明这些缺口不在现有用例覆盖内）。

---

## (c) 已实现但有误

### F1 已登记 Secret 的明文会进入模型上下文；入库脱敏与内存上下文不一致 — hard

- 位置：`apps/server/src/application/session-runtimes.ts:25-35`（toolResult 只在 `toNewEntry` 提交时经 `redactSecretsDeep` 替换）、`:43`（只脱敏 tool_update / tool_end 进度）；`packages/agent/src/extensions/mcp/tool.ts:68`、`results.ts:36-63`（MCP 结果原样进入运行时）；`packages/agent/src/engine/runtime.ts:464-470`（运行时内存中的 toolResult 是未脱敏对象，下一次请求原样发给模型）。`packages/agent/src/engine` 中没有任何按值脱敏的调用。
- 规则：spec.md:43（故事 15"Secret 不出现在命令环境、协议、库明文与日志中"）；ADR 0007"决定"第 1、3 条；本次评审要求核对"登记的 Secret 能否经 M3 新通道到达模型"。
- 现象：MCP Server（或 `read_mcp_resource`、bash 读到的文件）把 Secret 值放进结果时，库与 WS 中是 `[REDACTED:secret]`，但同一 Run 的后续请求里模型看到的是明文。由此有两个后果：
  1. 模型回显的 assistant 文本、toolCall 参数（含 `approval_request.subject`、`tool_start.args`）、压缩摘要（`compaction.summary`）都不经按值脱敏（`toNewEntry` 只处理 assistant 的 `errorMessage`），明文会进入库、WS 与 HTTP。
  2. Sidecar 重启后运行时从条目重建，模型看到的是 `[REDACTED:secret]`，同一会话前后上下文不一致。
- 测试缺口：`tests/integration/secrets-gate-mcp.test.ts:115-122` 扫描的通道不含 faux `requestLog`，faux 脚本也不回显工具结果，所以这条路径没有被测到。
- 修复：在工具结果进入运行时之前替换，作为唯一的替换点：例如在 `application/context/` 增加一个 afterToolCall hook，或在 `createMcpTools` / `createMcpResourceTools` 的 `execute` 返回前对文本块调用 `redactSecretValues`（bash 等内置工具同样经该 hook）。保留 `toNewEntry` 作为第二道防线。总闸测试的通道加入 `requestLog`，另加一例让 faux 模型把上一条工具结果原样写进 assistant 文本。

### F2 指令文件经符号链接越出仓库根（目录链与嵌套加载都受影响）— hard

- 位置：`packages/agent/src/instructions/rules/loader.ts:76-87`（`visit` 对目录链上的文件只做 realpath 去重，不检查 `realRoots`）、`:131-140`（`visitDirectory`）、`:164-169`（`nested`）；边界检查只在 `:104-108` 的 @import 分支。
- 规则：spec.md:21（故事 3"不越出仓库或 `~/.coko`"）；grilling A2（:63"家目录及以上不读"）、A4（:69 允许的根）；ADR 0008"注册 Workspace 即同意读取"只覆盖 Workspace 内的文件。
- 复现（/tmp 探针，调用仓库的 `createInstructionLoader`）：`<ws>/AGENTS.md -> /outside/secret.txt`、`<ws>/sub/AGENTS.md -> /outside/secret.txt`，`load()` 与 `nested()` 都把 `TOPSECRET` 作为 `scope: project / nested` 注入，诊断为空。克隆的仓库只要放一个符号链接，就能把家目录中的任意文本文件（如 `~/.aws/credentials`、`~/.ssh/config`）放进系统提示，绕过 @import 的边界检查。
- 修复：`visit` 对 `scope !== 'user'` 的文件要求 `realpath` 落在 `walk.realRoots` 内（user 级要求在 `cokoHome` 的 realpath 内），否则记 `instruction-outside-boundary` 诊断并跳过；`nested()` 另要求 `realpath(targetDir)` 在 `realpath(cwd)` 内。在 `rules.test.ts` 加目录链与嵌套两例。

### F3 项目 Skill 目录经符号链接把 Workspace 外的目录变成免审批读取根 — hard

- 位置：`packages/agent/src/instructions/skills/loader.ts:70-76`（项目位置下的 Skill 根不做边界检查，`baseDir` 取词法路径）；`apps/server/src/application/context/skills.ts:94-96`（`readRoots` 返回全部启用 Skill 的 `baseDir`）；`packages/agent/src/policy/gate.ts`（`readRoots` 经 `realLocation` 解析为真实路径）；`policy/decide.ts` 的 `readable()`。
- 规则：ADR 0008 :20-22（项目文件"只提供上下文，不改变权限判定"）；spec.md:127（`readRoots` 只给 Skill 目录）。
- 复现：`<ws>/.coko/skills/tool -> /outside/tool`（含合规的 `SKILL.md`）被发现为 `scope: project`，诊断为空。gate 把它解析为 `/outside/tool`，之后在 default 与 read-only 模式下对该外部目录的 read / grep / find / ls 都免审批。仓库可借此指向家目录中任何含 SKILL.md 的目录（例如用户的 `~/.agents/skills/<x>`）。`skill` 工具（context-read，所有模式放行）也会列出外部目录的文件清单。
- 修复：对 `scope: 'project'` 的位置，要求 `realpath(skill.baseDir)` 与 `realpath(SKILL.md)` 在 `realpath(cwd)` 内，否则记 `skill-outside-workspace` 诊断并不加载；`readRoots` 只返回通过检查的目录。在 `sidecar-skills.test.ts` 加一例：符号链接 Skill 不加载，读取外部文件仍出现审批。

### F4 分叉后回退到分叉中第一条保留消息，压缩摘要与原历史都丢失 — hard

- 位置：`packages/agent/src/agents/fork.ts:22-28`（compaction 条目排在被保留的消息之后，`firstKeptSeq: 1`）；`packages/agent/src/entries/derive.ts:27-36`（compaction 落在回退区间内即失效）。
- 规则：spec.md:56（故事 23"回退到压缩之前时原历史恢复"）；grilling F6（:171）；spec.md:54（故事 21：目标、约束和用户说过的话被保留）。
- 复现（/tmp 探针，调用仓库的 `forkEntries` / `modelContext` / `rewindTarget`）：原 Session 为 `A-constraint, B, C, [compaction firstKeptSeq=C], D`，从 D 分叉得到 `1 fork_origin, 2 C, 3 ok, 4 compaction`。在分叉中回退到 seq 2（`rewindTarget` 接受它为 Checkpoint）后 `modelContext` 为 `[]`：摘要被一起回退，而分叉中没有压缩之前的原消息可以恢复。原 Session 做同样的回退得到 `["A-constraint","ok","B","ok"]`。用户在分叉中重试第一条消息时，Agent 会丢掉全部较早的约束。
- 修复：`forkEntries` 把 compaction 放在 `fork_origin` 之后、保留的消息之前，`firstKeptSeq` 取第一条保留消息在新 Session 中的序号（2）。同时调整 `context/compaction/plan.ts:114-128` 的 `estimateCompactedTokens`：它用 `entry.seq > compaction.seq` 判断"压缩之后的新 usage"，compaction 排在前面后保留的消息会被误当成新消息，要改为按保留区间之后的消息判断。`rewind.test.ts` 补"分叉 → 回退到第一条保留消息"用例，`sidecar-compaction.test.ts` 补协议层用例。

### F5 MCP 规则名不区分大小写，项目 Server 能继承全局 Server 的 allow 规则 — judgement

- 位置：`packages/agent/src/policy/decide.ts` 的 `matchesTool`（规则与工具名都转小写后比较）；`packages/agent/src/extensions/mcp/naming.ts:26-28`（`serverNamesConflict` 只把 `-` 与 `_` 视为等价，不比较大小写）；`apps/server/src/application/context/mcp.ts:146-148`。
- 规则：ADR 0008 :21（项目 Server 逐个批准，与全局同名时被忽略）；grilling D7（:145 规则 `mcp__<server>` 匹配该 Server）。
- 现象：用户为全局 Server `github` 保存了 `mcp__github` allow 规则。项目 `.mcp.json` 定义 `GitHub`，它不算同名（不被遮蔽），也不算冲突。用户批准它启动后，`mcp__GitHub__*` 的工具调用在 default 模式下命中这条 allow 规则，免审批。项目文件借命名拿到了用户为另一个 Server 授予的权限。
- 修复：`serverNamesConflict` 与 `shadowed-by-global` 判定统一按"转小写且 `-`→`_`"比较，或者规定 `mcp__` 规则大小写敏感。二选一，前者更简单。

### F6 @import 接受 `.env`，指令加载不遵守 Read 拒绝规则 — judgement

- 位置：`packages/agent/src/instructions/rules/imports.ts:5-13`（`TEXT_EXTENSIONS` 含 `env`、`example`）；`loader.ts:89-119` 不读权限规则。
- 规则：grilling A4 :69（"只接受文本扩展名（md、txt、json、yaml、yml、toml 等）"）；grilling E1 :93（同为不经审批注入上下文的 File Reference 遵守 Read 拒绝规则）。
- 现象：仓库的 AGENTS.md 写 `@./.env` 时，用户在本地创建的 `.env`（通常被 gitignore）会进入每次请求的系统提示，用户的 `Read(.env)` 拒绝规则对它无效。
- 修复：从 `TEXT_EXTENSIONS` 去掉 `env`、`example`；loader 接受作用域中的 Read 拒绝规则（与 `expandFileReferences` 的 `denialOf` 相同），命中时记 `import-denied` 诊断。

### F7 压缩摘要请求的输入没有上限，大的 File Reference 块原样进入 — judgement

- 位置：`packages/agent/src/context/compaction/prompt.ts:101-127`（user 消息全文序列化，含 `<file_reference>` 块；只截断 toolResult；图片被静默丢弃）；`engine/runtime.ts:522-538`（摘要请求溢出时没有降级）。
- 规则：spec.md:54（故事 21：长任务不中断）；grilling F3 :162、F5 :168。
- 现象：引用了几个 50KB 文件的 user 消息会让摘要请求本身溢出。自动压缩连续失败 3 次后熔断，`/compact` 同样失败，用户无法继续这个会话。
- 修复：序列化时把 `<file_reference>` / `<instruction_file>` 块缩为路径加"已附加"一行，用户自己写的文本仍逐字保留；按 `effectiveWindow − SUMMARY_MAX_TOKENS` 限制总输入，超出时先丢最早的工具结果；用 `[image omitted]` 标出被省略的图片。

### F8 提交消息先展开再检查 Run 是否进行中 — judgement

- 位置：`apps/server/src/application/sessions.ts:325-331`（`expandInput` 在 `isRunning` 检查之前；input 路径的 409 在 `#start` 中更晚）。
- 规则：grilling C4 :116（Run 进行中提交动作命令时 409）。
- 现象：Run 进行中提交 `/mcp__srv__x` 或 `/<skill>` 时，会先调用 MCP `prompts/get`（可能在 Server 一侧产生副作用）、读取 Skill 与引用文件，然后才返回 409。
- 修复：`submit` 开头先检查 `this.#runtimes.isRunning(sessionId)`，进行中直接 409。两条路径在进行中本来都返回 409，提前检查不改变结果。

### F9 时间裁剪的触发点比规格多 — judgement

- 位置：`packages/agent/src/context/usage/trim.ts:29-45`。
- 规则：spec.md:111（"距最后一条 assistant 超过 60 分钟时，保留最近 5 个 toolResult"）。
- 现象：历史中任意一次超过 60 分钟的间隔都成为裁剪点。即使当前缓存是热的，那个点之前的较早结果也会被替换。这是为了前缀稳定而做的扩展，票 10 的 Comments 没有记录。
- 修复：在票 10 与 context.md 记录这一语义并请 Lead 接受；否则只保留 `now − lastAssistant > 60min` 这一个触发点。

---

## (a) 缺失或不完整

### M1 设置中没有 MCP、自动压缩、时间裁剪、指令、命令的能力开关 — hard

- 规则：spec.md:65（故事 26"在设置中开关 Skills、MCP、Memory、自动压缩等能力"）；spec.md:117-120（schema 中的 8 个开关）。
- 现状：只有 `skills-section.tsx:110-128`（skills.enabled）与 `memory-section.tsx:71-98`（memory.enabled）有开关。`mcp-section.tsx:72` 只在关闭时显示一行警告，没有开关。`context.autoCompact`、`context.trimOldToolResults`、`instructions.enabled`、`commands.enabled` 在界面中都无法修改，`context-ring.tsx:150-154` 只显示状态。没有票负责这些开关，属于切票缺口。
- 修复：在对应分区（MCP 分区顶部；General 或新的"上下文"行）加开关，经 `PUT /api/config` 带回其他全局键；项目已关闭时注明，与 skills / memory 相同。E2E 断言开关读回与项目覆盖提示。

### M2 项目 MCP Server 的批准对话框不显示 env 与 header 的值 — judgement

- 位置：`apps/server/src/application/context/mcp.ts:92-95`（`launchOf` 只给 `envNames` / `headerNames`）；`mcp-section.tsx:268-273`。
- 规则：spec.md:41（故事 14"看过完整命令并批准"）；grilling D2 :122 写的是"env 名 / headers 名"，名义上已满足。
- 风险：项目项不能含 `${…}`（`config.ts:186-190`），值里不会有用户的 Secret。但 `NODE_OPTIONS=--require ./x.js`、`PATH=./bin:…` 这类值会改变实际执行的程序，而且摘要包含这些值。用户只看到名字，就是在不知道实际执行什么的情况下批准。
- 修复：project scope 返回并显示 env 与 header 的完整值；global scope 维持只显示名字。

### M3 Credential 明文没有登记到按值脱敏 — judgement

- 位置：`apps/server/src/adapters/credentials.ts:17-55`（IPC Credential 缓存没有调用 `registerSecretValues`）；`application/secrets.ts:34` 只登记 Secret。
- 规则：票 07 Comments 中 Lead 的第二条（共享脱敏同时替换已登记的明文，Memory、工具结果、日志共用）；票 09"未验证项"第 2 条明确把"按值比对 Credential"留给后续。
- 现状：不带 `sk-` / Bearer 形态的 Provider 密钥（例如自定义 OpenAI 兼容服务的密钥）被模型错误回显后写进 Memory 或工具结果时，仍是明文。
- 修复：`createIpcCredentialStore` 与 `createEnvCredentialStore` 读到的值同样登记为脱敏来源；`secrets-gate-memory.test.ts` 改用非 sk- 形态的 Credential。

---

## (b) 范围扩张

没有发现未经 Lead 接受的功能扩张。附带改动都已在各票 Comments 中裁决：`GET /api/commands` 先连接 MCP、`dirname(COKO_HOME)/.agents/skills`、foreground-watch 脚本、packager tmpdir、supervisor stop 竞态修复、`/compact` 无可摘要内容时 400。F9 是唯一未记录的语义扩展。

---

## 已核对、未发现问题

- **项目文件只收紧**：`config/merge.ts:48-123` 只接受 false、`skills.disabled` 追加与 deny / ask，allow / defaultMode / true 给出 `project-cannot-grant` 诊断；`application/permissions.ts` 的 project 规则只有 deny / ask。项目 Skill / 命令的 frontmatter 不影响判定。项目 `.mcp.json` 任何字段含 `${` 都拒绝加载（`extensions/mcp/config.ts:123-129、186-190`）。stdio 环境经 `HOST_ENV_EXCLUSIONS` 去掉 `COKO_*`（含 `COKO_SECRET_*`），见 `adapters/mcp.ts:18-20`。除 F2、F3、F6 外，没有发现项目文件拿到 Secret 或授予权限的路径。
- **MCP 批准摘要**：`digestMcpServer`（`config.ts:114-120`）覆盖 transport、command、args、cwd、env、url、headers；enabled、timeout、disabledTools 不在其中，它们只影响是否连接与注册哪些工具，可以接受。`#reconcile` 在摘要变化时关闭连接；`approve` 用旧摘要批准时返回 409。
- **权限类**：类只来自 `RegisterToolOptions` / `layeredTools`（`context/index.ts:143-165`），与基础工具同名的贡献被忽略。context-read 仍受 deny / ask 约束；`Memory` 组只含 memory_write / memory_delete；`mcp__<server>` 不匹配 `mcp__<server>2`（F5 的大小写问题除外）。规则校验接受贡献工具名（票 10 已修）。
- **File Reference 边界**：`references/expand.ts:144-170` 用 realpath 判定 Workspace 内外，经符号链接越界时只附说明，Read 拒绝规则对 resolved 与 real 两条路径都检查。
- **@import 边界**：词法与 realpath 双重检查（`loader.ts:90-108`），防环与深度上限正确。
- **E2E 后台开关**：`main/e2e-background.ts:11-14` 在 `packaged && !testBuild` 时恒为 false，`TEST_BUILD` 是构建期常量（`build-flags.ts:7`）；开关只影响窗口显示方式（`window.ts`），`COKO_E2E_*` 被 `/^COKO_/` 挡在 Sidecar 命令环境之外。发布构建不受影响。
- **压缩与回退（原 Session）**：回退到压缩之前恢复原历史；压缩中停止不提交条目；手动 /compact 只提交 compaction；熔断只计自动与溢出失败（已接受）。
- **协议边界**：新路由都经 `body()` 与 typebox 校验；renderer 的新 store 都对响应做 `Value.Check`；控制 IPC 的 secret.* 消息为 strict schema。

---

## 未阅读或只抽样的部分

- 未读：`packages/ui/src/composer/*`（typeahead、File Reference 节点）、`apps/desktop/src/renderer/features/conversation/` 下的 composer、command-menu、file-menu、timeline、timeline-view、tool-cards；`mcp-section.tsx` 与 `memory-section.tsx` 的大部分；`skills-section.tsx` 的布局；`chat-store.ts` 的改动。
- 未读：`packages/agent/src/tools/builtin/walk.ts` 与 grep 契约（gitignore 对齐）、`context/references/{parse,search}.ts`、`extensions/mcp/{prompts,resources,pagination}.ts`、`context/memory/*`、`instructions/commands/args.ts`、`instructions/skills/parse.ts`。
- 未读：`apps/server/src/application/` 下的 recovery.ts、checkpoints.ts、session-permissions.ts（票 01 拆分，只看了调用点）；`packages/session/src/sqlite/memory-secrets.ts` 与迁移 v3；`apps/desktop/src/main/sidecar-supervisor.ts` 的改动。
- 文档（docs/subsystems/*，以及 ADR 0007、0008 以外的 ADR）、i18n 字典、大部分 E2E 与集成测试正文只按需检索，没有通读。
- 没有运行集成测试与 E2E。F1 的结论来自代码阅读，没有用会回显工具结果的 faux 脚本实测。
