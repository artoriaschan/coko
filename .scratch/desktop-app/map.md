# 地图：Coko 桌面应用

Label: wayfinder:map
Status: open

## Destination

在 macOS arm64 本地构建并运行的 Coko 桌面应用（apps/desktop + apps/server + packages/*），按 [Agent 执行约定](../../docs/tech-stack/agent-runtime.md) 的框架能力分工表实现全部能力；设置与会话存储在 SQLite。地图的终点是：每个里程碑都有可交给 grill-with-docs → to-spec → to-tickets → implement-spec → retro 的明确边界，且路线上已没有待决问题。

## Notes

- 领域：Electron + sidecar 的 coding-agent 桌面应用。每轮先读 [TECH_STACK](../../docs/TECH_STACK.md) 与 [专项导航](../../docs/tech-stack/README.md)。
- 用户常设指示（2026-10-28 goal）：需要讨论澄清的问题**直接采用推荐答案**，优先沿用参考项目的决策；grilling 票由 Agent 写出推荐并按此指示采纳，Answer 中标明"按常设指示采纳"，与用户逐条确认的结论区分。
- 参考：packages/agent 的编码实现优先参考 pi `packages/coding-agent`（/Users/chenzheng/Desktop/Work/open_sources/pi），相关逻辑参考 claude-code（/Users/chenzheng/Desktop/Work/open_sources/claude-code）；apps/desktop 优先参考 deepseek-harness（/Users/chenzheng/Desktop/Work/open_sources/deepseek-harness），尤其 UI 交互与设计系统。
- 执行覆盖：本地图允许把执行带入路线——地图解决后按里程碑逐个走 grill-with-docs → to-spec → to-tickets → implement-spec → retro。每个实施票从 main 拆分支、在 worktree 开发，验收后合入 main 并清理 worktree。
- 仓库无 remote：research 分支与 PR 不可推送，研究结果保存在本目录 research/ 并随 main 提交。
- 环境事实：pnpm 12.15.0 经公司 Artifactory 安装；首次下载 pnpm 二进制需要 `NODE_TLS_REJECT_UNAUTHORIZED=0`（公司证书），之后缓存可用。Agent 宿主环境继承了 `ELECTRON_RUN_AS_NODE=1`，启动 Electron 或 E2E 前必须 unset。

- 用户指示（2026-10-29）：M3 交付（评审修复、复盘、标记 delivered）后暂停目标，等待用户继续，不开始 M4。

## Decisions so far

<!-- 一行一张已解决的票 -->

- [pi agent-core 1.4.0 与 coding-agent 的可复用结构](issues/01-research-pi-agent-core-and-coding-agent.md)：用 Agent 类接入点组合机制，持久化订阅 message_end；并发上限、依赖图自研；coding-agent 工具与指令加载多数可拷贝，grep/find 改纯 JS，bash 走 ports。
- [claude-code 的权限、Hooks、Plan Mode、子代理、压缩与 Todo 逻辑](issues/03-research-claude-code-agent-logic.md)：以社区还原版为行为参考；权限 deny 优先的分层流水线、Hook exit 2 阻断与聚合、Plan 作为权限模式、子代理权限不宽于父级、压缩阈值与熔断。
- [deepseek-harness 桌面端的进程、存储与 UI 结构](issues/02-research-dsh-desktop-architecture.md)：sidecar 进程与分级退出可直接移植，认证保持 ADR 0002；DSH 会话非 SQLite，需自行设计；三栏 IA 与设计 token 精确值可沿用。
- [技术栈依赖在本机的安装与运行可行性](issues/04-research-dependency-install-feasibility.md)：全部可装；需配 allowBuilds；Electron-as-Node 下 node:sqlite 与 BEGIN IMMEDIATE 互斥实测可用；E2E 前须 unset ELECTRON_RUN_AS_NODE。
- [设置与会话改存 SQLite 的存储边界](issues/05-grill-sqlite-persistence.md)：sidecar 独占单个 SQLite 库，packages/session 拥有 schema/迁移/事务，会话条目 append-only；见 ADR 0003（按常设指示采纳）。
- [从空仓库到完整应用的里程碑划分](issues/06-grill-milestone-route.md)：六个里程碑 M1 行走骨架 → M2 安全与恢复 → M3 上下文与指令 → M4 目标与任务 → M5 多代理与调度 → M6 扩展与交付，能力表逐行有归属。
- [首发模型提供方与凭据存储](issues/07-grill-model-providers-credentials.md)：pi-ai 三协议，四类 provider 预设；safeStorage 在 main 加密、密文存 SQLite（ADR 0004）。
- [桌面端信息架构与关键交互](issues/08-grill-desktop-information-architecture.md)：沿用 DSH 三栏几何与 composer dock，设置为 modal，Toast 用 Sonner；各界面按里程碑归属。
- [各能力的首发深度与验收口径](issues/09-grill-capability-depth.md)：Seatbelt 沙箱、node-pty、LSP stdio、浏览器经 MCP、本地插件、会话内团队；签名公证不交付。

## Not yet specified

路线已清晰，地图票全部解决。各里程碑内部的切片与验收场景在各自 `.scratch/<slug>/` 经 grill-with-docs 细化。

## Carry-overs

- M3：composer 草稿以 Lexical EditorState JSON 持久化，Markdown 导入导出用 @lexical/markdown（M1 票 07 裁决）。→ 已分配 M3 票 06；composer 保持纯文本，不引入 @lexical/markdown（M3 规划按常设指示改判后半句）。

- ~~M6：发布构建关闭 COKO_FAUX_SCRIPT 等测试钩子（构建期标志开启），产物 smoke 改用测试构建（M1 票 09 裁决）。~~ 已由 M2 票 11 提前解决；发布构建（不带 COKO_TEST_BUILD）的产物 E2E 留给 M6。
- M3：rg 读取全局 gitignore 与 .git/info/exclude，内置 grep 不读；在 Context Management 中决定是否对齐（M1 票 09）。→ 已分配 M3 票 10。

- ~~M2：模态对话框打开时 Toast 动作无法用键盘到达（M1 票 08）。~~ 已由 M2 票 10 解决。

- ~~M2：Sidecar 崩溃或重启时进行中的 Run 不留 run_end，启动恢复须把它们判定为中断并按幂等规则处理（M1 票 10）。~~ 已由 M2 票 08 解决。
- M4：Sidecar 被强杀时 bash 的 detached 子进程会继续运行到结束；stdio MCP 服务器子进程同理（M3 规划）。Background Jobs 与 Execution Runtime 需负责孤儿进程的登记与清理（M2 票 08）。
- ~~M2：B1 Provider kind 映射散落 6 处、B3 挂起请求加超时重复 4 处，随 M2 涉及的模块收敛（M1 Standards 评审）。~~ 已由 M2 票 10 解决。

- M3：J4 Secrets 对 bash 的隐藏只靠环境变量名模式；接入 MCP 凭据时改为显式白名单或按来源隔离（M2 Standards 评审）。→ 已分配 M3 票 07，按来源隔离，见 ADR 0007。
- M3：S2 条目派生逻辑在 server/agent 与 renderer 各一份、S3 SessionService 768 行，随 M3 改动 Session 时收敛（M2 Standards 评审）。→ 已分配 M3 票 01。

- M6：MCP HTTP Server 返回 401 时没有专门的 auth-required 状态，目前显示为普通失败（M3 票 07）。

- M4：M3 结构债 J1、J2、J4–J7（sessions.ts 535 行、runtime.ts 813 行、路由直接访问存储等）在引入 Goal / Plan 状态前收敛（M3 Standards 评审）。
- M4：新增读取根或注入点的票须附符号链接越界用例，秘密总闸扫描 requestLog（M3 复盘）。

## Route status

| 里程碑 | 目录 | 状态 |
| --- | --- | --- |
| M1 行走骨架 | `.scratch/m1-walking-skeleton/` | delivered（[复盘](../m1-walking-skeleton/retro.md)） |
| M2 安全与恢复 | `.scratch/m2-permissions-recovery/` | delivered（[复盘](../m2-permissions-recovery/retro.md)） |
| M3 上下文与指令 | `.scratch/m3-context-instructions/` | delivered（[复盘](../m3-context-instructions/retro.md)） |
| M4 目标与任务 | `.scratch/m4-goal-plan-tasks/` | next（用户指示 M3 后暂停，等待继续） |
| M5 多代理与调度 | `.scratch/m5-agents-scheduler/` | pending |
| M6 扩展与交付 | `.scratch/m6-extensions-delivery/` | pending |

## Out of scope

- Windows / Linux 构建与发布（TECH_STACK 首发范围仅 macOS arm64）。
- 代码签名、公证与发布更新 feed：需要 Apple 开发者证书与发布目的地，见 [各能力的首发深度](issues/09-grill-capability-depth.md)；自动更新只做接线。