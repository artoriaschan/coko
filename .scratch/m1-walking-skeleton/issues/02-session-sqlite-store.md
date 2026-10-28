# 02: SQLite 存储：Session、设置与 Provider

**What to build:** packages/session 提供 SessionRepository、SettingsRepository、ProviderRepository 接口，以及 SQLite 实现（`node:sqlite`）与内存实现，满足 [ADR 0003](../../../docs/adr/0003-settings-and-sessions-in-sqlite.md) 的打开序列、迁移、备份、租约与损坏隔离。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 在临时目录：创建 workspace / session / entries 后关闭并重新打开，读回内容与 seq 一致
- [ ] 设置更新 revision 不匹配时返回冲突
- [ ] 第二个实例获取租约失败并得到明确错误
- [ ] 损坏文件被改名隔离并返回 fatal 错误；库版本高于程序版本时拒绝打开
- [ ] 同一组仓库契约测试对 SQLite 与内存实现都通过
- [ ] 以 `ELECTRON_RUN_AS_NODE=1` 运行的测试覆盖打开与租约，并记录 FTS5 是否可用

## Comments
