# 07: 观测与评测：trace / audit / export、回放、Trace tab、tests/evals

**What to build:** 见 [规格](../spec.md)"观测与评测"：agent `observability/`（`deriveTrace`、`deriveAudit`）与 `@coko/agent/testing` 的 `loadExport`；server `TraceService`、`routes/trace.ts`（trace、audit、export）、layers.ts 的 trace 块；renderer 右栏 Trace tab、`trace-store`、导出；`tests/evals/`（用例、运行器、报告、真实模式开关）、根 `eval` 脚本与 vitest 项目。

**User stories:** 15, 16

**Blocked by:** 03

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/observability/`、`packages/agent/src/testing/`（只增加 `loadExport` 导出）、`packages/protocol/src/trace.ts`、`apps/server/src/{application/trace,http/routes/trace}.ts`、`runtime/layers.ts` 的 trace 块、`packages/i18n/src/dictionaries/domains/trace.ts`、renderer `features/right-panel/{trace-tab.tsx,tabs.ts（只改 trace 一行）}`、`stores/trace-store.ts`（新）、就近测试、`tests/integration/{sidecar-trace,secrets-gate-trace}.test.ts`（新）、`tests/evals/`（新）、根 `package.json`（`eval` 脚本）、根 `vitest.config.ts`（evals 项目）、根 `.gitignore`（`tests/evals/reports/`）、`apps/desktop/e2e/trace.e2e.test.ts`（新）、`docs/subsystems/tracing.md`（新）、`docs/tech-stack/testing.md`（evals 一段）、`docs/tech-stack/observability.md`（逐请求字段一句）

**跨票接口：** 读取 03 的 `model_request` v1；`RunTrace` / `AuditEvent` 的形状以本票的 `protocol/src/trace.ts` 为准（03 建立的占位可扩展）；`approval_decision.by: 'headless'` 在 audit 中显示为来源（08 写入）。

- [ ] agent 表驱动：`deriveTrace`（多轮、重试、压缩与摘要请求、工具并行、审批等待、Hook 结果、被中断的 Run 没有 run_end）、`deriveAudit`（每类事件、时间顺序）
- [ ] 集成 `sidecar-trace`：一次含审批与 Hook 的 Run 后 `GET …/trace` 的请求数、工具耗时 ≥ 审批等待、合计与 Goal 用量一致；`…/audit` 有 approval 与 hook 事件；`…/export` 为 ndjson（header + 条目）、`?children=1` 含子 Session 条目
- [ ] 回放往返：export → `loadExport` → `modelContext` 与 Sidecar 读回的条目派生结果相等
- [ ] 秘密总闸 `secrets-gate-trace`：export 输出、trace / audit 响应中没有登记 Secret 的明文
- [ ] E2E：Trace tab 列出 Run、展开显示请求与工具行、导出得到 `.ndjson` 文件（下载事件）；新 Run 结束后自动更新；明暗主题与键盘操作
- [ ] evals：`pnpm run eval` 运行 3 个用例（faux）全部 pass 并写报告（含 tokens、cost、durationMs）；把其中一个用例的期望改错后该例 fail 且报告给出原因（变异，已还原）；没有 `COKO_EVAL_PROVIDER_CONFIG` 时报告写 `skipped: no-credentials`；evals 项目在 `pnpm run test` 中运行且耗时 < 60 秒
- [ ] tracing.md 建立并可达（含 evals 的用例格式与真实模式）；testing.md 一段；docs/README 一行；`check:docs` 通过；真实模式记为未验证（人工清单）

## Comments
