---
kind: decision
description: "Provider 的连接信息、Model Catalog 与 Credential 经 main 一次提交、在 sidecar 单个事务中存储；获取可用模型用表单中的密钥临时请求、不保存；去掉 kind 与品牌预设。修改 Provider 保存、密钥输入或模型发现时回看。"
status: accepted
implementation: not-started
lifecycle: active
category: architecture
---

# Provider 与 Credential 一次提交、一次存储

## 上下文

[ADR 0004](0004-model-credentials-safe-storage.md) 规定密钥只经 preload IPC 交给 main 加密、不经 HTTP 发给 sidecar。现有实现先经 HTTP 创建或更新 Provider，再经 IPC 单独写入密钥，第二步失败时会留下没有 Credential 的 Provider。Provider 带 kind（deepseek、openai、anthropic、openai-compatible），协议由 kind 推出，预设 kind 的模型能力来自 pi-ai 内置目录；Provider ID 由 sidecar 随机生成。

用户于 2026-10-29 的模型服务设置讨论中确认：设置页只创建“自定义模型 API”并直接选择三种协议之一；Provider ID 由用户输入并作为主键；连接信息、Model Catalog 与 API Key 一次提交、一次存储；新建表单中“获取可用模型”使用表单里填写的 Key 发请求、不保存；不兼容已有 Provider 数据。

## 决定

- **去掉 kind 与品牌预设。** 协议（openai-completions、openai-responses、anthropic-messages）是 Provider 自身保存的字段；每个模型的上下文窗口、最大输出、输入类型与 Thinking Level 配置显式保存在 Model Catalog 中，不再取自 pi-ai 内置目录。
- **用户输入的 ID 为主键。** 格式 `^[a-z][a-z0-9-]{0,63}$`，在全部 Provider 中唯一，创建后不可修改；Credential 与 Session 的模型引用都以它为键。
- **一次提交、一次存储。** renderer 把完整草稿（连接信息、Model Catalog 与可选的新密钥）经 preload IPC 交给 main；main 用 safeStorage 加密密钥后，经一条控制消息把配置与密文交给 sidecar，sidecar 在一个 `BEGIN IMMEDIATE` 事务中写入 Provider 与 Credential。加密不可用时 main 拒绝整次提交，不发送任何消息。编辑时不带新密钥表示保留原 Credential。保存只走这一条路径，HTTP 不再提供 Provider 的创建与更新。
- **获取可用模型。** renderer 经 preload IPC 请求 main，main 经控制消息请求 sidecar 按表单中的协议与地址请求供应商的模型列表。新建时携带表单中的明文密钥，仅用于这一次请求，不加密、不落库、不进入 CredentialStore 缓存；编辑且未填写新密钥时使用已保存的 Credential，即使地址已在表单中改为其他主机。请求与错误文本按 ADR 0004 脱敏。
- **不迁移旧数据。** 库迁移删除已有 Provider 与 Credential、清空默认模型设置，并清空引用它们的 Session 的模型字段。
- **独立运行。** 环境变量模式只读取 `COKO_CREDENTIAL_<PROVIDER_ID>`；按 kind 读取的 `DEEPSEEK_API_KEY`、`OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 随 kind 一起移除。

ADR 0004 的其余约束不变：加解密只在 main，库中只有密文，sidecar 调用模型时经控制 IPC 取明文、只缓存在内存，设置接口只返回是否已配置与末四位。

## 理由与备选方案

- **保留两步提交（HTTP 建 Provider，IPC 存密钥）。** 改动最小，但第二步失败会留下半成品，不满足一次存储的要求。
- **密钥经 HTTP 随配置一起提交。** 实现简单，但违反 ADR 0004 的“密钥不经 HTTP”约束。
- **由 main 直接请求供应商的模型列表。** 无需新的控制消息，但协议适配与脱敏要在 main 再实现一份；sidecar 已持有三种协议的实现和脱敏机制。
- **新建时必须先保存才能获取模型。** 不需要临时明文通道，但与“新建与编辑共用获取流程、不要求先保存”的交互要求冲突。
- **把旧 Provider 迁移为自定义并写出内置目录能力。** 行为不变，但用户明确不要求兼容，且旧的随机 ID 不符合新的 ID 规则。

## 后果与验证

- Provider 的写入依赖 main 在线；独立运行的 sidecar（测试、headless）没有 main，集成测试需要以控制消息模拟 main 的保存与获取请求。
- 明文密钥在获取模型时会短暂经过控制 IPC 进入 sidecar 内存，范围限于该次请求。
- 删除 kind 后，测试与独立运行只能用 `COKO_CREDENTIAL_<PROVIDER_ID>` 提供密钥，依赖按 kind 读取变量的测试需要改写。
- implementation 变为 implemented 前需要：集成测试确认一次保存后 Provider 与密文同时存在、加密不可用时库不变、获取模型的临时密钥不进入库、日志与 CredentialStore 缓存，以及迁移后旧 Provider、Credential、默认模型与 Session 引用均已清除；Electron E2E 确认新建表单获取模型与一次保存可用。

## 来源与后继

- 扩展 [ADR 0004](0004-model-credentials-safe-storage.md) 的密钥写入与使用路径，不替代其加密与存储决定。
- 存储边界见 [ADR 0003](0003-settings-and-sessions-in-sqlite.md)。
- Thinking Level 与 Model Catalog 的含义见 [术语表](../../GLOSSARY.md)。
