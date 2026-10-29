# 03: 列表内的连接表单

**What to build:** 模型服务页展示供应商列表；在列表底部新建、在列表项内编辑，同一时间只展开一个表单。新建表单含 Provider ID、显示名称、API 地址、API 协议与 API Key；编辑时 ID 为静态文本，Key 空值提示“留空则保留现有 Key”。有未保存修改时关闭或切换会提示“放弃更改？”。状态点以文字区分已配置 / 未配置 Key。

**Blocked by:** 02

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉以 Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 为准（画面 01、02、03、02D、04）；确认框与字段错误等源稿未覆盖的状态沿用源稿视觉语言与设计系统已有组件。

- [x] MS-02 至 MS-11 通过（浏览器测试覆盖交互，Electron E2E 覆盖一次新建与编辑保存）
- [x] 字段校验：ID 格式与重复（“ID 已被使用”）、显示名称必填、地址须为 http(s)、新建 Key 必填，错误不只靠颜色表达
- [x] 协议下拉只有三项，默认 OpenAI Chat Completions
- [x] 按钮文案始终为“编辑”；提交中按钮不可点，失败时表单底部显示错误并保留草稿
- [x] 键盘可操作，焦点可见，明暗主题正确；几何符合规格第 6 节

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

### 来自票 08

- Session 档位（票 08 已合入）：protocol 有 `Session.thinkingLevel`、`CreateSessionRequest.thinkingLevel?`、`SetSessionModelRequest.thinkingLevel?` 和 `AvailableModel.thinkingLevels`。`AvailableModel.thinkingLevels` 总是含 off，推理开关打开时再加已配置档位，按固定顺序排列。ThinkingLevel 的定义在 `packages/protocol/src/http.ts` 中移到了 Session 之前。
- 可选档位的规则：agent 的 `selectableThinkingLevels(model)`；runtime 用 `setThinkingLevel(level)` 设置档位，Run 进行中调用会抛 `RuntimeBusyError`。server 用 `#effectiveLevel` 计算实际档位：保存的档位在当前目录中已不可选时，DTO 和请求都按 off 处理。因此修改目录后不需要迁移 Session。
- session：`Session.thinkingLevel: string`；`setSessionModel(id, model, thinkingLevel?)` 在档位缺省或模型为 null 时写 off。迁移 v5 新增 `sessions.thinking_level TEXT NOT NULL DEFAULT 'off'`，`SQLITE_SCHEMA_VERSION` 为 5，之后的迁移从 5 往上走。
- renderer：chat-store 有 `draftThinkingLevel` 和 `selectModel(model, thinkingLevel?)`。`ModelPicker` 新增必填属性 `thinkingLevel`，回调为 `onChange(model, thinkingLevel)`，并导出 `levelForModel`。档位项带 `data-thinking-level`。renderer fake 的 `models()` 按 Sidecar 的规则带 `thinkingLevels`。i18n 有 `models.thinkingLevel` 和 `models.thinkingLevels.{off…max}`，zh 的 off 为“关闭”。
- 合入冲突提醒：票 08 改了 `packages/i18n/src/dictionaries/{zh,en}.ts`（`models` 下新增 `thinkingLevel` 和 `thinkingLevels.*`）、`apps/desktop/src/renderer/testing/fake-settings.ts`（`models()` 带 `thinkingLevels`）和 `fixture-chat.ts`（`setSessionModel` 回传档位）。本票与 08 并行实施，合入时这几处可能冲突，需要保留两边的键和 helper。

### 票 03 交付（ms/03-in-list-provider-form）

**覆盖的验收**

- MS-02 至 MS-11：`apps/desktop/src/renderer/features/settings/models-section.browser.test.tsx`（11 个用例）。覆盖列表行（编辑与删除；状态点后有文字“已配置 Key · 末四位 …” / “未配置 Key”；收起行 H40/R12，行间距 4px）、列表底部新建（“自定义模型 API”，不在任何列表项内，已有列表保留）、协议三项与默认值、Key 为 password 且字符间距为 normal、字段校验与“ID 已被使用”（本地校验和服务端 409 两条路径）、编辑表单（名称与 ID 静态并排，ID 没有控件，Key 为空，placeholder 为“留空则保留现有 Key”，保存不带 secret）、“编辑”按钮始终不变（展开状态用 `aria-expanded`/`aria-controls` 表达）、“放弃更改？”（取消、再次点编辑、展开其他项、点添加、切换设置分区、Escape 与关闭按钮）、同一时间只展开一个表单、提交中按钮禁用且只提交一次、失败时错误在表单底部并保留草稿、键盘完成新建且焦点环可见、深色主题。
- Electron E2E（`apps/desktop/e2e/settings.e2e.test.ts`）：一次新建，以及一次列表项内编辑并留空 Key 保存；对话仍使用原 Key（假服务收到的 Authorization 不变），`/api/providers` 读回新名称和 hint 4821，用户数据目录中的文件不含明文。

**实际运行的命令与结果（合入 model-service b21b7db 之后）**

- `pnpm install --frozen-lockfile`：通过。
- `pnpm run typecheck`：通过。
- `pnpm exec oxlint apps/desktop/src/renderer apps/desktop/e2e packages/i18n`：0 warning，0 error。
- `pnpm run test apps/desktop/src/renderer packages/i18n packages/ui/src/guards`：24 个文件，179 个用例全部通过（含样式守卫与 zh/en 键一致性）。
- `pnpm run test tests/integration/secrets-gate`：9 个文件，11 个用例通过。
- `pnpm run test apps/desktop/e2e/settings.e2e.test.ts`：2 个通过，1 个跳过（真实 DeepSeek，无 `DEEPSEEK_API_KEY`）。
- `models-section.browser.test.tsx` 合入前连续运行 3 次，每次 10/10 通过（当时尚未追加第 11 个用例）。

**负向确认**

- 先红：列表用例在实现前失败（状态文案不符）。
- 变异（运行后已恢复）：去掉离开守卫，离开类用例失败；`isDirty` 恒为 false，两个“放弃更改？”用例都失败；默认协议改为 OpenAI Responses，新建与新建校验两个用例失败。

**未验证**

- 没有在 Electron 中对照 Pencil 源稿检查截图，也没有做窄窗口（390px）检查。几何只断言了行高、圆角、间距、H32 输入框、H36 选择器与按钮、菜单项 H32。
- 明暗主题只断言了深色下行背景变化，没有逐项检查对比度。
- 真实模型调用未验证（无密钥）。

**与源稿或规格的取舍（不改变验收）**

- 源稿列表行中的“自定义”标记没有实现：票 01 已删除 kind，所有供应商都是自定义类型，标记不携带信息。
- 状态点后的文字保留末四位（ADR 0004 允许回显“已配置”与末四位），没有末四位时只显示“已配置 Key”。
- 模型目录仍是票 01 的过渡输入（逗号分隔的模型 ID），放在分隔线下方，标签为“模型目录”。行、空状态、“添加模型”与“获取可用模型”属于票 05、07。
- 删除仍为行内的“确认删除”，二次确认框与引用数量属于票 04。

**共享文件改动**

- i18n：只改动 `zh.ts` / `en.ts` 中的 `providers.*`。分区标题改为“模型服务”/“Model services”；zh 文案中的 Provider 统一为“供应商”（Provider ID 除外）；新增 `list`、`formTitle`、`formDescription`、`settingsHeading`、`idPlaceholder`、`baseUrlPlaceholder`、`create`、`discard.{title,description,confirm,keep}`；`save` 改为“保存更改”。
- `app/settings-dialog-store.ts` 新增 `setLeaveGuard`；`app/settings.tsx` 的 `useSettingsDialog` 返回值中加入 `setLeaveGuard`。
- `app/app.browser.test.tsx`：原来的 Models 用例迁到 `models-section.browser.test.tsx`；i18n 用例改为按角色查询协议按钮；模型选择用例的标题改为“Model services”。合入票 08 后补回 `catalogModel` 的导入。
- 没有改动 protocol barrel、chat-store、settings-store。

**文档影响**

- 正式文档中没有描述这个分区界面的正文，ADR 0004/0010 与 GLOSSARY 的表述仍成立，所以没有更新文档。

### 供后续票（04、05、06、07）

- 文件拆分：`models-section.tsx` 负责列表、展开互斥、放弃确认与离开守卫；`provider-form.tsx` 是表单（`ProviderForm` props：`id, provider?, draft, onChange, takenIds, onCancel, onSaved`）；`provider-draft.ts` 是纯函数：`FormDraft`、`emptyDraft`、`draftOf`、`isDirty`、`validateDraft`（返回 `DraftErrors`，值是字典键）、`toProviderDraft`。
- 草稿由 `ModelsSection` 持有（`OpenForm { key, id?, initial, draft }`）。票 05 把 `FormDraft.modelText` 换成模型行时，同时扩展 `isDirty`、`validateDraft` 与 `toProviderDraft`。`isDirty` 现在按 `FormDraft` 的键做浅比较，数组字段需要改为深比较。
- 字段错误的写法：控件带 `aria-invalid`，`aria-describedby` 指向带 `data-field-error` 的说明（有图标和文字）。提交时聚焦第一个 `[aria-invalid="true"]`。
- DOM 约定：列表项 `li[data-provider-id][data-protocol]`，展开时带 `data-expanded`；入口按钮 `[data-provider-add]`、`[data-provider-edit]`；表单 `form[data-provider-form="create"|"edit"]`；编辑表单中的静态 ID `[data-provider-static-id]`；确认框为 `role="alertdialog"`，名称“放弃更改？”。
- 离开守卫：分区用 `useSettingsDialog().setLeaveGuard(async () => boolean)` 登记，返回撤销函数。`setSection`、`close` 和换分区的 `show` 在守卫返回 true 后才生效。票 07 的“获取可用模型”弹窗不需要接入守卫。
- 测试 helper：`models-section.browser.test.tsx` 中的 `openModels(locale, seed)`、`row(id)`、`field(name)`、`errorOf(name)`、`settled()`。几何断言前先 `settled()`，等弹窗缩放动画结束。用键盘操作共享菜单时，先等打开动画结束，并逐键发送方向键。

### 合入记录（ms-merger，2026-10-29）

- 以 `git merge --no-ff ms/03-in-list-provider-form` 合入集成分支 model-service，合入提交 5cf3807（票分支 d139da4，基于 b21b7db）。唯一冲突在本票文件的 Comments：集成分支追加了“来自票 08”，票分支追加了交付记录，两段都保留。代码文件没有冲突；i18n 字典、`fake-settings.ts` 与 `fixture-chat.ts` 中票 08 的改动在合入后仍在。
- 修复：全量测试中 `scripts/source-references.test.ts` 失败 1 例，原因是 `provider-draft.ts` 的注释写了“票 05”。已改为不含票号的说明，提交 659618c `fix(settings): drop ticket reference from provider draft comment`。
- 集成 worktree 复核（修复后）：`pnpm install --frozen-lockfile` 退出 0；`pnpm run typecheck` 退出 0；`pnpm run lint` 0 警告 0 错误（541 文件）；`pnpm run format:check` 通过（567 文件）；`pnpm run test` 186 文件，1321 通过、1 跳过（`settings.e2e` 的真实 DeepSeek 用例，无密钥），含全部 desktop-e2e 与产物 smoke；`pnpm run check:docs` 129 文件 0 问题。
- Spec 评审：对照 MS-02 至 MS-11，`models-section.browser.test.tsx` 的 11 个用例逐项覆盖；MS-06 的空目录由过渡输入的 `providers.modelsRequired` 覆盖。离开守卫在 `settings-dialog-store` 中拦截 `setSection`、`close` 和换分区的 `show`，确认进行中不会重复询问。没有发现阻塞缺口。已知差异沿用实施记录：源稿列表行的“自定义”标记没有实现（kind 已删除），没有对照 Pencil 源稿截图检查，也没有做窄窗口检查。
- 越出写范围（`settings-dialog-store` 的 `setLeaveGuard`、`settings.tsx`、`app.browser.test.tsx`、i18n `providers.*`）与 lead 备注一致，可以接受。
- “供后续票”的约定已转写到票 04、05、06、07 的 Comments（标题“来自票 03”），04 与 05 中注明了对方在并行实施。

Closed: true
