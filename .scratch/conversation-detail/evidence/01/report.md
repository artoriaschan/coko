---
kind: evidence
description: "01 消息、思考、原始内容与显示身份的 App 验证、参考对照和资源清理记录。"
lifecycle: active
---

# 01 消息与思考验证

## 验证对象

- [规格](../../spec.md)：AC-01 的消息与思考、AC-09、AC-16 的原始用户内容、AC-23 的单条键盘开合、AC-24、AC-25。
- [实施票](../../issues/01-messages-and-reasoning.md)。基础提交 `6e57ed0`，本票代码提交 `8c59ec2`、`6a8de90`；验证对象为合入 02 与基线类型修复后的 `d08a6bdcca379028b8bdb75f6763df4896ba0b30`。后续本票提交只增加这些证据与关闭依据。
- 参考提交严格为本机 DeepSeek Harness `8bd073392eef6f54e921a093b95076248eb08cbb`，使用原始 UserMessageBubble、ReasoningRow、MarkdownText、主题与图标组件。参考截图为组件装配，并非完整 Host 时间线投影。
- Coko 视觉入口是真实 App + 既有 createFixtureChat 协议夹具，外部临时 Vite 页面仅装配这些现有入口；没有重写产品组件或制作静态 mock。浏览器为 macOS 上 HeadlessChrome/154，DPR 1，标准文档模式 CSS1Compat，系统字体栈；见 [环境](environment.json)。早期临时页面缺少 doctype，发现后补齐并重新采集本目录全部 Coko 视觉/交互证据。
- 正常截图调整临时 App 容器宽度为 1448.75px，主区 1168.75px，使实际 `64cqi` 消息列恰为 748px，与参考列一致。窄窗口为完整主区 390px、消息列 326px，保留原输入区 358px 和原外壳。消息区计入既有 4px stable gutter，右侧 CSS padding 为 28px，最终可见左右间距均为 32px，消息列与输入框中心轴一致。

## 执行记录

| 命令或步骤 | 覆盖场景 | 实际范围与数量 | 结果 |
| --- | --- | --- | --- |
| `rtk pnpm install --frozen-lockfile` | 独立 worktree 依赖 | 锁文件安装；未修改依赖 | 退出 0 |
| `rtk pnpm run test apps/desktop/src/renderer/features/conversation/messages.browser.test.tsx apps/desktop/src/renderer/features/conversation/timeline.test.ts apps/desktop/src/renderer/features/conversation/tool-rows.browser.test.tsx apps/desktop/src/renderer/features/right-panel/agents-tab.browser.test.tsx apps/desktop/src/renderer/features/right-panel/team-tab.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx packages/ui/src/guards/style-guard.test.ts` | 本票 App 场景、时间线、02 工具壳、共用右栏、外壳及样式规则 | 7 文件，103 用例；其中本票 App 文件 9 例 | 103 通过，退出 0 |
| `rtk pnpm run typecheck` | renderer、协议与共享类型 | 根 `tsc -b` | 退出 0；最初的既有 model-picker readonly 夹具错误已由集成分支独立修复 |
| `rtk pnpm run check:docs` | 当前文档与任务入口 | 265 个 Markdown 文件，0 问题 | 退出 0 |
| `agent-browser --session coko-ticket01-visual` 的 open / screenshot / click / press / set media / eval | 双主题、正常与窄窗口、zh/en、开合、运行扫光、键盘与 reduced-motion | 真实 App 的静默 CDP 渲染与操作；无 Electron 原生层 | 下列截图、测量和交互结果成立 |

App 测试只在外部剪贴板边界替换 `navigator.clipboard.writeText`，验证复制的原文和成功反馈；其后的实际 App、时间线、消息、命令、附件与 Markdown 均为真实实现。未替换内部组件或业务状态处理。

TDD 已观察的红灯包括：旧思考没有按钮语义与预览；流式结算更换 DOM、丢开合；旧代码字号为 12px 而参考为 11px；阶段回复误附最终操作栏；stable gutter 造成中心轴左移 2px、窄列 322px 而非 326px。对应实现后以上 App 用例均通过。窄窗口测试会等待真实主区宽度达到 390px，再断言附件与几何，避免把侧栏的过渡中间帧当作稳定布局。

## 视觉与交互证据

| 对象 | Coko | 锁定参考或观测 |
| --- | --- | --- |
| 748px 亮色收起 / 展开 | [收起](light-748-collapsed.png)、[展开](light-748-expanded.png) | [参考组件](reference-light-748-components.png)、[实测](light-748-metrics.json) |
| 748px 暗色收起 / 展开 | [收起](dark-748-collapsed.png)、[展开](dark-748-expanded.png) | [参考组件](reference-dark-748-components.png)、[实测](dark-748-metrics.json) |
| 390px 主区、326px 消息列 | [亮色](light-390-app.png)、[暗色](dark-390-app.png) | [参考亮色组件](reference-light-326-components.png)、[参考暗色组件](reference-dark-326-components.png)、[亮色实测](light-390-metrics.json)、[暗色实测](dark-390-metrics.json) |
| 英文、键盘与运行过程 | [英文窄窗口](light-390-en-app.png)、[运行时键盘展开](light-390-streaming-keyboard.png) | [键盘结果](keyboard-reduced-motion.json)、[正常扫光](stream-motion-metrics.json)、[减少动态效果](stream-reduced-motion-metrics.json) |

逐项对照结果：气泡 14/22、10px/16px、R20，亮色 rgb(237 243 254)、暗色 rgb(44 44 46)；助手正文 14/24；思考标题 13/24、24px 行高、16px leading 槽与 14px 原图标、6px 间距、2px 分隔点与左右 8px、正文左缩进 22px、紧凑 Markdown 13/20。字体栈、前景、曲线和双主题颜色来自同一参考语义值。思考与复制使用参考 regular artwork，展开后常驻向上箭头，收起时 hover / focus 改为向下箭头。原有 Coko 独有回退/分叉仍使用现有图标与授权语义。

运行扫光实测 duration 1.5s、delay 0.3s；reduced-motion 时 decoration 不可见、animationName 为 none。键盘 Enter 后焦点仍在控制项、aria-expanded 为 true、关联正文可见。对应值见 JSON，未用静态截图代替交互断言。

截图之间的时间线绝对纵向位置不作本票完整投影验收：参考装配额外包含专用工具，本票 App 保留真实的用户操作栏与原工作台；过程组、整轮与页脚由 03 负责，跨票顺序和联合视觉验收属于 13。本票已经核对消息、思考自身的对应物和 App 外围几何，没有把组件截图称为完整 Host 复刻证明。

## 身份契约与后续接入

`AssistantBlockSource` 仅是展示元数据：Session、真实 Run、contentIndex。已提交 key 继续由原 seq/contentIndex 构成，不依赖加载的历史数量。live key 加入 Run 与前一已提交助手条目的 seq，区分连续模型消息。`useMessageIdentities` 在 Session 作用域内把唯一可对应的新提交块沿用前一 live 块的 React 身份；缺失 Run 或对应不唯一时不猜测。普通增量、结算、主题变化保留正文 DOM、开合与选区；原始条目和派生数组不被修改。

03 接入分组时应在整个 Session 时间线边界只执行一次身份解析，分组身份使用解析后的真实成员身份，并保持组容器从运行到历史稳定；不要在组内重新建立映射或用 Run 内消息计数取代已提交 seq。整轮显式重置内层开合与自动收起焦点规则由 03 承担，长历史与滚动协调由 11、12 在该契约上继续验收。

## 文档影响与清理

当前事实归 [工作台正文](../../../../docs/subsystems/workbench.md#对话消息与思考)，[文档导航](../../../../docs/README.md)同步摘要；[设计系统](../../../../docs/tech-stack/ui-design-system.md#样式守卫)记录 scoped code banner、exact artwork 与 `backdrop-filter: none` 的精确例外。该例外只关闭行内代码工具栏的 Streamdown 浮层模糊，不改变菜单。已从 AGENTS → docs/README → 正文读回，职责、状态和路径正确，正式文档未反向依赖本任务。

命名浏览器会话已 `close`。Vite 首次与重新采集进程均按完整入口命令核对 PID 后发送 SIGTERM，再通过 exec 的完成结果确认退出；最后精确 pgrep 无匹配。没有启动或停止用户 Electron 实例，也没有清理无关目录。截图、JSON 已保存到本目录，worktree 由集成流程在合入后清理。

## 限制与交付状态

本票本地源码、103 例相关检查、静默实际 App CDP 与对应组件视觉证据已完成；未运行全仓测试、真实模型、Electron 原生窗口/真实指针或发布产物，也未推送或验证 CI。本票不修改数据库、协议、执行授权或参考仓库。最终 Standards / Spec 双轴评审与完整跨票 Electron 验收由集成流程及 13 统一完成，不能将本票结果表述为整份规格 delivered。
