# 07: 获取可用模型

**What to build:** 在新建或编辑表单点击“获取可用模型”，按表单中的协议、地址与 Key 获取候选模型并在弹窗中多选，添加到当前目录草稿。新建时用表单中填写的 Key，只用于这次请求、不保存；编辑时 Key 留空则使用已保存的 Credential。请求经 preload IPC → main → 控制消息由 Sidecar 发出。

**Blocked by:** 02、05

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉以 Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 为准（画面 07、07A、07B、08）；默认选择按规格为不选中，不按 07 画面的全选；加载、失败与空结果沿用源稿视觉语言。

- [ ] MS-19 至 MS-28 通过
- [ ] 集成测试：新建时的临时 Key 不进入库、日志、CredentialStore 缓存与任何 HTTP 响应；错误文本脱敏
- [ ] 弹窗每行只显示模型 ID，保持返回顺序；按模型 ID 做不区分大小写的按序字符模糊匹配
- [ ] 初次打开不选中；全选只作用于当前搜索结果中可新增的模型；修改搜索保留已选；已在目录的模型禁用且不计数
- [ ] 导入模型显示名称为 ID、容量为默认值、输入类型为文本、推理关闭，按返回顺序追加；添加所选不保存供应商
- [ ] 加载中按钮不可点；15 秒超时；失败显示错误与重试；空结果有说明；关闭弹窗取消请求
- [ ] 切换协议或地址后已获取的候选作废；新建表单地址或 Key 未填时按钮不可点
- [ ] 弹窗焦点管理与键盘操作可用

## Comments

### 来自票 09

- 设置菜单已分组（票 09 已合入）。分类“Models”/“模型”是 `role="group"` 的无障碍名称（`aria-labelledby` 指向分类标题），在设置弹窗内用 `getByLabelText('Models')` 会同时匹配该分组和表单字段。查询表单字段时改用带角色的查询，例如 `getByRole('textbox', { name: 'Models' })`；新增带“Models”/“模型”标签的控件同样按角色查询。
- 打开模型服务分区：菜单项文案为 `settings.nav.models`（“Model services”/“模型服务”），选择器 `[data-section=models]` 未变；分区页标题仍用 `settings.models` 等分区自己的键，与菜单文案分开。

### 来自票 01

- 数据模型（票 01 已合入）：Provider 没有 kind 与品牌预设，`Provider { id, name, api, baseUrl, models, credential, createdAt, updatedAt }`，ID 由用户输入并作主键，须符合 `PROVIDER_ID_PATTERN`（`^[a-z][a-z0-9-]{0,63}$`）。
- `CatalogModel { id, name, contextWindow, maxTokens, input, reasoning, thinkingLevels }`（`@coko/protocol`）与 agent 的 `ModelSpec` 同形，由编译期断言保证；name 为空表示显示为模型 ID；`thinkingLevels` 按添加顺序保存。默认容量为 `MODEL_CATALOG_DEFAULTS { contextWindow: 128000, maxTokens: 16000 }`。
- 导入的模型按 `CatalogModel` 生成：name 为空或等于 ID、容量取 `MODEL_CATALOG_DEFAULTS`、`input` 为文本、`reasoning` 关闭、`thinkingLevels` 为空。“已在目录”按模型 ID 判断，服务端拒绝重复模型 ID（400）。
- 新的密钥输出通道要新增 `tests/integration/secrets-gate-<channel>.test.ts`；secrets-gate 现在用 `COKO_CREDENTIAL_GATE_PROVIDER` 提供密钥。

### 来自票 02

- 一次保存（票 02 已合入）：协议用 `ProviderFields { id, name, api, baseUrl, models }`，取代已删除的 `CreateProviderRequest` / `UpdateProviderRequest`。保存只走一条控制消息 `provider.save { requestId, mode: 'create' | 'update', provider, credential?: { ciphertext, hint } }`，回复为 `provider.save.result`（`ok: true, provider` 或 `ok: false, error: { code, message, details? }`）。`credential.store` 已删除。
- renderer 经 `bridge.saveProvider({ mode, provider, secret? })` 提交，取代已删除的 `setCredential`。结果失败时为 `{ ok: false, code: ProviderSaveErrorCode, message, details? }`，`ProviderSaveErrorCode` 是 `'invalid-input' | 'encryption-unavailable' | 'sidecar-unavailable' | 'timeout'` 或 protocol `ErrorCode`（如 `already-exists`）。store 侧为 `settings.saveProvider(draft)`，返回 `SaveProviderResult`（不再有 `stage`）；编辑时 `draft.secret === ''` 表示保留原 Key。
- ApiClient 不再有 `createProvider` / `updateProvider`；HTTP 只保留 GET 与 DELETE `/api/providers`，POST / PATCH 返回 404。
- 测试：renderer fake（`apps/desktop/src/renderer/testing/fake-settings.ts`）用 `backend.seedProvider(fields, secret?)` 预置 Provider，用 `backend.saveProvider`（vi.fn）模拟和断言一次提交；`customProvider` 返回 `ProviderFields`。集成 harness（`tests/integration/sidecar-harness.ts`）有 `saveProvider(sidecar, fields, { mode?, secret? })`、`seedProviders(dirs, fields[])`、`answerDecrypts(sidecar)`、`testCipher`。独立运行的 sidecar 不能保存 Provider，要用 IPC 模式或 `seedProviders` 预置。
- 获取模型通道可复用 main 的 `createCredentialBridge`（`apps/desktop/src/main/credentials.ts`）：同一个 `CredentialChannel`，用 request tracker 处理超时与 Sidecar 退出，并先按协议 schema 校验 renderer 输入。按须知新增 `tests/integration/secrets-gate-<channel>.test.ts`，参照 `secrets-gate-provider-save.test.ts`，它扫描 WS 帧、HTTP 响应体、sidecar→main 控制消息、库与日志。
- “添加所选不保存供应商”可以断言 `backend.saveProvider` 没有被调用。
