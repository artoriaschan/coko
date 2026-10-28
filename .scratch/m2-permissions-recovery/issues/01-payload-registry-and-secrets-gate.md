# 01: Payload 注册、Run 生命周期条目与秘密不外泄总闸

**What to build:** packages/session 的 PayloadRegistry（kind → 版本、schema、逐版迁移），写入校验、读取迁移与跳过损坏条目；agent 预先定义并注册 [规格](../spec.md#implementation-decisions) 表中全部 M2 entry kind 的 payload（按领域分文件），RunEntry 改为通用 `{ kind, runId?, payload }`，每个 Run 先提交 `run_start`；protocol 的 SessionEntry 按 kind 判别，renderer 在信任边界校验并跳过不合格条目（评审 A20）。同时建立后续票使用的扩展点：protocol 领域文件 `permissions.ts`、`runs.ts`（RunStatus 与 Session.activity 移入并预先声明全部取值）、`checkpoints.ts`；agent 领域 barrel `policy/`、`recovery/`、`checkpoints/`、`session-entries/`，并在两个包的 `index.ts` 一次性 re-export。建立秘密不外泄总闸测试，补 ADR 0003 中经协议的损坏隔离与版本过高拒绝。

**User stories:** 24, 25, 26（部分）, 15（总闸）

**Blocked by:** None - can start immediately

**Status:** ready-for-agent

**Write scope:** `packages/session/src/`（不含 `sqlite/schema.ts`）、`packages/session/README.md`、`packages/agent/src/index.ts`、`packages/agent/src/session-entries/`、`packages/agent/src/policy/index.ts`、`packages/agent/src/recovery/index.ts`、`packages/agent/src/checkpoints/index.ts`、`packages/agent/src/engine/`、`packages/protocol/src/`、`apps/server/src/application/sessions.ts`、`apps/server/src/runtime/layers.ts`、`apps/desktop/src/renderer/client/`、`apps/desktop/src/renderer/stores/chat-store.ts`、`apps/desktop/src/renderer/features/conversation/timeline.ts`、`tests/integration/`、`docs/adr/0003-settings-and-sessions-in-sqlite.md`、`apps/server/README.md`

- [x] session 契约测试（SQLite 与内存）：未注册 kind 或不合 schema 的 payload 以 `invalid-payload` 拒绝，同批条目都不提交
- [x] 读取时低版本 payload 经迁移函数升到当前版本；仍不合格的条目不返回、库中保留、记 warn；其余条目正常
- [x] 集成测试：每个 Run 的条目序列以 `run_start { trigger: submit }` 开始；retry 的 trigger 为 retry；M1 既有条目断言按新序列更新
- [x] renderer 对不合 schema 的条目跳过渲染（store 单元测试）
- [x] `tests/integration/secrets-gate.test.ts`：唯一标记的 Credential（环境变量模式）与同形态宿主环境变量；faux 驱动带回显的模型错误、可重试错误、bash `env`、读取不存在文件；扫描全部 WebSocket 帧、HTTP 响应体、`coko.db` 与 `-wal`、`sidecar.jsonl`，断言没有明文（先删掉一处现有脱敏确认测试能失败，再撤销）
- [x] 集成测试：损坏库启动 → fatal `storage-corrupt`，原文件被隔离；版本过高 → fatal `storage-version-too-new`，文件逐字节不变
- [x] 后续票不需要再改 `packages/protocol/src/index.ts` 与 `packages/agent/src/index.ts`（re-export 已覆盖领域文件）
- [x] ADR 0003 partial 说明与 session README 同步；`pnpm run check:docs` 通过

## Comments

### 2026-10-29 实施者（分支 m2/01-payload-registry-and-secrets-gate）

**覆盖的验收（全部 8 项）**
- session 契约（SQLite 与内存共用 `repository-contract.ts`）：未注册 kind、未登记版本（0、超过当前）、不合 schema 以 `invalid-payload`（非 fatal，details 不含 payload）拒绝，同批不提交；低版本读回为迁移后的当前版本，迁移后不合格的条目不返回、经 `onInvalidEntry` 报告、seq 不复用。SQLite 另测：用旧注册表写、新注册表重开，原始行仍是 v1 原样。
- 每个 Run 先提交 `run_start { trigger }`（submit / retry），在第一次模型请求前；提交失败时不发请求、Run 以 commit_failed 结束。M1 的 runtime 测试与 `sidecar-session.test.ts` 的条目序列已更新。
- renderer：`chat-store` 在信任边界按 `SessionEntry` 校验，不合格的条目跳过，lastSeq 越过它（重连时不再补发）；`timeline.ts` 去掉 payload 的 `as` 断言（A20）。
- `tests/integration/secrets-gate.test.ts`：Credential 用环境变量模式（`DEEPSEEK_API_KEY`，经回显 Authorization 的模型服务替身真实发出），同形态宿主变量 `MY_SERVICE_API_KEY`；faux 驱动带回显的不可重试错误、可重试错误（retry 进度）、retry、bash `env`、读不存在的文件；扫描全部 WS 原始帧、HTTP 响应体、运行中与停止后的 `coko.db` / `-wal` / `-shm` 与 `sidecar.jsonl`。先断言各通道确实被驱动。负向确认：去掉 `sessions.ts` 中 run_end.error 的脱敏后失败（`ws frame 6 contains credential`），撤销后通过。
- `tests/integration/sidecar-storage.test.ts`：损坏库 → fatal `storage-corrupt`、退出码 1、原文件改名隔离且字节不变；版本过高 → fatal `storage-version-too-new`、库文件逐字节不变；另有库中不合格条目读取时被跳过、记 warn `session entry skipped`（日志不含 payload）、库中保留。
- 扩展点：protocol `runs.ts`（RunStatus 五值、SessionActivity 六值、run/message/tool_exec/confirmation payload）、`permissions.ts`、`checkpoints.ts`、`entries.ts`（由三个领域文件的 schema 表组成判别联合，不随 kind 修改）；agent `session-entries/`（`runs.ts`、`permissions.ts`、`tools.ts`、`checkpoints.ts`，规格表 14 个 kind 全部预先定义）、`policy/`、`recovery/`、`checkpoints/` 的 barrel；两个包的 `index.ts` 已一次性 re-export。
- 文档：ADR 0003 partial 说明、`packages/session/README.md`、`apps/server/README.md` 已同步；`pnpm run check:docs` 通过。

**设计要点（供后续票）**
- 线上信封 `SessionEntryRecord`（payload unknown，HTTP 详情与 WS entry 消息使用）与按 kind 判别的 `SessionEntry` 分开：一个坏条目不让整个详情响应校验失败。新增或修改某 kind 只改 protocol 与 agent 的领域文件。
- agent 不依赖 `@coko/session`：`SESSION_ENTRY_PAYLOADS` 与 session 的 `PayloadDefinition` 结构相同，server 在 `layers.ts` 用 `createPayloadRegistry` 装配。
- `RunEntry` 为 `{ kind, runId?, payload }`，server `toNewEntry` 不再按 kind 映射，只对 assistant.errorMessage 与 run_end.error.message 脱敏。
- Session DTO 加 `activity`（必填），本票只产出 idle / running。
- 规则 payload 采用 `{ behavior, tool, content? }`；approval / checkpoint 形状按规格表，所属票可在各自领域文件中调整。

**越出 Write scope 的改动（已事先告知 Lead）**
- `apps/server/src/application/hub.ts`：`publishEntry` 参数类型改为 `SessionEntryRecord`（只改类型）。
- `apps/desktop/src/renderer/testing/fixture-chat.ts`：Session fixture 加 `activity`，条目类型改为 `SessionEntryRecord`。
- `apps/desktop/src/renderer/stores/chat-store.test.ts`：新增"跳过不合 schema 条目"用例（验收要求的 store 单元测试），fixture 加 `activity`。
- 范围内但改变行为：`packages/session/src/sqlite/open.ts` 在获取租约前读库头，版本过高时立即拒绝。原顺序取租约会写库，无法满足"逐字节不变"。

**实际运行的命令与结果**（worktree 内，`unset ELECTRON_RUN_AS_NODE`）
- `pnpm exec vitest run packages/session packages/agent packages/protocol apps/server apps/desktop/src/renderer/stores tests/integration`：30 个文件，235 个用例中 234 通过、1 失败。失败的是 `sidecar-auth.test.ts` 的 cookie 篡改用例；单独运行 3 次全过，之后 `tests/integration` 整体 2 次 47/47 通过。判断为既有不稳定：用例只改 cookie 的最后一个 base64url 字符，可能只落在填充位上，HMAC 不变。本票未修改该测试或认证代码，未修复。
- `pnpm exec vitest run --project desktop-renderer`（Browser Mode）：2 个文件 26 个通过。
- `pnpm run typecheck`、`pnpm run lint`（0 错误）、`pnpm run format:check`、`pnpm run check:docs`（79 个文件 0 问题）：全部通过。
- 负向确认：`open.ts` 回退到 main 后，"逐字节不变"用例失败；秘密总闸见上。

**未验证**：Electron E2E 与产物 smoke（本票没有新增可见 UI，未运行）；真实模型（无密钥）；CI。
- 2026-10-29 lead：评审 diff（越界仅 hub.ts 类型、renderer fixture 与 chat-store 测试，均已事先说明，接受）后合入 main（ba7e4da）。main 上复核：install、typecheck、lint、format:check 退出 0；全量 test 59 文件 454 通过、1 跳过（真实模型），含 desktop E2E 与产物 smoke；check:docs 0 问题。cookie 篡改用例的不稳定由 lead 单独修复。worktree 已清理。

Closed: true
