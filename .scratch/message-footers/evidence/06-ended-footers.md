---
kind: evidence
description: "停止、失败、无正文、暂停与中断 Run 底栏的 App、静默 Electron 和兼容回归证据。"
lifecycle: active
---

# 异常及无正文 Run 底栏验收

## 验证对象

- [规格](../spec.md)：AC-07、AC-08、AC-15、AC-21；[实施票 06](../issues/06-stopped-and-failed-footers.md)。
- 基线：`f9ff248f2e4a78d359dcdc478fd225916476d454`；目标为本记录所属提交。独立分支 `codex/message-footers-06`，与集成分支核对后交新合并代理集成。
- 环境：macOS、开发机 Node.js 24.15.0、Electron 41.0.3、Vitest 5.0.3 Chromium Browser Mode。App 以真实装配消费持久化形状的 Session Entry；仅剪贴板边界在 Browser Mode 使用替身。Electron 使用真实 Sidecar、独立临时目录和受控 faux 模型，默认后台模式。

## 执行记录

| 命令或步骤 | 覆盖场景 | 实际范围与数量 | 结果 |
| --- | --- | --- | --- |
| `pnpm run test apps/desktop/src/renderer/features/conversation/ended-footers.browser.test.tsx` | 停止、有正文／无正文、未取得统计、仅进度结束 | 首先 1、2、3 测试的逐片红绿循环 | 每个新增结束路径先因缺底栏失败，修复后通过 |
| `pnpm run test apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx apps/desktop/src/renderer/features/conversation/ended-footers.browser.test.tsx apps/desktop/src/renderer/features/conversation/assistant-footer.browser.test.tsx apps/desktop/src/renderer/features/conversation/attempt-usage.browser.test.tsx apps/desktop/src/renderer/features/conversation/timeline.test.ts apps/desktop/src/renderer/stores/chat-store.test.ts packages/ui/src/guards/style-guard.test.ts` | 11 个异常 App 场景、原成功底栏、失败压缩 37 tokens、完整／部分／未知／零、阅读位置、旧时间线、样式 | 7 文件，119 测试 | 通过，退出 0 |
| `pnpm run test apps/desktop/src/renderer/features/conversation/process-groups.browser.test.tsx apps/desktop/src/renderer/features/conversation/business-timeline.browser.test.tsx apps/desktop/src/renderer/features/conversation/request-usage.browser.test.tsx apps/desktop/src/renderer/features/conversation/attempt-usage.browser.test.tsx apps/desktop/src/renderer/features/conversation/messages.browser.test.tsx` | 过程折叠、业务时间线、原计量兼容与消息装配 | 5 文件，54 测试 | 通过，退出 0 |
| `pnpm run test apps/desktop/src/renderer/features/conversation/timeline.test.ts apps/desktop/src/renderer/stores/chat-store.test.ts apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx apps/desktop/src/renderer/features/conversation/permission-states.browser.test.tsx apps/desktop/src/renderer/features/conversation/history.browser.test.tsx packages/ui/src/guards/style-guard.test.ts` | 扩大检查与定位 | 最初 113 通过、3 失败；权限与历史文件通过 | 后续 119 测试运行修复失败责任模块；不把最初失败描述为全通过 |
| `pnpm run test apps/desktop/src/renderer/features/conversation/permission-states.browser.test.tsx apps/desktop/src/renderer/features/conversation/history.browser.test.tsx` | 最终渲染状态下的审批、结果确认与只读历史 | 2 文件，20 测试 | 通过，退出 0 |
| `pnpm run test apps/desktop/e2e/message-footers.e2e.test.ts` | 真实宿主剪贴板、无正文失败→重试→审批→停止、时间、重载与费用缺席 | 1 文件，2 测试 | 通过，退出 0 |
| `pnpm run test apps/desktop/e2e/message-footers.e2e.test.ts -t 'failed and stopped'` | 追加历史异常底栏 CDP 无 hover 断言 | 1 通过，1 未选中 | 通过，退出 0；保留前一命令的正常路径证据 |
| `pnpm run test apps/desktop/src/renderer/features/conversation/ended-footers.browser.test.tsx -t '390px'` | 截图读回，明暗 × zh/en，键盘与视口边缘 | 4 通过，7 未选中 | 通过，退出 0；临时截图调用已移除，保留行为断言 |
| `pnpm run typecheck` | 当前源码与测试 | 9 workspace 项目 | 通过，退出 0 |
| `pnpm exec oxfmt`（显式 8 个变更 TS/TSX 文件） | 当前变更格式 | 8 文件 | 通过，退出 0 |
| `pnpm exec oxlint`（显式变更 TS/TSX 文件） | 当前变更 Lint | 8 文件 | 通过，退出 0 |
| `pnpm run check:docs` | 当前正式文档、任务证据、引用与元数据 | 303 Markdown 文件 | 通过，退出 0 |

### 失败定位与可观察结果

- 旧时间线只在存在 usage 时插入结束用量位置，导致无正文、无用量错误完全没有入口；现在每个已结束 Run 都有结束位置，生成或待审批中没有。
- 扩大检查捕获两项真实布局问题：终止底栏的容器不应算作正文消息；成功回复已有内嵌底栏时，被抑制的额外结束位置不应在 ProcessTimeline 中保留空尾行。修复后原 19 个阅读位置测试通过，未放宽几何或身份断言。
- 时间线旧测试按原输出修改为显式包含结束位置，chat store 改为定位真实错误项；错误内容、重试资格、来源和重复结束去重的断言继续保留。
- 停止场景展示 38 个已报告 tokens，详情名为已报告小计；复制只得到最后产生的 `**Partial**` 与其第二文本块，不混入早期阶段回复。失败压缩无正文仍显示 37 tokens；完全未知显示“未取得用量”，精确报告全零显示 0 tokens。
- Electron faux 只提供兼容计数、不提供真实 Provider 的字段存在性报告，所以新底栏按未知显示。最初测试把脚本设定的 14 错当作已报告数值，读实际 meter 契约后改为断言未取得且不能显示假 0。真实协议的已报告失败计数证据由前置 02 提供；本票不声称 faux 等于真实 Provider。
- 中断恢复状态及结果确认按钮保持；恢复补写时间不成为执行结束时刻。未成功提交结束记录时保留已报告用量、错误与禁重试语义，不补造时间。

### 视觉读回

- [light/en 390px](06-light-en-390.png)、[dark/zh 390px](06-dark-zh-390.png)已读取实际渲染图像；错误与重试仍清楚可见，底栏和详情无费用，未知分桶为破折号，没有整页横向溢出。
- 静默 Electron 的历史异常控件在 hover 设备离开后隐藏，CDP 模拟无 hover 后显示；键盘打开详情、Escape 关闭和重载后的结束时间保持通过实际窗口验证。

## 文档影响与读回

| 变化 | 所属正文 | 已同步动作与检查 |
| --- | --- | --- |
| 异常／无正文结束位置、已知与未知、恢复时间 | `docs/subsystems/workbench.md` | 替换临时保留旧输出的说明，增加异常 App 与既有 Electron 证据入口 |
| 删除旧独立费用行组件 | `docs/subsystems/goal.md` | 移除 `run-usage-row.tsx` 已失效路径，保持标题栏费用与预算归属 |
| 功能设计 | `design.md` | 记录异常位置与空尾行过滤、仅进度结束和复制范围，不新增计量来源 |

已按 AGENTS → docs/README → workbench／goal 正文读回：路径、摘要、归属、引用方向、当前入口、生命周期与历史保留通过。搜索删除路径及旧“异常兼容用量行／暂保留”说明，当前正文无残留；已交付 M4 规格的原文件分工保留为历史，未改写当时结论；没有新增正式类别、目录、术语或 ADR。正式文档未依赖具体任务材料。

## 结论与限制

06 验收要求已有 App、静默 Electron、共享样式与阅读位置证据；保存并提交至本地功能分支，未推送、未并入 main、未发布。真实 Provider 凭据、物理鼠标、原生标题栏、签名发布包及 CI 未验证。本票复用前置实际计量事实；07 仍须在最终合并状态联合核对全规格与新助手分支。
