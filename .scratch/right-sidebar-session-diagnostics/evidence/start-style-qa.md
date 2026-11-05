---
kind: evidence
description: "开始页按用户参考图改为罗盘与单列入口卡片的视觉对照、真实 App 检查及静默 Electron 验收。"
lifecycle: active
---

# 开始页参考样式验收

## 验证对象

用户在 2026-11-05 初次集成交付后要求开始页样式也复制 DeepSeek Harness，见 [spec 补充](../spec.md#2026-11-05-开始页参考图样式补充)。本次基线是 `4c357c55665eb32631dce3ff9ce3302e99931086`，验证时位于本地 `codex/sidebar-start-reference-style`，当时改动尚未提交；只调整共享 `PanelStart`，不修改 tab 条、页面登记、设置开关、存储或页面动作。

视觉来源为[用户截图](start-reference-source.png)，原图 1616×2726 像素，按 2× 密度归一为 808×1363 CSS px。几何交叉核对本机 DeepSeek Harness 的 `packages/client/ui-sidebar-right/src/client/tabs/guide/GuideBody.module.css` / `GuideBody.tsx`：宽 380px、最小高 56px、间距 14px、内边距 14px/20px、图标槽 26px、裸标题图标 22px、罗盘槽 56px，与首卡相隔 30px；`ui-theme/src/styles/base.css` 的 `--dsw-radius-xl` 为 20px。

实际实现截图为[中文浅色全屏](start-reference-light-zh.png)，真实 Electron 渲染，808×1363 像素、CSS viewport 808×1363，密度 1×；截图时诊断入口处于 hover，与参考图同为开始页、中文浅色、诊断卡片 hover 状态。[同一画布完整对照](start-reference-comparison.png)左侧是归一参考，右侧是实现；[局部对照](start-reference-focused.png)按首卡对齐罗盘、间隔、图标和文字，避免整页缩小后遗漏细节。

## 对照发现与修正

第一轮发现 [P2] 罗盘指针为空心，与参考的实心菱形不同；沿用既有 Lucide Compass，将其针形 path 填充 currentColor 并采用 1.5 线宽。第二轮重新截图并生成上述完整和局部对照，指针已经填充，无待修的 P0/P1/P2 差异。

五类视觉核对：

- 字体与排版：卡片采用 Coko 已有 `text-ui-body-lg`，实际 14px/22px、400 字重、Noto Sans SC，图标与标题居中对齐。参考标题为 14px/1.4；保留既有字体与行高档位，长标题可换行，不截断重要入口。
- 空间与布局：原来的两列方卡已替换为单列横卡；实测 380×56、14px 间距、20px 圆角、26px 图标槽与 22px 图标。整组居中稍上提，矮面板让出提起留白后纵向滚动，左右保留 24px。
- 配色与 token：卡片表面、发丝边框、hover、焦点环、文字都来自 Coko 语义主题。参考不同功能的专用彩色图标与 Coko 的现有单色 Lucide 图标是明确的设计系统适配，不宣称颜色或字形逐像素一致。罗盘是低透明度前景色水印，不可交互。
- 资产质量：只使用项目已依赖的 Lucide 图标，不新增图标依赖、栅格占位、手绘 SVG 或伪功能资产。截图与对照均清晰，无拉伸；密度归一发生在验收对照图中，不影响产品资产。
- 文案与内容：Coko 仍为计划、后台任务、子代理、定时任务、团队、追踪，加开关启用后的会话数据诊断，共七项；参考六项的工作区文件、上下文、终端、浏览器、诊断、更多工具不引入 Coko。七项比参考多一行，因此整组起点约高 35px，是同一居中规则下的内容差异。原有 tab 图标、标题栏与窗口安全区不在这次开始页样式范围内。

## 执行记录

| 命令或步骤 | 覆盖与实际范围 | 结果 |
| --- | --- | --- |
| `rtk pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx -t 'Start'` | 现有真实 App 的开始页替换、唯一开始保护、390px 英文浅色与中文深色；4 通过、40 因明确过滤未运行，10.10s | 退出0 |
| `rtk pnpm run test packages/ui/src/components/panel-tabs.browser.test.tsx packages/ui/src/guards/style-guard.test.ts apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/settings/developer.browser.test.tsx` | 4 文件、96 通过、0 跳过，43.01s；真实 App、真实 store/fixture 和 Chromium，含默认6项与开关后第7项、原位打开 | 退出0 |
| `rtk pnpm run test packages/ui/src/guards/style-guard.test.ts apps/desktop/src/renderer/app/app.browser.test.tsx -t 'Start\|style'` | 罗盘修正后 4 通过、80 因过滤未运行，12.94s；守卫文件被过滤，因此另行完整执行 | 退出0 |
| `rtk pnpm run test packages/ui/src/guards/style-guard.test.ts` | 最终源代码样式守卫，1 文件、40 通过、0 跳过，617ms | 退出0 |
| `rtk pnpm run typecheck` | 最终源代码全项目类型检查 | 退出0 |
| `rtk pnpm exec oxlint packages/ui/src/components/panel-tabs.tsx apps/desktop/src/renderer/app/app.browser.test.tsx` | 两个变动 TSX | 退出0 |
| `rtk pnpm exec oxfmt packages/ui/src/components/panel-tabs.tsx packages/ui/src/components/panel-tabs.css apps/desktop/src/renderer/app/app.browser.test.tsx` | 三个变动源码/测试文件 | 退出0 |

现有 390px 用例改为 390×400 矮窗口，Tab 从第一项到最后的 Trace，断言焦点与卡片实际可见边界后用 Enter 打开页面；这是验证短视口真实可达性，没有新增逐项复述 CSS 常量的测试。[英文浅色 Browser Mode 截图](start-reference-browser-en-390.png)保留实际输出。

静默原生使用独立临时 `COKO_USER_DATA_DIR`、`COKO_HOME`、`COKO_CHATS_ROOT` 与 faux 模型脚本，以 `COKO_E2E_BACKGROUND=1 pnpm --filter @coko/desktop exec electron-forge start -- --remote-debugging-port=9222` 启动当前源码。通过 agent-browser 独立 `start-reference` 会话完成真实 Sidecar 首次发送、设置开启诊断与切换中文、打开开始、全屏、808×1363 卡片 hover。随后通过实际设置切深色，在 390×400 下验证[顶部状态](start-reference-dark-390-top.png)和[最后一项键盘聚焦](start-reference-dark-390-focus.png)：聚焦诊断卡片的实际边界为 x24、y331、338×56，右缘362、底缘387，整页 scrollWidth390；Enter 原位进入诊断，显示实际数据表格。`agent-browser errors` 没有输出页面异常。

所有自有资源已清理：agent-browser 会话关闭，Forge、Electron、Sidecar 的11个自有 PID 全部退出，9222 无监听。未退出或修改用户应用，没有前台占用。

## 文档影响与读回

`docs/tech-stack/ui-design-system.md` 原位替换失效的“两列”约定；`docs/subsystems/workbench.md` 补充单列与矮窗口行为；spec 追加用户新要求及本证据，不重写初次交付记录、旧票或旧截图。搜索 `两列`、`双列`、`grid-cols-2`、`开始页卡片`、`引导.*卡片` 覆盖 docs、所属 scratch 和 .agents；本次唯一现行“两列”消费者已更新，其余当时已完成票保留历史语义。

从 AGENTS → docs/README → workbench / ui-design-system 读回：路径与引用、语义同步、归属与权威、引用方向、生命周期、当前入口、新会话范围辨认、历史保留均通过；正式正文不依赖 scratch。`rtk pnpm run check:docs` 检查 347 个 Markdown、0 问题、退出0；`rtk git diff --check` 退出0。

## 结论与限制

开始页的参考布局、罗盘层次、卡片几何、悬停、现有入口打开与矮窗口键盘路径均有当前源码的真实渲染证据。当前没有待处理的 P0/P1/P2；Coko 的功能列表、既有字库、主题色与图标库差异明确保留，不宣称整页逐像素复制。

本次没有验证真实模型、原生物理鼠标、红绿灯命中、OS 窗口拖拽、签名打包、CI 或发布；样式改动未改变这些行为。不运行全仓测试，未将局部检查冒充全量验证。交付时为本地已保存，提交与合并由父任务继续处理。

final result: passed
