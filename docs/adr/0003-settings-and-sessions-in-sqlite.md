---
kind: decision
description: "设置、会话及相关业务状态以 sidecar 独占的单个 SQLite 库为权威存储，替代 append-only JSONL 会话方案。修改持久化、迁移或存储边界时回看。"
status: accepted
implementation: partial
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
- 当前为 partial：packages/session 已实现打开序列、迁移、租约、损坏隔离与 Repository，并在 Electron 内置 Node 中验证打开与租约，见 [@coko/session](../../packages/session/README.md)；sidecar 装配与经协议的集成测试、业务 payload 注册接口、Memory 及 FTS5 索引尚未实现。

## 来源与后继

- 替代 [技术栈](../TECH_STACK.md) 原"Session 与执行记录为 append-only JSONL"的选型；该选型未单独记录 ADR，相关正文已同批改写。
- 进程模型见 [ADR 0001](0001-sidecar-on-electron-node.md)。
- 参考实现：DeepSeek Harness 的 `packages/storage/storage-sqlite` 与 `packages/session-query/session-query-sqlite`，本页已提炼所需结论。
