# 08: 会话中选择推理档位

**What to build:** 在会话的模型选择器中为支持推理的模型选择 Thinking Level：始终有“关闭”，推理开关打开时再列出该模型已配置的档位。新建 Session 默认为“关闭”；档位与模型一起按 Session 保存，切换到不支持当前档位的模型时回到“关闭”。请求按所选档位发送其参数值，“关闭”按协议的默认关闭方式请求。

**Blocked by:** 02

**Status:** ready-for-agent（实施完成，待合入）

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉沿用现有模型选择器与设计系统菜单组件（源稿未覆盖此处）。

- [x] MS-34、MS-35 通过
- [x] 档位与模型一起持久化，Sidecar 重启后读回；Run 进行中不能切换（与切换模型一致）
- [x] 经回显请求的假服务确认：选 high 时请求带配置的参数值；选“关闭”时按协议默认方式（例如 Responses 的 `effort: "none"`）
- [x] 未配置的档位与推理开关关闭的模型不出现档位选项
- [x] 模型选择器的其他交互不变；集成测试可经控制消息直接创建带档位的 Provider，不依赖 06 的界面

## Comments

### 来自票 01

- 数据模型（票 01 已合入）：Provider 没有 kind 与品牌预设，`Provider { id, name, api, baseUrl, models, credential, createdAt, updatedAt }`，ID 由用户输入并作主键，须符合 `PROVIDER_ID_PATTERN`（`^[a-z][a-z0-9-]{0,63}$`）。
- `CatalogModel { id, name, contextWindow, maxTokens, input, reasoning, thinkingLevels }`（`@coko/protocol`）与 agent 的 `ModelSpec` 同形，由编译期断言保证；name 为空表示显示为模型 ID；`thinkingLevels` 按添加顺序保存。默认容量为 `MODEL_CATALOG_DEFAULTS { contextWindow: 128000, maxTokens: 16000 }`。
- Thinking Level：`THINKING_LEVELS` 为 off、minimal、low、medium、high、xhigh、max；`ThinkingLevelConfig` 是 `{ level: 'off' }` 或 `{ level, value }`（value 非空）。registry 的 `thinkingLevelMap` 中已配置档位为其 value，未配置为 null，off 不写入（按协议默认关闭）；`reasoning` 关闭时 pi-ai 只支持 off。
- 迁移 v4 把引用旧 Provider 的 Session 模型字段置空，session `SQLITE_SCHEMA_VERSION` 为 4；新增 Session 字段时迁移从 4 往上走。空模型字段时的重新选择提示归票 04。

### 来自票 02

- 一次保存（票 02 已合入）：协议用 `ProviderFields { id, name, api, baseUrl, models }`，取代已删除的 `CreateProviderRequest` / `UpdateProviderRequest`。保存只走一条控制消息 `provider.save { requestId, mode: 'create' | 'update', provider, credential?: { ciphertext, hint } }`，回复为 `provider.save.result`（`ok: true, provider` 或 `ok: false, error: { code, message, details? }`）。`credential.store` 已删除。
- renderer 经 `bridge.saveProvider({ mode, provider, secret? })` 提交，取代已删除的 `setCredential`。结果失败时为 `{ ok: false, code: ProviderSaveErrorCode, message, details? }`，`ProviderSaveErrorCode` 是 `'invalid-input' | 'encryption-unavailable' | 'sidecar-unavailable' | 'timeout'` 或 protocol `ErrorCode`（如 `already-exists`）。store 侧为 `settings.saveProvider(draft)`，返回 `SaveProviderResult`（不再有 `stage`）；编辑时 `draft.secret === ''` 表示保留原 Key。
- ApiClient 不再有 `createProvider` / `updateProvider`；HTTP 只保留 GET 与 DELETE `/api/providers`，POST / PATCH 返回 404。
- 测试：renderer fake（`apps/desktop/src/renderer/testing/fake-settings.ts`）用 `backend.seedProvider(fields, secret?)` 预置 Provider，用 `backend.saveProvider`（vi.fn）模拟和断言一次提交；`customProvider` 返回 `ProviderFields`。集成 harness（`tests/integration/sidecar-harness.ts`）有 `saveProvider(sidecar, fields, { mode?, secret? })`、`seedProviders(dirs, fields[])`、`answerDecrypts(sidecar)`、`testCipher`。独立运行的 sidecar 不能保存 Provider，要用 IPC 模式或 `seedProviders` 预置。
- 需要 Provider 的 Session 测试用 `backend.seedProvider` 或 harness 的 `seedProviders` / `saveProvider` 预置，不要再走 HTTP 创建。

### 票 08 交付（ms/08-session-thinking-level）

**覆盖的验收**

- MS-34：新建 Session 的 `thinkingLevel` 为 off；`GET /api/models` 的每个模型带 `thinkingLevels`（off，推理开关打开时再加已配置档位，固定顺序），选择器只在多于 off 时列出“推理档位”分组。证据：`tests/integration/sidecar-thinking-level.test.ts`、`app.browser.test.tsx`“推理档位”用例、`models.test.ts`。
- MS-35：选 high 后请求带配置值（Responses `reasoning.effort: 'deep'`，Chat Completions `reasoning_effort: 'deep'`）；换到未配置 high 的模型回到 off，换到同样配置 high 的模型保留；重启 Sidecar 后读回并按该档位请求。
- MS-36：推理开关关闭的模型只有 off（PUT 给 high 时 400，请求不带 reasoning），已填档位仍在目录中（目录未改动）。
- off 按协议默认方式：Responses `effort: 'none'`、Chat Completions 不带 `reasoning_effort`、Anthropic `thinking: { type: 'disabled' }`。
- Run 进行中 `PUT …/model` 带档位为 409 `run-in-progress`，档位不变。集成测试经 `provider.save` 直接创建带档位的 Provider，不依赖 06 的界面。

**运行的命令与结果（合入 model-service `aee1e7b` 之后，无新提交需合入）**

- `pnpm exec vitest run packages/agent packages/session packages/protocol packages/i18n apps/server apps/desktop/src`：109 文件、988 用例通过。
- `pnpm exec vitest run --project desktop-renderer`：7 文件、54 用例通过。
- `pnpm exec vitest run tests/integration`：35 文件、137 用例通过（含全部 `secrets-gate*`）。
- `pnpm run typecheck` 通过；改动文件 `oxfmt --check`、`oxlint` 0 问题；`pnpm run check:docs` 0 问题。

**负向确认**

- 每个新用例先红：session 契约与 v5 迁移（无字段）、runtime（无 `setThinkingLevel`）、`selectableThinkingLevels`（未导出）、集成（无 `thinkingLevels`，PUT 拒绝未知字段）、chat-store（无 `draftThinkingLevel`）、浏览器（无档位分组）。
- 变异：注释掉 server 中两处 `setThinkingLevel` 后集成用例 2 个失败（effort 为 none 而非 deep）；选择器中换模型时不回到 off 后浏览器用例失败。均已还原。

**未验证**

- Anthropic Messages 的非 off 档位：pi-ai 对未设 `compat.forceAdaptiveThinking` 的模型走 budget 思考（`thinking: { type: 'enabled', budget_tokens }`），不发送档位配置的参数值；只有 adaptive 模型发送 `output_config.effort`（取配置值）。本票没有改 registry 的 compat，也没有为 Anthropic 的 high 写断言。若要求 Anthropic 也发送配置值，需另行决定 compat（例如自定义 Provider 默认 adaptive）。
- 真实模型服务未验证（无密钥）。分叉沿用原档位（`checkpoints.ts`）没有专门用例（faux 模型无档位）。

**文档影响**

- `apps/server/README.md`（Session 模型、`PUT …/model`、`/api/models`、集成测试列表、迁移版本）、`packages/session/README.md`（v5、`thinkingLevel` 契约、测试）、`docs/subsystems/recovery.md`（当前版本 5）。

**共享文件的最小增量改动（合入时注意与 03 的冲突）**

- `packages/protocol/src/http.ts`：ThinkingLevel 定义整体上移到 Session 之前（内容不变）；`Session.thinkingLevel`；`CreateSessionRequest.thinkingLevel?`；`SetSessionModelRequest.thinkingLevel?`；`AvailableModel.thinkingLevels`。barrel 未改。
- `packages/i18n/src/dictionaries/{zh,en}.ts`：只在 `models` 下加 `thinkingLevel` 与 `thinkingLevels.{off…max}`（zh off 为“关闭”，其余为档位名）。
- `apps/desktop/src/renderer/stores/chat-store.ts`：`draftThinkingLevel`、`selectModel(model, thinkingLevel?)`、创建时带非 off 档位。settings-store 未改。
- `apps/desktop/src/renderer/testing/fake-settings.ts`：`models()` 带 `thinkingLevels`（与 Sidecar 同规则）；`fixture-chat.ts` 的 `setSessionModel` 回传档位。
- session schema：新增迁移 v5（`sessions.thinking_level TEXT NOT NULL DEFAULT 'off'`），`SQLITE_SCHEMA_VERSION` 为 5；之后的迁移从 5 往上走。

**供后续票**

- `@coko/agent`：`selectableThinkingLevels(model)`；runtime `setThinkingLevel(level)`（Run 中抛 `RuntimeBusyError`）。
- `@coko/session`：`Session.thinkingLevel: string`；`setSessionModel(id, model, thinkingLevel?)`，档位缺省或模型为 null 时写 off。票 04 清空模型字段时（`setSessionModel(id, null)` 或 SQL）档位应一并为 off；直接写 SQL 时请同时置 `thinking_level = 'off'`。
- server：保存的档位在当前目录中已不可选时，DTO 与请求都按 off（`#effectiveLevel`），所以票 06 修改目录后不需要迁移 Session。
- renderer：`ModelPicker` 新增必填 `thinkingLevel`，`onChange(model, thinkingLevel)`；导出 `levelForModel`。档位项带 `data-thinking-level`。

### 合入记录（ms-merger，2026-10-29）

- 以 `git merge --no-ff ms/08-session-thinking-level` 合入集成分支 model-service，合入提交 b21b7db（票分支 79c784f，基于 aee1e7b），无冲突。
- 集成 worktree 复核：`pnpm install --frozen-lockfile` 退出 0；`pnpm run typecheck` 退出 0；`pnpm run lint` 0 警告 0 错误（538 文件）；`pnpm run format:check` 通过（564 文件）；`pnpm run test` 185 文件，1314 通过、1 跳过（`settings.e2e` 的真实 DeepSeek 用例，无密钥），含全部 desktop-e2e 与产物 smoke；`pnpm run check:docs` 129 文件 0 问题。
- Spec 评审：对照规格 4.7 与 MS-34、MS-35、MS-36，档位总含 off、推理开关打开才列出已配置档位、新建为 off、与模型一起保存且重启后读回、换到不支持当前档位的模型回到 off、Run 中切换 409、off 按协议默认方式请求，都与 diff 和测试一致。档位与模型一样写在 Session 字段上（`setSessionModel`），不生成单独的条目，与模型切换的现有做法相同。
- **已知未满足项（不阻塞，留到最终评审）**：Anthropic Messages 的模型没有设 `compat.forceAdaptiveThinking` 时，非 off 档位由 pi-ai 按 budget 思考请求（`thinking: { type: 'enabled', budget_tokens }`），不发送档位配置的参数值；只有 adaptive 模型发送 `output_config.effort`（取配置值）。这与规格 4.7“选择其他档位时发送该档位配置的 API 参数值”不完全一致。本票没有为 Anthropic 的 high 写断言。
- “供后续票”的约定已转写到票 03、04、05、06、07 的 Comments（标题“来自票 08”）；票 03 中注明了与 08 在 i18n 字典、`fake-settings.ts`、`fixture-chat.ts` 处可能冲突。

Closed: true
