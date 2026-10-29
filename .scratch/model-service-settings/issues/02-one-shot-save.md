# 02: 一次提交、一次存储

**What to build:** 用户在设置中提交 Provider 时，连接信息、Model Catalog 与可选的新 API Key 经 preload IPC 交给 main；main 加密 Key 后用一条控制消息交给 Sidecar，Sidecar 在一个事务中写入 Provider 与 Credential。HTTP 不再提供 Provider 创建与更新。编辑时 Key 留空保留原 Credential。

**Blocked by:** 01

**Status:** ready-for-review

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。

- [x] 集成测试：一次保存后 Provider 与密文同时存在；任一部分写入失败时两者都不存在
- [x] 加密不可用时 main 拒绝整次提交且不发送任何消息，库不变，界面提示原因并保留草稿
- [x] 编辑时不带新 Key 保存，原 Credential 保持有效；带新 Key 时替换并清除 Sidecar 的明文缓存
- [x] HTTP 的 Provider 创建与更新路由已移除，列表与删除仍可用
- [x] 库、日志与 HTTP 响应中不含 Key 明文（复用秘密总闸扫描）
- [x] Electron E2E：在设置中新建带 Key 的 Provider 后可调用本地兼容假服务
- [x] ADR 0010 记录实施进展与证据，ADR 0004 的说明与索引同步

## Comments

### 来自票 01

- 数据模型（票 01 已合入）：Provider 没有 kind 与品牌预设，`Provider { id, name, api, baseUrl, models, credential, createdAt, updatedAt }`，ID 由用户输入并作主键，须符合 `PROVIDER_ID_PATTERN`（`^[a-z][a-z0-9-]{0,63}$`）。
- `CatalogModel { id, name, contextWindow, maxTokens, input, reasoning, thinkingLevels }`（`@coko/protocol`）与 agent 的 `ModelSpec` 同形，由编译期断言保证；name 为空表示显示为模型 ID；`thinkingLevels` 按添加顺序保存。默认容量为 `MODEL_CATALOG_DEFAULTS { contextWindow: 128000, maxTokens: 16000 }`。
- 重复 ID：`ProviderService.create` 先校验再写库，重复时抛 `AppError('already-exists')`，HTTP 为 409，`details: { field: 'id', id }`；session 仓库的 `StoreErrorCode` 也有 `already-exists`。一次保存通道应沿用这个错误码，库保持不变。
- HTTP 仍保留 Provider 的创建（POST `/api/providers`）与更新（PATCH `/api/providers/:id`），由本票移除。`CreateProviderRequest { id, name, api, baseUrl, models }`，`UpdateProviderRequest` 不含 id。
- 校验（`ModelConfigError` → 400）：http(s) 地址、目录非空、模型 ID 不重复、容量为正整数且 maxTokens ≤ contextWindow、档位不重复。server 的 `catalogOf`、`toProviderConfig`、`toProviderDto` 在 `apps/server/src/application/providers.ts`。
- 独立运行只读 `COKO_CREDENTIAL_<PROVIDER_ID>`；secrets-gate 测试改用 `COKO_CREDENTIAL_GATE_PROVIDER`。测试 helper：`tests/integration/sidecar-harness.ts` 的 `catalogModel`、`customProvider`。
- ADR 0010 现为 `implementation: partial`，正文写明已实施的是去 kind、ID 主键、迁移 v4 与环境变量；本票交付一次提交与一次存储后，按 ADR 的“变为 implemented 前需要”更新已实施范围。

### 实施记录（ms-02，2026-10-29）

分支 `ms/02-one-shot-save`，已合入 model-service 最新提交（e13f847）。

- **覆盖的验收**（全部勾选）：
  - 一次保存后 Provider 与密文同时存在，任一部分失败时都不存在：`packages/session/src/sqlite/sqlite.test.ts`「SQLite 一次存储」用触发器让密文写入失败，新建与修改都回滚；仓库契约新增 create / update 带 credential 的用例；`tests/integration/sidecar-settings-credentials.test.ts` 中无效目录、重复 ID、修改不存在的 Provider 带 Key 提交后，配置与提示都不变。
  - 加密不可用时 main 拒绝且不发消息：`apps/desktop/src/main/credentials.test.ts`（不可用与 encrypt 抛错两种）；界面提示原因并保留草稿：`app.browser.test.tsx`「Models：新建 Provider 只回显末四位……」。
  - 编辑不带 Key 保留原 Credential，带新 Key 替换并清缓存：集成测试「编辑：……」（第二次请求不再解密、换 Key 后重新解密且 Authorization 为新 Key）。
  - HTTP POST / PATCH `/api/providers` 返回 404，GET 与 DELETE 可用：集成测试与 settings E2E。
  - 秘密总闸：新增 `tests/integration/secrets-gate-provider-save.test.ts`（新建、保留、替换 Key 与失败提交；扫描 WS 帧、HTTP 响应体、sidecar→main 控制消息、库与日志）。
  - Electron E2E：`apps/desktop/e2e/settings.e2e.test.ts` 在设置中新建带 Key 的 Provider 后调用本地兼容假服务，并断言 HTTP 不能创建或修改 Provider。
  - ADR 0010 新增“一次提交、一次存储已实施”进展与证据（仍为 partial：获取可用模型由票 07 实施）；ADR 0004 写入通道说明同步；索引状态不变。
- **实际运行的命令与结果**（合并后）：`npx tsc -b` 退出 0；`pnpm run lint` 0 错误；`pnpm run format:check` 通过；`pnpm run check:docs` 129 文件 0 问题；`pnpm run test packages/session packages/protocol packages/i18n apps/server apps/desktop/src` 62 文件 394 用例通过（含 Browser Mode）；`pnpm run test tests/integration` 34 文件 133 用例通过；`pnpm run test apps/desktop/e2e/settings.e2e.test.ts apps/desktop/e2e/desktop-shell.e2e.test.ts` 14 通过、1 跳过（真实 DeepSeek，无宿主密钥）。
- **负向确认**：各新测试先红（协议、main bridge、settings-store、集成）；变异：把密文写入移到第二个事务后回滚测试失败；去掉 `invalidateCredential` 后集成“编辑”用例与 providers 单测失败。均已还原。
- **未验证**：真实模型服务；加密不可用的 Electron 实机路径（只有单元与 Browser Mode）；产物 smoke 未单独运行（E2E globalSetup 已执行 package 构建）。
- **文档影响**：ADR 0010、ADR 0004、`docs/tech-stack/architecture.md`、`apps/server/README.md`、`packages/session/README.md`。
- **设计取舍**：新建必须带 Key 由 main 与表单强制；sidecar 的 `provider.save` 允许新建不带 credential，供独立运行测试的预置（`seedProviders`）与环境变量模式使用。独立运行的 sidecar 不能保存 Provider（ADR 0010 后果一节已预见）。
- **越出写范围**：`packages/session`（ProviderRepository 的 create / update 增加可选 credential，同一事务写入）；`packages/i18n` 字典（新增 `providers.credentialRequired`，删去 `credentialErrors.rejected`，文案改为“未保存任何内容”）；`models-section.tsx` 只做适配（去掉“配置已存、Key 失败转为编辑”的分支，新建时 Key 必填，错误码映射）。

### 供后续票

- 协议（`@coko/protocol`）：`ProviderFields { id, name, api, baseUrl, models }`（取代已删除的 `CreateProviderRequest` / `UpdateProviderRequest`）、`ProviderSaveMode = 'create' | 'update'`；控制消息 `MainProviderSave`（`provider.save { requestId, mode, provider, credential?: { ciphertext, hint } }`）与 `SidecarProviderSaveResult`（`provider.save.result`，`ok: true, provider` 或 `ok: false, error: { code: ErrorCode, message, details? }`）。`credential.store` / `credential.store.result` 已删除；`credential.decrypt` 不变。
- bridge（`apps/desktop/src/shared/bridge.ts`）：`IPC.saveProvider = 'coko:save-provider'`；`CokoBridge.saveProvider(input: SaveProviderInput): Promise<SaveProviderResult>`；`SaveProviderInput { mode, provider: ProviderFields, secret? }`；`SaveProviderResult` 失败为 `{ ok: false, code: ProviderSaveErrorCode, message, details? }`，`ProviderSaveErrorCode = 'invalid-input' | 'encryption-unavailable' | 'sidecar-unavailable' | 'timeout' | ErrorCode`。`setCredential` 已删除。
- renderer：`SettingsStoreOptions.saveProvider`；`settings.saveProvider(draft: ProviderDraft)` 返回 `SaveProviderResult`（不再有 `stage`）；编辑时 `draft.secret === ''` 表示保留原 Key。ApiClient 不再有 `createProvider` / `updateProvider`。
- 测试：renderer fake 用 `backend.seedProvider(fields, secret?)` 预置、`backend.saveProvider`（vi.fn）模拟一次提交；集成 harness 新增 `saveProvider(sidecar, fields, { mode?, secret? })`、`seedProviders(dirs, fields[])`、`answerDecrypts(sidecar)`、`testCipher`；`customProvider` 返回 `ProviderFields`。
- 票 07 的获取模型通道可复用 main 的 `createCredentialBridge`（同一 `CredentialChannel` 与 request tracker 模式），并按须知新增 `secrets-gate-<channel>.test.ts`。
