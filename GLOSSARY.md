---
kind: glossary
description: "Coko 领域术语的唯一定义。"
lifecycle: active
---

# Coko

Coko 是在本机工作区中运行 coding agent 的桌面应用。本表只定义本项目特有的概念。

## 运行环境

**Sidecar**：
由桌面应用启动、承载 Agent 与本地服务的独立进程。
_Avoid_: backend、server 进程、host

**Workspace**：
用户登记给 Coko 的本机目录，Agent 在其中读写文件和执行命令。
_Avoid_: project、folder、repo

## 会话

**Session**：
一个 Workspace 中与 Agent 的一段持续对话及其全部执行记录。
_Avoid_: chat、thread、conversation

**Session Entry**：
Session 中一条已提交、不可修改的记录，例如用户消息、模型回复或工具结果。
_Avoid_: event、record、message（泛指时）

**Run**：
从一次用户提交、重试或继续开始，到 Agent 停止为止的一次执行。
_Avoid_: turn（turn 指一次模型请求与其工具调用）

**Steering**：
Run 进行中用户追加的指令，在当前步骤结束后送达 Agent。
_Avoid_: interrupt、插话

**Interrupted Run**：
因 Sidecar 崩溃或强制退出而没有正常结束记录、在下次启动时被判定为中断的 Run。
_Avoid_: crashed run、failed run

**Execution Record**：
副作用工具调用在执行前提交的执行意图，带幂等键，用于恢复时判断该调用是否已执行。
_Avoid_: tool log

**Outcome Confirmation**：
中断时结果不明的副作用调用等待用户确认是否已生效的状态。
_Avoid_: unknown state、待定

**Checkpoint**：
以一条用户消息为锚点、记录此后文件工具首次改动前原内容的恢复点。
_Avoid_: snapshot（快照指单个文件的备份内容）

**Rewind**：
把 Session 的对话、文件或两者退回到某个 Checkpoint 之前的操作。
_Avoid_: undo、revert

**Fork**：
从某条用户消息之前复制出一个新 Session 的操作，原 Session 不变。
_Avoid_: branch、clone

## 权限

**Permission Mode**：
Session 的执行授权档位，同时决定哪些调用无需审批与命令的沙箱档位。
_Avoid_: preset、policy

**Permission Rule**：
按工具及其路径或命令匹配调用的一条允许、询问或拒绝规定，带作用域。
_Avoid_: whitelist、grant

**Approval Request**：
一次工具调用在执行前等待用户决定的请求，只能回答一次。
_Avoid_: prompt、permission dialog

**Sandbox Mode**：
命令进程可写范围的档位：read-only、workspace-write 或 danger-full-access。
_Avoid_: isolation level

**Escalation**：
被沙箱拒绝的调用经用户批准、以更宽沙箱档位重试一次。
_Avoid_: sudo、提升权限（泛指时）

**Protected Path**：
无论 Permission Mode 如何，写入都要审批的路径，例如 .git 与 shell 配置文件。
_Avoid_: sensitive file

## 模型

**Provider**：
用户配置的一个模型服务接入点，包含协议、地址和凭据。
_Avoid_: vendor、endpoint

**Credential**：
访问 Provider 所需的密钥。
_Avoid_: token（token 另指启动令牌与模型计量单位）

## 工具

**Built-in Tool**：
packages/agent 自带、只依赖纯 JS 的工具实现。

**Host Tool**：
宿主在装配时注册或以相同契约覆盖内置工具的实现。
_Avoid_: native tool、plugin tool
