---
kind: technical-spec
description: "日志的进程归属、关联字段、轮转、脱敏和失败处理约定。"
lifecycle: active
---

# 日志与诊断约定

项目级技术约定，不代表已有实现或已验证结果；候选、可选和待决项沿用原标注，适用范围与变更规则见 [专项导航](README.md)。

各 workspace 通过统一的日志模块记录事件，模块对业务层暴露运行时无关的接口，由宿主配置 sinks、级别、格式和上下文。[LogTape 运行时支持](https://logtape.org/comparison)、[结构化日志](https://logtape.org/manual/struct)

### 进程分工与关联

- Electron main 记录应用启动、窗口生命周期、自动更新、renderer 崩溃和 sidecar 启停，并负责桌面日志落盘。
- renderer / preload 通过受控 IPC 将结构化日志转发到 main；main 校验日志级别、字段和大小，并标记实际来源。renderer 不直接访问文件 sink。
- sidecar 独立记录 Hono 请求、Agent 执行、模型调用和工具执行，写入服务日志。
- Effect 日志与 pi 事件由应用层适配为统一日志记录，业务代码共用同一组关联字段。

统一字段包含时间、级别、模块、事件名、消息、进程来源、应用版本和错误摘要；关联字段按场景携带 `requestId`、`sessionId`、`runId` 和 `toolCallId`；`requestId` 只表示一次 HTTP 请求，审批事件用 `approvalId` 记录 Approval Request 的 id。跨 IPC、HTTP 和 WebSocket 显式传递关联标识，并由接收端校验、绑定到日志上下文。

### 文件、轮转与脱敏

桌面日志目录由 main 从 `COKO_HOME`（缺省 `~/.coko`）派生为 `data/logs/`，并将该日志路径传入 Sidecar；不使用 Electron 的 `app.getPath('logs')`，路径边界见 [ADR 0025](../adr/0025-system-data-root.md)。桌面日志和服务日志分别写入 `desktop.jsonl`、`sidecar.jsonl`；每个文件保持单写者，多实例使用独立目录。

采用按大小轮转，默认单文件上限 10 MiB，最多保留 5 份备份。正常退出时等待日志 sink 刷新和释放；日志目录创建、写入或轮转失败通过独立的 Console 诊断路径报告，避免递归写入同一个故障 sink。[文件与轮转支持](https://logtape.org/sinks/file)

日志记录模型与工具的耗时、token 用量、执行状态和错误摘要；每次模型请求另作为 `model_request` 条目保存在 Session 中（耗时、首个增量时间、usage、费用、重试次数与用途），追踪、审计与导出由条目派生，见 [追踪、审计、导出与评测](../subsystems/tracing.md)。API key、Authorization、Cookie、sidecar 启动令牌、密码等字段在转发和输出前脱敏；完整提示词、模型回复和工具正文保存在 Session 数据中。脱敏同时覆盖结构化字段和可能包含敏感信息的自由文本。[脱敏支持](https://logtape.org/manual/redaction)

运行日志使用独立目录和保留策略，Session 与执行检查点保存在 SQLite，按服务端持久化规则管理。清理日志不影响会话恢复。
