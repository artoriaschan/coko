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

## Comments

### 来自票 01

- 数据模型（票 01 已合入）：Provider 没有 kind 与品牌预设，`Provider { id, name, api, baseUrl, models, credential, createdAt, updatedAt }`，ID 由用户输入并作主键，须符合 `PROVIDER_ID_PATTERN`（`^[a-z][a-z0-9-]{0,63}$`）。
- `CatalogModel { id, name, contextWindow, maxTokens, input, reasoning, thinkingLevels }`（`@coko/protocol`）与 agent 的 `ModelSpec` 同形，由编译期断言保证；name 为空表示显示为模型 ID；`thinkingLevels` 按添加顺序保存。默认容量为 `MODEL_CATALOG_DEFAULTS { contextWindow: 128000, maxTokens: 16000 }`。
- 重复 ID：`ProviderService.create` 先校验再写库，重复时抛 `AppError('already-exists')`，HTTP 为 409，`details: { field: 'id', id }`；session 仓库的 `StoreErrorCode` 也有 `already-exists`。一次保存通道应沿用这个错误码，库保持不变。
- HTTP 仍保留 Provider 的创建（POST `/api/providers`）与更新（PATCH `/api/providers/:id`），由本票移除。`CreateProviderRequest { id, name, api, baseUrl, models }`，`UpdateProviderRequest` 不含 id。
- 校验（`ModelConfigError` → 400）：http(s) 地址、目录非空、模型 ID 不重复、容量为正整数且 maxTokens ≤ contextWindow、档位不重复。server 的 `catalogOf`、`toProviderConfig`、`toProviderDto` 在 `apps/server/src/application/providers.ts`。
- 独立运行只读 `COKO_CREDENTIAL_<PROVIDER_ID>`；secrets-gate 测试改用 `COKO_CREDENTIAL_GATE_PROVIDER`。测试 helper：`tests/integration/sidecar-harness.ts` 的 `catalogModel`、`customProvider`。
- ADR 0010 现为 `implementation: partial`，正文写明已实施的是去 kind、ID 主键、迁移 v4 与环境变量；本票交付一次提交与一次存储后，按 ADR 的“变为 implemented 前需要”更新已实施范围。
