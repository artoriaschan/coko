# claude-code 的权限、Hooks、Plan Mode、子代理、压缩与 Todo 逻辑

Type: research
Label: wayfinder:research
Status: resolved
Assignee: lead (research subagent)
Blocked by: none
Map: [Coko 桌面应用](../map.md)

## Question

claude-code 中权限/审批模型（规则、作用域、模式）、Hooks 事件与语义、Plan Mode、Task/Todo、Subagents、Compaction、Memory、Checkpoint/Rewind、Slash Commands、MCP 接入、后台任务的实现要点是什么？哪些规则应作为 packages/agent 相应模块的行为参考？

## Answer

研究结论见 [claude-code 机制研究](../research/claude-code-agent-logic.md)。来源是社区还原版 claude-code-best v2.8.4（HEAD 77a7934e），不是官方源码，部分分支受 feature gate 控制；仅静态阅读。各节的"coko 参考规则"是建议，在对应里程碑的 grill-with-docs 中采纳。要点：

- 权限：分层流水线，deny 优先；敏感路径与需要用户交互的检查不能被 bypass 跳过；规则语法 `Tool` / `Tool(content)`，Bash 支持精确、前缀与通配，路径用 gitignore 风格；更新带 destination（session / 本地 / 项目 / 用户）；无 UI 的子代理把 ask 转为 deny。
- Hooks：27 个事件，stdin JSON 输入，exit 2 阻断，stdout JSON 返回决定；并行执行，按 deny > ask > allow 聚合；Hook 的 allow 绕不过 deny / ask 规则。
- Plan Mode：一种权限模式加周期性提醒；只有本会话 plan 文件可免审批写；退出需用户确认并恢复原模式；子代理禁用。
- Todo / Task：整表替换的 Todo 与带依赖、负责人的 Task 两种形态。
- Subagents：frontmatter 定义工具、模型、权限模式等；上下文与取消隔离；权限不得宽于父级；fork 继承完整上下文。
- Compaction：按窗口减输出保留与缓冲计算阈值，连续失败熔断；摘要保留用户消息与约束，压缩后重新注入文件、plan、skills。
- Memory：Managed → User → Project（逐层）→ Local，越后优先级越高；@import 限深防环。
- Checkpoint / Rewind：文件写前备份、每条用户消息一个快照；Bash 副作用不追踪。
- Resume / Fork：恢复时过滤未完成工具调用；fork 生成新会话并记录来源。后台 Bash 为任务，输出落盘，完成时注入通知。

