---
kind: evidence
description: "最终 Standards 与 Spec 审查修正、红绿回归、局部 Browser/Electron 补验及证据复用边界。"
lifecycle: active
---

# 最终审查修正

## 验证对象

在集成基线 `d943ea509985f17e72f3dd74fd7085dc303c2009` 上修正最终审查；规格、设计和历史集成验收分别见 [spec](../spec.md)、[design](../design.md)、[原集成证据](integrated-acceptance.md)。本次使用独立 worktree 与 `codex/right-sidebar-review-fixes`，不推送、不修改 main。测试接缝沿用已确认的四处；实际 App/真实 store/fixture 与实际 Chromium，只有网络、模型与时钟可替换。打包测试启动真实后台 Electron + Sidecar + faux 模型。

## 逐条审查处置

| 轴与结论 | 问题 | 修正与可观察证据 |
| --- | --- | --- |
| Standards HARD P2 | 实时 JSON 以序列化内容为 key 导致折叠丢失 | 以选中记录身份为 key；真实 App 在已折叠的实时思考组追加帧后仍为同一 details 且保持收起，换记录重新展开，80% 高度保持 |
| Standards HARD P2 | 瞄准无法纯键盘完成 | 同一 DOM 身份和精确 matcher 枚举可见目标；上下循环、Home/End、Enter/空格确认，焦点保持在按钮，zh/en 帮助与当前身份状态；真实 App 两种格式的所有当前可见目标类型、筛选清除、面包屑新根、无底层激活、编辑与前台筛选弹层保护、修饰键全屏取消；打包 Electron 完成同一工具的键盘反查 |
| Standards HARD P3 | 筛选图标缺 Tooltip | 复用共享 Tooltip/TooltipTrigger/TooltipContent，与 PopoverTrigger asChild 组合；真实 App 悬停、聚焦、Enter 打开及 Esc 关闭；打包 Electron 悬停读到全文 |
| Standards HARD P3 | 动效时长与 easing 硬编码分散 | 主题组件局部值，表格行、引用行与 body 覆盖层统一读取；WAAPI 与清理计时器同源，约700ms；减少动态效果不闪烁 |
| Standards JUDGMENT P3 | 左右 AppFrame 拖动生命周期重复且清理不一致 | 共用 startResize 与一份 listener ownership，各自保留宽度方向和 clamp API；两侧实际宽度、blur 结束、后续以当前宽度重新拖动、卸载后公共回调不再收到事件 |
| Spec P2 INS-07/16 | 同行更新不重启，B 更新会提前清除 A | 每行独立更新代次对象与时刻，行组件独立动画/到期清理；虚拟化只播放剩余时段，不重挂 row DOM。实际动画对象与350ms中间背景色、A再次更新后新动画、交错B保持A、A到期仍保留B、B自行到期；DOM/焦点/滚动保持，新行实际动画与减少动态效果无动画 |

## 红绿与执行记录

红绿按行为切片执行。JSON 红：更新后 details 被替换且 open；修正后完整 live-progress 2/2 通过。键盘红：按 Enter 启动后没有键盘说明/完成路径；修正后键盘工具选择通过，之后补齐格式和保护矩阵。Tooltip 红：悬停找不到 tooltip；修正后悬停/聚焦及编辑器路径通过。AppFrame 红：left blur 后公共回调从1增加到2；共用生命周期后两侧2/2通过。高亮红：A第二次更新没有新动画，原 CSS 动画结束后找不到可重启对象；修正后实际 WAAPI 和交错到期检查通过。没有固定等待、retry、skip、超时放宽或削弱原断言。

初次编写回归时发现的测试自身问题也保留范围：不存在的 locator.trigger 改用实际 keyboard；预期的实时组身份改为实际公开 group:1；fake timer teardown 的返回类型改为 void。第一版主题接入漏给 table 添加 diagnostic-motion，动画时长为NaN并实际失败，补齐后通过。Tooltip 离开后仍由焦点保持打开，测试显式把焦点转到真实 composer 后再验证关闭和键盘聚焦，没有改变产品以迁就测试。

| 命令 | 范围和结果 |
| --- | --- |
| `rtk pnpm install --frozen-lockfile` | 独立安装，退出0；不共享可写 node_modules |
| `rtk pnpm run test apps/desktop/src/renderer/features/session-diagnostics/live-progress.browser.test.tsx` | 1文件2通过，0跳过，6.01s，退出0 |
| `rtk pnpm run test apps/desktop/src/renderer/features/session-diagnostics/timeline-navigation.browser.test.tsx apps/desktop/src/renderer/features/session-diagnostics/grouping.browser.test.tsx apps/desktop/src/renderer/features/session-diagnostics/live-progress.browser.test.tsx apps/desktop/src/renderer/features/session-diagnostics/raw-data.browser.test.tsx packages/ui/src/app-frame/app-frame.browser.test.tsx` | 5文件49通过，0跳过，31.48s，退出0；后续补充键盘类型和新增行断言由最终组覆盖 |
| `rtk pnpm run test apps/desktop/src/renderer/features/session-diagnostics/timeline-navigation.browser.test.tsx -t 'every visible'` | 2通过，12项因明确过滤未运行，6.62s，退出0；最终组再完整执行 |
| `rtk pnpm run test --project desktop-e2e apps/desktop/e2e/diagnostic-progress.e2e.test.ts apps/desktop/e2e/right-panel-menu.e2e.test.ts` | 2文件3通过，0跳过，30.79s，退出0；当前源码打包，后台原生，无Forge/watch并行 |
| `rtk pnpm run typecheck` | 退出0；初次只报测试 teardown 返回类型，修正后通过 |

最终局部组：`rtk pnpm run test apps/desktop/src/renderer/features/session-diagnostics packages/ui/src/app-frame packages/ui/src/guards/style-guard.test.ts scripts/browser-deps.test.ts packages/i18n/src/index.test.ts apps/desktop/src/renderer/app/right-panel-shortcuts.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx`：20文件206通过、0跳过、退出0、63.84s。包含上述最后补充的所有类型与新增行断言。随后只移除了多余的预览背景 transition（没有产品需求，不为保留 CSS 动画另造行为）；原来的 CSS 行动画已经迁到独立 WAAPI，所有实际动效/计时消费者均从主题读取。最终补验与机械检查见后续记录。

## 文档影响与复用范围

当前行为原位更新在 `docs/subsystems/session-diagnostics.md`，主题动效约定原位更新在 `docs/tech-stack/ui-design-system.md`；设计/spec/12票附加本证据链接，不改写早期调查、分拣角色或已记录失败。导航职责与路径不变，正式文档不依赖 scratch。

原集成证据的459项混合测试和13文件17项原生验收仅按原范围保留。此次重跑所有改动的诊断 Browser/纯模型、共享 AppFrame、App 组装/快捷键、样式与字典守卫，以及当前打包诊断/原生菜单；未变化的 Jobs/Teams/Schedules/Subagents/Trace/附件/保存恢复/资源打包等按已有证据复用，不冒充本次再次执行。没有真实模型、CI、签名/公证、ZIP/DMG 或发布验收结论。

历史 AppFrame peek 遮挡、持续其他Run动画 locator 和 Teams焦点初始失败仍按原集成证据记录为未复现且原因不确定，不把本次局部通过当作根因解释。已记录的旧模型设置失败不扩入本次修复。原生真实指针、红绿灯命中、窗口拖拽与屏幕合成材质不能由后台透明/忽略OS鼠标的测试证明，仍未验证。已有静默 agent-browser 几何/主题截图与清理证据仅复用原范围；本次新增键盘/Tooltip通过真实打包 Electron 直接验证，不把 Browser Mode 冒充原生物理交互。


## 最终补验与读回回执

- 删除多余预览 transition 后，`rtk pnpm run test apps/desktop/src/renderer/features/session-diagnostics/grouping.browser.test.tsx apps/desktop/src/renderer/features/session-diagnostics/timeline-navigation.browser.test.tsx packages/ui/src/guards/style-guard.test.ts`：3文件62项通过、0跳过、退出0，30.67s。重启、交错到期、新行、减少动态效果、所有可见目标类型及取消/键盘/保护路径均执行。
- 当前源码再次打包：`rtk pnpm run test --project desktop-e2e apps/desktop/e2e/diagnostic-progress.e2e.test.ts`：1文件1项通过、0跳过、退出0，23.68s。原生菜单2项复用前一批：此后仅删除不触发几何或关闭逻辑的预览背景过渡及其主题衍生值。
- 变动 TS/TSX（含新 diagnostic-motion.ts）的 `rtk pnpm exec oxlint <变动清单>` 退出0。`rtk pnpm exec oxfmt apps/desktop/e2e/diagnostic-progress.e2e.test.ts apps/desktop/src/renderer/features/session-diagnostics packages/ui/src/app-frame/app-frame.tsx packages/ui/src/app-frame/app-frame.browser.test.tsx packages/ui/src/styles/theme.css packages/i18n/src/dictionaries/domains/diagnostics.ts` 退出0。格式化未引入其他模块改动。
- `rtk pnpm run check:docs`：346个Markdown、0问题、退出0。新增证据从 spec/design/12票和旧证据可达。机械检查发现 CSS 文件末尾多余空行，修正为单一结尾换行后再检查。
- 从 AGENTS → docs/README → session-diagnostics/ui-design-system 读回。路径/引用、语义同步、归属与权威、正式资料到scratch的引用方向、生命周期、当前入口、新会话范围辨认、历史保留均通过。已搜索 `700ms`、`背景淡出`、`瞄准.*蒙层`、`JSON 容器默认`、`筛选按钮` 在 docs、scratch 和 .agents 中的消费者：现行正文同步，原票/原集成截图与失败描述是当时证据而保留；12票和集成证据追加后继链接，未改历史结论。导航摘要仍准确，不新增重复正文或目录。
- 本次没有启动 Forge/watch 或 agent-browser 会话，全部 Electron 由 E2E harness 拥有并 dispose；没有占用前台、结束用户应用或保留调试端口。

本地提交、最终集成合并与最终机械读回结果由交付回执记录。上述证据不表示远程、CI或签名发布完成。
