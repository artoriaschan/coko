# 10: M1 评审修复

**What to build:** 修复 [Standards 评审](../review-standards.md)（A* / B*）与 [规格评审](../review-spec.md)（F*）中 Lead 指定的问题，每项先写能捕获它的失败测试再修：安全与数据（A1、A2、A6 = F9、F5），用户故事（F1、F2、F3、F8），规范（A13、A4、A7、A8 / A9、A10、A11、A12、A14、A18、F6），文档（F7）。不做的 judgement 项在评审文件末尾的"处理结果"中逐项说明理由。

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09

**Status:** ready-for-agent

- [x] A1：retry 进度的 errorMessage 推送前脱敏，与入库同一函数
- [x] A2：bash 子进程环境剔除 COKO_* 与凭据形态的变量，保留 PATH / HOME
- [x] A6 / F9：先取租约再 quick_check 与隔离；租约被占用时不碰文件
- [x] F5：代理与 sidecar 两侧按规范化路径判断 auth exchange，sidecar 只接受 main 的调用方式
- [x] F1："打开日志文件夹"诊断入口；stderr 脱敏写入 desktop.jsonl；ready 后退出时重启、重新交换并通知 renderer，连续失败进入 failed 并弹对话框（Electron E2E）
- [x] F2：⌘N 新建会话；任意焦点下 Escape 停止 Run，对话框打开时只关对话框（Browser Mode + E2E）
- [x] F3：progress 增加 run_end；run_end 提交失败时仍推送，客户端不停在运行中
- [x] F8：重试重新执行上一轮，不追加用户消息；E2E 断言已更新，票 07 Comments 已说明
- [x] A13、A4、A7、A8 / A9、A10、A11、A12、A14、A18、F6
- [x] F7：apps/server README 与 spec 协议一节登记 provider-presets、models、WS unsubscribe、COKO_CREDENTIAL_*
- [x] 两份评审文件末尾追加"处理结果"
- [x] 全量 `pnpm run test`（含 desktop E2E 与产物 smoke）通过

## Comments

- 2026-10-29 implementer（分支 m1/10-review-fixes，worktree ../coko-worktrees/10-review-fixes，基于 main 656d127，合入前 main 无新提交）：

**覆盖的验收**

逐项见 [review-standards 处理结果](../review-standards.md#处理结果) 与 [review-spec 处理结果](../review-spec.md#处理结果)，每项都列了测试。除 A7 / A8 / A9 / F7（文档与依赖声明）外，每项的用例都先观察到按预期原因失败，再修复。A18 另做了变异检查：把提交屏障的 `await` 临时改掉后用例失败，已撤销。

**实现要点**

- 安全：`@coko/protocol` 新增 `normalizeRoutePath` / `isMainOnlyPath`；`@coko/agent` 的 `createLocalExecPort({ excludeEnv })` 与导出的 `filterEnv`；server 的 `HOST_ENV_EXCLUSIONS`（adapters/credentials.ts）；session 的打开序列改为租约 → quick_check → 版本 → pragma。
- Run 生命周期：agent 新增 `runtime.retry()` 与 `NothingToRetryError`，ProgressEvent 增加 `run_end`；protocol 新增错误码 `nothing-to-retry`（409）与 `apiPaths.sessionRetry`。
- 桌面：`SidecarSupervisor` 接管 SidecarProcess 的创建、重启与端点；bridge 新增 `openLogs`、`onSidecarState`（IPC `coko:open-logs`、`coko:sidecar-state`）；ConnectionState 新增 `restarting`，failed 带 `crashed`。main 的原生对话框文案移到 i18n 的 `main.*`，删除 messages.ts。
- UI：theme.css 新增 `focus-ring` 工具类；ToolCard 错误态 1px；侧栏搜索；app-frame 的抽屉在内容已聚焦时不再抢焦点。

**实际运行的命令与结果**（worktree，HEAD 为本票最后一个提交）

- `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run lint`（0 警告 0 错误）、`pnpm run format:check`、`pnpm run check:docs`（62 个文件 0 问题）：均退出 0。
- `pnpm run test`：55 个文件，438 通过、1 跳过（settings.e2e 的真实 DeepSeek 用例，本机无 DEEPSEEK_API_KEY）。开始前的基线为 52 个文件，390 通过、1 跳过。其中包含 desktop-e2e 的全部用例（desktop-shell 12、chat 6、settings 2 + 1 跳过、ripgrep-logging 2、package-smoke 2）和产物 smoke。
- 新增和改动的用例单独重复运行：sidecar-supervisor + sidecar-process 2 次、desktop-shell.e2e 2 次、runtime + timeout 3 次，全部通过。

**与规格 / 评审建议的差异（请 Lead 裁决）**

- ADR 0002 的 implementation 由 partial 改为 implemented：它列出的验收场景，加上 main 代理、头注入、非主窗口升级与重启后重新交换，现在都有集成测试或 Electron E2E 证据。ADR 0001 仍为 partial，剩余已签名安装包的 smoke。
- F1 选的是"重启 + 重新交换"，不是"只进入 failed"。上限 3 次、间隔 250 毫秒 / 1 秒 / 3 秒、稳定 60 秒后清零，都写在 desktop-delivery.md。首次启动失败不重启。
- F8 选的是方案 (1)，新增 retry 路由与错误码。原 retry 的出错 assistant 消息仍留在库中，模型上下文按 pi-ai 的规则跳过它。commit_failed 的 Run 不提供重试（记录不完整）。
- A7 选的是"保留现状、改写归属"：apps/server 不新增 tsdown 配置。
- A13：Dialog 内容容器与侧栏抽屉容器保留 `outline-none`，它们是焦点容器，不是控件。
- A14 的测试读的是 CSSOM 声明宽度：Chromium 的 computed style 在 DPR 1 与 2 下都把 0.5px 取整为 1px（已用探针确认），computed width 无法区分。

**未验证项**

- 真实模型对话（无凭据）；非 macOS 平台；已签名安装包。
- F1 的重启只在 SIGKILL 下验证，没有覆盖 sidecar 在 HTTP 请求进行中退出的场景。重启期间正在进行的 Run 会随旧进程中断，它的 run_end 条目不会写入；重连后客户端以已提交的条目为准。
- ⌘N 在 Electron 默认菜单下没有冲突（E2E 已验证）；自定义应用菜单接入后需要复核。

**文档影响**

- docs/tech-stack/architecture.md（构建归属、目录树）、desktop-delivery.md（构建职责、时限、重启与诊断入口）、docs/adr/0001、0002 与 docs/adr/README.md、docs/TECH_STACK.md 接入状态（apps/desktop 行加 @coko/server、@coko/i18n）。
- apps/server/README.md（--app-version、/api/auth 守卫、retry 路由、WS unsubscribe、run_end progress、bash 环境剔除、构建归属）；packages/session/README.md（打开序列、租约、损坏、版本过高）。
- .scratch：spec.md 的协议一节、票 07 Comments、两份评审的"处理结果"。
