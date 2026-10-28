# pi agent-core 1.4.0 与 coding-agent 的可复用结构

Type: research
Label: wayfinder:research
Status: resolved
Assignee: lead (research subagent)
Blocked by: none
Map: [Coko 桌面应用](../map.md)

## Question

pi-agent-core 1.4.0 的 Agent 类公开 API（beforeToolCall、afterToolCall、prepareRequest、finishTurn、steering、follow-up、取消、事件订阅）、pi-ai 1.4.0 的 provider/模型/流式接口、pi-mcp 1.4.0 客户端接口分别是什么？pi `packages/coding-agent` 的内置工具（read/write/edit/bash/grep/glob/ls 等）、指令加载（AGENTS.md）、skills、prompt templates、extensions、compaction、session 结构如何组织？哪些可直接移植到 packages/agent（agent-runtime 的模块目录），哪些需改造？

## Answer

研究结论见 [pi agent-core 与 coding-agent 研究](../research/pi-agent-core-and-coding-agent.md)（按 v1.4.0 tag 导出源码阅读）。要点：

- pi-agent-core 1.4.0 只含 Agent、loop、proxy 与类型；接入点为 beforeToolCall、afterToolCall、prepareRequest、finishTurn、prepareNextTurn、transformContext、convertToLlm、getApiKey；streamFn 必填。subscribe 监听器串行 await 并计入 run 结算，可作提交屏障；持久化订阅 message_end（按模型调用顺序），不订阅 tool_execution_end（按完成顺序）。
- 并行执行无并发上限与依赖图，任一 sequential 工具使整批串行；这两项由 packages/agent 自行实现。
- pi-ai：createModels / createProvider / streamSimple；流中错误编码进 stopReason，不抛出；提供重试与上下文溢出判定；CredentialStore 可注入；按 provider 子路径导入。
- pi-mcp：McpClient 支持 tools、resources（分页）、通用 request、Stdio / StreamableHttp；无 prompts 方法，由应用经 request 封装。
- 移植：truncate、edit + edit-diff、ls、write、skills、prompt templates、AGENTS.md 加载可拷贝（AGENTS.md 加 workspace 边界）；bash 改走 ports；compaction 改造输入类型；grep/find 改为纯 JS（ignore）并保持 schema；read 的图片缩放交由宿主覆盖；不移植 jiti 扩展加载器、SessionManager、AuthStorage、models.json 的 "!command"。
- 未在 Electron 内置 Node 下运行，体积未测。

