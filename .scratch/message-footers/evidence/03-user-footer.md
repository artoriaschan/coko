---
kind: evidence
description: "用户消息底栏的实际 App、Sidecar、静默 Electron 与文档验证回执。"
lifecycle: active
---

# 用户消息底栏验收

## 验证对象

- 规格：[消息底栏](../spec.md) AC-03、AC-08（用户时间）、AC-09（用户显隐）、AC-10、AC-21（用户底栏）；实施票：[03](../issues/03-user-message-footer.md)。
- 对象：基线 `dbd50e1d6ddbd09cd779c851d2424aa1e077d270` 上的 `codex/message-footers-03` 本票改动；本记录与源码同一提交保存。
- 环境：macOS、Node.js 24.15.0、Vitest 5.0.3、Electron 41.0.3。Browser Mode 使用 headless Chromium；Electron harness 默认 `COKO_E2E_BACKGROUND=1`、独立 userData/COKO_HOME 和真实 Sidecar，未占用前台。
- 模型边界：Sidecar/Electron 使用 faux；App Browser 使用既有应用夹具和真实 App 装配，剪贴板失败仅在宿主剪贴板边界替换。文件、记录、回退与上下文处理仍使用真实实现。

## 执行记录

2026-11-04 暂停前已观察到新增提交时间场景先因缺少 `23:07` 失败，再随实现通过。恢复后重新执行下面的检查，覆盖保留的最终源码与新加的 Electron 剪贴板、无 hover 断言；暂停中被终止的运行不计通过。

| 命令或步骤 | 覆盖场景 | 实际范围与数量 | 结果 |
| --- | --- | --- | --- |
| `pnpm run test apps/desktop/src/renderer/features/conversation/messages.browser.test.tsx apps/desktop/src/renderer/features/conversation/history.browser.test.tsx packages/ui/src/guards/style-guard.test.ts` | 真实 App 的发送时间来源、复制原文及失败反馈、键盘顺序、回退取消、只读/运行/审批限制、zh/en 与明暗主题、390 CSS px、共享样式 | 3 文件，61 测试 | exit 0；全部通过，10.08s |
| `pnpm run test tests/integration/sidecar-rewind.test.ts` | 三种回退模式、文件事实、append-only、限制与旧用户锚点分叉协议 | 1 文件，8 测试 | exit 0；全部通过，28.05s |
| `pnpm run test apps/desktop/e2e/rewind.e2e.test.ts` | 真实 Electron 的显隐、CDP 无 hover、宿主剪贴板读回并恢复、时间、键盘、取消、文件预览与默认 both、命令草稿合并、旧分叉 API | 1 文件，4 测试；globalSetup 构建本次测试产物 | exit 0；全部通过，44.84s |
| `pnpm run test apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx` | 消息布局变更后的阅读位置、流式结算与选区 | 1 文件，19 测试 | exit 0；全部通过，11.47s |
| `pnpm run typecheck` | 所有 workspace 的受影响接口 | TypeScript build | exit 0 |
| `pnpm exec oxfmt --check apps/desktop/e2e/rewind.e2e.test.ts apps/desktop/src/renderer/features/conversation/history.browser.test.tsx apps/desktop/src/renderer/features/conversation/messages.browser.test.tsx apps/desktop/src/renderer/features/conversation/timeline-view.tsx apps/desktop/src/renderer/features/conversation/message-time.tsx` | 本票 TypeScript/TSX 格式 | 5 文件 | exit 0 |
| `pnpm run check:docs` | Markdown、链接、状态及引用方向 | 298 个 Markdown 文件，0 问题 | exit 0 |

时间从 Session Entry 的 `createdAt` 获取，App 用例故意提供不同的模型消息 `timestamp`，确认不误用模型时间或查看时刻。`MessageTime` 不为缺失或无效时间制造日期。复制成功有短暂勾号与本地化提示；失败清除成功状态并走应用 Toast。时间不在显隐动作组中；无 hover 断言通过 Electron CDP 切换触摸输入能力后实际读取样式。

## 文档影响与读回

| 行为或正文变化 | 所属文档 | 已完成动作 |
| --- | --- | --- |
| 用户底栏与复制/时间/回退规则 | [桌面工作台](../../../docs/subsystems/workbench.md) | 原地更新当前行为；保持既有正文、思考与消息身份说明 |
| 用户气泡移除分叉，旧协议仍兼容 | [命令](../../../docs/subsystems/commands.md)、[交接](../../../docs/subsystems/handoff.md)、[ADR 0006](../../../docs/adr/0006-file-checkpoints-and-rewind.md) | 修正入口与实现证据；未改变旧用户锚点分叉决定，助手包含边界及后继 ADR 留给 05 |

搜索 `用户.*分叉`、`用户消息.*分叉`、`从这里分叉`、`从此分叉` 覆盖 docs、.agents、当前任务与 conversation-detail 历史材料。当前说明已同步；旧已交付规格及已关闭票保留当时语义，由新规格明确接管本范围。AGENTS → docs/README → workbench、commands、handoff、ADR 0006 读回：路径与引用、语义同步、归属、引用方向、生命周期、当前入口、新会话可读与历史保留均通过；未新增正式目录或反向依赖任务材料。

## 结论与限制

本票只移除用户分叉按钮，不删除旧协议；助手分支将在 05 接入。复制历史的条目会被重新落盘，后续助手 Fork 必须保留可信原发送时间或明确未知，不能把复制时间冒充原发送时间；这不是本票新建虚构历史时间的依据。

静默 Electron 验证经 CDP 完成，没有验证真实物理鼠标、原生标题栏或红绿灯；本票不改变这些能力。未运行真实 Provider、全仓测试、发布构建或 CI。证据只支持上述本地范围，不表示整份规格或生产发布已完成。分支本地提交后由独立 merger 集成，未推送。
