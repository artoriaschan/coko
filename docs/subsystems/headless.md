---
kind: reference
description: "当前的无界面运行（headless）：入口与参数、装配（headlessLayer）、输出格式 text / json / stream-json、退出码与信号、审批自动拒绝（approval_decision by headless）与 --on-approval、--provider-config 与 COKO_CREDENTIAL_<ID>、日志位置、打包产物与已知限制。在脚本或 CI 中运行 Coko、修改 headless 的参数、输出或审批行为前查阅。"
lifecycle: active
---

# 无界面运行

本文说明 Coko 当前如何不打开窗口运行一个任务：一个进程装配与 Sidecar 相同的应用层、提交一条消息、把事件与结构化结果写到 stdout 并以退出码结束。决定见 [ADR 0019](../adr/0019-headless-runs-deny-approvals.md)；stream-json 每一行的形状见 [协议](../../packages/protocol/README.md)；长期运行、可连接的服务是 standalone Sidecar（同一文档的"认证"一节）。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `apps/server/src/headless/args.ts` | 参数解析（`UsageError`） |
| `apps/server/src/headless/run.ts` | 装配、Workspace 与 Session、凭据检查、提交、订阅与结果、信号、退出码 |
| `apps/server/src/headless/output.ts` | 三种输出、用量合计、退出码表 |
| `apps/server/src/headless/approvals.ts` | `HEADLESS_DENIED_TEXT`、`approval_denied` |
| `apps/server/src/runtime/layers.ts` 的 headless 块 | `headlessLayer`（不含 HTTP）与不输出的控制通道 `silentControl` |
| `apps/server/src/application/providers.ts` | `ProviderService.upsertFromConfig` |
| `packages/agent/src/policy/gate.ts` | `RuntimePermissions.unattended`：需要审批的调用立即拒绝 |

## 运行

```text
ELECTRON_RUN_AS_NODE=1 <electron> <sidecar>/headless.mjs --data-dir <dir> (--workspace <dir> | --session <id>) (--prompt <text> | --prompt-file <file>)
  [--provider-config <file>] [--model <providerId/modelId>] [--permission-mode <mode>]
  [--output text|json|stream-json] [--max-turns <n>] [--on-approval deny|fail] [--log-dir <dir>] [--ripgrep <path>]
```

打包应用中为 `ELECTRON_RUN_AS_NODE=1 Coko.app/Contents/MacOS/Coko Coko.app/Contents/Resources/sidecar/headless.mjs …`；源码中为 `apps/server/src/headless/index.ts`（集成测试）。

- `--data-dir` 必填；桌面应用的默认数据目录是 `<COKO_HOME>/data`（缺省 `~/.coko/data`），与其相同时共用同一个库（租约互斥：桌面应用开着时 headless 启动失败，以 4 退出）。相对路径按当前目录解析。
- `--workspace` 不在库中时登记为 Workspace；`--session` 继续已有的根 Session（与 `--workspace` 同时给出时须属于它）；省略 `--session` 时新建 Session（权限模式为默认模式）。
- `--model` 写入 Session 的模型；`--permission-mode` 提交 `permission_mode` 条目（与界面切换相同）。
- `--max-turns`：根 Session 第 n 条 assistant 仍在调用工具时 `stopAfterBatch(max_turns)`，本批完成后以 paused 结束。
- `--log-dir` 缺省 `<data-dir>/logs`，日志写 `headless.jsonl`（JSONL、脱敏，字段同 Sidecar）。stdout 只有运行结果；console 输出与启动失败的说明写 stderr。
- `--ripgrep` 缺省：打包产物用随包的 `Resources/ripgrep/rg`（日志 `grep implementation selected { implementation: ripgrep }`），源码运行用内置 grep。
- 打包产物以 `--packaged` 装配：发布构建忽略测试钩子变量（`COKO_FAUX_SCRIPT` 等），测试构建接受，与 Sidecar 相同。

## 装配

`headlessLayer` 与 `sidecarLayer` 共用 Logging → Tools → Store → Processes → Assembly → Runs → App 各层，没有 HTTP；控制通道为 standalone 且不写 stdout，因此 Secret 只读 `COKO_SECRET_<NAME>`、Credential 只读 `COKO_CREDENTIAL_<ID>`（[ADR 0007](../adr/0007-secrets-from-registered-entries.md)、[ADR 0010](../adr/0010-provider-one-shot-save.md)）。启动恢复、上下文贡献（Skills、命令、MCP、Hook、Memory、子代理等）与有序关闭都和 Sidecar 相同。提交走 `SessionService.submit`（trigger submit，命令照常展开），输出经 hub 订阅根 Session。

## 输出

| `--output` | stdout |
| --- | --- |
| `text`（缺省） | 只有该 Run 最后一条 assistant 的文本；失败时说明写 stderr |
| `json` | 一行 result |
| `stream-json` | 根 Session 的每条 `entry` 与 `progress` 一行（与 WebSocket 推送的 `ServerMessage` 相同，已脱敏），最后一行 result |

`stream-json` 包含 `state_update` v1 条目（`{ name, value }`），按提交顺序排在承载对应块的 user message 之前；时间线隐藏这些快照不影响结构化输出。根 Session 的日期等状态与 Sidecar 使用同一套送达和来源规则，见[上下文管理](context.md#state-update)。

result：`{ type: 'result', status, sessionId, runId, text, usage: { input, output, cacheRead, cacheWrite, total, cost? }, durationMs, error?, approvalDenied? }`。`status` 为 Run 的结束状态（completed / error / paused / aborted / interrupted），Run 没能开始时为 `failed`（runId 为 null）。usage 为该 Run 的 `model_request` 之和（不含子代理 Session 的用量）；`cost` 在至少一个请求有费用时出现。

原生工具传输被 HTTP 400/422 拒绝时，结构化结果的 `error.code` 为 `incremental_tools_rejected`，`message` 保留服务端原文；文本格式在原文之后追加英文的 Provider 开关提示，见 [MCP 工具增量传输](mcp.md#provider-的工具增量传输)。

## 退出码

| 码 | 含义 |
| --- | --- |
| 0 | completed |
| 1 | Run 以 error 结束，或没能开始（`no-credential`、`model-not-configured`、`hook-blocked` 等） |
| 2 | paused（含 `--max-turns`）、aborted、interrupted，或收到 SIGINT / SIGTERM |
| 3 | 有调用因没有审批者被拒且给了 `--on-approval fail` |
| 4 | 参数错误或启动错误（参数不合、文件不可读或不是 JSON、Workspace 或 Session 不存在、Provider 配置无效、存储打不开） |

SIGINT / SIGTERM：中止进行中的 Run，等待 run_end 提交，写出 result（aborted）后以 2 退出。

## 审批

需要审批的调用（第 7 步的询问、询问规则、受保护路径、越出可写根、提权、计划审阅，含子代理的）不等待：PreToolUse 与判定照常，PermissionRequest Hook 先运行（allow 以 `by: hook` 放行，deny 拒绝）；没有 Hook 给出决定时立即提交 `approval_request` 与 `approval_decision { outcome: denied, by: headless }`，模型看到工具错误 `Denied: no approver in a headless run. Rerun with a wider --permission-mode or add an allow rule.`，Run 继续（不按无反馈的拒绝停止）。模型输出中自称已获批准的文本不改变判定。

- `--on-approval deny`（缺省）：如上，result 带 `approvalDenied: true`。
- `--on-approval fail`：拒绝之后 `stopAfterBatch({ code: 'approval_denied' })`（拒绝发生在子代理中时先停子代理），Run 以 paused 结束，进程以 3 退出。
- 拒绝文本是工具结果，不是 user message：不经宿主输入的识别，`runAuthority`、Goal 的用户输入判断与时间线的包装去除都不涉及它。

需要免审批时由调用者给出更宽的 `--permission-mode` 或允许规则（全局、Workspace 或项目设置）。

## Provider 配置

Provider 可带布尔字段 `incrementalTools`，行为与桌面设置一致；缺省值和使用条件见 [MCP 工具增量传输](mcp.md#provider-的工具增量传输)。启动配置更新或失败补偿会保留该字段的显式值。

`--provider-config <file>`：`{ "providers": ProviderFields[], "defaultModel"?: "<providerId>/<modelId>" }`。启动时 `upsertFromConfig` 先校验整份文件（密钥形态的字段名 `apiKey`、`api_key`、`secret`、`token`、`password`、`credentials`、`authorization` 等在任意深度出现即拒绝，消息不含值；协议 schema；能否构造模型；`defaultModel` 是否指向文件或库中的模型），全部通过后新建或更新（已有的 Credential 不变），中途写入失败时撤销已写入的；任一项失败以 4 退出，库不变。只在 headless 装配中可用，HTTP 与控制消息都不提供。

密钥只读 `COKO_CREDENTIAL_<ID>`（ID 大写、非字母数字换成下划线）。Session 将用的模型属于库中的 Provider 而变量缺失时 Run 不开始：result 为 `failed`、`error.code` 为 `no-credential`，以 1 退出。

## 已知限制

- 同一数据目录中到期的定时任务也会在 headless 进程运行期间开始（与 Sidecar 相同的定时器），它们的审批同样立即拒绝；进程退出时中止。
- stream-json 只输出根 Session 的消息；子代理的条目在库中（`agent_start.agentId` 即子 Session id）。
- 真实模型的 headless 运行未验证（需要凭据，规格的人工验证清单）。

## 验证

- `packages/agent/src/policy/gate-unattended.test.ts`：立即拒绝（by headless）、同批多个调用、PermissionRequest 的 allow 优先、受保护路径。
- `apps/server/src/application/providers.test.ts`：`upsertFromConfig` 的整份写入、第二个无效时库中没有 Provider、写入中途失败的补偿、密钥字段、schema 与 defaultModel。
- `tests/integration/headless.test.ts`：stream-json 的每行 schema 与 result、text、`--session`、Workspace 登记、参数错误 4、SIGTERM 2、日志位置、`--provider-config` 与 `no-credential`。
- `tests/integration/headless-approvals.test.ts`（对手用例）：拒绝文本与 by headless、`--on-approval fail` 退出 3、Hook 代答、伪造的批准文本、子代理。
- `tests/integration/secrets-gate-headless.test.ts`：三种输出、stderr、日志、库与 faux requestLog 中没有 Credential、Secret 与宿主密钥。
- `apps/desktop/e2e/package-smoke.e2e.test.ts`：打包应用中 `Resources/sidecar/headless.mjs` 的 stream-json 以 completed 结束、退出 0、使用随包 ripgrep。
