# deepseek-harness 桌面端的进程、存储与 UI 结构

Type: research
Label: wayfinder:research
Status: claimed
Assignee: lead (research subagent)
Blocked by: none
Map: [Coko 桌面应用](../map.md)

## Question

deepseek-harness 的 apps/desktop、desktop-host、web 以及 packages/session、settings、storage、client、ui 设计系统如何组织？重点：host-process 启动与 IPC、协议代理与认证、设置与会话的存储方式（是否 SQLite、表结构、迁移）、renderer 的信息架构（侧栏、会话列表、聊天、工具卡、审批、计划、设置页）、设计 token 与组件。哪些可以按 coko 技术栈（Electron Forge + tsdown + Vite + React 19 + shadcn/ui + Tailwind 4）移植？
