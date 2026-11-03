---
kind: evidence
description: "协作与触发消息适配的真实 App、Sidecar、Electron、视觉与清理证据。"
lifecycle: active
---

# 协作与触发消息适配

## 对象与范围

- 源码对象：`codex/conversation-detail-10` 的 `3b7878840f963f4ccb11deb25c99181d794f1ede`；已合并集成分支 `59552fdb08e1a1ce87010cd60087f56a2856c8fe`（01—08，含审批状态）。后续本报告提交只更新证据与文档入口。
- 参考仓库：`/Users/artorias_chan/Workspaces/agent/deepseek-harness`，现场核对 HEAD 为 `8bd073392eef6f54e921a093b95076248eb08cbb`。对应物沿用实际 `tool/components/ToolRow`、`tool/toolviews/GenericToolCard` 的摘要行、手动开合、通用输入/输出和 Inspect；Coko 特有团队、任务、定时投递、交接保留原业务图标与语义，采用局部紧凑行和结构化详情表面。
- macOS arm64，Node `v26.10.0`、pnpm `12.15.0`、Vitest `5.0.3`、Electron `41.0.3`、agent-browser `0.38.2`。Chromium Browser Mode 无头；Electron 默认 `COKO_E2E_BACKGROUND=1`。冻结安装成功；Electron 安装包缺少 dist，已把同版本41.0.3的04依赖缓存复制到本票自有依赖，没有修改版本或锁文件。
- 范围仅 renderer 展示与现有测试入口；无协议、数据库、Agent、团队、调度执行或权限规则新增。12的阅读位置算法未修改。

## 实现与回归

- AgentCard 改为 `row` / 手动展开，复用显式整轮 reset；保留真实 activity、agent_end 状态、用量、worktree、原有右栏路由。原始参数与全部文本、details、structuredContent、content 块可检查；Inspect 复用原按钮和根 Session Trace 回调，子时间线没有死入口。审批/确认元信息消费08的 ToolStateMeta/Detail。
- `TimelineView.entries` 由根、Agents、Team 调用方传入，`TimelineSessionContext` / `useTimelineSession` 提供 `{sessionId, entries, actionsDisabled}`；AgentCard/通知不再读取激活父 Session。子时间线没有可执行的 Retry。相同 Run/call ID 的父子开合与数据独立，原有审批冒泡与子 Session 只读约束保留。
- team_message 仅在宿主前置条目位置、messageId / from 均匹配时关联真实正文；批量消息各留自己的正文，用户原文按原顺序保留。任务快照可检查描述、owner、依赖、范围和原始状态。可见宿主输入继续截断过程并阻止整轮折叠，隐藏包装不增加用户气泡。
- schedule_fire 原始记录通常没有 runId：以真实 run_start.schedule 的 scheduleId + occurrence 对应投递，提取同一 Run 输入的标题和指令。只读取所属 Session 的列表；started 只表示投递。Handoff 来源、摘要、指令和失败信息可检查，打开/返回仍用原目标身份，展开不创建或发送内容。
- 红→绿：首条 App 回归先因 AgentCard `aria-expanded=true` 失败，再验证手动开合、真实完整输入输出与结算身份；团队正文回归先因无正文入口失败；批量宿主回归先只得到 `SECOND BODY`，修复后得到 `FIRST BODY, SECOND BODY`。真实 Electron 新增定时指令断言暴露缺少 runId 的关联，修复并验证。
- 首轮 Electron 两个旧用例直接点击整轮收起内的控件失败；按实际先开整轮/组后通过。团队行原 muted 对比度3.7056未满足既有4.5断言，使用局部 semantic secondary 后真实 Electron 明暗主题检查通过。保留原阈值与范围。
- 合08后扩大共享工具检查发现旧 `Not finished` 断言与08真实 `No recorded result` 文案不符；仅修正该消费者断言。原失败完整保存在[合08后的失败日志](renderer-after-08-stale-expectation.log)，最终检查见下表。

## 执行结果

| 命令与原始记录 | 选择范围 | 结果 |
| --- | --- | --- |
| `rtk pnpm install --frozen-lockfile` | 本票隔离工作树 | exit0 |
| [renderer-final.log](renderer-final.log) 第一行的完整 `rtk proxy pnpm run test` 参数 | 13 files：真实 App协作、Agent卡、团队、审批状态、交接、过程、Agents/Team消费者、冒泡审批、工具摘要/结构化详情、时间线与样式守卫 | exit0，133/133 passed，23:28:36 |
| `rtk proxy pnpm run test tests/integration/sidecar-subagents.test.ts tests/integration/sidecar-teams.test.ts tests/integration/sidecar-teams-tasks.test.ts tests/integration/sidecar-schedules.test.ts tests/integration/sidecar-handoff.test.ts` | 5个真实 Sidecar 文件，现有协作/任务/调度/交接路由 | exit0，32/32 passed，23:21:00；后续仅renderer展示和测试断言变化，服务端代码未变 |
| [electron-final.log](electron-final.log) 第一行完整命令 | 当前构建：subagents、teams、schedules、handoff；真实 Sidecar+Electron，faux模型，文件写入/父级审批/停止/团队正文/调度指令/交接摘要与导航 | exit0，4 files、5/5 passed，23:27:52 |
| `rtk proxy pnpm run typecheck`，[typecheck.log](typecheck.log) | 当前源码与测试 | exit0 |
| `rtk proxy pnpm exec oxlint`（本票13个TSX/TS核心改动文件） | Agent/通知、业务行、App测试、timeline/context/view、工具原始IO | exit0 |
| `rtk proxy pnpm run check:docs` | 正式文档、tracker与证据 | exit0，273个Markdown，0问题；见[docs.log](docs.log) |
| `rtk git diff --check` | 当前差异 | exit0 |

所有结果为本地相关范围，未运行全仓测试、真实模型或托管CI，不声称最终13票联合验收通过。真实指针、原生标题栏与红绿灯未验证；本票交互为静默CDP/Browser Mode与后台Electron。

## 视觉与键盘证据

- [capture.py](capture.py) 使用命名会话 `coko-collaboration-10` 驱动实际 App 装配；模型/协议边界采用真实形状内存fixture，未用静态组件替代App。调用方夹具与服务配置保存为[fixture-main.txt](fixture-main.txt)、[fixture-server.txt](fixture-server.txt)。独立服务端口63900仅为本次实际分配值。
- `rtk proxy python3 .scratch/conversation-detail/evidence/10/capture.py` exit0：24 PNG（collapsed / expanded / sources）与[8组指标](metrics.json)。light/dark × zh/en × 1280×900 / 390×900，DPR1；正常main1000px，窄main390px，全部document.scrollWidth等于viewport。每组用focus/Enter展开定时来源。
- 已读回正常和窄窗口实际图，检查正文、换行、Agent结果、用量、worktree、团队正文、任务完整快照、通知与Handoff操作；[正常展开](light-en-1280-expanded.png)、[窄窗口来源](dark-zh-390-sources.png)。Inspect为与通用工具同一SVG/按钮。
- 参考的实际原始ToolRow组件截图与样式测量沿用共享调查产物 `/tmp/coko-conversation-detail/reference-harness` 的main748/390基线；本票对照局部字体、14/16px前导框、24px行、R16详情、通用IO和Inspect。Coko独有来源行按相同视觉体系适配，不宣称参考完整Host或所有聊天生命周期截图已逐像素通过。

## 文档与清理

| 正文变化 | 所属正文 | 动作与读回 |
| --- | --- | --- |
| Agent手动详情、原始IO与Session事实 | docs/subsystems/subagents.md、workbench.md | 原地修订；AGENTS→docs/README→正文入口仍可达，身份/只读/状态与源代码一致 |
| 团队正文、任务快照与工具开合 | docs/subsystems/teams.md | 删除“正文不显示/错误默认展开”旧断言，保留ADR权限与宿主边界 |
| 定时指令与归属 | docs/subsystems/schedules.md | 说明真实关联、Session限定与started事实，既有调度操作不变 |
| 交接详情与既有动作 | docs/subsystems/handoff.md | 来源/失败详情与打开/返回语义同步 |

文档未改路径或状态，无新增目录职责；正式材料没有具体scratch反向依赖，导航摘要仍成立。生命周期八项检查（引用、语义、归属、方向、生命周期、当前入口、新会话读入、历史保留）均通过，无归档变更。

[cleanup.json](cleanup.json)：命名浏览器close exit0；视觉服务37338收到Ctrl-C后实际exit130；最终Electron命令exit0并由既有harness等待所属应用/Sidecar退出；按本票精确进程入口重新读取，remainingOwnedProcesses=[]。未关闭其他代理或用户的运行实例。没有推送或PR。

集成复核：仅规范化三份终端日志的尾随空格和末尾空行，测试事实未修改。原始日志另存于 `/tmp/coko-conversation-detail/raw-10-logs/`；产品源码与已验证对象保持一致。
