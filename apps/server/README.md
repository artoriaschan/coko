---
kind: reference
description: "apps/server（Sidecar）的启动参数、控制 IPC、访问认证、HTTP / WebSocket 协议、关闭顺序与测试入口。装配、启动或调用 Sidecar 前查阅。"
lifecycle: active
---

# apps/server（Sidecar）

Sidecar 是运行 Hono 服务与 Agent 的 Node 进程：由 Electron main 以 `ELECTRON_RUN_AS_NODE=1` 启动，也能脱离桌面独立运行。本文说明当前实现的入口与契约；消息与 DTO 的精确定义在 `@coko/protocol`（`packages/protocol/src`）。尚未实现：ripgrep 版 grep 覆盖（`--ripgrep` 参数）、权限审批、恢复中断的 Run。

## 使用或结构入口

```text
<electron> apps/server/src/index.ts --data-dir <dir> --log-dir <dir>
```

| 输入 | 含义 |
| --- | --- |
| `--data-dir` | 必填，绝对路径；库文件为 `<dir>/coko.db` |
| `--log-dir` | 必填，绝对路径；日志为 `<dir>/sidecar.jsonl`（JSONL，10 MiB × 5 份轮转） |
| `COKO_FAUX_SCRIPT` | 仅测试：faux provider 脚本的绝对路径，格式见 `src/adapters/faux.ts`；开启后新建 Session 默认使用 `faux/faux-1` |
| `COKO_LOG_LEVEL` | `trace`…`fatal`，默认 `info` |
| `COKO_CREDENTIAL_<PROVIDER_ID>`、`DEEPSEEK_API_KEY`、`OPENAI_API_KEY`、`ANTHROPIC_API_KEY` | 仅独立运行模式读取的 Credential，见下文 |

未知参数、缺失或相对路径都按 `invalid-arguments` fatal。源码目录按 [项目架构约定](../../docs/tech-stack/architecture.md#仓库架构) 划分：`http/`（Hono 路由、信任围栏与 cookie）、`ws/`（订阅与补发）、`application/`（协议到 agent / session 的映射）、`runtime/`（Effect 装配与关闭）、`adapters/`（Credential、faux）、`control/`（控制通道）。

## 契约与生命周期

- **控制通道。** 有 Node IPC 父进程时经 IPC 收发 `SidecarToMainMessage` / `MainToSidecarMessage`；否则为独立运行，消息逐行写到 stdout，不接收 main 消息。启动依次发 `starting`、`ready { port, token }`；失败发 `fatal { code, message }` 并以 1 退出，`code` 取值：`invalid-arguments`、`storage-<StoreError code>`（如 `storage-lease-held`）、`faux-script-invalid`、`listen-failed`、`startup-failed`。不合 schema 的 main 消息被忽略并记录警告。
- **访问认证**（[ADR 0002](../../docs/adr/0002-local-service-access-auth.md)）。只监听 `127.0.0.1` 端口 0。所有请求先过信任围栏：`Host` 必须等于监听 authority，带 `Origin` 时必须是 `http://<authority>`，`sec-fetch-site: cross-site` 拒绝，失败 403。`POST /api/auth/exchange { token }` 只能成功一次，返回 204 与 `coko-session` cookie（`HttpOnly; SameSite=Strict; Path=/`，HMAC 绑定 authority，签名密钥只在进程内存）；其余路由与 WebSocket 升级缺少有效 cookie 返回 401。令牌不接受作为 Authorization 头。
- **HTTP。** 路径常量为 `API_ROUTES` / `apiPaths`：workspaces（列表、登记已存在的绝对目录）、sessions（列表、创建、详情含条目、`POST …/messages` 返回 202 与 `runId`、`POST …/abort`、`PUT …/model`）、settings（`PUT /api/settings/:key` 带 `expectedRevision`，冲突 409）、providers（增改删，响应只含 `credential: { hint } | null`）。错误体为 `{ error: { code, message, details? } }`。
- **Session 模型。** 新建时未指定模型，依次取设置 `defaultModel`、faux（测试）、第一个 Provider 的第一个模型；都不可用时为 null，提交消息返回 409 `model-not-configured`。同一 Session 同时只有一个 Run（409 `run-in-progress`）。
- **WebSocket**（`/api/ws`）。客户端 `subscribe { sessionId, afterSeq }`；服务端先补发 `seq > afterSeq` 的 `entry`，再发 `subscribed { lastSeq, running }`，之后推送实时 `entry` 与 `progress`，不重复也不遗漏。`entry` 在 SQLite 提交后才发布；`progress` 不持久化。条目 kind 为 `message`（payload 是模型可见消息，role 为 user / assistant / toolResult）与 `run_end`（`{ status, error? }`）。模型错误文本入库前脱敏。
- **Credential**（[ADR 0004](../../docs/adr/0004-model-credentials-safe-storage.md)）。IPC 模式：main 发 `credential.store { providerId, ciphertext(base64), hint }`，Sidecar 只存密文并回 `credential.store.result`；调用模型时发 `credential.decrypt { ciphertext }`，等待 `credential.decrypt.result`（10 秒超时），明文只缓存在内存，换密钥或删 Provider 时清除。独立运行：`COKO_CREDENTIAL_<ID>`（id 大写、非字母数字换成 `_`）优先，否则按 kind 读对应的 `*_API_KEY`。
- **关闭。** `shutdown` 消息、IPC 断开、SIGTERM、SIGINT 触发同一次有序关闭：停止 HTTP 并以 1001 关闭 WebSocket → 中断进行中的 Run 并等待其 `run_end`（status `aborted`）提交 → 关闭存储并释放租约 → 刷新日志 → 发 `shutdown-complete`，以 0 退出。`inspect-quit` 回答 `activeRuns`。

## 配置与限制

- 工具不经审批直接执行（M1 已知安全缺口），只应在用户信任的 Workspace 中使用。
- faux 脚本的回复队列由所有 Session 共用，按模型调用顺序消费。
- 进程首次加载 `node:sqlite` 时向 stderr 输出一次 ExperimentalWarning。
- 集成测试从源码入口运行；桌面构建由 apps/desktop 的 tsdown 配置打出 `dist/sidecar/index.mjs`，其启动与对话由 apps/desktop 的 Electron E2E 验证（未打包的开发路径）；`electron-forge package` 产物上的启动尚未验证。

## 验证与相关设计

- `tests/integration/sidecar-*.test.ts`：以 `ELECTRON_RUN_AS_NODE=1` 启动真实 Sidecar，覆盖 ready、ADR 0002 的 401 / 403 场景（含 WebSocket 与重启后旧 cookie）、对话与工具写文件、停止、运行中关闭、重启读回、afterSeq 补齐、设置与 Provider、Credential 的 IPC 往返与环境变量模式、日志与库脱敏、启动失败。运行：`pnpm exec vitest run tests/integration`。
- `src/http/auth.test.ts`、`src/config.test.ts`：同一 authority 下其他实例签发的 cookie 被拒绝、参数解析。
- 进程模型见 [ADR 0001](../../docs/adr/0001-sidecar-on-electron-node.md)。

## 延伸阅读

- [项目架构约定](../../docs/tech-stack/architecture.md#本地服务访问认证)：认证与服务装配的约定。
- [@coko/session](../../packages/session/README.md)：存储打开序列、租约与错误。
- [日志与诊断约定](../../docs/tech-stack/observability.md)：日志字段与脱敏要求。
