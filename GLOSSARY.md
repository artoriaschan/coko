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
从一次用户提交开始、到 Agent 停止为止的一次执行。
_Avoid_: turn（turn 指一次模型请求与其工具调用）

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
