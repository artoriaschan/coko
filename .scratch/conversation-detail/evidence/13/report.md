---
kind: evidence
description: "最终集成对象的 AC-01—25 覆盖、组合回归、源码对照、原生产物与清理回执。"
lifecycle: active
---

# 13 集成验收回执

## 对象、范围与当前状态

2026-11-04，隔离工作树 `/tmp/coko-conversation-detail/ticket-13`，分支 `codex/conversation-detail-13`。干净起点为集成 `22a17fb1f1e288adc9e687ce816bec715316ba28`；所有 01—12 的产品提交均为祖先，见 [逐票祖先核对](dependency-ancestry.json)。逐票读取实现、当前消费者、测试和证据后才认定依赖能力已集成，没有仅按 Closed 字段判断。02 的 `d50e393` 已补齐自身 Inspect/shimmer/reduced-motion/390/键盘证据，本批关闭的是 02 自身功能状态。

最终产品源码为 **`f9e34e87a2d3cec4e3061d45614d9ed7c036e0d5`**：`f31dd346` 补齐文件语言/字体及组合检查，`925abb63` 修正上下文原生夹具，`f9e34e87` 集成独立诊断的完整关闭后重开修复。后续文档、tracker 和证据提交不改变该产品树。规格继续 `approved`，实施为已实现且本地联合验证完成、**等待独立 Standards/Spec 复审**；13 不关闭，整份规格不标 delivered。未 push、PR、合并 main、发布或运行 hosted CI。

参考锁定 DeepSeek Harness `8bd073392eef6f54e921a093b95076248eb08cbb`。保留 01—12 同源有效证据；13 修改文件语法/字体后刷新对应文件对照，修改隐藏后重开生命周期后增加最终原生重开证据。没有运行参考完整 Host，不把组件装配图称为参考 App 录制。

环境：macOS arm64、Node 26.10.0、pnpm 12.15.0、Vitest 5.0.3、React 19.3.0；原生 Electron 41.0.3、Chromium 146.0.7680.80。frozen install 通过，Electron 安装产物用 Node 24.15.0 安装脚本修复；依赖版本未升级。`@streamdown/code` 2.0.0 与 Shiki 4.5.0 原已安装/选型，ui 仅直接声明同一 Shiki 版本以使用公开 CSS-variable theme API。

## 本票发现与修正

1. **可实现的文件语言与字体遗漏。** 参考 `tool-fs/read.ts` 由实际路径扩展名产生语言提示，`read-card-model` 传入 ReadBlock；DiffBlock 也由路径产生标签。Coko 已有路径足以做到，不接受旧 05 报告“缺少 metadata 所以一律 code”的解释。现在读取使用参考短标签、同一扩展名表和语法规则（JS 家族采用 TypeScript grammar），未知后缀保留纯文本；写入/编辑只补路径标签，不重构缺失文件。文件局部字体使用已有对话系统文字/SF Mono 优先栈。原始文本、复制、行号、编号 diff、收据和窗口提示不变。
2. **延迟语法加载不能清空选区。** 在真实 App 的首个纯文本 DOM 出现时选择内容，真实异步 grammar 加载后仍保留选区、横滚、正文实体和结算后的手动开合。仅在当前代码区域内保存/恢复字符位置，卸载和过期请求不写入新视图。没有重挂载整条工具来着色。
3. **完整关闭后的组顶部初始化。** 旧断言偶发得到 496 而非 0；独立诊断用 `group.hidden === true` 的完成屏障得到确定性红例，并最小化到 15 条折叠工具。顶部请求原本在正文仍为 display:none 时被消费，Chromium 恢复旧位置。现在等 `!bodyHidden` 再消费请求；不改变跟随、锚点、焦点、动效时长或 overflow。详见 [独立因果诊断](reopen-diagnosis.md)、[红](reopen-red.log)、[绿](reopen-green.log)、[26 条组合](reopen-two-file.log)与[过程 21 条](reopen-groups.log)。
4. **原生夹具跟上真实入口。** 空 New chat 没有 Session ConnectionStatus，相关夹具改等实际工作台，发送后再核对连接；后台 Run 正常完成后，按整轮→组→工具展开。Trace 的 full-access 仍经风险确认按钮，未绕过授权。上下文探针实际返回 window=40000、warning=12000、threshold=32000、tokens=11988，因此 normal 正确；[原始 API](context-before.json)证实旧夹具低于预警线。夹具在模型边界明确报告 input=13000/output=3500，新增实际 API 16500/12000/32000 断言，原 warning 业务断言保持。

文件红绿证据：[语言标签](file-language-red.log)、[精确双主题色](file-color-red.log)、[字体栈](file-font-red.log)、[移除选区恢复时的真实红例](file-selection-red.log)及[文件/组合 16 条最终检查](file-joint-final.log)。颜色断言取参考字面值，不只检查“存在 span”。

## 检查命令、选中数量与来源

所有命令从本工作树根执行。下表的 R、S、N 标记供覆盖矩阵引用；没有零选中或全部跳过的通过项。

| 标记 | 精确命令 | 对象、实际数量与退出码 |
| --- | --- | --- |
| I | `rtk pnpm install --frozen-lockfile` | 起点及同版本 Shiki 直接声明后均退出 0；锁文件校验通过 |
| R | `rtk proxy pnpm run test --project desktop-renderer apps/desktop/src/renderer/features/conversation apps/desktop/src/renderer/features/right-panel apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/sidebar/conversation-search.browser.test.tsx` | 最终 f9e34e87，41 文件 **354/354**，退出 0；[日志](renderer-final.log) |
| R-joint | `rtk proxy pnpm run test --project desktop-renderer apps/desktop/src/renderer/features/conversation/file-tool-details.browser.test.tsx apps/desktop/src/renderer/features/conversation/integrated-detail.browser.test.tsx` | 文件最终字体/grammar 树，2 文件 **16/16**；其中新增组合 7 条、文件 9 条；退出 0。[日志](file-joint-final.log)，最终 R 再完整覆盖 |
| S | `rtk proxy pnpm run test packages/ui/src/guards/style-guard.test.ts packages/ui/src/app-frame/app-frame.browser.test.tsx packages/ui/src/tool-card/tool-card.browser.test.tsx packages/ui/src/markdown/markdown-renderer.browser.test.tsx packages/i18n/src/index.test.ts packages/i18n/src/domains.test.ts apps/desktop/src/renderer/features/conversation/timeline.test.ts apps/desktop/src/renderer/features/conversation/process-groups.test.ts scripts/browser-deps.test.ts` | 文件最终字体树，9 文件 **91/91**，退出 0；[日志](shared-final.log)。f9 仅改变组初始化时机，上述共享几何/字典/纯投影没有改变；其真实消费者由最终 R/N-flow 复核 |
| S-guard | `rtk proxy pnpm run test packages/ui/src/guards/style-guard.test.ts` | 最终 f9，1 文件 **40/40**，退出 0；[日志](style-final.log) |
| N-base | `rtk proxy pnpm run test --project desktop-e2e apps/desktop/e2e/reading-position.e2e.test.ts apps/desktop/e2e/chat.e2e.test.ts apps/desktop/e2e/approvals.e2e.test.ts apps/desktop/e2e/terminal-details.e2e.test.ts apps/desktop/e2e/images.e2e.test.ts apps/desktop/e2e/recovery.e2e.test.ts apps/desktop/e2e/plan.e2e.test.ts apps/desktop/e2e/jobs.e2e.test.ts apps/desktop/e2e/subagents.e2e.test.ts apps/desktop/e2e/teams.e2e.test.ts apps/desktop/e2e/schedules.e2e.test.ts apps/desktop/e2e/handoff.e2e.test.ts apps/desktop/e2e/rewind.e2e.test.ts apps/desktop/e2e/goal.e2e.test.ts apps/desktop/e2e/hooks.e2e.test.ts apps/desktop/e2e/commands.e2e.test.ts apps/desktop/e2e/context.e2e.test.ts apps/desktop/e2e/references-drafts.e2e.test.ts apps/desktop/e2e/compaction.e2e.test.ts apps/desktop/e2e/trace.e2e.test.ts apps/desktop/e2e/search-details.e2e.test.ts` | 21 文件 37 条：**33 通过、4 失败**。Refs 3 条使用运行前已装载的旧 startup helper，context 1 条为上述真实 11988<12000。保留[原汇总](electron-expanded-initial.log)，绝不称为整组通过 |
| N-artifact | `rtk proxy pnpm run test --project desktop-e2e apps/desktop/e2e/chat.e2e.test.ts apps/desktop/e2e/mcp-browser.e2e.test.ts apps/desktop/e2e/context.e2e.test.ts apps/desktop/e2e/references-drafts.e2e.test.ts` | f31 产品树的当次编译产物，4 文件 12 条：**11 通过、context 1 失败**；Refs 3 条已通过，新增真实 read grammar/原字节和 MCP 全屏边界已通过。[日志](electron-artifact-final.log) |
| N-context | `rtk proxy pnpm run test --project desktop-e2e apps/desktop/e2e/context.e2e.test.ts` | `925abb63` 的字面用量夹具与实际 API，**1/1**，退出 0；[日志](context-final.log) |
| N-flow | `rtk proxy pnpm run test --project desktop-e2e apps/desktop/e2e/reading-position.e2e.test.ts apps/desktop/e2e/chat.e2e.test.ts apps/desktop/e2e/approvals.e2e.test.ts apps/desktop/e2e/terminal-details.e2e.test.ts apps/desktop/e2e/mcp-browser.e2e.test.ts` | 最终 f9 当次构建的真实 Electron/Sidecar，5 文件 **13/13**，退出 0；[日志](electron-flow-final.log) |
| T | `rtk proxy pnpm run typecheck` | 最终 f9，退出 0；[日志](typecheck.log) |
| D | `rtk proxy pnpm run check:docs` | 最终 279 个 Markdown、0 问题、退出 0；[最终文档日志](docs-final.log) |

N-base 中 19 文件的 33 个成功场景、N-artifact 中修正后的 Refs 3 条和新增 MCP 1 条、N-context 的 1 条，构成 **22 文件、38 个不同原生场景**的有效成功覆盖。重复的 chat、context 失败与 N-flow 重验均不相加。f9 只修复完整隐藏后重开，受影响的组合路径由 N-flow 重建并复核，其余业务事实沿用相同源码检查；手动 native CDP 另直接验证该修复。未声称某一条命令得到了 38/38 全绿。

源码 lint/format 与提交 hooks 通过；最终 reader 两文件另运行 `rtk proxy pnpm exec oxlint apps/desktop/src/renderer/features/conversation/process-timeline.tsx apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx` 和同文件 `rtk proxy pnpm exec oxfmt --check ...`，均退出 0。没有 `.github` 工作流可供本地声称 CI，通过结果均为本机选定范围。

## AC-01—AC-25 最终覆盖矩阵

R、S、N 的命令/对象/数量定义在上表。每行均由最终 R 覆盖相应真实 App 消费者；所属票的历史视觉/宿主证据仅复用未被本票失效的部分。

| AC | 负责票 | 实际场景与当前证据 |
| --- | --- | --- |
| 01 | 01—07、13 | 48 张同环境 App/参考源码图、[计算样式](composed-metrics.json)，用户气泡、思考、工具、文件、终端和通用材质；S 外围几何。参考完整 Host 未运行，整页 y 坐标不作为组件夹具的像素等价结论 |
| 02 | 03、13 | R `process-groups`：同 Run 思考/read/bash 平铺、无组头或 cap；新组合终端→图片亦在运行中保持两组平铺 |
| 03 | 03、13 | R 阶段回复截组；新组合和原生实际 read→阶段回复→bash→最终回答保留全部三段回复 |
| 04 | 03、13 | R 正常结束默认整轮收起，历史组初始收起；native whole→group→tool 键盘实测，阶段和最终答复保留 |
| 05 | 03 | R 无最终答案仍可折叠、纯回复无空控件；03 对应历史源证据仍有效 |
| 06 | 03、10、11 | R 已送达用户/团队输入与早期快照揭示输入的真实顺序，整轮不合格；Queue 未送达项不冒充时间线输入 |
| 07 | 03、08、09 | R failure/aborted/paused/interrupted、无结果/待确认及 Retry/Continue 资格；N-flow chat stop/retry 与 approvals，N-base recovery/Job |
| 08 | 03 | R/S 按调用身份计类别、同数排序、失败仍计一次、不作为成功次数；03 同源组头图 |
| 09 | 01 | R 空白思考、单行未完成、已完成首行预览、完整紧凑 Markdown与结算身份；01 视觉继续有效 |
| 10 | 04—07、13 | R 文件 9/组合 7、终端/搜索/结构化/图片；N-flow 实际 read、命令、MCP 图片；最终文件语言/字体修正，参考原语仍按真实适配字段比较 |
| 11 | 02、04—07 | R 不完整专用字段、未知/MCP、空数据与失败保留全 IO/details；结构化真实请求字段；没有虚构完整文件/统计或文件跳转 |
| 12 | 01、02、04—07、12、13 | R live→committed 只保留同一实体、选区、开合、局部滚动；实际文件 lazy grammar 也保留选择。7 条联合场景覆盖五类专用高度及门户 |
| 13 | 08、10 | R approval/denial/sandbox/Hook/子代理冒泡和焦点接管；N-flow 原生审批/原生命令只允许一次，N-base 子代理和 Hook |
| 14 | 08 | R Outcome Confirmation 独立可见、真实状态；N-base recovery 的崩溃/重启/确认入口，未伪造成功 |
| 15 | 09、10 | R `business-timeline`/collaboration/Plan/Jobs/Goal/Hook/Team/Schedule/Handoff，父子事实隔离与有效主路由、只读 inline；N-base 对应原生业务入口 |
| 16 | 01、09、11 | R 命令展开、文件引用、用户/工具图片、用量与压缩；N-base commands/compaction，N-artifact Refs 与附件 N-base images |
| 17 | 11 | R 历史/嵌套被回退区间、归档/removed/approval/运行限制；N-base rewind 验证文件、不可变前缀、原始命令草稿/Fork |
| 18 | 02、06、11 | R Inspect→现有 Trace，历史按 Session 真实 facts；02 最终键盘补验；native CDP Inspect→实际追踪 tab 与 N-base Trace |
| 19 | 12、13 | R 外层跟尾/向上暂停/返回、结算与结束；五类专用增高不拉动 held 外层。N-flow 实际滚轮和 SQLite 重启 |
| 20 | 12、13 | R 400px/50vh cap、独立内部跟随、渐隐、边缘传递；实际完整关闭后的 [native 268→0](native-reopen.json)；160ms 反向路径和完成屏障都覆盖 |
| 21 | 11、12、13 | R existing afterSeq 回放/受控更早快照、稳定工具正文、真实新边界重新计算资格；N-flow SQLite 重新打开，未添加分页协议 |
| 22 | 03 | R 已知/未知起止、断线冻结、真实状态播报与不连续播报计时；没有用工具首条时间代造 Run 起点 |
| 23 | 01—03、07、08、12、13 | R 三层焦点/手动收起/门户返回目标/超高思考、reduced-motion；新组合正常/减少动效；native Enter/Space 实际开合与 Trace |
| 24 | 01—12、13 | R 明暗、zh/en、390 主区、长路径/错误/代码/空结果/失败；48 图八环境 680/326 真实列、native 390 主区，无页面横向溢出 |
| 25 | 01—03、09—13 | R 顶栏、composer、侧栏 Search/NewChat（含 IME）、Agents/Team 子 Session；S AppFrame/共享 ToolCard/Markdown、字典与守卫；N-base 现有桌面消费者 |

## 视觉、字段与交互裁决

`capture.py` 经命名 agent-browser 会话 `coko-integrated-13` / `coko-reference-13` 挂载真实 App 和锁定源码，八组为 light/dark × en/zh × 1000/390 CSS px 主内容、1200 高、DPR 1、标准文档模式。参考 active 宽轴为 `clamp(680px,64vw,920px)`，与 Coko 实际容器轴比较；实际消息列同为 680/326，卡宽 676/322，均无整页横溢。748 仅旧手动夹具/fallback，不用它代替实际 active 宽度。保存 [App 装配](main.txt)、[服务](serve.txt)、[参考装配](reference.txt)、[参考服务](reference-serve.txt)与[捕获脚本](capture.py)；两个服务使用独立 Vite cacheDir，避免 React 版本缓存互相污染。

48 PNG 为每环境 App running/details/completed/historical 与参考 running/details。逐张检查代表性亮色宽图、暗色窄图及完成/组头；用户气泡 14/22、10×16 padding、R20；工具文字 13/24、前导图形/摘要轴；文件 11/19、工具栏 10/18/8/22、24px 控件、R16；read 卡高度 106 与 terminal 高度 81 在等价样例中一致。实际 computed `cornerShape` 均 `superellipse(1.5)`；明暗背景、透明边框、shadow 与 padding 见 JSON。新 read 的 keyword/string/constant 精确对照参考 CSS-variable 色值，原生也断言 keyword 色。

参考原语装配没有 Coko 的外壳/消息动作/Run 控件，绝对 y 坐标不同；不能据此声称整页像素复刻。完整分组和消息节奏另保留 01/03 的实际源 ChatGroupSeat/消费者证据，并由 R 的几何及交互断言复核。参考 generic 标题按实际 `toolRowModel` 使用 generic title + wire-name summary，旧手动标题示例不是权威。Coko 独有审批/恢复/Plan/Goal/Job/Hook/协作/触发记录按实际事实与既有路由验收，不硬造参考对应物。

数据差异单独裁决：write 未记录旧文件/是否创建，不画虚构新建 diff；edit 保留 Coko 真正编号 diff/收据；搜索没有参考的结构化 matches/counts，不从有歧义文本凑 file 分组/总数；原始输入/输出仍完整。已知路径语言则是可实现显示能力，本票已补齐，不能再列为数据限制。无宿主打开回调时路径为可读标识。真实缺失 Run 时间/退出元数据不补造。解码图片尺寸来自实际 bitmap；原生 MCP 预览使用当前编译产物核对全屏边界。

原生补验使用命名 `coko-native-integrated-13`、当前真实 Electron/Sidecar、临时独立用户目录与 faux 模型边界；真实 read 文件、真实 bash、实际 Allow once、SQLite/Trace 均未替换。先前 f31 的 [390 指标](native-metrics.json)保留读取颜色、字体和无溢出；f9 在 24 个真实 read 的 cap 内从 268 滚动，等真正 hidden 后键盘重开，实际回到 0，见 [最终重开](native-reopen.json)、[截图](native-reopened-top.png)、[最终 read](native-final-read.png)。Enter/Space 开合、门户/重试/只读由 R/N 覆盖；手动 Inspect 进入真实 Trace 图为 [native-inspect-trace.png](native-inspect-trace.png)。截图不替代行为断言。

系统字体栈在同机参考/App 中读回一致；未分发字体文件。一次 CSS 平台字体探针在容器返回空列表，不代表没有字体，也不据此声称物理 SF Mono 字体文件可用；证据证明的是实际 computed 栈、字号和同环境结果。原生指针、标题栏/窗口材质、发布打包产物、真实模型与 hosted CI 未验证；后台 CDP 不抢前台，也不能冒充 OS 真实指针。

## 保留的失败、异常与验证边界

- 首批新联合测试的 7 个失败来自不完整 fixture run_start、尚未出现的 DOM、以及已经自动回底后仍寻找 Return to bottom。按实际生命周期修正夹具后 7/7，未改生产行为；后续增加真实 cap 中间动画反向和严格全文展开断言。
- [renderer-initial.log](renderer-initial.log)：352/354，图片 gap 在 AppFrame 初始 wide→narrow 的真实 grid 过渡中测得 -64，截图稍后已正常。夹具现在等实际有限 Animation.finished，保留 10px gap 和 390px 断言。另有设置语言切换后 Escape 未返回的单次异常；[原失败配对](aggregate-failure-pair.log) 35/35，后续必要最终汇总全绿。没有证明该单次异常的根因，不与 IME 混为同一原因。
- [renderer-reopen-anomaly.log](renderer-reopen-anomaly.log) 与 [reopen-controlled.log](reopen-controlled.log)：真实 496≠0，已通过完成屏障、最小化、因果修复与最终 R/native 268→0 收敛。探针改变时序后 26/26 不是修复证据；真正红绿在独立诊断中。
- [electron-initial.log](electron-initial.log)：13 文件 25 条，22 成功、startup/隐藏工具/一次 reading wheel 失败。前两类是上述夹具入口，reading 单文件 [最小化](reading-diagnosis.log) 1/1 和后续 N-base/N-flow 均通过；不能从该单次通过推断早期 wheel 失败的根因，原始证据保留。
- 12 的历史 NewChat IME focus 异常及独立 d3108d0 诊断完整保留在 [12 报告](../12/report.md#保留的汇总异常与定位限度)。最终 R 仍包含 NewChat 原断言；全绿不表示历史异常已得到因果修复。

R 的 `createFixtureChat` 只替换可控协议/网络输入，真实 store、App、投影、组件、DOM/几何/选择和动画保留；N 替换模型响应、测试时钟及系统文件选择边界，其后的 Sidecar/工具/SQLite/原生剪贴板/权限/进程真实。原生终端复制用例恢复了系统剪贴板；不输出凭据或登录数据。

## 文档与清理

当前行为归属既有 `docs/subsystems/workbench.md`，字体/语法 token 归 `docs/tech-stack/ui-design-system.md`，相同 Shiki 直接声明归 `docs/TECH_STACK.md`，`docs/README.md` 同步摘要。正式文档只链接正式正文与源码，不依赖本任务材料。保留 05 当时报告，以上追加更正不会改写旧结论；规格 approved 与票 Status 分拣角色保持。

从 AGENTS→docs/README→workbench/UI 规范读回，路径/引用、语义同步、权威归属、引用方向、生命周期、当前入口、新会话可读性和历史保留八项均核对；没有新增正式目录/ADR 或替代链。最终机械检查见 D。

[清理回执](cleanup.json)与[首轮原生清理](native-cleanup.json)记录三命名浏览器实际 Browser closed；两个 Vite 收到 SIGTERM 后命令退出 143，PID 和 60177/60180 listener 消失。最终 Electron 88578、Sidecar 88605、控制进程 88534 全部退出，63182 不再监听，临时用户目录已删除；原生自动化由现有 dispose 等待退出。原始日志仅规范化 EOF 空行，仓库外保留原字节备份，不改变命令/数量/结果。工作树保留给主任务合入与正式复审，未删除其他工作树、用户数据或停止无关应用。
