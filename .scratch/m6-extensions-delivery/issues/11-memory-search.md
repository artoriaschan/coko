# 11: Memory 检索：memory_list 的 query、/api/memories?query=、设置搜索框

**What to build:** 见 [规格](../spec.md)"Memory 检索"：`memory_list { scope?, query? }` 经 03 的 `memories.search`；`<memory>` 截断提示；`GET /api/memories?query=`；设置 → Memory 分区的搜索框；FTS 不可用时的降级；ADR 0003 改 implemented。

**User stories:** 17

**Blocked by:** 03

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/context/memory/`、`packages/protocol/src/memory.ts`、`apps/server/src/application/context/memory.ts`、`http/routes/memories.ts`、`runtime/layers.ts` 的 memory 块（如需）、`packages/i18n/src/dictionaries/domains/memory.ts`、renderer `features/settings/memory-section.tsx`、`stores/memory-store.ts`、就近测试、`tests/integration/sidecar-memory-search.test.ts`（新）、`apps/desktop/e2e/memory.e2e.test.ts`（追加用例）、`docs/subsystems/memory.md`、`docs/adr/0003-settings-and-sessions-in-sqlite.md`、`packages/session/README.md`（一句）

**跨票接口：** 使用 03 的 `memories.search(query, { scope, workspaceId?, limit })`，不改其签名。

- [x] agent：`memory_list` 带 query 时至多 20 条、无结果文本、工具描述与截断提示
- [x] 集成：写入 30 条后按关键词检索得到相关条目（FTS，按相关度）；Workspace 作用域隔离；`COKO_TEST_NO_FTS=1` 时 LIKE 降级结果相同（同一组用例参数化）；更新与删除后检索结果同步
- [x] **对手用例**：query 为 FTS 语法字符（`"`、`*`、`NEAR`、`)`）时不报错、按字面匹配（先红）
- [x] E2E：Memory 分区搜索框过滤列表、清空恢复；明暗主题与键盘操作
- [x] memory.md 删除"检索、FTS 索引尚未实现"并写明降级；ADR 0003 改 implemented（README 索引同步）；`check:docs` 通过

## Comments

### 实施回执（票 11）

**覆盖的验收：** 五项全部勾选。

- agent：`memory_list { scope?, query? }`，非空 query 经新的 `MemoryPort.search(query, { scope?, limit })`（宿主决定次序，工具不重排，并防御性截到 20 条）；无结果 `No memories match "<query>".`；空白 query 等同列表；描述含"When there are many entries, search first: pass a query…"；`<memory>` 截断提示改为 `use memory_list with a query to search them.`；导出 `MEMORY_SEARCH_LIMIT = 20`。
- server：`MemoryService.search(query, { workspaceId?, scope?, limit? })` 调用 03 的 `memories.search`，签名未改。用户级与当前 Workspace 一起检索时，用一次不带过滤的查询取全库次序（bm25 或 updatedAt），再滤掉其他 Workspace 的条目；不足 limit 且仓库可能还有更多时，把条数放大 4 倍重查。这样结果仍是全局次序的前 20 条，不需要合并两次查询的 bm25 分数。`list` 也接受 scope。路由 `GET /api/memories`：非空 `query` 为检索，否则为列表；`scope` 只能是 user 或 workspace（其他值 400），scope=workspace 缺 workspaceId 时 400，Workspace 不存在时 404。
- renderer：`memoryStore.search(query)` 与 `query` 状态（增删改后按当前 query 重新读取，晚到的响应被丢弃）；Memory 分区搜索框（`Input type=search` 加 SearchIcon，与 fetch-models 对话框相同）。输入停止 200 ms 后检索，清空时立即恢复；有内容时 Escape 只清空（preventDefault，app.tsx 不再返回应用），空框时 Escape 返回应用；检索没有结果时显示"没有匹配的记忆"。i18n 新增 `memory.search`、`memory.searchPlaceholder`、`memory.noMatches`。
- 文档：memory.md 新增"检索"一节（匹配、排序、降级、同步），并更新工具表、协议、界面与验证；ADR 0003 改为 implemented，写入 FTS 经协议的证据，`docs/adr/README.md` 同步；`packages/session/README.md` 替换一句。

**实际运行的命令与结果：**

- `pnpm exec vitest run packages/agent/src/context/memory/memory.test.ts`：16 passed（先红：6 failed）。
- `pnpm exec vitest run tests/integration/sidecar-memory-search.test.ts`：2 passed（FTS5 与 COKO_TEST_NO_FTS=1 两组参数；先红：检索断言失败）。
- `pnpm exec vitest run apps/server/src/application/context/memory.test.ts`：2 passed。
- `pnpm exec vitest run tests/integration/secrets-gate-memory-search.test.ts`：1 passed。
- `pnpm exec vitest run apps/desktop/src/renderer/stores/memory-store.test.ts`：2 passed（先红：search is not a function）。
- `pnpm exec vitest run apps/desktop/src/renderer/features/settings/memory-section.browser.test.tsx`：1 passed。
- `pnpm exec vitest run apps/desktop/e2e/memory.e2e.test.ts`：2 passed（原有用例加追加的搜索框用例）。
- 合并 main（票 08）之后：`pnpm install --frozen-lockfile` 退出码 0；`pnpm run typecheck` 退出码 0；`pnpm run check:docs` 检查 215 个文件，0 个问题；聚焦集合（memory 相关单元、集成与秘密总闸、store、两个 browser 文件、样式守卫、source-references、browser-deps）12 个文件 81 passed。
- 全量 `pnpm run test`（锁内后台运行，合并 main 之后）：test=0，Test Files 373 passed，Tests 2936 passed、4 skipped（其中 evals 3 个为无凭据的真实模式）；日志中没有 EAGAIN。

**负向确认（变异）：**

- 把 `ftsPhrase` 改为原样传词：FTS5 组在 `"hello` 处得到 500，LIKE 组通过。证明对手用例确实经过 FTS 路径，之后已还原。
- 把 `MemoryService.search` 的放大重查改为只查一次：可见条目被其他 Workspace 挤出的用例失败，之后已还原。
- 把防抖时长改为 0：browser 用例因请求数不止一次而失败，之后已还原。
- 降级路径：集成测试在 Sidecar 停止后断言日志中 `memory search falls back to LIKE` 只在 NO_FTS 组出现，证明两组参数走了不同路径。

**秘密与注入点：** Memory 检索结果是新的注入点（工具结果与 HTTP 响应），新增 `tests/integration/secrets-gate-memory-search.test.ts`（复用共享 harness，未改 harness）：带 Credential 的条目经 HTTP 检索与 memory_list query 返回后，ws 帧、HTTP 响应体、faux requestLog、停止后的日志与 COKO_HOME 中都没有明文；以明文作查询词时得不到条目。请求日志只记 `c.req.path`，不记查询串。符号链接越界不适用：本票不新增文件读取根，检索只读库内已脱敏的正文。

**未验证：** 真实模型对工具描述"先检索"的实际行为（需真实凭据）；没有 FTS5 的真实运行时（Electron 内置 Node 编译了 FTS5，降级只以 COKO_TEST_NO_FTS=1 验证）；非 darwin 平台。

**越出写范围的改动：**

- `apps/desktop/src/renderer/features/settings/memory-section.browser.test.tsx`（新）、`apps/desktop/src/renderer/stores/memory-store.test.ts`（新）、`apps/server/src/application/context/memory.test.ts`（新）：都是写范围内源文件的就近测试，属于"就近测试"。
- `tests/integration/secrets-gate-memory-search.test.ts`（新）：须知要求新注入点新增 `secrets-gate-<channel>.test.ts`，票的写范围未列出。
- `docs/README.md`：只改了自己的 Memory 一行（补"关键词检索与 FTS 降级"）。
- `docs/adr/README.md`：0003 的 implementation 列改为 implemented（规格"文档"一节要求同步）。
- 未改 `runtime/layers.ts`，memory 块无需改动：03 已在 StoreLive 中按 `testNoFts` 传入 `fts: false` 并记 warn。未改 `sections.browser.test.tsx`。

**导航与导出：** `@coko/agent` 新增导出 `MEMORY_SEARCH_LIMIT`（经 context barrel，无需改 index.ts），`MemoryPort` 新增必选的 `search`（仓库内唯一实现是 server 的 `memoryPort`）。给票 14 的 README 要点：agent README 的 Memory 段可补一句"memory_list 的 query 经 MemoryPort.search，至多 MEMORY_SEARCH_LIMIT 条"；server README 可补"GET /api/memories 的 query / scope"。
