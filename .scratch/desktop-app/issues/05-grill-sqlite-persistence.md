# 设置与会话改存 SQLite 的存储边界

Type: grilling
Label: wayfinder:grilling
Status: resolved
Assignee: lead
Blocked by: 01, 02
Map: [Coko 桌面应用](../map.md)

## Question

用户要求桌面端的设置与会话存储在 SQLite。现有约定是 Session 用 append-only JSONL、SQLite 仅作写者互斥。新的存储边界是什么：哪些数据进 SQLite（设置、会话、消息、执行记录、Goal/Task/授权、Memory），由哪个包持有（packages/session 的 SQLite 实现），事务与提交屏障、迁移、损坏恢复如何定义？是否以 ADR 替代原 JSONL 约定？

## Comments

- 2026-10-28 lead：DSH 研究早期发现。DSH 的会话是 append-only JSONL（zstd 帧、不可变 generation 文件、fsync + link 发布、flock 租约），设置是 profile YAML patch 加 revision 乐观并发，KV 默认 JSON 后端；SQLite 只出现在可选的 storage-sqlite 后端（node:sqlite DatabaseSync、WAL、STRICT 表、不做迁移）和派生的 FTS5 会话搜索索引。用户已明确要求设置与会话存 SQLite，因此本票不沿用 DSH 的 JSONL 决策，只借鉴其 storage-sqlite 的 WAL/STRICT 做法和 FTS5 索引思路。详细结论见 research/dsh-desktop-architecture.md（待写入）。
- 2026-10-28 lead：按常设指示，以下推荐直接采纳（Q1–Q8 均为"是"）。

## Answer

按用户常设指示（2026-10-28 goal："设置和会话等内容存储在 sqlite 中"，讨论问题采用推荐）采纳，不是用户逐条确认。长期结论提炼到 [ADR 0003](../../../docs/adr/0003-settings-and-sessions-in-sqlite.md)。

1. **单一权威库。** 每个用户数据目录一个 SQLite 文件（`<userData>/coko.db`），由 sidecar 独占打开（`node:sqlite` DatabaseSync）；main 与 renderer 只经协议访问。替代 TECH_STACK 原"Session 用 append-only JSONL、SQLite 仅作写者互斥"的约定。
2. **入库范围。** 设置（全局与用户级）、工作区登记、会话与会话条目（消息、工具调用意图/授权/结果、Goal/Plan/Task/Job/调度状态的版本化 payload）、待处理授权、Memory、分叉关系、checkpoint 元数据。不入库：运行日志（仍为 `desktop.jsonl` / `sidecar.jsonl`）、文件快照正文（内容寻址文件，库内只存引用）、凭据明文（见模型与凭据票）、项目级配置文件（仍在仓库内读取，只读覆盖）。
3. **所有权。** packages/session 拥有 schema、迁移、事务与提交屏障，对外暴露 SessionRepository、SettingsRepository、MemoryRepository 接口；SQLite 实现与内存实现分别从独立入口导出（`node:sqlite` 只在 SQLite 入口导入）。业务 payload 的含义、校验与迁移由 agent 通过注册接口提供，session 不反向导入 agent。
4. **提交屏障。** 每次提交是一个 `BEGIN IMMEDIATE` 事务；`COMMIT` 返回即为已提交事实。会话条目 append-only，带会话内单调 `seq`；payload 存 JSON 文本与 `type`/`version`。文本增量不逐条入库，按 message_end 提交完整消息（与 pi 研究结论一致）。
5. **打开序列。** 文件权限 0600 → `journal_mode=WAL`、`synchronous=FULL`、`foreign_keys=ON`、`busy_timeout` → STRICT 表 → 迁移 → 最后写 `user_version`。沿用 DSH storage-sqlite 的打开顺序与 rollback 失败隔离。
6. **迁移。** 编号前向迁移，每步一个事务；迁移前 `VACUUM INTO` 备份；库版本高于程序支持的版本时拒绝打开并报告 fatal，不降级写入。
7. **写者互斥。** main 用 Electron 单实例锁；sidecar 在库内 `host_lease` 表以事务获取租约（实例 ID、pid、心跳），租约被活跃实例持有时报告 fatal。
8. **损坏处理。** 打开时 `PRAGMA quick_check`；失败则把库文件改名隔离并报告 fatal，由桌面端提示用户（打开数据目录 / 新建空库），不静默重建。
9. **会话搜索。** FTS5 作为可选派生索引，可从会话条目重建；可用性取决于依赖安装研究对 Electron 41 `node:sqlite` 的验证结果，不可用时降级为 LIKE 搜索。

后果：TECH_STACK「服务端」表、[项目架构约定](../../../docs/tech-stack/architecture.md) 的模块与存储边界、agent-runtime 的 Session Persistence 行、日志约定中对 Session JSONL 的提及同步改写。

