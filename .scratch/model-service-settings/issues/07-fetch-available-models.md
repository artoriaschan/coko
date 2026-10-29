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

### 来自票 08

- Session 档位（票 08 已合入）：protocol 有 `Session.thinkingLevel`、`CreateSessionRequest.thinkingLevel?`、`SetSessionModelRequest.thinkingLevel?` 和 `AvailableModel.thinkingLevels`。`AvailableModel.thinkingLevels` 总是含 off，推理开关打开时再加已配置档位，按固定顺序排列。ThinkingLevel 的定义在 `packages/protocol/src/http.ts` 中移到了 Session 之前。
- 可选档位的规则：agent 的 `selectableThinkingLevels(model)`；runtime 用 `setThinkingLevel(level)` 设置档位，Run 进行中调用会抛 `RuntimeBusyError`。server 用 `#effectiveLevel` 计算实际档位：保存的档位在当前目录中已不可选时，DTO 和请求都按 off 处理。因此修改目录后不需要迁移 Session。
- session：`Session.thinkingLevel: string`；`setSessionModel(id, model, thinkingLevel?)` 在档位缺省或模型为 null 时写 off。迁移 v5 新增 `sessions.thinking_level TEXT NOT NULL DEFAULT 'off'`，`SQLITE_SCHEMA_VERSION` 为 5，之后的迁移从 5 往上走。
- renderer：chat-store 有 `draftThinkingLevel` 和 `selectModel(model, thinkingLevel?)`。`ModelPicker` 新增必填属性 `thinkingLevel`，回调为 `onChange(model, thinkingLevel)`，并导出 `levelForModel`。档位项带 `data-thinking-level`。renderer fake 的 `models()` 按 Sidecar 的规则带 `thinkingLevels`。i18n 有 `models.thinkingLevel` 和 `models.thinkingLevels.{off…max}`，zh 的 off 为“关闭”。
- 导入的模型推理开关关闭，所以 `AvailableModel.thinkingLevels` 为 `['off']`，会话里不出现档位分组。

### 来自票 03

- 文件拆分（票 03 已合入）：`features/settings/models-section.tsx` 负责列表、同一时间只展开一个表单、“放弃更改？”确认与离开守卫；`provider-form.tsx` 是表单，`ProviderForm` 的 props 为 `id, provider?, draft, onChange, takenIds, onCancel, onSaved`；`provider-draft.ts` 是纯函数：`FormDraft`、`emptyDraft`、`draftOf`、`isDirty`、`validateDraft`（返回 `DraftErrors`，值是字典键）、`toProviderDraft`。
- 草稿由 `ModelsSection` 持有（`OpenForm { key, id?, initial, draft }`）。`isDirty` 现在按 `FormDraft` 的键做浅比较，加入数组字段时要改为深比较。
- 字段错误：控件带 `aria-invalid`，`aria-describedby` 指向带 `data-field-error` 的说明（图标加文字）；提交时聚焦第一个 `[aria-invalid="true"]`。
- DOM 约定：列表项 `li[data-provider-id][data-protocol]`，展开时带 `data-expanded`；入口按钮 `[data-provider-add]`、`[data-provider-edit]`；表单 `form[data-provider-form="create"|"edit"]`；编辑表单中的静态 ID 为 `[data-provider-static-id]`；“放弃更改？”确认框为 `role="alertdialog"`。
- 离开守卫：分区用 `useSettingsDialog().setLeaveGuard(async () => boolean)` 登记，返回撤销函数；`setSection`、`close` 和换分区的 `show` 在守卫返回 true 后才生效。store 在 `app/settings-dialog-store.ts`。
- 测试 helper（`models-section.browser.test.tsx`）：`openModels(locale, seed)`、`row(id)`、`field(name)`、`errorOf(name)`、`settled()`。几何断言前先 `settled()` 等弹窗缩放动画结束；用键盘操作共享菜单时先等打开动画结束，再逐键发送方向键。
- 源码注释不要写票号：`scripts/source-references.test.ts` 会拒绝 apps、packages、tests 中的任务材料引用（合入 03 时因 `provider-draft.ts` 注释里的“票 05”失败过，已改）。
- “获取可用模型”弹窗不需要接入离开守卫。导入的模型追加到 05 的模型行草稿中，不调用保存。

### 来自票 04

- 删除供应商（票 04 已合入）：新文件 `features/settings/delete-provider-dialog.tsx`（`DeleteProviderDialog`、`DeleteProviderRequest`）。确认框打开时经 `GET /api/providers/:id/references`（`ProviderReferencesResponse { sessions }`）读取引用数量；确认后同一事务删除 Provider 与 Credential，引用它的 Session 模型字段清空且档位为 off，`defaultModel` 指向它时改为 null（回退为第一个可用模型），sidecar 清除明文缓存。
- DOM：确认框 `[data-delete-provider-dialog]`（`role="alertdialog"`，与“放弃更改？”同为 alertdialog，查询时按名称或 data 属性区分）；数量区 `[data-provider-references="loading"|"ready"|"error"]`；行内删除按钮 `[data-provider-delete]`；输入区提示 `[data-slot="model-required"]`。
- store 与 API：`settings.providerReferences(id)`（失败抛 `ApiError`）、`createSettingsStore({ onProviderDeleted })`；ApiClient 新增 `providerReferences(id)`；protocol `apiPaths.providerReferences`、`ErrorCode` 新增 `model-required`；session `ProviderRepository.references(id)`、`delete(id): Promise<ProviderReferences>`。
- 行为变化：Session 模型字段为空且有可用模型时，Run 返回 409 `model-required`，不再自动选用默认模型；没有任何可用模型时仍为 `model-not-configured`。新建 Session 仍在创建时取默认模型。
- 测试：renderer fake（`testing/fake-settings.ts`）的 api 新增 `providerReferences`（vi.fn），`deleteProvider` 同时清掉引用数，返回值新增 `setReferences(id, n)`；`testing/fixture-chat.ts` 新增 `sessions` 选项。参考 `tests/integration/sidecar-provider-delete.test.ts`、`apps/desktop/e2e/provider-delete.e2e.test.ts`、`features/settings/delete-provider.browser.test.tsx`。
- 本票的“获取可用模型”弹窗与删除确认框、“放弃更改？”确认框共存于设置弹窗中，测试查询弹窗时用本票自己的 data 属性或名称，不要只按 `role` 查询。保留票 04 在 `fake-settings.ts` 中的 `providerReferences` 与 `setReferences`。
