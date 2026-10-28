# M3 上下文与指令：规格

Status: ready-for-agent
Spec status: approved（2026-10-29，按用户常设指示采纳，未经用户逐条确认）
Map: [Coko 桌面应用](../desktop-app/map.md) · [里程碑划分](../desktop-app/issues/06-grill-milestone-route.md) · 讨论：[grilling.md](grilling.md) · 实施须知：[implementer-brief.md](implementer-brief.md)

## Problem Statement

M2 之后 Agent 能安全地读写与执行，但它对用户和项目一无所知：系统提示只有一句固定文本，不读 AGENTS.md / CLAUDE.md；没有 Skills、自定义命令或 MCP Server，能力只能靠内置的七个工具；用户不能在消息中用 @ 引用文件，看不到上下文用了多少，长会话撑满模型窗口后直接以模型错误结束；没有跨会话的记忆；配置只有全局设置，项目无法覆盖，能力不能开关。输入区草稿只在内存里，切换会话或重启就丢。M2 评审留下的两个结构问题（SessionService 过大、条目派生写了三份）和 Secrets 只靠环境变量名隔离的缺口，在接入 MCP 凭据前必须解决。

## Solution

交付 Rules / Instructions、Skills、Commands / Prompt Templates、MCP（stdio 与 streamable HTTP 的工具、资源与提示模板）、Context Management（@ 文件引用、Token 用量、工具输出裁剪）、Compaction、Memory 与完整的 Configuration。用户在 `~/.coko` 与 Workspace 中放置指令、Skills 与命令，Agent 自动加载；在输入区用 `/` 调用命令与 Skill、用 `@` 引用文件；在设置中管理 Skills & Commands、MCP Server 与 Secret、Memory；输入区底栏显示上下文用量，接近上限时自动压缩并在时间线留下分隔条；草稿在重启后仍在。项目文件只能收紧全局设置，MCP 项目 Server 须批准，Secret 只来自登记条目。决定见 [ADR 0007](../../docs/adr/0007-secrets-from-registered-entries.md)、[ADR 0008](../../docs/adr/0008-project-files-only-tighten.md)、[ADR 0009](../../docs/adr/0009-user-authored-resources-as-files.md)；术语见 [GLOSSARY](../../GLOSSARY.md)。

## User Stories

**指令文件**

1. As a 用户, I want Agent 自动读取 `~/.coko/AGENTS.md` 与仓库根到 Workspace 之间各层的 AGENTS.md（没有时读 CLAUDE.md）, so that 我和项目的约定不必每次重复。
2. As a 用户, I want 近处的指令优先于远处、Workspace 子目录里的指令在 Agent 触及该目录时才加载, so that 指令有作用域且不浪费上下文。
3. As a 用户, I want 指令文件用 `@path` 引入其他文件（代码块中不展开、有深度上限、不越出仓库或 `~/.coko`）, so that 长指令可以拆分。
4. As a 用户, I want 修改指令文件后下一次 Run 生效，加载了哪些文件、是否被截断能在上下文面板看到, so that 我能确认 Agent 读到了什么。

**Skills**

5. As a 用户, I want 放在 `~/.coko/skills`、`~/.agents/skills`、`<Workspace>/.coko/skills`、`<Workspace>/.agents/skills` 的 Skill 被发现并列给 Agent, so that Agent 在合适的任务中自己选用。
6. As a 用户, I want 用 `/<skill-name> 参数` 显式调用一个 Skill, so that 我能指定做法。
7. As a 用户, I want Agent 读取 Skill 目录内的参考文件无需审批、运行其中的脚本仍需审批, so that 按需加载顺畅而执行仍受控。
8. As a 用户, I want 在设置的 Skills & Commands 分区看到每个 Skill 与命令的来源、启停开关和格式错误, so that 我能管理它们并修好坏文件。

**命令**

9. As a 用户, I want 在 `~/.coko/commands` 与 `<Workspace>/.coko/commands` 用 Markdown 写提示模板，以 `/name 参数` 调用并按 `$1`、`$ARGUMENTS` 展开, so that 常用提示一键复用。
10. As a 用户, I want 在输入区开头输入 `/` 时看到按来源分组的命令菜单并用键盘选择, so that 不必记住命令名。
11. As a 用户, I want 时间线把命令消息显示为命令名与参数，可展开看全文, so that 历史易读。

**MCP**

12. As a 用户, I want 在设置中添加 stdio 或 HTTP 的 MCP Server，看到连接状态与工具数并可启停、重连, so that 我能接入外部工具。
13. As a 用户, I want MCP 工具调用默认需要审批，可按工具或 Server 保存规则, so that 外部工具不会绕过权限。
14. As a 用户, I want Workspace 的 `.mcp.json` 中的 Server 在我看过完整命令并批准后才启动，改动后须重新批准, so that 克隆的仓库不能直接在我机器上运行进程。
15. As a 用户, I want 在设置中登记 Secret 并在 MCP 配置中用 `${NAME}` 引用，Secret 不出现在命令环境、协议、库明文与日志中, so that 凭据安全。
16. As a 用户, I want Agent 能列出与读取 MCP 资源、我能以 `/mcp__server__prompt` 调用 MCP 提示模板, so that MCP 的三类能力都可用。

**上下文**

17. As a 用户, I want 输入 `@` 搜索并插入 Workspace 内的文件或目录引用，发送后 Agent 直接拿到内容, so that 不必等它自己去读。
18. As a 用户, I want 输入区底栏显示上下文用量百分比，接近上限时变色，点开可看分项与已加载的指令文件, so that 我知道何时该压缩或开新会话。
19. As a 用户, I want 隔了很久再继续时较旧的大段工具输出不再占满上下文, so that 长会话保持可用。
20. As a 用户, I want 内置 grep / find 与桌面端 ripgrep 遵守同样的忽略规则（含 `.git/info/exclude` 与全局 excludes）, so that 搜索结果不因实现不同而不同。

**压缩**

21. As a 用户, I want 上下文接近上限时自动压缩：较早的对话被结构化摘要替代，目标、约束和我说过的话被保留, so that 长任务不中断。
22. As a 用户, I want 用 `/compact 说明` 手动压缩，时间线显示压缩分隔条并可展开摘要，之前的消息仍可查看, so that 我能控制并回看。
23. As a 用户, I want 自动压缩连续失败时停下并提示我手动压缩，压缩可被停止，回退到压缩之前时原历史恢复, so that 压缩出错不会失控。

**Memory**

24. As a 用户, I want Agent 用工具记下和删除用户级或 Workspace 级的记忆，并在以后的会话中看到它们, so that 偏好和项目事实跨会话保留。
25. As a 用户, I want 在设置的 Memory 分区查看、添加、编辑与删除记忆, so that 我掌控 Agent 记住了什么。

**配置**

26. As a 用户, I want 在设置中开关 Skills、MCP、Memory、自动压缩等能力，项目的 `.coko/settings.json` 可以关闭能力或追加拒绝规则但不能放开权限, so that 我和项目都能约束 Agent 而项目不能越权。
27. As a 用户, I want 配置文件有错时看到具体诊断而不是整个设置失效, so that 我能定位问题。

**遗留项**

28. As a 用户, I want 切换会话、关闭窗口或重启后输入区的草稿（含文件引用）仍在, so that 写了一半的消息不丢。
29. As a 开发者, I want 条目派生（有效条目、上一 Run 状态、未回答的确认、压缩后的上下文）只有一份实现，SessionService 按职责拆分, so that M3 新增的 Session 能力不必散改多处。

## Implementation Decisions

讨论记录：[grilling.md](grilling.md)，全部按常设指示采纳。

### Session Entry 与事件（票 01 预先声明）

| kind / 事件 | 何时 | payload 要点 |
| --- | --- | --- |
| `command` | 识别到命令时，位于 `run_start` 之后、展开后的 user message 之前（steer 时在该 user message 之前） | `name`、`args`、`source`: builtin / project / user / skill / mcp |
| `compaction` | 压缩成功 | `summary`、`firstKeptSeq`、`tokensBefore`、`tokensAfter?`、`trigger`: auto / manual / overflow、`readFiles`、`modifiedFiles`、`invokedSkills?` |
| RunTrigger `compact` | 手动 `/compact` 的 Run | 该 Run 只提交 `compaction`（或失败的 run_end） |
| progress `context_usage` | 每条 assistant 消息提交后 | `tokens`（该 assistant 的 usage：input + cacheRead + cacheWrite + output）、`contextWindow` |
| progress `compaction_start` / `compaction_end` / `compaction_failed` | 压缩开始 / 成功 / 失败 | `trigger`；end 带 `tokensBefore`、`tokensAfter?`；failed 带 `message`、`consecutiveFailures` |

File Reference 与嵌套指令不新增 kind：它们是同一条 user message / toolResult 中的文本块，以 `<file_reference path="…">` / `<instruction_file path="…" scope="nested">` 开头（协议 `packages/protocol/src/files.ts` 导出识别函数，renderer 据此显示为 chip）。Memory 的增删不新增 kind（工具调用与结果已在条目中）。

### 加载位置与优先级

| 资源 | 用户级（`COKO_HOME`，缺省 `~/.coko`） | 项目级 | 优先级 |
| --- | --- | --- | --- |
| 指令 | `AGENTS.md`（缺省 `CLAUDE.md`） | 仓库根（Workspace 向上最近的含 `.git` 的祖先，不越过家目录；不在仓库内则只有 Workspace）到 Workspace 根每层一个；子目录按需 | 用户 → 远 → 近 → 嵌套，越后越优先 |
| Skills | `skills/`、`~/.agents/skills/` | `.coko/skills/`、`.agents/skills/` | 项目 > 用户；`.coko` > `.agents` |
| 命令 | `commands/**/*.md` | `.coko/commands/**/*.md` | 内置 > 项目 > 用户 > Skill > MCP 提示模板；子目录以 `:` 拼名 |
| MCP | 设置键 `mcp.servers` | `.mcp.json`（须批准，不能引用 Secret，同名被全局遮蔽） | 全局 > 项目 |
| 能力配置 | 设置键 `config` | `.coko/settings.json`（只收紧，ADR 0008） | 默认 ← 全局 ← 项目 |

每个 Run 开始时重新解析（按 mtime 缓存）；读取失败或格式错误只产生诊断 `{ source, path, code, message }`，不阻止 Run。`COKO_HOME` 由 Sidecar 从环境读取（不是测试钩子，打包产物同样生效）。

### 预算与数值

| 项 | 值 |
| --- | --- |
| 指令 | 单文件 40 000 字符，合计 120 000（超出从最远处丢弃）；@import 最多 5 层，只接受文本扩展名 |
| Skills 索引 | 合计 8000 字符，单条描述 1024；`skill` 工具返回的文件清单最多 50 项 |
| File Reference | 每个文件按 read 截断（2000 行 / 50KB），目录列表最多 200 项；单条消息最多 10 个、合计 200KB |
| Memory | 单条 2000 字符；注入合计 12 000 字符 |
| MCP | 连接超时 30 秒；请求超时缺省 60 秒（配置 `timeout` 秒，进度通知重置）；结果 50KB / 2000 行；崩溃后自动重连至多 3 次（1、2、4 秒）；stderr 保留 20 行 |
| 压缩 | 有效窗口 = contextWindow − min(maxTokens, 20 000)；buffer 13k / 30k（窗口 ≥ 400k）/ 50k（≥ 800k）；阈值 = 有效窗口 − buffer；预警 = 阈值 − 20 000；保留最近 20 000；摘要 maxTokens 20 000；连续 3 次失败熔断 |
| 时间裁剪 | 距最后一条 assistant 超过 60 分钟时，保留最近 5 个 toolResult，其余超过 2KB 的替换为 `[Old tool result content cleared]` |
| Token 估算 | 最后一次 assistant usage + 其后消息 chars/4；分项一律 chars/4 |

### 配置 schema（agent `config/`，票 01 预先定义类型与默认值，票 02 实现加载、合并与接口）

```text
instructions.enabled      true      skills.enabled       true     skills.disabled   string[]
commands.enabled          true      commands.disabled    string[]
mcp.enabled               true      memory.enabled       true
context.autoCompact       true      context.trimOldToolResults  true
```

项目 `.coko/settings.json` 可写同名布尔键（只有 false 生效）、`skills.disabled`（追加）、`permissions.deny` / `permissions.ask`（规则文本数组，作为 project 作用域）；`permissions.allow`、`permissions.defaultMode` 与值为 true 的开关被忽略并诊断 `project-cannot-grant`；未知键诊断 `unknown-key`；值不合 schema 诊断 `invalid-value`；JSON 解析失败整文件忽略。`GET /api/config?workspaceId` → `{ effective, global, globalRevision, project?: { path, values, diagnostics } }`；`PUT /api/config { values, expectedRevision }`（409 `revision-conflict`）。`config` 键只能经此接口改。

### 权限类（票 01 实现机制，扩展 ADR 0005 的模式表）

宿主注册工具时给出权限类（`RegisterToolOptions.permissionClass`，工具自身不能声明）：read（read、grep、find、ls）、edit、bash 照旧；context-read（skill、memory_list、list_mcp_resources、list_mcp_resource_templates、read_mcp_resource）所有模式放行；memory-write（memory_write、memory_delete，规则组名 `Memory`）在 accept-edits 与 full-access 放行；external（`mcp__*`）只在 full-access 放行。判定顺序不变（拒绝 → 询问 → 受保护路径 → 越出可写根 → 模式放行 → 允许 → 询问）。规则 `mcp__<server>` 匹配该 Server 的全部工具；`mcp__` 开头的名字即使当前未注册也接受（不报 `unknown-tool`）。`RuntimePermissions.readRoots()` 给出额外读取根（Skill 目录），其下的 read 组调用与 Workspace 内读取同样处理。

### packages/agent

- **`@coko/agent/entries`（票 01）**：浏览器安全子路径，纯函数 `effectiveEntries`（rewind 与 compaction）、`lastRunStatus`、`unansweredConfirmations`、`modelContext`（有效条目 → 模型消息，压缩后为合成摘要消息 + firstKeptSeq 及之后），泛型于 `{ seq, kind, payload, runId }`；只导入 typebox 与本子路径内模块，守卫测试断言不导入 `node:*` 与 pi。server、renderer、agent 内部都从它导入；renderer 的旧实现删除。
- **运行时 seam（票 01）**：`AgentRuntimeOptions.context?: { systemSections?(): Promise<SystemSection[]>; transformMessages?(messages): AgentMessage[]; beforeRequest?(state): Promise<void> }`，每个 Run 开始取一次 system sections 组成 pi 的 `SystemMessage.sections`（`DEFAULT_SYSTEM_PROMPT` 为第一段）；`run(input: string | RunInput)`，`RunInput { text; content?; before?: RunEntry[] }`（before 在 run_start 之后、user message 之前提交）；`steer` 同样接受 RunInput。
- **instructions/**：`shared/`（票 01：只读文件端口、mtime 缓存、诊断类型、`yaml` frontmatter 解析）、`rules/`（票 03）、`commands/`（票 04：发现、`parseCommandArgs`、`substituteArgs`、注册表与来源接口、内置列表）、`skills/`（票 05）。
- **extensions/mcp/**（票 07、08）：用 pi-mcp `McpClient`；配置校验与规范化摘要、工具命名、结果转换、连接状态机（idle / connecting / connected / failed / disabled / pending-approval）、resources 工具与 prompts 的 `request()` 封装（能力检查、分页与重复 cursor 检测、结果按 schema 校验）。传输由宿主注入（`createTransport(config)`）。客户端声明 roots = Workspace。
- **context/**：`references/`（票 06）、`memory/`（票 09）、`usage/`（票 10：估算、阈值、时间裁剪）、`compaction/`（票 11：触发、切点、摘要提示、增量更新、熔断）。
- **config/**：schema 与默认值（票 01）、合并与诊断（票 02）。
- **tools/builtin/walk.ts、glob.ts**（票 10）：读 `.git/info/exclude` 与全局 excludes。
- 依赖（票 01 写入 manifest 并登记 TECH_STACK）：`@earendil-works/pi-mcp` 1.4.0、`yaml` 2.9.0。

### packages/session（票 01）

迁移 v3：表 `memories`（id、scope、workspace_id、content、source、created_at、updated_at；STRICT，索引 scope+workspace_id+updated_at）与 `secrets`（name 主键、ciphertext、hint、updated_at）。`MemoryRepository`（list、get、create、update、delete）与 `SecretRepository`（list 只返回 name 与 hint、setCiphertext、getCiphertext、delete），SQLite 与内存实现共用契约测试。ADR 0003 的 Memory 部分由此落地。

### packages/protocol（票 01 建立领域文件并在 `index.ts` 一次性 re-export）

`config.ts`、`instructions.ts`、`commands.ts`、`skills.ts`、`mcp.ts`、`secrets.ts`、`memory.ts`、`files.ts`、`context.ts`、`context-entries.ts`（command、compaction 的 payload schema，进入 `SESSION_ENTRY_PAYLOAD_SCHEMAS`）；`ws.ts` 的 progress 增加上表事件；`runs.ts` 的 RunTrigger 增加 compact。路由（全部在 `/api` 下）：

| 路由 | 票 |
| --- | --- |
| `GET / PUT /api/config` | 02 |
| `GET /api/commands?sessionId | workspaceId` → 命令目录（name、description、argumentHint、source、path?、enabled）与诊断 | 04 |
| `GET /api/skills?workspaceId` → Skill 列表（name、description、path、scope、enabled、allowedTools、disableModelInvocation）与诊断；启停经 `PUT /api/config` 的 `skills.disabled` | 05 |
| `GET /api/workspaces/:id/files?query=&limit=` → 模糊匹配的文件与目录（遵守忽略规则，不含 .git） | 06 |
| `GET /api/mcp?workspaceId` → Server 列表（name、scope、transport、status、error?、stderrTail?、tools、approval?）；`PUT /api/mcp/servers { servers, expectedRevision }`；`POST /api/mcp/approvals { workspaceId, name, digest, approve }`；`POST /api/mcp/reconnect { workspaceId, name }` | 07 |
| `GET /api/secrets` → `{ name, hint }[]`；`DELETE /api/secrets/:name`；值只经 preload `setSecret` → main safeStorage → 控制 IPC `secret.store` | 07 |
| `GET / POST /api/memories`、`PUT / DELETE /api/memories/:id`（`?workspaceId` 限定 Workspace 级） | 09 |
| `GET /api/sessions/:id/context`、`GET /api/workspaces/:id/context`（草稿）→ `{ contextWindow, threshold, warning, tokens, estimated, breakdown, instructions: { path, scope, chars, truncated }[], diagnostics, autoCompact: { enabled, paused } }` | 10 |

### apps/server

- **拆分（票 01，行为不变）**：`application/sessions.ts` 只保留 DTO 与 Run 控制；新增 `session-runtimes.ts`（运行时注册表：get、discard、publisher）、`session-permissions.ts`（状态回放、锁、重新判定）、`recovery.ts`（recover、answerConfirmation）、`checkpoints.ts`（checkpoints、rewind、fork、exclusive）。
- **上下文装配（票 01 建立）**：`application/context/`，每个领域一个文件导出 `ContextContribution`（`systemSections`、`tools`（带权限类）、`readRoots`、`hooks`、`expandInput`、`transformMessages`、`commandSources`（Skill 与 MCP 提示模板向命令目录登记来源）、`actions`、`report`（分项字符数、已加载文件与诊断，供上下文用量接口）、`close`），票 01 放空实现；有效配置经 `application/config.ts`（票 01 返回默认值的桩，票 02 实现）交给各贡献；`context/index.ts` 按固定顺序组合（指令 → Skills 索引 → Memory 为 system section 顺序；输入展开顺序：命令 → File Reference）。SessionService 每个 Run 开始时向组合取值并交给运行时；提交消息与 steer 先经 `expandInput`；结果为 `{ kind: 'action', name, args }` 时调用 `actions[name]`（Run 进行中 409 `run-in-progress`，steer 中 400 `bad-request`）。有序关闭在关闭存储之前调用各 `close`。
- **路由**：`http/app.ts` 只挂载 `http/routes/<domain>.ts`，票 01 建立空 router。
- **Secrets（票 07）**：`SecretProvider` 改为只解析登记的 Secret（IPC 模式经 `secret.decrypt`，独立运行读 `COKO_SECRET_<NAME>`）；`createEnvSecretProvider` 的按名读环境删除；stderr 与诊断经已解密 Secret 值脱敏。
- **MCP（票 07、08）**：`adapters/mcp.ts` 提供 stdio / HTTP 传输；`McpManager` 按 (Workspace, Server) 池化连接，第一个 Run 时连接，状态经 `GET /api/mcp`。

### apps/desktop

- **main / preload（票 07 唯一所有者）**：`setSecret(name, value)` IPC → safeStorage → `secret.store`；只回传末四位；safeStorage 不可用返回 `encryption-unavailable`。
- **composer（票 04 → 06 → 10 → 11 串行）**：packages/ui 的 `ComposerTypeahead`（`LexicalTypeaheadMenuPlugin`）、File Reference 节点、草稿持久化、上下文环、压缩状态行。typeahead 规则见 grilling I1。
- **草稿（票 06）**：`stores/draft-store.ts`，EditorState JSON 存 `localStorage`：键 `coko.draft.<sessionId>` / `coko.draft.workspace.<workspaceId>`，300 ms 防抖，提交被接受后清除，解析失败丢弃并记 renderer warn。不安装 `@lexical/markdown`，ui.md 同步改写（grilling I2）。
- **设置**：分区注册表 `features/settings/sections.ts`（票 01 建立，含 skills、mcp、memory 三个 `available: false` 的占位）；Skills & Commands（05）、MCP 与 Secrets（07）、Memory（09）、General 的项目设置行与 Permissions 的 project 规则（02）。
- **时间线**：命令 chip（04）、File Reference chip（06）、Memory 工具卡（09）、压缩分隔条（11）；MCP 工具用通用卡。

### 共享装配点与所有者（M3 期间）

- `packages/protocol/src/index.ts`、`entries.ts`、`ws.ts`、`runs.ts`；`packages/agent/src/index.ts`、`package.json`（exports、依赖）、`engine/types.ts`、`session-entries/index.ts`、`policy/decide.ts`、`tools/registry.ts`；`packages/session/src/sqlite/schema.ts`；`pnpm-lock.yaml`；`packages/i18n/src/dictionaries.ts` 与 `dictionaries/{en,zh}.ts`：只有票 01 改。之后各票只改 01 建好的领域文件（protocol 领域文件、agent 各子目录 barrel、i18n `dictionaries/domains/<domain>.ts`）。
- `packages/agent/src/engine/runtime.ts`：01 → 11。`packages/agent/src/entries/`：01 → 11。
- `apps/server/src/application/sessions.ts`：01 → 11；`http/app.ts`、`runtime/layers.ts`、`application/context/index.ts`、`application/session-*.ts`：只有 01。各 `application/context/<domain>.ts` 与 `http/routes/<domain>.ts` 归所属票（mcp：07 → 08；usage：10；compaction：11）。`application/permissions.ts`、`application/config.ts`：02。`adapters/faux.ts`（脚本可设 contextWindow / maxTokens）：10。`src/config.ts`（`COKO_HOME`）：01。`src/control/`、`adapters/credentials.ts`、`adapters/mcp.ts`：07。
- `apps/desktop/src/main/`、`preload/`、`shared/bridge.ts`：只有 07。
- renderer `features/conversation/composer.tsx`：04 → 06 → 10 → 11；`timeline.ts`、`timeline-view.tsx`：01 → 04 → 06 → 11；`tool-cards.tsx`：09；`stores/chat-store.ts`：01（之后的票新增独立 store 文件）；`features/settings/sections.ts`、`settings-dialog.tsx`、`app/settings-dialog-store.ts`：只有 01；各分区文件归所属票。
- `packages/ui/src/index.ts` 与 `composer/`：04 → 06 → 10。
- `tests/integration/sidecar-harness.ts`、`secrets-gate-harness.ts`、`apps/desktop/e2e/harness.ts`：只有 01（加入临时 `COKO_HOME` 与写入其中文件的辅助函数）；之后的票只新增测试文件，秘密总闸的新通道写在 `tests/integration/secrets-gate-<channel>.test.ts`。`tests/fixtures/mcp/`：07 → 08。
- 文档：`packages/agent/README.md`：01 → 11；`packages/session/README.md`：01；`apps/server/README.md`：01 → 07 → 10 → 11；`docs/tech-stack/architecture.md`：01；`docs/tech-stack/ui.md`：06；`docs/subsystems/permissions.md`：01 → 02 → 07；新子系统页各归一票：`configuration.md`（02）、`instructions.md`（03）、`commands.md`（04）、`skills.md`（05）、`context.md`（06 → 10 → 11）、`mcp.md`（07 → 08）、`memory.md`（09）。`docs/README.md` 的"当前行为"每票只增自己的一行；TECH_STACK 接入状态表只增本票的行；这两处的一行冲突由 Lead 合入时处理。ADR 状态：0003（01、09）、0007（07）、0008（02、07、05 各补自己的证据）、0009（05，在 03、04 合入后补全部证据）。
- 产物 smoke `apps/desktop/e2e/package-smoke.e2e.test.ts`：只有 11（票 11 因此排在 08 之后）。

## Testing Decisions

- 好的测试只断言外部事实：协议响应与事件、faux 的 requestLog 中实际发给模型的 system sections 与消息、重新读回的条目、Workspace 与 `COKO_HOME` 下的文件不被改写、子进程是否启动、窗口中实际渲染与交互。
- 测试接口（由高到低）：
  1. **Sidecar 协议**（主接口）：`ELECTRON_RUN_AS_NODE=1` 启动真实 Sidecar，临时 `COKO_HOME` 与 Workspace 夹具；覆盖指令加载与优先级、@import 边界、嵌套按需加载、命令展开与条目、Skills 发现与调用、MCP stdio 与 HTTP 测试 Server（连接、工具调用审批、批准、Secret 注入、关闭时子进程退出）、资源与提示模板、File Reference、Memory、上下文用量、时间裁剪、自动 / 手动 / 溢出压缩与熔断、回退与分叉经过压缩、项目设置只收紧、SessionService 拆分后 M2 全部集成测试照常通过。
  2. **packages/agent**：加载器与 frontmatter、`substituteArgs`、命名与截断、切点、估算、阈值、`effectiveEntries` 与 `modelContext` 的表驱动用例；`@coko/agent/entries` 的导入守卫。
  3. **packages/session**：迁移 v3、MemoryRepository 与 SecretRepository 契约（SQLite 与内存）。
  4. **Electron E2E**：`/` 与 `@` typeahead（键盘与指针）、草稿重启后保留、Skills & Commands / MCP / Memory 分区、上下文环与 HoverCard、压缩分隔条。
  5. **产物 smoke**：打包产物中 `COKO_HOME` 下的指令文件进入模型请求、一个 stdio MCP 测试 Server 的工具可调用（验证 pi-mcp 与 cross-spawn 进入 sidecar 产物）。
- Browser Mode：typeahead 键盘（↑↓、Enter / Tab、Esc 不改草稿、关闭后同一 token 不再弹出、输入法组合不触发）、File Reference 节点的序列化。
- 内置 grep / find 与 ripgrep 运行同一组 gitignore 契约用例（临时 HOME 下的全局 excludes 与 `.git/info/exclude`）。
- 秘密不外泄总闸：01 拆出共享 harness 并保持原用例；07 新增不匹配剔除模式的 Secret（如 `MY_SERVICE_DSN`）经 MCP 注入后的扫描（含 bash `env` 输出与 MCP stderr 诊断）；09 新增 Memory 通道。
- 真实模型：具备环境变量凭据时跑一条带指令文件与自动压缩的真实对话，否则报告未验证。

## Out of Scope

- 指令：路径条件规则（`.claude/rules` 的 `paths`）、`CLAUDE.local.md` / `AGENTS.override.md`、managed / 企业策略文件、InstructionsLoaded 与 PreCompact Hook（M5）。
- Skills / 命令：界面内编辑、市场与安装、Plugin 提供的 Skills / 命令 / MCP（M6）、命令 frontmatter 的 `model` / `allowed-tools` 生效、内嵌 `!cmd`、`/init` 等其他内置命令。
- MCP：OAuth、SSE 与 WebSocket 传输、codemode / deferred 暴露、sampling、elicitation、资源订阅、在 `@` 菜单引用 MCP 资源、stdio Server 的沙箱。
- 上下文：会话引用（`@session`）、图片引用、Goal / Plan / Todo 的压缩后重注入（M4）、Memory 检索与 FTS 索引、自动提取记忆。
- 发布构建的产物 E2E、签名与公证（M6）。

## Further Notes

- Sidecar 被强杀时 stdio MCP 子进程可能残留，并入地图 M4 的孤儿进程 Carry-over。
- 时间裁剪与压缩会使提示缓存失效；时间裁剪只在缓存已冷（60 分钟）时进行。
- pi-mcp 用 cross-spawn 启动子进程，产物 smoke 必须证明它进入了 sidecar bundle。
- MCP 工具的 inputSchema 来自外部，可能含 TypeBox 校验器不支持的关键字；票 07 先核对 pi coding-agent 的处理并按其做法放行，实施时在票 Comments 记录结论。
- 并行窗口内的票只在写范围不重叠时由 Lead 同时派发：{03, 04, 07, 09}、{05, 06, 08}、{05, 08, 10}；01、02、11 串行。每票合入前做该票 diff 的轻量 Spec 评审，里程碑末做两轴全量评审。
