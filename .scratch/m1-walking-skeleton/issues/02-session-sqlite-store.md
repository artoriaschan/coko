# 02: SQLite 存储：Session、设置与 Provider

**What to build:** packages/session 提供 SessionRepository、SettingsRepository、ProviderRepository 接口，以及 SQLite 实现（`node:sqlite`）与内存实现，满足 [ADR 0003](../../../docs/adr/0003-settings-and-sessions-in-sqlite.md) 的打开序列、迁移、备份、租约与损坏隔离。

**Blocked by:** 01

**Status:** ready-for-agent

- [x] 在临时目录：创建 workspace / session / entries 后关闭并重新打开，读回内容与 seq 一致
- [x] 设置更新 revision 不匹配时返回冲突
- [x] 第二个实例获取租约失败并得到明确错误
- [x] 损坏文件被改名隔离并返回 fatal 错误；库版本高于程序版本时拒绝打开
- [x] 同一组仓库契约测试对 SQLite 与内存实现都通过
- [x] 以 `ELECTRON_RUN_AS_NODE=1` 运行的测试覆盖打开与租约，并记录 FTS5 是否可用

## Comments

### 2026-10-28 实施回执（m1/02-session-sqlite-store）

覆盖验收：六项全部满足。

- 接口：`@coko/session`（类型、三个 Repository、`SessionStore`、`StoreError`，不导入 node:sqlite）；`@coko/session/sqlite`（`openSqliteStore`、`SQLITE_SCHEMA_VERSION`=1）；`@coko/session/memory`（`createMemoryStore`）。契约见 packages/session/README.md。
- 给下游票（03/04/07/08）的要点：`appendEntries(sessionId, entries[])` 一批一个事务，返回已提交条目带 seq；`listEntries(id, { afterSeq })` 用于重连补齐；设置为每键 revision，冲突 `StoreError{code:'revision-conflict', details:{expected, actual}}`；Provider 只回 `credential: { hint } | null`，密文经 `setCredential` / `getCredentialCiphertext`（hint 由 main 计算后传入）；fatal 错误码 lease-held / lease-lost / corrupt / version-too-new / migration-failed / open-failed / unknown-state，供 sidecar 映射为控制 IPC fatal。
- 设计选择（未偏离 ADR）：host_lease 在迁移前于 BEGIN IMMEDIATE 中获取；持有者进程存活且心跳未超 TTL（默认 30s）才算持有，进程已退出或心跳超时则接管；每次写事务内校验租约，被接管后报 lease-lost。损坏时连同 -wal/-shm 改名为 `<path>.corrupt-<时间>-<id>`，不重建。迁移每步与 user_version 同事务；有数据时先 `VACUUM INTO` 备份并 chmod 0600。
- 运行命令与结果（unset ELECTRON_RUN_AS_NODE）：`pnpm install --frozen-lockfile` 0；`pnpm run typecheck` 0；`pnpm run lint` 0 问题；`pnpm run format:check` 0；`pnpm run check:docs` 59 文件 0 问题；`pnpm exec vitest run packages/session` 5 文件 30 用例通过（契约 9×2、SQLite 7、迁移 1、Electron 3、入口 1）；`pnpm run test` 14 文件 56 用例通过。
- Electron 运行时：`electron-runtime.test.ts` 以 `ELECTRON_RUN_AS_NODE=1` 启动 Electron 41.0.3（Node 24.14.0、SQLite 3.51.2）子进程，覆盖跨进程提交读回、租约冲突、持有者 SIGKILL 后立即接管。**FTS5 可用**（compile_options 含 ENABLE_FTS5，`capabilities.fts5 === true` 被断言）。
- 守卫反证：临时让租约永不冲突、跳过隔离、去掉版本检查、去掉迁移备份、去掉 revision 校验、去掉写入时租约校验、FTS5 置 false，各自使对应用例失败（1–3 个），均已撤销。
- 未验证：经 sidecar 协议的集成测试（票 04）；Memory、业务 payload 注册接口、FTS5 索引不在本票；只在 macOS arm64 本机运行。
- 依赖：packages/session 新增 devDependency electron 41.0.3（已在 TECH_STACK 接入状态表登记一行），lockfile +3 行。
- 文档影响：新增 packages/session/README.md（当前行为参考）；ADR 0003 implementation not-started → partial，并写明剩余项；docs/adr/README.md 索引同步；TECH_STACK 接入状态表加 packages/session 行，服务端章节记录 FTS5 实测。.scratch 研究中"FTS5 未验证"的历史记录保留未改。
