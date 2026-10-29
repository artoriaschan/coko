# 07: 获取可用模型

**What to build:** 在新建或编辑表单点击“获取可用模型”，按表单中的协议、地址与 Key 获取候选模型并在弹窗中多选，添加到当前目录草稿。新建时用表单中填写的 Key，只用于这次请求、不保存；编辑时 Key 留空则使用已保存的 Credential。请求经 preload IPC → main → 控制消息由 Sidecar 发出。

**Blocked by:** 02、05

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉以 Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 为准（画面 07、07A、07B、08）；默认选择按规格为不选中，不按 07 画面的全选；加载、失败与空结果沿用源稿视觉语言。

- [x] MS-19 至 MS-28 通过
- [x] 集成测试：新建时的临时 Key 不进入库、日志、CredentialStore 缓存与任何 HTTP 响应；错误文本脱敏
- [x] 弹窗每行只显示模型 ID，保持返回顺序；按模型 ID 做不区分大小写的按序字符模糊匹配
- [x] 初次打开不选中；全选只作用于当前搜索结果中可新增的模型；修改搜索保留已选；已在目录的模型禁用且不计数
- [x] 导入模型显示名称为 ID、容量为默认值、输入类型为文本、推理关闭，按返回顺序追加；添加所选不保存供应商
- [x] 加载中按钮不可点；15 秒超时；失败显示错误与重试；空结果有说明；关闭弹窗取消请求
- [x] 切换协议或地址后已获取的候选作废；新建表单地址或 Key 未填时按钮不可点
- [x] 弹窗焦点管理与键盘操作可用

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

### 来自票 05

- 模型目录行（票 05 已合入）：`features/settings/catalog-draft.ts` 提供 `ModelRowDraft { key, id, name, contextWindow, maxTokens, input, reasoning, thinkingLevels }`（容量为输入原文，key 只作行身份）、`emptyModelRow()`、`rowsOf(models)`、`toCatalog(rows)`、`validateCatalog(rows)`（返回 `CatalogErrors = Record<rowKey, { id?, contextWindow?, maxTokens? }>`）、`pruneCatalogErrors`、`parseTokens` / `formatTokens`。`reasoning` 与 `thinkingLevels` 现在原样往返，没有界面。
- `provider-draft.ts`：`FormDraft.modelText` 已换成 `models: ModelRowDraft[]`；`DraftErrors` 增加 `catalog?: CatalogErrors`；`isDirty` 对 `models` 深比较（不含行 key）；`validateDraft` 与 `toProviderDraft` 使用目录行。`provider-form.tsx` 用 `<ModelCatalog>`，`updateModels` 在修改后去掉失效的行错误。
- `model-catalog.tsx`：`ModelCatalog { id, rows, onChange, errors?, emptyError?, revealErrors }`；展开状态在组件内，`revealErrors` 变化时展开有容量错误的行。收起与展开不进入草稿。
- DOM：行 `li[data-model-row][data-model-row-key]`，展开时带 `data-expanded`，有错误时带 `data-invalid`；输入 `[name=modelId|modelName|contextWindow|maxTokens]`；复选框 `[name=input-text|input-image]`；“添加模型”为 `[data-model-add]`；图标按钮的可访问名称为 `providers.catalog.options`（“模型选项”）和 `providers.catalog.remove`（“删除模型”）；模型显示名称的可访问名称为“模型显示名称”，与供应商的“显示名称”区分。i18n 新增 `providers.catalog.*`，删除 `modelsHint`。
- 测试：`catalog-draft.test.ts`、`provider-draft.test.ts`、`model-catalog.browser.test.tsx`；`models-section.browser.test.tsx` 有 `addModelRow`、`addModel`、`describedError` helper；e2e 的 `addCustomProvider` 改为点击 `[data-model-add]` 后填写 `modelId`（`settings.e2e` 的 `models` 参数为 `{ id, contextWindow? }[]`）。逐键输入前先等新行的模型 ID 获得焦点，切换协议后先等菜单关闭，否则 Radix 归还焦点会吞掉后半段字符。
- “获取可用模型”放在目录标题行（票 05 已留出位置）。导入的模型用 `{ ...emptyModelRow(), id, name: id }` 追加到 `draft.models`，按返回顺序；“已在目录”按 `ModelRowDraft.id` 判断。
- 并行提醒：票 06 与本票同时实施，两张票都改模型目录一带。可能冲突的位置：`model-catalog.tsx`（本票改目录标题行，票 06改 `ModelRow` 展开区和 `ModelRowField`）、`catalog-draft.ts`、i18n `providers.catalog.*`、`model-catalog.browser.test.tsx`，以及可能的 `provider-form.tsx`。只做本票需要的增量改动，并在 Comments 列出改过的共享位置；合入时由 merger 解决冲突。

### 来自票 06

- 推理档位配置（票 06 已合入）：`features/settings/thinking-levels-editor.tsx` 的 `ThinkingLevelsEditor { id, reasoning, levels, onChange(patch: { reasoning?, thinkingLevels? }) }` 放在 `model-catalog.tsx` 中 `ModelRow` 展开区的末尾：输入类型之后一条 0.5px 分隔线，再接编辑器。目录标题行没有改动，“获取可用模型”的位置仍空着。
- `thinking-levels.ts` 是纯函数：`nextLevel`、`addLevel`、`removeLevel`、`levelChoices`、`changeLevel`、`setLevelValue`、`normalizeLevels`。`catalog-draft.ts` 的 `toCatalog` 现在用 `normalizeLevels(row.thinkingLevels)` 整理档位：非 off 档位的参数值留空时用档位名。导入的模型 `reasoning: false`、`thinkingLevels: []`（`emptyModelRow` 的默认值），经 `normalizeLevels` 后不变。
- `@coko/ui` 新增 `Switch`（`packages/ui/src/components/switch.tsx`，基于 radix-ui，H20 全圆轨道）。本票如需开关可直接复用。
- DOM：开关 `role="switch"`、`name="reasoning"`，可访问名称“推理等级”（`providers.thinking.title`）；档位行 `li[data-thinking-level=<level>]`；选择器 `[data-thinking-select]`、菜单项 `[data-thinking-choice]`；参数输入 `[name="thinkingValue"]`；“添加档位” `[data-thinking-add]`。i18n 新增 `providers.thinking.*`（在 `providers.loadFailed` 之后）。
- 合入冲突提醒：本票与 06 并行实施。06 在 `model-catalog.tsx` 中加了 `ThinkingLevelsEditor` 的 import（与其他 import 相邻）和 `ModelRow` 展开区末尾的 2 行；`catalog-draft.ts` 加了 `normalizeLevels` 的 import 并改了 `toCatalog` 一行；`catalog-draft.test.ts` 末尾加了 1 个用例；i18n 在 `providers` 下加了 `thinking.*`。本票改 `model-catalog.tsx` 的 import 区或 i18n 的 `providers` 段时最可能冲突，合入时保留两边。

### 实施记录（ms-07，2026-10-29）

**覆盖的验收**

- MS-19：新建表单把表单中的 Key 经 `fetchProviderModels` → main → `provider.models { secret }` 只用于这一次请求（integration、e2e 断言供应商收到该 Key，用户数据目录与库、日志不含它）。
- MS-20：编辑且 Key 留空只带 `providerId`，Sidecar 用已保存的 Credential，地址改为其他主机也一样；填写新 Key 时用新 Key，且不替换已保存 Key 的明文缓存（integration：之后的请求仍为已保存的 Key、只解密一次）。
- MS-21 至 MS-25：弹窗每行只显示模型 ID 并保持返回顺序；初次计数 0、“添加所选”禁用；按序模糊匹配、不区分大小写；全选只作用于当前结果中可新增的模型；修改搜索保留已选；已在目录禁用且不计数；添加所选按返回顺序追加（名称为 ID、默认容量、文本、推理关闭），不调用 `saveProvider`，保存时随目录一次提交。
- MS-26：取消、关闭按钮与 Escape 都不修改目录；进行中的请求经 `cancelProviderModels` → `provider.models.cancel` 中止（integration 与 e2e 断言供应商一侧连接被关闭）。
- MS-27：main 与 Sidecar 各有 15 秒时限（main 超时后也发 cancel）；失败显示本地化说明、可展开的脱敏原文与“重试”；空结果有说明。
- MS-28：每次打开都按表单当前的协议、地址与 Key 重新获取，之前的候选不保留；目录不变。
- 集成：`secrets-gate-provider-models.test.ts` 扫描 WebSocket 帧、HTTP 响应体、sidecar→main 控制消息、库（含 -wal/-shm）与 sidecar.jsonl，临时 Key（含一个非 sk- 形态的）不出现；之后的 Run 仍用已保存的 Key。
- 焦点与键盘：打开时焦点在搜索框，Tab 到全选和候选，Space 勾选，Enter 触发“添加所选”；关闭后焦点回到“获取可用模型”；Escape 只关闭选择弹窗，不关闭设置。明暗主题截图人工检查过（未提交）。

**实际运行的命令与结果**（合入 model-service b568865 之后重跑）

- `pnpm run typecheck` 通过；`pnpm exec oxlint` 0 个错误；`pnpm exec oxfmt --check` 通过；`pnpm run check:docs` 检查 129 个文件，0 个问题。
- `vitest run --project protocol --project i18n --project scripts --project server --project desktop`：56 个文件，380 个用例通过。
- `vitest run --project desktop-renderer`：12 个文件，83 个用例通过（含 `fetch-models.browser.test.tsx` 9 个）。
- `vitest run tests/integration/secrets-gate`：10 个文件，12 个用例通过；`sidecar-provider-models`、`sidecar-settings-credentials`、`sidecar-provider-delete` 一并通过（6 个文件，23 个用例）。
- Electron E2E：`fetch-models`、`settings`、`provider-delete` 3 个文件，4 个用例通过，1 个跳过（既有的真实 DeepSeek 凭据用例，没有 `DEEPSEEK_API_KEY`）。

**负向确认**

- 先红：protocol、server、main、选择规则、弹窗 browser 测试在实现前均失败。
- 变异：跟随重定向、去掉错误文本脱敏 → server 单元测试失败；有 `providerId` 时优先已保存的 Key → integration 失败；去掉请求期间的按值登记 → 总闸失败（控制消息含非 sk- 形态的 Key）；main 不转发 `provider.models.result` → e2e 失败。
- 用 sk- 形态的 Key 把明文写进日志字段的变异没有被总闸发现，因为日志的形态脱敏已经替换了它；总闸因此加了一个非 sk- 形态的 Key。

**未验证项**：真实供应商的模型列表接口（只用本地兼容假服务）；Anthropic 列表只取一页（`limit=1000`），不跟随 `has_more` 分页。

**文档影响**：ADR 0010 记录获取可用模型已实施，`implementation` 改为 `implemented`（ADR 索引同步）；ADR 0004 的“部分实施”一句改为已实施；`docs/tech-stack/architecture.md` 加上 fetchProviderModels IPC；`apps/server/README.md` 的 Provider 一节与测试清单。

**改过的共享位置（与票 06 并行）**

- `model-catalog.tsx`：`ModelCatalog` 新增可选 prop `actions`，目录标题 `h4` 包进标题行 `div`，右侧放 `actions`。没有改 `ModelRow`。
- `provider-form.tsx`：计算 `fetchRequest`，向 `ModelCatalog` 传 `actions={<FetchModels …/>}`，并 import `FetchModels`。
- i18n：新增 `providers.fetchModels.*`（与 `providers.catalog.*` 并列，没有改 catalog 下的键）。
- `catalog-draft.ts`、`model-catalog.browser.test.tsx` 未改。`models-section.browser.test.tsx` 的键盘用例多按一次 Tab（“获取可用模型”在“添加模型”之前）。
- 合入 model-service（含票 06）时没有冲突。

**供后续票**

- 控制消息：`provider.models { requestId, api, baseUrl, providerId?, secret? }`、`provider.models.cancel { requestId }`、`provider.models.result`（`ok: true, models: string[]` 或 `ok: false, error: { code: ProviderModelsErrorCode, message, status? }`）。
- bridge：`fetchProviderModels(FetchProviderModelsInput)` → `FetchProviderModelsResult`，`cancelProviderModels(requestKey)`；IPC 通道 `coko:fetch-provider-models`（invoke）、`coko:cancel-provider-models`（send）。main：`createProviderModelsBridge`（`apps/desktop/src/main/provider-models.ts`）。server：`listProviderModels`、`serveProviderModels`（`apps/server/src/application/provider-models.ts`）。
- store：`settings.fetchProviderModels`、`settings.cancelProviderModels`；`createSettingsStore({ providerModels })`。
- 测试：renderer fake 有 `setCandidates`、`fetchProviderModels`（vi.fn）、`cancelProviderModels`、`holdFetch()`；集成 harness 有 `fetchModels(sidecar, request, { onSent })`。
- DOM：按钮 `[data-fetch-models]`；弹窗 `[data-fetch-models-dialog]`（与删除确认、“放弃更改？”区分）；候选行 `label[data-candidate=<id>]`，已在目录带 `data-in-catalog`；失败原文 `[data-error-detail]`。

