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

- [权限判定与审批](subsystems/permissions.md)：工具调用的判定顺序、审批请求的状态与条目、回答路由和审批卡。
- [启动恢复与结果确认](subsystems/recovery.md)：崩溃后被中断 Run 的判定、结果探测、待确认与继续。
- [分层配置](subsystems/configuration.md)：默认、全局与项目设置的合并（项目只收紧）、诊断与配置接口。
- [指令文件](subsystems/instructions.md)：AGENTS.md / CLAUDE.md 的发现顺序、@import、预算、注入格式与嵌套按需加载。
- [命令](subsystems/commands.md)：提示模板的发现与展开、同名优先级与诊断、命令目录接口、/ 命令菜单与命令 chip。
- [Skills](subsystems/skills.md)：Skill 的发现位置与校验、<available_skills> 索引与预算、skill 工具与读取根、/<skill-name> 展开、开关与 Skills & Commands 分区。
- [上下文管理](subsystems/context.md)：@ File Reference 的语法、展开与上限、文件候选接口、@ 菜单与引用 chip、输入区草稿的持久化、上下文用量与上下文环、时间裁剪、压缩、忽略规则。
- [命令执行与子进程登记](subsystems/execution.md)：bash 的进程组执行与生命周期回调、子进程登记表、启动时的孤儿清理与有序关闭、已知限制。
- [后台任务](subsystems/jobs.md)：bash run_in_background、Job 输出（环形缓冲、日志、进度）、job_output / job_list / job_kill、完成通知、HTTP 接口、停止与重启 lost。
- [Todo List](subsystems/todo.md)：todo_write 的校验与权限类、todo_list 条目、有未完成项时注入的 <todo_list>（压缩后仍在）、dock 的待办卡与队列卡。
- [Memory](subsystems/memory.md)：记忆工具与权限类、每个 Run 注入的 <memory> section 与预算、开关、/api/memories 与设置分区。
- [MCP Server 连接、工具、资源与提示模板](subsystems/mcp.md)：全局与项目 MCP Server 配置、批准摘要、连接状态与重连、工具命名与权限、资源工具、`/mcp__<server>__<prompt>` 命令、登记的 Secret。
- [@coko/agent](../packages/agent/README.md)：运行时入口、工具契约、工具调度与执行记录。

当前行为文档随实际实现逐步建立。尚不存在的架构、子系统或接口页面不作为可用资料列入导航。
