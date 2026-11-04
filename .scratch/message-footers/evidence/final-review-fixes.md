---
kind: evidence
description: "消息底栏双轴评审四项发现的修复、崩溃重启与备用计量回归及验证范围。"
lifecycle: active
---

# 消息底栏评审修复

## 验证对象

2026-11-04，修复基线为 `9938fd3336502e0d97273d14cc049fae508ad94d`，原双轴比较为 `dbd50e1d...9938fd33`。本记录对应修复分支所属提交，环境为 macOS arm64、Node 24.15.0、pnpm 12.15.0、Electron 41.0.3、Vitest 5.0.3、pi-ai 1.4.0。范围为[规格](../spec.md) AC-02、08、14—20、复制历史与同一消费来源，及[联合验收](07-integrated-acceptance.md)的后续修订。07 最终关闭仍由主代理执行。

## 原始评审与修复

| 评审轴 | 原发现 | 修复与可观察结果 |
| --- | --- | --- |
| Standards，明确违规 P2 | 底栏业务组件写死 K／M，违反 UI 字典规则 | 紧凑后缀移入类型化 zh/en `usage.compact`，两种语言保留原 K／M 显示 |
| Standards，判断项 Duplicated Code | 普通及复制历史各自提取 Markdown | 共用 `assistantMarkdown`，仍仅合并原始正文文本块、以空行分隔，不含思考／工具／底栏 |
| Spec，P1 | 只看已结束请求报告，无法发现后续在途请求崩溃后缺失；已知小计被标完整 | 汇总还检查可信 Run 结束事实；Interrupted／未提交结束保持小计、不完整，各桶为下界或未知。复制历史使用已有成功来源证明的只读投影，不形成新消费、Run 或显示时间 |
| Spec，P2 | 备用消息无条件认为四桶已知，忽略已有 report | 备用路径遵守 report.known／complete，无计数报告不显示假零，只有无元数据旧记录保留原兼容口径；未知输出不展示 reasoning，旧 SDK 无报告的可选零不冒充实测零，可信正值和明确报告的零保留 |

同时将普通请求事实移到对应助手消息之前提交，关闭“新消息已提交但 canonical 请求尚未提交”的写入窗口，避免该 Run 的旧 canonical 载体抑制新消息中的已知消费。摘要请求原有顺序不变，提交失败仍停止 Run、不执行工具；费用数值与预算／Trace 来源保留。

## 缺陷回归与独立预期

- 实际 App 初始失败为中断后显示 `120 tokens` 而没有 Incomplete；修复后保留 120 小计并标记不完整。进一步的详情回归初始将输入显示为精确 100；修复后为 `≥ 100`，先前缓存零为 `—`，仅进度结束同样处理且不补时间。
- 消息备用报告 known 为空但兼容值为 120 时，修复前仍显示 120，修复后为 Usage unavailable；known 仅 input 时，只显示独立输入 7，不把兼容 output 99／cacheRead 30 混入小计。明确完整零仍为 0 tokens。旧无报告 reasoning 0 的回归修复前显示 0，修复后省略；明确报告的 reasoning 0 和旧可靠正值 7 保留。
- 真实 Chat Sidecar 的顺序回归修复前 request seq 5 在 assistant seq 4 之后；修复后请求先落盘，三协议用例均检查这一顺序，原计数、价格和重启保持。
- 新真实协议 Electron 用例先完整取得首个工具请求 11／3＝14，再通过 HTTP 请求计数屏障确认第二次请求已真正发出并保持开放，随后 SIGKILL 测试 Sidecar。重新启动应用后仍只有首个 canonical 请求，底栏显示 14 和 Incomplete，输入 `≥ 11`、缓存 `—`，没有伪造结束时间或分支，没有虚构后续重试。
- 原两项协议 Electron 继续验证工具／重试 77、标题 1020 与子 Session 150 排除、分支新增消费 6、部分流中止 38、失败压缩 37、成功压缩 49、复制历史及应用重启。复制的完整来源报告仍完整，来源计量不进入目标累计。

仅模型 HTTP/SSE 使用独立 loopback 端口 0 的受控服务；其余适配器、运行时、SQLite、WebSocket、App 和 Electron 保留真实实现。App Browser Mode 在既定网络夹具边界输入持久化形状，汇总器未 mock。没有添加内部实现镜像测试。

## 执行记录

| 精确命令 | 范围与结果 |
| --- | --- |
| `rtk pnpm run test apps/desktop/src/renderer/features/conversation/request-usage.browser.test.tsx apps/desktop/src/renderer/features/conversation/assistant-branch.browser.test.tsx apps/desktop/src/renderer/features/conversation/assistant-footer.browser.test.tsx apps/desktop/src/renderer/features/conversation/ended-footers.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-cost.browser.test.tsx` | 5 文件、34 测试通过，退出 0，10.27s；普通／复制 Markdown、完整／未知／部分／零、历史费用、详情关闭及四组主题语言 |
| `rtk pnpm run test packages/agent/src/engine/runtime.test.ts packages/agent/src/engine/compaction.test.ts packages/agent/src/goals/budget.test.ts packages/agent/src/observability/trace.test.ts tests/integration/sidecar-request-usage.test.ts` | 原运行 5 文件、84 测试：79 通过、5 个旧提交顺序断言失败，退出 1；其中请求 Sidecar／预算／Trace 3 文件 49 测试通过。按新先计量后副本的明确行为更新另外 2 文件的独立顺序预期，未更改产品源码或放宽提交失败／工具屏障条件，以下仅重跑失败组 |
| `rtk pnpm run test packages/agent/src/engine/runtime.test.ts packages/agent/src/engine/compaction.test.ts` | 2 文件、35 测试通过，退出 0，0.92s；与上行仍有效 49 例共同覆盖当前运行时／三协议／预算／Trace，不将重跑数量相加为全仓总数 |
| `rtk pnpm run test packages/ui/src/guards/style-guard.test.ts apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx apps/desktop/src/renderer/features/conversation/attempt-usage.browser.test.tsx` | 3 文件、61 测试通过，退出 0，12.38s；样式守卫、阅读位置／选区、请求尝试显示 |
| `rtk pnpm run test apps/desktop/e2e/message-footers-protocol.e2e.test.ts` | 1 文件、3 个静默真实协议 Electron 测试通过，退出 0，38.48s；globalSetup 构建本次源码，含实际第二请求 SIGKILL／恢复 |
| `rtk pnpm run typecheck` | 当前所有 workspace TypeScript build 通过，退出 0 |
| `rtk pnpm run check:docs` | 307 个 Markdown 文件，0 问题，退出 0 |
| `rtk git diff --check` | 当前修复差异通过，退出 0 |
| `rtk proxy node scripts/check-docs.ts` | 最终同一文档脚本直接执行通过，307 文件、0 问题，退出 0 |
| `rtk pnpm exec oxfmt apps/desktop/e2e/message-footers-protocol.e2e.test.ts apps/desktop/src/renderer/features/conversation/assistant-branch.browser.test.tsx apps/desktop/src/renderer/features/conversation/assistant-footer.tsx apps/desktop/src/renderer/features/conversation/fork-history.ts apps/desktop/src/renderer/features/conversation/message-text.ts apps/desktop/src/renderer/features/conversation/request-usage.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-cost.tsx packages/agent/src/engine/runtime.ts packages/agent/src/engine/runtime.test.ts packages/agent/src/engine/compaction.test.ts packages/i18n/src/dictionaries/domains/usage.ts tests/integration/sidecar-request-usage.test.ts` | 12 文件格式化通过，退出 0；只改变格式的阶段不重跑仍有效产品测试 |
| `rtk pnpm exec oxlint apps/desktop/e2e/message-footers-protocol.e2e.test.ts apps/desktop/src/renderer/features/conversation/assistant-branch.browser.test.tsx apps/desktop/src/renderer/features/conversation/assistant-footer.tsx apps/desktop/src/renderer/features/conversation/fork-history.ts apps/desktop/src/renderer/features/conversation/message-text.ts apps/desktop/src/renderer/features/conversation/request-usage.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-cost.tsx packages/agent/src/engine/runtime.ts packages/agent/src/engine/runtime.test.ts packages/agent/src/engine/compaction.test.ts packages/i18n/src/dictionaries/domains/usage.ts tests/integration/sidecar-request-usage.test.ts` | 12 文件通过，退出 0 |

上述格式／Lint 文件清单为：`apps/desktop/e2e/message-footers-protocol.e2e.test.ts`、`apps/desktop/src/renderer/features/conversation/{assistant-branch.browser.test.tsx,assistant-footer.tsx,fork-history.ts,message-text.ts,request-usage.browser.test.tsx,session-cost.tsx}`、`packages/agent/src/engine/{runtime.ts,runtime.test.ts,compaction.test.ts}`、`packages/i18n/src/dictionaries/domains/usage.ts`、`tests/integration/sidecar-request-usage.test.ts`。

完成测试后，一次 `rtk pnpm run check:docs` 在包管理器 bootstrap 阶段退出 1：固定 pnpm 12.15.0 的原生二进制无法从公司 Artifactory 下载，未进入文档检查。直接执行同一 `node scripts/check-docs.ts` 已通过；随后仅该命令设置 `npm_config_registry=https://registry.npmjs.org` 运行 `pnpm --version`，固定版本 bootstrap 成功并返回 12.15.0。没有修改全局配置、凭据或 hook，也没有因此重复运行已有效的产品测试。

## 文档影响与读回

| 正文变化 | 所属文档及消费者 | 完成动作 |
| --- | --- | --- |
| 中断、备用 report、可选 reasoning 的可信边界 | 工作台正文、Goal 用量说明、功能设计 | 同步当前行为，并修正 Goal 遗留的异常旧行描述；不改写历史计量 |
| 请求先于助手副本持久化 | tracing 正文、功能设计、运行时顺序用例 | 明确提交屏障，失败尝试退避前持久化和摘要路径不变 |
| 原联合验收的后继 | 07 证据与本回执 | 追加更正链接，保留原提交、检查与当时结论 |

正式文档不反向依赖任务材料，既有 AGENTS → docs/README → workbench／Goal／tracing 入口及 ADR 0006 → 0023 后继关系保持。无新术语、文档目录或 ADR。从上述入口独立读回后，路径与引用、语义同步、归属与权威、引用方向、生命周期、当前入口、新会话范围判断及历史保留均通过；没有新增未确认约定或反向依赖。最终 `check:docs` 检查 307 文件、0 问题，退出 0。

## 限制与交付状态

仅本地提交；未推送、未发布，未运行全仓测试或 CI。真实外部 Provider 没有凭据，实际协议以可控本地服务验证。交互为静默 CDP，真实物理指针、原生标题栏和签名发布产物未验证；原宿主剪贴板证据仍沿用此前真实 Electron 用例。测试应用、Sidecar 和 HTTP 服务均由 harness 等待退出；托管 worktree 归档仍由主代理通过应用处理，不绕过活动任务保护。原 05 的一次既有启动超时不确定性保持在其历史证据，本修复不声称解决它。主代理继续进行差异评审、最终关闭 07 和规格／设计状态晋升。
