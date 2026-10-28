# 01: Payload 注册、Run 生命周期条目与秘密不外泄总闸

**What to build:** packages/session 的 PayloadRegistry（kind → 版本、schema、逐版迁移），写入校验、读取迁移与跳过损坏条目；agent 预先定义并注册 [规格](../spec.md#implementation-decisions) 表中全部 M2 entry kind 的 payload（按领域分文件），RunEntry 改为通用 `{ kind, runId?, payload }`，每个 Run 先提交 `run_start`；protocol 的 SessionEntry 按 kind 判别，renderer 在信任边界校验并跳过不合格条目（评审 A20）。同时建立后续票使用的扩展点：protocol 领域文件 `permissions.ts`、`runs.ts`（RunStatus 与 Session.activity 移入并预先声明全部取值）、`checkpoints.ts`；agent 领域 barrel `policy/`、`recovery/`、`checkpoints/`、`session-entries/`，并在两个包的 `index.ts` 一次性 re-export。建立秘密不外泄总闸测试，补 ADR 0003 中经协议的损坏隔离与版本过高拒绝。

**User stories:** 24, 25, 26（部分）, 15（总闸）

**Blocked by:** None - can start immediately

**Status:** ready-for-agent

**Write scope:** `packages/session/src/`（不含 `sqlite/schema.ts`）、`packages/session/README.md`、`packages/agent/src/index.ts`、`packages/agent/src/session-entries/`、`packages/agent/src/policy/index.ts`、`packages/agent/src/recovery/index.ts`、`packages/agent/src/checkpoints/index.ts`、`packages/agent/src/engine/`、`packages/protocol/src/`、`apps/server/src/application/sessions.ts`、`apps/server/src/runtime/layers.ts`、`apps/desktop/src/renderer/client/`、`apps/desktop/src/renderer/stores/chat-store.ts`、`apps/desktop/src/renderer/features/conversation/timeline.ts`、`tests/integration/`、`docs/adr/0003-settings-and-sessions-in-sqlite.md`、`apps/server/README.md`

- [ ] session 契约测试（SQLite 与内存）：未注册 kind 或不合 schema 的 payload 以 `invalid-payload` 拒绝，同批条目都不提交
- [ ] 读取时低版本 payload 经迁移函数升到当前版本；仍不合格的条目不返回、库中保留、记 warn；其余条目正常
- [ ] 集成测试：每个 Run 的条目序列以 `run_start { trigger: submit }` 开始；retry 的 trigger 为 retry；M1 既有条目断言按新序列更新
- [ ] renderer 对不合 schema 的条目跳过渲染（store 单元测试）
- [ ] `tests/integration/secrets-gate.test.ts`：唯一标记的 Credential（环境变量模式）与同形态宿主环境变量；faux 驱动带回显的模型错误、可重试错误、bash `env`、读取不存在文件；扫描全部 WebSocket 帧、HTTP 响应体、`coko.db` 与 `-wal`、`sidecar.jsonl`，断言没有明文（先删掉一处现有脱敏确认测试能失败，再撤销）
- [ ] 集成测试：损坏库启动 → fatal `storage-corrupt`，原文件被隔离；版本过高 → fatal `storage-version-too-new`，文件逐字节不变
- [ ] 后续票不需要再改 `packages/protocol/src/index.ts` 与 `packages/agent/src/index.ts`（re-export 已覆盖领域文件）
- [ ] ADR 0003 partial 说明与 session README 同步；`pnpm run check:docs` 通过

## Comments
