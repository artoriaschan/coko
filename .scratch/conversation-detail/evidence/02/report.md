---
kind: evidence
description: "02 工具摘要行、通用详情、调用身份与 Inspect 的本地实施及验证记录。"
lifecycle: active
---

# 02 工具摘要行与通用详情

## 对象与范围

2026-11-03，本票分支 `codex/conversation-detail-02`，基于集成分支 `4ce92d9`。参考仓库 HEAD 已核对为规格锁定的 `8bd073392eef6f54e921a093b95076248eb08cbb`。只改 renderer 展示及共享的显式 `ToolCard variant="row"`，不改 Session payload、数据库、协议或工具执行。

实际 App 入口接收现有内存协议夹具与 progress/entry，验证初始收起、键盘、MCP/未知工具、真实参数和同时存在的文本/details、流式结算、不同调用身份、输入选区、内部滚动，以及现有 Trace 标签页入口。仅替换协议外部边界，时间线派生、App 组合、工具分发和共享展示均为真实实现。

## TDD 与本地检查

- 第一条 App 用例在改动前因命令工具默认 `aria-expanded=true` 失败；改为手动展开后通过。
- 第二条 App 用例在修复前因非空文本遮掉结构化 details 失败；保留两者后通过，同时确认结算后的正文 DOM、选区和 scrollTop 不变。
- `rtk pnpm install --frozen-lockfile`：退出 0。
- `rtk pnpm run test apps/desktop/src/renderer/features/conversation/tool-rows.browser.test.tsx apps/desktop/src/renderer/features/conversation/tool-cards.browser.test.tsx apps/desktop/src/renderer/features/conversation/tool-card-images.browser.test.tsx apps/desktop/src/renderer/features/conversation/team-rows.browser.test.tsx apps/desktop/src/renderer/features/conversation/agent-card.browser.test.tsx packages/ui/src/guards/style-guard.test.ts apps/desktop/src/renderer/features/right-panel/trace-tab.browser.test.tsx`：7 文件、69 用例通过，退出 0。包含实际 App 的 6 用例：初始展开/Inspect、流式身份/选区/滚动及 light/dark × zh/en 的 390px 长内容。
- `rtk pnpm run typecheck`：最初因既有 model-picker 测试的 readonly fixture 类型失败；合入集成分支 `4ce92d9` 的两行修复后重新运行，退出 0。
- `rtk pnpm exec oxlint` 对本票变更的 10 个 TS/TSX 文件运行：退出 0。`rtk pnpm exec oxfmt` 对 12 个变更源码/样式文件运行：退出 0。
- `rtk pnpm run check:docs`：在本证据加入前检查 263 个 Markdown、0 问题、退出 0；证据与票回执纳入后再次检查，结果见票 Comments。

旧测试的预期按规格同步：命令/编辑/错误不自动展开；状态改为不重复播报的隐藏 status 文本；失败摘要保留真实错误，team task 错误需手动展开。共享 AgentCard 保留原默认卡片变体并通过原有用例。

## 视觉与交互

通过临时 Vite 页面挂载真实 App 与现有协议夹具，使用独立静默 `agent-browser --session coko-ticket02-visual`。没有启动前台 Electron，不涉及原生标题栏或真实指针。截图为 Chromium、DPR 1，系统字体环境；正常窗口 1280×900（主内容 1000px），窄窗口 390×900（等待主内容宽度实际达到 390px 再截图）。

- [light 正常摘要](light-normal-collapsed.png)
- [light 正常通用详情](light-normal-generic.png)
- [light 390px 通用详情](light-390-generic.png)
- [dark 正常通用详情](dark-normal-generic.png)
- [dark 390px 通用详情](dark-390-generic.png)

同环境参考来自只读源码调查子代理挂载的真实 ToolRow/DisclosureRow/主题与图标，留存在 `/tmp/coko-conversation-detail/reference-harness/reference-{light,dark}-{1000,454}-{collapsed,expanded}.png`；454px 视口内的参考示例列宽为 390px。它是原始展示组件的验证夹具，不是参考项目完整 Chat 的录制。其通用工具标题/摘要为夹具手动配置；实际参考消费者 `tool-call-model.ts:329` 使用 generic title + wire-name summary，本票按真实消费者保留该语义，不以夹具自定义文案替代业务适配。

已读回计算样式：摘要行高 24、字号/行高 13/24、常态 light `rgb(129,133,140)` / dark `rgb(173,178,184)`、前导框 16 与图形 14；IN/OUT 为 SF Mono 优先字体栈、11/16、R16、section 内边距 12×16、列距 14、真实 150px 内部滚动。light 背景 `rgb(249,250,251)`，dark `rgb(27,27,28)` 与边框 `rgba(255,255,255,.06)`。390px 主内容实测无整页或 IO 卡片横向溢出。

截图是在最后一次 Inspect 边框/hover 与 shimmer 色值精确修正之前拍摄：旧截图的 light Inspect 描边为 16% 黑色，最终源码已按基线修正为 12%；主体几何与 IO 字体/表面仍有效，Inspect 及运行动效最终截图须在 13 的组合验收刷新，不能将这些旧图视为最终整份规格验收。过程行之间的组级节奏由 03 完成，不以本票尚未引入的分组判断整轮样式通过。

App 自动化已验证键盘 Enter、手动折叠、Trace 选中与原有 Trace 消费者。流式稳定性另有 App 外部 DOM/选区/滚动断言；截图不替代这些交互证据。reduced-motion 路径在共享 CSS 中禁用过渡与 sweep，最终动态偏好的实际浏览器验收由 13 记录。

## 文档、接口与清理

当前行为归 `docs/subsystems/workbench.md`，Trace 导航补充归 `docs/subsystems/tracing.md`，新增局部档位归设计系统规格。均从既有正式导航可达；没有正式正文反向链接具体任务材料。没有重命名/弃用路径或新增正式目录。已从 AGENTS → docs/README → 所属正文读回，状态、归属及当前实现一致。

后续专用正文继续使用 `ToolView.body(item,args)`；共享行只持有本地开合，不拥有业务订阅/网络/权限。`ToolCardView` 可选 `onInspect` 只由真实拥有 Trace 入口的应用层提供，子 Session 默认省略。稳定 key 继续为 `tool:<toolCallId>`，普通结算不重挂载；显式整轮收起的内部重置由 03 的外层契约处理。

agent-browser 已确认 Browser closed；Vite 命令收到 SIGINT 并实际退出（130，正常停止），临时 HTML/TSX 已删除。截图保存在本票目录并纳入提交，不依赖工作树保留。未运行 Electron/真实模型/产物/CI；本票未涉及原生宿主动作，完整跨功能验收与独立 Standards/Spec 评审继续由 13 收敛。
