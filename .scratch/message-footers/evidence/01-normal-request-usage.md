---
kind: evidence
description: "正常请求计量的三协议、Sidecar 重启、App 输出及兼容消费者验证。"
lifecycle: active
---

# 正常请求计量验证

## 验证对象

- [规格](../spec.md)：AC-11、13、14、18（正常链路）、19、20；[实施票 01](../issues/01-truthful-request-usage.md)。
- 基线 dbd50e1d；本票改动独立于用户底栏 9395cef8，提交前合并后者。
- macOS arm64、Node 24.15.0、Electron 41.0.3、pi-ai 1.4.0、Vitest 5.0.3；App 为实际应用装配的 headless Chromium Browser Mode。
- 仅远程模型 HTTP 边界由端口 0 的本地 SSE 服务控制；真实适配、Sidecar、认证、提交、SQLite 与协议读取保持产品实现。App 测试仅替换服务边界和剪贴板等外部能力，不替换用量汇总函数。

## 执行记录

| 命令或步骤 | 范围与实际数量 | 结果 |
| --- | --- | --- |
| `rtk pnpm run test packages/agent/src/models/models.test.ts tests/integration/sidecar-request-usage.test.ts tests/integration/sidecar-model-price.test.ts apps/desktop/src/renderer/features/conversation/request-usage.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-cost.browser.test.tsx` | 5 文件、24 测试；三协议正常计量、实际依赖 reasoning/cacheWrite1h、四分桶、1h 缓存价格、完整零/未知/部分、持久化重启、既有模型价格、App 去重及标题归属 | exit 0 |
| `rtk pnpm run test apps/desktop/src/renderer/features/conversation/request-usage.browser.test.tsx packages/protocol/src/context-entries.test.ts packages/agent/src/session-entries/session-entries.test.ts` | 3 文件、31 测试；App 新增非法旧计数拒绝，协议与持久化 schema 回归 | exit 0 |
| `rtk pnpm run typecheck` | 全 workspace 的当前 TypeScript 项目引用；合并 9395cef8 后再验证 | exit 0 |
| 合并提交 8299f871 后 `rtk pnpm run test tests/integration/sidecar-request-usage.test.ts apps/desktop/src/renderer/features/conversation/request-usage.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-cost.browser.test.tsx` | 3 文件、7 测试，覆盖组合 App 及加强后的可选 TTL 字段断言 | exit 0 |
| `rtk pnpm run check:docs` | 合并后 300 个 Markdown 文件 | exit 0，0 问题 |
| 对本票 TypeScript 文件执行 `pnpm exec oxlint`（shell 由 rtk proxy 包裹）及 `rtk git diff --check` | 改动源码/测试，无忽略规则放宽 | exit 0 |
| `rtk pnpm run test tests/integration/sidecar-trace.test.ts packages/agent/src/goals/budget.test.ts packages/agent/src/engine/compaction.test.ts` | 3 文件、33 测试，29 通过；Trace 与 Goal 通过，压缩 4 失败 | exit 1；见下列基线核对 |
| 在没有本票改动的集成 checkout 9395cef8 运行 `rtk pnpm run test packages/agent/src/engine/compaction.test.ts` | 12 测试，8 通过、相同 4 失败 | exit 1；证明基线已存在 |

前代理在首次 Chat SSE 回归中观察缺少报告而失败，新增原始用量观察后通过。接手后 15 个模型测试通过，补充非法计数及 reasoning 子集校验后本文件为 16 测试。Anthropic 测试首次缺少 `event:` 头，真实解析器拒绝；修正协议夹具后正常。1h 缓存费用独立预期按 pi-ai 已有价格规则核对：70×2 + 20×8 + 25×0.5 + 2×1 + 3×(2×2) = 326.5 / 百万。

### 压缩基线缺口与 02 衔接

下列四个 `packages/agent/src/engine/compaction.test.ts` 用例在基线 9395cef8 和本票上同样失败；实际均未进入自动压缩，尚未修改断言、fixture 或压缩策略。完整失败信息由上述精确命令可复现，相关源码仍在原路径：

1. 自动压缩 → “越过阈值：提交 compaction { trigger: auto }，摘要请求没有工具且含节标题，下一次请求为合成摘要 + firstKeptSeq 及之后”：缺少 model_request/compaction。
2. 自动压缩 → “compaction 带摘要请求的 usage（计入 Goal 预算）；v1 条目读回为 v2”：未产生 compaction。
3. 压缩前的请求前检查（Goal 预算） → “压缩之后再检查一次（计入压缩的用量）：压缩后返回 stop 时不发出对话请求”：预期 paused，实际 completed。
4. 熔断与手动压缩 → “摘要连续失败 3 次后不再自动压缩，compaction_failed 带 consecutiveFailures；成功的手动压缩复位”：未发生自动压缩失败进度。

02 在扩展重试/压缩计量时须调查压力估算与 faux 夹具假设，按可观测证据修正，不降低断言。此缺口不代表新正常请求链路失败，也不能宣称全仓验证通过。

## 文档影响与读回

- [设计](../design.md)：先建立请求身份、四分桶、完整性、唯一累计来源和旧记录兼容；后经实际依赖源码确认使用 `onProviderStreamEvent`，无需复制 SSE 解析器。
- [追踪](../../../docs/subsystems/tracing.md)：请求附加字段、适配边界与兼容读取由此维护。
- [Goal 界面](../../../docs/subsystems/goal.md#界面)：当前独立用量行和 Session 费用使用请求优先及旧记录兼容；Goal 预算的原来源未在本票迁移。
- 检索 `RequestUsage`、`model_request`、`assistant 消息与 compaction`、`Token 合计` 的活动消费者，同步上述正文与源码注释；既有任务历史和已交付规格保留当时语义。没有新增正式文档目录、没有反向依赖任务材料。
- AGENTS → docs/README → tracing/goal 读回：路径、适用范围、当前行为、引用方向、语义同步、生命周期、当前入口、历史保留均通过；无需 ADR 变更。

## 结论与限制

01 交付正常三协议计量、可信已知分桶和完整性、请求去重、重启读取与旧扩展字段兼容；费用/预算/Trace 原有消费者仍有回归证据。失败与重试内层全部实际尝试由 02 扩展，底栏样式由 04/06 扩展。没有真实 Provider 凭据，未运行真实服务或 CI；本票未单独跑 Electron，宿主剪贴板及最终组合桌面验收由 03/07 覆盖。源码、协议或 UI 改动后判断对应证据是否失效。交付仅本地分支提交，未推送、未发布。
