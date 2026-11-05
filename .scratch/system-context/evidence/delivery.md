---
kind: evidence
description: "系统上下文分层的本地实施与文档收尾证据，区分 Sidecar/faux 验证和缺凭据未完成的真实模型与缓存门槛。"
lifecycle: active
---

# 系统上下文分层：本地交付证据

## 验证对象

- 规格与场景：[spec](../spec.md) 的用户故事 1–32；方案：[design](../design.md)，二者继续为 approved。
- 实施票：[01](../issues/01-todo-list-state-update.md)、[02](../issues/02-continue-delivery.md)、[03](../issues/03-post-compaction-redelivery.md)、[04](../issues/04-goal-progress-state-update.md)、[05](../issues/05-team-status-state-update.md)、[06](../issues/06-environment-section.md)、[07](../issues/07-date-state-update.md)、[08](../issues/08-fork-and-context-usage.md)、[09](../issues/09-base-prompt-v2-and-host-block-eval.md)、[10](../issues/10-cache-acceptance-and-adr-0024.md)。决定：[ADR 0024](../../../docs/adr/0024-session-state-as-state-updates.md)。
- 基线：`ec32dfc9`，在票 01 合入之前。主要实施集成：`148c99bc`；Skills 夹具后续修补合入 `5b3da280`。本票只改文档；各阶段旧测试结果不等同于最终分支全仓验证。
- 环境：2026-11-05，macOS；Sidecar/headless 使用 Electron 41.0.3 内置 Node，Vitest 在开发机 Node 24.15.0 执行，pnpm 为 12.15.0。模型与远程网络由 faux 或 loopback 服务替换，日期由既有测试 ClockPort 控制；业务装配、工具、存储和协议使用真实实现。

## 执行记录

以下前期行复用已关闭票中保存的结果，不冒充本票重新执行，也不把重叠用例累加为独立总数。代码或相关基础状态改变时，按每票的最终合并后复核与后续受影响集判断有效性。

| 命令或步骤 | 覆盖场景 | 实际范围与数量 | 结果 | 记录 |
| --- | --- | --- | --- | --- |
| 票 01 最终相关集（完整命令见票） | 配对/规划、Todo、秘密、授权、时间线、运行时送达顺序与环境 | 12 文件 288 例 | 通过 | [01 Comments](../issues/01-todo-list-state-update.md#comments) |
| 票 02 相关集与 Goal 回归（完整命令见票） | continue 有/无变化、两种消息末尾、不提升权限、不唤醒等待输入、真实用户仍唤醒 | 7 文件 62 例 | 通过 | [02 Comments](../issues/02-continue-delivery.md#comments) |
| 票 03 压缩相关集（完整命令见票） | auto/overflow 补发、手动压缩界限、摘要缩写与伪造文本、retry | 6 文件 51 例；合入其他领域后压缩 8 例复核 | 通过 | [03 Comments](../issues/03-post-compaction-redelivery.md#comments) |
| 票 04 Goal 相关集（完整命令见票） | 稳定定义、动态 revision/用量、编辑/终结、重启、子 Session 不继承 | 8 文件 238 例；合并团队后 3 文件 23 例 | 通过 | [04 Comments](../issues/04-goal-progress-state-update.md#comments) |
| 票 05 团队相关集（完整命令见票） | 静态身份、动态成员/任务、去重、30 行上限与秘密 | 8 文件 71 例；最终最小 2 文件 10 例 | 通过 | [05 Comments](../issues/05-team-status-state-update.md#comments) |
| 票 06 环境相关集（完整命令见票） | 仓库/Worktree/非 git、附加文件夹、模型、草稿和 system 用量 | 9 文件 55 例 | 通过 | [06 Comments](../issues/06-environment-section.md#comments) |
| `pnpm run test tests/integration/sidecar-date-state-updates.test.ts tests/integration/sidecar-state-update-continue.test.ts tests/integration/sidecar-base-prompt.test.ts tests/integration/sidecar-goal.test.ts tests/integration/sidecar-compaction.test.ts packages/agent/src/checkpoints/rewind.test.ts` | 本地午夜、子 Session、continue、提示选择、Goal、压缩与 Checkpoint 原文 | 6 文件 48 例 | 通过 | [07 Comments](../issues/07-date-state-update.md#comments)；相关 15 协议文件 99 例按分组逐项修复验证 |
| `pnpm run test packages/agent/src/agents/fork.test.ts packages/agent/src/checkpoints/rewind.test.ts apps/server/src/application/context/usage.test.ts tests/integration/sidecar-state-update-fork.test.ts tests/integration/sidecar-rewind.test.ts tests/integration/sidecar-compaction.test.ts tests/integration/sidecar-context.test.ts tests/integration/sidecar-trace.test.ts tests/integration/headless.test.ts --reporter=json --outputFile=/tmp/coko08-final-tests.json` | 两种分叉边界与压缩来源、清空、system/prompt 分类、ndjson 回放、stream-json schema | 实际选中 10 文件 90 例（含 secrets-gate-headless） | 通过 | [08 Comments](../issues/08-fork-and-context-usage.md#comments) |
| `pnpm run test tests/integration/sidecar-base-prompt.test.ts apps/server/src/config.test.ts apps/server/src/application/context/usage.test.ts tests/integration/sidecar-environment.test.ts` | v1 默认、v2 候选跨 Workspace 稳定、实际版本日志与用量 | 4 文件 30 例；合并 continue 后另 2 文件 5 例 | 通过 | [09 Comments](../issues/09-base-prompt-v2-and-host-block-eval.md#comments) |
| `COKO_EVAL_PROMPT_GATE=1 pnpm run eval` | v1/v2 faux 四例，以及真实门槛的缺凭据分支 | 2 文件 18 例通过、8 例跳过；v1/v2 各四个 faux case 通过 | faux 通过；真实未验证 | [09 Comments](../issues/09-base-prompt-v2-and-host-block-eval.md#comments)；报告注明 `real` 与 `promptGate` 为 `skipped: no-credentials` |
| Skills 受影响夹具的最终检查 | 日期条目顺序与真实路径 | 6 例 | 通过 | 集成 `5b3da280`；票 07 的后续补记 |
| 票 10 `pnpm install --frozen-lockfile` | 本工作区检查依赖 | lockfile 未改 | 通过，退出 0 | 本票实际执行 |
| 票 10 `pnpm run check:docs`、`git diff --check` 及入口读回 | ADR partial、引用方向和当前说明 | 361 个 Markdown、0 问题；diff 检查退出 0 | 通过；合入 `5b3da280` 后仍为 361 文件 0 问题、diff 检查退出 0 | 本票实际执行 |
| 全分支 Standards/Spec 评审 | 固定基线 `ec32dfc9` 到最终集成 | 尚未由本票执行 | 待父代理执行 | 不提前宣称通过 |

早期红灯、旧顺序与实路径基线失败、修复依据保存在各票 Comments。Skills 原 4 个失败已在后续修补中通过，不列为当前未解决项；这不代表全仓测试均通过。

## 文档影响

| 行为或正文变化 | 所属文档 | 受影响引用、摘要与入口 | 已完成动作 | 检查结果与缺口 |
| --- | --- | --- | --- | --- |
| 实施状态与真实门槛分开 | ADR 0024 | ADR 索引、票 10 | implementation 改为 partial，提炼授权、源码/测试证据和补验准则 | 真实 Provider 与缓存仍无证据 |
| 状态前置使旧“首块”说法失效 | context、subagents | 原 File Reference 展开与子代理上下文节 | 明确 Run 级 State Update 先于输入原文/prompt；原文相对引用块顺序保留 | 当前代码读回一致 |
| State Update 当前行为 | context、todo、goal、teams、agent/protocol README、headless | docs 总导航及各正文互链 | 原有实施票已同步；本票独立从入口核对 | 默认 v1 与 v2 候选区别明确 |

按[文档生命周期](../../../docs/DOCUMENT_LIFECYCLE.md#完成检查与回执)逐项读回：路径与引用、语义同步、归属与权威、引用方向、生命周期、当前入口、新会话读入、历史保留均通过。正式正文没有反向依赖本文件或其他具体任务材料；没有移动、归档或删除历史资料。

## 结论与限制

用户于 2026-11-05 明确选择缺少凭据时按规格记录未验证并继续实现。当前已完成实现与无需真实凭据的链路验证；默认基础提示仍为 v1，v2 仅候选，ADR 0024 为 partial，spec/design 保留 approved。关闭票 09/10 表示按无凭据分支完成本轮收尾，未勾选的真实门槛没有因此视作满足。

真实模型每例旧/候选各 3 次比较和真实缓存验收均未运行。补验基线是 `ec32dfc9`；以同一真实 Provider/model、含 Todo 写入和 Goal 推进的连续多 Run 会话，在缓存有效期内取各 Run 首条 `purpose: turn` 请求的 cacheRead，保留用量完整性。候选各位置不得低于基线，且至少一个 Todo/Goal 变化后位置从未命中变为命中；未知计数不是零。提示门槛通过后仍需显式审阅激活，不自动替换默认。

真实协议对连续 user 消息的接受情况、真实模型行为/缓存、Electron 窗口/真实指针、打包产物与 CI 未由这些 Sidecar/faux 证据覆盖。本地测试通过不代表已推送、合并到 main 或发布；最终本地集成、评审和清理状态由父代理交付时报告。后续改动须重新判断相应证据的有效性。
