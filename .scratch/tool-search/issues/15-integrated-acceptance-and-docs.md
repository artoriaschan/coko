# 15: 联合验收与文档同步

**What to build:** 把各票的用户可见行为放在一起验收，并把当前行为文档同步到实现状态。确认没有配置 MCP 的用户一切照旧、Headless Run 与桌面行为一致，记录真实 provider 与原生层中未验证的部分。

**规格场景:** [spec](../spec.md) 的 AC-01 至 AC-23 联合复核，重点为 AC-23；用户故事 1 至 35。

**设计依据:** [design.md](../design.md) 第 8 节的验证映射与第 9 节的 ADR 判断。

**文档影响:** [MCP](../../../docs/subsystems/mcp.md)、[上下文管理](../../../docs/subsystems/context.md)、[分层配置](../../../docs/subsystems/configuration.md)、[子代理](../../../docs/subsystems/subagents.md)、ADR 0024 的 State Update 列举、承载 Provider 设置的当前文档，以及相关包 README 与条目载荷说明；需要时新增 ADR。

**Blocked by:** 04 关键词检索、查询语法与可见范围；05 目录预算降级与增量公告；06 MCP Server「始终加载」；07 全局开关的设置界面与项目收紧；08 乐观加载；09 重启、重试、压缩与断连后的已加载工具；10 回退、分叉与 Handoff 的加载边界；11 默认打开按需加载并迁移现有 MCP 测试；12 Provider 开关与 Messages、Responses 的原生写法；13 原生请求被拒时的开关提示；14 openai-completions 按 pi 目录使用原生写法

**Status:** ready-for-agent

**Closed:** true

- [x] 跨票联合场景：新会话搜索并调用 MCP 工具；之后重启、压缩、回退与分叉，已加载的工具符合各自的边界；子代理不受影响；关闭全局开关或 Provider 开关后恢复原有行为。
- [x] AC-23：中文与英文界面下，设置的 MCP 分区、MCP Server 编辑表单与 Provider 表单的标题、选项名与说明与 TS-27 一致；明暗主题与 390 CSS px 宽度下不重叠、不裁切。按 UI 调试约定静默验证，并说明哪些交互未在真实指针或原生层验证。
- [x] 真实 provider：默认开启的线路用真实 Key 跑 AC-02 与 AC-18，结果单独报告；需要用户提供 Key，没有 Key、未运行或未通过的报告为未验证。
- [x] 当前文档中“已连接 Server 的全部工具直接提供给模型”“用量计入全部 MCP 工具”等说法已改为实现后的行为；核对各票的文档改动一致，ADR 0024 的列举包含目录；判断“已加载集合从条目派生”与“按 Provider 的原生增量开关”是否提炼为 ADR。
- [x] `pnpm run check:docs` 通过，并从 AGENTS.md、docs/README 到正文依次读回，核验链接与语义；正式文档不链接任务材料。
- [x] 记录本地验证结果与未覆盖风险，区分已提交、已推送与未发布状态。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05 实施与联合验收：[完整证据](../evidence/acceptance.md)逐项列出 AC-01—AC-23、全部用户故事、当前本地检查和限制。前置 01—14 均已实际合入。新增修复审批等待期间用量提前采用新配置、原生历史定义漏计及自动压缩估算；正常链路使用真实 Sidecar，估算复用 pi 公共 transcript 规则，普通列表维持一次计数。
- 最终跨功能命令 A（见证据）12 文件 86/86；Browser 命令 B 3 文件 27/27；context/baseprompt 2 文件 13/13。新 native 历史定义自动压缩用例曾暂时恢复旧算法验证两例确实失败，随后恢复修复并在 A 中通过。类型检查退出 0。两项已证明为基线问题的 RunInput 顺序断言只调整 model_request 与 assistant 的顺序，保留完整序列和其他 before/steer 断言。
- 静默 Electron 使用本票独立数据根与 profile、后台 Forge、9222 CDP 和命名 agent-browser。12 个 en/zh × light/dark × 三处设置的 390×800 截图已逐张查看，标签、说明、控件无重叠和水平裁切；几何记录与截图位于 `/Users/chenzheng/Documents/Codex/2026-11-05/tool-search/`。没有更改产品样式来消除捕获差异。真实指针与原生标题栏未验证。
- 文档按既有正文同步 MCP、context、subagents、agent README、导航及 ADR0024 的目录边界；已加载事实的长期理由补入 ADR0003，Provider 策略归 MCP，未增加重复 ADR。ADR0024 保持 partial，设计稿保持 draft；规格保留 approved 基线并明确实现和本地验收完成，最终两轴审查由集成流程继续。
- 真实 Provider AC-02/18、缓存、费用与延迟未验证（未提供测试凭据）；未搜取用户存储 Key。AC-16 已补齐真实 Sidecar SQLite 触发器的提交失败；乐观加载精确中断仍通过公开 Runtime commit 重建接缝验证，未向 Sidecar 注入该精确进程崩溃。发布安装包和 CI 未验证；局部通过不表示全仓通过。最终文档、进程清理与提交检查如下文追加。

- AC-16 补验：`rtk pnpm run test tests/integration/sidecar-tool-search.test.ts` 最终 8/8；仅临时库触发器拒绝 `tool_load`，真实 Sidecar 工具结果已提交、加载记录不在库中可见条目、请求日志只有首次请求、WS run_end progress 为 commit_failed。未引入产品专用测试开关；持久 run_end 不提交符合现有提交失败策略。
- 文档检查 `rtk pnpm run check:docs`：397 个 Markdown、0 问题。已从 AGENTS → docs/README → MCP/context/subagents/相关 ADR 与包正文读回；路径引用、语义同步、归属、引用方向、生命周期、当前入口、新会话可读与历史保留均通过。正式文档无具体任务材料依赖。
- agent-browser 命名会话已关闭，随后只向本票 Electron PID 发送 SIGTERM；应用日志 app quitting，Forge 会话退出，Electron/Sidecar/Forge 相关 PID 与 9222 监听已确认消失。Forge 因外部停止报告退出 1，属验收清理，不表述为产品崩溃或构建失败。临时用户数据与截图资产未当作真实用户配置操作。

- 当前定向 oxfmt 检查与 oxlint 通过、`git diff --check` 通过；独立 worktree 已核对基于集成 `10efa3cf`，`git merge codex/tool-search --no-edit` 返回 already up to date。截图与 `layout-390.json` 已保存在非临时 worktree 目录，临时 UI profile 已清理。变更准备提交本票分支，未合入主分支、未推送。
