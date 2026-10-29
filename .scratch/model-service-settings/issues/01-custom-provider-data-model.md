# 01: 数据模型改为自定义 Provider

**What to build:** Provider 不再有 kind 与品牌预设：协议是 Provider 自身字段，ID 由用户输入并作为主键；Model Catalog 中每个模型可保存显示名称、上下文窗口、最大输出、输入类型、推理开关与各 Thinking Level 的参数值，并据此注册到模型 registry。库迁移清除旧数据。现有设置界面做最小调整（ID 输入、协议下拉、去掉预设选择）以保持可用，后续票再按规格重做界面。这是贯穿 protocol、agent、server、session、renderer 与测试的一次性改动，必须整体落地并保持全部检查通过。

**Blocked by:** None (can start immediately)

**Status:** done

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。

- [x] 用合格 ID、三种协议之一和含容量、输入类型与档位的模型创建 Provider 后，重启 Sidecar 读回完全一致；registry 中的模型带这些能力与 `thinkingLevelMap`
- [x] ID 不符合 `^[a-z][a-z0-9-]{0,63}$` 或与已有 Provider 重复时被拒绝，库不变
- [x] 从上一版本库升级：生成备份；旧 Provider、Credential、默认模型设置被清除，引用它们的 Session 模型字段为空，其余 Session 与条目可读
- [x] 独立运行只读取 `COKO_CREDENTIAL_<PROVIDER_ID>`；按 kind 读取的 `*_API_KEY` 不再被读取或登记脱敏；依赖它们的测试已改写且仍覆盖原意图
- [x] provider-presets 接口与 kind 相关的类型、字典与编译期断言已删除，代码中不再出现 Provider kind
- [x] 现有设置界面仍可创建、编辑、删除 Provider 并配置 Key
- [x] server README 等当前行为文档同步更新；`pnpm run check:docs` 通过

## Comments

### 实施记录（ms-01，2026-10-29）

分支 `ms/01-custom-provider-data-model`，已合入 `model-service` 最新提交（3a26bc3，含票 09）。

**覆盖的验收**

1. 创建后重启读回一致、registry 带能力与 `thinkingLevelMap`：`tests/integration/sidecar-settings-credentials.test.ts`（同一数据目录重启两次 Sidecar，`GET /api/providers` 逐字段相等，`/api/models` 与默认模型来自目录）；`apps/server/src/application/providers.test.ts`（registry 中模型的容量、输入、reasoning、`thinkingLevelMap`，重新 `load()` 后一致）；`packages/agent/src/models/models.test.ts`。
2. ID 不合格或重复被拒绝、库不变：协议 schema（`PROVIDER_ID_PATTERN`）400；重复 409 `already-exists`（`details: { field: 'id', id }`）；仓库契约 `already-exists` 且已有记录与密文不变；集成测试比对拒绝前后的列表。
3. 升级：`packages/session/src/sqlite/migrate-v4.test.ts`（v3 → 4）与 `tests/integration/sidecar-recovery.test.ts`（经 Sidecar 从 v1 升到 4）：生成备份且保留旧 Provider；旧 Provider、Credential、`defaultModel` 被清除；Session 模型字段为空，其余字段（含 updatedAt）与条目可读。
4. 独立运行只读 `COKO_CREDENTIAL_<PROVIDER_ID>`：`apps/server/src/adapters/credentials.test.ts`；集成测试中 ID 为 `deepseek` 的 Provider 在设置了 `DEEPSEEK_API_KEY` 时仍无 Credential、不发请求。secrets-gate（主文件、compaction、memory）改用 `COKO_CREDENTIAL_GATE_PROVIDER`，仍验证按值脱敏与不外泄。`*_API_KEY` 仍由通用的 `API_KEY` 规则从命令环境剔除。
5. kind 删除：`git grep` 已无 `ProviderKind`、`PROVIDER_KINDS`、`providerPresets`、`apiKeyEnvOf`、`protocolOf`、`providers.kinds`、`data-kind`；`/api/provider-presets` 返回 404。只剩测试中断言 `kind` 字段被拒绝的用例。
6. 现有设置界面：浏览器测试覆盖新建（ID、协议下拉、ID 格式与重复提示）、编辑（ID 静态、改协议、保留已有模型能力、空 Key 不改 Credential）、删除、Credential 失败转编辑；Electron E2E 经界面新建 Provider 并配置 Key 后调用本地假服务。
7. 文档：apps/server、packages/session README，ADR 0004、ADR 0010（implementation → partial，附证据）、ADR 索引、docs/subsystems/mcp.md；`pnpm run check:docs` 通过。

**实际运行的命令与结果（合入 model-service 之后）**

- `pnpm run format:check`、`pnpm run lint`（0 warning、0 error）、`pnpm run typecheck`（0 error）、`pnpm run check:docs`（129 文件 0 问题）。
- `npx vitest run packages/protocol packages/agent packages/session packages/i18n apps/server apps/desktop/src tests/integration`：141 文件、1105 用例，1 个失败（`sidecar-recovery` 写死版本 3）；修正并扩展后 `tests/integration/sidecar-recovery.test.ts` 5/5 通过。
- `npx vitest run --project desktop-e2e apps/desktop/e2e/settings.e2e.test.ts`：2 通过、1 跳过（真实 DeepSeek，无宿主密钥）。

**负向确认**

- 先红：agent registry 12 例、protocol 4 例、session 5 例、ProviderService 3 例、credentials 在实现前失败。
- 变异：在 `createEnvCredentialStore` 中恢复 `DEEPSEEK_API_KEY` 回退与登记 → 2 例失败；表单 `toCatalog` 不保留已有模型 → 编辑用例失败；均已撤销，diff 为空。
- 编译期断言：protocol 与 agent 的 `ModelProtocol`、`ThinkingLevel` 一致，`CatalogModel` 与 `ModelSpec` 相同；实施中它曾因档位字面量推断为 never 而失败，已修正。

**未验证**

- 真实模型服务（无宿主密钥）。未跑全部 Electron E2E 与产物 smoke（未改打包、入口与资源路径）。
- 迁移后 Session 模型字段为空时，Run 会按原逻辑自动选用默认模型（有其他 Provider 时）；"下次运行前提示重新选择模型"属于票 04 / 界面，本票未改变。

**偏离与说明**

- 新增错误码 `already-exists`（protocol `ErrorCode` 与 session `StoreErrorCode`），HTTP 409。规格只要求“拒绝”，未规定状态码。
- HTTP 仍提供 Provider 的创建与更新（票 02 移除）；设置表单的模型目录暂为逗号分隔的模型 ID，新模型取默认能力、已有模型保留其能力（票 03–06 重做）。

**供后续票**

- protocol（`@coko/protocol`）：`PROVIDER_ID_PATTERN`、`ProviderId`、`ModelProtocol`、`ThinkingLevel` / `THINKING_LEVELS`（off、minimal、low、medium、high、xhigh、max）、`ThinkingLevelConfig`（`{ level: 'off' }` 或 `{ level, value }`，value 非空）、`CatalogModel { id, name, contextWindow, maxTokens, input, reasoning, thinkingLevels }`（name 为空表示用 ID；`thinkingLevels` 按添加顺序保存）、`MODEL_CATALOG_DEFAULTS { contextWindow: 128000, maxTokens: 16000 }`、`Provider { id, name, api, baseUrl, models, credential, createdAt, updatedAt }`、`CreateProviderRequest { id, name, api, baseUrl, models }`、`UpdateProviderRequest`（不含 id）、错误码 `already-exists`。
- agent（`@coko/agent`）：`ModelSpec`（与 `CatalogModel` 同形）、`ProviderConfig { id, name, api, baseUrl, models }`、`THINKING_LEVELS`、`ThinkingLevelSpec`。registry 的 `thinkingLevelMap`：已配置档位为其 value，未配置为 null，off 不写入（按协议默认关闭）；`reasoning` 关闭时 pi-ai 只支持 off。校验（`ModelConfigError` → 400）：http(s) 地址、目录非空、模型 ID 不重复、正整数容量且 maxTokens ≤ contextWindow、档位不重复。
- server：`catalogOf(provider)`、`toProviderConfig`、`toProviderDto`（`apps/server/src/application/providers.ts`）；`ProviderService.create` 先校验再写库，重复 ID 抛 `AppError('already-exists')`。
- session：`ProviderInput { id, name, api, baseUrl, models: JsonValue[] }`，`SQLITE_SCHEMA_VERSION` 为 4。
- 测试 helper：`tests/integration/sidecar-harness.ts` 的 `catalogModel`、`customProvider`；`apps/desktop/src/renderer/testing/fake-settings.ts` 的同名 helper；`tests/fixtures/v1-database.ts` 的 `withProvider` 与 `V1_PROVIDER`。
- renderer：`ProviderDraft { id, isNew, name, api, baseUrl, models: CatalogModel[], secret }`；表单字段 `name` 属性为 `providerId`、`name`、`baseUrl`、`models`、`credential`；协议下拉为 `DropdownMenuRadioItem[data-protocol]`；列表项 `[data-provider-id][data-protocol]`。i18n 新增 `providers.id`、`idHint`、`idInvalid`、`idTaken`、`protocol`、`protocols.*`、`baseUrlInvalid`，删除 `kinds.*`、`baseUrlPresetHint`、`baseUrlRequired`。

**越出建议写范围的改动**：`tests/fixtures/v1-database.ts`（迁移证据）、`docs/subsystems/mcp.md`、`docs/adr/0004*`、`docs/adr/0010*` 与 `docs/adr/README.md`（凭据来源描述与实施状态同步）。共享文件 `packages/protocol/src/errors.ts`、`packages/i18n/src/dictionaries/{zh,en}.ts` 只做增删本票所需的键。

### 合入记录（ms-merger，2026-10-29）

- 以 `git merge --no-ff ms/01-custom-provider-data-model` 合入集成分支 model-service，合入提交 4bac390（票分支 52393c6），无冲突。
- 集成 worktree 复核：`pnpm install --frozen-lockfile` 退出 0；`pnpm run typecheck` 退出 0；`pnpm run lint` 0 警告 0 错误（535 文件）；`pnpm run format:check` 通过（561 文件）；`pnpm run test` 182 文件，1294 通过、1 跳过（`settings.e2e` 的真实 DeepSeek 用例，无密钥），含全部 desktop-e2e 与产物 smoke；`pnpm run check:docs` 129 文件 0 问题。
- Spec 评审：验收 7 项与 diff 对应。`git grep` 在 apps、packages、tests 中已无 `ProviderKind`、`PROVIDER_KINDS`、`providerPresets`、`apiKeyEnvOf`、`protocolOf`；剩余的 `DEEPSEEK_API_KEY` 只出现在 e2e 环境剔除、真实模型用例和“不读取品牌变量”的负向测试中。ADR 0010 改为 `implementation: partial`，正文写明已实施范围（去 kind、ID 主键、迁移 v4、只读 `COKO_CREDENTIAL_<PROVIDER_ID>`）与未实施部分（一次提交、一次存储、获取模型），ADR 索引与 ADR 0004 同步。HTTP 创建与更新仍保留，由票 02 移除；空模型 Session 的重新选择提示归票 04。
- “供后续票”的约定已转写到票 02、03、04、05、07、08 的 Comments（标题“来自票 01”）。

Closed: true
