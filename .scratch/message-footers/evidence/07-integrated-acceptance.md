---
kind: evidence
description: "消息底栏最终组合状态的真实协议至 Electron 验证、AC-01—21 覆盖与交付限制。"
lifecycle: active
---

# 消息底栏联合验收

## 对象、版本和边界

2026-11-04，实施基线为集成提交 `009804450e93f44eb538bea76ed30edd5f356973`，已经包含 01—06；本票只增加端到端测试、当前文档验证入口与本回执，没有修改产品代码。目标为本记录所属提交。环境为 macOS arm64、Node 24.15.0、pnpm 12.15.0、Electron 41.0.3、Vitest 5.0.3、pi-ai 1.4.0。

以[规格](../spec.md)、[设计](../design.md)及[实施票 07](../issues/07-integrated-acceptance.md)为验收对象。前置票的实现和证据均已读取，确认能力已实际交付；复用未被后续改动推翻的证据，同时在当前组合上补齐真实协议至桌面展示的连接。

[联合 Electron 用例][protocol-e2e]使用已配置的 OpenAI Chat Completions Provider，经真实 preload 凭据保存、真实 Sidecar、适配器、工具、SQLite、WebSocket、App 和 Electron 渲染。仅远程 HTTP/SSE 由绑定 loopback 端口 0 的本地服务替代，不使用 Faux，不替换计量、聚合、运行时或存储。每个测试使用 mkdtemp 目录，应用和服务等待关闭；不读取真实用户凭据或会话。

## 独立预期与实际结果

1. 首轮实际请求失败后报告输入 11、输出 3；重试后工具请求报告 20／5；最终回复报告输入总量 30（含缓存读取 10）、输出 8（其中 reasoning 2）。父 Run 四分桶为未缓存输入 **51**、缓存读取 **10**、缓存写入 **0**、输出 **16**，合计 **77**；底栏与精确详情一致，并标“不完整”。原始 reasoning 不重复计入输出或总数。该轮只有一个底栏。
2. 同一工具循环执行真实 read 和前台 explore 子代理。子 Session 的实际 HTTP 请求报告 100／50，即 **150** tokens；父底栏仍为 **77**。独立标题请求报告 1000／20，即 **1020** tokens，父底栏仍为 **77**，父 Session 标题栏累计为 **1097**。可见费用入口与请求事实保留，没有把标题或子 Session 混入父 Run。
3. 第二轮为 **12** tokens。对第一轮历史回答创建助手分支，目标输入为空，复制底栏仍为来源 **77**，结束时间不变；新 Session 没有新增累计费用。分支下一次实际 HTTP 请求包含首轮用户指令、read 结果、子代理结果及所选回答，排除第二轮用户和助手内容。新请求为 **6** tokens；目标累计只为 **6**，源累计仍为 **1109**。源记录、未发送草稿及文件字节保持。
4. 关闭并重新启动同一测试应用目录，复制底栏 **77** 与新底栏 **6**、来源结束时间和目标完整条目读回一致。没有重新请求模型，历史消费不重记。
5. 第二场景在收到真实 WebSocket `subscribed` 帧后才释放可控流：先报告 31／4，再报告 output-only 7，然后发送可见正文。正文显示后停止，底栏保留 **38** 个已报告 tokens、正文复制入口及可信结束时间，明确“不完整”，没有分支按钮；生成中没有结束底栏。
6. 准备足够可摘要的真实消息后手动压缩。第一次摘要报告 30／7 后失败，没有成功 compaction 条目，异常底栏仍显示 **37**，没有复制／分支或费用。随后正常手动压缩报告 40／9，底栏显示完整 **49**，同时存在 model_request 与成功 compaction 载体也不重复为 98。重启后各轮可见计数为 **38、2、2、37、49**，结束时间与全部持久化条目保持。

## 本票精确检查

| 命令 | 当前范围与结果 |
| --- | --- |
| `rtk pnpm run test apps/desktop/e2e/message-footers-protocol.e2e.test.ts` | 1 文件、2 个静默真实 Electron 测试通过，退出 0，21.95s；globalSetup 为本次源码构建测试产物 |
| `rtk pnpm run test tests/integration/sidecar-request-usage.test.ts apps/desktop/src/renderer/features/conversation/assistant-footer.browser.test.tsx apps/desktop/src/renderer/features/conversation/assistant-branch.browser.test.tsx apps/desktop/src/renderer/features/conversation/ended-footers.browser.test.tsx apps/desktop/src/renderer/features/conversation/attempt-usage.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-cost.browser.test.tsx` | 6 文件、42 测试通过，退出 0，24.57s；三协议、重试／退避／SIGKILL／预算、成功／异常／复制历史 App 与实际汇总消费者 |
| `rtk pnpm run typecheck` | 当前测试及所有 workspace 的 TypeScript build 通过，退出 0 |
| `rtk pnpm exec oxlint apps/desktop/e2e/message-footers-protocol.e2e.test.ts` | 通过，退出 0 |
| `rtk pnpm exec oxfmt --check apps/desktop/e2e/message-footers-protocol.e2e.test.ts` | 1 文件通过，退出 0 |
| `rtk pnpm run check:docs` | 306 个 Markdown 文件，0 问题，退出 0；当前票的最终评审项仍未勾选 |
| `rtk git diff --check` | 本票变更通过，退出 0 |

新增测试先经过实际运行诊断，不用实际输出覆盖独立期望。首轮错误地在空工作台等待 ConnectionStatus；空工作台没有该元素，改为等待实际首屏标题。部分流初次将唯一增量发在新 Session 的订阅之前，导致 UI 正文等待超时；现通过观察真实 WebSocket 订阅确认建立模型服务屏障，不加 sleep、重试或超时。first-send 在 API 返回及列表刷新后订阅，服务只补发已提交条目，不回放此前未持久化进度；本票没有声称修复这一既有早期进度限制。

## AC-01—AC-21 覆盖清单

以下均针对当前产品实现；“沿用”表示所属代码未被本票改变，且已在后续合并验证过相应连接。单票证据的数量存在交叠，不相加为全仓测试总数。

| 场景 | 当前证据与可观察结果 |
| --- | --- |
| AC-01 | 本票协议→Electron 首轮三请求只有一个最终底栏；当前 [assistant-footer App][footer-app] 验证阶段／多文本块、等待真实 run_end、旧费用行缺席。 |
| AC-02 | 沿用 [04 证据](04-assistant-footer.md)与 [05 合并验证](05-assistant-branch.md)中真实 Electron 原始 Markdown 剪贴板读回并恢复；当前 footer App 保留多块正文复制、失败反馈断言。 |
| AC-03 | 沿用 [03 证据](03-user-footer.md)的用户原文复制、发送时间、回退及用户分叉缺席；05 合并后历史 App 与 [助手分支 App][branch-app]继续验证旧复制消息时间来源。 |
| AC-04 | 本票历史助手分支后的真实 HTTP 请求包含首轮 read／agent 结果和回答，排除第二轮；[05 证据](05-assistant-branch.md)的压缩前后实际请求与递归分支保持有效。 |
| AC-05 | 本票源原稿、原记录、文件字节保持；目标空输入，来源 77 不进目标累计，后续只计 6。Worktree 实际 cwd 的下一次 bash pwd 沿用 [05 Sidecar 验证](05-assistant-branch.md)。 |
| AC-06 | 沿用 [05 证据](05-assistant-branch.md)中服务端阶段／失败／忙碌／审批／结果确认／已移除 Worktree 拒绝；当前 branch App 验证错误不清空原稿或切换对话。 |
| AC-07 | 本票真实部分流停止与失败压缩分别显示 38／37，资格正确；当前 [ended-footers App][ended-app]覆盖无正文、阶段后失败、暂停、中断及仅进度结束。 |
| AC-08 | 本票原始结束时间在分支及重启后不变；当前 footer／branch／ended App 与沿用 03 验证用户提交时间、本地 HH:mm、完整键盘提示、缺失与恢复时间不伪造。 |
| AC-09 | 沿用 04／05／06 合并后真实 Electron 的历史显隐与 CDP 无 hover；当前 footer App 验证 hover／focus、时间常显和 portal 打开期间操作可达。 |
| AC-10 | 沿用 05 当前合并状态下的 [Sidecar 回退][rewind]及 03 Electron 验证：三模式、默认 both、取消不变、文件清单、草稿合并及 append-only。 |
| AC-11 | 当前 [Sidecar 请求计量][request-usage]真实 Chat／Responses／Anthropic 三协议验证 reasoning／cacheWrite1h 及重启；本票实际 Chat reasoning 2 到 Electron 明细不丢失。 |
| AC-12 | 本票完整贯通工具循环、失败重试、成功／失败压缩、部分流中止；独立标题 1020、子 Session 150 不进入父 Run 77。 |
| AC-13 | 本票原输入 30 含缓存 10，被拆为 20 未缓存＋10 缓存；最终四分桶为 51／10／0／16＝77，reasoning 2 仅是输出子集。当前 footer App 验证缓存比例 27.3% 及多个模型。 |
| AC-14 | 当前 request-usage Sidecar 与 App、ended App 验证完整服务全零显示真实 0，缺失仍为未取得；不是依赖初始化零。 |
| AC-15 | 本票取消 38、失败压缩 37 保留已知统计且不完整；当前 request／attempt／ended App 验证完全未知入口、破折号和可见状态。 |
| AC-16 | 当前 footer App 验证单／多模型、未知模型、可选 reasoning、仅已报告小计和省略伪精确比例；本票实际协议验证服务商／模型与 reasoning 进入同一详情。 |
| AC-17 | 当前 footer App 验证再点、外点、Escape、焦点、历史 portal 与视口避让；沿用 04 窄屏截图和合并后 Electron 关闭／焦点结果。 |
| AC-18 | 本票真实应用重启、完整条目相等、来源 77 与新消费 6 归属稳定；当前 request／attempt App 保留事件重放去重，Sidecar 保留退避 SIGKILL 后读回。 |
| AC-19 | 当前 request-usage App 与协议 schema 保留旧 reasoning／cacheWrite1h 扩展、非法计数拒绝与历史完整性限制；branch App 不把旧复制落盘时间冒充原发送时间。 |
| AC-20 | 本票新底栏／卡无费用，父 Session 累计 1097／1109 与目标 6 保留；[02 证据](02-request-attempts.md)的 90 个运行时／预算／Trace 测试和当前请求 Sidecar Goal 30→39 准入证据有效。 |
| AC-21 | 当前 footer／branch／ended App 覆盖四组明暗 × zh/en 390px、长模型名、键盘与边缘；沿用 04／06 图像读回以及 05 合并后的 19 个阅读位置／选区回归、静默 Electron 无 hover。 |

[protocol-e2e]: ../../../apps/desktop/e2e/message-footers-protocol.e2e.test.ts
[footer-app]: ../../../apps/desktop/src/renderer/features/conversation/assistant-footer.browser.test.tsx
[branch-app]: ../../../apps/desktop/src/renderer/features/conversation/assistant-branch.browser.test.tsx
[ended-app]: ../../../apps/desktop/src/renderer/features/conversation/ended-footers.browser.test.tsx
[request-usage]: ../../../tests/integration/sidecar-request-usage.test.ts
[rewind]: ../../../tests/integration/sidecar-rewind.test.ts

## 文档与来源读回

当前行为继续归属 [workbench](../../../docs/subsystems/workbench.md)、[tracing](../../../docs/subsystems/tracing.md)、[Goal](../../../docs/subsystems/goal.md)及 [context](../../../docs/subsystems/context.md)。本票仅在 workbench 验证段加入真实协议 Electron 测试入口；没有新产品约定、目录、术语或 ADR。

从 AGENTS → docs/README → 当前正文、GLOSSARY、ADR 索引读回：Fork 双边界与当前权限、实际 Worktree、来源消费归属一致；[ADR 0006](../../../docs/adr/0006-file-checkpoints-and-rewind.md)保留历史理由并标 superseded/deprecated，[ADR 0023](../../../docs/adr/0023-assistant-reply-forks.md)明确接续并保留 Checkpoint／append-only 原约束。旧历史规格和证据保持原意，01 记录的四个压缩基线失败已由 02 的真实阈值夹具修正与通过结果接续。正式文档不依赖任务材料，当前入口仍有效。

05 曾出现一次既有 confirmation 用例 Sidecar ready 超时，stderr 为空，后续隔离守卫和最终默认并行 27 测试均通过；原因未证实，本票不把它表述为已修复的产品故障，也没有改变隔离策略或增加超时。

## 限制和待主代理完成项

以上为本地功能与组合验收，不是全仓测试、真实外部 Provider、CI、推送或发布证明。真实外部服务未提供凭据；三个协议的服务端响应均为可控本地输入。交互使用静默 CDP；物理鼠标、原生标题栏、红绿灯和签名发布产物未验证。宿主剪贴板证据沿用已通过并恢复剪贴板的真实 Electron 用例，不用 Browser Mode 替身冒充。

本票代码、回执和检查将提交到本地 `codex/message-footers-07`，合并由新的 merger 执行。**Closed 保持 false**，最终 Standards／Spec 双轴评审、必要修复、规格／设计 delivered 状态及票关闭由主代理完成。本票所属应用／Sidecar／本地 HTTP 服务均由 harness 等待退出；实施 worktree 的托管归档由主代理负责，应用对其他 worktree 的活动任务保护不能绕过。

## 后续评审修订

上述检查保留为原提交证据。最终双轴评审发现中断完整性及备用 report 读取缺口后，汇总和请求提交顺序已进一步修订；受影响的 AC-02、08、14—20、复制历史完整性及真实崩溃重启的刷新结果见[评审修复回执](final-review-fixes.md)。07 的最终关闭仍由主代理在后续评审完成后执行。
