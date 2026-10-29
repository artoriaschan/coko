# 06: 推理档位配置

**What to build:** 在展开的模型选项中，用“推理等级”开关和档位列表为模型配置 Thinking Level 及其 API 参数值。

**Blocked by:** 05

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉以 Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 为准（画面 02C、06）。

- [x] MS-15 至 MS-18、MS-36 通过
- [x] “添加档位”按 off、minimal、low、medium、high、xhigh、max 顺序补齐最早缺失档位；七档齐全后置灰且文案不变；无顺序或下一档提示
- [x] 修改某行档位只能选尚未配置的档位；同一模型不出现重复档位
- [x] off 行参数输入禁用并显示“关闭思考”；其余档位默认参数值等于档位名且可编辑
- [x] 开关关闭时已填档位仍随草稿保存，重新打开表单时仍在

## Comments

### 来自票 09

- 设置菜单已分组（票 09 已合入）。分类“Models”/“模型”是 `role="group"` 的无障碍名称（`aria-labelledby` 指向分类标题），在设置弹窗内用 `getByLabelText('Models')` 会同时匹配该分组和表单字段。查询表单字段时改用带角色的查询，例如 `getByRole('textbox', { name: 'Models' })`；新增带“Models”/“模型”标签的控件同样按角色查询。
- 打开模型服务分区：菜单项文案为 `settings.nav.models`（“Model services”/“模型服务”），选择器 `[data-section=models]` 未变；分区页标题仍用 `settings.models` 等分区自己的键，与菜单文案分开。

### 来自票 01

- Thinking Level（`@coko/protocol`）：`THINKING_LEVELS` 为 off、minimal、low、medium、high、xhigh、max，与 agent 的 `THINKING_LEVELS` 一致（编译期断言）；`ThinkingLevelConfig` 是 `{ level: 'off' }` 或 `{ level, value }`，value 非空。
- `CatalogModel.thinkingLevels` 按添加顺序保存；`reasoning` 是模型的推理开关。agent 对应 `ThinkingLevelSpec`，`CatalogModel` 与 `ModelSpec` 同形。
- registry 的 `thinkingLevelMap`：已配置档位为其 value，未配置为 null，off 不写入（按协议默认关闭）；`reasoning` 关闭时 pi-ai 只支持 off。
- 服务端校验（`ModelConfigError` → 400）拒绝同一模型的重复档位。现有过渡表单不编辑档位，编辑已有模型时保留其 `thinkingLevels`；renderer 测试 helper `catalogModel` 在 `apps/desktop/src/renderer/testing/fake-settings.ts`。

### 来自票 02

- 一次保存（票 02 已合入）：协议用 `ProviderFields { id, name, api, baseUrl, models }`，取代已删除的 `CreateProviderRequest` / `UpdateProviderRequest`。保存只走一条控制消息 `provider.save { requestId, mode: 'create' | 'update', provider, credential?: { ciphertext, hint } }`，回复为 `provider.save.result`（`ok: true, provider` 或 `ok: false, error: { code, message, details? }`）。`credential.store` 已删除。
- renderer 经 `bridge.saveProvider({ mode, provider, secret? })` 提交，取代已删除的 `setCredential`。结果失败时为 `{ ok: false, code: ProviderSaveErrorCode, message, details? }`，`ProviderSaveErrorCode` 是 `'invalid-input' | 'encryption-unavailable' | 'sidecar-unavailable' | 'timeout'` 或 protocol `ErrorCode`（如 `already-exists`）。store 侧为 `settings.saveProvider(draft)`，返回 `SaveProviderResult`（不再有 `stage`）；编辑时 `draft.secret === ''` 表示保留原 Key。
- ApiClient 不再有 `createProvider` / `updateProvider`；HTTP 只保留 GET 与 DELETE `/api/providers`，POST / PATCH 返回 404。
- 测试：renderer fake（`apps/desktop/src/renderer/testing/fake-settings.ts`）用 `backend.seedProvider(fields, secret?)` 预置 Provider，用 `backend.saveProvider`（vi.fn）模拟和断言一次提交；`customProvider` 返回 `ProviderFields`。集成 harness（`tests/integration/sidecar-harness.ts`）有 `saveProvider(sidecar, fields, { mode?, secret? })`、`seedProviders(dirs, fields[])`、`answerDecrypts(sidecar)`、`testCipher`。独立运行的 sidecar 不能保存 Provider，要用 IPC 模式或 `seedProviders` 预置。
- 档位随 `ProviderFields.models[].thinkingLevels` 经 `saveProvider` 一次提交；服务端拒绝重复档位时通过 `provider.save.result` 返回错误，库不变。

### 来自票 08

- Session 档位（票 08 已合入）：protocol 有 `Session.thinkingLevel`、`CreateSessionRequest.thinkingLevel?`、`SetSessionModelRequest.thinkingLevel?` 和 `AvailableModel.thinkingLevels`。`AvailableModel.thinkingLevels` 总是含 off，推理开关打开时再加已配置档位，按固定顺序排列。ThinkingLevel 的定义在 `packages/protocol/src/http.ts` 中移到了 Session 之前。
- 可选档位的规则：agent 的 `selectableThinkingLevels(model)`；runtime 用 `setThinkingLevel(level)` 设置档位，Run 进行中调用会抛 `RuntimeBusyError`。server 用 `#effectiveLevel` 计算实际档位：保存的档位在当前目录中已不可选时，DTO 和请求都按 off 处理。因此修改目录后不需要迁移 Session。
- session：`Session.thinkingLevel: string`；`setSessionModel(id, model, thinkingLevel?)` 在档位缺省或模型为 null 时写 off。迁移 v5 新增 `sessions.thinking_level TEXT NOT NULL DEFAULT 'off'`，`SQLITE_SCHEMA_VERSION` 为 5，之后的迁移从 5 往上走。
- renderer：chat-store 有 `draftThinkingLevel` 和 `selectModel(model, thinkingLevel?)`。`ModelPicker` 新增必填属性 `thinkingLevel`，回调为 `onChange(model, thinkingLevel)`，并导出 `levelForModel`。档位项带 `data-thinking-level`。renderer fake 的 `models()` 按 Sidecar 的规则带 `thinkingLevels`。i18n 有 `models.thinkingLevel` 和 `models.thinkingLevels.{off…max}`，zh 的 off 为“关闭”。
- MS-36 的会话一侧已由票 08 覆盖：推理开关关闭的模型只有 off，PUT 给 high 时返回 400，目录中的档位不变。本票负责表单一侧：开关关闭时已填档位仍随草稿保存。界面上的档位名可以复用 `models.thinkingLevels.*`。
- 已知缺口（票 08 合入记录）：Anthropic Messages 的模型如果没有设 `compat.forceAdaptiveThinking`，非 off 档位会按 budget 思考请求（`thinking: { type: 'enabled', budget_tokens }`），不发送配置的参数值。这与规格 4.7 不完全一致，留到最终评审处理；配置界面不需要因此改动。

### 来自票 03

- 文件拆分（票 03 已合入）：`features/settings/models-section.tsx` 负责列表、同一时间只展开一个表单、“放弃更改？”确认与离开守卫；`provider-form.tsx` 是表单，`ProviderForm` 的 props 为 `id, provider?, draft, onChange, takenIds, onCancel, onSaved`；`provider-draft.ts` 是纯函数：`FormDraft`、`emptyDraft`、`draftOf`、`isDirty`、`validateDraft`（返回 `DraftErrors`，值是字典键）、`toProviderDraft`。
- 草稿由 `ModelsSection` 持有（`OpenForm { key, id?, initial, draft }`）。`isDirty` 现在按 `FormDraft` 的键做浅比较，加入数组字段时要改为深比较。
- 字段错误：控件带 `aria-invalid`，`aria-describedby` 指向带 `data-field-error` 的说明（图标加文字）；提交时聚焦第一个 `[aria-invalid="true"]`。
- DOM 约定：列表项 `li[data-provider-id][data-protocol]`，展开时带 `data-expanded`；入口按钮 `[data-provider-add]`、`[data-provider-edit]`；表单 `form[data-provider-form="create"|"edit"]`；编辑表单中的静态 ID 为 `[data-provider-static-id]`；“放弃更改？”确认框为 `role="alertdialog"`。
- 离开守卫：分区用 `useSettingsDialog().setLeaveGuard(async () => boolean)` 登记，返回撤销函数；`setSection`、`close` 和换分区的 `show` 在守卫返回 true 后才生效。store 在 `app/settings-dialog-store.ts`。
- 测试 helper（`models-section.browser.test.tsx`）：`openModels(locale, seed)`、`row(id)`、`field(name)`、`errorOf(name)`、`settled()`。几何断言前先 `settled()` 等弹窗缩放动画结束；用键盘操作共享菜单时先等打开动画结束，再逐键发送方向键。
- 源码注释不要写票号：`scripts/source-references.test.ts` 会拒绝 apps、packages、tests 中的任务材料引用（合入 03 时因 `provider-draft.ts` 注释里的“票 05”失败过，已改）。
- 档位编辑写在 05 的模型行里，草稿字段的变化同样要反映到 `isDirty`、`validateDraft` 和 `toProviderDraft`。

### 来自票 04

- 删除供应商（票 04 已合入）：新文件 `features/settings/delete-provider-dialog.tsx`（`DeleteProviderDialog`、`DeleteProviderRequest`）。确认框打开时经 `GET /api/providers/:id/references`（`ProviderReferencesResponse { sessions }`）读取引用数量；确认后同一事务删除 Provider 与 Credential，引用它的 Session 模型字段清空且档位为 off，`defaultModel` 指向它时改为 null（回退为第一个可用模型），sidecar 清除明文缓存。
- DOM：确认框 `[data-delete-provider-dialog]`（`role="alertdialog"`，与“放弃更改？”同为 alertdialog，查询时按名称或 data 属性区分）；数量区 `[data-provider-references="loading"|"ready"|"error"]`；行内删除按钮 `[data-provider-delete]`；输入区提示 `[data-slot="model-required"]`。
- store 与 API：`settings.providerReferences(id)`（失败抛 `ApiError`）、`createSettingsStore({ onProviderDeleted })`；ApiClient 新增 `providerReferences(id)`；protocol `apiPaths.providerReferences`、`ErrorCode` 新增 `model-required`；session `ProviderRepository.references(id)`、`delete(id): Promise<ProviderReferences>`。
- 行为变化：Session 模型字段为空且有可用模型时，Run 返回 409 `model-required`，不再自动选用默认模型；没有任何可用模型时仍为 `model-not-configured`。新建 Session 仍在创建时取默认模型。
- 测试：renderer fake（`testing/fake-settings.ts`）的 api 新增 `providerReferences`（vi.fn），`deleteProvider` 同时清掉引用数，返回值新增 `setReferences(id, n)`；`testing/fixture-chat.ts` 新增 `sessions` 选项。参考 `tests/integration/sidecar-provider-delete.test.ts`、`apps/desktop/e2e/provider-delete.e2e.test.ts`、`features/settings/delete-provider.browser.test.tsx`。
- 本票改 `models-section.tsx` 或 `fake-settings.ts` 时，保留票 04 的删除确认框、`providerReferences` 与 `setReferences`。

### 来自票 05

- 模型目录行（票 05 已合入）：`features/settings/catalog-draft.ts` 提供 `ModelRowDraft { key, id, name, contextWindow, maxTokens, input, reasoning, thinkingLevels }`（容量为输入原文，key 只作行身份）、`emptyModelRow()`、`rowsOf(models)`、`toCatalog(rows)`、`validateCatalog(rows)`（返回 `CatalogErrors = Record<rowKey, { id?, contextWindow?, maxTokens? }>`）、`pruneCatalogErrors`、`parseTokens` / `formatTokens`。`reasoning` 与 `thinkingLevels` 现在原样往返，没有界面。
- `provider-draft.ts`：`FormDraft.modelText` 已换成 `models: ModelRowDraft[]`；`DraftErrors` 增加 `catalog?: CatalogErrors`；`isDirty` 对 `models` 深比较（不含行 key）；`validateDraft` 与 `toProviderDraft` 使用目录行。`provider-form.tsx` 用 `<ModelCatalog>`，`updateModels` 在修改后去掉失效的行错误。
- `model-catalog.tsx`：`ModelCatalog { id, rows, onChange, errors?, emptyError?, revealErrors }`；展开状态在组件内，`revealErrors` 变化时展开有容量错误的行。收起与展开不进入草稿。
- DOM：行 `li[data-model-row][data-model-row-key]`，展开时带 `data-expanded`，有错误时带 `data-invalid`；输入 `[name=modelId|modelName|contextWindow|maxTokens]`；复选框 `[name=input-text|input-image]`；“添加模型”为 `[data-model-add]`；图标按钮的可访问名称为 `providers.catalog.options`（“模型选项”）和 `providers.catalog.remove`（“删除模型”）；模型显示名称的可访问名称为“模型显示名称”，与供应商的“显示名称”区分。i18n 新增 `providers.catalog.*`，删除 `modelsHint`。
- 测试：`catalog-draft.test.ts`、`provider-draft.test.ts`、`model-catalog.browser.test.tsx`；`models-section.browser.test.tsx` 有 `addModelRow`、`addModel`、`describedError` helper；e2e 的 `addCustomProvider` 改为点击 `[data-model-add]` 后填写 `modelId`（`settings.e2e` 的 `models` 参数为 `{ id, contextWindow? }[]`）。逐键输入前先等新行的模型 ID 获得焦点，切换协议后先等菜单关闭，否则 Radix 归还焦点会吞掉后半段字符。
- 推理设置放在 `ModelRow` 展开区，输入类型之后。加档位错误时扩展 `ModelRowField` 和 `CatalogErrors`，并让 `revealErrors` 展开有档位错误的行。
- 并行提醒：票 07 与本票同时实施，两张票都改模型目录一带。可能冲突的位置：`model-catalog.tsx`（本票改 `ModelRow` 展开区，票 07改目录标题行）、`catalog-draft.ts`、i18n `providers.catalog.*`、`model-catalog.browser.test.tsx`，以及可能的 `provider-form.tsx`。只做本票需要的增量改动，并在 Comments 列出改过的共享位置；合入时由 merger 解决冲突。

### 实施记录（ms/06-thinking-level-config）

测试位置（无法与用户逐条确认，按须知与规格第 7 节选定）：纯函数 `thinking-levels.ts`（档位增删改与提交整理）；共享控件 `Switch` 的浏览器测试；经 App 装配打开设置的浏览器测试（fake 的 saveProvider）；真实 Electron + Sidecar 的 E2E（重新读取 `/api/providers`、`/api/models`）。

覆盖的验收：

- MS-15：展开模型后加档位，Provider ID、显示名称、地址与 Key 仍可见，与目录共用“创建供应商”（`thinking-levels.browser.test.tsx` 用例 1）。
- MS-16、MS-17：连续添加七次，顺序 off → max；第七次后按钮禁用，文字仍为“添加档位”，按钮所在区域只有这几个字，表单不含“已添加全部档位”；禁用态仍为 H28。焦点在添加后移到新档位的选择器，按钮禁用时不落到 body。目录不出现“恢复默认模型”由票 05 的用例保证。
- MS-18：删除 minimal 后再添加，补回 minimal 并追加在末尾；删除不确认，焦点到“添加档位”。修改档位的菜单只列当前档位与未配置的档位（键盘打开、方向键选择、焦点回到选择器）；改成新档位时参数值取新档位名。纯函数也拒绝改成已配置的档位（`thinking-levels.test.ts`）。
- off 行：参数输入禁用、无值、占位为“关闭思考”，提交为 `{ level: 'off' }`；其余档位默认值等于档位名、可编辑；参数值留空提交时用档位名（`toCatalog` 经 `normalizeLevels`）。
- MS-36（表单一侧）：关闭开关后档位仍显示、可编辑，保存为 `reasoning: false` 并保留档位；重新打开时开关为关、档位与参数值仍在。会话一侧：fake 与真实 Sidecar 的 `/api/models` 都只给 off（E2E）。
- 只改开关或档位算作未保存修改，“取消”提示“放弃更改？”（用例 4；`isDirty` 已深比较行内容，未改动）。

实际运行的命令与结果：

- `pnpm install --frozen-lockfile` 退出 0；`pnpm run typecheck` 退出 0；`pnpm run lint` 0 warning 0 error；`pnpm run format:check` 通过。
- `pnpm run test apps/desktop/src/renderer packages/i18n packages/ui scripts tests/integration/secrets-gate`：57 个文件，335 个用例通过（新增 `thinking-levels.test.ts` 6、`catalog-draft.test.ts` +1、`thinking-levels.browser.test.tsx` 4、`switch.browser.test.tsx` 1；含样式守卫、zh/en 键一致与源码任务引用检查）。
- `pnpm run test apps/desktop/e2e/settings.e2e.test.ts apps/desktop/e2e/provider-delete.e2e.test.ts apps/desktop/e2e/thinking-levels.e2e.test.ts`：4 通过，1 跳过（真实 DeepSeek，无密钥）。
- 已合入 model-service 64a79a1（Already up to date）。

负向确认：每个新测试文件先因模块或控件缺失而失败；`toCatalog` 的档位整理先红后绿。变异各自使对应用例失败后恢复：档位选择项包含已配置档位、七档齐全后按钮仍可点、off 参数可编辑、开关不写回草稿。

修过的问题：档位行最初以档位名为 key，修改档位会重新挂载该行，焦点丢失；改为与档位无关的稳定行 key。

未验证：真实模型；Electron 中的深色主题、390px 窄窗口目视检查（浏览器用例只断言语义色随主题变化与 H20 开关、H36 选择器、H32 输入、H28 按钮的几何）；帮助图标 Tooltip 的显示未单独断言。Anthropic Messages 未设 `forceAdaptiveThinking` 时不发送参数值的缺口（票 08 记录）不在本票范围。

视觉与规格说明：

- 推理设置在输入类型之后，以 0.5px 分隔线隔开；标题“推理等级”旁有帮助图标（Tooltip 说明开关含义），右侧为开关。表头“档位 / API 参数值”在有档位时显示。档位名是协议值，按原文显示（等宽字体），不翻译。
- 开关关闭时档位仍显示且可编辑（规格 4.5“已填写的档位仍随草稿保存”），不隐藏。
- 参数值留空不报错，提交时用档位名，与容量留空用默认值一致；protocol 要求非 off 的 value 非空，这样提交总是合法。

文档影响：无。apps/server 与 @coko/session 的 README 已描述 `reasoning` 与 `thinkingLevels` 的服务端语义，未变。

改动的共享位置（与票 07 可能重叠）：

- `model-catalog.tsx`：只加了 `ThinkingLevelsEditor` 的导入，以及 `ModelRow` 展开区末尾的分隔线和 `<ThinkingLevelsEditor … onChange={onChange} />`（共 3 行）；目录标题行未改。
- `catalog-draft.ts`：导入 `normalizeLevels`，`toCatalog` 的 `thinkingLevels` 改为 `normalizeLevels(row.thinkingLevels)`（2 行）。
- `catalog-draft.test.ts`：文件末尾加 1 个用例。
- i18n：新增 `providers.thinking.*`（放在 `providers.loadFailed` 之后，没有动 `providers.catalog.*`）。
- `packages/ui`：新增 `Switch`（`components/switch.tsx`，`index.ts` 导出一行），基于 radix-ui 已有的 Switch，没有新增依赖。
- 未改 `provider-form.tsx`、`provider-draft.ts`、`model-catalog.browser.test.tsx`、`models-section.tsx`、`fake-settings.ts`。
- 新文件：`thinking-levels.ts`、`thinking-levels-editor.tsx` 及其测试、`apps/desktop/e2e/thinking-levels.e2e.test.ts`。

供后续票：

- `thinking-levels.ts`：`nextLevel`、`addLevel`、`removeLevel`、`levelChoices`、`changeLevel`、`setLevelValue`、`normalizeLevels`。
- `ThinkingLevelsEditor { id, reasoning, levels, onChange(patch: { reasoning?, thinkingLevels? }) }`。
- DOM：开关 `role="switch"`、`name="reasoning"`，可访问名称为 `providers.thinking.title`（“推理等级”）；档位行 `li[data-thinking-level=<level>]`；选择器 `[data-thinking-select]`（可访问名称“档位”）、菜单项 `[data-thinking-choice]`；参数输入 `[name="thinkingValue"]`；“添加档位” `[data-thinking-add]`；删除按钮可访问名称“删除档位”。
- 票 07 导入的模型 `reasoning: false`、`thinkingLevels: []`，即开关关闭、没有档位（`emptyModelRow` 的默认值）。

### 合入记录（ms-merger，2026-10-29）

- 以 `git merge --no-ff ms/06-thinking-level-config` 合入集成分支 model-service，合入提交 b75a214（票分支 9c210a8，基于 64a79a1），无冲突。
- 集成 worktree 复核：`pnpm install --frozen-lockfile` 退出 0；`pnpm run typecheck` 退出 0；`pnpm run lint` 0 警告 0 错误（557 文件）；`pnpm run format:check` 通过（583 文件）；`pnpm run test` 196 文件，1383 通过、1 跳过（`settings.e2e` 的真实 DeepSeek 用例，无密钥），含 `thinking-levels.test.ts` 6、`thinking-levels.browser.test.tsx` 4、`switch.browser.test.tsx` 1、`thinking-levels.e2e.test.ts` 1 与全部 desktop-e2e、产物 smoke；`pnpm run check:docs` 129 文件 0 问题。
- Spec 评审：对照 MS-15 至 MS-18 与 MS-36（表单侧），没有发现缺口。
  - MS-16、MS-17：七次添加的顺序为 off → max，第七次后按钮禁用且文案不变，没有顺序提示或“已添加全部档位”。
  - MS-18：删除后补齐最早缺失档位，修改时只能选尚未配置的档位。
  - off 行参数输入禁用并显示“关闭思考”，其余档位默认值为档位名；开关关闭时档位仍随草稿保存，重新打开后仍在。
- 共享文件改动与 lead 备注一致：`model-catalog.tsx` 3 行、`catalog-draft.ts` 2 行、i18n 新增 `providers.thinking.*`。依赖没有变化（`package.json` 与 `pnpm-lock.yaml` 无 diff）。
- `Switch` 对照 `docs/tech-stack/ui-design-system.md`：全圆轨道和滑块用 `rounded-round`（规则要求全圆轨道用它，不用 `rounded-full`）；颜色只用语义 token（`bg-primary`、`bg-input`、`bg-background`），没有 `dark:` 变体；焦点环用共享 `focus-ring`。几何为 H20 × W32、滑块 16px、内边距 2px，选中位移 12px 与轨道宽度吻合。**小缺口（不阻塞）**：设计系统要求动效提供 `motion-reduce:` 替代，滑块有 `motion-reduce:transition-none`，轨道的 `transition-colors` 没有，可在最终评审时顺手补上。
- 已知差异沿用实施记录：没有在 Electron 中目视检查深色主题和 390px 窄窗口；帮助图标的 Tooltip 没有单独断言。Anthropic 档位参数的缺口仍按票 08 的记录留到最终评审。
- “供后续票”的约定已转写到票 07 的 Comments（标题“来自票 06”），并注明了 07 合入时可能在 `model-catalog.tsx` 冲突。

Closed: true
