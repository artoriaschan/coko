# M1 行走骨架：规格

Status: ready-for-agent
Spec status: approved（按用户常设指示采纳推荐，2026-10-28）
Map: [Coko 桌面应用](../desktop-app/map.md) · [里程碑划分](../desktop-app/issues/06-grill-milestone-route.md)

## Problem Statement

仓库只有文档。用户无法打开 Coko、配置模型、在自己的目录中让 Agent 读写文件和运行命令；后续里程碑（权限、恢复、Goal、子代理等）也没有可以依附的进程、协议、存储与界面骨架。

## Solution

交付一个能在 macOS arm64 本地启动的 Coko：Electron 窗口经 `coko-app://` 加载 React 界面，main 以 `ELECTRON_RUN_AS_NODE` 启动 Sidecar 并完成访问认证；Sidecar 打开 SQLite 库，承载 Agent。用户登记 Workspace、配置 Provider 与 Credential 后新建 Session，发送消息，看到流式回复与工具卡；Agent 使用内置工具读写文件、执行命令；重启应用后 Session 与设置仍在。

## User Stories

1. As a 开发者, I want 运行一条命令安装依赖并通过 typecheck、lint、test, so that 每个后续切片都有统一的质量入口。
2. As a 用户, I want 双击启动应用后看到主窗口, so that 我可以开始使用 Coko。
3. As a 用户, I want 窗口遵循 macOS 外观（隐藏标题栏、红绿灯、侧栏材质）, so that 应用看起来是原生的。
4. As a 用户, I want 应用启动时 Sidecar 自动就绪，失败时看到可理解的错误与诊断入口, so that 我知道应用是否可用。
5. As a 用户, I want 退出应用时 Sidecar 被干净地关闭, so that 不留下孤儿进程。
6. As a 用户, I want 运行中退出时被询问确认, so that 不会误中断 Agent。
7. As a 安全敏感用户, I want 本地服务拒绝没有凭据或跨站的请求, so that 其他进程和网页无法驱动我的 Agent。
8. As a 用户, I want 选择本机目录登记为 Workspace, so that Agent 在这个目录中工作。
9. As a 用户, I want 在侧栏按 Workspace 分组看到 Session 列表, so that 我能回到之前的对话。
10. As a 用户, I want 新建 Session 并发送消息, so that 我能向 Agent 布置任务。
11. As a 用户, I want 看到模型回复逐字流式出现并以 Markdown 渲染, so that 我能及时阅读。
12. As a 用户, I want Agent 调用工具时看到工具卡（命令与输出、读取的文件、编辑 diff、写入的文件、搜索结果）, so that 我知道它做了什么。
13. As a 用户, I want 随时停止正在进行的 Run, so that 我能纠正方向。
14. As a 用户, I want 模型或工具出错时看到简短错误并可重试, so that 失败不会让我卡住。
15. As a 用户, I want 重启应用后 Session 列表、历史消息与工具卡完整保留, so that 工作不会丢失。
16. As a 用户, I want 在设置中添加 DeepSeek、OpenAI、Anthropic 或自定义 OpenAI 兼容 Provider（地址、模型、Credential）, so that 我可以用自己的模型账号。
17. As a 用户, I want Credential 只显示"已配置"和末四位, so that 密钥不会在界面泄露。
18. As a 用户, I want 在输入区切换当前 Session 的模型, so that 我可以按任务选模型。
19. As a 用户, I want 未配置 Provider 时发送入口引导我去设置, so that 我知道下一步。
20. As a 用户, I want 切换明暗主题和中英文界面, so that 界面符合我的习惯。
21. As a 用户, I want 窄窗口下侧栏自动收起为窄栏且主要操作仍可达, so that 小窗口也能用。
22. As a 用户, I want 键盘可以完成新建、发送、停止和关闭弹窗, so that 我不必依赖鼠标。
23. As a 开发者, I want Agent 的 grep 在桌面端使用随包 ripgrep、单独运行时使用纯 JS 实现，两者结果契约一致, so that 搜索快且可测试。
24. As a 开发者, I want main 与 Sidecar 写结构化日志并对密钥脱敏, so that 可以诊断问题而不泄露凭据。
25. As a 开发者, I want 不需要真实模型密钥就能运行 Agent、Sidecar 和桌面端测试, so that CI 和本机验证可重复。
26. As a 开发者, I want `electron-forge package` 产出的应用能启动并完成一次对话, so that 打包链路从第一天就可验证。

## Implementation Decisions

讨论记录：本规格的 grilling 按用户常设指示由 Agent 提出推荐并采纳；依据见地图已解决的票与 ADR 0001–0004。

**Workspaces 与构建**
- 按 [项目架构约定](../../docs/tech-stack/architecture.md) 建立 apps/desktop、apps/server 与 packages/protocol、agent、session、ui、logging、i18n。
- 共享包以 TypeScript 源码为导出入口（`exports` 指向 `src`），由消费方的 tsdown / Vite / Vitest 直接编译；apps/server 与 apps/desktop 的 tsdown 构建把 workspace 包打进产物。这是对"非 UI 共享包各自输出 dist"的简化，M1 内记录于 architecture.md；需要独立发布 SDK 时（M6）再为 agent 增加 dist 构建。
- 根脚本：`typecheck`（tsc -b）、`lint`（oxlint）、`format`（oxfmt）、`test`（vitest projects）、`check:docs`；husky + lint-staged + commitlint 接入。`pnpm-workspace.yaml` 加入依赖安装研究给出的 allowBuilds，@logtape/logtape 的 Agent skills 不安装。
- 启动 Electron 与 E2E 的脚本显式清除 `ELECTRON_RUN_AS_NODE`。

**packages/protocol**
- TypeBox schema 与推导类型：HTTP 请求/响应 DTO、WebSocket 消息、错误码、Sidecar 控制 IPC 消息。
- HTTP：认证交换、health、workspaces（列表、登记）、sessions（列表、创建、详情含条目、提交消息、重试上一轮、停止 Run、切换模型）、settings（读取、带 revision 的更新）、providers（列表、增改删，不含密钥）、provider-presets（预设 kind 的默认地址与模型目录，供设置界面选择，用户故事 16）、models（已注册 Provider 的可用模型与默认模型，供模型选择，用户故事 18）。重试（`POST /api/sessions/:id/retry`）重新执行以模型错误结束的上一轮，不追加用户消息（票 10，评审 F8）。
- WebSocket：客户端 `subscribe { sessionId, afterSeq }` 与 `unsubscribe { sessionId }`（协议保留，M1 renderer 不发送）；服务端推送 `entry`（已提交的 Session Entry，带 seq）与 `progress`（临时：文本增量、工具执行进度、Run 状态，带 runId），两者明确区分；每个 Run 以 `progress run_end { status, error? }` 结束，run_end 条目提交失败时也发出；断线重连以 afterSeq 补齐。
- 独立运行的 Credential 环境变量：`COKO_CREDENTIAL_<PROVIDER_ID>` 优先，否则按 kind 读 `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`（见 apps/server README）。
- Sidecar 控制 IPC：sidecar → main：starting、ready { port, token }、fatal { code, message }、shutdown-complete、credential.decrypt { requestId, ciphertext }；main → sidecar：shutdown、inspect-quit、credential.store { providerId, ciphertext }、credential.decrypt.result。

**packages/session**（[ADR 0003](../../docs/adr/0003-settings-and-sessions-in-sqlite.md)）
- 公共入口：SessionRepository（workspaces、sessions、append-only entries，带会话内 seq）、SettingsRepository（键值 JSON + revision 乐观并发）、ProviderRepository（provider 配置与 Credential 密文）。
- SQLite 入口：打开序列、编号前向迁移、`VACUUM INTO` 迁移前备份、版本过高拒绝、`host_lease` 租约、`quick_check` 失败隔离；内存入口用于单元测试。

**packages/agent**（[研究](../desktop-app/research/pi-agent-core-and-coding-agent.md)）
- engine：封装 pi `Agent`，暴露 createAgentRuntime / run / abort / subscribe；持久化经 message_end 的可等待订阅提交，工具结果按模型调用顺序；文本增量只作 progress。
- models：pi-ai 按 provider 子路径导入；Chat Completions、Responses、Anthropic Messages 三协议；可重试错误有限重试；CredentialStore 端口；faux provider 用于测试。
- tools：注册表（扩展、显式覆盖、未声明重名报错）；内置 read、write、edit、bash、grep（纯 JS + ignore）、find、ls，参数 schema 与截断（2000 行 / 50KB）沿用 pi coding-agent；bash 经 ports 的执行接口；统一超时与取消。
- 最小 Hook 接入：before/after tool call 的内部调度点，供 M2 的权限与观测挂接。
- M1 不做权限审批：工具直接执行。**这是已知的安全缺口**，仅在用户自己的 Workspace 中运行，M2 补齐。

**apps/server（Sidecar）**
- [ADR 0001](../../docs/adr/0001-sidecar-on-electron-node.md)、[ADR 0002](../../docs/adr/0002-local-service-access-auth.md) 的启动、监听、认证与信任围栏原样实现；Effect 管理资源与关闭。
- 启动参数：数据目录、日志目录、ripgrep 路径（可选）、测试用 faux 脚本（仅测试构建 / 环境变量开启）。
- 提供 ripgrep 版 grep 覆盖内置 grep；路径给定但不可执行时 fatal。
- 独立运行（无 IPC 父进程）时把 ready 信息写到 stdout，Credential 从环境变量读取。

**apps/desktop**
- main：单实例锁、窗口（hiddenInset、红绿灯、vibrancy、最小尺寸）、Sidecar 生命周期（spawn、ready、fatal 提示、inspect-quit 确认、shutdown → 10s SIGTERM → 5s SIGKILL）、`coko-app://` 协议代理与 cookie 注入、WebSocket 头注入、目录选择对话框、safeStorage 加解密（[ADR 0004](../../docs/adr/0004-model-credentials-safe-storage.md)）、日志落盘与 renderer 日志转发。
- preload：只暴露 boot 信息（WebSocket 基址、平台、locale）、目录选择、Credential 设置、日志转发。
- renderer：React 19 + Zustand vanilla store + 协议客户端；三栏布局与几何沿用 [信息架构决定](../desktop-app/issues/08-grill-desktop-information-architecture.md)；M1 包含侧栏 Session 列表、消息流（Streamdown）、工具卡、基础 composer（Lexical，Enter 发送、Shift+Enter 换行，IME 组合期间不提交）、模型选择、设置弹窗（General / Models / About）、Sonner Toast。
- Forge：tsdown 构建 main / preload / sidecar，Vite 构建 renderer；Fuses 保持 RunAsNode；extraResource 携带 sidecar 与 ripgrep。

## Testing Decisions

- 好的测试只断言外部事实：协议响应与事件、数据库重新读回的内容、工作区文件内容、窗口中实际渲染与交互结果。
- 测试接口（由高到低，尽量少）：
  1. **Sidecar 协议**（主接口）：Vitest 以 `ELECTRON_RUN_AS_NODE=1` 启动真实 Sidecar（faux provider），经 HTTP / WebSocket 验证认证、Workspace、Session、消息流、停止、重启读回、设置与 Provider。
  2. **packages/agent 运行时**：faux provider + 临时 Workspace，验证循环、工具、顺序、取消、错误；内置 grep 与 ripgrep grep 运行同一组契约测试。
  3. **packages/session**：SQLite 入口在临时目录验证迁移、提交读回、租约冲突、损坏隔离、版本过高拒绝。
  4. **Electron E2E**：Playwright 驱动真实 Electron（faux provider），覆盖启动、登记 Workspace、对话与工具卡、停止、重启后历史保留、设置 Provider、主题切换、窄窗口。
  5. **产物 smoke**：对 `electron-forge package` 产物运行 E2E 的启动与一次对话场景。
- UI 组件：Vitest Browser Mode 覆盖 composer 的 IME 与快捷键、工具卡的未知工具展示。
- 真实模型：具备环境变量凭据时运行一条真实对话场景，否则报告未验证。
- 无既有测试可参考；首个切片建立 fixture（临时目录、端口 0、子进程清理）作为后续先例。

## Out of Scope

- 权限审批、沙箱、恢复中断的 Run、checkpoint / rewind（M2）。
- AGENTS.md / Skills / Commands / MCP / 压缩 / Memory（M3）；Goal / Plan / Todo / 后台任务 / PTY（M4）；Hooks 外部配置、子代理、调度、分叉、worktree（M5）；插件、团队、LSP、浏览器、Evals、DMG 与自动更新（M6）。
- 签名与公证。

## Further Notes

- M1 运行工具不经审批，只应在用户信任的 Workspace 中使用。
- Agent 宿主环境带 `ELECTRON_RUN_AS_NODE=1`，所有启动 Electron 的脚本与测试先清除它。
