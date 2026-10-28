# 从空仓库到完整应用的里程碑划分

Type: grilling
Label: wayfinder:grilling
Status: resolved
Assignee: lead
Blocked by: 01, 02, 03, 04, 05
Map: [Coko 桌面应用](../map.md)

## Question

以 agent-runtime 的能力落地顺序为骨架，如何把工作划成可独立交付、可演示的里程碑（每个里程碑一个 `.scratch/<milestone>/` 规格）？首个里程碑的边界（仓库脚手架 + sidecar + 认证 + 最小聊天闭环？）是什么？每个里程碑的"完成"如何验证？

## Answer

按用户常设指示（2026-10-28 goal：讨论问题采用推荐，优先沿用参考项目决策）采纳，不是用户逐条确认。

以 [agent-runtime 能力落地顺序](../../../docs/tech-stack/agent-runtime.md#能力落地顺序) 为骨架划为六个里程碑，各用独立目录 `.scratch/<slug>/`，顺序执行，每个都走 grill-with-docs → to-spec → to-tickets → implement-spec → retro。能力表每一行的归属如下（"基础/完整"表示分两段交付）：

| 里程碑 | slug | 能力 | 可演示结果 |
| --- | --- | --- | --- |
| M1 行走骨架 | m1-walking-skeleton | 仓库脚手架与质量工具；protocol / logging / i18n / ui 基础；sidecar（Hono、WS、认证、SQLite 打开与迁移、租约）；Electron main / preload / `coko-app://`；Agent Loop、Tool Calling（内置 read/write/edit/bash/grep/find/ls、宿主覆盖 ripgrep grep、超时与取消）、流式事件、模型适配（provider、切换、重试）、最小 Hook 接入、Session 基础提交、Execution Runtime（非 PTY shell）、Configuration 基础、凭据、日志；renderer 三栏骨架、会话列表、流式聊天、工具卡、设置弹窗（模型与凭据）；`forge package` 产物 smoke | 打开应用 → 配置 provider → 在工作区新建会话对话，Agent 读写文件、执行命令；重启后会话可见 |
| M2 安全与恢复 | m2-permissions-recovery | Permissions / Approvals、Sandbox（Seatbelt）/ Secrets 声明、并发执行（限额与依赖）、Steering / Interrupt、Recovery / Idempotency、Session Persistence 完整、Checkpoint / Rewind | 审批卡、拒绝与记住规则；中途退出重启后恢复；回退到某条消息并恢复文件 |
| M3 上下文与指令 | m3-context-instructions | Rules / Instructions、Skills、Commands / Prompt Templates、MCP、Context Management、Compaction、Memory、Configuration 完整 | @文件、/命令、skills 调用、MCP 服务器配置与工具调用、长会话自动压缩 |
| M4 目标与任务 | m4-goal-plan-tasks | Goal、Plan Mode、Task / Todo、Background Jobs、Execution Runtime 的 PTY 与 stdin | Goal 自动推进与预算；Plan 审阅后执行；Todo 面板；后台命令输出 |
| M5 多代理与调度 | m5-agents-scheduler | Hooks 完整、Subagents、Scheduler / Automation、Fork / Handoff、Workspace / Worktree | 子代理派发与汇总；定时任务；会话分叉；worktree 隔离 |
| M6 扩展与交付 | m6-extensions-delivery | Plugins、Agent Teams、Code Intelligence、Browser / Computer Use、SDK / Headless / Protocol、Observability / Evals、DMG / ZIP 与自动更新接线 | 安装本地插件；团队协作；LSP 诊断；浏览器 MCP；无界面调用；评测脚本；安装包 |

每个里程碑的"完成"：规格验收场景全部有证据——真实 sidecar 集成测试（`ELECTRON_RUN_AS_NODE`）、Playwright 驱动的 Electron E2E、无密钥的录制 / faux provider 回放；有凭据时补跑真实模型场景，否则报告未验证；code-review 两轴通过；合入 main；retro 建议记录在里程碑目录。
