---
kind: evidence
description: "助手回复包含边界分支的协议、实际 App、静默 Electron、兼容与来源证据。"
lifecycle: active
---

# 05 助手回复分支验收

## 对象与范围

日期 2026-11-04；macOS，Node 24.15，Electron 41.0.3，Vitest 5.0.3，pi-ai 1.4.0。实施基线 `f9ff248f`；实施提交 `049bd03f`，再合入 `11da7851` 的异常底栏。所有验证使用真实 Sidecar／持久化与真实 App／Electron；只在模型响应和浏览器夹具网络边界控制输入，没有真实 Provider 凭据。

覆盖 AC-04、05、06、18、21。已先补[边界设计](../design.md)，[ADR 0023](../../../docs/adr/0023-assistant-reply-forks.md)接续旧 Fork 决定。旧用户之前边界与返回原始调用的协议不变。

## 红绿与可观察事实

- Sidecar 新助手包含边界最初 400，实施后 201。较早成功回复的下一次模型请求保留用户、思考、工具调用／结果及所选助手回复，排除后来内容；源条目与文件字节不变，新 Session Trace 初始消耗为 0。
- 压缩前、压缩后各建一个助手分支；下一请求分别使用当时原历史或当时有效摘要与保留区间，不借用后来摘要。
- 服务端拒绝阶段（即便 stop）、失败、运行／待审批、待结果确认；当前 plan 权限在早期分支中仍需审批，拒绝后文件未写入。Worktree 分支下一次 bash pwd 为原 Worktree 目录，移除后返回 409 worktree-removed。
- 实际 App 最初缺少分支按钮而失败，实施后历史成功回复可操作，新目标自动打开且输入为空，源草稿和记录保留。复制历史最初无底栏与来源时间，新增 provenance 后保留源时间、源用量及再次分支资格，但不增加新 Session 累计用量。旧 Fork 缺少可信来源时隐藏复制落盘时间。
- 实际 App 验证网络失败保留当前 Session 和草稿；明暗／zh-en 四组 390px 均验证按键可达、动作顺序、时间与用量不重叠、无整页横向溢出。
- 静默 Electron 通过键盘从较早回复分支，核对新目标空输入、源 Project／模型、原稿、原记录、当前文件字节及源结束时间。真实宿主剪贴板、无 hover、重载和无正文错误／停止用例同组通过；异常底栏没有真实 branch-reply 动作。

## 实际检查

| 命令 | 范围与结果 |
| --- | --- |
| `pnpm run test tests/integration/sidecar-rewind.test.ts tests/integration/sidecar-compaction.test.ts tests/integration/sidecar-worktrees.test.ts` | 3 文件、27 测试通过，退出 0；覆盖旧用户契约、回退、真实新请求、Worktree 与限制 |
| `pnpm run test packages/agent/src/agents/fork.test.ts packages/agent/src/checkpoints/rewind.test.ts packages/protocol/src/entries.test.ts packages/agent/src/session-entries/session-entries.test.ts apps/desktop/src/renderer/features/conversation/assistant-branch.browser.test.tsx packages/ui/src/guards/style-guard.test.ts` | 6 文件、105 测试通过，退出 0；之后新增的四组宽度场景也单独通过 |
| `pnpm run test apps/desktop/src/renderer/features/conversation/assistant-branch.browser.test.tsx apps/desktop/src/renderer/features/conversation/ended-footers.browser.test.tsx apps/desktop/src/renderer/features/conversation/assistant-footer.browser.test.tsx apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx apps/desktop/src/renderer/features/conversation/history.browser.test.tsx packages/ui/src/guards/style-guard.test.ts` | 合入 06 后 6 文件、98 测试通过，退出 0；包含 8 个助手分支场景和异常／阅读位置组合回归 |
| `pnpm run test apps/desktop/e2e/message-footers.e2e.test.ts` | 合入 06 后 1 文件、3 个静默 Electron 测试通过，退出 0 |
| `pnpm run typecheck` | 合入 06 并解决共享 UI 后退出 0 |

合并后受影响的 8 个 TypeScript 文件执行 `pnpm exec oxfmt` 与 `pnpm exec oxlint`，均退出 0；`pnpm run check:docs` 检查 305 个 Markdown 文件，0 问题，退出 0。已按 AGENTS → docs/README → ADR 索引／工作台／ADR 0023 独立读回，导航、后继与当前语义通过。没有运行全仓测试或 CI；以上数量有交叠，不作为独立用例总和。

## 失败定位与修正

新增 App 夹具改用既有 Lexical 输入方式（click/type），避免 contenteditable fill 等待；源实现不依赖测试输入方法。plan 用例最初错误假定自动拒绝，实际权限是审批：现改为断言审批前文件不变并明确拒绝后结束，继续验证不能绕过收紧。第一次并发组中的既有 confirmation 用例发生一次 ready 等待超时，stderr 为空；独立 3 场景与最终默认并行的 27 场景组均通过。未证明该次启动超时原因，未增加其超时或修改隔离策略。

旧 Electron 用例在模型完成前以默认 5 秒等底栏失败；现在先等待真实正文及恢复发送控件（既有模型边界上限 30 秒），底栏断言仍保持默认等待。独立带 pageerror 观察的分支场景无渲染错误，最终组合 3 测试通过。窄屏初次几何断言发生在侧栏收起动画中，截图中主内容不足 390px；改为等待主内容实际宽度达到 390 后验证，没有通过 CSS 裁剪或降低断言掩盖问题。

## 文档与合并读回

更新 GLOSSARY、ADR 0023／0006／ADR 索引、工作台、上下文、交接、Worktree、恢复、Agent 运行时及包说明。旧来源证据和 ADR 0016 对原决定的历史引用保留；活动 Fork 正文采用新契约。正式文档无任务材料反向依赖。入口 AGENTS → docs/README → 当前正文及 ADR 索引可达，后继链无环，原理由保留。

合入 06 的四处冲突分别保留两段设计、三个独立 Electron 场景、通用 RunFooter／来源用量钩子，以及完成／复制历史映射与异常结束位置过滤。没有合并到 main、推送或发布。未验证真实 Provider、物理鼠标、原生标题栏或发布产物。
