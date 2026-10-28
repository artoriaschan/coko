# pi-agent-core / pi-ai / pi-mcp 1.4.0 接口与 pi coding-agent 组织方式调研

## 结论摘要

1. pi-agent-core 1.4.0 只剩 `Agent`、agent loop、proxy stream 和类型。harness、session、compaction、skills、prompt template 在 **1.0.0** 已移出（AG/../CHANGELOG.md:35），所以 coko 的 instructions/context/session 必须自建。
2. `Agent` 的接入点有 `beforeToolCall`/`afterToolCall`/`prepareRequest`/`finishTurn`/`prepareNextTurn(WithContext)`/`transformContext`/`convertToLlm`/`getApiKey`，可以直接作为 coko engine 的统一接入链。`subscribe` 监听器按订阅顺序串行 await，并计入 run 结算，可当作持久化提交屏障。
3. 并行批次：先串行 prepare（参数校验加 `beforeToolCall`），再并发执行。`tool_execution_end` 按完成顺序发出，toolResult 消息按 assistant 源顺序发出，与 coko“持久化保持原始调用顺序”一致。批内只要有一个工具声明 `executionMode:"sequential"`，整批就降级为串行。
4. pi-ai 1.4.0 的核心是 `createModels()`/`createProvider()`/`Models.streamSimple()`。流返回后的失败不抛异常，而是编码为 `stopReason:"error"|"aborted"` 的 AssistantMessage。`ModelsError.code` 只在 getAuth/login/logout 等直接调用时 reject。凭据通过可注入的 `CredentialStore` 接口传入，适合由宿主实现。
5. pi-mcp 1.4.0 的 `McpClient` 提供 connect、tools、resources（含分页）、`callTool`、通用 `request/notify`、通知订阅和 roots，**没有 prompts 方法**。prompts/list、prompts/get 需要 coko 用 `request()` 封装，与 agent-runtime.md 的判断一致。
6. coding-agent 内置 8 个工具（read/bash/powershell/edit/write/grep/find/ls），统一截断上限为 2000 行 / 50KB。每个工具都通过 `*Operations` 接口把 IO 抽成可替换实现，适合移植到 coko 的“内置 + 宿主覆盖”模型。
7. 移植阻断点：默认 grep/find spawn ripgrep/fd，本机缺失时**运行时从 GitHub 下载二进制**，违反 coko“内置工具不依赖二进制、grep 纯 JS”的约束；read 的图片缩放依赖 photon wasm。这两处必须改写，schema 保持不变。
8. AGENTS.md 加载规则：全局 agentDir 一份，加上从 cwd 逐级向上的每个祖先目录各一份；每个目录只取候选列表中第一个存在的文件（AGENTS.override.md → AGENTS.md → … → CLAUDE.MD），注入时包在 `<project_instructions path=…>` 里。逻辑小而独立，可以拷贝后加上 workspace 边界和信任检查。
9. skills 和 prompt templates 是纯函数加 frontmatter 解析，可以近乎原样拷贝。extensions 依赖 jiti 动态加载 TS 并与 TUI 耦合，不移植实现，只借鉴事件名和返回值语义。compaction 的阈值、切点和摘要 prompt 可以借鉴，但输入绑定在 pi SessionManager 的树形 entry 上，需要改造。
10. pi 的 SessionManager（JSONL v3、id/parentId 树、appendFileSync、无 fsync）和 AuthStorage（auth.json + proper-lockfile）都不适合 coko，只作数据模型参考。

## 0. 来源与版本

| 包 | package.json 版本 | 直接依赖（v1.4.0 tag） | engines |
| --- | --- | --- | --- |
| @earendil-works/pi-agent-core | 1.4.0 | pi-ai 1.4.0、typebox 1.3.27 | node >=22.19.0 |
| @earendil-works/pi-ai | 1.4.0 | @anthropic-ai/sdk 0.129.0、@aws-sdk/client-bedrock-runtime 3.1127.0、@google/genai 2.21.0、openai 7.19.0、pi-telemetry 1.4.0、partial-json 0.1.7、typebox 1.3.27 等 | node >=22.19.0 |
| @earendil-works/pi-mcp | 1.4.0 | cross-spawn 7.0.6 | node >=22.19.0 |
| @earendil-works/pi-coding-agent | 1.4.0 | pi-agent-core/pi-ai/pi-mcp/pi-codemode/pi-tui 1.4.0、@silvia-odwyer/photon-node 0.3.4、diff 8.0.4、ignore 7.0.8、jiti 2.7.0、minimatch 10.2.6、proper-lockfile 4.1.2、undici 8.10.2、yaml 2.9.0 等 | node >=22.19.0 |

- 本地仓库 `/Users/chenzheng/Desktop/Work/open_sources/pi` 的 HEAD 为 `v1.4.0-103-ga92283056`，比 tag 多 103 个提交，但四个 package.json 的 version 仍是 1.4.0。`git diff --stat v1.4.0 HEAD` 显示 agent 只改了 `src/proxy.ts`，ai/coding-agent/mcp 有若干改动。**下文行号以 v1.4.0 tag 为准**（用 `git archive v1.4.0` 导出后读取），对应 `https://github.com/earendil-works/pi/blob/v1.4.0/<路径>`。
- 路径缩写（展开后都是绝对路径）：
  - AG = `/Users/chenzheng/Desktop/Work/open_sources/pi/packages/agent/src`
  - AI = `/Users/chenzheng/Desktop/Work/open_sources/pi/packages/ai/src`
  - MC = `/Users/chenzheng/Desktop/Work/open_sources/pi/packages/mcp/src`
  - CA = `/Users/chenzheng/Desktop/Work/open_sources/pi/packages/coding-agent/src/core`
- 许可证：仓库根 LICENSE 为 MIT（`/Users/chenzheng/Desktop/Work/open_sources/pi/LICENSE`），拷贝源码时需保留版权声明。
- 已核对的 coko 背景文档：docs/TECH_STACK.md、docs/tech-stack/agent-runtime.md、docs/tech-stack/architecture.md。

## 1. pi-agent-core 1.4.0：Agent 公开 API

导出入口为 AG/index.ts:1-5，导出 agent、agent-loop、proxy、`setDefaultStreamFn` 和 types。

### 1.1 构造参数 `AgentOptions`（AG/agent.ts:115-147）

| 字段 | 类型 / 默认值 | 说明 |
| --- | --- | --- |
| `initialState` | `Partial<{systemPrompt, model, thinkingLevel, tools, messages}>` | systemPrompt 和 tools 合成首条 system message；messages 已以 system 开头时不再合成（agent.ts:78-112） |
| `streamFn` | `StreamFn`，**类型上必填** | 运行时缺失时回退到 `setDefaultStreamFn()` 设置的值，两者都没有则抛错（agent.ts:244，stream-fn.ts:11-20）。`Models.streamSimple` 满足该签名（types.ts:19-37） |
| `convertToLlm` | 默认只保留 system/user/assistant/toolResult | 契约：不得抛错（types.ts:196-222） |
| `transformContext` | `(msgs, signal) => Promise<AgentMessage[]>` | 在 convertToLlm 之前调用，用于裁剪或注入（types.ts:244） |
| `getApiKey` | `(provider) => string\|undefined` | 每次 LLM 调用前解析，适合短期 token（types.ts:254） |
| `beforeToolCall` / `afterToolCall` / `finishTurn` / `prepareRequest` | 见 1.3 | |
| `prepareNextTurn(signal)` / `prepareNextTurnWithContext(ctx, signal)` | 两者都设置时用后者 | agent.ts:494-502 |
| `steeringMode` / `followUpMode` | `"all"\|"one-at-a-time"`，默认 one-at-a-time | agent.ts:255-256 |
| `toolExecution` | `"sequential"\|"parallel"`，默认 parallel | agent.ts:261 |
| `sessionId`、`thinkingBudgets`、`transport`（默认 "auto"）、`maxRetryDelayMs` | 透传给 stream | agent.ts:257-260 |
| `onPayload` / `onResponse` / `onProviderStreamEvent` | 透传 pi-ai 的观测回调 | agent.ts:121-123 |
| `identity` | `ClientIdentity`，默认 `{attribution: PI_ATTRIBUTION}` | 传 `{attribution:null}` 不发送 pi 归属头（agent.ts:142-146，agent-loop.ts:41） |

### 1.2 方法与状态

| API | 签名 / 语义 | 位置 |
| --- | --- | --- |
| `subscribe(listener)` | `(event, signal) => void\|Promise<void>`，返回取消函数。监听器按订阅顺序**串行 await**，并计入 run 结算 | agent.ts:265-278、619-621 |
| `state` | `AgentState`：systemPrompt（只读，从 system 消息回放）、model、thinkingLevel、tools/messages（赋值时拷贝顶层数组）、isStreaming、streamingMessage、pendingToolCalls、errorMessage | types.ts:382-421 |
| `prompt(text, images?)` / `prompt(msg\|msg[])` | 运行中调用会抛错 "Agent is already processing a prompt. Use steer() or followUp()…" | agent.ts:380-390 |
| `continue()` | 最后一条是 assistant 时，先 drain steering，再 drain follow-up，都为空则抛错；否则从当前 transcript 继续 | agent.ts:393-420 |
| `steer(m)` / `followUp(m)` | 入队 | agent.ts:308-315 |
| `clearSteeringQueue / clearFollowUpQueue / clearAllQueues / hasQueuedMessages / peekQueuedMessages` | 队列管理 | agent.ts:318-342 |
| `abort()` / `signal` | abort 当前 run 的 AbortController | agent.ts:345-352 |
| `waitForIdle()` | agent_end 的监听器全部结算后 resolve | agent.ts:359-361 |
| `reset()` | 清空队列，保留 system 基线；运行中调用会抛错 | agent.ts:364-377 |
| 底层 API | `agentLoop / agentLoopContinue`（返回 EventStream）；`runAgentLoop / runAgentLoopContinue`（通过 emit 回调） | agent-loop.ts:47-160 |
| `runToolCall(toolCall, {tools, assistantMessage, context, signal, onUpdate, beforeToolCall, afterToolCall})` | 嵌套调用走同一条链：prepare → validate → before → execute → after。不发事件，也不 reject | agent-loop.ts:800-829 |

run 内的异常（包括监听器抛错）由 `runWithLifecycle` 捕获。它会合成一条 `stopReason: aborted|error` 的 assistant 消息，并补发 message_start/end、turn_end 和 agent_end（agent.ts:517-558）。

### 1.3 生命周期接入点（AG/types.ts）

| 接入点 | 签名 | 时机与语义 |
| --- | --- | --- |
| `beforeToolCall` | `(ctx:{assistantMessage, toolCall, args(已校验), context}, signal) => Promise<{block?, reason?, terminate?}\|undefined>` | 在 prepareArguments 和 schema 校验之后、execute 之前调用。返回 `block:true` 时产生一条错误 toolResult（默认文本 "Tool execution was blocked"）。钩子返回后若 signal 已 aborted，结果为 "Operation aborted"（types.ts:66-74、107-116、326；agent-loop.ts:718-787） |
| `afterToolCall` | `(ctx:{…, result, isError}, signal) => Promise<{content?, details?, structuredContent?, isError?, usage?, terminate?}\|undefined>` | 按字段整体替换，不做深合并。只替换 content 时会丢弃 structuredContent。钩子抛错时结果变为错误 toolResult（types.ts:92-104、341；agent-loop.ts:869-920） |
| `prepareRequest` | `(req:{context, model, thinkingLevel}, signal) => {context?, model?, thinkingLevel?}\|void` | **每次** provider 请求前调用，包括第一次。调用时 pending 消息已追加。返回值替换本次及后续请求的 context/model/thinking。不会轮询队列（types.ts:172-189、271；agent-loop.ts:228-248） |
| `finishTurn` | `(turn:{message, toolResults, context, newMessages}, signal) => {action:"continue"}\|{action:"end"}\|void` | 在 assistant 消息和所有 toolResult 发出之后、turn_end 之前调用。`end` 直接结束，不再轮询队列。`continue` 保证至少再发一次请求；若工具结果、steering 或 follow-up 本来就会触发请求，则不额外增加。error/aborted 时也会调用，但返回值被忽略（types.ts:146-158；agent-loop.ts:254-306、319-323） |
| `prepareNextTurn` | `(ctx) => {context?, messages?, model?, thinkingLevel?}` | turn_end 之后、下一个 turn 开始前调用，仅在已有完成的 turn 时触发。适合做压缩。执行完会补轮询一次 steering（types.ts:161-170、278；agent-loop.ts:194-217） |
| `getSteeringMessages` / `getFollowUpMessages` | Agent 内部绑定到两个队列 | agent.ts:506-513 |

### 1.4 循环顺序、steering、follow-up 与取消

- **启动**：发出 agent_start、turn_start 和 prompt 消息，然后首次轮询 steering。`continue()` 从 assistant 恢复时跳过这次轮询（agent-loop.ts:126-133、185；agent.ts:404-407）。
- **每轮**：
  1. 注入 pending 消息。注入前经过 `declareToolChanges`：如果 `state.tools` 与 transcript 中声明的工具不同，会插入一条带 toolsAdded/toolsRemoved 的 system 消息。
  2. 调用 prepareRequest，然后流式请求。
  3. 结果为 error/aborted 时退出。
  4. 否则执行工具，调用 finishTurn，发出 turn_end，再轮询 steering。

  见 agent-loop.ts:188-308、342-372。
- **steering** 在当前 assistant 的工具全部执行完之后注入，不会跳过本轮已发出的工具调用（types.ts:282-293）。**follow-up** 只在没有工具调用、也没有 steering 时注入（agent-loop.ts:310-317）。
- 如果 assistant 消息的 `stopReason:"length"`，其中的工具调用一律不执行，返回错误让模型重发（agent-loop.ts:273-279、488-513）。
- **取消**：`abort()` 后 provider 产出 `stopReason:"aborted"`，本轮结束。工具批次的处理：
  - 串行批次：当前工具完成后 break。
  - 并行批次：尚未开始的调用直接返回 "Operation aborted"；已在执行的调用要由工具自己响应 signal。

  见 agent-loop.ts:585-587、623-638、651-653。

### 1.5 事件类型 `AgentEvent`（AG/types.ts:516-539）

| 事件 | 字段 |
| --- | --- |
| `agent_start` | — |
| `agent_end` | `messages` |
| `turn_start` | — |
| `turn_end` | `message, toolResults` |
| `message_start` / `message_end` | `message` |
| `message_update` | `message, assistantMessageEvent`（仅 assistant 流式输出时） |
| `tool_execution_start` | `toolCallId, toolName, args` |
| `tool_execution_update` | 同上，加 `partialResult` |
| `tool_execution_end` | 同上，加 `result, isError, durationMs?` |

Agent 在调用监听器之前先归约状态：message_end 时 push 到 `state.messages`，tool_execution_* 时维护 `pendingToolCalls`（agent.ts:575-622）。agent_end 只表示不会再有事件；它的监听器结算完之后 run 才进入 idle（types.ts:509-515）。

### 1.6 工具契约与批次

- **AgentTool**：`AgentTool extends Tool{name, description, parameters(TypeBox), constrainedSampling?}`，另加 `label`、`prepareArguments?`、`outputSchema?`、`execute(toolCallId, params, signal?, onUpdate?)`、`replay?: "never"|"safe"`、`executionMode?`（types.ts:466-499；Tool 见 AI/types.ts:762-767）。
- **AgentToolResult**：`{content, details, structuredContent?, usage?, isError?, terminate?}`。失败时可以 throw，也可以返回 `isError:true`。只有批内**全部**结果都带 `terminate:true` 时才提前停止（types.ts:424-446；agent-loop.ts:700-702）。
- **replay**：`replay` 只有类型声明，agent-core 不使用它（grep 只命中注释）。恢复策略需要 coko 自己实现。
- **批次选择**：`config.toolExecution==="sequential"`，或批内任一工具 `executionMode:"sequential"` 时走串行，否则并行（agent-loop.ts:518-533）。
- **并行执行**：prepare 串行，执行用 `Promise.all`；tool_execution_end 按完成顺序，toolResult 消息按源顺序（agent-loop.ts:596-670）。**没有并发上限，也没有依赖图**，与 agent-runtime.md:61 的判断一致。

## 2. pi-ai 1.4.0：provider、模型注册、流式调用、错误

`AI/index.ts` 只导出核心，无副作用，不含模型目录、provider 工厂和 OAuth 实现。其他内容在子路径中：provider 工厂在 `@earendil-works/pi-ai/providers/*`，API 实现在 `/api/*`，旧的全局 API 在 `/compat`（index.ts:4-8，package.json 的 exports）。

### 2.1 注册与查询

| API | 签名 | 位置 |
| --- | --- | --- |
| `createModels(opts?)` | `{credentials?: CredentialStore, modelsStore?: ModelsStore, authContext?: AuthContext, identity?}` → `MutableModels` | AI/models.ts:376-382、1028 |
| `MutableModels` | `setProvider(p)`（按 id upsert）、`deleteProvider`、`clearProviders` | models.ts:369-374 |
| 读取 | `getProviders / getProvider / getModels(provider?) / getModel(provider,id) / getModelsOfType / getAllModels`，同步读取最近一次已知的列表 | models.ts:258-281 |
| 刷新 / 可用性 | `refresh({allowNetwork, providers, force, signal}) → {aborted, errors: Map}`（不 reject）；`checkAuth`；`getAvailable(…)` | models.ts:283-304 |
| 认证 | `getAuth(providerId\|model)`、`login(providerId, type, interaction, opts)`、`logout` | models.ts:306-322 |
| 请求 | `stream / complete`（provider 专属选项）、`streamSimple / completeSimple`（统一的 reasoning 选项）、`streamDeferred / fetchDeferred / cancelDeferred`、`generateImages`、`classify` | models.ts:324-366 |
| `createProvider(opts)` | `{id, name?, baseUrl?, headers?, auth: ProviderAuth, models, fetchModels?, filterModels?, api?: ProviderStreams \| Record<api, ProviderStreams>, images?, classifiers?}` | models.ts:1032-1077 |
| 内置 provider | `builtinProviders()`（42 个，含 anthropic、openai、deepseek、moonshotai、zai、qwen-token-plan 等）、`builtinModels(opts)`、`getBuiltinModel(provider,id)` | AI/providers/all.ts:62-190 |
| 单 provider 示例 | `deepseekProvider() = createProvider({id:"deepseek", baseUrl:"https://api.deepseek.com", auth:{apiKey: envApiKeyAuth("DeepSeek API key",["DEEPSEEK_API_KEY"])}, models, api: openAICompletionsApi()})` | AI/providers/deepseek.ts:6-15 |
| 测试 | `fauxProvider({tokensPerSecond?})`，配合 `fauxAssistantMessage / fauxText / fauxThinking / fauxToolCall` | packages/ai/README.md:1487-1520；AI/providers/faux.ts |

`KnownApi` 包括 openai-completions、openai-responses、azure-openai-responses、openai-codex-responses、anthropic-messages、bedrock-converse-stream、google-generative-ai、google-vertex、mistral-conversations、pi-messages（AI/types.ts:64-76），覆盖 coko 选定的三种协议。

`Model<TApi>` 的关键字段：`id, name, api, provider, baseUrl, input, cost, reasoning, thinkingLevelMap?, promptCache?, contextWindow, maxTokens, samplingParams?, compat?`（types.ts:833-880）。相关工具函数：`getSupportedThinkingLevels`、`clampThinkingLevel`、`calculateCost`、`modelsAreEqual`（models.ts:1236-1296）。

### 2.2 流式调用

- **StreamOptions**（继承 ProviderRequestOptions）：`signal, telemetry, apiKey, fetch, env, onPayload, onResponse, headers, identity, timeoutMs, maxRetries, maxRetryDelayMs(默认 60000), temperature, samplingParams, maxTokens, transport, cacheRetention, sessionId, websocketConnectTimeoutMs, metadata, onProviderStreamEvent`（AI/types.ts:160-270）。
- **SimpleStreamOptions** 在此基础上增加 `toolChoice?: "auto"|"none"`、`reasoning?: ThinkingLevel`、`deferred?`、`thinkingBudgets?`（types.ts:377-385）。
- **上下文**：公开入口接收 `Context{systemPrompt?, messages, tools?}`，由 `normalizeContext()` 折叠为 `TranscriptContext`；提示词和工具声明都放进 system 消息（types.ts:779-796）。`SystemMessage` 支持 `sections`（按名称替换，null 表示删除）和 `toolsAdded / toolsRemoved`（types.ts:554-570），可以用来增量更新指令。
- **事件**：`AssistantMessageEvent` 包括 start、text_start/delta/end、thinking_start/delta/end、toolcall_start/delta/end、`done{reason: stop|length|toolUse|deferred}`、`error{reason: aborted|error}`（types.ts:814-830）。事件里的 `partial` 是共享的实时对象，不是快照。
- **事件流**：`AssistantMessageEventStream` 可异步迭代；`result()` 返回最终消息，并自动写入 durationMs（AI/utils/event-stream.ts:26-130）。

### 2.3 错误类型与策略

| 机制 | 内容 | 位置 |
| --- | --- | --- |
| 流内错误 | 流返回后的请求失败**不抛异常**：以 error 事件结束，最终消息带 `stopReason:"error"\|"aborted"`、`errorMessage`，以及已收到的部分 content 和 usage。`Models` 内部的 setup 失败（未知 provider、未配置 auth、OAuth 刷新失败）也经 `lazyStream` 编码为流错误。例外：直接调用 API 模块的 streamSimple 时，缺少 auth 会**同步抛错** | packages/ai/README.md:1148-1172；AI/api/lazy.ts:55-86；models.ts:872-874 |
| `StopReason` | pending、stop、length、toolUse、error、aborted、deferred | types.ts:482 |
| `ModelsError` | `code: model_source\|model_validation\|provider\|stream\|auth\|oauth`，message 中附带 cause | AI/utils/models-error.ts:3-21 |
| 可重试判定 | `isRetryableAssistantError(msg)`：匹配 overloaded、rate limit、429/5xx、upstream 等；排除 quota、billing 等 | AI/utils/retry.ts:7-60、266-271 |
| 重试循环 | `retryAssistantCall(produce, {enabled, maxRetries, baseDelayMs, maxAgentDelayMs}, signal, {onRetryScheduled, onRetryAttemptStart, onRetryFinished})`，指数退避，aborted 不重试 | retry.ts:130-255 |
| 上下文溢出 | `isContextOverflow(msg, contextWindow?)`：错误文案匹配、usage 超出窗口、length 且 output=0；另有 `isRecoverableLength(msg, desiredMax)` | AI/utils/overflow.ts:142-186 |
| 工具参数 | `ToolCall.argumentsError` 表示参数 JSON 非法，在校验阶段失败；导出 `validateToolArguments` | types.ts:444-457；AG/agent-loop.ts:737 |

### 2.4 凭据接口（可注入）

- **CredentialStore**：`{read(id), list(), modify(id, fn), delete(id)}`。`modify` 是唯一写路径，按 provider 串行执行；OAuth 刷新在 modify 内进行，避免并发重复刷新（AI/auth/types.ts:65-94）。默认实现为 `InMemoryCredentialStore`。
- **Credential**：`{type:"api_key", key?, env?} | {type:"oauth", refresh, access, expires, …}`（auth/types.ts:17-37）。
- **ProviderAuth**：`{apiKey?: ApiKeyAuth{name, login?, check?, resolve}, oauth?: OAuthAuth{name, login, refresh, toAuth}}`（auth/types.ts:170-255）。`envApiKeyAuth(name, envVars)` 先用已存储的凭据，没有时取第一个已设置的环境变量（AI/auth/helpers.ts:9-31）。
- **AuthContext**：`{env(name), fileExists(path)}` 可注入，sidecar 可以用它控制是否读取 process.env（auth/types.ts:97-101）。

## 3. pi-mcp 1.4.0：客户端接口

导出见 MC/index.ts:1-72；OAuth 在 `@earendil-works/pi-mcp/oauth` 子路径（MC/oauth/index.ts）。

| API | 签名 | 位置 |
| --- | --- | --- |
| `new McpClient(opts)` | `McpClientOptions extends Implementation{name, version, title?}`，加 `capabilities?`、`protocolVersion?`、`requestTimeoutMs?`（默认 30000）、`roots?: Root[] \| () => Root[]` | MC/client.ts:38、47-52、173-182 |
| `connect(transport)` | 返回 `InitializeResult`。只能在 idle 状态调用；会校验协议版本；失败时自动 close | client.ts:204-250 |
| 状态 | `connectionState: idle\|connecting\|connected\|closed`、`serverInfo`、`serverCapabilities`、`instructions`、`protocolVersion` | client.ts:41、184-202 |
| 通用 | `request<R>(method, params?, {signal?, timeoutMs?, onProgress?})`、`notify`、`setRequestHandler`、`onNotification`、`onError`、`onClose`、`ping` | client.ts:54-58、252-294 |
| 工具 | `listTools()` 自动翻页（最多 1000 页，检测重复 cursor）；`callTool(name, args?, opts) → CallToolResult`，缺少 content 时补 [] | client.ts:296-298、357-386 |
| 资源 | `listResources() / listResourcesPage(cursor?) / listResourceTemplates() / listResourceTemplatesPage(cursor?) / readResource(uri)` | client.ts:301-339 |
| prompts | **没有专用方法**，需要用 `request("prompts/list"\|"prompts/get")` 并自行校验结果 | client.ts 方法列表 |
| 内容转换 | `toLlmContent({content, structuredContent})`：没有 content 时把 structuredContent 转成 JSON 文本 | MC/protocol/content.ts:112-118 |
| 传输接口 | `McpTransport{start, send(msg,{signal}), close, onMessage, onError, onClose, setProtocolVersion?}` | MC/transports/transport.ts:18-26 |
| `StdioTransport` | `{command, args?, cwd?, env?, inheritEnv?, stderr?: "pipe"\|"inherit", onStderr?, maxMessageBytes?, maxStderrBytes?, closeTimeoutMs?}`。closeTimeoutMs 默认 2000，超时后从 SIGTERM 升级为 SIGKILL；进程用 cross-spawn 启动 | transports/stdio.ts:55-67 |
| `StreamableHttpTransport` | `{url, headers?, fetch?, openGetStream?(默认 true), maxMessageBytes?, authProvider?, reconnect?}`；`AuthProvider{token(), onUnauthorized?(ctx)}` | transports/streamable-http.ts:120-130；auth-provider.ts:13-20 |
| 错误 | `McpError{code, data}`（JSON-RPC）、`McpConnectionClosedError`、`McpTimeoutError{timeoutMs}`、`McpAbortError`（name 为 "AbortError"）、`McpHttpError{status, body}`、`McpAuthRequiredError{wwwAuthenticate}`（401）、`McpSessionExpiredError`（404） | protocol/jsonrpc.ts:37-79；streamable-http.ts:132-159 |

## 4. pi coding-agent 的组织方式

### 4.1 内置工具

每个工具提供 `create<X>ToolDefinition(cwd, options)` 和 `create<X>Tool`，后者经 `wrapToolDefinition` 转成 AgentTool（CA/tools/index.ts:118-224；CA/tools/tool-definition-wrapper.ts:8-30）。`ToolName` 为 read|bash|powershell|edit|write|grep|find|ls（index.ts:95）。预设组合：coding = read/bash/edit/write，readOnly = read/grep/find/ls（index.ts:164-211）。

`ToolDefinition` 比 AgentTool 多出 `promptSnippet`、`promptGuidelines`、`exposure`、`namespace`、`annotations`、`defaultActive`、`prepareLoadout` 和渲染相关字段（CA/extensions/types.ts:579-650）。

内置工具都没有声明 executionMode，因此默认并行执行。写同一文件时由 `withFileMutationQueue` 按 realpath 串行，不同文件仍并行（CA/tools/file-mutation-queue.ts:28-59）。

| 工具 | 参数 schema（TypeBox） | 结果 / details | 截断与特殊行为 | IO 抽象 | 位置 |
| --- | --- | --- | --- | --- | --- |
| read | `path`、`offset?`（从 1 开始）、`limit?` | 文本；`details.truncation?`；图片返回 image block | `truncateHead`，2000 行 / 50KB，提示 "Use offset=N to continue"。offset 越界报错。图片按模型的 inputLimits 缩放；模型不支持图片时给出提示 | `ReadOperations{readFile, access, detectImageMimeType?}` | read.ts:14-18、40-70、96、159-199 |
| write | `path`、`content` | "Successfully wrote to …" | 递归 mkdir；经过 mutation queue | `WriteOperations{writeFile, mkdir}` | write.ts:11-42、67-86 |
| edit | `path`、`edits: [{oldText, newText}]` | `details{diff, patch, firstChangedLine?}` | 每个 oldText 都在**原文件**上匹配，必须唯一且互不重叠。先精确匹配，失败后模糊匹配（NFKC、去行尾空白、引号与破折号归一）。保留 BOM 和 CRLF。`prepareArguments` 兼容旧的单个 oldText/newText 写法 | `EditOperations{readFile, writeFile, access}` | edit.ts:21-101、151-212；edit-diff.ts:11-37、207-240 |
| bash | `command`、`timeout?`（秒，无默认值） | 文本；`details{truncation?, fullOutputPath?}`；`structuredContent{output, truncated, full_output_path?, exit_code, wall_time_seconds}`；退出码非 0 时 `isError:true` | `OutputAccumulator` 保留尾部 2000 行 / 50KB，超出部分把全文写入临时文件。节流后流式调用 onUpdate。abort 或超时时 `killProcessTree`（进程以 detached 进程组启动）。注入 PI_* 环境变量 | `BashOperations.exec(cmd, cwd, {onData, signal, timeout, env}) → {exitCode}`；`spawnHook`、`commandPrefix`、`shellPath` | bash.ts:27-94、99-161、214-225、261-412 |
| grep | `pattern`、`path?`、`glob?`、`ignoreCase?`、`literal?`、`context?`、`limit?`（默认 100） | `details{truncation?, matchLimitReached?, linesTruncated?}` | 单行最多 500 字符，总量 50KB。**默认 spawn rg**（`--json --hidden`）；本机没有 rg 时通过 `ensureTool("rg")` 从 GitHub 下载 | `GrepOperations{isDirectory, readFile}` 只覆盖上下文行读取，搜索本身仍走 rg | grep.ts:21-68、119-170；truncate.ts:13 |
| find | `pattern`（glob）、`path?`、`limit?`（默认 1000） | `details{truncation?, resultLimitReached?}` | 默认使用 **fd**，同样可能下载。提供自定义 `glob()` 时不走 fd，并忽略 `**/node_modules/**` 和 `**/.git/**` | `FindOperations{exists, glob}` | find.ts:26-68、112-216 |
| ls | `path?`、`limit?`（默认 500） | `details{truncation?, entryLimitReached?}` | 按字母排序，目录加 / 后缀，包含 dotfile | `LsOperations{exists, stat, readdir}` | ls.ts:11-52、62 |

共享截断（CA/tools/truncate.ts:1-120）：
- 默认值：`DEFAULT_MAX_LINES=2000`、`DEFAULT_MAX_BYTES=50KB`。
- 函数：`truncateHead / truncateTail / truncateLine / formatSize`。
- `TruncationResult` 记录 truncatedBy、原始总行数与字节数、输出行数与字节数。

rg/fd 的下载逻辑在 `/Users/chenzheng/Desktop/Work/open_sources/pi/packages/coding-agent/src/utils/tools-manager.ts`:31-56、259-351。

### 4.2 AGENTS.md 与系统提示

- **`loadProjectContextFiles({cwd, agentDir})`**（CA/resource-loader.ts:184-273）：
  - 先读 agentDir 中的一个文件。agentDir 默认为 ~/.pi/agent，可以用环境变量覆盖。
  - 再从 cwd 逐级向上查找，一直到文件系统根，祖先目录的文件排在前面。
  - 每个目录只取候选列表中第一个存在的文件：AGENTS.override.md、AGENTS.md、AGENTS.MD、CLAUDE.md、CLAUDE.MD。
  - 按路径去重。嵌套的 linked worktree 中，自身的上下文文件会屏蔽主仓库的同名文件。
- **SYSTEM.md 与 APPEND_SYSTEM.md**：前者替换默认系统提示，后者追加内容。两者都分项目级（`.pi/` 目录）和全局两份（resource-loader.ts:1214-1233）。
- **`buildSystemPromptSections()`**（CA/system-prompt.ts:79-86、128-205）：
  - 输出 preamble，以及 `<tools>`、`<rules>`（取自工具的 promptGuidelines）、`<docs>`、`<addendum>`、`<project_context>`（每个文件用 `<project_instructions path="…">` 包裹）、`<skills>`、`<cwd>` 和自定义 sections。
  - 产出形态就是 pi-ai 的 `SystemMessage.sections`。

### 4.3 Skills

- **发现**：来源为 agentDir/skills、cwd/.pi/skills 和显式路径。目录中有 SKILL.md 就作为 skill 根，不再向下递归；跳过以 . 开头的目录和 node_modules，并遵守 ignore 文件。按 realpath 去重；同名时先加载的生效，冲突记为 diagnostic（CA/skills.ts:164-262、414-460）。
- **frontmatter**（skills.ts:10-14、67-127、293-337）：
  - `name`：最长 64 字符，只允许 [a-z0-9-]，首尾不能是连字符，不能有连续连字符；缺省时取父目录名。
  - `description`：必填，最长 1024 字符。
  - `disable-model-invocation`：可选。
  - 解析结果为 `Skill{name, description, filePath, baseDir, sourceInfo, disableModelInvocation}`。
- **注入**：在 system 中渲染 `<available_skills><skill><name/><description/><location/></skill>…`，模型按需用 read 或 bash 读取（skills.ts:358-388）。
- **显式调用**：`/skill:name args` 会展开为 `<skill name location>…</skill>`（CA/agent-session.ts:2207-2224）。

### 4.4 Prompt templates

- **来源**：agentDir/prompts、cwd/.pi/prompts 和显式路径，只读取一层 .md 文件。name 取文件名；description 取 frontmatter，缺省时取首个非空行；另支持 `argument-hint`（CA/prompt-templates.ts:12-19、120-160、221-241）。
- **展开**：`/name args` 先经 `parseCommandArgs` 按 bash 风格处理引号，再由 `substituteArgs` 替换。支持 `$1`、`$@` / `$ARGUMENTS`、`${N:-default}`、`${@:N[:L]}`，不做递归替换（prompt-templates.ts:25-76、309-325）。

### 4.5 Extensions / hooks

- **加载**：用 jiti 动态 import TS 文件，来源为 cwd/.pi/extensions、agentDir/extensions 和 package.json 中的 `pi.extensions`（CA/extensions/loader.ts:1-60、579-584、747-857）。
- **`ExtensionAPI.on(event)` 支持的事件**（extensions/types.ts:1592-1664）：
  - 资源与信任：project_trust、resources_discover、mcp_servers_change。
  - 会话：session_start、session_info_changed、session_before_switch、session_before_fork、session_before_compact、session_compact、session_compact_failed、session_shutdown、session_before_tree、session_tree。
  - 上下文与请求：context、context_with_system、cache_warming_decision、before_provider_request、before_provider_headers、after_provider_response、provider_stream_event。
  - 运行：before_agent_start、agent_start、agent_end、agent_settled、turn_start、turn_end。
  - 消息与工具：message_start、message_update、message_end、tool_execution_start、tool_execution_update、tool_execution_end、tool_call、tool_result。
  - 其他：model_select、thinking_level_select、user_bash、input。
- **关键返回值**（types.ts:1443-1517）：
  - `tool_call` 返回 `{block?, reason?, terminate?}`；要改参数就原地修改 `event.input`。
  - `tool_result` 返回 `{content?, details?, structuredContent?, isError?, usage?}`。
  - `context` 返回 `{messages?}`。
  - `before_agent_start` 返回 `{message?, systemPrompt?}`。
  - `session_before_compact` 返回 `{cancel?, compaction?}`。
- **注册接口**（types.ts:1671-1917）：`registerTool / registerCommand / registerShortcut / registerFlag / registerMessageRenderer / registerProvider`、`sendMessage / sendUserMessage / appendEntry`、`getActiveTools / setActiveTools`、`exec`、`events`。
- **与 agent-core 的对接方式**（CA/agent-session.ts:644-719、788-904、1788-1809）：
  - `agent.beforeToolCall` 接到 tool_call 处理器。
  - `afterToolCall` 接到 tool_result 处理器，并做图片归一化。
  - 链式包装 prepareRequest、finishTurn、prepareNextTurnWithContext 和 transformContext。

  这与 coko 计划的组合方式一致，可直接参考。

### 4.6 Compaction

- **设置与触发**：默认 `{enabled:true, reserveTokens:16384, keepRecentTokens:20000}`。当 `contextTokens > contextWindow - reserveTokens` 时触发；收到溢出错误后也会被动触发（CA/compaction/compaction.ts:120-129、267-270；agent-session.ts:3011-3141）。
- **流程**（compaction.ts:52-114、446-472、759-775、859-885、952-965）：
  1. `prepareCompaction()` 从尾部按 keepRecentTokens 累加，找到切点。切点可能落在一个 turn 中间，此时额外生成 turn prefix 摘要。
  2. 生成摘要：首次用 SUMMARIZATION_PROMPT，之后用 UPDATE 版本增量更新。
  3. 调用 `compact(preparation, model, apiKey, …, streamFn, env, retry, callbacks, sessionId)`，返回 `CompactionResult{summary, firstKeptEntryId, tokensBefore, estimatedTokensAfter?, usage?, details{readFiles, modifiedFiles}}`。
- **摘要结构**：固定为 Goal / Constraints & Preferences / Progress（Done、In Progress、Blocked）/ Key Decisions / Next Steps / Critical Context，要求保留精确路径、函数名和报错原文（compaction.ts:507-538）。
- **重建**：摘要包装为 `compactionSummary` 消息，`convertToLlm` 时转成 user 消息（CA/messages.ts:11-24、62-70、148-178）。

### 4.7 Session 格式

- **结构**：JSONL 文件。首行是 `SessionHeader{type:"session", version:3, id, timestamp, cwd, parentSession?}`；之后每个 entry 带 `id`、`parentId`（构成树，支持分叉）和 `timestamp`（CA/session-manager.ts:41-62）。
- **entry 类型**：message、thinking_level_change、model_change、usage、compaction、branch_summary、custom、label、session_info、custom_message、context_edit。其中 compaction 的字段为 `{summary, firstKeptEntryId, tokensBefore, details?, usage?, fromHook?, systemMessage?}`（session-manager.ts:64-197）。版本迁移为 v1→v2→v3（287-351）。
- **写入方式**（session-manager.ts:1124-1189）：
  - 出现第一条 user 或 assistant 消息时才创建文件（`wx` 模式），之后用 `appendFileSync` 追加。
  - 部分操作会重写整个文件。
  - **没有 fsync**。
- **默认路径**：`~/.pi/agent/sessions/<编码后的 cwd>/<时间>_<id>.jsonl`（587-597、1080）。

### 4.8 模型配置与凭据

- **models.json**：`providers: Record<id, {name?, baseUrl?, apiKey?, api?, oauth?:"radius", headers?, compat?, authHeader?, models?, modelOverrides?}>`（CA/model-config.ts:89-124）。值的解析规则（CA/resolve-config-value.ts:2-16、140-147）：
  - 普通字符串按字面值使用。
  - `"$NAME"` 或 `"${NAME}"` 插入环境变量。
  - `"!command"` 执行 shell 命令取 stdout，结果在进程生命周期内缓存。
- **凭据**：`AuthStorage implements CredentialStore`，存于 agentDir/auth.json，文件权限 0600，用 proper-lockfile 做跨进程锁（CA/auth-storage.ts:2-9、37、61-130、328-450）。
- **默认设置**：retry 为 `{enabled:true, maxRetries:3, baseDelayMs:2000}`；steering 和 follow-up 都是 one-at-a-time（CA/settings-defaults.ts:4-26）。
- **MCP 接入**（内置扩展）：
  - 读取 agentDir/mcp.json；项目受信任时再读 cwd/.pi/mcp.json，格式为 mcpServers。auth 只允许写在全局配置中。
  - 工具名为 `mcp__<server>__<tool>`，非法字符被替换，过长时截断并加 hash。
  - MCP 返回 isError 时转为错误 toolResult，并保留 structuredContent。

  来源：`/Users/chenzheng/Desktop/Work/open_sources/pi/packages/coding-agent/src/extensions/mcp/config.ts`:4-5、135-149；`…/extensions/mcp/tools.ts`:79-89、265-284。

## 5. 移植判断（按 coko packages/agent/src/*）

判定等级：
- **直接用**：依赖 pi 包的公开 API。
- **拷贝**：源码基本照搬，保留 MIT 版权声明。
- **改造**：保留契约或算法，重写实现。
- **不移植**：只作参考。

| coko 目录 | pi 来源 | 判定 | 理由与改造点 |
| --- | --- | --- | --- |
| engine/ | `Agent`、`AgentEvent`、各接入点 | 直接用 | 已满足 TECH_STACK 的选型。三点注意：① 显式传入 `streamFn: models.streamSimple.bind(models)`；② 持久化提交放在 subscribe 监听器中，利用串行 await 形成屏障；监听器抛错会让本次 run 以 error 结束，需要包一层，把存储失败映射成产品状态；③ 设置 `identity`，决定是否发送 pi 归属头 |
| engine/ 接入链 | `beforeToolCall / afterToolCall / runToolCall` | 直接用 | 权限判断、持久化意图、Hook 和观测都挂在这两个钩子上；子代理等嵌套调用通过 runToolCall 复用同一条链 |
| tools/ 调度 | 批次并行 / 串行 | 直接用 + 自建 | pi 没有并发上限和依赖图，需要在 beforeToolCall 中用信号量，或包装 execute 来实现。`executionMode:"sequential"` 会让整批降级为串行，所以写类内置工具不应声明它；同一文件的串行写入用 mutation queue 保证 |
| tools/ 截断 | truncate.ts、OutputAccumulator | 拷贝 | 纯 Node（Buffer/fs）实现；建议把上限做成可配置 |
| tools/read、write、ls | read.ts / write.ts / ls.ts | 拷贝后改造 | 参数 schema 原样保留；`*Operations` 映射到 coko 的 ports/ 文件接口。read 的图片缩放依赖 photon wasm，不在 coko 选型中，先改为只透传或拒绝，或交给宿主覆盖 |
| tools/edit | edit.ts + edit-diff.ts | 拷贝 | 依赖 diff 包，coko 已选 diff 8.0.4，版本一致；`details.patch / diff` 可直接给工具卡展示 diff |
| tools/bash | bash.ts | 改造 | 保留契约：command 参数、timeout 以秒计、退出码非 0 时 isError、structuredContent、尾部截断并把全文落盘。进程启动、进程组终止和 env 注入改走 ports/ 的 Execution Runtime。去掉 PI_* 环境变量和渲染器 |
| tools/grep | grep.ts | 改造（必须） | 默认 spawn rg，缺失时下载，违反 agent-runtime.md:67 和 architecture.md:71。保留 schema、默认 100 条、单行 500 字符、50KB 和 details 结构；用纯 JS 加 ignore 7.0.8 重写。桌面端用 @vscode/ripgrep 实现覆盖同名工具，契约保持一致 |
| tools/find | find.ts | 改造（必须） | 同样依赖下载 fd。改为纯 JS glob 加 ignore；pi 的 `FindOperations.glob` 本来就是替换点 |
| tools/powershell、renderers | — | 不移植 | 两者分别是 TUI 渲染和 Windows shell 支持；coko 当前只打包 macOS arm64 |
| tools/ 元数据 | `ToolDefinition.promptSnippet / promptGuidelines` | 改造 | 借鉴“工具向系统提示贡献片段”的做法，纳入 coko 的工具契约；renderShell 等 UI 字段不要 |
| models/ | pi-ai `createModels / createProvider` / 单个 provider 工厂 | 直接用 | 按需 import 单个 provider（如 `/providers/deepseek`），避免 `providers/all` 把 anthropic、openai、google、bedrock 四个 SDK 全部打进 sidecar |
| models/ 错误与重试 | `isRetryableAssistantError / retryAssistantCall / isContextOverflow` | 直接用 | 先判断上下文溢出，再判断是否可重试（retry.ts:262-264 的注释）；预算和重试计数由 coko 的 goals/ 记录 |
| models/ 配置 | models.json schema、resolve-config-value | 改造 | 结构可以借鉴。`"!command"` 会执行任意 shell，按 coko 的权限模型应默认禁用，或交给宿主执行 |
| ports/ 凭据 | `CredentialStore` 接口 | 直接用接口 | sidecar 用宿主的密钥存储实现该接口；不拷贝 AuthStorage（明文 auth.json 加 proper-lockfile） |
| instructions/rules | loadProjectContextFiles、renderProjectContext | 拷贝后改造 | pi 会一直向上查到 /，需改为在 workspace 根或受信任目录处停止；增加作用域与优先级；把同步 fs 换成注入的文件接口；worktree 屏蔽逻辑可选保留 |
| instructions/system prompt | buildSystemPromptSections + `SystemMessage.sections` | 改造 | 采用 sections 增量机制；preamble 和 docs 段换成 coko 自己的内容 |
| instructions/skills | skills.ts | 拷贝后改造 | 对齐 agentskills 规范；把 .pi/skills 换成 coko 的目录约定；自动匹配和运行授权需要新增，pi 只把列表注入提示，由模型自己 read |
| instructions/commands | prompt-templates.ts、`/skill:` 展开 | 拷贝 | 都是纯函数，只需换路径约定；用户命令注册与入口由 UI 和协议提供 |
| extensions/hooks | ExtensionAPI 的事件与返回值语义 | 不移植实现，借鉴语义 | pi 用 jiti 加载任意 TS 并与 TUI 耦合；coko 的 Hook 需要超时、错误语义和权限门。tool_call / tool_result / context / before_agent_start / session_before_compact 的返回结构可以作为 DTO 蓝本 |
| extensions/mcp | pi-mcp `McpClient` + transports | 直接用 | prompts 用 `request()` 封装并补充校验；工具包装参考 `mcp__server__tool` 命名、toLlmContent 和 isError 的转换；连接配置、OAuth 和子进程生命周期由宿主装配 |
| extensions/mcp 配置 | mcp.json 加载 | 改造 | 保留两条规则：auth 只允许出现在全局配置；项目级配置需项目受信任才读取 |
| context/compaction | compaction.ts | 改造 | shouldCompact、切点算法、摘要 prompt 和 fileOps 汇总可以拷贝或借鉴。输入要从 pi 的 SessionEntry / ProjectedSessionEntry 换成 coko 的 session 记录。摘要中的 Goal / Constraints 段对应 coko“保留目标与约束”的要求，但 Goal 状态仍由 goals/ 显式注入，不依赖摘要 |
| context/ 消息类型 | messages.ts（`CustomAgentMessages` 声明合并、convertToLlm） | 拷贝思路 | 用声明合并扩展 coko 自有消息类型（compactionSummary、通知等），由 convertToLlm 负责过滤或转换 |
| recovery/ | `AgentTool.replay` | 自建 | agent-core 只声明不使用；coko 可以沿用这个字段表达工具的幂等策略 |
| packages/session | SessionManager v3 | 不移植 | 没有 fsync，部分操作重写整文件，与 coko 的 append-only + fsync 要求冲突。树形 id/parentId 和 compaction entry 字段可作为 Fork/Rewind 的模型参考 |
| config/ | settings-defaults | 参考 | 可作为初始默认值：retry 3 次 / 2000ms、压缩 16384 / 20000、队列 one-at-a-time |

## 6. 与现有 coko 文档的核对

- **agent-runtime.md:15 的引用位置**：该行在 1.4.0 的 CHANGELOG 链接下写“Harness 与 Session 已拆出”，但拆出实际发生在 **1.0.0**（2026-10-01）。1.4.0 的条目只新增了 `identity`（`/Users/chenzheng/Desktop/Work/open_sources/pi/packages/agent/CHANGELOG.md`:3-7、31-35）。结论不变，引用位置可以改准确。
- **agent-runtime.md:61、63**：“没有并发上限和依赖图”“pi-mcp 不封装 prompts”两条与源码一致（见 1.6 节、§3）。
- **agent-runtime.md:105**：“并行工具的展示事件按完成顺序、持久化结果保持原始顺序”与 agent-loop.ts:596-670 一致。要持久化工具结果，应订阅 role 为 toolResult 的 message_end，而不是 tool_execution_end。
- **未验证**：没有在 Electron 41 内置的 Node 24.14.0 下实际运行这些包，也没有测量按单个 provider import 后的打包体积。本文判断仅基于源码阅读。
