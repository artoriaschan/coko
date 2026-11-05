---
kind: evidence
description: "Tool Search 首轮 Standards/Spec 审查发现、独立修复、红绿回归与待复审状态。"
lifecycle: active
---

# Tool Search 两轴审查与修复

## 验证对象

- 首轮比较：`1b88e113...7ee1906f`，Standards 与 Spec 由两个新建只读子代理独立审查。
- 本轮修复基于 `7ee1906f`，独立分支 `codex/tool-search-review-fixes`；提交标识以 Git 记录为准。15 张实施票保持已关闭，规格保持 approved，修复后的两轴复审由集成流程继续执行。
- 环境和原验收范围见[联合验收](acceptance.md)。本轮未修改 UI、依赖、协议或故障开关，也未读取真实 Secret。

## Standards

首轮 **1 项 P1**：宿主目录渲染读取原始 MCP 描述，而值列表的脱敏没有覆盖该展示文本。生成的 user State Update 进入用户消息保真路径，使已登记值进入持久化和推送，违反 ADR 0007 的按值脱敏约束。

修复：渲染前建立脱敏后的目录展示副本，再进行首句截断与预算降级；工具搜索、调用和加载记录继续使用原始目录。先脱敏避免长值被截断后暴露前缀，不能只在最终文本中查找完整值。

- 真实 Sidecar 新回归先失败：短登记值原样出现在目录宿主消息中。仅在渲染后替换的尝试又在长值场景失败，目录留下值前缀；最终改为渲染前脱敏。
- 使用真实登记 Secret、MCP stdio 和持久化，不模拟 store。短/长值用例扫描完整值与唯一前缀，覆盖模型 requestLog、原始 WS 帧、HTTP、导出、运行中 SQLite/WAL、退出后库文件和日志。
- 原可执行复现的修复后 worktree 版本输出 `rawValueReachesPersistedUserPayload: false`，退出 0；原报告和脚本保存在 `/Users/chenzheng/Documents/Codex/2026-11-05/tool-search/`。
- **处理状态：修复和回归通过，等待新建 Standards 子代理复核。**

## Spec

首轮 **1 项 P2**：TS-26 要求自动压缩计算实际提供的工具定义；已有正 assistant usage 时，驱动剔除全部声明，却没有补上该 usage 之后新加载的定义。40k 窗口、32k 阈值的公开 Runtime 复现中，约 47k 的下次请求未触发压缩。

修复：可信 usage 包含其对应请求当时的定义。分别按当前传输规则计算 usage 锚点与当前请求的规范定义估算，加入两者差量；没有可信 usage 时仍计算完整定义。内存和条目复核使用同一规则，普通列表不重复累加未变化的定义，移除时扣除普通定义，原生模式继续保留 pi 仍在原位传输的定义。

- 公开 Runtime 回归先失败，修复后触发一次自动压缩；另覆盖正 usage 下未变化定义不重复累加、普通定义移除不误压缩。
- 真实 Sidecar 的 Messages/Responses × Provider 原生开/关四例在旧驱动上全部失败（没有 compaction），恢复修复后全部通过；压缩发生在耐久加载记录之后，摘要请求不带大 schema，后续真实 HTTP 请求带大 schema。
- 原生历史定义移除后的压缩场景同时覆盖零和正 usage，保留前轮已确认的折叠规则。
- 原诊断脚本已保留为 `reproduce-positive-usage.mjs`。`verify-positive-usage.mjs` 只增加修复后必需的摘要响应并断言成功，worktree 验证输出 `requests: 3, compactions: 1`，实际工具描述为 80000 字符，退出 0。
- **处理状态：修复和回归通过，等待新建 Spec 子代理复核。**

## 执行记录

| 命令或步骤 | 实际范围 | 结果 |
| --- | --- | --- |
| `rtk pnpm install --frozen-lockfile --offline` | 修复 worktree 独立依赖 | 退出 0 |
| 下列 C 命令 | 9 文件、81 例；真实 Secret gate、三协议、目录、加载、压缩与用量 | 81/81，退出 0 |
| `rtk pnpm run typecheck` | 项目引用图 | 退出 0 |
| 定向 `rtk pnpm exec oxlint` / `oxfmt` | 6 个变更 TS 源码、测试与 fixture 文件 | 退出 0 |
| `rtk pnpm run check:docs` / `rtk git diff --check` | 398 个 Markdown 及当前差异 | 0 问题，退出 0 |

C：

```sh
rtk pnpm run test tests/integration/secrets-gate-mcp.test.ts tests/integration/sidecar-incremental-tools.test.ts tests/integration/sidecar-completions-incremental-tools.test.ts tests/integration/sidecar-tool-search-catalog.test.ts tests/integration/sidecar-tool-search.test.ts packages/agent/src/engine/compaction.test.ts packages/agent/src/context/usage/tool-definitions.test.ts apps/server/src/application/context/state-updates.test.ts apps/server/src/application/context/usage.test.ts
```

## 文档影响与限制

- [MCP](../../../docs/subsystems/mcp.md#secret-的来源)补充目录展示在截断前脱敏；[上下文管理](../../../docs/subsystems/context.md#触发与熔断)补充可信 usage 后的工具定义差量。正式正文不依赖任务材料。
- 本轮代码、测试和记录仅本地，未推送、未发布。原验收中的真实 Provider/cache、原生指针、安装包和 CI 未验证范围保持；本轮未运行全仓测试。
- 新的复审结论应追加到本记录，不把“实现已修复”冒充复审已经通过。
