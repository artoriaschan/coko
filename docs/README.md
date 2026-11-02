---
kind: index
description: "Coko 技术规范、开发流程、文档维护体系和写作模板的导航。"
lifecycle: active
---

# Coko 文档

以下页面分别维护项目技术选择、开发方法和文档归属。长期有效的约定与决定由正式文档独立表达；任务讨论和进度通过 tracker 管理。

新会话按任务选择下面的正文，核对生命周期、适用范围及批准/实施状态；弃用材料先追到后继，归档材料只用于历史追溯。详细读取与同步规则见 [文档生命周期](DOCUMENT_LIFECYCLE.md)。

## 当前规范与方法

- [技术栈](TECH_STACK.md)：已选技术、精确版本、兼容性约束与首发运行环境。
- [专项技术规范](tech-stack/README.md)：项目级架构、Agent、桌面交付、界面、日志和测试约定；作为需求设计的输入，区别于当前实现说明。
- [开发与文档流程](DEVELOPMENT_WORKFLOW.md)：新版 Matt skills 的入口、阶段产物、架构设计和交付条件。
- [文档体系](DOCUMENTATION_SYSTEM.md)：文档层级、类型、路径、决策提炼、状态与归档规则。
- [文档生命周期](DOCUMENT_LIFECYCLE.md)：更新、弃用、归档、引用和入口同步，以及新会话的读取规则。
- [文档模板](templates/README.md)：生成设计、ADR、当前参考、指南和证据时使用的格式。
- [长期决定](adr/README.md)：已记录的 ADR 及其批准与实施状态。
- [术语表](../GLOSSARY.md)：领域术语的唯一定义。

- [Skills 项目配置](agents/issue-tracker.md)：本地 tracker；[分拣标签](agents/triage-labels.md)；[领域文档](agents/domain.md)。

## 当前行为

- [桌面工作台](subsystems/workbench.md)：双栏外壳、侧栏导航、内容区历史、设置返回、主输入框与文件附件。

- [权限判定与审批](subsystems/permissions.md)：工具调用的判定顺序、审批请求的状态与条目、回答路由和审批卡。
- [启动恢复与结果确认](subsystems/recovery.md)：崩溃后被中断 Run 的判定、结果探测、待确认与继续。
- [分层配置](subsystems/configuration.md)：默认、全局与项目设置的合并（项目只收紧）、诊断与配置接口。
- [指令文件](subsystems/instructions.md)：AGENTS.md / CLAUDE.md 的发现顺序、@import、预算、注入格式与嵌套按需加载。
- [命令](subsystems/commands.md)：提示模板的发现与展开、同名优先级与诊断、命令目录接口、/ 命令菜单与命令 chip。
- [Skills](subsystems/skills.md)：Skill 的发现位置与校验、<available_skills> 索引与预算、skill 工具与读取根、/<skill-name> 展开、开关与 Skills & Commands 分区。
- [上下文管理](subsystems/context.md)：@ File Reference 的语法、展开与上限、文件候选接口、@ 菜单与引用 chip、输入区草稿的持久化、上下文用量的五类统计与上下文环、时间裁剪、压缩、忽略规则。
- [命令执行与子进程登记](subsystems/execution.md)：bash 的进程组执行与生命周期回调、子进程登记表、启动时的孤儿清理与有序关闭、已知限制。
- [外部 Hook](subsystems/hooks.md)：Hook 配置与诊断、项目 Hook 的逐条批准、matcher 与 if、执行与进程登记、PreToolUse 与判定的组合、PermissionRequest、PostToolUse 的追加上下文、UserPromptSubmit / Stop / PreCompact / Notification、continue: false 的停止、hook_run、/api/hooks 与设置分区。
- [后台任务](subsystems/jobs.md)：bash run_in_background、Job 输出（环形缓冲、日志、进度）、job_output / job_list / job_kill、完成通知、HTTP 接口、停止与重启 lost、PTY Job 与 job_input、后台任务视图。
- [定时任务](subsystems/schedules.md)：规则与 cron（时区、夏令时）、定时器与补跑、准入与跳过原因、至多一次投递与挂起、<scheduled_task> 输入与授权、四个工具、/api/schedules、桌面通知与通知设置、界面（Schedules tab、设置分区）、测试时钟。
- [子代理](subsystems/subagents.md)：定义文件与诊断、agent / agent_wait / agent_cancel、子 Session 与工具交集、有效权限与审批、预算汇入 Goal、并行上限与取消、后台通知、isolation worktree、重启中断与 /api/sessions/:id/agents；界面（agent 工具卡、Agents tab、审批冒泡、设置分区）。
- [Agent Teams](subsystems/teams.md)：具名 teammate 的创建与解散、send_message 的送达与排队、子代理继续对话、任务板的 compare-and-set 与认领、TaskCreated / TaskCompleted / TeammateIdle、worktree、预算归属、重启与 /api/sessions/:id/team。
- [Todo List](subsystems/todo.md)：todo_write 的校验与权限类、todo_list 条目、有未完成项时注入的 <todo_list>（压缩后仍在）、dock 的待办卡与队列卡。
- [Goal](subsystems/goal.md)：goal 条目与九阶段转换、create_goal / update_goal 的授权与完成证据、Goal Round 的推进与去重、wait_jobs、<goal> 与 <goal_round> 注入、/goal 与 /api/sessions/:id/goal、取消与重启后暂停、预算与模型价格、Goal 卡与用量界面。
- [Plan Mode](subsystems/plan-mode.md)：plan 权限模式、/plan 与 prior、exit_plan_mode 的提交与审阅、<plan_mode> 与 <approved_plan> 注入、审阅卡与右栏 Plan tab。
- [Memory](subsystems/memory.md)：记忆工具与权限类、每个 Run 注入的 <memory> section 与预算、关键词检索与 FTS 降级、开关、/api/memories 与设置分区。
- [MCP Server 连接、工具、资源与提示模板](subsystems/mcp.md)：全局与项目 MCP Server 配置、批准摘要、连接状态与重连、工具命名与权限、资源工具、`/mcp__<server>__<prompt>` 命令、登记的 Secret。
- [交接](subsystems/handoff.md)：/handoff 与对话框、trigger handoff 的摘要 Run、目标 Session（当前目录或 worktree）与权限状态的复制、Goal 用量、草稿与时间线行、与从此分叉的差异。
- [代码智能](subsystems/lsp.md)：语言服务器的配置来源与合并、lsp 工具的四个操作与结果格式、权限与脱敏、进程生命周期与失败、/api/lsp 与 lsp_update、设置 → 代码智能分区与工具卡。
- [插件](subsystems/plugins.md)：清单与诊断、目录与 git 来源的安装与复制、digest 与批准、启用 / 禁用 / 更新 / 卸载、贡献的命名空间与加载时机、/api/plugins、与项目资源的区别、设置中的插件分区与批准对话框。
- [Worktree](subsystems/worktrees.md)：.coko-worktrees/<name> 与分支 coko/<name> 的创建、会话绑定与固定的工作目录、宿主执行的 git、移除的 busy / dirty 检查与只读会话、HTTP 接口与侧栏入口。
- [追踪、审计、导出与评测](subsystems/tracing.md)：model_request 逐请求记录、每个 Run 的追踪（工具耗时、审批等待、Hook 归属）、审计序列、/api/sessions/:id/{trace,audit,export}、ndjson 导出与 loadExport 回放、右栏 Trace tab、tests/evals 的用例格式、报告与真实模式。
- [无界面运行](subsystems/headless.md)：headless 入口的参数、装配与输出（text / json / stream-json）、退出码与信号、审批自动拒绝（by headless）、--provider-config 与密钥变量、日志与已知限制。
- [安装包、自动更新与发布构建](subsystems/delivery.md)：开发运行的 watch 与重启、ZIP / DMG makers 与 make、构建期更新源与 UpdateCoordinator、设置 → 关于、发布构建与测试构建的差异、两类 E2E 入口。
- [@coko/agent](../packages/agent/README.md)：运行时入口、工具契约、工具调度与执行记录。

当前行为文档随实际实现逐步建立。尚不存在的架构、子系统或接口页面不作为可用资料列入导航。
