# pi agent-core 1.4.0 与 coding-agent 的可复用结构

Type: research
Label: wayfinder:research
Status: claimed
Assignee: lead (research subagent)
Blocked by: none
Map: [Coko 桌面应用](../map.md)

## Question

pi-agent-core 1.4.0 的 Agent 类公开 API（beforeToolCall、afterToolCall、prepareRequest、finishTurn、steering、follow-up、取消、事件订阅）、pi-ai 1.4.0 的 provider/模型/流式接口、pi-mcp 1.4.0 客户端接口分别是什么？pi `packages/coding-agent` 的内置工具（read/write/edit/bash/grep/glob/ls 等）、指令加载（AGENTS.md）、skills、prompt templates、extensions、compaction、session 结构如何组织？哪些可直接移植到 packages/agent（agent-runtime 的模块目录），哪些需改造？
