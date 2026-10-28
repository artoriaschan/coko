# claude-code Agent 行为机制调研（供 coko packages/agent 参考）

## 结论摘要

1. 权限判定是一条固定流水线：先看整工具 deny/ask 规则 → 再调 `tool.checkPermissions` → 内容级 ask 和安全路径检查不受 bypass 影响 → 模式放行（bypass / acceptEdits）→ allow 规则 → 其余 `passthrough` 转成 `ask`；`dontAsk` 和无 UI 的子代理在最后把 ask 转成 deny。
2. 规则写成 `Tool` 或 `Tool(content)`，按 8 个来源汇总；每次更新都带 `destination`，取值 session / localSettings / projectSettings / userSettings / cliArg。deny 优先级最高，Hook 的 allow 也绕不过 deny/ask 规则。
3. Hooks 有 27 个事件，结构是 `event → [{matcher, hooks:[{type: command|prompt|http|agent, if, timeout, once, async}]}]`。退出码 2 表示阻断（每个事件的语义不同），stdout 里的 JSON 可以返回 `continue / decision / hookSpecificOutput`。多个 Hook 并行执行，结果按 deny > ask > allow 聚合；默认超时 10 分钟。
4. Plan Mode 本质上是一个权限模式（`mode:'plan'`，并记下 `prePlanMode`）加上周期性 system-reminder。工具层面只放行“当前会话 plan 文件”的读写，其余写操作照常要审批。退出走 `ExitPlanMode`，必须经用户确认，确认后恢复 `prePlanMode`。
5. Todo 有两套。V1 `TodoWrite` 每次整表替换，存在内存里，按 agentId/sessionId 分键；V2 `TaskCreate/Update/List/Get` 每个任务落成一个 JSON 文件，带文件锁、`blocks/blockedBy`、`owner`，并有 TaskCreated/TaskCompleted Hook 可以阻断。
6. Subagent 通过 `Agent` 工具（旧名 Task）派发，定义来自 Markdown frontmatter（tools、disallowedTools、model、permissionMode、mcpServers、hooks、maxTurns、skills、memory、isolation）。子代理默认拿到全新消息、克隆的文件状态、子级 AbortController；异步子代理不弹审批，直接自动拒绝。
7. Compaction 阈值等于有效窗口（上下文减去 min(maxOutput, 20k)）再减 buffer（13k / 30k / 50k，按窗口大小取）。连续失败 3 次后熔断。摘要提示词要求先 `<analysis>` 后 `<summary>`，固定 9 节。压缩后重新注入最近文件（最多 5 个，共 50k）、plan、已调用的 skill（25k）以及各类 delta。
8. Memory 按 Managed → User → Project（从 cwd 向上找 CLAUDE.md、.claude/CLAUDE.md、.claude/rules/*.md）→ Local 的顺序加载，越靠后优先级越高。`@path` 的 include 最多 5 层，代码块里不展开，并有防环。带 `paths:` frontmatter 的规则只在访问匹配文件时按需注入。
9. Checkpoint 只追踪 Edit/Write/Notebook 改动的文件：编辑前先备份，每条用户消息打一个快照，最多保留 20 个。Rewind 可以只恢复代码、只恢复对话或两者都恢复，也可以“从这里开始摘要”。Bash 造成的副作用不在追踪范围内。
10. Resume 读取 JSONL，`parentUuid` 构成消息链；恢复时过滤掉未完成的 tool_use，检测到中断就补一条 "Continue from where you left off."。Fork（`--fork-session`、`/branch`）会用新 sessionId 复制全部条目并记录 `forkedFrom`。后台 Bash 以任务形式运行，输出落盘，结束时推送 `<task-notification>`。

## 0. 来源与约定

- 源码仓库：`/Users/chenzheng/Desktop/Work/open_sources/claude-code`，git remote 为 `claude-code-best/claude-code`，HEAD `77a7934e`，`package.json` 中 name 为 `claude-code-best`、版本 2.8.4。**这是社区还原 / 二次开发版（CCB），不是 Anthropic 官方源码**，部分 feature gate（`feature('...')`、`USER_TYPE==='ant'`）的行为与官方发行版可能不同。下文只描述这份代码里能读到的行为。
- 路径缩写（引用时直接拼接即可得到绝对路径）：
  - `CC/` = `/Users/chenzheng/Desktop/Work/open_sources/claude-code/src/`
  - `BT/` = `/Users/chenzheng/Desktop/Work/open_sources/claude-code/packages/builtin-tools/src/tools/`
- 每节最后的“coko 参考规则”是基于源码提炼的建议，不是 coko 已确认的决策；写入正式文档前，需要按 `docs/tech-stack/agent-runtime.md` 的归属走确认流程。

---

## 1. 权限 / 审批模型

### 1.1 Permission modes

| 模式 | 语义 | 源码 |
| --- | --- | --- |
| `default` | 未命中规则时询问用户 | `CC/types/permissions.ts:15-21` |
| `acceptEdits` | 工作目录内的文件写入自动放行；Bash 中 `mkdir/touch/rm/mv/cp/sed` 视作文件编辑 | `CC/utils/permissions/filesystem.ts:1365-1380`；`BT/BashTool/modeValidation.ts:7-20` |
| `plan` | 只读规划，见第 3 节 | `BT/EnterPlanModeTool/EnterPlanModeTool.ts:83-99` |
| `bypassPermissions` | 全部放行，但 1d–1g 步骤仍然生效 | `CC/utils/permissions/permissions.ts:1283-1302` |
| `dontAsk` | 凡是要问的一律拒绝 | `CC/utils/permissions/permissions.ts:502-516` |
| `auto`（内部模式） | ask 交给分类器判断；连续被拒有计数和上限 | `CC/utils/permissions/permissions.ts:517-948` |
| `bubble`（内部模式） | 子代理把审批请求冒泡到父终端 | `BT/AgentTool/runAgent.ts:445-454` |

- UI 循环顺序：default → acceptEdits → plan → auto → （允许时才进入 bypass）→ default，见 `CC/utils/permissions/getNextPermissionMode.ts:11-42`。
- 策略可以禁用 bypass：设置 `permissions.disableBypassPermissionsMode: 'disable'`，见 `CC/utils/permissions/permissionSetup.ts:706-778`。

### 1.2 规则语法

```ts
type PermissionBehavior = 'allow' | 'deny' | 'ask'                       // CC/types/permissions.ts:45
type PermissionRuleValue = { toolName: string; ruleContent?: string }    // :68-71
type PermissionRule = { source; ruleBehavior; ruleValue }                // :76-80
```

| 写法 | 含义 | 源码 |
| --- | --- | --- |
| `Bash` / `Bash()` / `Bash(*)` | 匹配整个工具（content 为空或 `*` 时视为无 content） | `CC/utils/permissions/permissionRuleParser.ts:93-133` |
| `Bash(npm install)` | 精确匹配命令 | 同上 |
| `Bash(npm:*)` | 旧式前缀写法 | `CC/utils/permissions/shellRuleMatching.ts:40-48,159-170` |
| `Bash(git * --force)` | 通配符 `*`。只有一个尾随 ` *` 时，后面的参数可以省略 | `CC/utils/permissions/shellRuleMatching.ts:54-150` |
| `Read(./.env)`、`Edit(src/**)` | gitignore 风格的路径匹配 | `CC/utils/permissions/filesystem.ts:853-917` |
| `Edit(//abs/path)`、`Edit(~/x)`、`Edit(/x)` | `//` 表示文件系统根，`~/` 表示 home，`/` 表示“该规则所在 settings 文件所在的目录” | `CC/utils/permissions/filesystem.ts:860-905` |
| `mcp__server`、`mcp__server__*`、`mcp__server__tool` | 按 MCP server 或单个工具匹配 | `CC/utils/permissions/permissions.ts:238-269` |
| `Skill(name)`、`Skill(name:*)` | 技能级规则 | `BT/SkillTool/SkillTool.ts:436-575` |
| `Agent(type)` | 禁用某类子代理 | `CC/utils/permissions/permissions.ts:308-347` |

- content 里的括号和反斜杠需要用反斜杠转义：`permissionRuleParser.ts:55-79`。
- 旧名自动映射：`Task→Agent`、`KillShell→TaskStop`、`BashOutputTool/AgentOutputTool→TaskOutput`，见 `permissionRuleParser.ts:21-33`。
- 所有文件写工具都按 `Edit` 规则判断，所有读工具都按 `Read` 规则判断：`filesystem.ts:919-933`。

### 1.3 作用域与持久化

- 规则来源，按以下顺序汇总：`userSettings, projectSettings, localSettings, flagSettings, policySettings, cliArg, command, session`，见 `CC/utils/permissions/permissions.ts:109-114`、`CC/types/permissions.ts:55-63`。
- 对应文件：`~/.claude/settings.json`（user）、`.claude/settings.json`（project）、`.claude/settings.local.json`（local）、`managed-settings.json` 加 `managed-settings.d/*.json`（policy），见 `CC/utils/settings/settings.ts:59-65,298-305`。普通设置项按 `SETTING_SOURCES` 顺序合并，后面的覆盖前面的：`CC/utils/settings/constants.ts:7-22`。
- settings 中的结构：`permissions.{allow, deny, ask, defaultMode, disableBypassPermissionsMode, additionalDirectories}`，见 `CC/utils/settings/types.ts:42-72`。
- 更新操作的结构：

```ts
// CC/types/permissions.ts:89-132
type PermissionUpdateDestination = 'userSettings'|'projectSettings'|'localSettings'|'session'|'cliArg'
type PermissionUpdate =
  | { type:'addRules'|'replaceRules'|'removeRules'; destination; rules: PermissionRuleValue[]; behavior }
  | { type:'setMode'; destination; mode: ExternalPermissionMode }
  | { type:'addDirectories'|'removeDirectories'; destination; directories: string[] }
```

- 审批对话框的“建议项”就是 `PermissionUpdate[]`，例如写工作目录外的文件时，建议 `setMode acceptEdits` 加上 `addDirectories`，destination 都是 `session`：`filesystem.ts:1444-1478`。
- 策略锁定：`allowManagedPermissionRulesOnly` 打开后只认 policy 来源的规则，“总是允许”选项被隐藏，新规则也不会写盘，见 `CC/utils/permissions/permissionsLoader.ts:28-45,120-140,229-245`。

### 1.4 判定流水线（`hasPermissionsToUseToolInner`）

源码：`CC/utils/permissions/permissions.ts:1179-1340`；外层包装在 `:473-977`。

| 步骤 | 规则 | 是否受 bypass 影响 |
| --- | --- | --- |
| 1a | 整工具 deny 规则命中 → deny | 否 |
| 1b | 整工具 ask 规则命中 → ask（Bash 在沙箱自动放行时例外） | 否 |
| 1c | `inputSchema.parse` 之后调用 `tool.checkPermissions(input, ctx)` | — |
| 1d | 工具返回 deny → deny | 否 |
| 1e | `requiresUserInteraction()` 为真且结果为 ask → ask | 否 |
| 1f | 内容级 ask 规则（`decisionReason.type==='rule'` 且为 ask）→ ask | 否 |
| 1g | `safetyCheck`（`.git/.vscode/.idea/.claude`、`.bashrc/.gitconfig/.mcp.json` 等）→ ask | 否 |
| 2a | `bypassPermissions`，或 plan 模式且 bypass 可用 → allow | — |
| 2b | 整工具 allow 规则命中 → allow | — |
| 3 | `passthrough` → `ask` | — |
| 外层 | `dontAsk`：ask 变 deny；`auto`：交给分类器；`shouldAvoidPermissionPrompts`：先跑 PermissionRequest Hook，没有 Hook 给出决定就 deny | — |

- 危险文件和目录清单：`CC/utils/permissions/filesystem.ts:57-79`。路径比较前一律转成小写，用来防止大小写绕过：`:90-92`。
- 文件写入检查的顺序是 deny → `.claude` 等特殊路径 → ask → acceptEdits 且在工作目录内 → allow 规则 → ask，见 `filesystem.ts:1205-1400`。当前会话的 plan 文件以及若干内部路径可以直接写，见 `filesystem.ts:1484-1500`。
- Bash 复合命令会拆成子命令逐个判断：任一子命令被 deny 整体就 deny，任一要 ask 整体就 ask，全部 allow 才 allow。子命令超过 50 个时直接 ask。安全的 env 前缀和 `timeout`、`nice` 这类包装命令会先剥掉再匹配，`LD_*`、`DYLD_*`、`PATH` 不剥。见 `BT/BashTool/bashPermissions.ts:103,524-610,708,2248-2540`。

### 1.5 工具级接口（`Tool`）

`CC/Tool.ts:405-535`：

```ts
isConcurrencySafe(input): boolean; isReadOnly(input): boolean; isDestructive?(input): boolean
interruptBehavior?(): 'cancel' | 'block'            // 用户插话时工具怎么处理，默认 block
requiresUserInteraction?(): boolean                  // 即使在 bypass 下也要问（例如 ExitPlanMode）
validateInput?(input, ctx): Promise<ValidationResult>  // 在权限判断之前执行；失败时把原因直接返回给模型
checkPermissions(input, ctx): Promise<PermissionResult> // allow|deny|ask|passthrough + suggestions
preparePermissionMatcher?(input): Promise<(pattern) => boolean> // 供 Hook 的 if 条件复用规则匹配
getPath?(input): string; maxResultSizeChars: number  // 结果超过该长度就落盘，模型只拿到预览
```

缺省值是 fail-closed 的：`isConcurrencySafe=false`、`isReadOnly=false`，`checkPermissions` 返回 allow 并把判断交给通用流水线，见 `CC/Tool.ts:761-773`。MCP 工具一律返回 `passthrough`，也就是默认要问：`BT/MCPTool/MCPTool.ts:56-61`。

执行顺序：Zod 解析 → `validateInput` → PreToolUse Hook → `resolveHookPermissionDecision`（内部调用 canUseTool）→ `tool.call` → PostToolUse 或 PostToolUseFailure Hook，见 `CC/services/tools/toolExecution.ts:725,842,963,1257,1558,1786`。

**coko 参考规则**
- 判定写成纯函数流水线，输入为 `(tool, input, ctx) → allow|deny|ask(+suggestions)`。deny 规则、内容级 ask、敏感路径这三项放在模式放行之前，并且不受 bypass 影响。
- 规则值统一用 `{toolName, ruleContent?}`；每条授权都必须带 `destination`（session、项目本地、项目共享、用户），方便 UI 提供“仅本次”“本会话”“总是”这几档。
- 无 UI 的执行上下文（后台子代理、headless）要有显式的 `shouldAvoidPermissionPrompts`，此时 ask 先交给 Hook 或策略，再兜底 deny，不能让执行挂起。

---

## 2. Hooks

### 2.1 事件列表（27 个，`CC/entrypoints/sdk/coreTypes.ts:25-53`）

matcher 匹配的字段和退出码语义见 `CC/utils/hooks/hooksConfigManager.ts:26-265`。

| 事件 | matcher 字段 | exit 2 / 阻断语义 |
| --- | --- | --- |
| PreToolUse | tool_name | 阻止工具调用，stderr 交给模型 |
| PostToolUse | tool_name | stderr 立即交给模型（工具已经执行完） |
| PostToolUseFailure | tool_name | 同上 |
| PermissionRequest | tool_name | 通过 JSON 返回 allow/deny 决定 |
| PermissionDenied | tool_name | 可以返回 `retry:true` |
| UserPromptSubmit | — | 阻止处理并擦掉原 prompt；exit 0 时 stdout 作为上下文交给模型 |
| SessionStart | source | 不支持阻断；stdout 作为上下文 |
| SessionEnd | reason | 不阻断；默认超时 1.5s（`CC/utils/hooks.ts:176-182`） |
| Stop | — | stderr 交给模型，对话继续 |
| StopFailure | error | 发出即忘，输出被忽略 |
| SubagentStart | agent_type | 不阻断；stdout 交给子代理 |
| SubagentStop | agent_type | stderr 交给子代理，让它继续运行 |
| PreCompact | trigger | 阻止本次压缩；exit 0 时 stdout 追加为自定义压缩指令 |
| PostCompact | trigger | — |
| Notification | notification_type | — |
| Setup | trigger | 不阻断 |
| TeammateIdle / TaskCreated / TaskCompleted | — | 分别阻止空闲 / 创建 / 完成 |
| Elicitation / ElicitationResult | mcp_server_name | 拒绝或改写 MCP elicitation |
| ConfigChange | source | 阻止本次配置变更生效 |
| InstructionsLoaded | load_reason | 只用于观测，不能阻断 |
| WorktreeCreate / WorktreeRemove | — | stdout 输出 worktree 路径 |
| CwdChanged / FileChanged | —/文件名 | 可以写 `CLAUDE_ENV_FILE` 设置环境变量，可以返回 `watchPaths` |

其余非 0 的退出码：stderr 只展示给用户，流程照常继续（同一文件内各事件的描述）。

### 2.2 配置结构

```ts
// CC/schemas/hooks.ts:31-211
Hooks = Partial<Record<HookEvent, Array<{ matcher?: string; hooks: HookCommand[] }>>>
HookCommand =
 | { type:'command'; command; if?: "Bash(git *)"; shell?: 'bash'|'powershell'; timeout?: 秒; statusMessage?; once?; async?; asyncRewake? }
 | { type:'prompt'; prompt; model?; if?; timeout?; ... }   // 由 LLM 判断
 | { type:'http'; url; headers?; allowedEnvVars?; if?; timeout? }  // header 只会插值白名单里的环境变量
 | { type:'agent'; prompt; ... }                            // 由 agentic verifier 判断
```

- matcher 的规则：空值或 `*` 匹配全部；只含 `[A-Za-z0-9_|]` 时按精确名或 `|` 分隔的列表匹配；其他情况按正则匹配，同时也会拿旧工具名试一遍。见 `CC/utils/hooks.ts:1483-1518`。
- `if` 条件复用权限规则语法，借助 `tool.preparePermissionMatcher`，见 `CC/schemas/hooks.ts:20-27`、`CC/Tool.ts:519-527`。
- 策略开关：`disableAllHooks`、`allowManagedHooksOnly`，见 `CC/utils/hooks/hooksConfigSnapshot.ts:12-60`。

### 2.3 输入 / 输出 JSON

- 输入通过 stdin 写一行 JSON（`CC/utils/hooks.ts:1140`）。所有事件都有的基础字段为 `session_id, transcript_path, cwd, permission_mode?, agent_id?, agent_type?`（`:302-329`），在此基础上再加 `hook_event_name` 和事件自己的字段，例如 PreToolUse 的 `tool_name/tool_input/tool_use_id`、Stop 的 `stop_hook_active`（`:3833`）。
- 环境变量：`CLAUDE_PROJECT_DIR`（指向稳定的仓库根目录，不是 worktree），以及 `CLAUDE_ENV_FILE`，见 `CC/utils/hooks.ts:896-994`。
- 输出（stdout 是 JSON 时才解析），见 `CC/types/hooks.ts:50-175`：

```ts
{ continue?: boolean; stopReason?: string; suppressOutput?: boolean;
  decision?: 'approve'|'block'; reason?: string; systemMessage?: string;
  hookSpecificOutput?:
    | { hookEventName:'PreToolUse'; permissionDecision?: 'allow'|'deny'|'ask'; permissionDecisionReason?; updatedInput?; additionalContext? }
    | { hookEventName:'PermissionRequest'; decision: {behavior:'allow'; updatedInput?; updatedPermissions?: PermissionUpdate[]} | {behavior:'deny'; message?; interrupt?} }
    | { hookEventName:'PostToolUse'; additionalContext?; updatedMCPToolOutput? }
    | { hookEventName:'UserPromptSubmit'|'SessionStart'|'SubagentStart'|...; additionalContext? } ... }
// 异步写法：{ async: true, asyncTimeout?: number }
```

### 2.4 阻断语义与聚合

- `continue:false` 设置 `preventContinuation`，并带上 `stopReason`；`decision:'block'` 或 `permissionDecision:'deny'` 会产生 `blockingError`，见 `CC/utils/hooks.ts:601-660`。
- 同一事件的多个 Hook **并行**执行，每个 Hook 有自己的超时；权限结果聚合优先级为 **deny > ask > allow**，见 `CC/utils/hooks.ts:2278-2333,2878-3000`。
- Hook 给出 allow 只能免掉审批对话框，**deny/ask 规则仍然生效**；遇到 `requiresUserInteraction` 的工具或 `requireCanUseTool` 时，仍然要走 canUseTool。见 `CC/services/tools/toolHooks.ts:340-419`。
- 超时：工具类 Hook 默认 10 分钟（`TOOL_HOOK_EXECUTION_TIMEOUT_MS`），单个 Hook 用 `timeout`（秒）覆盖；SessionEnd 默认 1.5s。见 `CC/utils/hooks.ts:167-182,960-962`。
- `asyncRewake` 的后台 Hook 以 exit 2 结束时，会作为 system-reminder 唤醒模型：`CC/utils/hooks.ts:237-244`。

**coko 参考规则**
- Hook 的返回结果建模为 `{decision?, updatedInput?, additionalContext?, preventContinuation?, stopReason?, blockingError?}`。并行执行，每个 Hook 单独计时，按 deny > ask > allow 聚合。Hook 的 allow 不能越过规则里的 deny/ask。
- 每个事件的阻断语义要写成显式表格。不能阻断的事件（SessionStart、InstructionsLoaded、StopFailure）要在类型上做区分。
- Hook 的 `if` 条件复用权限规则匹配器，避免不必要地起进程。

---

## 3. Plan Mode

| 环节 | 行为 | 源码 |
| --- | --- | --- |
| 进入 | `EnterPlanMode` 工具（只读、可并发），子代理里禁用；把当前模式记为 `prePlanMode`，再执行 `setMode plan`，destination 为 session | `BT/EnterPlanModeTool/EnterPlanModeTool.ts:68-99`；`CC/utils/permissions/permissionSetup.ts:1451-1481` |
| 约束提示 | 通过 `plan_mode` attachment 注入 system-reminder：“MUST NOT make any edits (except plan file) … run any non-readonly tools”，并给出 5 个阶段的流程（Explore 子代理 → Plan 子代理 → …）。每 5 轮注入一次，每 5 次里有一次是完整版 | `CC/utils/messages.ts:3527-3660`；`CC/utils/attachments.ts:262-269,1192-1290` |
| 工具限制 | 不另设白名单。当前会话的 plan 文件 `{plansDir}/{slug}.md`（子代理为 `{slug}-agent-{id}.md`）可以直接读写，其余写操作仍按正常流程审批。plan 模式下 bypass 是否可用由 `isBypassPermissionsModeAvailable` 决定 | `CC/utils/permissions/filesystem.ts:245-255,1484-1500,1650-1658`；`permissions.ts:1289-1292` |
| plan 存放位置 | `settings.plansDirectory` 必须位于项目根目录之内 | `CC/utils/plans.ts:85-132` |
| 退出 | `ExitPlanMode` 工具：`validateInput` 要求当前模式是 plan；`requiresUserInteraction()=true`，`checkPermissions` 返回 `ask: 'Exit plan mode?'`；plan 内容从磁盘读取（如果用户在审批时改了 plan，就写回文件）；最后恢复 `prePlanMode`（auto 被熔断时降为 default） | `BT/ExitPlanModeTool/ExitPlanModeV2Tool.ts:182-260,323-400` |
| 语义授权 | 输入 `allowedPrompts: [{tool:'Bash', prompt:'run tests'}]`，即“执行阶段需要的动作类别” | `ExitPlanModeV2Tool.ts:64-89` |
| 子代理 | Enter/ExitPlanMode 都在 `ALL_AGENT_DISALLOWED_TOOLS` 中 | `CC/constants/tools.ts:44-58` |
| 压缩 | 压缩后重新注入 plan 文件引用和 plan_mode 提示 | `CC/services/compact/compact.ts:572-582,1522-1534` |

**coko 参考规则**：Plan 是一个“带 prePlanMode 的权限模式”。只读约束靠提示注入加正常审批来实现，再给 plan 产物开一条唯一可写的路径。退出必须经过用户确认，确认时可以顺带授予一组语义化的执行权限，并恢复进入前的模式。

---

## 4. TodoWrite / Task

| 项 | V1 TodoWrite | V2 Task* |
| --- | --- | --- |
| 启用条件 | `!isTodoV2Enabled()`，`BT/TodoWriteTool/TodoWriteTool.ts:52-54` | 交互式会话，或设置了 `CLAUDE_CODE_ENABLE_TASKS`，`CC/utils/tasks.ts:133-139` |
| 数据结构 | `{content, status: pending/in_progress/completed, activeForm}[]`，`CC/utils/todo/types.ts:4-18` | `{id, subject, description, activeForm?, owner?, status, blocks[], blockedBy[], metadata?}`，`CC/utils/tasks.ts:69-89` |
| 写入语义 | 每次整表替换；全部 completed 时清空列表；按 `agentId ?? sessionId` 分键存在 AppState 里 | 每个任务一个 `~/.claude/tasks/{listId}/{id}.json`，有 `.highwatermark` 防止 ID 复用，写入加文件锁 |
| 权限 | 直接 allow（`TodoWriteTool.ts:58-60`） | — |
| 附加逻辑 | 主线程在全部完成时可以触发“verification nudge”（`:76-85`） | `TaskCreated` Hook 阻断时回滚创建（`BT/TaskCreateTool/TaskCreateTool.ts:92-112`）；`TaskUpdate` 支持 `status:'deleted'`，置为 completed 时跑 `TaskCompleted` Hook（`BT/TaskUpdateTool/TaskUpdateTool.ts:34-48,212-231`）；认领任务时检查 owner 和 blockedBy（`CC/utils/tasks.ts:556-598`） |
| listId | — | `CLAUDE_CODE_TASK_LIST_ID`，否则依次取 teamName 和 sessionId（`CC/utils/tasks.ts:199-227`） |

**coko 参考规则**：轻量 Todo 用整表替换，便于模型一次提交状态；可协作的 Task 用单条记录、显式依赖（blocks/blockedBy）、owner 认领加锁，并提供可阻断的 Created/Completed 生命周期 Hook。

---

## 5. Subagents（Agent tool）

- 输入：`{description, prompt, subagent_type?, model?, run_in_background?, name?, team_name?, mode?, isolation?: 'worktree', cwd?}`，见 `BT/AgentTool/AgentTool.tsx:138-204`。
- 定义文件：`.claude/agents/*.md` 等目录下的 Markdown，frontmatter 包括 `name, description, tools, disallowedTools, model('inherit'), effort, permissionMode, mcpServers, hooks, maxTurns, skills, initialPrompt, memory('user'|'project'|'local'), background, isolation, color`，见 `BT/AgentTool/loadAgentsDir.ts:76-126,405-507`。
- 同名覆盖顺序（后者胜出）：built-in → plugin → user → project → flag → managed，见 `loadAgentsDir.ts:194-221`。内置代理有 general-purpose、Explore、Plan、verification 等，位于 `BT/AgentTool/built-in/`。
- 工具解析：`tools` 为空或 `['*']` 表示全部工具，再减去 `disallowedTools`；所有子代理统一禁用 `TaskOutput, ExitPlanMode, EnterPlanMode, Agent（非 ant）, AskUserQuestion, TaskStop, …`；异步代理另有允许清单 `ASYNC_AGENT_ALLOWED_TOOLS`。见 `BT/AgentTool/agentToolUtils.ts:125-170`、`CC/constants/tools.ts:44-85`。
- 独立上下文（`CC/utils/forkedAgent.ts:346-402`、`BT/AgentTool/runAgent.ts:379-470`）：
  - 消息从空开始（fork 模式除外）；`readFileState` 是克隆的，`nestedMemoryAttachmentTriggers` 是新建的；默认使用子级 AbortController，父级取消时子级跟着取消；异步代理不共享 setAppState。
  - `omitClaudeMd` 打开时从 userContext 中去掉 CLAUDE.md。
  - 权限：定义了 `permissionMode` 时覆盖父级模式，但父级处于 bypass/acceptEdits/auto 时以父级为准；异步代理设置 `shouldAvoidPermissionPrompts`（ask 直接自动拒绝），`bubble` 模式则冒泡给父级处理。
  - 调用方传入 `allowedTools` 时，以它作为 session 级 allow 规则，并保留 cliArg 规则。
  - 启动时执行 SubagentStart Hook，把 additionalContext 作为用户消息注入（`runAgent.ts:539-561`）。
- 转录：`{projectDir}/{sessionId}/subagents/agent-{agentId}.jsonl`，旁边有 `.meta.json`，见 `CC/utils/sessionStorage.ts:233-262`。
- Fork 子代理（feature gate 控制）：省略 `subagent_type` 时，子代理继承父级完整对话、已渲染好的 system prompt 和完全相同的工具池（为了命中 prompt cache），`permissionMode:'bubble'`，`maxTurns 200`；父级 assistant 消息里的每个 tool_use 都配上同一条占位 tool_result，后面再接子代理自己的 directive；有防递归保护。见 `BT/AgentTool/forkSubagent.ts:32-201`。

**coko 参考规则**：子代理定义 = 角色提示 + 工具白名单/黑名单 + 模型 + 权限模式 + MCP/Hook/Skill 子集 + maxTurns。运行时状态（读文件缓存、取消信号、Todo 分键）默认隔离；子代理的权限模式不能比父级更宽；后台子代理不能弹审批。

---

## 6. Compaction

| 参数 | 值 | 源码 |
| --- | --- | --- |
| 有效窗口 | `contextWindow - min(maxOutput, 20_000)`，可以用 `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 收窄 | `CC/services/compact/autoCompact.ts:28-49` |
| 自动压缩阈值 | 有效窗口减 buffer；buffer 在窗口 ≥800k 时为 50k，≥400k 时为 30k，否则 13k；`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` 可以按百分比下调 | `:62-120` |
| 预警 / 错误线 | 阈值 - 20k；手动压缩上限为窗口 - 3k | `:63-65,142-153` |
| 熔断 | 连续失败 3 次后不再自动压缩 | `:96-99,291,372` |
| 开关 | `DISABLE_AUTO_COMPACT`、`autoCompactEnabled` | `:181-186` |
| 压缩后恢复 | 最近文件最多 5 个，共 50k，单个 5k；已调用的 skill 共 25k，单个 5k；plan 引用、plan_mode、异步代理状态、deferred tools/agents/MCP 指令 delta 重新注入；再跑一次 `SessionStart('compact')` Hook | `CC/services/compact/compact.ts:126-134,550-619` |
| 生命周期 | PreCompact Hook（exit 2 阻止压缩，stdout 作为额外指令）→ 摘要 → compact_boundary 消息 → PostCompact Hook | `compact.ts:437,625,752` |
| 微压缩 | 距上次超过 60 分钟时，把较旧的可压缩工具结果替换为 `[Old tool result content cleared]`，保留最近 5 条 | `CC/services/compact/microCompact.ts:36-41,446-514`；`timeBasedMCConfig.ts:30-33` |

摘要提示词结构（`CC/services/compact/prompt.ts`）：
1. `NO_TOOLS_PREAMBLE`：只输出文本，禁止调用工具（`:19-24`）。
2. 先写 `<analysis>` 草稿，按时间顺序梳理请求、做法、决策、代码和错误（`:31-45`），这部分最终会被丢弃。
3. 再写 `<summary>`，固定 9 节（`:62-130`）：Primary Request and Intent / Key Technical Concepts / Files and Code Sections / Errors and fixes / Problem Solving / **All user messages（逐条列出，安全相关约束原文保留，不能把 assistant 的文本当成用户的话）** / Pending Tasks / Current Work / Optional Next Step（必须和最近的明确请求一致）。
4. 变体：`PARTIAL_COMPACT_PROMPT`（只总结最近一段）和 `PARTIAL_COMPACT_UP_TO_PROMPT`（总结到某个位置为止，`:146-221`）；可以追加 custom instructions。
5. 回注消息：`This session is being continued from a previous conversation…` + 摘要 + 完整转录路径，可选再加“不要追问，直接继续”（`:338-368`）。

**coko 参考规则**：阈值按“窗口减去输出预留减去随窗口变化的 buffer”计算，并做失败熔断。摘要采用“草稿加结构化摘要”两段式，用户消息和约束逐条保留。压缩完成后，按预算重新注入工作文件、Plan、Skill、Goal 等关键状态，并留下 boundary 记录供回放。

---

## 7. Memory（CLAUDE.md）

- 加载顺序，越靠后优先级越高（`CC/utils/claudemd.ts:1-26`、`:789-1000`）：
  1. Managed（例如 `/etc/claude-code/CLAUDE.md`）
  2. User `~/.claude/CLAUDE.md`
  3. Project：从根目录走到 cwd，每一层读取 `CLAUDE.md`、`.claude/CLAUDE.md`、`.claude/rules/*.md`，离 cwd 越近越靠后
  4. Local：每一层的 `CLAUDE.local.md`
  5. AutoMem（`~/.claude/projects/<slug>/memory/MEMORY.md`）和 TeamMem（feature gate）
- 每个来源都受 `isSettingSourceEnabled(...)` 控制；`claudeMdExcludes` 可以排除文件，Managed、AutoMem、TeamMem 不受排除影响（`:539-551`）；单个文件建议不超过 40k 字符（`:91`）。
- `@import`：支持 `@path`、`@./rel`、`@~/x`、`@/abs`；只在叶子文本节点里展开，代码块和代码 span 中不展开；被引入的文件放在引入它的文件之前；`processedPaths` 防环；最多 5 层（`MAX_INCLUDE_DEPTH`，`:536,629`）；只允许文本类扩展名（`:95`）；文件不存在时静默忽略。项目外的 include 需要用户批准（`hasClaudeMdExternalIncludesApproved`，`:799`）。
- 条件规则：rules 文件的 frontmatter 里写 `paths: glob`，只有访问到匹配的文件时才作为 `nested_memory` attachment 注入；访问 cwd 以下子目录的文件时，按需加载该目录链上的 CLAUDE.md（`CC/utils/attachments.ts:1870-1905`、`claudemd.ts:259-277`）。
- 注入格式：前导语 `"Codebase and user instructions are shown below… OVERRIDE any default behavior…"`，后面每个文件写成 `Contents of {path} ({类型说明}):`（`claudemd.ts:88-89,1152-1194`）。
- AutoMem：`MEMORY.md` 是索引（最多 200 行），记忆类型为 `user/feedback/project/reference`，每条记忆一个独立文件（`CC/memdir/memdir.ts:34-97,227-229`；`CC/memdir/memoryTypes.ts:14-18`）。
- InstructionsLoaded Hook 只用于观测，`load_reason` 取值为 `session_start|nested_traversal|path_glob_match|include|compact`（`hooksConfigManager.ts:232`）。

**coko 参考规则**：指令文件按“管理 → 用户 → 项目（由远到近）→ 本地”拼接，近处优先；include 要有深度上限、防环、项目外审批，并且不在代码块里展开；按路径生效的规则做懒加载；每次加载都记录来源和原因，便于诊断。

---

## 8. Checkpoint / Rewind

- 开关：交互式会话默认开启（`fileCheckpointingEnabled !== false`）；SDK 下需要设置 `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING`；`CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING` 全局关闭（`CC/utils/fileHistory.ts:65-80`）。
- 数据：`FileHistorySnapshot{messageId, trackedFileBackups: Record<path,{backupFileName|null, version, backupTime}>, timestamp}`，`backupFileName=null` 表示文件在该版本时不存在；最多保留 20 个快照（`:31-56`）。备份目录为 `{configDir}/file-history/{sessionId}/`，文件名形如 `{hash}@v{n}`（`:727-739,953-957`）。
- 时机：Edit/Write/NotebookEdit 在写入**之前**调用 `fileHistoryTrackEdit` 备份；每次提交用户消息时调用 `fileHistoryMakeSnapshot(messageId)`，未变化的文件复用上一版本（`:88-330`；调用点 `CC/utils/handlePromptSubmit.ts:559`、`CC/QueryEngine.ts:658`）。
- Rewind：`/rewind`（别名 `/checkpoint`），选项为 `both | conversation | code | summarize | summarize_up_to`（`CC/commands/rewind/index.ts`、`CC/components/MessageSelector.tsx:54-160`）；`fileHistoryRewind(messageId)` 找到对应快照后恢复或删除文件（`fileHistory.ts:349-416`）；CLI 提供 `--rewind-files <user message id>`，需要和 `--resume` 一起使用（`CC/main.tsx:1366`）。
- 范围限制（从实现推断）：只覆盖通过文件工具改动的文件，Bash 或外部进程造成的修改不会被追踪。

**coko 参考规则**：检查点以用户消息为锚点，写入前做备份，存储时复用未变化的版本；回退时让用户选“代码 / 对话 / 两者 / 从这里开始摘要”；Shell 副作用不在检查点范围内，这一点要在 UI 上说清楚。

---

## 9. Slash Commands 与自定义命令

- 类型（`CC/types/command.ts:26-214`）：`prompt`（展开成 prompt 交给模型；字段有 `allowedTools, model, effort, hooks, context:'inline'|'fork', agent, paths, argNames`）、`local`（本地执行，返回文本）、`local-jsx`（UI）。公共字段：`argumentHint, whenToUse, disableModelInvocation, userInvocable, immediate, isSensitive, loadedFrom`。
- 自定义命令来源：`.claude/commands/**/*.md` 和 `~/.claude/commands`；子目录用 `:` 拼成命名空间（`CC/skills/loadSkillsDir.ts:533,566-570`）；按 `getProjectDirsUpToHome` 从 cwd 向上查找（`CC/utils/markdownConfigLoader.ts:29-38,234`）。
- frontmatter（与 skill 共用，`loadSkillsDir.ts:209-263`）：`description, name, allowed-tools, argument-hint, arguments, when_to_use, model('inherit'), effort, disable-model-invocation, user-invocable, context: fork, agent, shell, hooks, paths, version`。
- 参数展开（`CC/utils/argumentSubstitution.ts:97-141`）：`$ARGUMENTS[n]`、`$n`、命名参数、`$ARGUMENTS`；没有任何占位符时在末尾追加 `ARGUMENTS: …`。另有 `${CLAUDE_SKILL_DIR}`、`${CLAUDE_SESSION_ID}`（`loadSkillsDir.ts:346-367`）。
- 内嵌 Shell：`!cmd` 形式的行内代码以及 `!` 标记的代码块，在展开 prompt 时执行，结果嵌入 prompt（`CC/utils/promptShellExecution.ts:48-55`；`loadSkillsDir.ts:375`）。MCP 来源的命令不执行内嵌 Shell。
- 命令声明的 `allowedTools` 在调用期间并入 `alwaysAllowRules.command`，作用域到此为止（`BT/SkillTool/SkillTool.ts:779-810`）。
- MCP prompts 以 `mcp__server__prompt` 的名字暴露为命令（`CC/services/mcp/client.ts:2070`）。

## 10. Skills

- 目录格式只支持 `skill-name/SKILL.md`。来源依次为 managed `.claude/skills`、`~/.claude/skills`、从 cwd 向上的各层 `.claude/skills`、plugin，以及旧的 `commands` 目录（`CC/skills/loadSkillsDir.ts:405-470,638-710`）。
- 展开时在前面加上 `Base directory for this skill: {dir}`（`:346`）；带 `paths:` 的条件 skill 只有访问到匹配路径时才激活（`:156,771-789`）。
- 模型通过 `Skill` 工具调用：输入 `{skill, args?}`；`disableModelInvocation` 为真时拒绝调用（`BT/SkillTool/SkillTool.ts:297-300,416`）。
- 权限：先看 `Skill(name)` / `Skill(name:*)` 的 deny/allow 规则；skill 只包含安全属性（没有 allowed-tools、hooks、fork 之类）时自动放行；其余情况询问用户，并给出精确名和前缀两种规则建议（`:436-575`）。
- 列表预算：skill 列表的描述总量约占上下文的 1%（字符数按 token×4 估算，默认 8000 字符），单条描述最多 1536 字符（`BT/SkillTool/prompt.ts:21-49`）。
- 压缩后重新注入已调用 skill 的内容（25k 预算）。

**coko 参考规则（9+10）**：命令和 skill 共用同一套 frontmatter 与加载器；参数展开规则固定并有“没有占位符就追加”的兜底；一次调用临时授予的工具只在本次调用范围内生效；skill 只有“声明安全”时才自动放行；列表描述设总预算。

---

## 11. MCP 接入配置

- Server 配置（`CC/services/mcp/types.ts:10-130`）：`stdio{command,args,env}`、`sse{url,headers,headersHelper,oauth}`、`http{…}`、`ws{…}`、`sdk`、IDE 专用的 `sse-ide/ws-ide`、`claudeai-proxy`。
- Scope：`local | user | project | dynamic | enterprise | claudeai | managed`。
- 文件和存储：project 为 cwd 向上各层的 `.mcp.json`；user 和 local 存在全局配置 `~/.claude.json` 的 `mcpServers` 中（local 按项目分键）；enterprise 为 `managed-mcp.json`（`CC/services/mcp/config.ts:63,89,888-980`）。
- 合并（`config.ts:1071-1238`）：存在 enterprise 配置时**只用 enterprise**；否则合并顺序为 plugin < user < 已批准的 project < local（后者覆盖前者），再经过 `isMcpServerDisabled` 和 `allowedMcpServers/deniedMcpServers` 策略过滤；与手动配置的 server 重复的 plugin server 会被抑制。
- 项目 server 审批：`disabledMcpjsonServers` 表示拒绝；`enabledMcpjsonServers` 或 `enableAllProjectMcpServers` 表示批准；否则为 pending，需要用户确认。bypass 模式下自动批准，但仓库里的 projectSettings 不能替用户接受 bypass 对话框（`CC/services/mcp/utils.ts:342-380`）。
- 配置值支持 `${VAR}` 和 `${VAR:-default}` 展开（`CC/services/mcp/envExpansion.ts:7-18`）。
- 运行参数：连接超时 `MCP_TIMEOUT`，默认 30s；工具调用超时 `MCP_TOOL_TIMEOUT`，默认约 27.8 小时；连接分批进行（`CC/services/mcp/client.ts:212-228,458,553`）；工具输出上限 `MAX_MCP_OUTPUT_TOKENS`，默认 25000（`CC/utils/mcpValidation.ts:16-46`）。
- 工具命名为 `mcp__{normalize(server)}__{tool}`（`CC/services/mcp/mcpStringUtils.ts:40-50`）；权限默认 passthrough，也就是要问；规则可以按 server 粒度写。

**coko 参考规则**：配置分 scope 存放；项目级 server 必须经用户批准；企业或策略配置可以独占或过滤；工具名带 server 前缀；默认需要审批；连接超时与调用超时分开，输出设上限。

---

## 12. 后台 Bash 任务

- BashTool 输入：`{command, description, timeout?(≤max), run_in_background?, dangerouslyDisableSandbox?}`；默认超时 2 分钟，最大 10 分钟，可以通过 `BASH_DEFAULT_TIMEOUT_MS` / `BASH_MAX_TIMEOUT_MS` 修改（`BT/BashTool/BashTool.tsx:296-351`；`CC/utils/timeouts.ts:2-29`）。
- 转入后台有三条路径（`BashTool.tsx:1009-1172`）：显式 `run_in_background`；命令超时后自动转后台（`onTimeout`，只对允许自动后台的命令生效）；assistant 模式下阻塞超过 15s 自动转后台。用户也可以手动把正在运行的命令转到后台。返回结果中带 `backgroundTaskId` 和输出文件路径（`:737-744`）。
- 任务模型：`TaskType = local_bash | local_agent | remote_agent | in_process_teammate | …`，`TaskStatus = pending | running | completed | failed | killed`，终态为后三种；字段包括 `outputFile`、`notified`（`CC/Task.ts:6-56`）。
- 输出落盘：`{taskOutputDir}/{taskId}.output`，上限 5GB（`CC/utils/task/diskOutput.ts:30,72-74`）。
- 完成通知：作为下一轮的 pending notification 注入，格式如下（`CC/tasks/LocalShellTask/LocalShellTask.tsx:177-204`）：

```xml
<task-notification><task-id>…</task-id><tool-use-id>…</tool-use-id>
<output-file>…</output-file><status>completed|failed|killed</status>
<summary>Background command "desc" completed (exit code 0)</summary></task-notification>
```

- 卡住检测：输出 45s 不增长，且尾部看起来像交互式提示时，提醒模型处理（`LocalShellTask.tsx:32-78`）。
- 配套工具：`TaskOutput{task_id, block, timeout≤600000, 默认 30000}`（`BT/TaskOutputTool/TaskOutputTool.tsx:32-34`）、`TaskStop{task_id, shell_id 已弃用}`（`BT/TaskStopTool/TaskStopTool.ts:12-62`）。在 Monitor 特性下，前台 `sleep` 会被拦截，提示改用后台运行（`BashTool.tsx:654-659`）。

**coko 参考规则**：后台 Job 统一为“任务记录 + 落盘输出 + 终态通知注入下一轮”；支持显式、超时、预算三种转后台方式；提供读取（可阻塞并带超时）和停止接口；卡住时提醒模型。

---

## 13. Fork / Resume

- 存储：主会话 `~/.claude/projects/{cwd-slug}/{sessionId}.jsonl`；每条记录有 `uuid`/`parentUuid`，组成消息链；子代理记录在 `subagents/` 下（`CC/utils/sessionStorage.ts:136-262`）。
- CLI：`-c/--continue`（当前目录最近一次会话）、`-r/--resume [id]`、`--fork-session`（恢复时生成新的 sessionId）、`--session-id <uuid>`（与 continue/resume 同用时必须加 `--fork-session`）、`--resume-session-at <msg id>`（print 模式下截断到指定消息）、`--rewind-files`（`CC/main.tsx:1319-1409,1703-1708`）。
- 恢复清洗（`CC/utils/conversationRecovery.ts:167-230`）：迁移旧的 attachment 类型 → 删除非法的 `permissionMode` → 用 `filterUnresolvedToolUses` 去掉没有结果的 tool_use → 删除孤立的 thinking 和纯空白的 assistant 消息 → 检测中断：轮次中途被打断时追加 meta 用户消息 `Continue from where you left off.`，统一归为 `interrupted_prompt`；同时恢复 skill 状态（`:396`）。
- `/branch`（在 FORK_SUBAGENT 未开启时别名为 `/fork`）：用新的 `randomUUID` 作为 sessionId，复制全部条目并重建 `parentUuid` 链，每条写入 `forkedFrom{sessionId, …}`，同时迁移 content-replacement 记录（`CC/commands/branch/branch.ts:27-156`）。plan 文件在 fork 或 resume 时复制到新的 slug 下（`CC/utils/plans.ts:253-257`）。
- 子代理恢复：读取子代理转录和 `.meta.json`；原 worktree 已经不存在时退回父级 cwd；fork 类型的代理走单独的恢复分支（`BT/AgentTool/resumeAgent.ts:43-103`）。

**coko 参考规则**：会话是 append-only 的链式记录，恢复时必须先清洗未完成的工具调用，再决定是否自动续跑；不能直接重放有副作用的工具调用（与 `agent-runtime.md` 的恢复约定一致）。Fork 生成新 ID 并记录来源，派生产物（plan、替换记录）随 fork 一起复制。

---

## 14. 未验证 / 局限

- 只做了静态阅读，没有运行这份代码；`feature()` gate 在本仓库构建时的实际取值没有核实。auto/classifier、team/swarm、KAIROS、远程（CCR）等分支只记录了入口，没有展开。
- 这个仓库是社区还原版，与 Anthropic 官方 Claude Code 的行为是否一致，需要另外对照[官方文档](https://docs.anthropic.com/en/docs/claude-code)确认（本次没有抓取）。
- Checkpoint 不覆盖 Bash 副作用这一点，是根据 `fileHistoryTrackEdit` 的调用点（只在文件工具中）推断的，没有逐一排查所有调用方。
