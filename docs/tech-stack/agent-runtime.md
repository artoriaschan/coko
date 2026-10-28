---
kind: technical-spec
description: "Agent 框架能力、生命周期、Goal 与恢复的项目级技术约定。"
lifecycle: active
---

# Agent 执行约定

项目级技术约定，不代表已有实现或已验证结果；候选、可选和待决项沿用原标注，适用范围与变更规则见 [专项导航](README.md)。

### Agent 与应用层的职责

packages/agent 是产品的 coding-agent 框架层，使用 pi 的 `Agent` 类接入模型、工具和事件订阅，并统一实现产品的执行机制、业务状态机和策略。Session、Conversation、Submission、Goal、Plan、Task 等属于产品自己的领域模型。packages/session 负责可靠存储，apps/server 和桌面宿主负责进程、定时唤醒、隔离、凭据及网络传输。

pi-agent-core 1.4.0 提供 Agent 执行核心，其持久化 Harness 与 Session 存储已从该包拆出。因此本方案移除 `@earendil-works/pi-durable` 和 `@earendil-works/chord`，不引入 `@earendil-works/pi-coding-agent`。持久化记录提交由 session 实现，运行状态重建与恢复决策由 agent 实现，server 在启动或唤醒时调用恢复接口。[pi-agent-core 版本说明](https://github.com/earendil-works/pi/blob/v1.4.0/packages/agent/CHANGELOG.md)

恢复时从持久化记录重建 Agent 上下文和任务状态。对中断前已经产生外部副作用的工具调用，应用层必须通过执行记录、幂等键或人工处理决定后续动作；不能仅靠消息回放自动重跑。

### 框架能力分工

下表定义目标能力归属。pi 包提供执行基础；产品自己的状态机、策略和宿主适配按模块职责实现。

| 能力 | packages/agent 负责 | 协作实现 |
| --- | --- | --- |
| Agent Loop | 封装 pi 循环、停止条件和运行生命周期 | pi-agent-core |
| Tool Calling | 工具注册与宿主扩展/覆盖、内置工具、参数 Schema 与校验、结构化结果、超时和取消策略 | 宿主执行适配器；server 装配宿主工具 |
| 流式事件 | 文本与工具调用增量、执行状态、错误和完成事件，统一订阅接口 | server 映射为协议事件并推送 |
| 模型适配层 | Provider、能力识别、推理参数、模型切换、限流与错误策略 | pi-ai；宿主提供凭据 |
| 并发执行 | 工具并行 / 串行、依赖调度、并发限制和结果汇总 | 宿主管理实际资源 |
| Rules / Instructions | AGENTS.md 等指令的作用域、优先级、加载与上下文组合 | 文件访问接口 |
| Skills | 发现、元数据索引、显式调用、自动匹配、按需加载与资源访问策略 | 宿主读取文件、执行脚本 |
| Commands / Prompt Templates | 命令注册、参数展开、模板与上下文注入、用户自定义命令 | UI 提供调用入口 |
| MCP | 工具、资源、提示模板适配及连接使用策略 | pi-mcp；宿主管理凭据和子进程 |
| Hooks | 生命周期、顺序、拦截、超时、错误处理与返回结果语义 | 宿主执行外部 Hook |
| Plugins | 扩展清单、兼容检查、能力注册、启用与禁用 | server 负责下载、安装、更新与卸载 |
| Goal | 目标记录、状态机、预算、继续判断与完成判定 | session 持久化；server 唤醒 |
| Plan Mode | 规划状态、计划修改、工具限制与切换执行 | UI 展示和确认 |
| Task / Todo | 拆分、依赖、负责人、子任务、状态与结果 | session 持久化 |
| Scheduler / Automation | 调度定义、触发条件、运行准入与去重规则 | server 执行定时器、启动扫描和唤醒；宿主发送通知 |
| Background Jobs | Job 模型、输出订阅、取消、完成回传与结果归属 | 宿主管理进程和输出 |
| Subagents | 独立上下文、角色、模型与工具配置、派发、等待、取消与汇总 | 宿主提供执行资源 |
| Agent Teams | 共享任务、消息、依赖协调与结果整合 | 宿主提供工作区隔离 |
| Fork / Handoff | 历史选择、配置与权限继承规则、交接状态 | session 保存分叉记录；宿主交接资源 |
| Context Management | 文件引用、检索、按需加载、工具输出裁剪与 Token 预算 | 文件及检索适配器 |
| Compaction | 压缩策略、摘要结构、目标与约束保留、上下文重建 | 模型调用与 session |
| Memory | 跨会话作用域、来源、检索、更新和删除策略 | 独立的 Memory 存储接口与宿主适配 |
| Session Persistence | 决定保存内容、提交时机与执行恢复语义 | session 负责 SQLite 事务、迁移和损坏隔离；server 负责断线重连 |
| Checkpoint / Rewind | 检查点语义、会话回退与分叉 | session 保存记录；宿主处理文件快照 |
| Workspace / Worktree | 工作目录绑定、多仓库使用约束、隔离需求与资源归属 | 宿主执行 Git、目录管理与清理 |
| Execution Runtime | 定义 Shell、PTY、stdin、进程状态、退出码和取消接口 | 本地、容器或远程适配器 |
| Code Intelligence | 能力选择、符号与诊断查询、结果转换 | LSP / 代码索引适配器 |
| Browser / Computer Use | 工具定义、调用策略与结果处理 | 浏览器、桌面控制或 MCP 适配器 |
| Permissions / Approvals | 权限判断、路径 / 命令 / 网络范围、授权有效期与请求状态 | 宿主提供执行事实；UI 收集授权 |
| Sandbox / Secrets | 声明文件系统、网络约束和凭据需求 | 宿主实施隔离、凭据存储与注入；logging 执行脱敏 |
| Steering / Interrupt | 指令队列、方向调整、暂停、恢复与终止语义 | pi 基础能力；宿主执行进程取消 |
| Recovery / Idempotency | 恢复状态机、重试、操作去重与副作用处理策略 | session 提交记录；外部能力适配器 |
| SDK / Headless / Protocol | 无界面库调用、结构化结果与事件订阅接口 | protocol 定义传输 DTO；server 提供 HTTP / WebSocket |
| Observability / Evals | 执行追踪、用量、费用、延迟、审计事件与回放接口 | logging 输出；评测脚本位于 tests/evals |
| Configuration | 配置 Schema、全局与项目覆盖、能力开关、合并与校验规则 | 宿主读取配置文件并执行迁移 |

pi-agent-core 1.4.0 已提供循环、工具事件、批次并行 / 串行、steering、取消和部分生命周期接入点。工具并发限额、依赖图、Goal、持久化调度、完整权限体系和多代理协调在此基础上实现。[pi-agent-core 1.4.0](https://github.com/earendil-works/pi/blob/v1.4.0/packages/agent/README.md)

pi-mcp 1.4.0 提供工具调用、资源读取和通用请求接口；提示模板通过应用封装 prompts/list、prompts/get，并补充能力检查、分页与返回值校验。连接配置、凭据保存、安装和生命周期由宿主装配。[pi-mcp 客户端实现](https://github.com/earendil-works/pi/blob/v1.4.0/packages/mcp/src/client.ts)

### 工具扩展与覆盖

packages/agent 提供内置工具及其契约：名称、参数 schema、结果结构、超时与取消语义。内置实现只依赖 Node 标准库和技术栈已选的纯 JS 依赖，不依赖随安装包分发的二进制；内置 grep 为纯 JS 实现，用 ignore 匹配 gitignore 规则。

宿主在创建 Agent 时通过工具注册接口扩展或覆盖工具：

- **扩展。** 以新名称注册工具，并提供完整契约。
- **覆盖。** 以显式覆盖声明替换同名内置实现，必须保持原契约，使提示词、Session 记录和回放不随宿主改变；契约不同的实现以新名称注册。未声明覆盖的重名注册在装配时报错。
- **统一接入链。** 宿主工具与内置工具经过同一执行前权限判断、持久化提交、超时、取消和观测；工具声明不能提升宿主授予的权限。
- **记录与诊断。** Session 记录工具名、参数和结果，不记录实现身份；实际生效的实现（内置或宿主）写入日志供诊断。

桌面端用 ripgrep 实现覆盖内置 grep，分发与装配见 [桌面构建与交付约定](desktop-delivery.md#内置-ripgrep)。

### Agent 模块内部结构

保持现有 workspace 数量，各目录随能力落地逐步增加。

```text
packages/agent/src/
├── engine/          # pi 接入、运行生命周期、事件
├── models/          # Provider、模型配置与调用策略
├── tools/           # 注册、内置工具、宿主扩展与覆盖、调用、结果与并发
├── instructions/    # Rules、Skills、Commands
├── extensions/      # Hooks、Plugins、MCP
├── goals/           # 目标、预算、继续与完成判定
├── planning/        # Plan Mode
├── tasks/           # Task、Job、调度定义
├── agents/          # Subagents、Teams、Fork、Handoff
├── context/         # 上下文、压缩、Memory
├── policy/          # 权限、授权、执行限制
├── recovery/        # 恢复、重试、幂等
├── ports/           # 执行、工作区、凭据等宿主接口
├── config/          # 配置模型与合并
└── index.ts         # 对外 SDK
```

### 生命周期与执行约定

使用 Agent 类的 beforeToolCall、afterToolCall、prepareRequest、finishTurn 等接入点组合产品机制。最小 Hook 调度随执行内核落地，权限、持久化与观测经过统一接入链；完整外部 Hook 配置和 Plugins 随扩展能力接入。

持久化的消息处理使用 Agent 类可等待的订阅生命周期，明确提交完成后才能开始的后续阶段。原始 agentLoop 事件流仅用于观察时，不将异步消费事件视为提交屏障。并行工具的展示事件可以按完成顺序出现，持久化工具结果保持模型原始调用顺序。[事件和生命周期约定](https://github.com/earendil-works/pi/blob/v1.4.0/packages/agent/README.md)

工具执行意图、授权决定、结果和任务状态通过 SessionRepository 提交。文本增量采用独立的展示与检查点策略；向客户端发送的事件明确区分临时进度与已提交事实。

Plan Mode、Skills、Rules、Hooks、MCP 工具、子代理和后台任务统一经过执行前权限判断。指令和扩展文件提供执行方法与上下文，其声明不能提升宿主授予的权限。授权与具体调用、参数、工作区、作用域和有效期关联，恢复后重新校验。权限模式、审批与沙箱的叠加规则见 [ADR 0005](../adr/0005-session-permission-mode.md)。Skills 的规范定义格式、元数据和可选资源组织，自动匹配与运行授权由产品实现。[Skills 规范](https://agentskills.io/specification)

暂停与恢复保存显式状态。进程重启后由 agent 重建目标、任务、消息和待处理授权，由宿主重新建立连接和进程。取消按 Goal、Run、子代理、Job 的归属传播，宿主负责实际进程树终止及资源释放。

会话回退、文件快照恢复和外部动作分别记录与处理；Checkpoint 的追踪范围与回退方式见 [ADR 0006](../adr/0006-checkpoint-and-rewind.md)。已产生外部副作用的调用通过幂等键、执行记录和外部状态查询判定，结果不明确时保存待确认状态，避免恢复时重复执行。

### Goal 机制

Goal 由 agent 统一管理，至少包含以下内容：

- 目标记录：描述、约束、成功条件、关联 Session 与 Task。
- 状态机：运行、等待输入、等待外部条件、暂停、阻塞、完成、取消、失败和预算耗尽；状态及原因持久化。
- 执行推进：每轮结束后结合任务结果、等待条件、错误和预算判断继续或停止；推进请求经过单写者和操作去重控制。
- 预算：时间、Token、费用、轮次与工具调用限额，明确时间计费口径，累计关联子代理的消耗，并在调用前检查可用预算。
- 完成判定：根据预先记录的条件及其证据决定完成；模型一次正常结束表示本轮结束，Goal 状态由完成判定单独更新。
- 持久化恢复：保留目标、预算用量、约束、决策和待办，支持进程重启与上下文压缩后的重建。
- 停止传播：取消目标时处理关联运行、子代理、后台任务和进程，并记录清理结果。

Goal 判断是否应该继续，server 决定何时唤醒执行。finishTurn 可以要求下一次模型请求；跨进程重启、定时唤醒和持续任务推进依靠显式状态与宿主调度。错误、取消、等待输入和预算耗尽均作为停止或等待条件处理。[轮次结束与继续执行](https://github.com/earendil-works/pi/blob/v1.4.0/packages/agent/README.md#request-preparation-and-turn-finalization)

### 能力落地顺序

1. Agent Loop、Tools、事件流、模型适配和最小 Hook 接入。
2. 权限、Session 提交、恢复和幂等。
3. 上下文、Rules、Skills、Commands 与 MCP。
4. Goal、Plan Mode、Tasks 与后台执行。
5. 完整 Hooks、Subagents、Scheduler 与 Fork / Handoff。
6. Plugins、Agent Teams、扩展开发环境适配与 Evals。
