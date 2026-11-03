---
kind: evidence
description: "Plan、Goal、后台任务、Hook 与 Run 用量条目的真实 App、Sidecar、Electron、视觉及清理证据。"
lifecycle: active
---

# 计划、目标与后台执行条目

## 对象与范围

- 最终产品源码：`362798ac3fe1eb764d9d2774a4769802434051f9`（`codex/conversation-detail-09`）。初始干净基线为 `7c6495166a455504c4245df7536f75780c3767ef`，通过 `1d417d4` 合入包含 ticket 11 的集成对象 `86167276d62b3e06620e5ba942d06f57933ca04a`；冲突同时保留历史 Run、connected=false、Inspect 与本票 historical/readOnly 事实。后续交付提交仅更新证据和票。
- 参考现场核对：`/Users/artorias_chan/Workspaces/agent/deepseek-harness` HEAD 为 `8bd073392eef6f54e921a093b95076248eb08cbb`。结构化详情的实际 `ToolDetails.module.css` 使用 13px/20px、R16、0.5px 描边、4px 外边距和 10px/14px 内容间距；DisclosureRow 为 16px 绘制框、14px 图标。Coko 特有阶段、预算、Hook 结论与 Job 状态按自身记录保留，未移植参考业务引擎。
- 环境：macOS arm64，Node v26.10.0、pnpm 12.15.0、Vitest 5.0.3、Electron 41.0.3。`rtk pnpm install --frozen-lockfile` exit0；Electron 缺少 dist 的安装问题通过 `rtk proxy /Users/artorias_chan/.nvm/versions/node/v24.15.0/bin/node node_modules/electron/install.js` 修复，版本与锁文件不变。
- 范围：业务时间线条目、其现有路由和必要调用方事实、局部字体与表面；没有修改协议、数据库、预算/Goal/Hook/Job 状态机、独立业务页或输入区 dock 几何。未修改 ticket 12 的滚动算法。

## 实现与回归

- Plan 卡按当前渲染 Session 的条目判断修订替代；主会话由调用方的 `openPlan` 路由打开既有 Plan tab，即使该 tab 已选中但右栏被关闭也能重新打开。子会话、历史和会话只读上下文就地检查实际 Markdown 快照，不显示父会话的计划或执行操作。
- `TimelineSessionContext` 增加明确的 historical/readOnly 与 owner 的 Plan 路由。运行中与待审阅时禁用 checkpoint 动作不代表会话只读，二者不混用。回退历史继续继承 ticket 11 的 Run、Inspect 和禁止 mutation 的约束。
- Goal 行只读 `goal` 快照的九阶段；Run completed 不推导 Goal complete。预算、证据、暂停/恢复/完成/取消仍归原 dock。用量行按调用方真实 entries 与 Run ID 汇总，未定价保持未定价；Agents/Team 继续省略逐轮用量的原有选择。
- Job chip 和通知按当前渲染 Session 的快照及起止条目配对。Run 结束不表示后台 Job 完成，后续失败更新同一 chip；缺少起止事实不补造状态。子会话、历史、归档与被移除工作目录的入口复用既有输出阅读器及分页 API，只读且没有 stop/kill；正常主会话保留 Jobs tab 路由和停止能力。
- 永不独立显示的 job_start/job_end 不截断相邻过程。曾显示的 proposed Plan 是真实审阅阶段边界，结算后保留阶段分界，避免重挂载焦点所在工具；回归断言组数、展开正文 DOM 和键盘焦点均保持。可见 Plan、Goal、Job 通知、Hook 与用量行都在过程隐藏之外。
- 业务行采用局部 13px/20px、14px 语义图标；Plan 卡采用 R16 轻量详情表面；长反馈、目标、原因与 Hook message 不丢失。顺带修正 ticket 10 Agent/Handoff 两行没有定义的 text-conversation-row 类，限定到同一业务行类，没有全局字体调整。
- TDD：首轮 actual App 回归在修复前得到 2 个过程组而期望 1 个，证明非显示 Job 元数据误拆组；计划导航的 actual App 键盘回归暴露关闭后选中 tab 不能再打开，修复后通过。另有初始子会话用量预期与原有过滤不符，已撤回该错误预期，改在真实回退历史验证；不把夹具错误计为产品缺陷。
- 旧 Electron 用例先因 New chat 没有 Session connection status 失败；改等真实 Add project UI 后进入 Session，再在实际 Session 等连接。Full access 沿现有确认对话框操作。Jobs 旧用例未展开三级过程导致 chip 不存在，改按真实层级逐一展开；未改变折叠默认值或放宽业务断言。

## 执行结果

日志第一行保留完整命令参数；仓库日志仅去 ANSI 控制序列、行尾空白并补末尾换行，原始输出保留在 `/tmp/coko-conversation-detail/raw-09-logs/`。

| 命令或记录 | 覆盖范围 | 实际结果 |
| --- | --- | --- |
| [final-renderer.log](final-renderer.log) 的 `rtk proxy pnpm run test` | 13 个文件：16 个真实 App 业务组合场景、历史/只读、Plan、Job、Hook、Goal/Todo dock、过程与身份、右栏 Job、协作共享行、样式守卫、字典 | exit0，151/151 passed；开始 23:47:46 |
| [final-electron.log](final-electron.log) 的 `rtk proxy pnpm run test` | 当前构建的 Plan、Goal、Jobs；真实 Electron + Sidecar，faux 模型；计划审阅/编辑/批准、Goal 多轮预算及证据、Job 停止/通知/重启输出恢复 | exit0，3 files，4/4 passed；开始 23:47:48 |
| [final-sidecar.log](final-sidecar.log) 的 `rtk proxy pnpm run test` | 真实 Sidecar 的 Plan、Goal、Job、Hook 生命周期现有契约 | exit0，4 files，34/34 passed |
| [final-typecheck.log](final-typecheck.log) | `rtk proxy pnpm run typecheck`，当前源码与测试 | exit0 |
| [final-lint.log](final-lint.log) | `rtk proxy pnpm run lint`，本票 17 个 TS/TSX 改动文件 | exit0 |
| [docs.log](docs.log) | `rtk proxy pnpm run check:docs` | exit0，275 个 Markdown，0 问题 |
| [format.log](format.log) | `rtk proxy pnpm run format:check`，本票17个TS/TSX源文件与1个CSS文件（Markdown由formatter配置排除） | exit0，18 files formatted |

## 视觉与交互

[fixture-main.txt](fixture-main.txt)、[fixture-server.txt](fixture-server.txt) 在仓库外装配未替换的实际 App、stores、timeline 与 dock；仅协议/HTTP 后端使用已有内存边界。不是静态组件示意，也不冒充真实 Sidecar。重录于最终产品源码，agent-browser 静默 Chromium，DPR1，viewport1000×900 与 454×900；454 的消息左右 32px 后为 390 CSS px 可用内容。Browser Mode 另在 390×900 的更窄整窗验证换行与键盘。

- 明暗主题、zh/en × 两档宽度共八张截图：[light-en-1000](light-en-1000.png)、[light-en-454](light-en-454.png)、[light-zh-1000](light-zh-1000.png)、[light-zh-454](light-zh-454.png)、[dark-en-1000](dark-en-1000.png)、[dark-en-454](dark-en-454.png)、[dark-zh-1000](dark-zh-1000.png)、[dark-zh-454](dark-zh-454.png)。[metrics.json](metrics.json) 保存实际字号/行高、主区及业务行宽度/scrollWidth；所有业务行均为 13px/20px，主区无横向溢出。
- [窄宽度 Goal 预算](dark-zh-454-budget.png) 保留原有 dock、预算与控制，消息区没有吞掉业务操作。Coko 特有行按参考同一排版与容器规则适配，不声称参考有相同九阶段/预算模型。
- [原生待审阅](native-plan-review.png) 与[批准并键盘重开 Plan tab](native-plan-approved.png) 来自最终构建的真实后台 Electron 和真实 Sidecar，[native-fixture.txt](native-fixture.txt) 保留隔离工作区与 faux 设置脚本。CDP port54186，1280×820 CSS px，macOS DPR2；实际 click 批准，等待 plan-card approved，关闭右栏，focus 计划入口、Enter，再等待右栏可见且 plan-tab approved 后截图。工具/计划焦点与审批入口在静默 CDP 中验证；未测真实鼠标命中、原生标题栏或红绿灯。
- 参考实际 source 的工具原语对照图来自既有仓库外 reference-harness；该组件基线不冒充参考整个 App。所需等价字体/容器/状态规则以锁定 source 为准，Coko 实际 App 和原生图已读回检查。

## 文档与入口读回

更新原有 [Plan Mode](../../../../docs/subsystems/plan-mode.md)、[Goal](../../../../docs/subsystems/goal.md)、[Jobs](../../../../docs/subsystems/jobs.md)、[Hooks](../../../../docs/subsystems/hooks.md) 和[工作台](../../../../docs/subsystems/workbench.md) 各自所属的时间线/界面段；未新建正式目录，正式导航路径不变。搜索时间线计划卡、job_start/job_end、Goal 时间线、Hook 时间线等语义消费者并同步；ticket 11 新 History 段保留。从 AGENTS → docs/README → 上述正文重新核对，生命周期 active、当前行为/目标设计归属、正式导航可达、历史记录与引用方向均通过；正式文档不反向依赖本票材料。

## 清理与交付限制

[cleanup.json](cleanup.json) 记录实际 PID 与隔离目录。两次 native 都确认 Electron 与 Sidecar 退出；最终 native 打印 NATIVE09_CLEAN_EXIT，发送 tty EOF 后命令 exit0。初次 native 因无 tty 的 stdin 已关闭，App 经 main Inspector app.quit 完成正常 shutdown，父脚本之后 exit13；确认进程不存在后删除其自有临时目录，没有把该轮脚本退出码说成通过。两个 agent-browser 会话均 close exit0，最终 Vite 自有命令 Ctrl-C exit130；port54160 无 listener、owned serve/native 进程均无残留。保留其他 ticket 的实例和数据。

本票只报告本地相关范围；没有 push、PR、发布、真实模型或托管 CI 验证，也不声明 ticket 12 或 13 的联合验收完成。后续产品、共享时间线/调用方或依赖改动会使相应证据失效。当前分支包含集成至 ticket 11 的事实，最终 tracker 回执见[实施票](../../issues/09-plans-goals-and-background-execution.md)。
