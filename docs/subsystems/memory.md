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
| `packages/agent/src/context/memory/` | `memorySection(entries)`、`createMemoryTools(port)`（三个工具及其权限类）、`MemoryPort`（含 `search`）、`MEMORY_MAX_CHARS`、`MEMORY_SECTION_BUDGET`、`MEMORY_SEARCH_LIMIT` |
| `apps/server/src/application/context/memory.ts` | `MemoryService`（列表、检索、新建、改正文、删除与校验、脱敏）、工具端口 `memoryPort`、上下文贡献 `memoryContribution` |
| `apps/server/src/http/routes/memories.ts` | `/api/memories` 路由 |
| `packages/protocol/src/memory.ts` | `MemoryEntry`、`MemoryListResponse`、`CreateMemoryRequest`、`UpdateMemoryRequest`、`memoryPaths`、`MEMORY_CONTENT_MAX` |
| `packages/session` 的 `MemoryRepository` | 表 `memories`（迁移 v3）与 `memories.search`、FTS5 表 `memories_fts`（迁移 v9），见 [@coko/session](../../packages/session/README.md) |
| `apps/desktop/src/renderer/stores/memory-store.ts` | renderer 的记忆 store 与请求（含记忆开关） |
| `apps/desktop/src/renderer/features/settings/memory-section.tsx` | 设置的 Memory 分区 |
| `apps/desktop/src/renderer/features/conversation/tool-cards.tsx` | memory 工具卡 |

## 条目与作用域

条目 `{ id, scope: user | workspace, workspaceId, content, source: model | user, createdAt, updatedAt }`。用户级条目在所有 Workspace 生效，Workspace 条目只在其 Workspace 生效。一个 Session 能看到的是用户级与其所在 Workspace 的条目（注入、工具与带 `workspaceId` 的接口都按此过滤）。

正文去掉首尾空白后须非空且不超过 2000 字符（UTF-16 码元），保存前经 `redactText`（`@coko/logging`）按凭据形态脱敏为 `[REDACTED]`，工具结果、接口响应、库与注入的 section 都只有脱敏后的正文（ADR 0004）。脱敏按形态匹配（`sk-` 前缀、Bearer 头等），不比对已登记凭据的值。编辑只改正文，`source` 保持原写入方。

## 注入

每个 Run 开始时（上下文装配取 system sections，顺序为指令 → Skills 索引 → Memory）读取条目，组成名为 `memory` 的 section：

- 以 `<memory>` 开头、`</memory>` 结尾，首行说明作用域与维护方式，每条为 `<entry id="…" scope="…">\n正文\n</entry>`；正文中的 `</entry>`、`</memory>` 写成 `<\/…>`。
- 按 updatedAt 倒序（同一时刻后写的在前）逐条加入；条目块合计（每块加一个换行）超过 12 000 字符时停止，其余注明 `N more entries not shown; use memory_list with a query to search them.`。
- 没有条目时不注入。Run 进行中写入的条目到下一个 Run 才进入 section；同一 Run 内模型从工具结果得知变化。

## 检索

- **匹配。** 查询按空白拆成词，全部出现才匹配，大小写不敏感（LIKE 只对 ASCII 字母）；按字面匹配，引号、星号、括号、`NEAR`、`AND` / `OR` / `NOT` 与列名前缀不作为 FTS 语法。至多 20 条（`MEMORY_SEARCH_LIMIT`）；可见范围与列表相同（用户级与当前 Workspace），可再按 scope 限定。查询只有空白时等同于不检索。
- **排序。** FTS5 可用且每个词至少 3 个字符时按相关度（bm25，trigram 分词；同分时较新的在前），否则按 updatedAt 倒序。用户级与当前 Workspace 一起检索时按全库次序取前 20 条可见的条目（其他 Workspace 的匹配占满时放大条数再查）。
- **降级。** Electron 内置 Node 的 SQLite 编译了 FTS5；运行时没有 FTS5 时不建 `memories_fts`，检索走 LIKE（同样至多 20 条、按 updatedAt 倒序），Sidecar 启动时记 warn `memory search falls back to LIKE`（`reason: fts5-unavailable`）。测试以 `COKO_TEST_NO_FTS=1` 强制降级（`reason: disabled-for-tests`），打包的发布构建不读取它。
- **同步。** `memories_fts` 由触发器随插入、改正文与删除同步，是可重建的派生索引（迁移 v9 建立时按现有行重建）。

## 工具与权限

| 工具 | 参数 | 权限类 | 结果 |
| --- | --- | --- | --- |
| `memory_list` | `scope?`、`query?` | context-read（所有模式放行） | 不带 query：条目块，倒序，没有时 `No memories saved.`；带 query：检索结果（见 [检索](#检索)），没有时 `No memories match "<query>".`；超过 50KB / 2000 行截断。工具描述提示条目多时先检索 |
| `memory_write` | `content`、`scope`、`id?` | memory-write | 新建或按 id 替换正文；details `{ action: created \| updated, memory }` |
| `memory_delete` | `id` | memory-write | details `{ action: deleted, memory }` |

memory-write 在 accept-edits 与 full-access 放行，default 与 read-only 询问；规则组名 `Memory`（例如 `Memory` 的 allow 或 deny 规则），见 [权限判定与审批](permissions.md)。审批对象为 memory_write 的正文、memory_delete 的 id。超过 2000 字符或作用域不合法在参数校验时失败（不执行）；id 不存在或不可见、按 id 替换时作用域不同、正文为空作为工具错误返回。

## 开关

`memory.enabled`（缺省 true，见 [分层配置](configuration.md)）为 false 时不注入、不注册三个工具；已保存的条目不受影响，设置分区与接口照常可用。项目 `.coko/settings.json` 可以关闭，不能打开。

## 协议

- `GET /api/memories?workspaceId=…` → `{ memories }`：用户级条目，给出 workspaceId 时另加该 Workspace 的条目，倒序。Workspace 不存在 404。`scope=user|workspace` 只留一种（workspace 须给出 workspaceId，否则 400；其他值 400）。`query=…` 非空时为检索（`apiPaths.memorySearch`），结果与次序见 [检索](#检索)。请求日志只记路径，不记查询串。
- `POST /api/memories { scope, workspaceId?, content }` → 201 条目（source user）。workspace 作用域须给出 workspaceId、user 作用域不得给出，否则 400；正文为空或超长 400；Workspace 不存在 404。
- `PUT /api/memories/:id { content }` → 条目；`DELETE /api/memories/:id` → 204。条目不存在 404；给出 `?workspaceId` 时条目须是用户级或属于该 Workspace，否则 404。
- 设置分区的记忆开关经 `PUT /api/config` 整体替换全局值（先读 revision）。

## 界面

- **设置的 Memory 分区**：记忆开关（全局值；被项目设置关闭时注明）；搜索框（输入停止 200 ms 后检索，结果仍按两组显示、组内为检索次序，没有结果时"没有匹配的记忆"；清空时立即恢复列表；有内容时 Escape 只清空，空框时 Escape 返回应用；检索词保留在 store 中）；"用户级"与"工作区：名称"两组，每条显示正文与写入方（Agent 记下 / 手动添加），可编辑与删除，每组底部可添加；字数显示与 2000 字符上限。没有会话时只显示用户级并提示先打开会话。
- **工具卡**：memory_write 成功后标题为"已记住"或"已更新记忆"，memory_delete 为"已删除记忆"，memory_list 为"查看记忆"；等待审批与失败时为动作名（"记下记忆"、"删除记忆"）。
- **工具详情**：成功写入、更新或删除后，字段区展示结果实际记录的操作、ID、范围和 Memory Entry 正文，保留宿主处理后的保存值；原始调用参数与完整结果/details 在“输入 / 输出”中可检查。列表、字段缺失及失败记录使用完整通用详情，不从列表文字推测条目或数量；展开不会再次读写记忆。

## 验证

- `packages/agent/src/context/memory/memory.test.ts`：注入顺序、预算截断与"另有 N 条"、结束标签转义、工具的新建 / 替换 / 删除 / 列表、memory_list 的 query（至多 20 条、保持端口的相关度次序、无结果文本、空白 query、描述）、作用域不符与空正文、超长内容的参数错误、权限类与审批对象。
- `apps/server/src/application/context/memory.test.ts`：`MemoryService.search` 的全局次序与放大重查、scope 与校验。
- `tests/integration/sidecar-memory-search.test.ts`：同一组用例在 FTS5 与 `COKO_TEST_NO_FTS=1` 下各跑一次（日志确认路径）：写入 30 条后检索、相关度与 updatedAt 次序、Workspace 隔离、至多 20 条、改正文与删除后同步、参数校验、FTS 语法字符按字面（对手用例）、memory_list 的 query 与工具描述。
- `tests/integration/secrets-gate-memory-search.test.ts`：带 Credential 的条目经 HTTP 检索与 memory_list 的 query 返回时，响应体、工具结果、之后的模型请求、日志与 COKO_HOME 中没有明文。
- `tests/integration/sidecar-memory.test.ts`：真实 Sidecar 上同 Workspace 新 Session 的 section 含条目、另一 Workspace 只有用户级、删除后不再注入、default 写入审批与 accept-edits 免审批、memory_list 免审批、`memory.enabled: false` 时 section 与工具都不在请求中；`/api/memories` 的增删改查、过滤与校验；重启后条目仍在。
- `tests/integration/secrets-gate-memory.test.ts`：回显 Credential 的错误文本经 memory_write 与接口写入后，memory 工具结果、接口响应、memories 表、注入的 section 与日志中没有明文。
- `apps/desktop/e2e/memory.e2e.test.ts`：审批后工具卡显示"已记住"，Memory 分区列出模型写入的条目，删除、手动添加、编辑与开关生效；搜索框键盘输入后只列出匹配的条目、没有结果的提示、Escape 清空恢复列表，明暗主题下文字可读。
- `apps/desktop/src/renderer/features/settings/memory-section.browser.test.tsx`：搜索框连续输入只发出一次检索（防抖）、清空立即恢复、Escape 先清空再返回应用；`stores/memory-store.test.ts`：检索请求路径与晚到响应被丢弃。

## 延伸阅读

- [ADR 0003](../adr/0003-settings-and-sessions-in-sqlite.md)：Memory 存在 SQLite 的决定。
- [分层配置](configuration.md)：`memory.enabled` 的合并规则。
- [权限判定与审批](permissions.md)：memory-write 权限类在判定中的位置。
