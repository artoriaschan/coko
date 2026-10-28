# M3 上下文与指令：设计树与采纳记录

Map: [Coko 桌面应用](../desktop-app/map.md) · [里程碑划分](../desktop-app/issues/06-grill-milestone-route.md) · 规格：[spec.md](spec.md)

2026-10-29，planner。按用户常设指示（2026-10-28 goal：讨论问题直接采用推荐答案，优先沿用参考项目决策；packages/agent 参考 pi coding-agent v1.4.0 与 claude-code，apps/desktop 的 UI 参考 deepseek-harness），本文每个问题都由 Agent 给出推荐并**按常设指示采纳**，不是用户逐条确认。参考材料：[pi 研究](../desktop-app/research/pi-agent-core-and-coding-agent.md) §3、§4.2–4.6、§4.8；[claude-code 研究](../desktop-app/research/claude-code-agent-logic.md) §6、§7、§9–§11；[DSH 研究](../desktop-app/research/dsh-desktop-architecture.md) §3.3；pi v1.4.0 `coding-agent/src/core/{resource-loader,skills,prompt-templates,mcp-servers}.ts`、`compaction/compaction.ts`、`extensions/mcp/{config,tools,resources}.ts`、`utils/frontmatter.ts`；DSH `packages/client/{ui-input-trigger,ui-reference,ui-commands,ui-skill}`；[Agent Skills 规范](https://agentskills.io/specification)。

## 已核对的事实

- pi-agent-core 1.4.0 不含 instructions、skills、prompt templates、compaction；coko 自建。pi-mcp 1.4.0 的 `McpClient` 有 tools、resources（分页）、`callTool`、通用 `request`，没有 prompts 方法；`StdioTransport` 用 cross-spawn 启动并在 closeTimeoutMs（默认 2000）后 SIGTERM→SIGKILL；`StreamableHttpTransport` 支持 headers 与 authProvider。pi-mcp 已在 TECH_STACK 选型，但尚未写入任何 manifest。
- pi 的 frontmatter 解析用 `yaml` 2.9.0（`utils/frontmatter.ts`）；coko 技术栈没有 YAML 解析器，M3 需新增依赖。
- pi 的 MCP 配置：全局 `mcp.json` 与（受信任时）项目 `.pi/mcp.json`，形状 `mcpServers`；认证只允许全局；工具名 `mcp__<server>__<tool>`；默认 per-request timeout 60 秒；资源以 `list_mcp_resources`、`list_mcp_resource_templates`、`read_mcp_resource` 三个工具暴露。
- pi 压缩：`reserveTokens 16384`、`keepRecentTokens 20000`，token 估算 chars/4 + 最后一次 assistant usage；摘要固定 Goal / Constraints & Preferences / Progress / Key Decisions / Next Steps / Critical Context，增量更新。claude-code：阈值 = 窗口 − min(maxOutput, 20k) − buffer（13k / 30k / 50k）、预警线阈值 − 20k、连续失败 3 次熔断、压缩后按预算重注入文件与 skill、9 节摘要逐条保留用户消息、60 分钟后微压缩旧工具结果。
- DSH composer 为 Lexical 纯文本（`@lexical/plain-text`），未使用 `@lexical/markdown`；`@` 与 `/` 共用一个 trigger 管线，焦点留在编辑器、`aria-activedescendant` 高亮、Esc 不改草稿、关闭后同一 token 不再弹出；文件引用为原子 inline 节点，序列化为 `@path`。
- coko 现状：`DEFAULT_SYSTEM_PROMPT` 是一个字符串，运行时没有 system sections；composer 是 Lexical PlainText，草稿只在编辑器内存中；SessionService 842 行；条目派生在 agent、server、renderer 各写一份（M2 评审 S2）；`createEnvSecretProvider` 按名字读 Sidecar 环境（评审 J4）；ripgrep 读全局 gitignore 与 `.git/info/exclude`，内置 grep 不读。
- 受保护路径已含 `.coko`（任意深度）与 `.mcp.json`：Agent 写项目设置、`~/.coko` 下的资源与 `.mcp.json` 都要审批。

## 设计树

```text
M3
├── A 指令文件 ── A1 文件名与位置 ── A2 目录链与边界 ── A3 优先级与注入格式
│                └── A4 @import ── A5 嵌套目录按需加载 ── A6 预算、重读与诊断
├── B Skills ── B1 位置与优先级 ── B2 元数据校验 ── B3 索引注入与预算
│            └── B4 调用（工具 / 显式） ── B5 权限与资源访问 ── B6 allowed-tools
├── C Commands ── C1 来源与命名 ── C2 frontmatter ── C3 参数展开 ── C4 内置动作 ── C5 记录形状
├── D MCP ── D1 配置位置与形状 ── D2 项目 Server 批准 ── D3 传输
│        ├── D4 Secrets（J4） ── D5 连接生命周期 ── D6 工具适配与命名 ── D7 权限
│        └── D8 资源 ── D9 提示模板（request 封装）
├── E 上下文 ── E1 @ 文件引用 ── E2 Token 估算与显示 ── E3 工具输出裁剪 ── E4 gitignore 对齐
├── F 压缩 ── F1 阈值与触发 ── F2 切点 ── F3 摘要结构 ── F4 记录与重建 ── F5 熔断 ── F6 与回退/分叉
├── G Memory ── G1 存储 ── G2 工具 ── G3 注入 ── G4 设置页
├── H 配置 ── H1 层次与位置 ── H2 能力开关与合并 ── H3 校验与诊断
├── I UI ── I1 typeahead ── I2 草稿持久化（Carry-over）── I3 设置分区 ── I4 上下文用量与压缩提示
└── J 交付 ── J1 Carry-overs ── J2 切片与写范围 ── J3 测试接口
```

## 第 1 轮（根节点）

**A1 指令文件名与位置**：沿用 pi（每目录取 AGENTS.override.md → AGENTS.md → CLAUDE.md 的第一个）还是 claude-code（CLAUDE.md + .claude/rules + CLAUDE.local.md）？
➡️ 每个目录取 `AGENTS.md`，不存在时取 `CLAUDE.md`（大小写不敏感，取第一个）；不做 override / local / rules 变体（YAGNI）。用户级在 `~/.coko/AGENTS.md`（同样回退 CLAUDE.md）。采纳。

**H1 配置层次与位置**：用户级资源与配置放哪里？
➡️ 两类分开：应用拥有的状态（能力开关、MCP 全局配置、Secret 密文、Memory、权限规则）在 SQLite（ADR 0003）；用户编写的指令、Skills、命令是 `~/.coko` 下的文件，`COKO_HOME` 可改目录。项目级为 Workspace 内文件。采纳，见 [ADR 0009](../../docs/adr/0009-user-authored-resources-as-files.md)。

**H2 项目文件能做什么**：项目 `.coko/settings.json` 能否写 allow 规则（claude-code）？
➡️ 不能。项目文件只能收紧：关闭能力、追加 deny / ask 规则、禁用 Skill；allow、默认模式与开启能力被忽略并诊断。项目 MCP Server 按配置摘要逐个批准；Skill / 命令的 `allowed-tools` 不放行。采纳，见 [ADR 0008](../../docs/adr/0008-project-files-only-tighten.md)。

**D4 Secrets 来源**（Carry-over J4）：显式白名单还是按来源隔离？
➡️ 按来源隔离：Secret 只来自用户在设置中登记、safeStorage 加密的条目；无界面时只读 `COKO_SECRET_<NAME>`。不再按名字读 Sidecar 环境。MCP 配置用 `${NAME}` 引用；项目文件不能引用。采纳，见 [ADR 0007](../../docs/adr/0007-secrets-from-registered-entries.md)。

**F1 压缩阈值**：pi 的固定 reserve 还是 claude-code 的随窗口 buffer？
➡️ claude-code：有效窗口 = contextWindow − min(maxTokens, 20 000)；buffer = 窗口 ≥ 800k 时 50k、≥ 400k 时 30k、否则 13k；自动压缩阈值 = 有效窗口 − buffer；预警线 = 阈值 − 20k。采纳。

**G1 Memory 存储**：文件（claude-code memdir）还是库？
➡️ SQLite `memories` 表（ADR 0003 已列入库内），packages/session 新增 MemoryRepository。条目 `{ id, scope: user | workspace, workspaceId?, content ≤ 2000 字符, source: model | user, createdAt, updatedAt }`。采纳（ADR 0003 已覆盖，不另写）。

**I2 草稿持久化**（Carry-over，M1 票 07 裁决"EditorState JSON + @lexical/markdown"）：
➡️ 草稿以 Lexical EditorState JSON 持久化到 renderer `localStorage`（键 `coko.draft.<sessionId>` 或 `coko.draft.workspace.<workspaceId>`，300 ms 防抖，提交成功清除，解析失败丢弃）。composer 保持纯文本（DSH 同样），File Reference 是原子节点、序列化为 `@path` 文本，因此 M3 不需要 Markdown 导入导出，**不安装 @lexical/markdown**；ui.md 的约定改为"composer 支持富文本时再用 @lexical/markdown"。采纳（改变 M1 裁决的后半句，理由是没有消费者）。

## 第 2 轮

**A2 目录链与 Workspace 边界**：pi 一直查到 `/`。
➡️ 从 Workspace 根向上找包含 `.git` 的最近祖先（最多到家目录之下，不含家目录本身），该祖先到 Workspace 根之间每一层取一个文件；不在 git 仓库内时只读 Workspace 根。家目录及以上不读（用户级文件另有位置）。采纳。

**A3 优先级与注入格式**：
➡️ 顺序：用户级 → 仓库根 → … → Workspace 根 → 嵌套目录（按需），越近越靠后、越优先。注入为 system section `<instructions>`，前导语沿用 claude-code（"以下指令覆盖默认行为，近处优先"），每个文件包在 `<instruction_file path="…" scope="user|project|nested">` 中。采纳。

**A4 @import**：
➡️ 沿用 claude-code：只在 Markdown 叶子文本中展开（代码块、行内代码不展开）；形式 `@./rel`、`@../rel`、`@~/x`、`@/abs`、`@rel/path.ext`（需含 / 或扩展名）；只接受文本扩展名（md、txt、json、yaml、yml、toml 等）；被引入文件放在引入它的文件之前；最多 5 层、按真实路径防环；文件不存在静默跳过并记诊断。允许的根：仓库根（或 Workspace）与 `~/.coko`；之外的 import 不展开并记诊断 `import-outside-boundary`（不做审批，避免装配时弹窗）。采纳。

**A5 嵌套目录按需加载**：
➡️ Workspace 根之下子目录的 AGENTS.md / CLAUDE.md 不在开始时加载。read / write / edit / grep / find / ls 首次触及某目录时，该目录链上尚未加载的指令文件以 `<instruction_file scope="nested">` 块追加在该次 toolResult 末尾（属于已提交的工具结果，回放稳定）。每个运行时记已加载集合；压缩后清空，下次触及时重新加载。采纳（claude-code nested_traversal 的简化）。

**A6 预算、重读与诊断**：
➡️ 单文件 40 000 字符（超出截断并注明），全部指令 120 000 字符（超出从最远处丢弃并诊断）。每个 Run 开始时重读（按 mtime 缓存），修改后下一 Run 生效。加载结果（路径、作用域、字符数、截断、诊断）经上下文用量接口可见，日志记 `instructions loaded`；不另提交条目。采纳。

**B1 Skills 位置与优先级**：
➡️ 项目：`<Workspace>/.coko/skills`、`<Workspace>/.agents/skills`；用户：`~/.coko/skills`、`~/.agents/skills`。含 SKILL.md 的目录是 skill 根，不再向下；跳过 `.` 开头目录与 node_modules；按真实路径去重。同名时项目优先于用户、`.coko` 优先于 `.agents`，被遮蔽的记诊断。采纳（pi 发现规则 + agentskills.io 的 .agents 约定）。

**B2 元数据校验**：
➡️ 按 agentskills.io：name 1–64、`[a-z0-9-]`、首尾不为连字符、无连续连字符、**须等于目录名**；description 1–1024；compatibility ≤ 500；metadata 为字符串映射；license、allowed-tools 可选。不合格的 skill 不加载并记诊断。另接受 claude-code/pi 扩展 `disable-model-invocation`（true 时不进索引、只能用户显式调用）。frontmatter 用 `yaml` 2.9.0 解析（与 pi 同版本，新增依赖）。采纳。

**C1 命令来源与命名**：
➡️ 来源与优先级：内置 > 项目 `.coko/commands/**/*.md` > 用户 `~/.coko/commands/**/*.md` > Skill（`/<skill-name>`）> MCP 提示模板（`/mcp__<server>__<prompt>`）。子目录以 `:` 组成命名空间（claude-code）。被遮蔽者记诊断。采纳。

**C2 frontmatter**：
➡️ 只认 `description`（缺省取正文首个非空行，pi）与 `argument-hint`；`allowed-tools`、`model` 等仅展示或忽略（ADR 0008）。**不执行内嵌 `!cmd`**（绕过权限判定）。采纳。

**D1 MCP 配置位置与形状**：
➡️ 形状沿用通用 `mcpServers`：stdio `{ command, args?, env?, cwd? }`，HTTP `{ url, headers? }`（`type: 'http'` 可选），公共 `{ enabled?, timeout?（秒，默认 60）, disabledTools? }`。全局配置存设置键 `mcp.servers`（带 revision，只能经 MCP 接口改）；项目配置读 `<Workspace>/.mcp.json`（claude-code 位置，已是受保护路径）。采纳。

**E1 @ 文件引用**：
➡️ composer 中 `@` 打开文件候选（模糊匹配，遵守 gitignore，目录带 /，最多 50 条）；选中插入原子 File Reference 节点，序列化为 `@path`（含空格时 `@"path"`）。提交时 server 解析 `@path` token：Workspace 内存在的文件按 read 工具的截断规则（2000 行 / 50KB）读入，目录给出 ls 式列表（最多 200 项），作为 `<file_reference path="…">` 文本块追加到同一条 user message；Read 拒绝规则命中、Workspace 外或二进制文件不附内容并附一行说明。单条消息最多 10 个、合计 200KB。用户显式引用视为对该文件的读取授权（拒绝规则仍生效）。采纳（DSH ui-reference + claude-code attachment）。

## 第 3 轮

**A/B/C 共用加载器**：
➡️ frontmatter 解析、目录扫描、mtime 缓存与诊断形状 `{ source, path, code, message }` 为 `instructions/` 下共用模块；文件访问经注入的只读文件端口（便于测试与以后的远程 Workspace）。采纳。

**B3 Skills 索引注入**：
➡️ system section `<available_skills>`，每项 name、description、SKILL.md 绝对路径；总预算 8000 字符（claude-code），超出时尾部只列名字并注明"另有 N 个"。被禁用或 `disable-model-invocation` 的不列。采纳。

**B4 调用**：
➡️ 模型经 `skill` 工具（`{ name, args? }`）调用：返回 SKILL.md 正文（去掉 frontmatter）、`Base directory for this skill: <dir>`、skill 目录下的文件清单（最多 50 项）与 args。用户以 `/<name> args` 显式调用：展开为 `<skill name location>…</skill>` + args 的 user message（pi）。自动匹配交给模型读索引（不做向量匹配）。采纳。

**B5 权限与资源访问**：
➡️ `skill` 工具 effect read，权限类 context-read（见 D7），规则名 `Skill`，内容为 skill 名（`Skill(pdf)` 可 deny / ask）。已发现的 skill 目录作为额外读取根：其下的 read / grep / find / ls 与 Workspace 内读取同样免审批；运行 scripts/ 仍走 bash 审批。采纳。

**B6 allowed-tools**：
➡️ 解析并在设置界面显示"声明的工具（不授予）"，不放行任何调用（ADR 0008）。采纳。

**C3 参数展开**：
➡️ 沿用 pi `parseCommandArgs`（bash 风格引号）与 `substituteArgs`：`$1`…、`$@`、`$ARGUMENTS`、`${N:-default}`、`${@:N[:L]}`，不递归；没有任何占位符且有参数时在末尾追加 `ARGUMENTS: <args>`（claude-code 兜底）。采纳。

**C4 内置动作**：
➡️ M3 只有 `/compact [指示]`（手动压缩）。动作命令不产生 user message；Run 进行中提交动作命令 409 `run-in-progress`。其余 claude-code 内置命令（/init、/memory 等）不做。采纳。

**C5 记录形状**：
➡️ 识别到命令时 server 先提交 `command { name, args, source }` 条目，再提交展开后的 user message（模型只看展开文本）；timeline 把 command 后的 user message 显示为命令 chip（可展开全文）。未识别的 `/xxx` 原样作为普通消息。追加指令（steer）同样展开模板与 Skill，动作命令在 steer 中 400。采纳。

**D2 项目 Server 批准**：
➡️ 批准保存在设置键 `mcp.approvals.<workspaceId>`：`{ [name]: sha256(规范化配置) }`。未批准为 pending（不启动），设置 MCP 分区显示完整 command / args / url / env 名 / headers 名后批准或拒绝；改动后摘要不同回到 pending。项目同名于全局时忽略项目项并诊断。项目项出现 `${…}` 时拒绝加载（ADR 0007）。采纳。

**D3 传输**：
➡️ stdio 与 streamable HTTP（pi-mcp 自带）；不做 SSE、WebSocket；HTTP 的 OAuth 不在 M3（401 显示 `auth-required`，提示用 headers 配置令牌）。采纳。

**D5 连接生命周期**：
➡️ Sidecar 内 `McpManager`，连接按 (Workspace, Server 名) 池化，同 Workspace 的 Session 共享（stdio 的 cwd 为 Workspace，缺省；配置 cwd 相对 Workspace）。该 Workspace 的第一个 Run 开始时并发连接，单个连接 30 秒超时，失败不阻止 Run（该 Server 的工具缺席，状态 failed 带最后 20 行 stderr，经 Secret 值脱敏）。`tools/list_changed` 时刷新。崩溃后指数退避自动重连至多 3 次，之后需手动重连。配置变更、禁用、批准撤销时关闭。Sidecar 有序关闭时在关闭存储之前关闭所有连接（pi-mcp：SIGTERM，2 秒后 SIGKILL）。Sidecar 被强杀时 stdio 子进程可能残留（stdin 关闭通常使其退出），并入 M4 孤儿进程 Carry-over。stdio 进程不套 Seatbelt。采纳。

**D6 工具适配与命名**：
➡️ 名称 `mcp__<server>__<tool>`，非 `[A-Za-z0-9_-]` 换成 `_`，超过 64 字符截断并加 8 位 hash（pi / claude-code）；描述与 inputSchema 原样传给模型，参数按 JSON Schema 校验（不支持的关键字放行），失败为参数错误。结果：`isError` → 错误 toolResult；`toLlmContent` 转换，文本按 50KB / 2000 行截断，图片按 pi 内容块透传，其他类型注明省略。幂等键经 `_meta.idempotencyKey` 传给 Server。超时按配置（秒，进度通知重置）。`disabledTools` 中的工具不注册。全部为 direct 暴露（不做 codemode / deferred）。采纳。

**D7 权限**：
➡️ 宿主在注册工具时给出权限类（工具声明不能自定，ADR 0005 "声明不能提升权限"）：

| 权限类 | 工具 | 模式放行 |
| --- | --- | --- |
| read | read、grep、find、ls | 各模式下 Workspace 与额外读取根内（不变） |
| edit | write、edit | 不变 |
| bash | bash | 不变 |
| context-read | skill、memory_list、list_mcp_resources、list_mcp_resource_templates、read_mcp_resource | 所有模式 |
| memory-write | memory_write、memory_delete | accept-edits、full-access |
| external | `mcp__*` 工具 | 仅 full-access |

规则名：MCP 工具按全名，另支持 `mcp__<server>` 匹配该 Server 全部工具；未连接的 Server 名也接受（不报 unknown-tool）。MCP 工具 effect 一律 side-effect（Server 的 readOnly 提示不可信）。拒绝 / 询问规则、判定顺序不变。采纳（是对 ADR 0005 模式表的扩展：宿主工具"按原名判定"的既有规则加上宿主给定的类，不改变已有四类的结果，不另写 ADR）。

**E2 Token 估算与显示**：
➡️ 估算 = 最后一次 assistant usage（input + cacheRead + cacheWrite + output）+ 其后消息 chars/4（pi `estimateContextTokens`）；没有 usage 时全量 chars/4。分项（system、instructions、skills 索引、memory、工具定义、消息）全部用 chars/4。每次 assistant 消息提交后发 `context_usage` progress；`GET …/context` 给出分项、阈值与已加载的指令文件。composer 底栏显示环形百分比（DSH），越过预警线为 warning 色、越过阈值为 destructive；点击打开 HoverCard 看分项与指令文件和诊断。采纳。

**E3 工具输出裁剪**：
➡️ 保留现有每工具截断。另加时间裁剪（claude-code 微压缩）：构造请求时若距最后一条 assistant 消息超过 60 分钟（缓存已冷），保留最近 5 个 toolResult，其余超过 2KB 的内容在模型上下文中替换为 `[Old tool result content cleared]`；条目不变。开关 `context.trimOldToolResults`（默认开）。采纳。

**E4 gitignore 对齐**（Carry-over）：
➡️ 内置 grep / find 与 @ 文件搜索对齐 rg：另读 `<repo>/.git/info/exclude` 与全局 excludes（`git config core.excludesFile` 的值；未设时 `$XDG_CONFIG_HOME/git/ignore` 或 `~/.config/git/ignore`），只解析 `~/.gitconfig` 与 `$XDG_CONFIG_HOME/git/config` 的 `[core] excludesFile`，不跟随 include；两种实现跑同一组契约用例（以临时 HOME）。采纳。

## 第 4 轮

**F2 切点**：
➡️ 从尾部累加估算 token 到 `keepRecentTokens` 20 000，切点只落在 user 消息或 assistant 消息开始处，不拆开 toolCall 与 toolResult；没有可摘要的较早内容时不压缩。采纳（pi）。

**F3 摘要结构**：
➡️ 合并两家：`## Goal` / `## Constraints & Preferences` / `## User Messages`（逐条、安全相关约束原文保留，不把 assistant 文本当用户的话）/ `## Files and Code` / `## Errors and Fixes` / `## Key Decisions` / `## Progress`（Done / In Progress / Blocked）/ `## Pending Tasks` / `## Current Work` / `## Next Step`（须与最近的明确请求一致）。不做 `<analysis>` 草稿。已有摘要时用增量更新提示（pi UPDATE）。用 Session 当前模型、无工具、maxTokens 20 000；`/compact <指示>` 的文本追加为额外要求。采纳。

**F4 记录与重建**：
➡️ 新 kind `compaction { summary, firstKeptSeq, tokensBefore, tokensAfter?, trigger: auto | manual | overflow, readFiles, modifiedFiles, instructions? }`。有效上下文 = 最后一个 compaction 的合成 user 消息（"This session is being continued from a previous conversation… 摘要 … 读过 / 改过的文件"）+ firstKeptSeq 及之后的有效条目（rewind 规则照常）。压缩后重新注入：指令与 Skills 索引本来就是每次请求的 system section；已调用过的 Skill 名列入摘要尾部（不重注正文，模型可再调用）；文件只列路径（pi），不重读内容。手动 `/compact` 是一个 Run（新 trigger `compact`），只产生 compaction 条目。采纳。

**F5 熔断与失败**：
➡️ 触发：每次模型请求前估算超过阈值；或请求以上下文溢出失败时压缩一次再重试一次（`overflow`）。一个 Session 连续 3 次自动压缩失败后停止自动压缩（运行时内存，重启或一次成功的手动压缩后复位），界面提示"自动压缩已暂停"并给 /compact 入口。自动压缩失败不终止 Run（溢出路径除外：以原模型错误结束）。开关 `context.autoCompact`（默认开）。progress `compaction_start` / `compaction_end` / `compaction_failed`。采纳。

**F6 与回退、分叉**：
➡️ compaction 条目是普通 Session Entry：回退到它之前时它落在被跳过的区间，原历史重新生效；分叉复制有效条目时包含最后一个 compaction 及其后的条目（不复制被摘要替代的条目）。timeline 把 compaction 显示为分隔条"已压缩上下文 · 约节省 N tokens"，可展开看摘要；之前的消息仍可查看。采纳。

**G2 Memory 工具**：
➡️ `memory_list { scope? }`（read，context-read）、`memory_write { content, scope: user | workspace, id? }`（新建或替换，memory-write）、`memory_delete { id }`（memory-write）。规则组名 `Memory`。工具卡显示"已记住 / 已更新 / 已删除记忆"。采纳。

**G3 Memory 注入**：
➡️ system section `<memory>`：用户级与当前 Workspace 的条目，按 updatedAt 倒序，合计 12 000 字符，超出注明"另有 N 条，用 memory_list 查看"；每条带 id。每个 Run 开始时读取。开关 `memory.enabled`（关闭时不注入、不注册工具）。采纳。

**G4 Memory 设置页**：
➡️ 设置新增 Memory 分区：用户级与当前 Workspace 两组，查看、删除、手动添加与编辑（source user）。秘密不外泄总闸覆盖 memories 表（库扫描已含）。采纳。

**H3 校验与诊断**：
➡️ 配置 schema 在 agent `config/`（TypeBox）。全局能力开关存设置键 `config`（revision，只能经 `/api/config` 改）；项目 `.coko/settings.json` 每次 Run 开始与 `GET /api/config?workspaceId` 时读取。未知键警告诊断；不合 schema 的值忽略并诊断；JSON 解析失败整个文件忽略并诊断。有效值 = 默认 ← 全局 ← 项目（只收紧，ADR 0008）。项目 deny / ask 规则作为 `project` 作用域参与判定（只读，设置 Permissions 分区显示来源）。采纳。

**I1 typeahead**：
➡️ packages/ui 新增 `ComposerTypeahead`（基于 `@lexical/react` 的 `LexicalTypeaheadMenuPlugin`，已安装），菜单材质沿用 dropdown-menu；`/` 只在草稿开头触发，`@` 在词首触发；焦点留在编辑器，↑↓ 移动、Enter / Tab 确认、Esc 关闭且不改草稿、关闭后同一 token 不再弹出、输入法组合期间不触发。命令候选分组显示来源（内置 / 项目 / 用户 / Skill / MCP）与 argument-hint；选中插入 `/name ` 文本（不做 chip）。采纳（DSH ui-input-trigger）。

**I3 设置分区**：
➡️ 新增 Skills & Commands（列出 Skill 与命令：来源、路径、启停、声明的工具、诊断；"在 Finder 中显示"不做）、MCP（全局与当前 Workspace 的 Server、状态、工具数、启停、增改删、项目 Server 批准、重连、Secrets 子区）、Memory。General 增加"项目设置"一行（路径与诊断数，展开看诊断）。启停状态存设置键：`skills.disabled`（名字列表）、`commands.disabled`。采纳（地图 IA 决定 + Memory 分区为新增）。

**I4 压缩提示**：
➡️ 压缩进行中 composer 上方状态行"正在压缩上下文…"（可停止，停止不提交条目）；完成后 timeline 分隔条；失败 Toast 一次，熔断后上下文环旁显示暂停标记。采纳。

## 第 5 轮（交付）

**J1 Carry-overs**：
➡️ 草稿 EditorState 持久化 → 票 06（不装 @lexical/markdown，见 I2）；rg 与内置 grep 的 gitignore 差异 → 票 10；Secrets 改按来源隔离 → 票 07 与 ADR 0007；S2 条目派生收敛、S3 SessionService 拆分 → 票 01。S2 的落点：派生函数集中在 agent 的浏览器安全子路径 `@coko/agent/entries`（纯函数，只依赖 typebox 类型，有守卫测试确保不导入 node:*），server 与 renderer 都从它导入；architecture.md 的 renderer 依赖行增加这一子路径。采纳（agent 拥有 Session Entry 语义，ADR 0006；可逆，不写 ADR）。

**J2 切片与写范围**：
➡️ 11 张票。票 01 是基础票：拆 SessionService、收敛派生、迁移 v3（memories、secrets 两表与仓库）、预先声明 M3 全部条目 kind / progress / RunTrigger、预建各领域的空文件与 barrel（protocol、agent、server 路由与 context 装配、i18n 字典分域、设置分区注册表）、运行时 seam（system sections、输入展开、上下文变换、请求前钩子）、权限类与额外读取根、secrets-gate 拆分为共享 harness + 按通道文件。之后各票只改自己领域的文件。并行窗口：{03, 04, 07, 09}、{05, 06, 08}、{08, 10}。共享装配点的唯一所有者见 spec。采纳。

**J3 测试接口**：
➡️ 沿用 M2：Sidecar 协议集成测试为主（临时 `COKO_HOME` 与 Workspace 夹具文件）；agent 纯函数（加载器、展开、切点、预算）表驱动；MCP 用仓库内的测试 Server（stdio：node 脚本实现最小 JSON-RPC；HTTP：node:http 实现 streamable HTTP）；Electron E2E 覆盖 typeahead、设置分区、上下文环与压缩分隔条；Browser Mode 覆盖 typeahead 键盘。faux 模型脚本验证 system sections 与请求上下文（requestLog）。秘密总闸新增 MCP Secret（不匹配剔除模式的名字）与 Memory 通道。采纳。

**依赖**：新增 `@earendil-works/pi-mcp` 1.4.0（agent，已选型）、`yaml` 2.9.0（agent，新增选型，与 pi 同版本）；Lexical typeahead 与 HoverCard（radix-ui 已装）不新增依赖；不装 @lexical/markdown。票 04、07 负责登记 TECH_STACK。

**领域术语**：新增 Instruction File、Skill、Command、MCP Server、Secret、Memory Entry、File Reference、Compaction、Project Settings，已写入 [GLOSSARY](../../GLOSSARY.md)。

**ADR**：满足三条标准的为 [0007](../../docs/adr/0007-secrets-from-registered-entries.md)（Secret 来源）、[0008](../../docs/adr/0008-project-files-only-tighten.md)（项目文件只收紧）、[0009](../../docs/adr/0009-user-authored-resources-as-files.md)（用户资源为文件）。压缩参数、权限类扩展、派生函数位置、草稿存 localStorage 均可逆或沿用已有决定，不写。

frontier 已空。
