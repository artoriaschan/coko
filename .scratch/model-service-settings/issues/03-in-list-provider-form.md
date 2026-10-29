# 03: 列表内的连接表单

**What to build:** 模型服务页展示供应商列表；在列表底部新建、在列表项内编辑，同一时间只展开一个表单。新建表单含 Provider ID、显示名称、API 地址、API 协议与 API Key；编辑时 ID 为静态文本，Key 空值提示“留空则保留现有 Key”。有未保存修改时关闭或切换会提示“放弃更改？”。状态点以文字区分已配置 / 未配置 Key。

**Blocked by:** 02

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉以 Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 为准（画面 01、02、03、02D、04）；确认框与字段错误等源稿未覆盖的状态沿用源稿视觉语言与设计系统已有组件。

- [ ] MS-02 至 MS-11 通过（浏览器测试覆盖交互，Electron E2E 覆盖一次新建与编辑保存）
- [ ] 字段校验：ID 格式与重复（“ID 已被使用”）、显示名称必填、地址须为 http(s)、新建 Key 必填，错误不只靠颜色表达
- [ ] 协议下拉只有三项，默认 OpenAI Chat Completions
- [ ] 按钮文案始终为“编辑”；提交中按钮不可点，失败时表单底部显示错误并保留草稿
- [ ] 键盘可操作，焦点可见，明暗主题正确；几何符合规格第 6 节

## Comments

### 来自票 09

- 设置菜单已分组（票 09 已合入）。分类“Models”/“模型”是 `role="group"` 的无障碍名称（`aria-labelledby` 指向分类标题），在设置弹窗内用 `getByLabelText('Models')` 会同时匹配该分组和表单字段。查询表单字段时改用带角色的查询，例如 `getByRole('textbox', { name: 'Models' })`；新增带“Models”/“模型”标签的控件同样按角色查询。
- 打开模型服务分区：菜单项文案为 `settings.nav.models`（“Model services”/“模型服务”），选择器 `[data-section=models]` 未变；分区页标题仍用 `settings.models` 等分区自己的键，与菜单文案分开。

### 来自票 01

- 数据模型（票 01 已合入）：Provider 没有 kind 与品牌预设，`Provider { id, name, api, baseUrl, models, credential, createdAt, updatedAt }`，ID 由用户输入并作主键，须符合 `PROVIDER_ID_PATTERN`（`^[a-z][a-z0-9-]{0,63}$`）。
- `CatalogModel { id, name, contextWindow, maxTokens, input, reasoning, thinkingLevels }`（`@coko/protocol`）与 agent 的 `ModelSpec` 同形，由编译期断言保证；name 为空表示显示为模型 ID；`thinkingLevels` 按添加顺序保存。默认容量为 `MODEL_CATALOG_DEFAULTS { contextWindow: 128000, maxTokens: 16000 }`。
- 重复 ID 返回 409 `already-exists`（`details: { field: 'id', id }`），界面映射为“ID 已被使用”（i18n `providers.idTaken`）。现有 i18n：`providers.id`、`idHint`、`idInvalid`、`idTaken`、`protocol`、`protocols.*`、`baseUrlInvalid`；`kinds.*`、`baseUrlPresetHint`、`baseUrlRequired` 已删除。
- 现有过渡界面：`ProviderDraft { id, isNew, name, api, baseUrl, models: CatalogModel[], secret }`；表单字段 name 属性为 `providerId`、`name`、`baseUrl`、`models`、`credential`；协议下拉为 `DropdownMenuRadioItem[data-protocol]`；列表项 `[data-provider-id][data-protocol]`。模型目录暂为逗号分隔的模型 ID（新模型取默认能力，已有模型保留其能力），由本票及 05、06 重做。renderer 测试 helper 在 `apps/desktop/src/renderer/testing/fake-settings.ts`（`catalogModel`、`customProvider`）。

### 来自票 02

- 一次保存（票 02 已合入）：协议用 `ProviderFields { id, name, api, baseUrl, models }`，取代已删除的 `CreateProviderRequest` / `UpdateProviderRequest`。保存只走一条控制消息 `provider.save { requestId, mode: 'create' | 'update', provider, credential?: { ciphertext, hint } }`，回复为 `provider.save.result`（`ok: true, provider` 或 `ok: false, error: { code, message, details? }`）。`credential.store` 已删除。
- renderer 经 `bridge.saveProvider({ mode, provider, secret? })` 提交，取代已删除的 `setCredential`。结果失败时为 `{ ok: false, code: ProviderSaveErrorCode, message, details? }`，`ProviderSaveErrorCode` 是 `'invalid-input' | 'encryption-unavailable' | 'sidecar-unavailable' | 'timeout'` 或 protocol `ErrorCode`（如 `already-exists`）。store 侧为 `settings.saveProvider(draft)`，返回 `SaveProviderResult`（不再有 `stage`）；编辑时 `draft.secret === ''` 表示保留原 Key。
- ApiClient 不再有 `createProvider` / `updateProvider`；HTTP 只保留 GET 与 DELETE `/api/providers`，POST / PATCH 返回 404。
- 测试：renderer fake（`apps/desktop/src/renderer/testing/fake-settings.ts`）用 `backend.seedProvider(fields, secret?)` 预置 Provider，用 `backend.saveProvider`（vi.fn）模拟和断言一次提交；`customProvider` 返回 `ProviderFields`。集成 harness（`tests/integration/sidecar-harness.ts`）有 `saveProvider(sidecar, fields, { mode?, secret? })`、`seedProviders(dirs, fields[])`、`answerDecrypts(sidecar)`、`testCipher`。独立运行的 sidecar 不能保存 Provider，要用 IPC 模式或 `seedProviders` 预置。
- 新建必须带 Key（main 与表单都强制，i18n `providers.credentialRequired`）；失败文案为“未保存任何内容”，`credentialErrors.rejected` 已删除。过渡表单 `models-section.tsx` 已去掉“配置已存、Key 失败转为编辑”的分支，按 `code` 映射错误，本票重做表单时沿用 `saveProvider` 的结果映射，失败时保留草稿。
