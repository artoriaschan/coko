# 首发模型提供方与凭据存储

Type: grilling
Label: wayfinder:grilling
Status: resolved
Assignee: lead
Blocked by: 01, 05
Map: [Coko 桌面应用](../map.md)

## Question

首发支持哪些 provider 与协议（Chat Completions / Responses / Anthropic Messages）、默认模型、如何配置 base URL 与 API key；凭据存在哪里（macOS Keychain / Electron safeStorage / SQLite 加密字段）、如何注入 sidecar 并脱敏？

## Answer

按用户常设指示（2026-10-28 goal：讨论问题采用推荐，优先沿用参考项目决策）采纳，不是用户逐条确认。

- **协议与 provider。** 首发三种协议全部经 pi-ai 支持：Chat Completions（OpenAI 兼容，覆盖 DeepSeek 等）、Responses（OpenAI）、Anthropic Messages。设置页提供 DeepSeek、OpenAI、Anthropic、自定义 OpenAI 兼容四类预设，可填 base URL、API key、模型列表；不内置默认密钥，未配置时聊天入口引导到设置。按 provider 子路径导入 pi-ai。
- **模型选择。** 每个会话记录当前模型；输入区可切换，切换写入会话条目。不移植 pi models.json 的 `"!command"`。
- **凭据存储。** 密文存 SQLite（sidecar 写入），加解密只在 main 用 Electron `safeStorage`（macOS Keychain 保护的密钥）完成。renderer 输入的密钥经 preload IPC 直达 main 加密，不经 HTTP；sidecar 调用模型时经 CredentialStore 端口通过控制 IPC 向 main 请求明文，只在进程内存中缓存。独立运行 sidecar（测试、headless）时 CredentialStore 回退到环境变量。
- **脱敏。** API key、Authorization、Cookie、启动令牌按日志约定脱敏；设置接口只返回"已配置 / 末四位"。
- 长期决定记录为 [ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)。

## 后续需求修订

2026-10-29，用户在模型服务视觉设计中明确改为仅创建自定义模型 API，并在供应商列表内完成添加与编辑；本票 Answer 的“四类预设”保留为首发规划历史，不作为本轮界面要求。后续交互与功能统一维护于 [模型服务 PRD](../../model-service-settings/spec.md)；其中尚未确认的规则标为待决，规格为 draft，不表示已经实现。三协议支持及 ADR 0004 的凭据安全约束继续生效。

2026-10-29 规则确认后，品牌预设与按品牌区分的 kind 被移除，协议改为供应商自身字段；Provider ID 由用户输入，连接信息、Model Catalog 与 Credential 一次提交、一次存储，不兼容旧数据，记录为 [ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)。ADR 0004 的加密与存储决定继续生效。
