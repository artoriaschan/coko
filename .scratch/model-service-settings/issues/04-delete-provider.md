# 04: 删除供应商

**What to build:** 用户点击某供应商的“删除”后看到二次确认，确认框写明引用它的 Session 数量。确认后供应商与其 Credential 被删除，引用它的 Session 模型字段被清空并在下次运行前提示重新选择模型，默认模型指向它时回退为第一个可用模型。

**Blocked by:** 03

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉以 Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 为准；确认框沿用设计系统已有组件。

- [ ] MS-32、MS-33 通过
- [ ] 确认框显示的引用数量与库中实际一致；取消时不做任何修改
- [ ] 删除后用相同 ID 重新创建，原 Session 不会自动使用新供应商
- [ ] 删除后 Sidecar 的明文缓存被清除；库中没有该 Credential

## Comments

### 来自票 01

- 迁移 v4（票 01 已合入）会先备份，再清除旧 Provider、Credential、默认模型，并把引用它们的 Session 模型字段置空。现在 Run 遇到空模型字段时按原逻辑自动选用默认模型（有其他 Provider 时）；规格要求的“下次运行前提示重新选择模型”没有在票 01 实现，归本票。
- 数据模型：Provider ID 是用户输入的主键（`PROVIDER_ID_PATTERN`），删除和 Session 引用都按这个 ID 处理；session `SQLITE_SCHEMA_VERSION` 为 4，迁移证据见 `packages/session/src/sqlite/migrate-v4.test.ts`。
- 重复 ID 的错误码 `already-exists`（HTTP 409）已加入 protocol `ErrorCode` 与 session `StoreErrorCode`。

### 来自票 02

- 一次保存（票 02 已合入）：协议用 `ProviderFields { id, name, api, baseUrl, models }`，取代已删除的 `CreateProviderRequest` / `UpdateProviderRequest`。保存只走一条控制消息 `provider.save { requestId, mode: 'create' | 'update', provider, credential?: { ciphertext, hint } }`，回复为 `provider.save.result`（`ok: true, provider` 或 `ok: false, error: { code, message, details? }`）。`credential.store` 已删除。
- renderer 经 `bridge.saveProvider({ mode, provider, secret? })` 提交，取代已删除的 `setCredential`。结果失败时为 `{ ok: false, code: ProviderSaveErrorCode, message, details? }`，`ProviderSaveErrorCode` 是 `'invalid-input' | 'encryption-unavailable' | 'sidecar-unavailable' | 'timeout'` 或 protocol `ErrorCode`（如 `already-exists`）。store 侧为 `settings.saveProvider(draft)`，返回 `SaveProviderResult`（不再有 `stage`）；编辑时 `draft.secret === ''` 表示保留原 Key。
- ApiClient 不再有 `createProvider` / `updateProvider`；HTTP 只保留 GET 与 DELETE `/api/providers`，POST / PATCH 返回 404。
- 测试：renderer fake（`apps/desktop/src/renderer/testing/fake-settings.ts`）用 `backend.seedProvider(fields, secret?)` 预置 Provider，用 `backend.saveProvider`（vi.fn）模拟和断言一次提交；`customProvider` 返回 `ProviderFields`。集成 harness（`tests/integration/sidecar-harness.ts`）有 `saveProvider(sidecar, fields, { mode?, secret? })`、`seedProviders(dirs, fields[])`、`answerDecrypts(sidecar)`、`testCipher`。独立运行的 sidecar 不能保存 Provider，要用 IPC 模式或 `seedProviders` 预置。
- 删除仍走 HTTP DELETE `/api/providers/:id`，不经 `provider.save`。删除场景的测试用 `backend.seedProvider` 或 harness 的 `seedProviders` 预置 Provider。
