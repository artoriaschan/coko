# 02: 一次提交、一次存储

**What to build:** 用户在设置中提交 Provider 时，连接信息、Model Catalog 与可选的新 API Key 经 preload IPC 交给 main；main 加密 Key 后用一条控制消息交给 Sidecar，Sidecar 在一个事务中写入 Provider 与 Credential。HTTP 不再提供 Provider 创建与更新。编辑时 Key 留空保留原 Credential。

**Blocked by:** 01

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。

- [ ] 集成测试：一次保存后 Provider 与密文同时存在；任一部分写入失败时两者都不存在
- [ ] 加密不可用时 main 拒绝整次提交且不发送任何消息，库不变，界面提示原因并保留草稿
- [ ] 编辑时不带新 Key 保存，原 Credential 保持有效；带新 Key 时替换并清除 Sidecar 的明文缓存
- [ ] HTTP 的 Provider 创建与更新路由已移除，列表与删除仍可用
- [ ] 库、日志与 HTTP 响应中不含 Key 明文（复用秘密总闸扫描）
- [ ] Electron E2E：在设置中新建带 Key 的 Provider 后可调用本地兼容假服务
- [ ] ADR 0010 记录实施进展与证据，ADR 0004 的说明与索引同步
