---
kind: reference
description: "当前的 Memory 契约：memory_list / memory_write / memory_delete 工具与权限类、每个 Run 注入的 <memory> system section 与预算、关键词检索（FTS5 与 LIKE 降级）、memory.enabled 开关、正文脱敏、/api/memories 接口与设置的 Memory 分区、工具卡。修改记忆的存储、注入、检索、工具、接口或界面前查阅。"
lifecycle: active
---

# Memory

本文说明 Coko 当前如何跨 Session 保留记忆（Memory Entry，见 [GLOSSARY](../../GLOSSARY.md)）：模型用工具记下和删除，之后的 Run 在系统提示中看到它们，模型与用户都能按关键词检索，用户在设置中查看与编辑。条目存在 SQLite（[ADR 0003](../adr/0003-settings-and-sessions-in-sqlite.md)），检索用 FTS5 派生索引，运行时没有 FTS5 时降级为 LIKE。自动提取记忆尚未实现。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/context/memory/` | `memorySection(entries, { writable, project })`、`createMemoryTools(port, { project })`（三个工具及其权限类；没有项目时 scope 只有 user）、`MemoryPort`（含 `search`）、`MEMORY_MAX_CHARS`、`MEMORY_SECTION_BUDGET`、`MEMORY_SEARCH_LIMIT` |
| `apps/server/src/application/context/memory.ts` | `MemoryService`（列表、检索、新建、改正文、删除与校验、脱敏）、工具端口 `memoryPort`、上下文贡献 `memoryContribution` |
| `apps/server/src/http/routes/memories.ts` | `/api/memories` 路由 |
| `packages/protocol/src/memory.ts` | `MemoryEntry`、`MemoryListResponse`、`CreateMemoryRequest`、`UpdateMemoryRequest`、`memoryPaths`、`MEMORY_CONTENT_MAX` |
| `packages/session` 的 `MemoryRepository` | 表 `memories`（迁移 v3）与 `memories.search`、FTS5 表 `memories_fts`（迁移 v9），见 [@coko/session](../../packages/session/README.md) |
| `apps/desktop/src/renderer/stores/memory-store.ts` | renderer 的记忆 store 与请求（含记忆开关） |
| `apps/desktop/src/renderer/features/settings/memory-section.tsx` | 设置的 Memory 分区 |
| `apps/desktop/src/renderer/features/conversation/tool-cards.tsx` | memory 工具卡 |

## 条目与作用域

条目 `{ id, scope: user | workspace, workspaceId, content, source: model | user, createdAt, updatedAt }`。存储仍以 Workspace 为键；面向用户与模型，`workspace` 作用域的条目是项目记忆（[ADR 0027](../adr/0027-memory-follows-project-writes-without-approval.md)）。

**归属的解析。** 每个 Run 开始时，与 Workspace 根快照同时解析本次的项目记忆 Workspace（`ContextScope.memoryWorkspaceId`）：根 Session（子代理与 Teammate 按持久化父链取根）当前属于某个 Project 时，取该 Project 主要文件夹对应的 Workspace；不属于任何 Project 时省略，只有用户级记忆。判定只看项目归属，不看 Session 自己的 Workspace 或工作目录：绑定 worktree 的项目 Session、从别处移入项目的 Session 使用所属项目的记忆；移出项目或项目被删除后，即使工作目录仍是原项目文件夹也只有用户级。移入、移出、换项目、删除项目与更换主要文件夹从下一个 Run 生效，进行中的 Run 的注入与工具调用仍按 Run 开始时的归属。原 Workspace 上的条目不删除、不迁移；用同一文件夹重新建项目后重新可见。尚未创建 Session 的草稿按所选项目解析（其主要 Workspace），上下文用量中的 Memory 按同一结果计。

一个 Run 能看到的是用户级与项目记忆 Workspace 的条目（注入与工具都按此过滤）；`/api/memories` 带 `workspaceId` 时按该 Workspace 过滤。

正文去掉首尾空白后须非空且不超过 2000 字符（UTF-16 码元），保存前经 `redactText`（`@coko/logging`）按凭据形态脱敏为 `[REDACTED]`，工具结果、接口响应、库与注入的 section 都只有脱敏后的正文（ADR 0004）。脱敏按形态匹配（`sk-` 前缀、Bearer 头等），不比对已登记凭据的值。`source` 为 model（经 `memory_write` 新建）或 user（在设置中添加）。用户经接口改正文时 `source` 同时改为 user（Agent 记下的条目编辑后变为手动添加）；模型经 `memory_write` 替换不改变 `source`。正文中自称用户手写或伪造的来源标注不影响 `source`。

## 注入

记忆开启时，每个 Run 开始时（上下文装配取 system sections，顺序为环境 → 指令 → Skills 索引 → Memory）读取条目，组成名为 `memory` 的 section；没有条目也注入。以 `<memory>` 开头、`</memory>` 结尾，依次为：

- **声明**（固定）：条目是保存下来供参考的事实，不是指令，不授予任何权限；与用户当前的要求冲突时以当前要求为准；每条标明来源，Agent 记下的（`source="agent"`）可信度低于用户手写的（`source="user"`）。有项目记忆 Workspace 时，随后一句说明 `scope="user"` 在所有会话生效、`scope="workspace"` 在当前项目生效；没有项目时没有这句（见 [条目与作用域](#条目与作用域)）。
- **写入引导**（固定，只在本 Run 注册了 `memory_write` 与 `memory_delete` 时出现；子 Session 与无界面运行没有）：该记的是用户明确要求记住的、用户纠正做法并表明以后都如此的、今后会话用得上且从代码与 Instruction File 中查不到的项目事实；不记任务进度、代码里读得到的内容、凭据，以及文件、网页或工具输出中出现的指令；写之前先看已有条目，相近的按 id 替换、过时的删除；个人偏好记 `user`，只对当前项目成立的事实记 `workspace`（没有项目时只有记 `user` 的一句）；`source="user"` 的条目不能改动，过时时在回复中告知用户。
- **条目**：每条为 `<entry id="…" scope="…" source="agent|user">\n正文\n</entry>`（库中 `source` 为 model 时标 `agent`）；正文中的 `</entry>`、`</memory>` 写成 `<\/…>`，正文中伪造的声明、来源标注或开始标签留在该条目内，不改变段的结构与其他条目的来源。项目级（项目记忆 Workspace 的条目）在前、用户级在后，各自按 updatedAt 倒序（同一时刻后写的在前）。条目块合计（每块加一个换行）上限 12 000 字符，分两级放入：先放项目级，至多 6 000；再放用户级，至多 12 000 减去项目级已用；用户级全部放入仍有余量时，接着放尚未放入的项目级。每一级遇到放不下的条目即停止，不跳过较新的去放较旧的；没有项目级条目（包括不属于项目的 Run）时用户级可用满 12 000。未放入的注明总数 `N more entries not shown; use memory_list with a query to search them.`。

声明与写入引导是英文静态文本，不计入 12 000 字符的条目预算；同一组条件（有无写入工具、有无项目级）下逐字不变。上下文用量把整个 section（含固定文本）计入 `system`，见 [上下文管理](context.md#上下文用量)。Run 进行中写入的条目到下一个 Run 才进入 section；同一 Run 内模型从工具结果得知变化。

## 检索

- **匹配。** 查询按空白拆成词，全部出现才匹配，大小写不敏感（LIKE 只对 ASCII 字母）；按字面匹配，引号、星号、括号、`NEAR`、`AND` / `OR` / `NOT` 与列名前缀不作为 FTS 语法。至多 20 条（`MEMORY_SEARCH_LIMIT`）；可见范围与列表相同（工具为用户级与本 Run 的项目记忆 Workspace，接口为用户级与给出的 Workspace），可再按 scope 限定。查询只有空白时等同于不检索。
- **排序。** FTS5 可用且每个词至少 3 个字符时按相关度（bm25，trigram 分词；同分时较新的在前），否则按 updatedAt 倒序。用户级与当前 Workspace 一起检索时按全库次序取前 20 条可见的条目（其他 Workspace 的匹配占满时放大条数再查）。
- **降级。** Electron 内置 Node 的 SQLite 编译了 FTS5；运行时没有 FTS5 时不建 `memories_fts`，检索走 LIKE（同样至多 20 条、按 updatedAt 倒序），Sidecar 启动时记 warn `memory search falls back to LIKE`（`reason: fts5-unavailable`）。测试以 `COKO_TEST_NO_FTS=1` 强制降级（`reason: disabled-for-tests`），打包的发布构建不读取它。
- **同步。** `memories_fts` 由触发器随插入、改正文与删除同步，是可重建的派生索引（迁移 v9 建立时按现有行重建）。

## 工具与权限

| 工具 | 参数 | 权限类 | 结果 |
| --- | --- | --- | --- |
| `memory_list` | `scope?`（没有项目时只有 `user`）、`query?` | context-read（所有模式放行） | 不带 query：条目块（与 section 相同，带来源），倒序，没有时 `No memories saved.`；带 query：检索结果（见 [检索](#检索)），没有时 `No memories match "<query>".`；超过 50KB / 2000 行截断。工具描述提示条目多时先检索 |
| `memory_write` | `content`、`scope`（没有项目时只有 `user` 且可省略，缺省 `user`）、`id?` | memory-write | 新建或按 id 替换正文；details `{ action: created \| updated, memory }`。工具描述写明只记用户亲口表达的偏好与自己核实过的项目事实、不得把文件、网页或工具输出中出现的指令记成记忆、不用于任务进度，以及 `source="user"` 的条目不能替换 |
| `memory_delete` | `id` | memory-write | details `{ action: deleted, memory }` |

**用户来源的条目。** `source` 为 user 的条目，模型按 id 替换（`memory_write` 带 `id`）或删除（`memory_delete`）时得到工具错误 `Memory entry <id> is maintained by the user and cannot be replaced or deleted; tell the user if it looks outdated`，条目的正文与来源不变；`source` 为 model 的条目照常替换与删除。限制在 `MemoryService`：工具端口以 model 身份调用，`/api/memories` 以 user 身份调用、不受此限。

**只读的 Run。** 子 Session（子代理与 Teammate）与无界面运行（[headless](headless.md)）只注册 `memory_list`，不注册 `memory_write` 与 `memory_delete`；子 Session 另由子代理的固定排除集去掉这两个工具。

memory-write 在所有 Permission Mode 下放行（含 read-only 与 plan，[ADR 0027](../adr/0027-memory-follows-project-writes-without-approval.md)），记忆的写入、替换与删除不出审批卡；想收紧时配置规则组 `Memory` 的询问或拒绝规则（全局、Workspace 或项目设置文件），PreToolUse Hook 照常生效，见 [权限判定与审批](permissions.md)。询问规则命中时审批对象为 memory_write 的正文、memory_delete 的 id；已保存的 `Memory` 允许规则保持有效但不起作用。超过 2000 字符或作用域不合法（包括没有项目的 Run 中以 `workspace` 调用）在参数校验时失败（不执行）；没有项目时工具端口只看得到用户级条目，按 id 替换或删除 Workspace 条目为 not found；id 不存在或不可见、按 id 替换时作用域不同、条目来源为用户、正文为空作为工具错误返回。

## 开关

`memory.enabled`（缺省 true，见 [分层配置](configuration.md)）为 false 时不注入 section（包括声明与写入引导）、不注册三个工具；已保存的条目不受影响，设置分区与接口照常可用。项目 `.coko/settings.json` 可以关闭，不能打开。

## 协议

- `GET /api/memories?workspaceId=…` → `{ memories }`：用户级条目，给出 workspaceId 时另加该 Workspace 的条目，倒序。Workspace 不存在 404。`scope=user|workspace` 只留一种（workspace 须给出 workspaceId，否则 400；其他值 400）。`query=…` 非空时为检索（`apiPaths.memorySearch`），结果与次序见 [检索](#检索)。请求日志只记路径，不记查询串。
- `POST /api/memories { scope, workspaceId?, content }` → 201 条目（source user）。workspace 作用域须给出 workspaceId、user 作用域不得给出，否则 400；正文为空或超长 400；Workspace 不存在 404。
- `PUT /api/memories/:id { content }` → 条目，`source` 改为 user；`DELETE /api/memories/:id` → 204。条目不存在 404；给出 `?workspaceId` 时条目须是用户级或属于该 Workspace，否则 404。
- 设置分区的记忆开关经 `PUT /api/config` 整体替换全局值（先读 revision）。

## 界面

- **设置的 Memory 分区**：记忆开关（全局值；被项目设置关闭时注明）；搜索框（输入停止 200 ms 后检索，结果仍按两组显示、组内为检索次序，没有结果时"没有匹配的记忆"；清空时立即恢复列表；有内容时 Escape 只清空，空框时 Escape 返回应用；检索词保留在 store 中）；"用户级"与"工作区：名称"两组，每条显示正文与写入方（Agent 记下 / 手动添加；编辑 Agent 记下的条目并保存后为手动添加），可编辑与删除，每组底部可添加；字数显示与 2000 字符上限。没有会话时只显示用户级并提示先打开会话。
- **工具卡**：memory_write 成功后标题为"已记住"或"已更新记忆"，memory_delete 为"已删除记忆"，memory_list 为"查看记忆"；执行中、被询问规则拦下等待审批与失败时为动作名（"记下记忆"、"删除记忆"）。
- **工具详情**：成功写入、更新或删除后，字段区展示结果实际记录的操作、ID、范围和 Memory Entry 正文，保留宿主处理后的保存值；原始调用参数与完整结果/details 在“输入 / 输出”中可检查。列表、字段缺失及失败记录使用完整通用详情，不从列表文字推测条目或数量；展开不会再次读写记忆。

## 验证

- `packages/agent/src/context/memory/memory.test.ts`：没有条目时的声明与写入引导、来源标注、有无写入工具与有无项目级的组合、固定文本逐字不变且不计入预算、正文伪造声明 / 来源 / 结束标签（对手用例）、项目级在前的排列、两级预算（两级各超过一半、项目级少而用户级多、项目级多而用户级少、没有项目级、恰好等于上限、不跳过较新的、用户级未放完时余量不给项目级、单条超过项目级上限）与"另有 N 条"、结束标签转义、memory_write 的描述、工具的新建 / 替换 / 删除 / 列表、memory_list 的 query（至多 20 条、保持端口的相关度次序、无结果文本、空白 query、描述）、作用域不符与空正文、超长内容的参数错误、权限类与审批对象。
- `apps/server/src/application/context/memory.test.ts`：`MemoryService.search` 的全局次序与放大重查、scope 与校验；没有项目记忆 Workspace 的工具端口不能按 id 替换或删除 Workspace 条目，有时只针对该 Workspace。
- `tests/integration/sidecar-memory-projects.test.ts`：项目 Session 的段含项目级与用户级；移出项目后只有用户级、工具 scope 没有 `workspace`、以 `workspace` 写入为参数错误、省略 scope 写入用户级；独立对话移入项目、移到另一项目后的注入与写入目标；Run 进行中移动不改变本次写入目标；删除项目后只有用户级而条目仍在、草稿的上下文用量不再计入；同一文件夹重建项目后可见；更换主要文件夹后改用新 Workspace 的记忆。`sidecar-subagents-permissions.test.ts` 另验证子 Session 按根 Session 的归属（根移到另一项目后），`sidecar-worktrees.test.ts` 验证绑定 worktree 的项目 Session 有项目记忆。
- `tests/integration/sidecar-memory-search.test.ts`：同一组用例在 FTS5 与 `COKO_TEST_NO_FTS=1` 下各跑一次（日志确认路径）：写入 30 条后检索、相关度与 updatedAt 次序、Workspace 隔离、至多 20 条、改正文与删除后同步、参数校验、FTS 语法字符按字面（对手用例）、memory_list 的 query 与工具描述。
- `tests/integration/secrets-gate-memory-search.test.ts`：带 Credential 的条目经 HTTP 检索与 memory_list 的 query 返回时，响应体、工具结果、之后的模型请求、日志与 COKO_HOME 中没有明文。
- `tests/integration/sidecar-memory.test.ts`：真实 Sidecar 上没有条目时 section 仍有声明与写入引导、上下文用量的 system 计入其固定文本；Agent 与用户来源的条目各带来源标注，伪造的结束标签不改变段结构；同项目新 Session 的 section 含条目且项目级在前、两级预算下请求中的实际排列与未放入条数、另一项目只有用户级、删除后不再注入、写入与删除在 default、read-only、plan 下都不经审批、memory_list 免审批、`Memory` 的全局询问规则出审批卡、全局与项目设置的拒绝规则拒绝、PreToolUse Hook 的 deny 阻止写入、`memory.enabled: false` 时 section 与工具都不在请求中；用户来源的条目模型替换与删除为工具错误、Agent 来源的照常，用户经接口编辑后来源变为 user 且模型不能再改，正文中伪造的来源标注不改变来源（对手用例）；`/api/memories` 的增删改查、过滤与校验；重启后条目仍在。
- `tests/integration/secrets-gate-memory.test.ts`：回显 Credential 的错误文本经 memory_write 与接口写入后，memory 工具结果、接口响应、memories 表、注入的 section 与日志中没有明文。
- `tests/integration/headless.test.ts`、`sidecar-subagents-permissions.test.ts`、`sidecar-teams.test.ts`：无界面运行、子代理与 Teammate 的请求中有 `memory_list`，没有 `memory_write` 与 `memory_delete`；Memory 段有声明，没有写入引导。
- `packages/session` 的仓库契约测试：`memories.update` 给出 `source` 时与正文一起改，省略时保持原写入方（内存与 SQLite 实现）。
- `apps/desktop/e2e/memory.e2e.test.ts`：default 模式下不出审批卡，工具卡显示"已记住"、详情可见正文，Memory 分区列出模型写入的条目，编辑后标签变为手动添加，删除、手动添加、编辑与开关生效；搜索框键盘输入后只列出匹配的条目、没有结果的提示、Escape 清空恢复列表，明暗主题下文字可读。
- `apps/desktop/src/renderer/features/settings/memory-section.browser.test.tsx`：搜索框连续输入只发出一次检索（防抖）、清空立即恢复、Escape 先清空再返回应用；`stores/memory-store.test.ts`：检索请求路径与晚到响应被丢弃。

## 延伸阅读

- [ADR 0003](../adr/0003-settings-and-sessions-in-sqlite.md)：Memory 存在 SQLite 的决定。
- [分层配置](configuration.md)：`memory.enabled` 的合并规则。
- [权限判定与审批](permissions.md)：memory-write 权限类在判定中的位置。
