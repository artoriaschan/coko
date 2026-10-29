# 06: 推理档位配置

**What to build:** 在展开的模型选项中，用“推理等级”开关和档位列表为模型配置 Thinking Level 及其 API 参数值。

**Blocked by:** 05

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉以 Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 为准（画面 02C、06）。

- [ ] MS-15 至 MS-18、MS-36 通过
- [ ] “添加档位”按 off、minimal、low、medium、high、xhigh、max 顺序补齐最早缺失档位；七档齐全后置灰且文案不变；无顺序或下一档提示
- [ ] 修改某行档位只能选尚未配置的档位；同一模型不出现重复档位
- [ ] off 行参数输入禁用并显示“关闭思考”；其余档位默认参数值等于档位名且可编辑
- [ ] 开关关闭时已填档位仍随草稿保存，重新打开表单时仍在

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
