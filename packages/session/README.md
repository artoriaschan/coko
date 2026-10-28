---
kind: reference
description: "@coko/session 的 Repository 接口、SQLite 与内存实现的打开、提交、租约、迁移和错误契约。装配存储或调用仓库前查阅。"
lifecycle: active
---

# @coko/session

提供 Session、设置与 Provider 的 Repository 接口，以及 SQLite 实现和内存实现。决定依据见 [ADR 0003](../../docs/adr/0003-settings-and-sessions-in-sqlite.md)；Credential 的加解密边界见 [ADR 0004](../../docs/adr/0004-model-credentials-safe-storage.md)。尚未提供 Memory、Goal / Task 等业务状态、payload 注册接口与 FTS5 搜索索引。

## 使用或结构入口

| 入口 | 内容 |
| --- | --- |
| `@coko/session` | 模型类型、`SessionRepository`、`SettingsRepository`、`ProviderRepository`、`SessionStore`、`StoreError`；不导入 `node:sqlite` |
| `@coko/session/sqlite` | `openSqliteStore({ path, ... })`、`SQLITE_SCHEMA_VERSION`；只在此入口导入 `node:sqlite` |
| `@coko/session/memory` | `createMemoryStore()`，不持久化，供单元测试装配 |

两种实现返回同一个 `SessionStore`：`sessions`（Workspace、Session、append-only Session Entry）、`settings`、`providers` 与 `close()`。SQLite 实现另有 `instanceId`、`migration`（`{ from, to, backupPath }`）和 `capabilities.fts5`。

## 契约与生命周期

- **提交。** 每个写方法是一个 `BEGIN IMMEDIATE` 事务，Promise 兑现即已提交。`appendEntries` 一次提交一批条目，在 Session 内分配从 1 开始连续的 `seq`，并刷新 Session 的 `updatedAt`。条目不可修改（表上有拒绝 UPDATE 的触发器）。payload 按 JSON 保存，含义与版本迁移由调用方负责。
- **读取。** `listEntries(sessionId, { afterSeq, limit })` 返回 `seq > afterSeq` 的条目，供断线重连补齐。`listSessions` 按 `updatedAt` 倒序。
- **设置。** 键值 JSON，每个键单独计 revision；不存在的键为 0。`set(key, value, expectedRevision)` 不匹配时以 `revision-conflict` 拒绝，`details` 带 `expected` 与 `actual`，值保持不变。
- **Provider 与 Credential。** Provider 只返回 `credential: { hint } | null`。密文由 main 加密后经 `setCredential` 存入单独的表，只能用 `getCredentialCiphertext` 取回；删除 Provider 时同时删除密文。
- **打开序列。** 创建目录（0700）与库文件（0600）→ `PRAGMA quick_check` → 版本检查 → WAL、`synchronous=FULL`、外键、busy timeout → 获取宿主租约 → 迁移 → FTS5 探测 → 启动心跳。
- **迁移。** 迁移按编号前向执行，每一步与 `user_version` 在同一事务提交。库里已有数据时，迁移前先 `VACUUM INTO <path>.backup-v<N>-<时间>`（0600）。某一步失败时只回滚该步，已提交的步骤保留，并报告 `migration-failed`（`details` 带 `version`、`failedVersion` 与 `backupPath`）。
- **宿主租约。** `host_lease` 单行表，在迁移前于事务中获取。其他实例的进程存活且心跳未超过 TTL 时，打开以 `lease-held` 拒绝（`details` 带 `pid`、`instanceId`）。持有者进程已退出或心跳超时则接管。每次写入都在事务内校验租约，被接管后本实例的所有操作以 `lease-lost` 拒绝。`close()` 释放租约。
- **损坏。** `quick_check` 未通过，或文件不是数据库，都会把原文件（连同 `-wal`、`-shm`）改名为 `<path>.corrupt-<时间>-<id>` 隔离，并报告 `corrupt`（`details.quarantinedTo`）；不会自动重建。库版本高于 `SQLITE_SCHEMA_VERSION` 时报告 `version-too-new`，文件不做改动。
- **错误。** 所有失败都是 `StoreError`（`code`、`fatal`、`details`）。`fatal` 为 true 的错误（`lease-held`、`lease-lost`、`corrupt`、`version-too-new`、`migration-failed`、`open-failed`、`unknown-state`）表示存储不可继续使用，应由宿主提示用户。回滚本身失败时进入 `unknown-state`，必须关闭后重开。

## 配置与限制

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `path` | 必填 | 库文件路径，例如 `<userData>/coko.db`；不支持 `:memory:` |
| `leaseTtlMs` | 30000 | 心跳超过该时长的租约可被接管 |
| `heartbeatMs` | 10000 | 心跳间隔；定时器不阻止进程退出 |
| `busyTimeoutMs` | 5000 | 等待写锁的上限；打开时等满仍拿不到写锁，按 `lease-held` 报告 |
| `now` | `Date.now` | 记录时间戳与租约心跳使用的时钟 |

- `DatabaseSync` 是同步 API，等待写锁时会阻塞事件循环，前提是单写者。
- 每个进程第一次加载 `node:sqlite` 时，会向 stderr 输出一次 `ExperimentalWarning`。
- FTS5：2026-10-28 在 Electron 41.0.3（内置 Node 24.14.0、SQLite 3.51.2）中实测已编译（`ENABLE_FTS5`），`capabilities.fts5` 为 true。目前只做探测，还没有建立索引。

## 验证与相关设计

- `src/repository-contract.ts`：仓库契约测试套件，由 `src/memory/memory.test.ts` 与 `src/sqlite/sqlite.test.ts` 对两种实现分别运行。
- `src/sqlite/sqlite.test.ts`：重新打开后读回、0600 权限、租约冲突与 TTL 接管、损坏隔离（非数据库文件、页面损坏）、版本过高拒绝。
- `src/sqlite/migrate.test.ts`：用合成迁移验证备份、逐步提交、失败回滚与租约释放。
- `src/sqlite/electron-runtime.test.ts`：以 `ELECTRON_RUN_AS_NODE=1` 启动 Electron 子进程（`src/sqlite/electron-fixture.ts`），验证跨进程提交读回、租约冲突、持有者被 SIGKILL 后接管，并断言运行时版本与 FTS5 可用。

运行：`pnpm exec vitest run packages/session`。

## 延伸阅读

- [项目架构约定](../../docs/tech-stack/architecture.md#服务装配与存储边界)：session 在服务装配中的位置与依赖方向。
- [测试约定](../../docs/tech-stack/testing.md)：Electron 内置 Node 下运行存储测试的要求。
