---
kind: reference
description: "apps/server（Sidecar）的启动参数、控制 IPC、访问认证、HTTP / WebSocket 协议、关闭顺序与测试入口。装配、启动或调用 Sidecar 前查阅。"
lifecycle: active
---

# apps/server（Sidecar）

Sidecar 是运行 Hono 服务与 Agent 的 Node 进程：由 Electron main 以 `ELECTRON_RUN_AS_NODE=1` 启动，也能脱离桌面独立运行。本文说明当前实现的入口与契约；消息与 DTO 的精确定义在 `@coko/protocol`（`packages/protocol/src`）。工具调用经权限判定与审批，契约见 [权限判定与审批](../../docs/subsystems/permissions.md)。尚未实现：命令沙箱与提权、恢复中断的 Run。

## 使用或结构入口

```text
<electron> apps/server/src/index.ts --data-dir <dir> --log-dir <dir> [--ripgrep <rg>] [--app-version <version>]
```

| 输入 | 含义 |
| --- | --- |
| `--data-dir` | 必填，绝对路径；库文件为 `<dir>/coko.db` |
| `--log-dir` | 必填，绝对路径；日志为 `<dir>/sidecar.jsonl`（JSONL，10 MiB × 5 份轮转） |
| `--ripgrep` | 可选，绝对路径；给定时启动先运行 `<rg> --version`，失败按 `ripgrep-unavailable` fatal（不回退内置 grep），成功则以 ripgrep 版 grep 覆盖内置 grep（`src/adapters/ripgrep.ts`）。未给定时使用内置纯 JS grep。生效实现记入日志 `grep implementation selected { implementation, path?, version? }` |
| `--app-version` | 可选，版本号形态（如 `1.2.3`、`1.2.3-beta.1`）；写入 sidecar.jsonl 每条记录的 `appVersion` 统一字段。desktop main 传入 `app.getVersion()` |
| `COKO_FAUX_SCRIPT` | 仅测试：faux provider 脚本的绝对路径，格式见 `src/adapters/faux.ts`；开启后新建 Session 默认使用 `faux/faux-1` |
| `COKO_LOG_LEVEL` | `trace`…`fatal`，默认 `info` |
| `COKO_CREDENTIAL_<PROVIDER_ID>`、`DEEPSEEK_API_KEY`、`OPENAI_API_KEY`、`ANTHROPIC_API_KEY` | 仅独立运行模式读取的 Credential，见下文。`<PROVIDER_ID>` 为 Provider id 大写、非字母数字换成 `_`，优先于按 kind 读取的 `*_API_KEY` |

未知参数、缺失、相对路径或不合形态的版本号都按 `invalid-arguments` fatal。源码目录按 [项目架构约定](../../docs/tech-stack/architecture.md#仓库架构) 划分：`http/`（Hono 路由、信任围栏与 cookie）、`ws/`（订阅与补发）、`application/`（协议到 agent / session 的映射）、`runtime/`（Effect 装配与关闭）、`adapters/`（Credential、faux）、`control/`（控制通道）。

## 契约与生命周期

- **控制通道。** 有 Node IPC 父进程时经 IPC 收发 `SidecarToMainMessage` / `MainToSidecarMessage`；否则为独立运行，消息逐行写到 stdout，不接收 main 消息。启动依次发 `starting`、`ready { port, token }`；失败发 `fatal { code, message }` 并以 1 退出，`code` 取值：`invalid-arguments`、`ripgrep-unavailable`、`storage-<StoreError code>`（如 `storage-lease-held`）、`faux-script-invalid`、`listen-failed`、`startup-failed`。不合 schema 的 main 消息被忽略并记录警告。
- **访问认证**（[ADR 0002](../../docs/adr/0002-local-service-access-auth.md)）。只监听 `127.0.0.1` 端口 0。所有请求先过信任围栏：`Host` 必须等于监听 authority，带 `Origin` 时必须是 `http://<authority>`，`sec-fetch-site: cross-site` 拒绝，失败 403。`POST /api/auth/exchange { token }` 只能成功一次，返回 204 与 `coko-session` cookie（`HttpOnly; SameSite=Strict; Path=/`，HMAC 绑定 authority，签名密钥只在进程内存）。`/api/auth` 下的路由只供 main 调用：按规范化后的路径（百分号解码、合并重复斜杠、去掉末尾斜杠、不区分大小写）判断，只接受原样路径、不带 cookie 的 POST，其余形态（含 `%65xchange` 等编码变体和经 renderer 代理、带 cookie 的请求）返回 404 且不消耗令牌；其余路由与 WebSocket 升级缺少有效 cookie 返回 401。令牌不接受作为 Authorization 头。
- **HTTP。** 路径常量为 `API_ROUTES` / `apiPaths`：workspaces（列表、登记已存在的绝对目录）、sessions（列表、创建、详情含条目；Session 带 `running` 与派生的 `activity`（当前取值 idle / running / awaiting-approval，协议另已声明 awaiting-confirmation、paused、interrupted）、`POST …/approvals/:requestId` 回答待审批请求（`AnswerApprovalRequest`，204；请求不在等待中 409 `approval-not-pending`；scope 为 session / workspace / global 时先保存请求的建议规则，没有建议规则的请求只能 `once`，否则 400）、`PUT …/permission-mode`、`GET / POST / DELETE …/permission-rules`（返回 `SessionPermissionsResponse`）、`POST …/messages` 返回 202 与 `runId`、`POST …/retry` 重新执行出错的上一轮并返回 202 与新 `runId`（不追加用户消息；上一轮没有以模型错误结束时 409 `nothing-to-retry`）、`POST …/abort`、`PUT …/model`）、`GET / PUT /api/permissions`（默认模式与全局、Workspace 规则，带 revision；路径见 `permissionPaths`）、settings（`PUT /api/settings/:key` 带 `expectedRevision`，冲突 409；`permissions.*` 键只能经 /api/permissions 修改，此处 400）、providers（增改删，响应只含 `credential: { hint } | null`）、`GET /api/provider-presets`（deepseek / openai / anthropic 的默认地址与目录中的模型 id，供设置界面选择）、`GET /api/models`（已注册 Provider 的可用模型，测试时含 faux，以及新建 Session 的默认模型，没有时为 null）。错误体为 `{ error: { code, message, details? } }`。
- **Session 模型。** 新建时未指定模型，依次取设置 `defaultModel`、faux（测试）、第一个 Provider 的第一个模型；都不可用时为 null，提交消息返回 409 `model-not-configured`。同一 Session 同时只有一个 Run（409 `run-in-progress`）。
- **WebSocket**（`/api/ws`）。客户端 `subscribe { sessionId, afterSeq }`，`unsubscribe { sessionId }` 停止接收该 Session 的推送（renderer 当前不发送，打开过的会话保持订阅）；服务端先补发 `seq > afterSeq` 的 `entry`，再发 `subscribed { lastSeq, running }`，之后推送实时 `entry` 与 `progress`，不重复也不遗漏。`entry` 在 SQLite 提交后才发布；`progress` 不持久化。条目在线上为信封 `SessionEntryRecord`，客户端按 kind 判别的 `SessionEntry` 逐条校验并跳过不合格条目；各 kind 的 payload 由 agent 定义（`SESSION_ENTRY_PAYLOADS`），存储按注册表写入校验、读取迁移，读取时跳过的条目记 warn `session entry skipped { sessionId, seq, kind, payloadVersion, reason }`。每个 Run 的条目以 `run_start { trigger: submit | retry }`（第一次模型请求前提交）开始、以 `run_end { status, error? }` 结束，中间为 `message`（payload 是模型可见消息，role 为 user / assistant / toolResult），需要审批的调用在其 toolResult 之前有 `approval_request` 与 `approval_decision`；新 Session 的第一条是 `permission_mode`（初始模式，不属于任何 Run），之后的模式切换与 Session 规则增删为 `permission_mode` / `permission_rule`；其余 M2 kind 已注册，由后续功能提交。`progress` 依次为 `run_start`、`assistant_delta`、`tool_start` / `tool_update` / `tool_end`、`retry`，每个 Run 以 `run_end { status, error? }` 结束：它在 run_end 条目提交之后发出，条目提交失败（例如租约被夺走）时也发出，客户端据此结束运行中状态。模型错误文本在入库与推送（`retry.errorMessage`、`run_end.error.message`）前经同一函数脱敏。
- **Credential**（[ADR 0004](../../docs/adr/0004-model-credentials-safe-storage.md)）。IPC 模式：main 发 `credential.store { providerId, ciphertext(base64), hint }`，Sidecar 只存密文并回 `credential.store.result`；调用模型时发 `credential.decrypt { ciphertext }`，等待 `credential.decrypt.result`（10 秒超时），明文只缓存在内存，换密钥或删 Provider 时清除。独立运行：`COKO_CREDENTIAL_<ID>`（id 大写、非字母数字换成 `_`）优先，否则按 kind 读对应的 `*_API_KEY`。
- **关闭。** `shutdown` 消息、IPC 断开、SIGTERM、SIGINT 触发同一次有序关闭：停止 HTTP 并以 1001 关闭 WebSocket → 中断进行中的 Run 并等待其 `run_end`（status `aborted`）提交 → 关闭存储并释放租约 → 刷新日志 → 发 `shutdown-complete`，以 0 退出。`inspect-quit` 回答 `activeRuns`。

## 配置与限制

- 每个 Session 有一个 Permission Mode（read-only / default / accept-edits / full-access），模式与 Session 规则由条目回放，全局与 Workspace 规则由 `PermissionService`（`application/permissions.ts`）从设置读入并缓存；判定与规则语法见 [权限判定与审批](../../docs/subsystems/permissions.md)。命令尚未在沙箱中运行，只应在用户信任的 Workspace 中使用。
- `SessionService` 的 `extensions(ctx) => { hooks?, onEntry? }` 供 `runtime/layers.ts` 为每个 Session 运行时注册扩展（hooks 排在权限判定之后，onEntry 在每条条目提交并发布后调用）；当前没有注册任何扩展。
- bash 的命令环境去掉 sidecar 自身的配置与凭据变量（`src/adapters/credentials.ts` 的 `HOST_ENV_EXCLUSIONS`）：`COKO_*`（含 `COKO_CREDENTIAL_*`、`COKO_FAUX_SCRIPT`、`COKO_LOG_LEVEL`）、各 kind 的 `*_API_KEY`，以及名字含 `API_KEY`、`TOKEN`、`SECRET`、`PASSWORD`、`CREDENTIAL(S)`、`AUTH` 的变量；`PATH`、`HOME` 等其余变量保留。工具输出本身不脱敏。
- faux 脚本的回复队列由所有 Session 共用，按模型调用顺序消费。
- 进程首次加载 `node:sqlite` 时向 stderr 输出一次 ExperimentalWarning。
- 集成测试从源码入口运行。本包不单独输出产物：桌面构建由 apps/desktop 的 `build/build.ts` 用 tsdown 打出 `dist/sidecar/index.mjs`（apps/desktop 以 workspace 依赖声明本包），其启动与对话由 apps/desktop 的 Electron E2E 验证，未打包路径与 `electron-forge package` 产物（`e2e/package-smoke.e2e.test.ts`）各有覆盖。
- ripgrep 版 grep 的参数：`--json --no-config --hidden --no-require-git --sort path --glob !.git`，目录搜索以搜索目录为 cwd、路径参数为 `.`。rg 默认还读取全局 gitignore（`core.excludesFile`）与 `.git/info/exclude`，内置 grep 不读，两者在这类文件存在时结果可能不同。

## 验证与相关设计

- `tests/integration/sidecar-*.test.ts`：以 `ELECTRON_RUN_AS_NODE=1` 启动真实 Sidecar，覆盖 ready、ADR 0002 的 401 / 403 场景（含 WebSocket 与重启后旧 cookie）、对话与工具写文件、审批闭环（`sidecar-approvals.test.ts`）、模式与规则作用域、重启后保留与重新判定（`sidecar-permissions.test.ts`）、停止、运行中关闭、重启读回、afterSeq 补齐、设置与 Provider、Credential 的 IPC 往返与环境变量模式、日志与库脱敏、启动失败；`sidecar-storage.test.ts` 覆盖损坏库隔离（fatal `storage-corrupt`）、版本过高拒绝（fatal `storage-version-too-new`，库文件逐字节不变）与读取时跳过不合格条目；`secrets-gate.test.ts` 是秘密不外泄总闸，扫描 WebSocket 帧、HTTP 响应体、`coko.db`（含 `-wal`）与 `sidecar.jsonl`，引入新输出通道的功能在该文件追加驱动步骤。运行：`pnpm exec vitest run tests/integration`。
- `src/adapters/ripgrep.test.ts`：ripgrep 版 grep 运行 `@coko/agent/testing` 的 grep 契约套件。`tests/integration/sidecar-ripgrep.test.ts`：`--ripgrep` 不存在或不可执行时 fatal、给定时 grep 实际经该路径执行、日志记录生效实现。
- `src/http/auth.test.ts`、`src/config.test.ts`：同一 authority 下其他实例签发的 cookie 被拒绝、参数解析。
- 进程模型见 [ADR 0001](../../docs/adr/0001-sidecar-on-electron-node.md)。

## 延伸阅读

- [项目架构约定](../../docs/tech-stack/architecture.md#本地服务访问认证)：认证与服务装配的约定。
- [@coko/session](../../packages/session/README.md)：存储打开序列、租约与错误。
- [日志与诊断约定](../../docs/tech-stack/observability.md)：日志字段与脱敏要求。
