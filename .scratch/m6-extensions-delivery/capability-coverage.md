# M6 能力覆盖表：能力表逐行 → 已交付位置或 M6 票号

依据：[Agent 执行约定](../../docs/tech-stack/agent-runtime.md#框架能力分工) 的"框架能力分工"表（35 行）与 [桌面构建与交付约定](../../docs/tech-stack/desktop-delivery.md)。2026-10-31 planner 在 main 27f55ca 上核对（读 subsystem 页、包 README、测试文件名与代码）。状态：**已交付**＝主体行为有当前行为文档与经真实应用入口的测试；**部分**＝主体已交付、能力表所列的某一项缺失；**未开始**。M6 交付后每行都应为已交付；票 14 把"证据"列补成 M6 的实际测试文件。

| # | 能力 | main 上的状态 | 已交付位置（当前行为 / 主要证据） | M6 票 |
| --- | --- | --- | --- | --- |
| 1 | Agent Loop | 已交付（M1） | [@coko/agent](../../packages/agent/README.md) 运行控制；`engine/runtime.test.ts`、`sidecar-session.test.ts` | — |
| 2 | Tool Calling | 已交付（M1） | agent README 工具契约；`tools/registry.test.ts`、`timeout.test.ts`、`sidecar-ripgrep.test.ts`（宿主覆盖） | 05、06 新增工具沿用 |
| 3 | 流式事件 | 已交付（M1） | [apps/server](../../apps/server/README.md) WebSocket；`chat.e2e.test.ts` | 08 文档化（protocol README） |
| 4 | 模型适配层 | 已交付（M1、模型服务设置） | `models/*.test.ts`、`sidecar-provider-models.test.ts`、`sidecar-thinking-level.test.ts`、ADR 0010 | — |
| 5 | 并发执行 | 已交付（M2） | agent README 调度；`tools/scheduler.test.ts`、`sidecar-concurrency.test.ts` | — |
| 6 | Rules / Instructions | 已交付（M3） | [指令文件](../../docs/subsystems/instructions.md)；`sidecar-instructions.test.ts` | — |
| 7 | Skills | 已交付（M3） | [Skills](../../docs/subsystems/skills.md)；`sidecar-skills.test.ts` | 03、04（插件来源） |
| 8 | Commands / Prompt Templates | 已交付（M3） | [命令](../../docs/subsystems/commands.md)；`sidecar-commands.test.ts` | 03、04（插件来源） |
| 9 | MCP | 已交付（M3），401 无专门状态 | [MCP](../../docs/subsystems/mcp.md)；`sidecar-mcp*.test.ts` | 09（auth-required） |
| 10 | Hooks | 已交付（M5），团队事件与插件声明缺 | [外部 Hook](../../docs/subsystems/hooks.md)；`sidecar-hooks*.test.ts`、ADR 0013 | 01（J3、J8、J9、H5、H8）、03、04、06 |
| 11 | Plugins | **未开始** | 设置注册表只有占位 | 03 → 04 → 12（ADR 0017） |
| 12 | Goal | 已交付（M4） | [Goal](../../docs/subsystems/goal.md)；`sidecar-goal*.test.ts`、ADR 0011 | 06（teammate 用量归属） |
| 13 | Plan Mode | 已交付（M4） | [Plan Mode](../../docs/subsystems/plan-mode.md)；`sidecar-plan.test.ts` | — |
| 14 | Task / Todo | **部分**：拆分、依赖、状态、结果已交付；负责人、认领与共享 Task 缺 | [Todo List](../../docs/subsystems/todo.md)；`sidecar-todo.test.ts` | 03 → 06 → 13（Team Task） |
| 15 | Scheduler / Automation | 已交付（M5） | [定时任务](../../docs/subsystems/schedules.md)；`sidecar-schedules*.test.ts`、ADR 0015 | 01（S6） |
| 16 | Background Jobs | 已交付（M4） | [后台任务](../../docs/subsystems/jobs.md)；`sidecar-jobs.test.ts`、`sidecar-pty.test.ts` | — |
| 17 | Subagents | **部分**：派发、等待、取消、汇总已交付；继续对话（send_message）缺 | [子代理](../../docs/subsystems/subagents.md)；`sidecar-subagents*.test.ts`、ADR 0014 | 01（J4、S5、S7）、02（通知 E2E）、06（继续对话） |
| 18 | Agent Teams | **未开始** | — | 03 → 06 → 13（ADR 0018） |
| 19 | Fork / Handoff | 已交付（M2 Fork、M5 Handoff） | [交接](../../docs/subsystems/handoff.md)；`agents/fork.test.ts`、`sidecar-handoff.test.ts` | — |
| 20 | Context Management | 已交付（M3），worktree 会话的上下文用量按 Workspace | [上下文管理](../../docs/subsystems/context.md)；`sidecar-context.test.ts`、`sidecar-references.test.ts` | 01（用量按 SessionCwd） |
| 21 | Compaction | 已交付（M3） | 上下文管理"压缩"；`sidecar-compaction.test.ts` | 01（S10 hook_blocked） |
| 22 | Memory | **部分**：作用域、来源、更新、删除已交付；检索（FTS）缺 | [Memory](../../docs/subsystems/memory.md)；`sidecar-memory.test.ts`；ADR 0003 partial | 03（FTS 表）→ 11 |
| 23 | Session Persistence | 已交付（M1–M2） | [启动恢复](../../docs/subsystems/recovery.md)；`sidecar-storage.test.ts`、`sidecar-recovery.test.ts`、ADR 0003 | 03（迁移 v9） |
| 24 | Checkpoint / Rewind | 已交付（M2），worktree 子目录的回退边界没有专门用例 | ADR 0006；`sidecar-checkpoints.test.ts`、`sidecar-rewind.test.ts` | 01（边界用例） |
| 25 | Workspace / Worktree | 已交付（M5），移除的 TOCTOU 未修 | [Worktree](../../docs/subsystems/worktrees.md)；`sidecar-worktrees.test.ts`、ADR 0016 | 01（H4）、06（teammate 复用） |
| 26 | Execution Runtime | 已交付（M1 shell、M4 PTY 与 stdin） | [命令执行与子进程登记](../../docs/subsystems/execution.md)；`sidecar-pty.test.ts`、`sidecar-orphans.test.ts` | 03（lsp 登记类别） |
| 27 | Code Intelligence | **未开始** | — | 03 → 05 |
| 28 | Browser / Computer Use | **未开始**（MCP 通用适配已有，没有预设与图像证据） | — | 09（Playwright MCP 预设、图像结果；Computer Use 经用户配置的 MCP） |
| 29 | Permissions / Approvals | 已交付（M2，M4–M5 扩展） | [权限判定与审批](../../docs/subsystems/permissions.md)；`sidecar-permissions.test.ts`、`sidecar-approvals.test.ts` | 03（lsp、team 权限类）、08（headless 审批） |
| 30 | Sandbox / Secrets | 已交付（M2 Seatbelt、M3 Secrets） | ADR 0005、0007；`sidecar-sandbox.test.ts`、`secrets-gate*.test.ts` | 各票新增 secrets-gate |
| 31 | Steering / Interrupt | 已交付（M2） | agent README 运行控制；`sidecar-run-control.test.ts`、`run-control.e2e.test.ts` | 06（teammate 的 steering 送达） |
| 32 | Recovery / Idempotency | 已交付（M2） | [启动恢复与结果确认](../../docs/subsystems/recovery.md)；`sidecar-recovery.test.ts` | 06（teammate 重启） |
| 33 | SDK / Headless / Protocol | **部分**：Sidecar 可独立运行、协议 DTO 有 TypeBox 定义；无界面运行入口、库用法说明、协议文档缺 | apps/server README（standalone）；`sidecar-boot.test.ts` | 03（入口存根）→ 08（ADR 0019） |
| 34 | Observability / Evals | **部分**：用量与费用在条目与日志中；延迟、追踪、审计、回放接口与 evals 缺 | [日志与诊断约定](../../docs/tech-stack/observability.md)；`sidecar-model-price.test.ts` | 03（model_request）→ 07 |
| 35 | Configuration | 已交付（M3） | [分层配置](../../docs/subsystems/configuration.md)；`sidecar-config.test.ts` | 03（新开关与 lsp 键） |

## 桌面交付

| 项 | main 上的状态 | M6 票 |
| --- | --- | --- |
| DMG / ZIP 安装包 | 未开始（`makers: []`） | 10 |
| 自动更新接线（autoUpdater、feed 可配置、未配置时关闭） | 未开始 | 03（bridge 与存根）→ 10 |
| 发布构建（不带 COKO_TEST_BUILD）的产物 E2E | 未开始（只有测试构建的 package-smoke） | 03（骨架）→ 10 → 14（复跑） |
| 签名与公证 | 不在本地图范围（需 Apple 开发者证书） | — |

## 结论

M6 的 14 张票覆盖全部"部分"与"未开始"行：Plugins（04、12）、Task / Todo 的负责人（06、13）、Subagents 的继续对话（06）、Agent Teams（06、13）、Memory 检索（11）、Code Intelligence（05）、Browser / Computer Use（09）、SDK / Headless / Protocol（08）、Observability / Evals（03、07），以及桌面交付三项（10）。已交付行的遗留缺口（Hooks、MCP 401、Context 的 worktree 用量、Checkpoint 边界、Worktree TOCTOU）由 01、03、09 处理。交付后不应再有"部分"或"未开始"行；需要真实凭据才能完成的验证列在 [规格的人工验证清单](spec.md#人工验证清单交付前需要真实凭据或外部条件)，不影响行的状态判定（行为由无密钥的回放与真实 Sidecar 测试证明）。
