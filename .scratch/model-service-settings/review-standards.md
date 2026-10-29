# Standards 评审（main…fc1e12c）

**硬违规**
1. `apps/server/src/application/provider-models.ts` `listProviderModels` / `requestOf`：server 自写三协议的模型列表 HTTP 适配；[agent-runtime.md](../../docs/tech-stack/agent-runtime.md)「框架能力分工」规定模型适配层（Provider、能力识别）归 packages/agent。

**判断项**
2. Feature Envy：session `providers.delete`（`sqlite/repositories.ts`、`memory/index.ts`）改写 `defaultModel` 设置，`internal.ts` 复制该键与值形状；architecture.md：业务含义由上层定义。
3. Duplicated Code：http(s) 校验三处（agent `checkBaseUrl`、server `listProviderModels`、renderer `provider-draft.ts isHttpUrl`）；Key 上限 4096 与 15 秒时限在 main 两文件、server、protocol 重复；`providers.ts` 三处相同的 StoreError→AppError 映射。
4. Primitive Obsession／Data Clumps：session 层 `thinkingLevel: string`，`sessions.ts` 两处 `as ThinkingLevel`；`(model && level) || 'off'` 四处；model 与档位总是成对传递。
5. provider.save 的错误映射内联在 `runtime/layers.ts`，provider.models 在 application（architecture.md 目录职责）。
6. Mysterious Name：`provider-models.ts describe()`；`CredentialChannel` 兼作模型通道。
7. Speculative Generality：`ProviderModelsBridge.timeoutMs` 生产代码未使用。
8. Middle Man：`settings-store.providerReferences` 只转发并重抛。

## 处理结果

验证（集成 worktree，合入提交 8a73fdf，修复分支 `ms/review-fixes` 5b4c046，基于 fc1e12c，无冲突）：`pnpm install --frozen-lockfile` 退出 0；`pnpm run typecheck` 退出 0；`pnpm run lint` 0 警告 0 错误（574 文件）；`pnpm run format:check` 通过（600 文件）；`pnpm run test` 206 文件，1451 通过、1 跳过（`settings.e2e` 的真实 DeepSeek 用例，无密钥），含全部 desktop-e2e 与产物 smoke；`pnpm run check:docs` 131 文件 0 问题。

1. 已修复：三种协议的模型列表 HTTP 适配移到 packages/agent 的模型层（`packages/agent/src/models/list-models.ts` 的 `listProviderModels`，2a05220）；server 的 `provider-models.ts` 只负责装配、时限、按值脱敏与错误码映射，不再自己发请求。
2. 已修复：session 的 `providers.delete` 不再知道 `defaultModel` 的键与值形状，改为接受调用方给出的设置改写，并在同一事务中应用；默认模型规则在 server 的 `ProviderService`（422d12e）。session 中只剩 v4 迁移 SQL 里的一处 `'defaultModel'` 字面量。
3. 已修复：Key 上限 `MAX_CREDENTIAL_LENGTH` 与模型列表时限 `PROVIDER_MODELS_TIMEOUT_MS` 放在 protocol，main、server 共用；renderer 的地址校验改用 protocol 的 `isHttpUrl`（c5a0432）。agent 因为不依赖 protocol 保留自己的一份 `isHttpUrl`（`models/base-url.ts`），配置校验与模型列表共用；`apps/server/src/application/provider-limits.test.ts` 断言两份结果一致，并且没有其他副本。`providers.ts` 中 StoreError → AppError 的映射合为一处（9d5b035）。
4. 已修复：session 的 `thinkingLevel` 改为 `ThinkingLevel` 类型，七档之外的已存值读回为 off；`levelOf` 取代四处 `(model && level) || 'off'`；`setSessionModel` 接受一个 `SessionModelChoice`，模型与档位成对传递；server 中的 `as ThinkingLevel` 已去掉（932127d）。
5. 已修复：`provider.save` 的回答与错误映射从 `runtime/layers.ts` 移到 application 层，与 `serveProviderModels` 并列（89d2ba8）。
6. 已修复：`CredentialChannel` 也承载 Secret 与模型列表消息，改名为 `SidecarControlChannel`；`describe()` 移到 agent 时改名为 `networkCause`（92ca06f）。
7. 已修复：去掉生产代码未使用的 `ProviderModelsBridge.timeoutMs` 字段（4ad9aa8）。构造参数 `timeoutMs` 仍保留，供测试注入，默认值为 protocol 的 `PROVIDER_MODELS_TIMEOUT_MS`。
8. 已修复：`settings-store.providerReferences` 直接转发 ApiClient，不再捕获后重新包装错误（d5486e9）。方法保留，因为组件只经 store 访问 ApiClient。
