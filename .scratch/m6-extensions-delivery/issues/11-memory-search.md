# 11: Memory 检索：memory_list 的 query、/api/memories?query=、设置搜索框

**What to build:** 见 [规格](../spec.md)"Memory 检索"：`memory_list { scope?, query? }` 经 03 的 `memories.search`；`<memory>` 截断提示；`GET /api/memories?query=`；设置 → Memory 分区的搜索框；FTS 不可用时的降级；ADR 0003 改 implemented。

**User stories:** 17

**Blocked by:** 03

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/context/memory/`、`packages/protocol/src/memory.ts`、`apps/server/src/application/context/memory.ts`、`http/routes/memories.ts`、`runtime/layers.ts` 的 memory 块（如需）、`packages/i18n/src/dictionaries/domains/memory.ts`、renderer `features/settings/memory-section.tsx`、`stores/memory-store.ts`、就近测试、`tests/integration/sidecar-memory-search.test.ts`（新）、`apps/desktop/e2e/memory.e2e.test.ts`（追加用例）、`docs/subsystems/memory.md`、`docs/adr/0003-settings-and-sessions-in-sqlite.md`、`packages/session/README.md`（一句）

**跨票接口：** 使用 03 的 `memories.search(query, { scope, workspaceId?, limit })`，不改其签名。

- [ ] agent：`memory_list` 带 query 时至多 20 条、无结果文本、工具描述与截断提示
- [ ] 集成：写入 30 条后按关键词检索得到相关条目（FTS，按相关度）；Workspace 作用域隔离；`COKO_TEST_NO_FTS=1` 时 LIKE 降级结果相同（同一组用例参数化）；更新与删除后检索结果同步
- [ ] **对手用例**：query 为 FTS 语法字符（`"`、`*`、`NEAR`、`)`）时不报错、按字面匹配（先红）
- [ ] E2E：Memory 分区搜索框过滤列表、清空恢复；明暗主题与键盘操作
- [ ] memory.md 删除"检索、FTS 索引尚未实现"并写明降级；ADR 0003 改 implemented（README 索引同步）；`check:docs` 通过

## Comments
