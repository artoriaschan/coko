# 07: 观测与评测：trace / audit / export、回放、Trace tab、tests/evals

**What to build:** 见 [规格](../spec.md)"观测与评测"：agent `observability/`（`deriveTrace`、`deriveAudit`）与 `@coko/agent/testing` 的 `loadExport`；server `TraceService`、`routes/trace.ts`（trace、audit、export）、layers.ts 的 trace 块；renderer 右栏 Trace tab、`trace-store`、导出；`tests/evals/`（用例、运行器、报告、真实模式开关）、根 `eval` 脚本与 vitest 项目。

**User stories:** 15, 16

**Blocked by:** 03

**Status:** ready-for-review

**Write scope:** `packages/agent/src/observability/`、`packages/agent/src/testing/`（只增加 `loadExport` 导出）、`packages/protocol/src/trace.ts`、`apps/server/src/{application/trace,http/routes/trace}.ts`、`runtime/layers.ts` 的 trace 块、`packages/i18n/src/dictionaries/domains/trace.ts`、renderer `features/right-panel/{trace-tab.tsx,tabs.ts（只改 trace 一行）}`、`stores/trace-store.ts`（新）、就近测试、`tests/integration/{sidecar-trace,secrets-gate-trace}.test.ts`（新）、`tests/evals/`（新）、根 `package.json`（`eval` 脚本）、根 `vitest.config.ts`（evals 项目）、根 `.gitignore`（`tests/evals/reports/`）、`apps/desktop/e2e/trace.e2e.test.ts`（新）、`docs/subsystems/tracing.md`（新）、`docs/tech-stack/testing.md`（evals 一段）、`docs/tech-stack/observability.md`（逐请求字段一句）

**跨票接口：** 读取 03 的 `model_request` v1；`RunTrace` / `AuditEvent` 的形状以本票的 `protocol/src/trace.ts` 为准（03 建立的占位可扩展）；`approval_decision.by: 'headless'` 在 audit 中显示为来源（08 写入）。

- [x] agent 表驱动：`deriveTrace`（多轮、重试、压缩与摘要请求、工具并行、审批等待、Hook 结果、被中断的 Run 没有 run_end）、`deriveAudit`（每类事件、时间顺序）
- [x] 集成 `sidecar-trace`：一次含审批与 Hook 的 Run 后 `GET …/trace` 的请求数、工具耗时 ≥ 审批等待、合计与 Goal 用量一致；`…/audit` 有 approval 与 hook 事件；`…/export` 为 ndjson（header + 条目）、`?children=1` 含子 Session 条目
- [x] 回放往返：export → `loadExport` → `modelContext` 与 Sidecar 读回的条目派生结果相等
- [x] 秘密总闸 `secrets-gate-trace`：export 输出、trace / audit 响应中没有登记 Secret 的明文
- [x] E2E：Trace tab 列出 Run、展开显示请求与工具行、导出得到 `.ndjson` 文件（下载事件）；新 Run 结束后自动更新；明暗主题与键盘操作
- [x] evals：`pnpm run eval` 运行 3 个用例（faux）全部 pass 并写报告（含 tokens、cost、durationMs）；把其中一个用例的期望改错后该例 fail 且报告给出原因（变异，已还原）；没有 `COKO_EVAL_PROVIDER_CONFIG` 时报告写 `skipped: no-credentials`；evals 项目在 `pnpm run test` 中运行且耗时 < 60 秒
- [x] tracing.md 建立并可达（含 evals 的用例格式与真实模式）；testing.md 一段；docs/README 一行；`check:docs` 通过；真实模式记为未验证（人工清单）

## Comments

### 实施回执（票 07，2026-11-01）

分支 `m6/07-observability-evals`，worktree `/Users/chenzheng/Desktop/Work/person/coko-worktrees/07-observability-evals`；已合入 main 4279a81（票 04 收尾）。

**覆盖的验收**
- agent `observability/{trace,audit,export}.ts`：`deriveTrace` / `traceTotals` / `deriveAudit` / `formatExport` / `loadExport`（`@coko/agent/testing` 只增加 `loadExport` 一行导出）；表驱动 `trace.test.ts` 18 例。
- protocol `trace.ts`：`RunTrace`（补 `tools`、`hooks`、`usage`、`tokens`、`cost`、`errorCode`，改为 strict）、`ToolTrace`、`HookTrace`、`TraceTotals`（加 `runs`、`toolCalls`）、`AuditEvent`（按 kind 判别的联合）。`model_request` v1 的形状未改。
- server `TraceService` 与 `routes/trace.ts`：trace、audit、export（ndjson 附件，`?children=1` 深度优先递归子 Session）；三者返回前 `redactSecretsDeep`；layers.ts 只改 trace 块（`now: () => clock.now()`）。
- 集成 `sidecar-trace` 2 例（含回放往返）、`secrets-gate-trace` 1 例；renderer `trace-store`、`trace-tab`、tabs.ts 的 trace 一行改为可用、i18n trace 分域；Browser Mode `trace-tab.browser.test.tsx` 4 例；E2E `trace.e2e.test.ts` 1 例；`tests/evals`（3 个用例、运行器、判定、报告、vitest 项目 `evals`、根 `eval` 脚本、`.gitignore`）。
- 文档：新建 `docs/subsystems/tracing.md`；`testing.md` 加 evals 一段；`observability.md` 加逐请求字段一句；`docs/README.md` 当前行为加 tracing 一行。

**设计要点（供评审）**
- 工具耗时从调用所在 assistant 消息起算（含审批等待与 Hook），因此"工具耗时 ≥ 审批等待"成立；另给 `execMs`（tool_exec → 结果）。并行一批的结果一起提交，各自耗时约等于整批。
- `hook_run` 没有 toolCallId：只有恰一个调用未结束时归属该调用，否则记在 Run 的 `hooks`（tracing.md 写明）。
- 追踪合计只含本 Session；Goal 用量另计子 Session，集成用例比较的是 Goal Round 的追踪与 Goal 用量（tokens、toolCalls、durationMs 相等，cost 接近）。
- 审计只取结构化字段，不带用户输入、模型输出与交接摘要。

**实际运行的命令与结果**
- `pnpm vitest run packages/agent/src/observability`：18 passed。
- `pnpm vitest run tests/integration/sidecar-trace.test.ts`：2 passed；`secrets-gate-trace.test.ts`：1 passed；`sidecar-m6-seams.test.ts`：10 passed。
- `pnpm vitest run --project desktop-renderer` 中的 right-panel 目录与 sections、dock：46 + 4 passed；i18n 与 ui 项目：59 passed（含样式守卫）。
- `pnpm vitest run --project desktop-e2e apps/desktop/e2e/trace.e2e.test.ts`：1 passed（负载 86–120）。
- `pnpm run eval`：13 passed、3 skipped（真实模式），约 10 秒；报告含 tokens、cost、durationMs，`real: { skipped: 'no-credentials' }`。
- `pnpm run typecheck`（tsc -b）：0；`pnpm run check:docs`：210 个文件 0 问题；`pnpm vitest run --project scripts`：22 passed；`oxfmt --check .` 通过。
- 全量 `pnpm run test`（锁内后台，两次）：
  - 第 1 次（13:23–13:31，负载 8–58）：test=1；339/340 文件、2764 passed、4 skipped、2 failed，都在 `dock.browser.test.tsx`：它写死了右栏注册表（`trace: false`）与可见 tab 列表，属于本票启用 Trace tab 的真实回归，已修（f9d07f6）。evals 在全量中 7.3 秒。
  - 第 2 次（13:49–14:03，排在票 05 的全量之后，负载 43–206）：test=1；338/340 文件、2764 passed、4 skipped、2 failed：`model-price.browser.test.tsx` 与 `thinking-levels.browser.test.tsx` 的 `locator.click` 超时（剩余预算 832 ms 与 1 ms，即已知的负载超时签名），本分支未改这两个文件及其被测组件。在负载 206 时单独重跑：2 个文件 7 passed。evals 在全量中 13.1 秒（< 60 秒）。dock 在第 2 次全量中通过。

**负向确认（先红或变异）**
- agent：模块缺失时先红；`sidecar-trace` 在占位实现上先红（runs 为空、export 501）。
- 秘密总闸：去掉导出的 `redactSecretsDeep` 后 `secrets-gate-trace` 失败（导出含用户输入的明文），已还原。
- evals：把 `fix-function` 的 `check.ok` 期望改为 `"not ok\n"` 后该例 fail，报告原因 `files/check.ok: expected "not ok\n", got "ok\n"`，已还原；把 `read-only-refuses-write` 改为 full-access 后该例 fail（`unchanged/notes.md: content changed`），证明该例依赖 read-only，已还原。`judge.test.ts` 在 judge 缺失时先红。

**未验证**
- evals 真实模式：未验证（需真实凭据：`COKO_EVAL_PROVIDER_CONFIG` 与 `COKO_CREDENTIAL_<ID>`），列入人工验证清单。
- 非 darwin 平台未验证。

**秘密总闸与读取根**
- 新的输出通道：trace、audit、export 的 HTTP 响应，由 `secrets-gate-trace` 扫描（含 faux requestLog）。用户在提示中输入的登记 Secret 在库中按原样保存（ADR 0007），导出时同样替换。
- 不新增读取根与注入点：导出只读本 Session 与其子 Session 的已提交条目，不读文件系统，因此不需要符号链接越界用例。

**越出 Write scope 的改动（请 Lead 裁决）**
- `tests/integration/sidecar-m6-seams.test.ts`（03）：去掉 export 的 501 断言；trace 的空合计改为新形状（加 `runs`、`toolCalls`）；audit 由 `[]` 改为含 `permission_mode: default` 一项（打开会话时设置模式）。
- `apps/desktop/src/renderer/features/settings/sections.browser.test.tsx` 与 `features/conversation/dock/dock.browser.test.tsx`：注册表断言中 trace 改为可用、可见 tab 加 `trace`。

**需要 Lead 合并时处理**
- `docs/README.md` 当前行为：已加 tracing 一行（只此一行）。
- `apps/server/README.md` 的"M6 接缝"仍写 `TraceService` 与 `routes/trace.ts` 为空结果或 501，按规格由 14 汇总。要点：TraceService 已实现 trace / audit / export（ndjson、`?children=1`、返回前再脱敏）。
- `packages/agent/README.md`（14）：`observability/` 导出 `deriveTrace`、`traceTotals`、`deriveAudit`、`formatExport`、`sessionExportHeader`、`loadExport`、`SESSION_EXPORT_FORMAT` / `VERSION` 及类型；`@coko/agent/testing` 导出 `loadExport`。
- `docs/tech-stack/agent-runtime.md` 能力表的 Observability / Evals 行（规格写"不改"）：交付位置为 tracing.md，供 capability-coverage 更新。
