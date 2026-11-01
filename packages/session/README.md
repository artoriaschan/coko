---
kind: reference
description: "@coko/session 的 Repository 接口、SQLite 与内存实现的打开、提交、租约、迁移和错误契约，以及 Checkpoint 快照存储。装配存储、调用仓库或读写快照前查阅。"
lifecycle: active
---

# @coko/session

提供 Session、设置与 Provider 的 Repository 接口，以及 SQLite 实现和内存实现。决定依据见 [ADR 0003](../../docs/adr/0003-settings-and-sessions-in-sqlite.md)；Credential 的加解密边界见 [ADR 0004](../../docs/adr/0004-model-credentials-safe-storage.md)。Memory 检索（FTS5 派生索引与 LIKE 降级）由宿主经 `memories.search` 接入工具与 `/api/memories?query=`，当前行为见 [Memory](../../docs/subsystems/memory.md#检索)。

## 使用或结构入口

| 入口 | 内容 |
| --- | --- |
| `@coko/session` | 模型类型、`SessionRepository`、`SettingsRepository`、`ProviderRepository`、`MemoryRepository`、`SecretRepository`、`SessionStore`、`createPayloadRegistry` 与 `PayloadRegistry`、`StoreError`；不导入 `node:sqlite` |
| `@coko/session/sqlite` | `openSqliteStore({ path, payloads, ... })`、`SQLITE_SCHEMA_VERSION`（当前 6）、`RecoveryQueries` / `UnfinishedRun`；只在此入口导入 `node:sqlite` |
| `@coko/session/memory` | `createMemoryStore({ payloads })`，不持久化，供单元测试装配 |
| `@coko/session/blobs` | `openBlobStore(dir, { maxBytes? })`、`hashFile(path)`、`BlobTooLargeError`、`MAX_BLOB_BYTES`：Checkpoint 快照的内容寻址文件存储（[ADR 0006](../../docs/adr/0006-file-checkpoints-and-rewind.md)），只依赖 `node:fs` 与 `node:crypto` |

两种实现返回同一个 `SessionStore`：`sessions`（Workspace、Session、append-only Session Entry）、`settings`、`providers` 与 `close()`。SQLite 实现另有 `instanceId`、`migration`（`{ from, to, backupPath }`）、`capabilities.fts5` 与 `recovery`（启动恢复的跨 Session 查询，见下文）。

## 契约与生命周期

- **提交。** 每个写方法是一个 `BEGIN IMMEDIATE` 事务，Promise 兑现即已提交。`appendEntries` 一次提交一批条目，在 Session 内分配从 1 开始连续的 `seq`，并刷新 Session 的 `updatedAt`。条目不可修改（表上有拒绝 UPDATE 的触发器）。payload 按 JSON 保存，返回值是写入时的原样记录。
- **Payload 注册。** 打开存储时必须给出 `payloads`（`createPayloadRegistry(definitions)`）：每个 kind 一组按顺序编号的版本，每个版本有校验函数 `check(payload)`（合格返回 undefined，否则返回只描述 schema、不含值的原因），第 2 版起另有从上一版迁移的 `migrate`。session 不导入 agent：各 kind 的定义由 agent 提供（`SESSION_ENTRY_PAYLOADS`），由宿主装配。`payloadVersion` 缺省为当前版本，也可写入已登记的旧版本。
- **写入校验。** `appendEntries` 先校验整批：kind 未注册、版本未登记或 payload 不合该版本的 schema 时，以 `invalid-payload`（非 fatal，`details` 带 `index`、`kind`、`payloadVersion`、`reason`，不含 payload）拒绝，整批不提交。
- **读取。** `listEntries(sessionId, { afterSeq, limit })` 返回 `seq > afterSeq` 的条目，供断线重连补齐；payload 逐版迁移到当前版本。迁移后仍不合格（或 JSON 已损坏）的条目不返回、交给 `onInvalidEntry({ sessionId, seq, kind, payloadVersion, reason })`，库中保留，因此读回的 seq 可能有空缺；`limit` 按库中条目计数。`listSessions` 按 `updatedAt` 倒序。
- **设置。** 键值 JSON，每个键单独计 revision；不存在的键为 0。`set(key, value, expectedRevision)` 不匹配时以 `revision-conflict` 拒绝，`details` 带 `expected` 与 `actual`，值保持不变。
- **Session 模型与 Thinking Level。** `createSession({ model?, thinkingLevel? })` 与 `setSessionModel(id, { model, thinkingLevel? })`（`SessionModelChoice`）把模型与档位一起写入；档位缺省或模型为 null 时为 `off`。档位类型为 `ThinkingLevel`（七档，与 protocol 相同），库中不是七档之一的值读回为 `off`；是否可选由宿主校验。`modelCleared` 表示模型字段被清空（删除 Provider 时置为 true，`setSessionModel` 后为 false）：宿主据此在下次运行前要求重新选择，从未设置模型的 Session 为 false。
- **Provider 与 Credential。** Provider 的 `id` 由调用方给出（用户输入的 Provider ID），已被使用时 `create` 以 `already-exists` 拒绝且已有记录不变，`update` 不能改 `id`；`api`、`baseUrl` 与 Model Catalog（`models`，每项为 JSON）原样保存，取值由宿主校验。Provider 只返回 `credential: { hint } | null`。密文由 main 加密，`create` / `update` 可带 `credential`（`CredentialRecord { ciphertext, hint }`）在同一事务中写入单独的表，`update` 不带时保留原密文；也可用 `setCredential` 单独写入。密文只能用 `getCredentialCiphertext` 取回。`references(id)` 返回引用该 Provider 的 Session 数量；`delete(id, { settings? })` 在一个事务中删除 Provider 与密文、清空引用它的 Session 的模型字段（档位回到 off，不改 `updatedAt`），并按调用方给出的 `SettingRewrite { key, when, value }` 改写设置（键存在且 `when(当前值)` 为 true 时写入，revision 递增；`when` 抛出时整个删除回滚）；返回被清空的 Session 数量与被改写的键。设置的业务含义由宿主定义（apps/server 用它在删除时清除指向该 Provider 的默认模型）；以后用相同 ID 重新创建不会恢复这些引用。
- **Memory。** `store.memories`：`list({ scope?, workspaceId? })`（按 `updatedAt` 倒序）、`get`、`create({ scope, workspaceId?, content, source })`、`update(id, { content })`、`delete`。`scope` 为 `user`（`workspaceId` 必须为空）或 `workspace`（必须给出），不一致时 `invalid-input`，Workspace 不存在或条目不存在时 `not-found`。Agent 的工具与设置界面由 M3 票 09 接入。
- **登记的 Secret**（[ADR 0007](../../docs/adr/0007-secrets-from-registered-entries.md)）。`store.secrets`：`list()` 只返回 `{ name, hint, updatedAt }`（按名字排序，不含密文）、`setCiphertext(name, { ciphertext, hint })`（新增或替换）、`getCiphertext(name)`、`delete(name)`（不存在时 `not-found`）。只存 main 加密后的密文。
- **子进程登记**（[ADR 0012](../../docs/adr/0012-host-process-registry.md)）。`store.processes`：`register({ pid, pgid?, startedAt, kind, sessionId?, jobId?, command })` 返回带 `id` 与 `createdAt` 的 `HostProcess`，`remove(id)`（不存在时不报错），`list()`。`kind` 为 `bash`、`job`、`pty`、`mcp`、`hook`、`git`、`lsp`（`HOST_PROCESS_KINDS`）；`startedAt` 保存 `ps -o lstart=` 原文，宿主据此在启动清理时核对 pid 是否被复用。
- **打开序列。** 创建目录（0700）与库文件（0600）→ 读库头版本，高于 `SQLITE_SCHEMA_VERSION` 时立即报告 `version-too-new` → 获取宿主租约 → `PRAGMA quick_check` → 版本检查 → WAL、`synchronous=FULL`、外键、busy timeout → 迁移 → FTS5 探测 → 启动心跳。租约先于快速检查：隔离会改名文件，只有确认本实例是写者后才执行；文件已读不出租约（不是数据库或页面损坏）时直接进入快速检查。
- **迁移。** 迁移按编号前向执行，每一步与 `user_version` 在同一事务提交。库里已有数据时，迁移前先 `VACUUM INTO <path>.backup-v<N>-<时间>`（0600）。某一步失败时只回滚该步，已提交的步骤保留，并报告 `migration-failed`（`details` 带 `version`、`failedVersion` 与 `backupPath`）。v4 去掉 Provider 的 kind 列，不迁移旧数据（[ADR 0010](../../docs/adr/0010-provider-one-shot-save.md)）：删除已有 Provider 与 Credential、删除 `defaultModel` 设置、清空 Session 的模型字段（不改 `updatedAt`；被清空的 Session ID 记在临时表 `model_cleared_sessions` 中），其余 Session、条目与设置不变；旧数据只留在迁移前的备份中。v5 加 Session 的 Thinking Level（已有为 off）。v6 加 `model_cleared`：v4 记下的 Session，以及按旧版 v4（没有该表）迁过的库中模型为空且有 message、run_start 或 run_end 条目的 Session 标为被清空，然后删除临时表。
- **版本。** 1：初始表；2：索引 `session_entries_by_kind`（`session_id, kind, seq`），供恢复查询；3：`memories`（STRICT，索引 `memories_by_scope(scope, workspace_id, updated_at)`）与 `secrets`（name 主键、ciphertext、hint、updated_at）；4：见上文迁移；5：`sessions.thinking_level`（TEXT，默认 `'off'`），已有 Session 为 off；6：见上文迁移；7：`host_processes`（STRICT）；8：`sessions.parent_session_id` / `worktree_id`、`worktrees` 与 `schedules`（STRICT），`host_processes` 重建（kind 增加 hook、git，登记行原样复制）；9：`plugins`（STRICT），运行时有 FTS5 时 `memories_fts`（外部内容表、trigram 分词、三个同步触发器，建立时按现有行重建），`host_processes` 重建（kind 增加 lsp）。
- **子 Session、worktree 与定时任务（v8）。** `createSession({ parentSessionId?, worktreeId? })` 要求两者属于同一 Workspace（否则 `invalid-input`，不存在为 `not-found`）；`listSessions` 不含子 Session，`listChildren(parentId)` 按创建顺序。`store.worktrees`：`create`（path 唯一，已移除的仍占用）、`get`、`list(workspaceId)`（含 removed）、`markRemoved`（幂等）。`store.schedules`：`create`、`update(id, revision, patch)`（revision 乐观并发，成功加 1）、`delete`、`list({ sessionId? })`、`due(now)`（active 且 `nextAt ≤ now`，按 nextAt）、`recordFire(id, { occurrence, nextAt, status? }, entry)`：一个事务内更新任务行并向其 Session 追加条目，revision 不变，任一步失败时都不变。rule 的含义由宿主定义，原样保存。
- **插件与 Memory 检索（v9）。** `store.plugins`：`list()`（按名字）、`get`、`upsert(input)`（新建为未批准、未启用；更新保留 `approvedDigest` 与 `enabled`；path 被另一个插件使用时 `already-exists`，来源不是 dir / git 时 `invalid-input`）、`approve(name, digest)`（同时启用）、`setEnabled`、`delete`（不存在时 `not-found`）；digest 与状态的含义由宿主定义。`memories.search(query, { scope?, workspaceId?, limit? })`：空白分隔的词全部出现才匹配，`limit` 缺省 20，空查询为空数组；SQLite 在 FTS 可用且每个词至少 3 个字符时按 bm25 排序，否则（或 `openSqliteStore({ fts: false })`）为大小写不敏感的 LIKE、按 `updatedAt` 倒序；内存实现为子串匹配。`capabilities.fts5` 表示检索是否使用 FTS5。
- **恢复查询。** `recovery.listUnfinishedRuns()` 返回有 `run_start`（带 runId）而没有其后同 runId `run_end` 的 Run `{ sessionId, runId, startSeq }`，按 sessionId、startSeq 排序；`recovery.listLatestEntries(kind)` 返回每个 Session 该 kind 的最后一条条目，payload 与 `listEntries` 一样迁移，不合格的跳过并报告。kind 字面量是存储与 agent 之间的约定，session 不解释 payload。用法见 [启动恢复与结果确认](../../docs/subsystems/recovery.md)。
- **宿主租约。** `host_lease` 单行表，打开时最先于事务中获取。其他实例的进程存活且心跳未超过 TTL 时，打开以 `lease-held` 拒绝（`details` 带 `pid`、`instanceId`），不做快速检查与隔离，文件保持原样。持有者进程已退出或心跳超时则接管。每次写入都在事务内校验租约，被接管后本实例的所有操作以 `lease-lost` 拒绝。`close()` 释放租约。
- **损坏。** `quick_check` 未通过，或文件不是数据库，都会把原文件（连同 `-wal`、`-shm`）改名为 `<path>.corrupt-<时间>-<id>` 隔离，并报告 `corrupt`（`details.quarantinedTo`）；不会自动重建。库版本高于 `SQLITE_SCHEMA_VERSION` 时在获取租约之前报告 `version-too-new`，不写入任何内容，库文件逐字节不变。
- **错误。** 所有失败都是 `StoreError`（`code`、`fatal`、`details`）。`fatal` 为 true 的错误（`lease-held`、`lease-lost`、`corrupt`、`version-too-new`、`migration-failed`、`open-failed`、`unknown-state`）表示存储不可继续使用，应由宿主提示用户。回滚本身失败时进入 `unknown-state`，必须关闭后重开。

### 快照存储

- **布局。** `<dir>/<SHA-256 前 2 位>/<SHA-256>`，引用是小写十六进制的 SHA-256。Sidecar 的 `dir` 是 `<dataDir>/blobs`（`apps/server/src/adapters/checkpoints.ts`）。目录在第一次写入时创建，快照目录与分片目录 0700（已存在时也收紧），文件 0600。
- **写入。** `put(bytes | AsyncIterable)` 与 `putFile(path)` 先写同目录的临时文件 `.tmp-<pid>-<随机>`、边写边算摘要，fsync 后改名到位并 fsync 所在目录，兑现为 SHA-256。同一内容已存在时丢弃临时文件，只存一份。来源出错或超过 `maxBytes`（默认 `MAX_BLOB_BYTES` = 10 MiB，超出以 `BlobTooLargeError` 拒绝）时删除临时文件，不留下目标文件。`putFile` 对不存在的文件以 ENOENT 拒绝。
- **读取。** `read(hash)`、`has(hash)`；引用不是 SHA-256 时拒绝，不会解析到目录之外。`hashFile(path)` 只计算摘要，不写入、不限大小。
- **引用。** 快照的引用与元数据是 Session Entry（`file_backup`、`file_change`，payload 由 agent 定义），不新增表。M2 不清理快照目录。

## 配置与限制

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `path` | 必填 | 库文件路径，例如 `<userData>/coko.db`；不支持 `:memory:` |
| `leaseTtlMs` | 30000 | 心跳超过该时长的租约可被接管 |
| `heartbeatMs` | 10000 | 心跳间隔；定时器不阻止进程退出 |
| `busyTimeoutMs` | 5000 | 等待写锁的上限；打开时等满仍拿不到写锁，按 `lease-held` 报告 |
| `payloads` | 必填 | Session Entry 的 payload 注册表 |
| `onInvalidEntry` | 不报告 | 读取时跳过不合格条目的回调；宿主记 warn |
| `now` | `Date.now` | 记录时间戳与租约心跳使用的时钟 |

- `DatabaseSync` 是同步 API，等待写锁时会阻塞事件循环，前提是单写者。
- 每个进程第一次加载 `node:sqlite` 时，会向 stderr 输出一次 `ExperimentalWarning`。
- FTS5：2026-10-28 在 Electron 41.0.3（内置 Node 24.14.0、SQLite 3.51.2）中实测已编译（`ENABLE_FTS5`），`capabilities.fts5` 为 true。目前只做探测，还没有建立索引。

## 验证与相关设计

- `src/repository-contract.ts`：仓库契约测试套件（含 payload 写入拒绝与读取迁移、跳过；Memory 的作用域与排序；Secret 的 list 不含密文、密文按字节读回），由 `src/memory/memory.test.ts` 与 `src/sqlite/sqlite.test.ts` 对两种实现分别运行；测试用注册表在 `src/test-payloads.ts`。
- `src/sqlite/sqlite.test.ts`：重新打开后读回、升级注册表后重新打开时旧版本 payload 迁移且不合格行保留在库中、0600 权限、租约冲突与 TTL 接管、损坏隔离（非数据库文件、页面损坏）、租约被存活实例持有时损坏库不被隔离、版本过高拒绝且库文件逐字节不变。
- `src/sqlite/migrate.test.ts`：用合成迁移验证备份、逐步提交、失败回滚与租约释放。
- `src/sqlite/migrate-v5.test.ts`：v4 库迁移后已有 Session 的 Thinking Level 为 off、其余字段不变，之后写入的档位在重新打开后读回。
- `src/sqlite/migrate-v6.test.ts`：v4 记下的与运行过的模型为空的 Session 标为被清空，有模型或从未运行的不标；按旧版 v4 迁过的库只按运行记录标记。
- `src/sqlite/migrate-v8.test.ts`：v7 库升级到 8：`.backup-v7-*`（0600）、原 Session、条目与登记行可读，新表为 STRICT，子 Session 与 hook / git 登记可写；子 Session、worktree、定时任务与 `recordFire` 的事务在 `src/repository-contract.ts` 中对两种实现运行。
- `src/sqlite/migrate-v7.test.ts`：v6 库升级到 7：`.backup-v6-*`（0600）、原有 Session 与条目可读、`host_processes` 为 STRICT 且可写入；`store.processes` 的契约在 `src/repository-contract.ts` 中对两种实现运行。
- `src/sqlite/migrate-v4.test.ts`：v3 库经过 v4：`.backup-v3-*`（0600，保留旧 Provider）、旧 Provider、Credential 与 `defaultModel` 被清除、Session 模型字段为空且其余字段与条目可读、新表没有 kind 列。
- `src/sqlite/recovery.test.ts`：v1 库迁移到当前版本、v2 库迁移到当前版本（`.backup-v2-*` 为 0600、新表为 STRICT、索引列、原数据可读）与两个恢复查询；经协议的迁移证据在 `tests/integration/sidecar-recovery.test.ts`。
- `src/blobs/blobs.test.ts`：同一内容只存一份、读回逐字节相同、0700 / 0600、来源中途出错与超限时不留下任何文件、引用校验。
- `src/sqlite/electron-runtime.test.ts`：以 `ELECTRON_RUN_AS_NODE=1` 启动 Electron 子进程（`src/sqlite/electron-fixture.ts`），验证跨进程提交读回、租约冲突、持有者被 SIGKILL 后接管，并断言运行时版本与 FTS5 可用。

运行：`pnpm exec vitest run packages/session`。

## 延伸阅读

- [项目架构约定](../../docs/tech-stack/architecture.md#服务装配与存储边界)：session 在服务装配中的位置与依赖方向。
- [测试约定](../../docs/tech-stack/testing.md)：Electron 内置 Node 下运行存储测试的要求。
