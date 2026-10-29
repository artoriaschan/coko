# 04: 删除供应商

**What to build:** 用户点击某供应商的“删除”后看到二次确认，确认框写明引用它的 Session 数量。确认后供应商与其 Credential 被删除，引用它的 Session 模型字段被清空并在下次运行前提示重新选择模型，默认模型指向它时回退为第一个可用模型。

**Blocked by:** 03

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉以 Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 为准；确认框沿用设计系统已有组件。

- [x] MS-32、MS-33 通过
- [x] 确认框显示的引用数量与库中实际一致；取消时不做任何修改
- [x] 删除后用相同 ID 重新创建，原 Session 不会自动使用新供应商
- [x] 删除后 Sidecar 的明文缓存被清除；库中没有该 Credential

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

### 来自票 08

- Session 档位（票 08 已合入）：protocol 有 `Session.thinkingLevel`、`CreateSessionRequest.thinkingLevel?`、`SetSessionModelRequest.thinkingLevel?` 和 `AvailableModel.thinkingLevels`。`AvailableModel.thinkingLevels` 总是含 off，推理开关打开时再加已配置档位，按固定顺序排列。ThinkingLevel 的定义在 `packages/protocol/src/http.ts` 中移到了 Session 之前。
- 可选档位的规则：agent 的 `selectableThinkingLevels(model)`；runtime 用 `setThinkingLevel(level)` 设置档位，Run 进行中调用会抛 `RuntimeBusyError`。server 用 `#effectiveLevel` 计算实际档位：保存的档位在当前目录中已不可选时，DTO 和请求都按 off 处理。因此修改目录后不需要迁移 Session。
- session：`Session.thinkingLevel: string`；`setSessionModel(id, model, thinkingLevel?)` 在档位缺省或模型为 null 时写 off。迁移 v5 新增 `sessions.thinking_level TEXT NOT NULL DEFAULT 'off'`，`SQLITE_SCHEMA_VERSION` 为 5，之后的迁移从 5 往上走。
- renderer：chat-store 有 `draftThinkingLevel` 和 `selectModel(model, thinkingLevel?)`。`ModelPicker` 新增必填属性 `thinkingLevel`，回调为 `onChange(model, thinkingLevel)`，并导出 `levelForModel`。档位项带 `data-thinking-level`。renderer fake 的 `models()` 按 Sidecar 的规则带 `thinkingLevels`。i18n 有 `models.thinkingLevel` 和 `models.thinkingLevels.{off…max}`，zh 的 off 为“关闭”。
- 清空 Session 模型字段时档位要一起回到 off。用 `setSessionModel(id, null)` 时会自动写 off；直接写 SQL 时请同时置 `thinking_level = 'off'`。Run 开始时如果模型字段为空，会自动选用默认模型，这时调用 `setSessionModel(id, model)`，档位也是 off。

### 来自票 03

- 文件拆分（票 03 已合入）：`features/settings/models-section.tsx` 负责列表、同一时间只展开一个表单、“放弃更改？”确认与离开守卫；`provider-form.tsx` 是表单，`ProviderForm` 的 props 为 `id, provider?, draft, onChange, takenIds, onCancel, onSaved`；`provider-draft.ts` 是纯函数：`FormDraft`、`emptyDraft`、`draftOf`、`isDirty`、`validateDraft`（返回 `DraftErrors`，值是字典键）、`toProviderDraft`。
- 草稿由 `ModelsSection` 持有（`OpenForm { key, id?, initial, draft }`）。`isDirty` 现在按 `FormDraft` 的键做浅比较，加入数组字段时要改为深比较。
- 字段错误：控件带 `aria-invalid`，`aria-describedby` 指向带 `data-field-error` 的说明（图标加文字）；提交时聚焦第一个 `[aria-invalid="true"]`。
- DOM 约定：列表项 `li[data-provider-id][data-protocol]`，展开时带 `data-expanded`；入口按钮 `[data-provider-add]`、`[data-provider-edit]`；表单 `form[data-provider-form="create"|"edit"]`；编辑表单中的静态 ID 为 `[data-provider-static-id]`；“放弃更改？”确认框为 `role="alertdialog"`。
- 离开守卫：分区用 `useSettingsDialog().setLeaveGuard(async () => boolean)` 登记，返回撤销函数；`setSection`、`close` 和换分区的 `show` 在守卫返回 true 后才生效。store 在 `app/settings-dialog-store.ts`。
- 测试 helper（`models-section.browser.test.tsx`）：`openModels(locale, seed)`、`row(id)`、`field(name)`、`errorOf(name)`、`settled()`。几何断言前先 `settled()` 等弹窗缩放动画结束；用键盘操作共享菜单时先等打开动画结束，再逐键发送方向键。
- 源码注释不要写票号：`scripts/source-references.test.ts` 会拒绝 apps、packages、tests 中的任务材料引用（合入 03 时因 `provider-draft.ts` 注释里的“票 05”失败过，已改）。
- 并行提醒：票 05 与本票同时实施，两张票都改模型服务分区（`models-section.tsx`、`provider-form.tsx`、`provider-draft.ts`、`models-section.browser.test.tsx`、i18n 的 `providers.*`）。请只做本票需要的增量改动，并在 Comments 列出改过的共享位置；合入时由 merger 解决冲突。
- 现在的删除是列表行内的“确认删除”，没有二次确认框和引用数量，由本票替换。

### 票 04 交付记录

**覆盖的验收**

- MS-32：确认框（`role="alertdialog"`）打开时经 `GET /api/providers/:id/references` 读取引用数量；确认后同一事务删除 Provider 与 Credential、清空引用它的 Session 模型字段（档位 off，不改 updatedAt）、`defaultModel` 指向它时改为 null（revision 递增），因此默认模型回退为第一个可用模型；sidecar 清除明文缓存。Session 模型字段为空且有可用模型时，Run 以 409 `model-required` 拒绝（不再自动选用默认模型），界面在输入区上方提示“这个会话的模型已不可用，请先选择模型”，模型选择器显示“选择模型”，发送失败的 Toast 为“请先为这个会话选择模型”。
- MS-33：相同 ID 重新创建后引用数为 0，原 Session 仍为 null，旧 Credential 与明文缓存都不在（新 Provider 无 Key 时模型服务收不到请求）。
- 取消、Escape 不调用删除、列表不变，焦点回到该项“删除”；数量读取失败时“删除”禁用并可重试；删除失败时保留确认框与列表并 Toast。删除后焦点移到同一位置的列表项“编辑”（或添加入口）。

**实际运行的命令与结果**

- `vitest run --project session`：63 passed（含新契约用例，内存与 SQLite 各一）。
- `vitest run --project integration tests/integration/sidecar-provider-delete.test.ts`：1 passed。
- `vitest run --project server --project protocol --project integration`（并行）：266 passed / 5 failed，失败均为约 20s 超时；单独重跑 sidecar-recovery、sidecar-session、sidecar-settings-credentials、sidecar-thinking-level 4 个文件：30 passed。
- `vitest run --project desktop-renderer --project desktop --project i18n --project scripts`（并行）：237 passed / 2 failed（`src/main/sidecar-supervisor.test.ts` 5s 超时，本票未改）；单独重跑该文件：5 passed。其中 delete-provider.browser.test.tsx 4 passed，models-section.browser.test.tsx 11 passed，app.browser.test.tsx 20 passed。
- `vitest run --project desktop-e2e`：settings.e2e.test.ts 2 passed / 1 skipped（真实 DeepSeek，无凭据）；provider-delete.e2e.test.ts 1 passed。
- `tsc -b` 通过；`oxlint` 0 warnings / 0 errors；`oxfmt --check` 通过；`vitest run --project scripts` 22 passed；`pnpm run check:docs` 129 个文件 0 个问题。

**负向确认**

- 契约用例、集成用例、store 用例、浏览器用例均先红（缺 `references`、`providerReferences`、`setReferences`、对话框）。
- 变异：去掉 `ProviderService.delete` 中的 `invalidateCredential` 后，集成用例因旧明文 Key 被发出而失败（请求数 2 ≠ 1）；恢复后通过。
- 变异：会话模型为空时恢复为代填 `defaultModel`，浏览器用例的“选择模型”断言失败；恢复后通过。

**行为变化（请 Lead 留意）**

- Run 开始时 Session 模型字段为空且有可用模型：原先自动选用默认模型并写入 Session，现在 409 `model-required`。这覆盖票 01 迁移 v4 清空的 Session（规格 4.9「下次运行前提示重新选择模型」）。没有任何可用模型时仍为 `model-not-configured`。新建 Session 仍在创建时取默认模型，不受影响。
- 会话（非草稿）的模型字段为空时，界面不再以默认模型代填显示。

**未验证项**

- 明暗主题与窄窗口下确认框的视觉未逐项检查（沿用“放弃更改？”同一 Dialog 组件与几何）；Pencil 源稿没有删除确认画面。
- 真实模型服务未验证（无凭据）。
- 删除正在运行的 Session 引用的 Provider：当前 Run 不中断，下一个 Run 按 `model-required` 处理；未单独测试。

**文档影响**

- 更新 `apps/server/README.md`（providers 路由、references、删除语义、`model-required`、新集成测试）与 `packages/session/README.md`（`references`、`delete` 语义）。ADR 与 GLOSSARY 未改。

**改动的共享位置（供合入时解决与票 05 的冲突）**

- `features/settings/models-section.tsx`：删除行内“确认删除”；`ProviderRow` 新增 `onDelete` 属性、删除按钮加 `data-provider-delete`；分区新增 `deleting` 状态并渲染 `DeleteProviderDialog`（`focusAfterClose`）；去掉 `toast` 与 `useSettingsActions().deleteProvider` 的行内用法；`providers.map` 带 `index`。
- `features/settings/models-section.browser.test.tsx`：最后一个用例的删除改为点确认框的 “Delete”（1 行）。
- i18n `providers.*`：删除 `providers.confirmDelete`，新增 `providers.deleteDialog.{title,description,counting,references,noReferences,referencesFailed}`；另增 `errors.modelRequired`、`conversation.modelRequired`（zh / en）。
- `testing/fake-settings.ts`：api 新增 `providerReferences`（vi.fn），`deleteProvider` 同时清掉引用数；返回值新增 `setReferences(id, n)`。
- 其他：protocol `ErrorCode` 新增 `model-required`、`apiPaths.providerReferences`、`ProviderReferencesResponse`；`testing/fixture-chat.ts` 新增 `sessions` 选项与删除后清空引用并重读会话；`main.tsx` 传 `onProviderDeleted`；`conversation-pane.tsx`、`chat-failure.ts`。

**供后续票**

- 新文件：`features/settings/delete-provider-dialog.tsx`（`DeleteProviderDialog`、`DeleteProviderRequest`）。DOM：确认框 `[data-delete-provider-dialog]`（`role="alertdialog"`），数量区 `[data-provider-references="loading"|"ready"|"error"]`，行内删除按钮 `[data-provider-delete]`，输入区提示 `[data-slot="model-required"]`。
- store：`settings.providerReferences(id)`（失败抛 `ApiError`），`createSettingsStore({ onProviderDeleted })`。ApiClient：`providerReferences(id)`。
- session：`ProviderRepository.references(id)`、`delete(id): Promise<ProviderReferences>`；session 公共导出 `ProviderReferences`。
- 测试：`tests/integration/sidecar-provider-delete.test.ts`、`apps/desktop/e2e/provider-delete.e2e.test.ts`、`features/settings/delete-provider.browser.test.tsx`。

### 合入记录（ms-merger，2026-10-29）

- 以 `git merge --no-ff ms/04-delete-provider` 合入集成分支 model-service，合入提交 cdf507c（票分支 79e50f0，基于 ab95d95），无冲突。
- 集成 worktree 复核：`pnpm install --frozen-lockfile` 退出 0；`pnpm run typecheck` 退出 0；`pnpm run lint` 0 警告 0 错误（545 文件）；`pnpm run format:check` 通过（571 文件）；`pnpm run test` 189 文件，1330 通过、1 跳过（`settings.e2e` 的真实 DeepSeek 用例，无密钥），含 `sidecar-provider-delete`、`provider-delete.e2e` 与全部 desktop-e2e、产物 smoke；`pnpm run check:docs` 129 文件 0 问题。实施记录中并行运行时的超时失败在这次全量串行中没有出现。第一次全量运行被中断，没有结果；以上数字来自重跑。
- Spec 评审：对照 MS-32、MS-33 与规格 4.9。
  - 引用数量：`references` 按 `sessions.model_provider_id` 计数，与删除时清空的范围一致。
  - 删除：同一个写事务删除 Provider（Credential 随外键级联删除）、清空引用它的 Session 模型字段并置 `thinking_level = 'off'`，`defaultModel` 指向它时改为 null 并递增 revision；之后 `invalidateCredential` 清除明文缓存。
  - MS-33：相同 ID 重新创建后原 Session 仍为 null，由集成测试覆盖。没有发现阻塞缺口。
- **最终评审项（不阻塞）**：没有 Provider 时创建的 Session（模型从未设置）在之后添加 Provider 后也会被 409 `model-required` 拦截，不会使用新的默认模型。在集成 worktree 用临时集成测试确认（测试文件已删除，未提交）：建 Session 时 `model` 为 null；没有 Provider 时提交返回 409 `model-not-configured`；保存 Provider 后 `defaultModel` 为 `later-provider/m1`，再提交返回 409 `model-required`。界面的常规路径不会产生这种 Session：没有 Provider 时发送入口变为“配置模型”，草稿在添加 Provider 后带默认模型创建 Session。只有经 API 创建，或在更早的版本中已创建的 Session 会遇到；遇到时输入区显示 `model-required` 提示，用户选择模型后可以继续。规格 4.9 只要求“删除或升级清空引用的 Session 下次运行前提示重新选择模型”，没有说明从未设置模型的 Session 应该怎样处理，留到最终评审决定是否区分这两种情况。
- 越出写范围（`conversation-pane.tsx`、`chat-failure.ts`、`main.tsx`、`fixture-chat.ts`、protocol 与 session 的增量）与实施记录一致。
- “供后续票”的约定已转写到票 05、06、07 的 Comments（标题“来自票 04”），05 中列出了并行实施的冲突点。

Closed: true
