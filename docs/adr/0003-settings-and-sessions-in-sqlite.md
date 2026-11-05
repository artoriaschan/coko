---
kind: decision
description: "设置、会话及相关业务状态以 sidecar 独占的单个 SQLite 库为权威存储，替代 append-only JSONL 会话方案。修改持久化、迁移或存储边界时回看。"
status: accepted
implementation: implemented
lifecycle: active
category: architecture
---

# 设置与会话存储在 SQLite

## 上下文

原约定由 packages/session 用 append-only JSONL 保存 Session 与执行记录，SQLite 只承担宿主单写者互斥。用户于 2026-10-28 要求桌面端的设置和会话等内容存储在 SQLite，并授权讨论中的问题采用推荐方案。

参考实现 DeepSeek Harness 的会话为 JSONL、设置为 YAML，只把 SQLite 用作可选 KV 后端和可重建的 FTS5 搜索索引，没有以 SQLite 为会话权威存储的先例；本决定借鉴其 SQLite 打开顺序与事务失败隔离，迁移自行设计。

## 决定

- **单一权威库。** 每个用户数据目录一个 SQLite 文件，由 sidecar 通过 `node:sqlite` 独占打开；main 与 renderer 只经服务协议读写。
- **入库范围。** 全局与用户级设置、工作区登记、会话与 append-only 会话条目（消息、工具调用意图、授权决定与结果，以及 Goal、Plan、Task、Job、调度等状态的版本化 payload）、待处理授权、Memory、分叉关系和 checkpoint 元数据。
- **不入库。** 运行日志仍为独立 JSONL 文件；文件快照正文以内容寻址文件保存，库内只存引用；凭据明文不入库；项目级配置仍从仓库文件读取，作为只读覆盖。
- **所有权。** packages/session 拥有 schema、迁移、事务与提交屏障，公共入口暴露 Repository 接口，SQLite 实现与内存实现通过独立入口提供。业务 payload 的含义、校验与迁移由 agent 经注册接口提供，session 不导入 agent。
- **提交。** 每次提交是一个 `BEGIN IMMEDIATE` 事务，COMMIT 返回即已提交事实；会话条目带会话内单调序号，不逐条保存文本增量。
- **打开与迁移。** 文件权限 0600，WAL、`synchronous=FULL`、外键与 busy timeout，STRICT 表；编号前向迁移逐步提交，迁移前用 `VACUUM INTO` 备份，库版本高于程序支持版本时拒绝打开。
- **写者互斥与损坏。** main 持有 Electron 单实例锁；sidecar 在库内以事务获取宿主租约。打开时执行完整性快速检查，失败则隔离原文件并报告 fatal，由桌面端提示用户，不静默重建。
- **搜索。** FTS5 只作可重建的派生索引；运行时不支持时降级为普通查询。

## 理由与备选方案

- **保留 JSONL 会话，SQLite 只放设置。** 与参考实现一致，追加写成本低；但不满足用户要求，跨会话查询（列表、搜索、Goal 与 Task 状态）还需另建索引。
- **JSONL 为权威、SQLite 为派生索引。** DSH 的做法；两份数据需要一致性修复，用户要求的是 SQLite 存储本身。
- **按领域拆多个库文件。** 隔离更强，但跨库事务不可用，会话条目与 Goal/Task 状态的原子提交需要额外协议。

## 后果与验证

- 提交屏障由 SQLite 事务提供，不再需要应用自行实现 fsync 顺序、尾行修复和锁文件；代价是会话导出、调试需要经查询接口，大块内容要控制行大小。
- 单库单写者意味着所有写入经 sidecar；main 在 sidecar 就绪前只使用内置默认值。
- implementation 变为 implemented 前需要：以 `ELECTRON_RUN_AS_NODE` 启动真实 sidecar 的集成测试覆盖打开、迁移、提交后重启读回、租约冲突、损坏隔离与版本过高拒绝。
- 当前为 implemented：packages/session 已实现打开序列、迁移、租约、损坏隔离、Repository 与 payload 注册接口（写入校验、读取逐版迁移、跳过不合格条目），并在 Electron 内置 Node 中验证打开与租约，见 [@coko/session](../../packages/session/README.md)；agent 定义各 kind 的 payload，apps/server 装配 SQLite 存储与注册表，经协议的集成测试覆盖提交后重启读回、租约冲突、损坏隔离、版本过高拒绝（库文件逐字节不变）与读取时跳过不合格条目（见 [apps/server](../../apps/server/README.md)）。迁移 v2（索引 `session_entries(session_id, kind, seq)`，供启动恢复查询未完成的 Run）已有经协议的证据：用版本 1 的库启动真实 Sidecar，库升到版本 2、生成 `.backup-v1-*` 备份，原有 Session 与条目可读（`tests/integration/sidecar-recovery.test.ts`，恢复契约见 [启动恢复与结果确认](../subsystems/recovery.md)）。迁移 v3 建立 `memories` 表与 `MemoryRepository`（SQLite 与内存实现共用契约测试；v2 库升级到 3 时备份、建表与索引、原数据可读，见 `packages/session/src/sqlite/recovery.test.ts`）。Memory 已实现：Agent 工具、每个 Run 注入的 system section 与设置分区经 `MemoryRepository` 读写库内条目，经协议的集成测试覆盖写入后新 Session 读到、按 Workspace 隔离与重启后读回（`tests/integration/sidecar-memory.test.ts`），当前行为见 [Memory](../subsystems/memory.md)。Memory 检索（FTS5 索引见下文迁移 v9）已接入 memory_list 的 query、`GET /api/memories?query=` 与设置分区的搜索框。 迁移 v7 建立子进程登记表 `host_processes`（STRICT；id 主键、pid、pgid?、started_at、kind、session_id?、job_id?、command、created_at）与 `store.processes`（`register`、`remove`、`list`，SQLite 与内存实现共用契约测试；v6 库升级到 7 时备份 0600、原数据可读，见 `packages/session/src/sqlite/migrate-v7.test.ts`），用途见 [ADR 0012](0012-host-process-registry.md)。迁移 v8（M5）：`sessions` 增加 `parent_session_id`（子 Session，引用 sessions）与 `worktree_id`（引用 worktrees），索引 `sessions_by_parent`；新表 `worktrees`（STRICT；workspace_id、name、path UNIQUE、branch、base_commit、repo_root、status active / removed、created_by user / subagent、created_at、removed_at?）与 `schedules`（STRICT；session_id、title、prompt、rule（JSON 文本）、status active / paused / inactive、next_at?、last_occurrence?、revision、created_at、updated_at，索引 `schedules_by_next`）；`host_processes` 按原样复制登记行后重建，kind 增加 hook 与 git。仓库：`listSessions` 缺省不含子 Session、`listChildren`、`store.worktrees`、`store.schedules`，其中 `recordFire` 在一个事务中更新任务行并追加条目，任一步失败时两者都不变（SQLite 与内存实现共用契约测试；v7 库升级到 8 时备份 0600、原数据与登记行可读，见 `packages/session/src/sqlite/migrate-v8.test.ts`）。迁移 v9（M6）：新表 `plugins`（STRICT；name 主键、version、source_kind dir / git、source_location、source_ref?、commit?、path UNIQUE、digest、approved_digest?、enabled 0/1、installed_at、updated_at）与 `store.plugins`；运行时编译了 FTS5 时建立 `memories_fts`（外部内容表、trigram 分词，插入 / 更新 / 删除触发器同步，建立时按现有行重建）与 `memories.search`（FTS 可用时按 bm25，否则或词短于 3 个字符时 LIKE；内存实现为子串匹配）；`host_processes` 按原样复制登记行后重建，kind 增加 lsp（SQLite 与内存实现共用契约测试；v8 库升级到 9 时备份 0600、原数据与登记行可读，见 `packages/session/src/sqlite/migrate-v9.test.ts`）。FTS 的经协议证据：真实 Sidecar（Electron 内置 Node，FTS5 可用）上写入 30 条后经工具与 HTTP 检索按相关度、Workspace 隔离、至多 20 条、改正文与删除后触发器同步、FTS 语法字符按字面；同一组用例以 `COKO_TEST_NO_FTS=1` 降级为 LIKE 时结果集合相同、按 updatedAt 倒序，并记 warn（`tests/integration/sidecar-memory-search.test.ts`，"搜索"一条的降级即此路径）。

**工具加载事实（2026-11-05）。** 按需工具的加载作为宿主 `tool_load` 条目追加，而不保存为可改写的 Session 名单：加载来自一次已提交工具结果，因而可以随对话回退撤销，并按分叉边界继承；压缩只替换模型上下文，不删除加载事实。若名单单独保存，回退与早期分叉还需维护第二份历史。此选择延续本决定的 append-only 业务事实归属与 [Fork](0023-assistant-reply-forks.md) 的边界，机制及恢复证据见 [MCP](../subsystems/mcp.md#工具搜索与按需加载) 和 [边界测试](../../tests/integration/sidecar-tool-search-boundaries.test.ts)。

## 来源与后继

- 替代 [技术栈](../TECH_STACK.md) 原"Session 与执行记录为 append-only JSONL"的选型；该选型未单独记录 ADR，相关正文已同批改写。
- 进程模型见 [ADR 0001](0001-sidecar-on-electron-node.md)。
- 参考实现：DeepSeek Harness 的 `packages/storage/storage-sqlite` 与 `packages/session-query/session-query-sqlite`，本页已提炼所需结论。
