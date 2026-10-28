# 各能力的首发深度与验收口径

Type: grilling
Label: wayfinder:grilling
Status: resolved
Assignee: lead
Blocked by: 01, 03, 06
Map: [Coko 桌面应用](../map.md)

## Question

agent-runtime 能力表中每一项的"实现"指什么程度：例如 Browser/Computer Use 是通过 MCP 适配还是自研工具，Code Intelligence 是否接 LSP，Sandbox 用 macOS sandbox-exec 还是仅权限策略，Plugins/Agent Teams/Evals 的最小可验收形态是什么？

## Answer

按用户常设指示（2026-10-28 goal：讨论问题采用推荐，优先沿用参考项目决策）采纳，不是用户逐条确认。

| 能力 | 首发深度与验收口径 |
| --- | --- |
| Execution Runtime | 本地适配器：`child_process` shell（M1），PTY 与 stdin 用 node-pty（沿用 DSH，M4 引入时登记版本）；进程树终止 |
| Sandbox | macOS Seatbelt（沿用 DSH）：read-only / workspace-write / danger-full-access 三档，按会话设定，拒绝后可单次提权审批 |
| Secrets | 见模型与凭据票；工具声明所需凭据名，由宿主注入环境 |
| Code Intelligence | 自研 LSP stdio 客户端（JSON-RPC），工具：diagnostics、definition、references、hover；按工作区配置语言服务器命令，不随包分发服务器 |
| Browser / Computer Use | 经 MCP 适配：提供 Playwright MCP 等预设配置，统一走权限；不自研浏览器控制 |
| Plugins | 本地目录或 git URL 安装；清单声明 skills、commands、hooks、MCP 服务器、子代理；兼容版本检查、启用 / 禁用；无市场 |
| Agent Teams | 会话内 lead 加具名 teammate（子代理实例），共享任务板与消息，可选 worktree 隔离 |
| Subagents | 内置 general / explore 预设加 Markdown frontmatter 自定义；独立上下文、工具与模型配置；权限不宽于父级 |
| Scheduler | 一次性、间隔、cron；sidecar 定时器加启动扫描补跑最近一次；去重 |
| Memory | 用户级与工作区级条目，模型可读写工具，设置页可查看删除 |
| SDK / Headless | packages/agent 可作库调用；sidecar 可脱离桌面独立运行（stdout 输出就绪信息），协议文档化 |
| Observability / Evals | 用量、费用、延迟写入会话与日志；evals 为 `tests/evals` 下的回放任务脚本，按文件结果判定 |
| 自动更新 | autoUpdater 接线，feed URL 可配置，未配置时关闭；签名与公证需要 Apple 开发者证书，不在本地图交付范围 |

验收口径：每项至少一个通过真实应用装配入口的非单元测试；依赖外部服务（真实模型、语言服务器、浏览器 MCP）的场景在本机具备条件时运行，否则报告未验证。
