# M1 评审：Standards 轴

范围：`git diff 72b8b80...HEAD -- . ':!pnpm-lock.yaml' ':!.scratch'`（264 个文件，约 2 万行）。只读评审，除本文件外未改动仓库。
标准来源：AGENTS.md、docs/TECH_STACK.md、docs/tech-stack/{architecture,agent-runtime,desktop-delivery,observability,testing,ui,ui-design-system}.md、docs/adr/0001–0004、GLOSSARY.md、apps/server/README.md、packages/session/README.md。
严重度：**hard** = 与文档化规则直接冲突；**judgement** = 需要权衡，或属于 Fowler 坏味道。oxlint、oxfmt、tsc、check:docs 和样式守卫已经能拦住的问题不在本文范围内。

## 阅读覆盖

**逐行读过（按风险排序）**
- 认证与凭据：apps/server/src/http/{auth,app,server}.ts、adapters/credentials.ts、control/channel.ts；apps/desktop/src/main/{index,app-protocol,credentials,websocket-headers,sidecar-auth,window}.ts；preload/index.ts；shared/bridge.ts；packages/logging/src/{redact,file,index}.ts
- 持久化与顺序：packages/session/src/{types,errors,internal,index}.ts、sqlite/{open,connection,repositories,schema,index}.ts；apps/server/src/application/*.ts、ws/connection.ts；packages/agent/src/engine/{runtime,retry,types}.ts
- 进程生命周期：apps/server/src/runtime/{layers,main}.ts、config.ts；apps/desktop/src/main/{sidecar-process,quit-coordinator,logging,messages}.ts；build/build.ts、forge.config.ts
- 协议：packages/protocol/src/*.ts
- 模型与工具：packages/agent/src/models/registry.ts、tools/{registry,types}.ts、ports/{exec,credentials,local-exec 前 60 行}.ts、extensions/hooks.ts；apps/server/src/adapters/{ripgrep,faux}.ts
- renderer：client/{api,connection}.ts、stores/{chat-store,settings-store}.ts、main.tsx、app/*.ts(x)、features/settings/models-section.tsx、features/conversation/{timeline,tool-cards,conversation-pane}.tsx，以及 timeline-view.tsx、connection-status.tsx 的片段；packages/ui/src/tool-card/tool-card.tsx；packages/i18n/src/translator.ts
- 所有 manifest、pnpm-workspace.yaml、根 vitest.config.ts，以及 docs/adr 与 docs/tech-stack 的 diff

**只做抽样或 grep**：测试文件（固定 sleep、mkdtemp、端口、onTestFinished）、e2e 用例标题、packages/ui 组件的 `outline-none` / `focus-visible` 用法、theme.css 的 focus 段落、i18n 字典的 kinds 段。

**没有读**：packages/agent/src/tools/builtin/*（bash、edit-diff 476 行、grep、walk、output-accumulator、truncate、read、write、find、ls、glob）、testing/*、THIRD_PARTY_NOTICES；packages/ui 其余组件（app-frame、composer-editor、dropdown-menu、dialog、markdown-renderer）、guards/style-guard.ts 的实现，以及 theme.css 的其余部分；sidebar、composer、model-picker、settings-dialog、general/about-section；i18n 字典全文；session memory 实现与 repository-contract；所有测试正文（e2e 与 integration 只看了 harness 片段）；scripts/check-docs.ts；tsconfig 系列；.husky、commitlint。

---

## A. 违反文档化标准

### A1 [hard] retry 进度事件把未脱敏的模型错误文本推给 renderer
- 位置：packages/agent/src/engine/retry.ts:95（`errorMessage: final.errorMessage`）→ runtime.ts:109 → apps/server/src/application/sessions.ts:62-65（`toProgress` 原样透传）→ protocol ws.ts:52-60。
- 规则：ADR 0004 第 22 行要求密钥在日志中脱敏；它的上下文第 14 行写明"日志与协议不能泄露密钥"。sessions.ts:48-50 自己的注释也承认模型错误文本"可能回显请求凭据"，但只在入库路径（`toNewEntry`）上做了脱敏。可重试错误（429/5xx）的文本照样可能带回 `sk-…`。
- 修复：在 `toProgress` 中，对 `retry` 事件的 `errorMessage` 调用 `redactText`。更稳妥的做法是在 agent 的 `onRetry` 回调处由宿主统一脱敏。另外补一个集成测试：faux 返回带 `sk-xxxxxxxx` 的可重试错误，断言 WebSocket 收到的 progress 帧里没有明文。

### A2 [hard] bash 工具继承 Sidecar 的完整环境，包括 Credential 环境变量
- 位置：packages/agent/src/ports/local-exec.ts:10（`HOST_ONLY_ENV = ['ELECTRON_RUN_AS_NODE']`）与 :20-24；apps/desktop/src/main/index.ts:89（`env: process.env`）。
- 规则：agent-runtime.md:54 写"Sandbox / Secrets：宿主实施隔离、凭据存储与注入"；ADR 0004 第 21 行规定独立运行时 Credential 来自环境变量。由此推出：独立运行时，`COKO_CREDENTIAL_*`、`DEEPSEEK_API_KEY`、`OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 会被模型发起的 `env` / `printenv` 读出。读出的内容会作为 toolResult 写入 SQLite 并显示在 UI 中，而 README 写明工具输出"保持原样"，不脱敏。
- 修复：local-exec 不再写死变量表，改为接收宿主传入的剔除列表。server 装配时传入 `COKO_CREDENTIAL_*`、`COKO_FAUX_SCRIPT`、`COKO_LOG_LEVEL`，以及 `KIND_ENV` 中的变量名（apps/server/src/adapters/credentials.ts:80-84）。再补一个契约测试：在 env 模式下，`env` 命令的输出不含这些变量。

### A3 [judgement] 打包后的应用仍会把测试专用环境变量传给 Sidecar
- 位置：apps/desktop/src/main/index.ts:41、:50 用 `development &&` 限制了 `COKO_SIDECAR_ENTRY` 和 `COKO_RIPGREP_PATH`，但 :89 原样传入 `process.env`，所以 `COKO_FAUX_SCRIPT`（apps/server/src/config.ts:43）在打包后的应用里依然生效。
- 规则：apps/server/README.md:22 把 `COKO_FAUX_SCRIPT` 标为"仅测试"；index.ts:39 的注释写"安装包始终使用随包 sidecar"，与这里的限制意图一致。
- 修复：`app.isPackaged` 为真时，从传给子进程的 env 中删除 `COKO_FAUX_SCRIPT`。也可以在 SidecarProcess 中改用白名单 env。

### A4 [hard] sidecar.jsonl 缺少统一字段 appVersion
- 位置：apps/server/src/runtime/layers.ts:53 调用 `configureFileLogging` 时没有传 `properties`；desktop 一侧在 apps/desktop/src/main/logging.ts:70 传了 `appVersion`。
- 规则：observability.md:20 规定"统一字段包含……进程来源、应用版本和错误摘要"。
- 修复：main 增加启动参数 `--app-version <v>`（`config.ts` 的 `ARGUMENTS` 需同步放行），由 layers.ts 写入 `properties`。同时更新 apps/server/README.md 的参数表。

### A5 [judgement] 关联字段没有跨边界传递
- 位置：apps/server/src/http/app.ts:59 在服务端自行生成 `requestId`，不读取请求头；app.ts:106 的 `stream message failed` 和 application 层的业务日志（sessions.ts:105、:165 等）都不带 requestId；renderer 日志（main.tsx:33）也没有关联标识。
- 规则：observability.md:20："跨 IPC、HTTP 和 WebSocket 显式传递关联标识，并由接收端校验、绑定到日志上下文"。
- 修复：renderer 的 api.ts 为每个请求生成 `x-coko-request-id`；app.ts 校验其格式后采用该值，否则自行生成；再通过 LogTape 的 `withContext` 绑定到请求作用域，使 application 层日志自动带上它。M1 若不打算做，在 observability.md 中标为"尚未实现"。

### A6 [hard] 数据库损坏隔离发生在获取租约之前
- 位置：packages/session/src/sqlite/open.ts:55（`checkIntegrity` 及其中的 rename 隔离）早于 :70（`acquireLease`）。
- 规则：ADR 0003 第 26 行要求"写者互斥……打开时执行完整性快速检查"，packages/session/README.md:27 给出的打开序列也确实先 quick_check 后租约，所以代码与 README 一致。问题在于隔离是一个改名原文件的写动作，却在没有确认写者身份的情况下执行。如果第二个实例绕过了单实例锁（例如同一 dataDir、不同 userData，或在测试中），它会把活跃实例正在使用的库改名。这一点与 ADR 0003"单写者"的意图冲突。
- 修复：quick_check 失败时，先只读检查 `host_lease`。如果持有者的 pid 存活且心跳未超时，报告 `lease-held`，不做隔离。同时更新 README 中的打开序列说明。

### A7 [hard] architecture.md 写"apps/server 构建自身的 sidecar 产物"，实际由 desktop 跨应用构建
- 位置：apps/desktop/build/build.ts:42（`entry: { index: '../server/src/index.ts' }`）；apps/server/package.json 没有 build 脚本，也没有 tsdown.config.ts。
- 规则：architecture.md:40（目录树列出了 `server/tsdown.config.ts`）与 :109；TECH_STACK.md:199 要求"所有 workspace 显式声明实际使用的运行依赖"。apps/desktop/package.json 没有声明 `@coko/server`，也没有声明 hono、effect 等，只是靠 `nodeLinker: hoisted` 解析到。
- 修复：二选一。一是在 apps/server 新增 tsdown.config.ts 和 `build` 脚本，desktop 的 Forge hook 调用它，并在 desktop 中声明 `"@coko/server": "workspace:*"`。二是保留现状，但在 architecture.md 中改写构建归属。无论选哪个，都要同步 desktop-delivery.md:19 和 apps/server/README.md:43。

### A8 [hard] ADR 的实施状态说明已经过时
- ADR 0001 第 39 行写"Electron main 的启动与安装包 smoke 尚未完成"。实际上 apps/desktop/e2e/desktop-shell.e2e.test.ts 与 package-smoke.e2e.test.ts:87 已经覆盖 main 启动和产物 smoke，真正剩下的只有"已签名"安装包（第 38 行）。
- ADR 0002 第 40 行写"main 的协议转发与 WebSocket 头注入及其与 sidecar 的联合测试尚未完成"。desktop-shell.e2e.test.ts:27、:56、:89 已经覆盖这些。剩下的是 sidecar 重启后重新交换令牌（第 37 行），见 A16。
- 规则：AGENTS.md"更新……文档时……在同一交付批次同步受影响的引用、摘要"；DOCUMENTATION_SYSTEM.md:46 要求当前行为由实现证据支持。
- 修复：重写两条 partial 说明，列出真实剩余项：签名包，以及重启后重新交换。同时检查 docs/adr/README.md 表格是否需要调整。

### A9 [hard] 代码注释描述的状态已经过时
- packages/protocol/src/control.ts:4："credential.* 由凭据切片补充"。同一文件 :22-68 已经包含这些消息。
- apps/desktop/src/main/messages.ts:1："renderer 文案由 i18n 包提供（后续切片）"。i18n 包已经接入。
- apps/desktop/src/main/sidecar-process.ts:5："默认值见 desktop-delivery 约定"。desktop-delivery.md 没有给出任何时限数值，只有 architecture.md:91 提到 inspect-quit 的 2 秒。
- 规则：同 A8，文档与引用要同批同步。
- 修复：删除或改写这三处注释。时限数值写进 apps/desktop 的 README（见 A15），或写进 desktop-delivery.md。

### A10 [hard] main 进程的原生对话框文案没有走 @coko/i18n
- 位置：apps/desktop/src/main/messages.ts:14-39 手写了 zh/en 两套文案，locale 解析逻辑也和 packages/i18n/src/translator.ts:35 的 `resolveLocale` 重复。
- 规则：ui.md:30"所有产品文案……都通过类型化的 zh/en 字典提供"；architecture.md:75 规定 i18n"供 UI、服务和错误展示复用"。
- 修复：把这些文案移到 packages/i18n 的 `main.*` 命名空间。main 中调用 `createTranslator(resolveLocale(app.getLocale()))`，并在 apps/desktop 的 dependencies 中保留 `@coko/i18n`。

### A11 [hard] 逻辑判断依赖翻译文本
- 位置：apps/desktop/src/renderer/features/settings/models-section.tsx:150（provider.name 与 `t('providers.kinds.' + kind)` 比较）。
- 规则：ui.md:30"逻辑判断使用稳定 ID 或枚举，不匹配翻译文本"。
- 修复：改为与 `presets.find(p => p.kind === provider.kind)?.name` 比较（协议给出的预设名）。也可以由服务端返回 `nameIsDefault` 布尔值。

### A12 [hard] 设置表单直接显示服务端的技术错误原文
- 位置：models-section.tsx:237（`setError(result.error.message)`）。这里显示的是英文的 ApiError message，例如 `Invalid request: /name …`。
- 规则：ui.md:35"错误使用简短、可行动的用户语言，技术详情放入诊断入口"；ui.md:30 要求文案经字典提供。
- 修复：按 `result.error.code` 映射到字典键，未知的 code 用 `providers.saveFailed`。原文经 `createRendererLog` 写入日志，或放在可展开的详情中。

### A13 [hard] `outline-none` 覆盖了全局焦点环
- 位置：packages/ui/src/components/button.tsx:9、input.tsx:11、checkbox.tsx:12、toggle-group.tsx:17、dialog.tsx:56、tool-card/tool-card.tsx:65；apps/desktop/src/renderer/features/sidebar/sidebar.tsx:17、settings/settings-dialog.tsx:19。主题的焦点样式只有 `@layer base` 里的 `:focus-visible { outline: … }`（theme.css:341），Tailwind 4 utilities 层的 `outline-none` 优先级更高，焦点 outline 因此被清掉。这些控件上也没有 `focus-visible:` 替代样式，Button 只有 underline，其他都没有。Browser 测试中没有任何 focus 断言。
- 规则：ui.md:37"键盘焦点清晰可见"；ui-design-system.md:99"焦点环使用 `ring` token 和共享的 `focus-visible` 样式"。
- 修复：从共享组件中删除 `outline-none`，让 base 规则生效；如果需要 shadcn 的写法，改为 `focus-visible:outline-(--focus-ring-width) focus-visible:outline-ring`。再补一个 Browser Mode 测试：Tab 聚焦到 Button 或 Input 后，`getComputedStyle(el).outlineStyle !== 'none'`。未在真实渲染中验证，结论基于层叠顺序推断。

### A14 [hard] 工具卡的错误态边框宽 0.5px
- 位置：packages/ui/src/tool-card/tool-card.tsx:54-55。`border-hairline` 与 `border-destructive` 叠加后，边框宽度是 0.5px。同为错误块，timeline-view.tsx:72 用的是 1px 的 `border`。
- 规则：ui-design-system.md:95"警告、错误等状态色边框保持 1px"。
- 修复：error 状态下用 `border border-destructive` 替换 `border-hairline`，并确认 `cn()` 的合并结果符合预期。

### A15 [judgement] 多个包缺少 README 契约
- 现状：只有 apps/server 和 packages/session 有 README。packages/agent（工具覆盖契约、`@coko/agent/testing` 的 grep 契约套件，apps/server/README.md:49 引用了它）、protocol（信任边界的消息定义）、logging（脱敏字段、`/file` 入口）、ui、i18n、apps/desktop（环境变量 `COKO_USER_DATA_DIR`、`COKO_SIDECAR_ENTRY`、`COKO_RIPGREP_PATH`、`COKO_RENDERER_DEV_URL`，以及退出时限）都没有。
- 规则：DOCUMENTATION_SYSTEM.md:27 规定 L4 包契约的内容是"使用入口、配置、能力、限制、扩展点"；AGENTS.md 要求用模板创建必要文档。
- 修复：至少给 agent、protocol、logging、apps/desktop 按 docs/templates 补上 README，并在 docs/README.md 登记。

### A16 [judgement] 没有 Sidecar 重启与重新交换的路径，文档却写成已有约定
- 位置：apps/desktop/src/main/index.ts:92-97 在意外退出后只弹出错误框；renderer 的 client/connection.ts:85-95 会无限重连一个已经不存在的端口。
- 规则：ADR 0002 第 37 行"main 必须在重新交换完成后再恢复转发，期间请求按处理中状态呈现"。
- 修复：M1 若不做，把它写进 ADR 0002 的 partial 剩余项（与 A8 一起改）。若要做：意外退出后重建 SidecarProcess，重新交换令牌，再通过一个新的 IPC 事件通知 renderer 使用新的 wsBaseUrl。

### A17 [judgement] desktop 的 scripts 和开发 watch 与约定不一致，偏离没有记录
- 位置：apps/desktop/package.json:7-13 没有 `make` 和 `publish`；forge.config.ts:24 的 `makers: []` 是空的；preStart（:38-45）只构建一次，没有 tsdown watch，也不会重启 sidecar。
- 规则：desktop-delivery.md:30-45 写的是目标约定；DOCUMENTATION_SYSTEM.md:46 要求"偏离约定时记录差异"。
- 修复：在 apps/desktop 的 README（见 A15）或 M1 规格中写明"M1 不含 make/publish 与 watch 重启"。

### A18 [hard] 测试用固定 sleep 制造交叠顺序
- 位置：packages/agent/src/engine/runtime.test.ts:184（commit 中 `setTimeout 30`）；packages/agent/src/tools/timeout.test.ts:51（30ms 对 5ms 超时）。
- 规则：testing.md:22"竞态测试用 barrier 或 deferred promise 确定交叠位置"；testing.md:35"固定 sleep 不能代表准备或清理完成"。
- 修复：runtime.test.ts 改用 deferred：commit 中 `await gate.promise`，测试先断言 `tool-start` 尚未出现，再调用 `gate.resolve()`。timeout.test.ts 用 deferred 控制工具何时完成，或注入 fake timers 并在 finally 中恢复。

### A19 [judgement] 测试目录与 architecture 约定不一致
- 位置：桌面 E2E 放在 apps/desktop/e2e/，而 architecture.md:50、:111 规定"桌面验收放在根 tests"，目录树中是 `tests/e2e/`。
- 修复：迁到 tests/e2e/，或在 architecture.md 中改写归属并说明理由（E2E 依赖 desktop 的 build 函数和 globalSetup）。

### A20 [judgement] 信任边界上 payload 只做了类型断言，没有校验
- 位置：apps/server/src/application/sessions.ts:217 把库中的 payload 直接 `as unknown as AgentMessage` 交给模型；renderer 的 features/conversation/timeline.ts:68、:82 和 stores/chat-store.ts:282 对 `entry.payload` 只做 `as` 断言，而协议中 `SessionEntry.payload` 定义为 `Type.Unknown()`（packages/protocol/src/http.ts:59），`MessagePayload`、`RunEndPayload` 定义了却没有用。
- 规则：architecture.md:81"业务 payload 的校验与迁移通过注册接口接入，由 server 装配"；testing.md:23 要求持久化与跨进程协议验证非法输入。client/api.ts:47 自己也声明"响应在信任边界按 schema 校验"。
- 修复：在 protocol 中把 SessionEntry 定义成按 kind 判别的联合类型，payload 使用 `RunEndPayload` / `MessagePayload`。server 恢复会话时，对不合格的条目记日志并跳过；renderer 用 `Value.Check` 过滤。

### A21 [judgement] http 和 ws 层直接访问 SessionStore
- 位置：apps/server/src/application/index.ts:10 在 Application 上暴露了 `store`；apps/server/src/http/app.ts:100 把它交给 `StreamConnection`；ws/connection.ts:50、:69 直接调用 `store.sessions.getSession/listEntries`。
- 规则：architecture.md:87"server 校验 protocol schema，通过 application 入口调用 agent 框架及 session 查询接口"；application/index.ts:8 自己的注释也写"http / ws 只经这里访问业务"。
- 修复：在 SessionService 上增加 `exists(id)` 和 `entriesAfter(id, seq)`，并从 Application 中移除 `store`。

---

## B. Fowler 坏味道（全部为 judgement）

### B1 Shotgun Surgery、Repeated Switches：Provider kind 与协议的映射散落在 6 处
- packages/protocol/src/http.ts:114、:117；packages/agent/src/models/registry.ts:18-21、:55-59；apps/server/src/application/providers.ts:18-23（`PROTOCOL` 表，与 agent 的 `PRESETS.protocol` 重复）、:95、:108；apps/server/src/adapters/credentials.ts:80-84（`KIND_ENV`）；renderer 的 features/settings/models-section.tsx:10（`KINDS`）、:211；i18n 的 `providers.kinds`。新增一种 kind 至少要改 6 个文件。
- 修复：agent 导出 `PROVIDER_KINDS` 和 `protocolOf(kind)`，server 的 `PROTOCOL` 改为调用它；renderer 的 KINDS 改用 `ProviderKind` schema 的 `anyOf` 或 presets 数据。protocol 中的 `ProviderKind` 与 agent 的同名类型之间加一个编译期等价断言。

### B2 Primitive Obsession：库中的 `kind` / `api` 是裸 string，用强转当作枚举
- packages/session/src/types.ts:83-85；apps/server/src/application/providers.ts:29、:36（`as ProviderKind`、`as ModelProtocol`）。`api` 是由 kind 推导的冗余列，持久化之后可能与 kind 不一致。
- 修复：读出后用 protocol schema 做 `Value.Check`，不合格时归入 `load()` 已有的警告分支；考虑不再持久化 `api`，改为现算。

### B3 Duplicated Code
- 三个 vanilla store 各自手写了 listener 集合：apps/desktop/src/renderer/app/{connection-store,appearance-store,settings-dialog-store}.ts。技术栈已经选定 zustand vanilla（TECH_STACK.md:159），可以统一用 `createStore`。
- `toApiError` 在 stores/chat-store.ts:82 和 stores/settings-store.ts:60 中逐字重复，可以移到 client/api.ts。
- "按 requestId 挂起并带超时"的写法出现了 4 次：apps/server/src/adapters/credentials.ts:36-57、apps/desktop/src/main/credentials.ts:86-96、sidecar-process.ts:222-243、apps/server/src/runtime/main.ts:57。可以提取一个 `createRequestTracker()` 小工具。
- `const message = (e) => e instanceof Error ? …` 在 layers.ts:45 等多处重复。

### B4 Feature Envy、错放的常量：`SESSION_COOKIE_NAME` 定义在 logging 包
- packages/logging/src/redact.ts:8 定义，apps/server/src/http/auth.ts:3 从 logging 导入它来签发 cookie。认证常量依赖日志包，方向不对。
- 修复：移到 `@coko/protocol`（api.ts），logging 从 protocol 导入。也可以由 server 在装配时把 cookie 名注册为脱敏模式。

### B5 Divergent Change：设置键分散在两处
- `DEFAULT_MODEL_SETTING` 定义在 protocol（http.ts:110），`THEME_SETTING` / `LOCALE_SETTING` 定义在 renderer（app/preferences.ts:7-8）。服务端对 value 不做任何校验（application/settings.ts:22），取值合法性只靠读方各自检查（sessions.ts:123、preferences.ts:39-40）。
- 修复：在 protocol 中建一张 `SETTINGS` 表，记录 key 到 value schema 的映射；SettingsService.put 按它校验，未知键拒绝或放行由规则明确决定。

### B6 Refused Bequest、Speculative Generality：`HostCredentialStore` 继承了用不到的写方法
- apps/server/src/adapters/credentials.ts:6、:74-75、:111-112：`modify` 和 `delete` 只会抛异常，接口却被迫实现。
- 修复：agent 的 port 只要求 `read` / `list`（`Pick<CredentialStore, 'read' | 'list'>`），在交给 pi-ai 的适配层再补默认实现。

### B7 Middle Man
- application/settings.ts 和 workspaces.ts 基本是 store 的薄转发，Application 同时又暴露 `store` 本身（A21）。两条访问路径并存，读者无从判断应该走哪条。
- 修复：与 A21 一起处理，只保留 service 路径。

### B8 Repeated Switches（小）
- apps/desktop/src/main/logging.ts:48-61 按 level 写了 6 个分支逐个调用。LogTape 的 Logger 有通用的 `log(level, …)` 入口，可以用一张映射表代替（实现前先确认 2.4.2 的 API）。

### B9 Mysterious Name、隐式全局状态
- packages/session/src/sqlite/repositories.ts:94 的 `later` 名字没有说明它做什么（把同步调用转成 Promise），建议改为 `asPromise`。
- models-section.tsx:20 的模块级 `let formSeq` 是隐式全局可变状态，可以改用 `React.useId()` 加计数 ref。
- models-section.tsx:73 的 spinner `aria-label={t('settings.models')}` 用了分区标题作为加载状态的可访问名称，应改为专门的 loading 文案。

### B10 Primitive Obsession：fatal code 没有枚举
- apps/desktop/src/main/sidecar-process.ts:46 用 `(string & {})` 兜底；protocol/control.ts:14 的 `code` 是任意字符串。apps/server/README.md:30 已经列出全部取值。
- 修复：在 protocol 中把 `SidecarFatalCode` 定义为联合类型（storage-* 可以写成模板字面量），renderer 的失败提示据此做穷尽判断。

### B11 观测缺口（行为层面，顺带记录）
- sidecar-process.ts:174 在就绪后收到非法控制消息时，静默调用 `#terminate()`，不记录任何日志；随后由 index.ts:94 记成 "exited unexpectedly"，原因丢失。
- main 没有监听 `render-process-gone` / `child-process-gone`（grep 无结果），而 observability.md:15 要求 main 记录 renderer 崩溃。
- main/credentials.ts:41-96：Sidecar 退出时，挂起的 `credential.store` 请求不会立即失败，要等满 10 秒超时。
- 修复：前两项补上日志与监听器；第三项订阅 `onUnexpectedExit`，立即以 `sidecar-unavailable` 结束所有挂起的请求。

---

## 汇总

| 编号 | 严重度 | 领域 | 一句话 |
| --- | --- | --- | --- |
| A1 | hard | 凭据 | retry 进度的错误文本未脱敏，直推 renderer |
| A2 | hard | 凭据 | bash 继承 Credential 环境变量 |
| A3 | judgement | 生命周期 | 打包后仍放行 COKO_FAUX_SCRIPT |
| A4 | hard | 观测 | sidecar 日志缺 appVersion |
| A5 | judgement | 观测 | 关联 ID 不跨边界 |
| A6 | hard | 持久化 | 隔离先于租约，可能误隔离活跃库 |
| A7 | hard | 架构 | sidecar 构建归属与依赖声明不符 |
| A8 | hard | 文档 | ADR 0001/0002 状态过时 |
| A9 | hard | 文档 | 三处过时注释 |
| A10 | hard | i18n | main 对话框文案没走字典 |
| A11 | hard | i18n | 逻辑比较翻译文本 |
| A12 | hard | UI | 表单显示技术错误原文 |
| A13 | hard | UI/a11y | outline-none 清除焦点环 |
| A14 | hard | UI | 错误边框 0.5px |
| A15 | judgement | 文档 | 多个包缺 README |
| A16 | judgement | 生命周期 | 无重启与重新交换路径 |
| A17 | judgement | 交付 | make/publish/watch 偏离未记录 |
| A18 | hard | 测试 | 固定 sleep 制造交叠 |
| A19 | judgement | 测试 | E2E 目录与约定不一致 |
| A20 | judgement | 协议 | payload 只断言、不校验 |
| A21 | judgement | 架构 | ws/http 绕过 application |
| B1–B11 | judgement | 坏味道 | 见 B 节 |

建议优先处理 A1、A2、A6、A13（安全或可访问性），然后是 A7、A8（文档与构建归属同批修正）。
