---
kind: evidence
description: "阅读锚点、独立跟随、历史快照、160ms 折叠过渡与真实应用验证。"
lifecycle: active
---

# 12 阅读位置与折叠过渡

## 对象与边界

对应[实施票](../../issues/12-reading-anchors-and-transitions.md)、[规格](../../spec.md) READ-01—04 与 AC-12、19—21、23—24。起点 38bd45b，先快进到 9b3f001；产品提交 7b0182c、05b10de、bbca355、1e87d6a、5d9dadf；已合入 07—11，最终验证源码为 7a3c5cf1914de3bcd0102bd5a95fbd5df6cf6313（含集成 85bf9df）。消费者与活动动效手势修订位于 ab2cf68、d3108d0；本报告后续文档/证据提交不改变产品代码。没有数据库、协议、执行授权、设置或历史分页扩展。

参考固定为 DeepSeek Harness `8bd073392eef6f54e921a093b95076248eb08cbb`，本机 `/Users/artorias_chan/Workspaces/agent/deepseek-harness`。读取 `packages/client/ui-chat/src/client/chat/{use-scroll-follow,use-process-scroll,use-chat-scroll,use-chat-reading,use-chat-viewport,flow-motion}.ts` 和组/流程样式；采用独立跟随、真实几何、可见锚点、50ms+110ms 高度/70ms 淡出的 160ms 运动。未引入参考的分页、显示档位、延后折叠或底部保留区实验。本票未启动参考完整 Host；源版本对照与 Coko 的真实几何记录是本票依据，联合工具视觉仍由后续总体验收覆盖。

环境为 macOS arm64、Node 26.10.0、pnpm 12.15.0、Vitest 5.0.3、React 19.3.0、agent-browser 0.38.2；真实 Electron 41.0.3 / Node 24.14.0 / Chromium 146.0.7680.80。新工作树 frozen install 完成后缺 Electron binary/path.txt，使用同一 frozen 版本 04 缓存补齐并读回 runtime 版本；首次误把 dist 目录嵌入 dist/dist 已纠正并清理，未改 lockfile。

## 实施与接缝

- `useReadingScroll` 统一主消息区、Agents 与 Team 子 Session 的外层策略，按 Session/挂载隔离；过程组使用同一小接缝的独立实例。监听真正的尺寸、滚动与手势，维护实际行的可见锚点；隐藏行、整轮控件不参与锚定，内部新成员先补偿组滚动，再补偿外层。不使用额外底部空白。
- 贴底跟随条目及详情高度增长；上行阅读暂停，物理回底或主区“返回底部”恢复。返回按钮消失前焦点转给消息区。组手动展开清除旧内部锚点并从顶部开始；组内滚动与外层意图独立，边缘使用原生自动传递。Space 激活工具按钮、只向下滚动但已在底部、纯横向滚动不误判为向上阅读。
- `useFlowBox` 在稳定容器上动画真实高度与透明度，组头、正文与整轮同时参与布局；160ms 结束时提交隐藏与最后位置。反向开合从当前显示高度、边距和透明度续接。尊重 reduced-motion，手动收起先聚焦控制项；恢复限高时依据本组最后一次真实内部焦点与既有门户锁保护实际目标：目标在高于 cap 的整行内部也保持可见，外层保留该目标原位置；React 门户事件不覆盖内部返回目标。手势可释放位置保护。保留 03 的 disclosure reset 和每组/Run 焦点及门户锁、07 的图片门户保护、08 的审批焦点接管和状态、10 的显式 Session facts。
- 主要测试为真实 `<App>` + `createFixtureChat` 的协议夹具入口。模型/网络在夹具边界可控，之后使用真实 store、时间线、组件、原生 DOM 几何、选区和焦点。早期历史用已有 Conversation 快照输入模拟扩大的记录集合；生产订阅仍按 afterSeq 接受重放，没有新增较早条目的后端入口。请求 pending 时的后续滚动优先，通过受控 Promise 验证。
- 原生测试启动实际 Electron、Sidecar、SQLite 和工具；faux 模型首先输出长答案，再真实调用 24 次 read，最后输出最终答复。定点真实滚轮验证阅读中不跟随、组内部滚动、组顶边向外传递、主动回底；重启不提供脚本，历史从 SQLite 读回。

## 红绿与汇总修复

1. 动态通用详情没有新条目时，原外层只从 1461 到 1483，未跟随新增正文；真实 App 红例要求增量超过 100px，加入 ResizeObserver 后通过。组内同类红例保持 268、未到新增输出底部；独立实例修复后通过。
2. 手动历史组重新打开曾被外层旧组内锚点拉回 496，显式顶部初始化和释放该组旧锚点后为 0。折叠时浏览器先投递范围收缩 scroll，曾被误当作用户回底；尺寸/运动归属及不重复采样已确认的位置修复后，保留答案锚点。
3. 无折叠动画的版本无法找到 seat animation；加入后实际中间高度在起点和终点之间。焦点组头在恢复历史时原本瞬现，红例找不到动画；现在组头和 cap 同步增长。快速反向开合曾跳动 129.828125px，保留当前几何后通过。恢复源文件时一次误用压缩的 `rtk git show` 引入解析错误，改用 `rtk proxy git show` 后重新取得有效行为红例；解析失败不作为行为红绿依据。
4. 返回底部后焦点原为 body，修复为实际消息区；Space 展开工具正文曾离底 238px，区分激活控件与阅读键后通过。
5. 恢复 cap 的新增真实 App 红例分别暴露尾部工具 bottom 843px > 组 bottom 575px、门户返回目标 982px > 575px、超高思考内操作 1439px > 557px；依据实际目标及作用域保护修复，并验证 80ms 中间帧与最终几何。sticky Thinking 同时在 20ms 中间帧与结束后保留外层可见位置。
6. 初始汇总 [renderer-initial.log](renderer-initial.log) 为 37 文件 295 条：291 通过、4 失败；[electron-initial.log](electron-initial.log) 为 3 文件 10 条：9 通过、1 失败。批量归因后只修正测试消费者：组/原生 chat 等待实际 overflow 恢复后再滚动/测 cap；思考摘要定位到 toggle，避免同文隐藏 Markdown 的 strict 匹配；独立 ScheduleFireRow 夹具提供新公开 TimelineSessionContext。未加固定等待、放宽位置/文本断言或加入生产 fallback。

## 最终命令与结果

| 精确命令（仓库根执行） | 范围与结果 | 日志 |
| --- | --- | --- |
| `rtk pnpm install --frozen-lockfile` | 安装成功，退出 0；binary 环境修复见上文 | 本会话操作回执 |
| `rtk proxy pnpm run test --project desktop-renderer apps/desktop/src/renderer/features/conversation apps/desktop/src/renderer/features/right-panel apps/desktop/src/renderer/app/app.browser.test.tsx` | 39 文件、326/326 通过（包含 19 条阅读 App），退出 0 | [汇总](renderer-final.log) |
| `rtk proxy pnpm run test --project desktop-renderer apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx` | 5d9dadf 提交前 19/19 通过，退出 0；最终合并树由上行汇总完整复核。旧专项日志 15/15 保留为当时记录 | [较早阅读专项](reading-final.log) |
| `rtk proxy pnpm run test packages/ui/src/guards/style-guard.test.ts packages/ui/src/app-frame/app-frame.browser.test.tsx packages/ui/src/tool-card/tool-card.browser.test.tsx packages/i18n/src/index.test.ts packages/i18n/src/domains.test.ts apps/desktop/src/renderer/features/conversation/timeline.test.ts apps/desktop/src/renderer/features/conversation/process-groups.test.ts` | 7 文件、86/86 通过，退出 0；布局、共享壳、样式守卫与字典 | [共享](shared-final.log) |
| `rtk proxy pnpm run test --project desktop-e2e apps/desktop/e2e/reading-position.e2e.test.ts apps/desktop/e2e/chat.e2e.test.ts apps/desktop/e2e/approvals.e2e.test.ts` | 真实 Electron/Sidecar 3 文件、10/10 通过，退出 0 | [原生](electron-final.log) |
| `rtk proxy pnpm run typecheck` | 退出 0 | [类型](typecheck.log) |
| `rtk proxy pnpm run check:docs` | 277 个 Markdown、0 问题，退出 0 | [文档](docs.log) |

19 条阅读用例覆盖通用动态高度、双主题 390px、结算与完成、等待快照期间的新手势、组内早期成员/真实中途输入、手动开合、子 Session 切换、暂停/继续、实际动效几何、快速反向和焦点、reduced-motion，以及恢复 cap 时尾部工具、门户返回目标、超高思考正文内部操作和 sticky Thinking 的真实可见性。活动动效用例在 80ms 暂停实际 Animation，执行向上阅读，再采样 120ms 和结束后的锚点；断言位置，不仅断言时长或 class。

## 静默 CDP 与几何

使用 agent-browser 技能及实际 CLI core/Electron 指南，命名静默会话 `coko-reading-12`。外部 App 夹具只替换协议数据，实际源码由工作树导入；[夹具](fixture-main.txt)、[服务](fixture-serve.txt)、[矩阵脚本](capture.py)和[动效脚本](motion.py)保留。端口原子分配，脚本中的地址记录实际执行值。

1e87d6a 的通用阅读矩阵为明暗 × 1000/390 CSS px 主区、800px 高；正常 en、窄窗 zh，DPR 1。每种状态保存 tail / held / resumed / nested-reading 共 16 张图。实际看图核对了正常亮色 held 和窄暗色 nested-reading，正文、渐隐、按钮和输入区没有横向溢出。[metrics.json](metrics.json) 的四组结果：held 可见锚点位移均 0px、仍距底 432px；主动返回并追加后距底均 0px；主区分别 1000/390、消息列 680/326；组初始 scrollTop 均 0，组底为 268；cap 400px、overscroll auto、整页横向溢出 false。字体实际为 13px/20px 系统字体序列。

[motion.json](motion.json) 逐帧记录同一实际 seat 从 668px 收至 0；每一帧保留答案锚点 0px 位移，最终没有动画和第二次跳转。记录时间包含首帧调度，160ms 动画最后在下一帧被观察到；精确 duration 同时由实际 App 的 Animation timing 与中间几何断言验证。[reduced-motion.json](reduced-motion.json) 为 reduce=true、hidden=true、高度 0、动画 0、控制项仍聚焦。CDP 的初始手动完成等待曾因工具按钮仍有焦点而正确不收起，移交焦点后再验证自动收起；没有移除焦点保护。

最终 7a3c5cf 另在明暗 × 1000/390 主区执行真实 focus → Run 完成 → cap 恢复，并保存四张 focused-cap 图与 [focused-cap-metrics.json](focused-cap-metrics.json)：实际聚焦工具同时落在组内及外层可见范围。门户与超高思考操作由实际 App 用例逐点验证。

agent-browser 0.38.2 的低层 `mouse wheel` 实际把 wheel 发到 (0,0)，因此不把该命令的矩阵尝试声称为定点边缘证据；最终矩阵只记录内外独立位置和策略。真实组边缘滚轮传递由上述 Electron 用例的定点 mouse wheel 断言，未改变产品处理来迎合 CLI。没有占用前台，原生标题栏、真实鼠标及发布产物未验收。

## 文档、清理与交付

当前行为唯一归 [工作台](../../../../docs/subsystems/workbench.md#详细过程与三级折叠)，正式入口 [docs/README](../../../../docs/README.md) 同步摘要；不增加 ADR 或正式目录。含隐藏目录搜索“内部跟随独立于外层”“详细过程与三级折叠”“贴底时”和 reading-position：原 03 历史证据保留当时范围，现有规格/依赖链接仍有效；其他 Job 自身输出跟随属于独立消费者而保持原义。

文档从 AGENTS → docs/README → workbench 读回，核对路径、语义、权威归属、引用方向、生命周期、当前入口、新会话可读性和历史保留。具体结果与缺口在关闭票时追加。日志只规范化末尾空行，原始字节备份在仓库外 `/tmp/coko-conversation-detail/raw-12-logs/`，不改变命令、数量和结果。

[cleanup.json](cleanup.json) 记录命名浏览器和外部 Vite 的实际退出与监听消失；原生测试由现有 harness.dispose 等待应用和 Sidecar 退出。保留工作树供主任务集成，未停止用户应用。

本票为本地提交，未 push/PR，未运行真实模型或 hosted CI。专用图片、文件、终端等动态高度的联合场景仍由 13 总体验收；本票通用高度、原生工具和消费者检查独立完成，不把后续联合验收冒充本票已跑。

## 保留的汇总异常与定位限度

较早 d3108d0 的 [renderer-ime-anomaly.log](renderer-ime-anomaly.log) 为 38 文件 306 条、305 通过，NewChat IME Escape 后出现 sidebar-web 焦点；未把它按文件名归为无关，也未修改超时或弱化断言。原独立 NewChat 为 11/11。独立隔离诊断在完全相同 d3108d0 得到配对 26/26 与原完整汇总 306/306；受控 hovercard 探针未到达原症状，不能证明根因。见 [独立诊断报告](ime-diagnosis.md)。没有依据支持生产修复，保留为未确认间歇异常；最终 7a3c5cf 汇总 326/326（含 NewChat）通过不等于根因已解决。

子 Session 原聚合采样曾在 reflow 与 ResizeObserver 之间得到 64/72px 差；改为等待公开布局动画与实际滚动完成谓词后才测量，仍要求可见锚点偏移 <=1px。模型菜单原精确宽度在动画终点前读为 255.9999847；等待有限 Animation.finished 后仍保留精确 256px 断言。原始失败分别保留于 renderer-after-11.log 与 renderer-subpixel-initial.log。

## 文档完成检查回执

工作台阅读/限高焦点正文 → docs/README 的既有阅读摘要与本票 → 同批同步，AGENTS → docs/README → workbench 独立读回完成。路径与引用、语义同步、归属与权威、引用方向、生命周期、当前入口、新会话读入、历史保留八项均通过；无迁移或替代链，本次没有改写已归档正文。机械检查 277 文件 0 问题。

最终静默焦点图四组记录与窄暗色实际看图核对中，窄暗色焦点环、工具行和输入区均正常；cap 400px、聚焦目标 y=624—648、组 y=248—648、外层 y=48—664，四组相同且无横向溢出。最后 Vite PID 69790/端口 57019 已发 SIGTERM、原命令退出 143，随后 PID 和监听均消失；命名浏览器实际返回 Browser closed。真实 Electron/Sidecar 10 条测试退出 0，最终进程审计无本票实例；未处理用户已有 Coko。
