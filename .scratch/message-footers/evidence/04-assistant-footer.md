---
kind: evidence
description: "助手底栏、精确用量详情、历史显隐与静默 Electron 的交付证据。"
lifecycle: active
---

# 04 助手底栏交付证据

## 对象与范围

2026-11-04，macOS arm64，Node 24、pnpm 12.15.0、Vitest 5.0.3、Chromium Browser Mode 和 Electron 41。实施提交 `b08b9f6`，基线为 `6acd696b`；最终验证包含集成分支的 02 提交 `ae4d8aef`。分支 `codex/message-footers-04`，最终合并与回执提交见本票 Comments。

覆盖 AC-01、02、08（助手）、09（助手）、13、14、16、17、20、21。正常成功且有最终助手正文的 Run 才显示本票底栏；05 分支动作、06 异常或无最终正文的底栏、07 联合交付仍分别负责后续范围。

## 结果与外部事实

- 先观察实际 App 回归失败：Run 结束后没有 `assistant-footer`。实现后每 Run 只有最后一条助手回复的最后文本块附有底栏；阶段回复与结束前均不出现结束操作，原消息身份保持。复制得到 `**Final**\n\nSecond _block_.`，不是渲染后的纯文本或工具／思考。
- 代表性独立期望为未缓存输入 700、缓存读取 300、缓存写入 100、输出 200，合计 1,300；reasoning 50 只展示输出子集，缓存命中率 27.3%。多模型不完整记录展示已报告小计 1,309，缺失输入只显示已报告下界，不产生伪精确比例。
- 额外用例先捕获正数但未报告的回退值被展示为下界，再在同一 `sumUsage` 汇总结果增加 reported 四分桶。只有 output 被报告时显示小计 200，其余分桶为未知；全部未报告时保留入口并显示未知，不能显示伪造的 0 tokens。原兼容数值继续供费用消费者使用。
- 正常结束时间取 Run 结束记录，消息开始时间和当前查看时间均不参与。时间常显；历史操作按 hover/focus 显隐，最新操作常显，无 hover 时所有操作可用。详情 portal 打开期间父消息不再 hover 也不隐藏操作；再次点击、外点、Escape 均关闭并按共享规则返回焦点。
- Browser Mode 覆盖明暗主题、zh/en、390 CSS px、长模型名、键盘、未知字段、旧扩展 usage 和事件重放。历史与子 Session 使用自己所属条目，阅读位置、正文选区、宿主布局和现有 Goal／Session 费用消费者保持。
- 真实后台 Electron + 真实 Sidecar（可控 faux 模型）验证两轮底栏、原始 Markdown 宿主剪贴板读回与恢复、CDP 无 hover、历史浮层保持、Escape 返回，以及重新加载后底栏数量和可信时间一致。

## 精确检查

合并后 App／样式 12 文件、132 测试通过（退出码 0，25.21s）；静默 Electron 4 文件、14 测试通过（退出码 0，99.80s）。类型检查、格式与 lint 通过；文档检查 302 个 Markdown、0 问题（退出码 0）。仅运行相关检查，不把局部结果描述为全仓通过。

```bash
rtk pnpm run test apps/desktop/src/renderer/features/conversation/assistant-footer.browser.test.tsx apps/desktop/src/renderer/features/conversation/request-usage.browser.test.tsx apps/desktop/src/renderer/features/conversation/attempt-usage.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-cost.browser.test.tsx apps/desktop/src/renderer/features/conversation/messages.browser.test.tsx apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx apps/desktop/src/renderer/features/conversation/history.browser.test.tsx apps/desktop/src/renderer/features/conversation/business-timeline.browser.test.tsx apps/desktop/src/renderer/features/conversation/dock/goal-card.browser.test.tsx apps/desktop/src/renderer/features/right-panel/agents-tab.browser.test.tsx apps/desktop/src/renderer/features/right-panel/team-tab.browser.test.tsx packages/ui/src/guards/style-guard.test.ts
rtk pnpm run test apps/desktop/e2e/message-footers.e2e.test.ts apps/desktop/e2e/rewind.e2e.test.ts apps/desktop/e2e/chat.e2e.test.ts apps/desktop/e2e/goal.e2e.test.ts
rtk pnpm run typecheck
rtk pnpm run check:docs
```

## 视觉与文档读回

[亮色英文 390px](04-light-en-390.png)及[暗色中文 390px](04-dark-zh-390.png)来自相同实际 App 浏览器用例，在有限进入／退出动画结束后截取并读回。截图只含测试消息和模型名。底栏时间与操作垂直居中；明细标签和值对齐，完整模型名换行，卡片和页面无横向溢出；上方空间不足时共享 Popover 自动翻到下方，不覆盖触发器、不被消息区裁剪。截图捕获语句随后移除，不在测试中写固定路径。

当前行为归属为 `docs/subsystems/workbench.md` 的消息底栏正文，Goal 界面摘要与已有 Browser/Electron 预期同步更新。已从 AGENTS → docs/README → 两篇正文独立读回：引用、归属、入口、语义、历史保留通过；没有正式文档反向依赖本任务。新增功能设计只追加展示契约，并保留 02 的尝试设计。

## 限制与交付状态

未运行真实 Provider、CI、签名发布产物、物理鼠标或原生标题栏验证。无密钥的真实协议链路证据来自 01／02，本票 Electron 使用 faux，只证明实际宿主与 Sidecar 的装配、交互和持久化，不冒充真实服务计量。仍需 07 在最终组合状态核对全部 AC。

源码、设计、票与小型截图均保存在本地 Git；不推送、不合入 main、不发布。测试进程及 Electron 由所属 harness 等待退出；本票保留 worktree 供新 merger 集成，之后由主代理通过托管归档清理。
