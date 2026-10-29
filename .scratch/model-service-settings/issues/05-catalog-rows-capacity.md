# 05: 模型目录行与容量

**What to build:** 在新建与编辑表单的模型目录中添加模型行（新增后聚焦模型 ID）、填写模型 ID 与显示名称、删除行；展开模型选项后配置上下文窗口、最大输出 token 数与输入类型。目录随供应商一次提交。

**Blocked by:** 03

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉以 Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 为准（画面 02A、02B、04、05）。

- [x] MS-12 至 MS-14 通过
- [x] 空目录、空模型 ID 或重复 ID 阻止提交并标出出错的行；显示名称留空保存后显示为模型 ID
- [x] 容量接受纯数字与 K/M（1000 进制），以 token 整数保存并带后缀回显；非正数或最大输出超过上下文窗口时报错；未填用默认 128K / 16K
- [x] 收起与展开不改变草稿；删除行不额外确认
- [x] 保存后重新打开表单与 registry 中的模型能力一致
- [x] 目录不出现“恢复默认模型”

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

### 来自票 04

- 删除供应商（票 04 已合入）：新文件 `features/settings/delete-provider-dialog.tsx`（`DeleteProviderDialog`、`DeleteProviderRequest`）。确认框打开时经 `GET /api/providers/:id/references`（`ProviderReferencesResponse { sessions }`）读取引用数量；确认后同一事务删除 Provider 与 Credential，引用它的 Session 模型字段清空且档位为 off，`defaultModel` 指向它时改为 null（回退为第一个可用模型），sidecar 清除明文缓存。
- DOM：确认框 `[data-delete-provider-dialog]`（`role="alertdialog"`，与“放弃更改？”同为 alertdialog，查询时按名称或 data 属性区分）；数量区 `[data-provider-references="loading"|"ready"|"error"]`；行内删除按钮 `[data-provider-delete]`；输入区提示 `[data-slot="model-required"]`。
- store 与 API：`settings.providerReferences(id)`（失败抛 `ApiError`）、`createSettingsStore({ onProviderDeleted })`；ApiClient 新增 `providerReferences(id)`；protocol `apiPaths.providerReferences`、`ErrorCode` 新增 `model-required`；session `ProviderRepository.references(id)`、`delete(id): Promise<ProviderReferences>`。
- 行为变化：Session 模型字段为空且有可用模型时，Run 返回 409 `model-required`，不再自动选用默认模型；没有任何可用模型时仍为 `model-not-configured`。新建 Session 仍在创建时取默认模型。
- 测试：renderer fake（`testing/fake-settings.ts`）的 api 新增 `providerReferences`（vi.fn），`deleteProvider` 同时清掉引用数，返回值新增 `setReferences(id, n)`；`testing/fixture-chat.ts` 新增 `sessions` 选项。参考 `tests/integration/sidecar-provider-delete.test.ts`、`apps/desktop/e2e/provider-delete.e2e.test.ts`、`features/settings/delete-provider.browser.test.tsx`。
- 合入冲突点（票 04 已先合入，本票并行实施）：
  - `models-section.tsx`：行内“确认删除”已删除；`ProviderRow` 新增 `onDelete` 属性，删除按钮带 `data-provider-delete`；分区新增 `deleting` 状态并渲染 `DeleteProviderDialog`（`focusAfterClose`）；去掉了 `toast` 与 `useSettingsActions().deleteProvider` 的行内用法；`providers.map` 带 `index`。
  - i18n `providers.*`：`providers.confirmDelete` 已删除，新增 `providers.deleteDialog.{title,description,counting,references,noReferences,referencesFailed}`；另增 `errors.modelRequired`、`conversation.modelRequired`。
  - `testing/fake-settings.ts`：新增 `providerReferences` 与 `setReferences`。
  - `models-section.browser.test.tsx` 最后一个用例的删除改为点确认框的 “Delete”。
  合入 model-service 时保留这些改动，只叠加本票的模型行。

### 实施记录（ms/05-catalog-rows-capacity）

覆盖的验收：

- MS-12：“添加模型”每次在末尾新增空行并聚焦模型 ID；行内填写 ID 与显示名称、右箭头展开（`aria-expanded`，图标改为向下）、删除不确认，焦点移到相邻行或“添加模型”（`model-catalog.browser.test.tsx` 用例 1）。
- MS-13：空目录的错误关联在“添加模型”上并聚焦它；空 ID 与重复 ID（每个重复行都标出）带 `aria-invalid` 与 `data-field-error` 文字，行带 `data-invalid`，阻止提交并聚焦第一个出错行；名称留空保存为 `''`，再次打开时名称输入框以模型 ID 为占位（用例 2；纯函数见 `catalog-draft.test.ts`）。registry 本身已有 `name || id`，会话选择器显示 ID 由已有代码保证。
- MS-14：`1M` → 1 000 000、`128K` → 128 000；`0`、非数字报“请输入正整数…”，最大输出超过上下文窗口（留空按默认 128K / 16K 比较）报在最大输出上；收起的出错行在提交时自动展开并聚焦（用例 3）。回显规则：可整除到一位小数时用最大后缀（`1.5M`），否则显示原数（131072 不显示为 `131.072K`）。
- 收起与展开只是显示状态，不进入草稿，不触发“放弃更改？”（用例 4）；`isDirty` 改为按目录内容深比较，不含行 key（`provider-draft.test.ts`）。
- 保存后一致：浏览器用例 4 保存后再次打开回显与库一致；Electron E2E 新建时填上下文窗口 `1M`，`GET /api/workspaces/:id/context` 的 `contextWindow`（来自 registry）为 1 000 000，重新打开表单回显 `1M` / `16K`。
- 目录不出现“恢复默认模型”（用例 1 断言表单文字）。

实际运行的命令与结果：

- `pnpm run typecheck`：退出 0。
- `pnpm run lint`：0 warning，0 error（546 文件）；`pnpm run format:check`：通过（572 文件）。
- `pnpm run test apps/desktop/src/renderer`：24 个文件，166 个用例全部通过，连续 3 次（其中新增 `catalog-draft.test.ts` 31、`provider-draft.test.ts` 4、`model-catalog.browser.test.tsx` 5）。
- `pnpm run test packages/i18n packages/ui/src/guards scripts tests/integration/secrets-gate`：15 个文件，86 个用例通过（含 zh/en 键一致、样式守卫与源码任务引用检查）。
- `pnpm run test apps/desktop/e2e/settings.e2e.test.ts`：2 通过，1 跳过（真实 DeepSeek，无 `DEEPSEEK_API_KEY`）。

负向确认：先红（模块缺失、`modelText` 旧行为、组件缺失）后绿；变异各自使对应用例失败后恢复：去掉提交时展开出错行（用例 3 失败）、去掉重复 ID 检查（单元与用例 2 失败）、去掉新增后聚焦（用例 1–3 失败）、去掉后缀回显（单元 7 条与用例 3 失败）。

合入前修过的不稳定点：协议菜单关闭后 Radix 把焦点还给触发按钮，若紧接着点击“添加模型”并逐键输入，后半段字符会落到别处。测试 helper 改为等新行模型 ID 获得焦点后再 `fill`，并在切换协议后等菜单关闭。

未验证：真实模型；Electron 中的深色主题与 390px 窄窗口目视检查（浏览器用例只断言深色语义色变化与 H32/R12、H28/R8、行 R16 几何）；registry 一致性在 E2E 中只核对了上下文窗口，最大输出与输入类型由浏览器用例经 fake 的库读回核对。

视觉与规格说明：

- 行为 R16、0.5px `card-stroke` 描边；展开时加 `bg-muted` 背景。收起与展开使用相同内边距 10px（源稿展开为 12px），避免切换时内容移位。
- 目录标题区留出操作位置但本票不放“获取可用模型”（票 07）；空目录只显示“还没有模型”与“添加模型”。
- 输入类型至少保留一项（protocol `minItems: 1`）：只剩一项时该复选框禁用。

文档影响：无。apps/server 与 @coko/session 的 README 只描述目录的服务端语义，未变；没有描述设置表单的正式文档。

改动的共享位置（与票 04 可能重叠）：

- `provider-draft.ts`：`FormDraft.modelText` 换成 `models: ModelRowDraft[]`；`DraftErrors` 增加 `catalog?: CatalogErrors`；`isDirty` 对 `models` 深比较；`validateDraft` 与 `toProviderDraft` 改用目录行。
- `provider-form.tsx`：原 `models` 输入换成 `<ModelCatalog>`；新增 `updateModels`（修改后去掉失效的行错误）；`Field` 去掉不再使用的 `heading`；去掉未使用的 `cn` 导入。
- i18n `providers.*`：删除 `modelsHint`；新增 `providers.catalog.*`；`modelsRequired` 文案改为“至少添加一个模型”/“Add at least one model”。
- `models-section.browser.test.tsx`：新增 `addModelRow`、`addModel`、`describedError` helper，四处 `field('models')` 改为添加行；键盘用例改为 Tab 到“添加模型”后 Enter；“编辑目录”用例改名并改为添加行。
- `apps/desktop/e2e/settings.e2e.test.ts`：`addCustomProvider` 的 `models` 改为 `{ id, contextWindow? }[]`。
- 未改 `models-section.tsx` 与 `fake-settings.ts`。

供后续票：

- `catalog-draft.ts`：`ModelRowDraft { key, id, name, contextWindow, maxTokens, input, reasoning, thinkingLevels }`（容量为输入原文，key 只作行身份）、`emptyModelRow()`、`rowsOf(models)`、`toCatalog(rows)`、`validateCatalog(rows)`（返回 `CatalogErrors = Record<rowKey, { id?, contextWindow?, maxTokens? }>`）、`pruneCatalogErrors`、`parseTokens` / `formatTokens`。`reasoning` 与 `thinkingLevels` 原样往返，供票 06 编辑；票 06 加档位错误时扩展 `ModelRowField`。票 07 导入模型用 `{ ...emptyModelRow(), id, name: id }` 追加到 `draft.models`。
- `model-catalog.tsx`：`ModelCatalog { id, rows, onChange, errors?, emptyError?, revealErrors }`；展开状态在组件内，`revealErrors` 变化时展开有容量错误的行。票 06 在 `ModelRow` 展开区（输入类型之后）加推理设置；票 07 在目录标题行加“获取可用模型”。
- DOM：行 `li[data-model-row][data-model-row-key]`，展开时 `data-expanded`，有错误时 `data-invalid`；输入 `[name=modelId|modelName|contextWindow|maxTokens]`；复选框 `[name=input-text|input-image]`；“添加模型” `[data-model-add]`；图标按钮的可访问名称为 `providers.catalog.options`（“模型选项”）与 `providers.catalog.remove`（“删除模型”）。显示名称的可访问名称为“模型显示名称”，与供应商的“显示名称”区分。

合入票 04（model-service cdf507c）后：

- 共享文件核对：`models-section.tsx` 与 04 一致（删除确认 `delete-provider-dialog.tsx`、`providerReferences`）；i18n 同时有 `providers.deleteDialog.*` 与 `providers.catalog.*`；`models-section.browser.test.tsx` 只差本票的目录行改动。
- 票 04 新增的 `apps/desktop/e2e/provider-delete.e2e.test.ts` 仍填写已删除的 `input[name="models"]`；其 `addCustomProvider` 改为点击 `[data-model-add]` 后填写 `modelId`，签名不变。
- 重新验证：`pnpm install --frozen-lockfile` 退出 0；`pnpm run typecheck` 退出 0；`pnpm run lint` 0 warning 0 error；`pnpm run format:check` 通过；`pnpm run test apps/desktop/src/renderer packages/i18n packages/ui/src/guards scripts tests/integration/secrets-gate tests/integration/sidecar-provider-delete.test.ts`：41 个文件，258 个用例通过；`pnpm run test apps/desktop/e2e/settings.e2e.test.ts apps/desktop/e2e/provider-delete.e2e.test.ts`：3 通过，1 跳过（真实 DeepSeek）。
