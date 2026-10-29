# M3 评审：Standards 轴

- 范围：`git diff 9cd5675...HEAD -- . ':!pnpm-lock.yaml' ':!.scratch'`（90 个提交，330 个文件，+23 137 / −1 052）。只读评审，除本文件外未改任何文件。
- 依据：AGENTS.md、docs/TECH_STACK.md、docs/tech-stack/{architecture,agent-runtime,observability,testing,ui}.md、ADR 0005–0009、docs/subsystems/{mcp,instructions,skills,configuration,permissions,context}.md、docs/DOCUMENTATION_SYSTEM.md、apps/server/README.md；基线 smell 一律为 judgement。
- 严重度：**hard** 表示违反成文规则（或与成文行为不符且已复现）；**judgement** 表示基线 smell 或对规则意图的判断。
- 各票 Comments 中 Lead 已接受的偏离（压缩作为运行时选项、`/compact` 无内容时 400、熔断只计自动与溢出、越界改动等）不重复报告；只有 S1 涉及已接受修复的实现本身。
- 用 `node --experimental-strip-types` 跑了两段临时脚本复现 S1、S2（在 `/tmp` 下，跑完即删）。

---

## 一、高风险（按优先级）

### S1 分叉之后再回退，丢掉压缩摘要（hard）

- 位置：`packages/agent/src/agents/fork.ts:25-28`。
- 规则：ADR 0006 第 23 行："回退对话……模型上下文与时间线不再包含**从目标消息到回退记录之间**的条目"。context.md 第 159 行："新 Session 的模型上下文与原 Session 在目标处相同"。
- 问题：`forkEntries` 把 compaction 条目放在所有保留消息**之后**，并设 `firstKeptSeq: 1`。之后在新 Session 中回退到任一保留的消息时，compaction 条目落进被回退的区间而失效。被摘要替代的早期消息又从未复制过来，所以模型上下文里既没有摘要，也没有原历史。
- 复现：fork 条目为 `[fork_origin, U3, A3, U4, A4, compaction(firstKeptSeq 1), U5, A5]`，再加 `rewind{targetSeq: U4}`。`modelContext` 结果为 `['U3 kept','A3']`，摘要不在其中。同样的操作在原 Session 中会保留摘要（或恢复完整历史）。
- 修复：把 compaction 条目放在 `fork_origin` 之后、复制的消息之前，`firstKeptSeq` 取新 Session 中第一条复制消息的 seq（例如 2）。`modelContext` 已经把摘要放在最前面，排序不变。回退到任一保留消息时 compaction 仍然有效。在 `checkpoints/rewind.test.ts` 加一例"分叉 → 回退到保留消息"。

### S2 指向 Workspace 外的根目录 AGENTS.md 不受边界约束（judgement，风险高）

- 位置：`packages/agent/src/instructions/rules/loader.ts:76-87`（`visit` 直接读取 `realpath` 的结果）、`:131-140`。
- 规则：instructions.md 第 45 行与第 83 行规定 @import 的目标"词法路径与真实路径"都须在仓库根或 `COKO_HOME` 之内，"含经符号链接越出"。ADR 0008 第 22–23 行：项目文件只提供上下文。
- 问题：只有 @import 检查 `realRoots`。仓库根（或任一层目录）里的 `AGENTS.md` 可以是指向 `~/.ssh/id_rsa`、`~/.aws/credentials` 之类文件的符号链接。克隆的仓库因此能把 Workspace 外的文件原样放进系统提示发给 Provider，且没有任何诊断。复现：`repo/AGENTS.md -> ../outside/secret.txt` 时 `load()` 返回的内容为 `TOP-SECRET-OUTSIDE`，`diagnostics` 为空。同一目标经 @import 引入则会得到 `import-outside-boundary`。
- 修复：`visitDirectory` / `visit` 对 `project` 与 `nested` 作用域同样要求 `real` 位于 `walk.realRoots` 内，越界时记 `import-outside-boundary`（或新增 `file-outside-boundary`）并跳过。`user` 作用域不受影响。在 rules.test.ts 加一例符号链接用例，并同步 instructions.md 的"边界"一节。

### S3 项目 MCP Server 的批准对话框不显示 env 与 header 的值（judgement，风险高）

- 位置：`apps/server/src/application/context/mcp.ts:92-95`（`launchOf` 只给出 `envNames` / `headerNames`）、`packages/protocol/src/mcp.ts:46`、`apps/desktop/src/renderer/features/settings/mcp-section.tsx:267-274`。
- 规则：ADR 0008 第 21 行要求项目 Server 按配置摘要逐个批准，"命令、参数、地址、环境或请求头改变后……须重新批准"。mcp.md 第 49 行的摘要包含 env 与 headers。
- 问题：摘要覆盖 env 的值，用户批准时却看不到这些值。`NODE_OPTIONS=--require ./evil.js`、`PYTHONPATH`、`LD_PRELOAD` 之类值决定 stdio 进程实际执行什么，HTTP 的 header 值决定把什么发往哪里。用户只能看到名字，"看过完整命令再批准"因此不成立。ADR 0007 已禁止项目文件写 `${…}`，项目 env 与 header 中只有字面值，显示它们不会泄露登记的 Secret。
- 修复：项目 Server 的 `McpLaunchDetails` 改为给出 `env` / `headers` 的完整键值（全局 Server 仍只给名字）；对话框逐行显示；mcp.md 第 90 行与 e2e 断言同步修改。

### S4 File Reference 块不做 Secret 按值脱敏（judgement）

- 位置：`apps/server/src/application/session-runtimes.ts:25-35`（只对 `toolResult` 调用 `redactSecretsDeep`）、`apps/server/src/application/context/references.ts:25`。
- 规则：ADR 0007 第 37 行与 mcp.md 第 100 行：工具结果入库与推送前替换已登记 Secret 的明文；MCP 提示模板的展开文本同样替换（`mcp.ts:354`）。
- 问题：`@.env`、`@config/prod.yaml` 等引用把文件内容放进 user message 条目。这些内容与 read 工具读出的是同一份文件，read 的结果会被替换为 `[REDACTED:secret]`，@ 引用的结果却以明文入库、推送并写进 `-wal`。同一份内容因读取方式不同而得到不同处理；按 testing.md 的要求，新的输出通道应进入秘密总闸（`secrets-gate-<channel>`）。
- 修复：在 `toNewEntry` 中对 user message 里以 `<file_reference` 开头的文本块（可用 `fileReferencePath` 识别）调用 `redactSecretValues`，或在 `referencesContribution` 生成块时替换。新增 `tests/integration/secrets-gate-references.test.ts`。

### S5 `isWithin` 有两份实现，参数顺序相反（judgement：Duplicated Code / Mysterious Name）

- 位置：`packages/agent/src/instructions/rules/discover.ts:6` 为 `isWithin(root, path)`；`packages/agent/src/policy/rules.ts:9` 为 `isWithin(child, root)`，并经 `policy/decide.ts:8` 与 `policy/index.ts` 导出。
- 风险：这两个函数都处在路径边界上（@import 边界与权限判定）。同名且同为 `string, string` 签名，tsc 查不出参数写反，一旦写反就会悄悄放开边界。`expand.ts:9` 从 rules.ts 导入，`loader.ts:5` 从 discover.ts 导入，导入哪一份全凭记忆。
- 修复：删除 discover.ts 中的那份，统一使用 `policy/rules.ts`，改动调用点的参数顺序；或改名为 `contains(root, path)`，让参数含义写在名字里。

### S6 Secret 名的正则复制了 5 份（judgement：Duplicated Code；规则见 architecture.md 第 69 行"protocol……向两端提供 schema"）

- 位置：`packages/protocol/src/secrets.ts:8`（`SECRET_NAME_PATTERN`）、`packages/protocol/src/control.ts:41`、`packages/agent/src/extensions/mcp/config.ts:13`、`apps/server/src/adapters/credentials.ts:122`、`apps/desktop/src/main/secrets.ts:12`。
- 问题：ADR 0007 第 20 行规定了唯一的名字形状。五份副本之间没有任何编译期比对（仓库里同类的重复都用 `Assert<Equal<…>>` 守卫，见 `apps/server/src/application/config.ts:33-38`）。只改一处就会出现"main 接受、Sidecar 拒绝"或"MCP 展开时当作未登记"这类分歧。
- 修复：`control.ts` 改用 `SecretName`；server 与 desktop main 从 `@coko/protocol` 导入 `SECRET_NAME_PATTERN`（两者都已依赖 protocol）。agent 不依赖 protocol，可以保留自己的常量，同时在 server 加一条 `Assert` 或单测，比对 `SECRET_NAME.source === SECRET_NAME_PATTERN`。

---

## 二、文档与规则符合性

### D1 yaml 2.9.0 未写入 TECH_STACK 的选型表（hard）

- 位置：`packages/agent/package.json`（新增 `"yaml": "2.9.0"`）；`docs/TECH_STACK.md:43` 只写了"yaml（Skills 与命令的 frontmatter）"，没有版本，Agent 选型表（第 55–68 行）也没有这一行。
- 规则：TECH_STACK.md 第 11 行："新引入或因兼容要求调整的版本在对应章节说明"。表中其他依赖都有精确版本。
- 修复：在"## Agent"表中加一行"Skills 与命令模板的 frontmatter 解析 | yaml 2.9.0"，并附包元数据链接。

### D2 源码注释依赖 `.scratch` 中的材料（hard）

- 位置：例如 `packages/agent/src/instructions/rules/loader.ts:1`（"grilling A1–A6"）、`rules/nested.ts:1`（"grilling A5"）、`context/compaction/{plan,prompt,breaker}.ts:1`（"grilling F2/F3/F5"）、`agents/fork.ts:13`（"grilling F6"）、`engine/runtime.ts`（"grilling F1–F6"）。`apps`、`packages` 下非测试文件中含"grilling / M3 规格"的有 32 处，另有大量"票 NN"。
- 规则：docs/DOCUMENTATION_SYSTEM.md 第 54 行："`.scratch/` 外的文件不得链接、嵌入、导入或要求读取其中的具体文件才能理解正文"。"grilling F6"只能对照 `.scratch/m3-context-instructions/grilling.md` 才读得懂。
- 修复：把这些标签替换为对应正式正文的锚点（例如 `docs/subsystems/context.md#压缩`、`instructions.md#嵌套指令的按需加载`），或直接写出结论；"票 NN"改为说明职责的文字。可在 `check:docs` 或 lint 规则中禁止源码出现 `grilling [A-Z][0-9]`。

### D3 已过时的归属注释与 README 描述（hard）

- 位置：`apps/server/src/application/context/index.ts:2`："本文件与 types.ts 只由票 01 修改"。实际上票 04、06、07、09、10、11 都改过这两个文件（`git log 9cd5675..HEAD -- context/index.ts context/types.ts` 共 10 个提交）。`apps/server/README.md:50`："有效配置经 `application/config.ts`（票 01 返回默认值的桩）"、"票 01 为空 router"。这两处与当前实现不符：ConfigService 已实现，routes 也已有 8 个领域。
- 规则：AGENTS.md"更新……文档时……同步受影响的引用、摘要和导航"；README 属于当前行为说明，必须与实现一致。
- 修复：删除 index.ts 第 2 行的归属规则；README 第 50 行改为描述当前的 ConfigService 与 `DOMAIN_ROUTES`。

### D4 `ResourceDiagnostic` 有两份定义，缺少编译期比对（judgement；同类重复的约定见 `application/config.ts:33-38`、`entry-payloads.ts:11-15`）

- 位置：`packages/agent/src/instructions/shared/diagnostics.ts:3-13` 与 `packages/protocol/src/config.ts:13-31`。
- 修复：在 `apps/server/src/application/config.ts` 加 `type DiagnosticsAgree = Assert<Equal<AgentResourceDiagnostic, ProtocolResourceDiagnostic>>`。

### D5 设置分区复制了 textarea 控件（hard）

- 位置：`apps/desktop/src/renderer/features/settings/mcp-section.tsx:15-16` 与 `memory-section.tsx:17` 各写了一份几乎相同的 `<textarea>` 类名串。
- 规则：ui.md 第 23 行："跨页面通用能力放入 `packages/ui`……避免复制一套近似控件"。
- 修复：在 `packages/ui/src/components/` 新增 shadcn 风格的 `Textarea`（与 `Input` 同一套 token），两处改用它；mono 字体与字号以 variant 区分。

### D6 把服务端原文直接作为界面错误（hard）

- 位置：`mcp-section.tsx:561` 为 `toast.error(result.message)`；`:399` 为 `${t('mcp.saveFailed')}: ${result.message}`。
- 规则：ui.md 第 30 行："所有产品文案，包括……错误……都通过类型化的 zh/en 字典提供"；第 35 行："错误使用简短、可行动的用户语言，技术详情放入诊断入口"。
- 修复：按 `result.code` 映射到字典（`mcp.secrets.deleteFailed`、`mcp.saveFailed`）。`message` 只放在可展开的详情中，或只写入日志。

### D7 三个设置分区各有一份诊断列表，key 为下标（judgement：Duplicated Code / Repeated Switches；规则见 ui.md 第 46 行"key 表达真实实体身份"）

- 位置：`general-section.tsx:67-72,135-148`、`skills-section.tsx:13-22,234-245`、`mcp-section.tsx:27-35,513-530`。三处的结构相同：都是 `code → MessageKey` 映射加一个列表，且 `read-failed`、`invalid-value`、`invalid-json` 三张表都有。
- 修复：抽出 `features/settings/diagnostics-list.tsx`，以 `source` 加 `code` 查同一张表，key 用 `${source}:${path}:${code}:${message}`。

---

## 三、结构 smell（judgement）

### J1 `SessionService` 重新承担了工具名知识（Divergent Change / Shotgun Surgery）

- 位置：`apps/server/src/application/sessions.ts:59-68`（`CONTRIBUTED_TOOLS` 硬编码 `memory_list` 等工具与权限类）、`:155-178`（`#hostToolNames`、`#rememberContributed`）、`:166`（用 `process.cwd()` 构造工具集，只为取工具名）。
- 问题：票 01 的验收要求 sessions.ts"只有 DTO 与 Run 控制"（当时 473 行，现在 535 行）。权限类在 `packages/agent/src/context/memory/tools.ts:117-119` 已经声明过一次，这里是第二份。以后每新增一个贡献工具都要改 sessions.ts。
- 修复：由 `ContextContribution` 声明 `ruleTools?: readonly { name; permissionClass }[]`（静态、与 Run 无关），在 `ContextAssembly` 中汇总，`PermissionService` 直接读取。memory 与 mcp 两个贡献各自给出自己的名字，sessions.ts 中这三段随之删除。用固定的哨兵目录代替 `process.cwd()`，或让工具工厂提供 `names()`。

### J2 `McpManager` 职责过多，且每个 Run 读两遍配置

- 位置：`apps/server/src/application/context/mcp.ts` 共 506 行，包含配置读取、批准、连接池、工具、资源、提示模板命令与 HTTP 视图。`toolsFor`（`:254`）与 `resourceToolsFor`（`:271`）各自 `#load` 一次（每次都读 `.mcp.json`、两个设置键和有效配置），由 `mcpContribution.tools`（`:491-494`）先后调用。
- 修复：`mcpContribution.tools` 只 `#load` 一次，再把结果交给工具与资源两个函数。可以把 `view` / `updateServers` / `approve` 拆进 `McpAdmin`，`McpManager` 只保留连接池与运行时。

### J3 `promptCommand` 绕过注入的 secrets 端口

- 位置：`mcp.ts:354` 直接调用 `@coko/logging` 的 `redactSecretValues`，同一函数的 `:360` 却用 `this.#options.secrets.redact`。
- 修复：给 `SecretService` 增加 `redactValues(text)`，`McpManagerOptions.secrets` 改用 `Pick<…, 'redactValues'>`，测试可以注入。

### J4 路由越过 application 层直接访问存储（Feature Envy；规则见 architecture.md 第 88 行"server……通过 application 入口调用 agent 框架及 session 查询接口"）

- 位置：`http/routes/context.ts:11-33`、`commands.ts:14-21`、`skills.ts:13-15`、`files.ts:15-16` 各自写一遍"取 session、取 workspace、404、`app.context.scope`"。`routes/memories.ts:8` 在路由里直接 `new MemoryService(app.store)`。`commands.ts:22`、`skills.ts:16` 用 `contributions.find(isXxx)` 取领域对象。
- 修复：在 application 层提供 `ContextService.scopeFor({ sessionId?, workspaceId? })`、`contextUsage(sessionId)`、`commands(scope)`、`skills(scope)`；`MemoryService` 由 `Application` 持有。路由只负责校验与调用。

### J5 压缩编排写在 `createAgentRuntime` 闭包里

- 位置：`packages/agent/src/engine/runtime.ts`，从 517 行增长到 813 行；`:506-631`（`compactNow`、`autoCompact`、`recoverOverflow`）与 `:768-788` 都在同一个闭包中。agent-runtime.md 第 93 行把"压缩"归到 `context/`。
- 修复：抽出 `engine/compaction-driver.ts`（或 `context/compaction/driver.ts`），向它注入 `stream`、`commit`、`progress`、`agent.state`，并由它持有熔断状态。运行时只保留 `prepareRequest` 与 `compact()` 两个接线点。

### J6 `CommandSourceContribution.list` 返回 `unknown[]`（Primitive Obsession）

- 位置：`apps/server/src/application/context/types.ts:31-34`；`commands.ts:33-37` 再用运行时守卫 `isSourcedCommand` 补回类型。起因是"types.ts 只由票 01 修改"这条已过时的约束（见 D3）。
- 修复：`list(scope): Promise<SourcedCommand[]>`（把 `SourcedCommand` 移到 types.ts），然后删除守卫与 warn 分支。

### J7 Secret 通道照搬 Credential 通道（Duplicated Code）

- 位置：`apps/server/src/adapters/credentials.ts:127-159` 与 `:17-55` 结构相同：tracker、onMessage、onDisconnect、缓存、解密。`apps/desktop/src/main/secrets.ts:17-68` 与 `credentials.ts:39` 也是同样的关系。
- 修复：抽出 `createIpcDecryptor({ requestType, resultType })` 与 `createEncryptingBridge`，Credential 与 Secret 各自只传消息类型和校验。

### J8 `SecretService.redact` 只是一层转发（Middle Man）

- 位置：`apps/server/src/application/secrets.ts:68-71` 原样调用 `redactText`。
- 修复：保留它作为注入接缝即可，但要在注释中写明"按值脱敏 + 凭据形态"，并与 J3 的 `redactValues` 成对提供；否则就删掉，直接从 logging 导入。

### J9 手动压缩"没有可压缩内容"的错误码为 `internal`

- 位置：`runtime.ts:782`。宿主已经先返回 400（`context/compaction.ts:15-16`），这一分支只在竞态时出现，但 `internal` 会把可预期的情形当成程序错误记录。
- 修复：改为 `{ code: 'model_error' }` 或新增专门的 RunError code；至少不要用 `internal`。

### J10 项目 Skill 的读取根没有限制在 Workspace 内

- 位置：`apps/server/src/application/context/skills.ts:94-96`、`packages/agent/src/policy/gate.ts:86`（`realLocation` 之后直接成为读取根）。
- 规则：ADR 0008 第 18–20 行规定项目文件不能授予权限。读取根本身就是一种授权（根下的读取在所有模式都免审批）。`<Workspace>/.coko/skills/x` 是指向 Workspace 外目录的符号链接、且目标目录下有名为 `x` 的 SKILL.md 时，这个外部目录就成了免审批读取根。条件苛刻，风险低。
- 修复：对 `scope === 'project'` 的 Skill，要求 `realpath(baseDir)` 位于 `realpath(cwd)` 内，否则不加入读取根并记诊断。

---

## 四、已核对、未发现问题

- 权限类只由宿主给出：`registry.ts` 只读取 `RegisterToolOptions.permissionClass`，`layeredTools` 遇到与基础工具同名的贡献工具时忽略并记 warn，内置工具按名字优先（`decide.ts` 的 `toolCategory`）。
- 规则名校验：`canonicalRuleTool` 原样接受 `mcp__` 前缀；`mcp__srv` 不匹配 `mcp__srv2__x`（`matchesTool`）；未知工具名返回 400 `unknown-tool`。
- 项目设置只收紧：`merge.ts` 中 true 开关、`allow`、`defaultMode` 都给出 `project-cannot-grant`；有效值取"与"；`skills.disabled` 取并集。
- MCP 批准：摘要只包含启动相关字段且键序规范化；批准前比对摘要（409）；摘要变化后 `#reconcile` 关闭连接；项目项含 `${` 时整项拒绝；与全局同名时忽略。
- Secret：明文不经过 HTTP；控制消息有严格的 TypeBox schema（`plaintext minLength 1`、`hint maxLength 4`）；safeStorage 不可用时拒绝保存；错误与 stderr 尾部经 `redact`；`compaction_failed.message` 经 `redactText`。
- E2E 后台模式：`e2eBackgroundEnabled` 在 `packaged && !testBuild` 时返回 false，符合 testing.md 第 17 行。
- 协议信任边界：新路由的请求体都经 `body(c, Schema)` 校验；`files.ts` 的 `limit` 有显式的整数范围检查。

---

## 五、未读或只抽样的部分

- **只看了 diff，未逐行读完**：`packages/ui/src/composer/composer-typeahead.tsx`（432 行）、`composer-editor.tsx`、`file-reference-node.ts`；`apps/desktop/src/renderer/features/conversation/{composer,timeline,timeline-view,tool-cards,context-ring,compaction-divider,file-menu,command-menu}.tsx`；`features/settings/{memory,skills,general,permissions}-section.tsx`（只 grep 了文案与 key）；`stores/*-store.ts`（draft、context、mcp、skills、memory、commands、config）。
- **未读**：`packages/agent/src/context/compaction/{plan,prompt}.ts` 正文（只读了 runtime 中的调用与 subsystems 文档）、`context/usage/{estimate,trim,budget}.ts`、`instructions/commands/{args,loader,registry}.ts`、`instructions/skills/{parse,section}.ts`、`extensions/mcp/{resources,prompts,pagination,results}.ts`、`tools/builtin/walk.ts`、`testing/grep-contract.ts`；`packages/session` 的 schema 与迁移（只读了 `memory-secrets.ts`）；`packages/i18n` 的各 domain 字典；`apps/server/src/runtime/layers.ts`、`application/{recovery,checkpoints,session-permissions}.ts`（票 01 的拆分）、`context/{usage,instructions}.ts`、`apps/server/src/config.ts`；`apps/desktop/forge.config.ts`、`vitest.browser.config.ts`、`e2e/foreground-watch.ts`、`sidecar-supervisor.ts` 之外的 main 改动。
- **全部测试文件**（`*.test.ts(x)`、`tests/integration/*`、`apps/desktop/e2e/*`、`tests/fixtures/*`）只用来定位行为，没有按 testing.md 逐条评审隔离与确定性。
- 没有运行 typecheck、lint、test 或 check:docs（只读评审）；S1、S2 由 `/tmp` 下的临时脚本复现。

---

## 处理结果（票 13，2026-10-29）

修复在分支 `m3/13-review-fixes`（见 [票 13](issues/13-review-fixes.md)）。"先红"指改动前新测试失败，或对实现做变异后失败。

| 编号 | 处理 | 测试 |
| --- | --- | --- |
| S1（= F4） | 已修：`forkEntries` 把 compaction 放在 `fork_origin` 之后、复制的条目之前，`firstKeptSeq` 指向第一条复制的消息；`estimateCompactedTokens` 把没有 runId 的复制消息排除在"压缩之后"之外 | `checkpoints/rewind.test.ts` 3 例（位置与 firstKeptSeq、分叉后回退到第一条保留消息、复制消息的 usage）；`sidecar-compaction.test.ts` 协议层同一场景。用旧 `fork.ts` 跑集成测试先红 |
| S2（= F2） | 已修：目录链与嵌套的指令文件真实路径须在仓库根（嵌套为 Workspace）之内，越界记 `file-outside-boundary` 并跳过；user 作用域不限 | `rules.test.ts` 3 例（目录链、嵌套、目标目录本身是链接），先红 |
| S3（= M2） | 已修：项目 Server 的 `launch` 给出 `env` / `headers` 完整键值，对话框逐行显示；协议去掉 `envNames` / `headerNames` | `sidecar-mcp.test.ts`（先红）、`mcp.e2e.test.ts` |
| S4 | 已修：`referencesContribution` 生成块时 `redactSecretsDeep` | 新 `secrets-gate-references.test.ts`，先红 |
| S5 | 已修：唯一实现 `pathContains(root, path)`（`policy/rules.ts`，参数顺序写进名字），删除 discover.ts 的副本；decide、expand、rewind、discover、loader、read-filter、skills loader 都改用它 | 现有 policy / references / rewind / read-filter 用例全部通过（agent 584 例） |
| S6 | 已修：`control.ts` 用 `SecretName`；server credentials 与 desktop main 从 `@coko/protocol` 取 `SECRET_NAME_PATTERN`；agent 保留常量 | 新 `apps/server/src/adapters/secret-name.test.ts`（比对 `SECRET_NAME.source` 与协议、源码中没有字面副本），先红 |
| D1 | 已修：TECH_STACK Agent 表加 yaml 2.9.0 与包元数据链接 | check:docs |
| D2 | 已修：apps、packages、tests 源码中的 grilling / 票号 / M3 规格指代改为文字或 docs/ 正文（127 个文件，只改注释）；新增 `scripts/source-references.test.ts` 机械检查 | 先红（列出全部命中）；临时在 `fork.ts` 加 `// grilling F6` 后失败、撤销后通过 |
| D3 | 已修：删除 `context/index.ts` 的"只由票 01 修改"；server README 改为描述 `ConfigService` 与 `DOMAIN_ROUTES` | check:docs |
| D4 | 已做：`application/config.ts` 加 `DiagnosticsAgree` | 给 agent 的 `DiagnosticSource` 临时加一个值后 tsc 报 8 个错误，撤销后通过 |
| D5 | 已修：`packages/ui` 新增 `Textarea`（default / mono 变体），MCP 与 Memory 分区改用它 | 新 `textarea.browser.test.tsx`（与 Input 同几何与 token、mono 变体），组件不存在时先红；memory E2E 通过 |
| D6 | 已修：保存失败显示 `mcp.saveFailed`，服务端原文在可展开的"技术详情"中；删除 Secret 失败只 toast 本地化的 `mcp.secrets.deleteFailed` | 新 `mcp-section.browser.test.tsx`，用旧 `mcp-section.tsx` 跑先红 |
| D7 | 未做：三份诊断列表的映射表与布局各不相同（项目设置行可折叠、MCP 有标题），合并需要先统一界面形态，超出本票的修复范围；key 用下标的问题在列表只读、不重排时没有可见影响。留给之后的设置分区整理 | — |
| J1 | 未做：把 `ruleTools` 移进 `ContextContribution` 需要改共享装配点与 PermissionService 的取名路径，属于结构重构，不影响行为 | — |
| J2 | 未做：拆分 McpManager 是结构重构；每个 Run 读两遍配置是小的性能问题，没有正确性影响 | — |
| J3 | 已修：`SecretService.redactValues`，`promptCommand` 经注入的端口调用 | `secrets-gate-mcp-prompts.test.ts` 通过 |
| J4 | 未做：路由经 application 层取作用域是结构重构，涉及 4 个路由与 Application 形状 | — |
| J5 | 未做：压缩编排抽出 driver 是结构重构；本票只在 `summarize` 中加了输入上限（F7） | — |
| J6 | 未做：`CommandSourceContribution.list` 的类型收紧需要移动 `SourcedCommand` 并改动 skills / mcp 两个来源，收益低于本票其他项 | — |
| J7 | 未做：Credential 与 Secret 通道合并是结构重构；本票只让 Credential 明文登记为按值脱敏来源（M3） | — |
| J8 | 已修：`redact` 的注释写明是注入接缝（按值 + 凭据形态），与 `redactValues` 成对提供 | 同 J3 |
| J9 | 已修：没有可压缩内容的手动压缩以 `model_error` 结束 | `engine/compaction.test.ts` 改断言，先红 |
| J10（= F3） | 已修，见 review-spec F3 | 见 F3 |
