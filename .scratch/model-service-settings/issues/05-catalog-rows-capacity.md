# 05: 模型目录行与容量

**What to build:** 在新建与编辑表单的模型目录中添加模型行（新增后聚焦模型 ID）、填写模型 ID 与显示名称、删除行；展开模型选项后配置上下文窗口、最大输出 token 数与输入类型。目录随供应商一次提交。

**Blocked by:** 03

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉以 Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 为准（画面 02A、02B、04、05）。

- [ ] MS-12 至 MS-14 通过
- [ ] 空目录、空模型 ID 或重复 ID 阻止提交并标出出错的行；显示名称留空保存后显示为模型 ID
- [ ] 容量接受纯数字与 K/M（1000 进制），以 token 整数保存并带后缀回显；非正数或最大输出超过上下文窗口时报错；未填用默认 128K / 16K
- [ ] 收起与展开不改变草稿；删除行不额外确认
- [ ] 保存后重新打开表单与 registry 中的模型能力一致
- [ ] 目录不出现“恢复默认模型”

## Comments

### 来自票 09

- 设置菜单已分组（票 09 已合入）。分类“Models”/“模型”是 `role="group"` 的无障碍名称（`aria-labelledby` 指向分类标题），在设置弹窗内用 `getByLabelText('Models')` 会同时匹配该分组和表单字段。查询表单字段时改用带角色的查询，例如 `getByRole('textbox', { name: 'Models' })`；新增带“Models”/“模型”标签的控件同样按角色查询。
- 打开模型服务分区：菜单项文案为 `settings.nav.models`（“Model services”/“模型服务”），选择器 `[data-section=models]` 未变；分区页标题仍用 `settings.models` 等分区自己的键，与菜单文案分开。

### 来自票 01

- 数据模型（票 01 已合入）：Provider 没有 kind 与品牌预设，`Provider { id, name, api, baseUrl, models, credential, createdAt, updatedAt }`，ID 由用户输入并作主键，须符合 `PROVIDER_ID_PATTERN`（`^[a-z][a-z0-9-]{0,63}$`）。
- `CatalogModel { id, name, contextWindow, maxTokens, input, reasoning, thinkingLevels }`（`@coko/protocol`）与 agent 的 `ModelSpec` 同形，由编译期断言保证；name 为空表示显示为模型 ID；`thinkingLevels` 按添加顺序保存。默认容量为 `MODEL_CATALOG_DEFAULTS { contextWindow: 128000, maxTokens: 16000 }`。
- 服务端校验（`ModelConfigError` → 400）：目录非空、模型 ID 不重复、容量为正整数且 maxTokens ≤ contextWindow。界面校验应与之一致；未填容量时用 `MODEL_CATALOG_DEFAULTS`。
- 现有表单的模型目录是逗号分隔的模型 ID（`ProviderDraft.models: CatalogModel[]`，新模型取默认能力，已有模型保留其能力），由本票改为目录行。

### 来自票 02

- 一次保存（票 02 已合入）：协议用 `ProviderFields { id, name, api, baseUrl, models }`，取代已删除的 `CreateProviderRequest` / `UpdateProviderRequest`。保存只走一条控制消息 `provider.save { requestId, mode: 'create' | 'update', provider, credential?: { ciphertext, hint } }`，回复为 `provider.save.result`（`ok: true, provider` 或 `ok: false, error: { code, message, details? }`）。`credential.store` 已删除。
- renderer 经 `bridge.saveProvider({ mode, provider, secret? })` 提交，取代已删除的 `setCredential`。结果失败时为 `{ ok: false, code: ProviderSaveErrorCode, message, details? }`，`ProviderSaveErrorCode` 是 `'invalid-input' | 'encryption-unavailable' | 'sidecar-unavailable' | 'timeout'` 或 protocol `ErrorCode`（如 `already-exists`）。store 侧为 `settings.saveProvider(draft)`，返回 `SaveProviderResult`（不再有 `stage`）；编辑时 `draft.secret === ''` 表示保留原 Key。
- ApiClient 不再有 `createProvider` / `updateProvider`；HTTP 只保留 GET 与 DELETE `/api/providers`，POST / PATCH 返回 404。
- 测试：renderer fake（`apps/desktop/src/renderer/testing/fake-settings.ts`）用 `backend.seedProvider(fields, secret?)` 预置 Provider，用 `backend.saveProvider`（vi.fn）模拟和断言一次提交；`customProvider` 返回 `ProviderFields`。集成 harness（`tests/integration/sidecar-harness.ts`）有 `saveProvider(sidecar, fields, { mode?, secret? })`、`seedProviders(dirs, fields[])`、`answerDecrypts(sidecar)`、`testCipher`。独立运行的 sidecar 不能保存 Provider，要用 IPC 模式或 `seedProviders` 预置。
- 目录随 `ProviderFields.models` 经 `saveProvider` 一次提交；服务端校验失败（目录为空、重复模型 ID、容量不合法）通过 `provider.save.result` 返回错误，库不变。

### 来自票 08

- Session 档位（票 08 已合入）：protocol 有 `Session.thinkingLevel`、`CreateSessionRequest.thinkingLevel?`、`SetSessionModelRequest.thinkingLevel?` 和 `AvailableModel.thinkingLevels`。`AvailableModel.thinkingLevels` 总是含 off，推理开关打开时再加已配置档位，按固定顺序排列。ThinkingLevel 的定义在 `packages/protocol/src/http.ts` 中移到了 Session 之前。
- 可选档位的规则：agent 的 `selectableThinkingLevels(model)`；runtime 用 `setThinkingLevel(level)` 设置档位，Run 进行中调用会抛 `RuntimeBusyError`。server 用 `#effectiveLevel` 计算实际档位：保存的档位在当前目录中已不可选时，DTO 和请求都按 off 处理。因此修改目录后不需要迁移 Session。
- session：`Session.thinkingLevel: string`；`setSessionModel(id, model, thinkingLevel?)` 在档位缺省或模型为 null 时写 off。迁移 v5 新增 `sessions.thinking_level TEXT NOT NULL DEFAULT 'off'`，`SQLITE_SCHEMA_VERSION` 为 5，之后的迁移从 5 往上走。
- renderer：chat-store 有 `draftThinkingLevel` 和 `selectModel(model, thinkingLevel?)`。`ModelPicker` 新增必填属性 `thinkingLevel`，回调为 `onChange(model, thinkingLevel)`，并导出 `levelForModel`。档位项带 `data-thinking-level`。renderer fake 的 `models()` 按 Sidecar 的规则带 `thinkingLevels`。i18n 有 `models.thinkingLevel` 和 `models.thinkingLevels.{off…max}`，zh 的 off 为“关闭”。
- 目录行的推理开关关闭时，该模型在会话中只有 off。已填的档位留在目录中，由 `#effectiveLevel` 处理，不影响 Session。

### 来自票 03

- 文件拆分（票 03 已合入）：`features/settings/models-section.tsx` 负责列表、同一时间只展开一个表单、“放弃更改？”确认与离开守卫；`provider-form.tsx` 是表单，`ProviderForm` 的 props 为 `id, provider?, draft, onChange, takenIds, onCancel, onSaved`；`provider-draft.ts` 是纯函数：`FormDraft`、`emptyDraft`、`draftOf`、`isDirty`、`validateDraft`（返回 `DraftErrors`，值是字典键）、`toProviderDraft`。
- 草稿由 `ModelsSection` 持有（`OpenForm { key, id?, initial, draft }`）。`isDirty` 现在按 `FormDraft` 的键做浅比较，加入数组字段时要改为深比较。
- 字段错误：控件带 `aria-invalid`，`aria-describedby` 指向带 `data-field-error` 的说明（图标加文字）；提交时聚焦第一个 `[aria-invalid="true"]`。
- DOM 约定：列表项 `li[data-provider-id][data-protocol]`，展开时带 `data-expanded`；入口按钮 `[data-provider-add]`、`[data-provider-edit]`；表单 `form[data-provider-form="create"|"edit"]`；编辑表单中的静态 ID 为 `[data-provider-static-id]`；“放弃更改？”确认框为 `role="alertdialog"`。
- 离开守卫：分区用 `useSettingsDialog().setLeaveGuard(async () => boolean)` 登记，返回撤销函数；`setSection`、`close` 和换分区的 `show` 在守卫返回 true 后才生效。store 在 `app/settings-dialog-store.ts`。
- 测试 helper（`models-section.browser.test.tsx`）：`openModels(locale, seed)`、`row(id)`、`field(name)`、`errorOf(name)`、`settled()`。几何断言前先 `settled()` 等弹窗缩放动画结束；用键盘操作共享菜单时先等打开动画结束，再逐键发送方向键。
- 源码注释不要写票号：`scripts/source-references.test.ts` 会拒绝 apps、packages、tests 中的任务材料引用（合入 03 时因 `provider-draft.ts` 注释里的“票 05”失败过，已改）。
- 本票把 `FormDraft.modelText`（逗号分隔的过渡输入）换成模型行时，要同时扩展 `isDirty`（改为深比较）、`validateDraft` 和 `toProviderDraft`；现在空目录的错误键为 `providers.modelsRequired`。
- 并行提醒：票 04 与本票同时实施，两张票都改模型服务分区（`models-section.tsx`、`provider-form.tsx`、`provider-draft.ts`、`models-section.browser.test.tsx`、i18n 的 `providers.*`）。请只做本票需要的增量改动，并在 Comments 列出改过的共享位置；合入时由 merger 解决冲突。
