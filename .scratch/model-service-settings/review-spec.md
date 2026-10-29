# Spec 评审：model-service（main 9e18e1a...HEAD）

依据 spec.md、票 01–09 的 Comments、ADR 0010 / 0004；只读核对代码，没有修改或提交。

**(a) 缺失或部分实现**
- 中：Anthropic 非 adaptive 模型的非 off 档位按 budget 思考请求，不发送参数值。4.7“选择其他档位时发送该档位配置的 API 参数值”。
- 低：Anthropic 模型列表只取一页（`limit=1000`），不跟随 `has_more`。4.6“每行只显示供应商返回的模型 ID”。
- 低：ADR 0010 第 42 行列出的“加密不可用时库不变”只有单元测试，迁移清除的集成证据 ADR 未引用。

**(b) 范围蔓延**
- 低：状态文字带 Key 末四位。4.1“只表示‘已配置 Key / 未配置 Key’”。
- 低：容量接受小数后缀（`1.5M`）。4.5“输入接受纯数字或 K/M 后缀”。

**(c) 实现有误**
- 低：从未设置模型的 Session 在添加 Provider 后被 409 `model-required` 拦截。4.1 只要求引用被删 Provider 的 Session“下次运行前提示重新选择模型”。只有经 API 创建的 Session 会触发。
- 低：编辑表单的“显示名称”在“供应商设置”分组里，不在身份区。4.3“身份信息中保留‘显示名称’的可编辑字段”。
- 低：Switch 轨道的 `transition-colors` 缺 `motion-reduce`（滑块已有）。第 6 节“视觉规则以界面约定和设计系统规格为准”。

结论：无阻塞项。


## 处理结果

验证（集成 worktree，合入提交 8a73fdf，修复分支 `ms/review-fixes` 5b4c046，基于 fc1e12c，无冲突）：`pnpm install --frozen-lockfile` 退出 0；`pnpm run typecheck` 退出 0；`pnpm run lint` 0 警告 0 错误（574 文件）；`pnpm run format:check` 通过（600 文件）；`pnpm run test` 206 文件，1451 通过、1 跳过（`settings.e2e` 的真实 DeepSeek 用例，无密钥），含全部 desktop-e2e 与产物 smoke；`pnpm run check:docs` 131 文件 0 问题。

**(a) 缺失或部分实现**
- 已修复：Anthropic 非 off 档位改为以 adaptive effort 发送配置的参数值；推理开关打开的 Anthropic 模型注册时带 `compat.forceAdaptiveThinking`（9a79a96，`packages/agent/src/models/registry.ts`；`tests/integration/sidecar-thinking-level.test.ts` 断言请求中的 effort）。
- 已修复：Anthropic 模型列表跟随 `has_more`，以 `after_id` 翻页，至多 20 页，超过时为 `invalid-response`（9843181，`packages/agent/src/models/list-models.ts`；`list-models.test.ts` 覆盖分页与页数上限）。
- 已修复：ADR 0010 的证据补齐。Electron E2E 把 safeStorage 替换为不可用后创建供应商，确认表单保留草稿、`/api/providers` 为空、库中 `providers` 与 `provider_credentials` 都没有行（8eedf58，`apps/desktop/e2e/settings.e2e.test.ts`）；迁移条件增加了 `tests/integration/sidecar-recovery.test.ts` 的引用。

**(b) 范围蔓延**
- 已修复：状态文字只显示“已配置 Key / 未配置 Key”，不再带末四位（1768e4b）。ADR 0010 注明设置接口仍返回末四位，界面不显示。
- 已修复：容量只接受整数加可选的 K/M 后缀，`1.5M` 被拒绝；不能整除的值回显为较小单位（如 `1500K`）（291262e，`catalog-draft.ts` 与其测试）。

**(c) 实现有误**
- 已修复：区分“模型被清空”和“从未设置”。Session 新增必填字段 `modelCleared`（protocol `Session.modelCleared`，迁移 v6 `sessions.model_cleared`），只有被清空的 Session 在运行前返回 409 `model-required`；从未设置模型的 Session 照旧取默认模型（b1155b4）。v4 做了发布前修订：清空前把这些 Session 的 ID 记入临时表，v6 据此标记后删除该表。main 的 schema 停在 v3，v4 只存在于未发布的 model-service 分支，所以修订 v4 不影响已发布的库；对按旧版 v4 迁过的开发库，v6 把“模型为空且运行过”的 Session 也标为被清空。证据：`migrate-v6.test.ts`、`sidecar-recovery.test.ts`（v1 → 6，`modelCleared: true`）、`sidecar-provider-delete.test.ts`。
- 不改：编辑表单“显示名称”的位置。规格 4.3 指编辑中显示名称仍有可编辑字段，不规定分组位置；按规格 10.2“行为按本文、视觉按源稿”，保持 Pencil 源稿 04–06 的布局（显示名称在“供应商设置”分组）。Lead 于 2026-10-29 确认。
- 已修复：Switch 轨道加 `motion-reduce:transition-none`（2b00182；`switch.browser.test.tsx` 新增断言）。

**ADR 0010 的 implemented 条件**（逐条核对，ADR 中引用的 15 个证据文件都存在，测试都在本次全量中通过）
- 集成测试确认一次保存后 Provider 与密文同时存在：`sidecar-settings-credentials.test.ts`、`sqlite.test.ts`（事务回滚）。成立。
- 加密不可用时库不变：`apps/desktop/e2e/settings.e2e.test.ts` 的 Electron E2E 读回库表，另有 main 单元测试 `credentials.test.ts`。证据层级比条件要求的集成测试更高，成立。
- 获取模型的临时密钥不进入库、日志与 CredentialStore 缓存：`secrets-gate-provider-models.test.ts`、`sidecar-provider-models.test.ts`。成立。
- 迁移后旧 Provider、Credential、默认模型与 Session 引用均已清除：`migrate-v4.test.ts`、`sidecar-recovery.test.ts`。成立。
- Electron E2E 确认新建表单获取模型与一次保存可用：`fetch-models.e2e.test.ts`、`settings.e2e.test.ts`。成立。
