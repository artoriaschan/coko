---
kind: evidence
description: "每次真实请求尝试、重试退避、部分报告与失败压缩的持久化、可见结果和计量消费者验证。"
lifecycle: active
---

# 请求尝试计量验证

## 验证对象

- [规格](../spec.md)：AC-12、AC-15（计量）、AC-18；[实施票 02](../issues/02-retry-compaction-usage.md)。
- 基线 `6acd696bb29befbeafc7ed9fe60bd532cbb316cd`；本分支为 `codex/message-footers-02`。本记录覆盖该基线上的本票改动。
- macOS arm64、Node 24.15.0、Electron 41.0.3、pi-ai 1.4.0、Vitest 5.0.3；App 为实际装配入口的无头 Chromium Browser Mode。
- Sidecar 使用真实适配、认证、存储与协议，仅远程模型 HTTP/SSE 由端口 0 的临时服务控制。时序以实际增量、重试进度与退出信号同步，不靠固定 sleep。App 只在服务边界提供持久化形状的记录，汇总与渲染保持产品实现。

## 执行记录

| 命令或步骤 | 实际范围与数量 | 结果 |
| --- | --- | --- |
| `rtk pnpm run test packages/agent/src/engine/runtime.test.ts packages/agent/src/engine/compaction.test.ts packages/agent/src/goals/budget.test.ts packages/agent/src/observability/trace.test.ts packages/agent/src/models/models.test.ts` | 5 文件、90 测试：实际尝试、重试资格、无请求准入、压缩、预算/子 Session/旧记录、Trace 去重及三个适配器 | exit 0 |
| `rtk pnpm run test tests/integration/sidecar-request-usage.test.ts tests/integration/sidecar-compaction.test.ts tests/integration/sidecar-goal-budget.test.ts tests/integration/sidecar-trace.test.ts tests/integration/sidecar-handoff.test.ts apps/desktop/src/renderer/features/conversation/attempt-usage.browser.test.tsx` | 6 文件、32 测试：真实协议计量、失败/重试/取消/重启、正常与失败压缩、预算准入、追踪、交接及 App 回放；此时 App 文件为 1 用例 | exit 0 |
| `rtk pnpm run test apps/desktop/src/renderer/features/conversation/attempt-usage.browser.test.tsx apps/desktop/src/renderer/features/conversation/request-usage.browser.test.tsx apps/desktop/src/renderer/features/conversation/timeline.test.ts` | 3 文件、18 测试：随后补齐无助手正文的失败压缩入口，实际 App 文件为 2 用例，保留正常/旧记录/零/未知断言 | exit 0 |
| `rtk pnpm run typecheck` | 所有 workspace，含最终 timeline 增量 | exit 0 |
| 改动的 TS/TSX 用 `pnpm exec oxfmt`、`pnpm exec oxlint`（外层 shell 由 rtk proxy 包裹） | 15 文件（包含新增 Browser 文件），未放宽规则 | exit 0 |
| `rtk git diff --check` | 当前改动 | exit 0 |
| `rtk pnpm run check:docs` | 301 个 Markdown 文件，含最终票与本证据 | exit 0，0 问题 |

### 红绿回归与独立预期

- 真实 Chat SSE 的失败尝试先报告 input 11 / output 3（14 tokens），随后可重试错误；下一次请求报告 20 / 5（25 tokens）。原实现仅持久化后者而失败；现在两条不同身份均保留，Trace 为 39 tokens、费用 0.000047，重启仍一致。相同数值不参与身份去重。
- 同一请求先报告 input 31 / output 4，再发 output-only 7，随后取消。原观察器会删除先前 input，断言得到 7 而非 38；现在保留 38 已知 tokens，并为 incomplete。没有把缺失字段初始化零当作报告。
- 退避前等待失败尝试提交；收到真实 retry 进度后 SIGKILL Sidecar，重启。修复前读回请求为空；修复后仍有一条 14-token 请求，Trace 为 1 request / 14 tokens。退避期间普通取消同样只有一次真实请求，未产生计划中的第二条。
- 失败手动压缩报告 input 30 / output 7 后错误，没有成功 compaction 条目；仍保存 purpose compaction 的 37 tokens，重启后不变。实际 App 在没有助手正文时，修复前找不到 37 tokens，补齐请求事实触发用量入口后可见且标为 Incomplete。
- Goal 由真实工具创建（创建前 Run 不计入其预算），后续 Goal Round 的失败 14 + 成功重试 25 = 39 tokens。30-token 上限耗尽，实际 HTTP 调用停在 4 次（创建 Run 两次、Goal Round 两次），不会启动下一请求；费用 0.000047。
- App 用同一累计契约呈现 39 tokens / Incomplete，重放相同请求事件及重开 Session 不翻倍，复制历史的 null runId 消耗仍排除。
- Goal 与 Trace 公共派生回归先观察旧代码失败：Goal 错算为 61 而非 50（重复载体混入），Trace 将重复 requestId 计为 3 而非 2。新实现按请求身份去重，旧 Run 与子 Session 保持原归属。

### 既有压缩失败的原因与修复

01 证据中在集成基线复现的 4 个压缩失败来自过时夹具：40k 模型窗口的当前自动阈值是 80% = 32k，测试仍按 23k 准备 60k + 40k 字符（约 25k tokens），所以没有触发自动压缩。将初始消息改为 100k 字符，第二条仍为 40k，使压力约 35k 并跨过 32k；同步阈值注释及精确断言。产品阈值、熔断、压缩准入与输出限制均未改变，没有放宽断言。12 个压缩运行时用例全部通过，四个原失败场景继续验证上下文、顺序、预算复查与熔断结果。

## 文档影响与读回

- [设计](../design.md) 追加每次尝试、退避前持久化、失败压缩与消费者单一来源；01 的原设计与兼容边界保留。
- [追踪](../../../docs/subsystems/tracing.md) 维护实际尝试、durationMs/retries 语义、去重、部分报告与重启事实。
- [Goal 预算](../../../docs/subsystems/goal.md#预算) 维护每 Run 请求事实优先、旧记录回退、子 Session 归属与压缩后复查。上下文环没有改为累计请求消耗。
- 检索活动正文与任务材料中的“含重试之间的等待”“重试后的最终一次”“失败的尝试不单独记录”“计入 compaction.usage”等旧规则，活动当前文档已同步；历史 ADR 的原实施记录保留当时语义，没有改变“不另存计数器”的决定，无需新 ADR。
- 从 AGENTS → docs/README → tracing/goal 读回：路径与语义、归属与权威、引用方向、生命周期、当前入口、历史保留均通过。没有新增正式目录、没有正式文档反向依赖任务材料。

## 结论与限制

02 交付全部真实重试尝试、失败/取消/失败压缩已知计数、退避中断持久化、预算与 Trace 去重，以及实际 App 可见结果。只执行所列相关集，未运行全仓测试。真实 Provider 凭据未提供，未调用真实服务；本票未单独执行 Electron、物理鼠标或原生标题栏验证，最终组合与桌面证据由 07 承接。无 CI、推送或发布；本次为本地分支提交。正常底栏由 04、异常布局由 06 接管时，需要保留上述统计断言。
