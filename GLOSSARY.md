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
Agent 在其中读写文件和执行命令的本机目录。Project 的主要文件夹和 Coko 为新建的 Standalone Session 创建的目录都是 Workspace。
_Avoid_: project（Project 是组织会话的单位）、folder、repo

**Project**：
用户命名的一组本机文件夹，其中恰好一个主要文件夹（在所有 Project 中唯一），其余为附加文件夹；项目内的 Session 按 Workspace 的规则读写这些文件夹；用于在侧栏组织 Session，一个 Session 最多属于一个 Project。界面称“项目”。
_Avoid_: workspace、folder、repo

## 会话

**Session**：
一个 Workspace（或其某个 Worktree）中与 Agent 的一段持续对话及其全部执行记录；工作目录在创建时确定。
_Avoid_: chat、thread、conversation

**Standalone Session**：
不属于任何 Project 的 Session，界面称“独立对话”；新建时由 Coko 为它创建专属目录作为工作目录。
_Avoid_: 临时会话、无目录会话

**Session Entry**：
Session 中一条已提交、不可修改的记录，例如用户消息、模型回复或工具结果。
_Avoid_: event、record、message（泛指时）

**Run**：
从一次用户提交、重试、继续、Goal Round、定时任务到期、子代理派发或 Teammate 收到消息开始，到 Agent 停止为止的一次执行；Headless Run 中的提交同样开始一个 Run。
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

**Handoff**：
把一个 Session 的工作状态写成交接摘要、在新 Session 中作为草稿继续的操作，不复制消息，原 Session 不变。
_Avoid_: transfer、继续会话（泛指时）

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

**Model Catalog**：
一个 Provider 下由用户配置、可在 Session 中选用的模型集合。
_Avoid_: 模型列表、预设目录、model list

**Thinking Level**：
模型推理强度的七级刻度之一：off、minimal、low、medium、high、xhigh、max；界面称“推理档位”。
_Avoid_: effort、reasoning level、推理等级

## 目标与任务

**Goal**：
Session 中一个跨多个 Run 的完成目标，带预先记录的成功条件与预算，由 Agent 逐轮推进直到完成、停下或被取消。
_Avoid_: task、objective（泛指时）、mission

**Goal Round**：
Goal 推进中由 Coko 而不是用户发起的一个 Run。
_Avoid_: iteration、loop、自动轮次

**Goal Budget**：
一个 Goal 允许消耗的时间、Token、费用、轮次与工具调用的上限。
_Avoid_: quota、limit（泛指时）

**Success Criterion**：
创建 Goal 时记录、判定其是否完成所依据的一条可检查条件。
_Avoid_: acceptance、done condition

**Plan Mode**：
只调研与规划、不改动 Workspace 的 Permission Mode；退出须经用户审阅计划，并回到进入前的模式。
_Avoid_: planning state、dry run

**Plan**：
Agent 在 Plan Mode 中提交给用户审阅的执行方案，按修订保留。
_Avoid_: proposal、spec

**Todo List**：
Agent 为当前 Session 维护的一张可见步骤清单，每次整体替换。
_Avoid_: task list、checklist、Team Task（Team Task 是团队共享、带负责人的任务）

**Background Job**：
在 Run 之外继续运行、输出可随时读取或停止的命令，属于发起它的 Session。
_Avoid_: task、daemon、background process

## 多代理与调度

**Subagent**：
Agent 在 Run 中派发、在独立的子 Session 中执行一段工作并把结论交回的代理；权限不宽于派发它的 Session，结束后可以经消息继续对话。
_Avoid_: worker、child agent、Teammate（Teammate 是带名字、长期保留的团队成员）

**Subagent Definition**：
描述一类 Subagent 的角色提示、可用工具、模型与权限上限的条目，内置或由用户以文件编写。
_Avoid_: preset、agent profile

**Hook**：
用户配置、在工具调用或 Run 生命周期的固定时刻运行的外部命令，可以阻断、追加上下文或收紧权限决定。
_Avoid_: callback、trigger、plugin

**Schedule**：
绑定一个 Session、在一次性时刻、固定间隔或 cron 时刻到期时在该 Session 中开始 Run 的定时任务。
_Avoid_: cron job、reminder、automation（泛指时）

**Agent Team**：
一个根 Session 的 Agent（lead）与它创建的 Teammate 组成的协作单位，共享一张任务板并互相发消息；团队就是该根 Session，不另有实体。
_Avoid_: swarm、crew、group

**Teammate**：
Agent Team 中带名字、Run 结束后仍保留、可以再接收消息的 Subagent。
_Avoid_: worker、member（泛指时）、helper

**Team Task**：
Agent Team 任务板上的一项工作，带负责人、前置任务与修订号，成员认领后独占。
_Avoid_: todo、ticket、job

**Worktree**：
Workspace 所在 git 仓库的另一个检出目录，带自己的分支，供 Session 隔离地工作。
_Avoid_: checkout、branch（分支只是其一部分）

## 扩展与交付

**Plugin**：
用户安装的一组资源（Skills、命令、Subagent Definition、Hook、MCP Server 与语言服务器声明），按其会执行的内容整体批准后启用，不含在 Coko 进程内运行的代码。
_Avoid_: extension、package、add-on

**Headless Run**：
不经桌面界面、由命令行入口提交并输出结构化结果的 Run；其中的审批请求没有人回答，被自动拒绝。
_Avoid_: CLI mode、batch run、print mode

**Eval Case**：
一个带初始 Workspace、提示与按文件结果判定的期望的回归评测用例。
_Avoid_: benchmark、test fixture（泛指时）

## 工具

**Built-in Tool**：
packages/agent 自带、只依赖纯 JS 的工具实现。

**Host Tool**：
宿主在装配时注册或以相同契约覆盖内置工具的实现。
_Avoid_: native tool、plugin tool

## 上下文与指令

**Instruction File**：
给 Agent 的长期工作指令文件（AGENTS.md，缺失时为 CLAUDE.md），按用户级与 Workspace 目录链加载。
_Avoid_: rules file、memory file、system prompt

**Skill**：
一个含 SKILL.md 的目录，按 Agent Skills 规范提供某类任务的做法与资源，按需加载。
_Avoid_: plugin、tool

**Command**：
用户在输入区以 / 调用、展开为一段提示或触发一个内置动作的条目，来源可以是内置、用户与项目模板、Skill 或 MCP 提示模板。
_Avoid_: slash command（泛指时）、macro

**MCP Server**：
经 MCP 协议向 Agent 提供工具、资源与提示模板的外部进程或 HTTP 服务。
_Avoid_: plugin、connector

**Secret**：
用户在设置中登记、加密保存、按名字注入给工具或 MCP Server 的值。
_Avoid_: env var、token、Credential（Credential 专指 Provider 的密钥）

**Memory Entry**：
跨 Session 保留、属于用户或某个 Workspace 的一条记忆，由模型或用户增删。
_Avoid_: note、fact

**File Reference**：
用户消息中以 @ 指向 Workspace 内文件或目录、提交时附上其内容的引用。
_Avoid_: attachment（泛指时）、mention

**Compaction**：
把 Session 较早的对话替换为结构化摘要以腾出模型上下文的操作，原条目保留。
_Avoid_: summarize、truncation

**Project Settings**：
Workspace 内只能收紧全局设置的覆盖文件。
_Avoid_: workspace config、local settings
