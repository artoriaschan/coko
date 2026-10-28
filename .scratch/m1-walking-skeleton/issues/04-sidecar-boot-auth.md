# 04: Sidecar 启动、认证与 Session 协议

**What to build:** apps/server：进程入口（IPC 与独立运行两种模式）、127.0.0.1 端口 0、启动令牌与 cookie 交换、信任围栏、Hono 路由与 WebSocket（subscribe / entry / progress）、application 层把协议映射到 agent 与 session、Effect 资源管理与分级关闭、LogTape 文件日志与脱敏（packages/logging）。测试用 faux provider 由环境变量开启。

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [x] Vitest 以 `ELECTRON_RUN_AS_NODE=1` 启动真实 Sidecar 并收到 ready
- [x] ADR 0002 列出的 401 / 403 场景全部通过，含 WebSocket 升级与 Sidecar 重启后旧 cookie 被拒
- [x] 登记 Workspace → 新建 Session → 提交消息：WebSocket 收到 progress 与 entry，Agent 写入的文件存在
- [x] 停止 Run 后收到取消条目；重启 Sidecar 后 Session 条目完整读回；afterSeq 重连补齐缺失条目
- [x] 日志文件中不出现令牌、cookie 与密钥

## Comments

### 2026-10-28 实施（分支 m1/04-sidecar-boot-auth）

覆盖的验收（tests/integration，以 `ELECTRON_RUN_AS_NODE=1` 启动真实 Sidecar 源码入口，faux provider 由 `COKO_FAUX_SCRIPT` 开启）：

- ready：`sidecar-boot.test.ts`，starting → ready { port, 43 字符令牌 }，交换后 health 200，shutdown 后 exit 0。
- ADR 0002：`sidecar-auth.test.ts`（12 项）。错误令牌 / 重复交换 401，cookie 属性；无 cookie、篡改 cookie、令牌作 Authorization 头 401；非 loopback Host、localhost 别名、错端口、跨站 Origin、`null`、未改写的 coko-app Origin、`sec-fetch-site: cross-site` 带或不带 cookie 都 403（围栏先于认证，被拒的交换不消耗令牌）；WebSocket 升级 401 / 403 / 通过；重启后旧 cookie 在 HTTP 与 WebSocket 均 401。另 `apps/server/src/http/auth.test.ts` 证明同一 authority 下另一实例签发的 cookie 被拒（密钥吊销，而非仅端口变化）。临时去掉 Origin 校验与令牌作废，10 项失败，已验证后恢复。
- 对话闭环：`sidecar-session.test.ts`。登记 Workspace → 新建 Session（默认 faux 模型）→ 提交：progress（run_start、assistant_delta、tool_start/end，全部带同一 runId）与 entry（user、assistant、toolResult、assistant、run_end，seq 1..5）分开推送；文件 `notes/hello.txt` 内容正确；详情接口与推送条目一致。
- 停止与恢复：abort 后 run_end `aborted`（bash `sleep 30` 在 10 秒内结束）；重启后条目逐项一致；afterSeq=2 只补发 3..N；运行中第二个连接从 afterSeq=1 订阅，与实时条目衔接不重不漏；运行中收到 shutdown 时 Run 以 aborted 提交后才关闭存储，WebSocket 收到 1001（把 FiberMap 监管去掉时该测试失败，已验证）。
- 日志脱敏：`sidecar-settings-credentials.test.ts`。sidecar.jsonl 中不含启动令牌、cookie 值、密钥明文与密文；日志确有请求与 Run 记录。模型服务在错误中回显 sk- 密钥时，日志与库都不含该密钥（发现模型错误文本会进入 run_end 并入库，已在提交前脱敏）。packages/logging 的单元测试覆盖字段与自由文本脱敏、JSONL 行格式。

另外覆盖：设置 revision 冲突 409（details 带 expected/actual）；Provider 增改删与无效配置 400；Credential IPC 往返（credential.store 只存密文、回 credential.store.result；调用模型时 credential.decrypt，假模型服务收到 `Bearer <明文>`；库文件不含明文）；独立运行（ready 写 stdout、DEEPSEEK_API_KEY、SIGTERM 退出 0）；fatal：invalid-arguments、storage-lease-held（第二个实例，同时证明写者互斥）、faux-script-invalid；IPC 断开后自行退出。

与规格或并行票的差异（请 Lead 裁决）：

- 控制 IPC：在规格列出的集合上增加了 `credential.store` 的 `requestId`、`hint`（main 由明文算出末四位，sidecar 不见明文）与应答 `credential.store.result`；密文以 base64 字符串传输（Node IPC 默认 JSON 序列化，Uint8Array 不能原样往返）。`inspect-quit.result { requestId, activeRuns }` 沿用票 05 的定义。
- packages/protocol 的 `control.ts`、`api.ts`、`index.ts` 以票 05 分支（34d8fe3）的同名文件为基础原样保留其全部定义后扩展，合并时与票 05 冲突的这三个文件可直接取本分支版本；`/api/auth/exchange`（POST JSON，204 + Set-Cookie）、`/api/health`、`/api/ws` 与票 05 的 main 和占位 sidecar 一致，cookie 名同为 `coko-session`。
- 启动参数只接受 `--data-dir`、`--log-dir`（票 05 的 main 传这两个）；`--ripgrep` 留给票 09，未知参数按 fatal 处理。
- 根 `package.json` 增加 devDependencies（electron、ws、@types/ws、typebox、@coko/protocol）供 tests/integration 使用，根 tsconfig include 增加 `tests/**/*.ts`，根 vitest.config.ts 加 `tests/integration/vitest.config.ts` 一条。
- 删除了 apps/server/src/index.test.ts：入口现在会启动进程，改由集成测试与 config 单元测试覆盖。

实际运行的命令与结果（worktree，合入 main 之前）：

- `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run lint`（0 warnings / 0 errors）、`pnpm run format:check`：通过。
- `pnpm run test`：29 个文件、190 个用例通过。`pnpm exec vitest run tests/integration` 再连续 3 次，每次 27 个通过。
- `pnpm run check:docs`：60 个文件、0 个问题。

未验证：tsdown 构建产物（dist/sidecar）上的启动，目前只从源码入口运行；与票 05 真实 main 的联调（cookie 注入、WebSocket 头注入链路）；main 一侧的 safeStorage（票 08）；真实模型 API（无密钥）。

文档影响：新增 apps/server/README.md（当前行为参考）；ADR 0001、0002、0004 implementation not-started → partial，0003 的 partial 说明更新，均写明剩余项；docs/adr/README.md 索引同步；TECH_STACK 接入状态表新增 apps/server、packages/protocol、packages/logging 与根集成测试依赖四行，原"apps/server 与其余 packages"改为"其余 packages"。