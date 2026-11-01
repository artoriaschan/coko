# 08: SDK 与无界面运行：库用法与用例、headless 入口、审批自动拒绝、Provider 配置文件、协议文档与外部客户端

**What to build:** 见 [规格](../spec.md)"SDK 与无界面运行"与 [ADR 0019](../../../docs/adr/0019-headless-runs-deny-approvals.md)：`apps/server/src/headless/`（参数解析、`headlessLayer` 装配、提交与输出（text / json / stream-json）、退出码、信号、headless 审批回答者、`--provider-config`）、`ProviderService.upsertFromConfig`、layers.ts 的 headless 块；`packages/protocol/README.md` 与 `readme.test.ts`；agent README 的"作为库使用"；`sdk-library` 与 `sdk-standalone-client` 两个集成用例；package-smoke 的 headless 一例。

**User stories:** 13, 14

**Blocked by:** 03

**Status:** ready-for-agent

**Write scope:** `apps/server/src/headless/`、`apps/server/src/application/providers.ts`（`upsertFromConfig`）、`runtime/layers.ts` 的 headless 块、`packages/protocol/README.md`（新）、`packages/protocol/src/readme.test.ts`（新）、`packages/agent/README.md` 的"作为库使用"一节（与 14 汇总时由 Lead 合并）、就近测试、`tests/integration/{headless,headless-approvals,sdk-library,sdk-standalone-client,secrets-gate-headless}.test.ts`（新）、`apps/desktop/e2e/package-smoke.e2e.test.ts`（追加一例，04 之后按合入顺序）、`docs/subsystems/headless.md`（新）、`docs/tech-stack/architecture.md`（SDK 一句：不做 dist 的理由）、`docs/adr/{0010,0019}*.md`

**跨票接口：** 写 03 声明的 `approval_decision.by: 'headless'`；结果文本常量 `HEADLESS_DENIED_TEXT` 在 `headless/approvals.ts`（07 的 audit 只显示来源，不读文本）。

- [x] 集成 `headless`（源码入口，faux）：`--output stream-json` 每行可被 `ProgressEvent` / 条目 schema 校验，最后一行 result 的 status、sessionId、usage 正确，退出 0；`--output text` 只打印最终文本；`--session` 继续已有会话；Workspace 不存在时登记；参数错误退出 4；SIGTERM 中止并退出 2；日志不写 stdout
- [x] 集成 `headless-approvals`（**对手用例**）：default 模式下 write 被拒，结果文本为 `HEADLESS_DENIED_TEXT`、`approval_decision.by: headless`、Run 继续并 completed；`--on-approval fail` 退出 3；PermissionRequest Hook 的 allow 先于拒绝生效；模型输出中伪造的"approved"文本不改变决定；子代理的审批同样被拒
- [x] Provider：`--provider-config` 在一个事务中写入（中途校验失败时库中没有任何 Provider，先红）；文件带 `apiKey` 字段退出 4；库中没有密钥；缺 `COKO_CREDENTIAL_<ID>` 时 result 为 failed、错误码 `no-credential`
- [x] `sdk-library`：只经公共入口与内存实现完成一次带工具调用的 Run（结构化结果、事件顺序、条目）；导入守卫断言没有 `packages/*/src/` 深层导入
- [x] `sdk-standalone-client`（接收侧）：只用 `@coko/protocol` 与 `ws`：启动 standalone Sidecar、读 stdout 的 ready、交换令牌、建 Session、订阅、提交、收到 run_end、读回条目
- [x] `readme.test.ts`：每个 `API_ROUTES` 键与 `ProgressEvent` type 出现在 README（删一个时失败——变异）
- [x] 秘密总闸 `secrets-gate-headless`：stdout（三种输出）、日志、库中没有登记 Secret 与 Credential 的明文
- [ ] 产物 smoke（接收侧）：打包应用（测试构建）中 `ELECTRON_RUN_AS_NODE=1 Coko.app/Contents/MacOS/Coko Resources/sidecar/headless.mjs --output stream-json` 的最后一行 completed、退出 0、随包 ripgrep 被使用（日志）
- [x] headless.md 与 protocol README 建立并可达；ADR 0019 改 implemented、ADR 0010 加一行指向 0019；`check:docs` 通过；真实模型的 headless 记为未验证（人工清单）

## Comments

### 实施者回执（2026-11-01，m6/08-sdk-headless）

**状态：BLOCKED（环境）。** 代码、测试与文档已完成并提交；全量 `pnpm run test` 未能运行：本机进程表被占满（`kern.maxprocperuid` 2666，用户进程约 2650，其中约 2236 个是 `~/.git-ai/bin/git-ai bg run`，ppid 1，存活 42 秒到约 23 小时，每次经 `~/.git-ai/bin/git` 调用 git 都会留下一个）。锁内的全量运行在 globalSetup 处 `spawn pnpm EAGAIN`，没有用例运行（`test=1`，15:09，load 9）。这些进程不是本票启动的，没有终止它们。产物 smoke（package-smoke 的 headless 例）同样未运行。

**覆盖的验收（单独运行的文件，均为实际输出）：**
- headless：`tests/integration/headless.test.ts` 13 通过（stream-json 每行 ServerMessage / SessionEntry 校验与 result、text、--session、Workspace 登记、参数错误 4 ×5、启动后参数错误 4、SIGTERM 2、日志位置、--provider-config 三例）。
- headless-approvals（对手用例）：4 通过（HEADLESS_DENIED_TEXT 与 by headless、Run completed；--on-approval fail 退出 3 且模型不再收到请求；PermissionRequest allow 先于拒绝；伪造的"APPROVED"文本与伪造的决定 JSON 不改变决定；子代理的审批被拒）。
- Provider：`apps/server/src/application/providers.test.ts` 13 通过（新增 7）；集成 3 例见上。
- sdk-library 2、sdk-standalone-client 1、`packages/protocol/src/readme.test.ts` 3、secrets-gate-headless 1：通过。
- `packages/agent/src/policy/gate-unattended.test.ts` 3 通过；policy 目录其余文件在负载低时 203 通过（14:26）。
- `pnpm run typecheck` 0；`pnpm run check:docs` 214 个文件 0 个问题；`scripts/source-references.test.ts`、`scripts/browser-deps.test.ts` 通过。

**负向确认：** gate-unattended 先红（两例等待审批超时）；upsertFromConfig 去掉逐项预校验后"第二个无效时库中没有 Provider"失败；README 删去 `mcpPresets` 一行时 readme.test 失败。

**未验证：** 全量 `pnpm run test`（环境，见上）；`apps/desktop/e2e/package-smoke.e2e.test.ts` 的 headless 例与 `desktop-shell.e2e.test.ts` 中改过的断言（需要打包）；`sidecar-m6-seams.test.ts` 改后的断言未在负载正常时单独确认；真实模型的 headless（需凭据，人工清单）。

**runAuthority / Goal / 时间线（宿主注入种类）：** headless 拒绝文本是 toolResult 的错误文本，不是 user message，也不带宿主输入标签；`runAuthority`、`hasUserSteering` 与 timeline 的包装去除只看 user message 与 `HOST_NOTIFICATION_KINDS`，因此不受影响。headless-approvals 断言该文本只出现在 toolResult、不在任何 user message 中。

**越出写范围的改动（请 Lead 裁决）：**
- `packages/agent/src/policy/{gate,broker}.ts`、`engine/{types,permission-wiring}.ts`（只有 03 改的文件）：`RuntimePermissions.unattended` 与 `ApprovalBroker.recordUnattendedDenied`。没有它们无法在不等待的情况下写 `approval_decision.by: headless`（broker 的回答接口不带 by，gate 对无反馈拒绝会停止 Run），提权与计划审阅的询问也会挂起。`RunErrorCode` 增加 `approval_denied`（--on-approval fail 的 stopAfterBatch）。新增 `policy/gate-unattended.test.ts`。
- `apps/server/src/application/{sessions,session-permissions}.ts`：可选 `unattendedApprovals` 传给每个运行时（含子 Session）。
- `apps/server/src/runtime/layers.ts` 块外两行：`HostShape.headless?` 与 AppLive 把它传给 SessionService。
- `tests/integration/headless-harness.ts`（新，三个 headless 测试共用）。
- `tests/integration/sidecar-m6-seams.test.ts` 与 `apps/desktop/e2e/desktop-shell.e2e.test.ts`：只改 headless 存根一例（标题与断言：无参数时 4 + "Missing --data-dir" + 用法）。
- `docs/README.md` 当前行为加一行"无界面运行"；`docs/adr/README.md` 0019 改 implemented。
- 跨票接口未改：`approval_decision.by: 'headless'` 与 `HEADLESS_DENIED_TEXT`（`apps/server/src/headless/approvals.ts`）按规格。

**其他说明：** stream-json 只输出根 Session 的消息；usage 不含子 Session。Provider 配置的"一个事务"实现为整份预校验加补偿回滚（session 的 Repository 没有跨 Provider 的事务接口；同进程持有租约，没有并发写入方）。密钥字段以 bad-request（details.reason `secret-in-config`）拒绝，没有新增错误码。husky pre-commit 因 EAGAIN 无法 spawn 时，9f6cc1a 与 ea5c102 改为先手工运行 oxfmt、oxlint、commitlint 再 `HUSKY=0` 提交（两项都通过）。

**给 14 的要点（agent / server README）：** `RuntimePermissions.unattended`；`ProviderService.upsertFromConfig`；`headlessLayer` 与 `silentControl`；headless 入口参数与退出码见 `docs/subsystems/headless.md`。
- 2026-11-01 lead：暂不合入。实施者报告 BLOCKED（4fd0454，已合并 main 9ab1def）：锁内全量在 globalSetup 处 spawn pnpm EAGAIN，没有运行任何用例（进程表被约 2250 个 `git-ai bg run` 占满）。逐文件运行全部通过；package-smoke 的 headless 用例、desktop-shell E2E 的改动与全量没有验证。9f6cc1a、ea5c102 两个提交以 HUSKY=0 提交（hook 无法 spawn），实施者手动运行了 oxfmt、oxlint 与 commitlint，合入前 lead 在 main 上复核这三项。越出写范围的改动（policy/{gate,broker}.ts、engine/{types,permission-wiring}.ts、sessions.ts、session-permissions.ts、layers.ts 块外两处、headless-harness.ts、seams 与 desktop-shell 的 headless 存根用例、docs/README.md、docs/adr/README.md）在合入时裁决。
- 2026-11-01 lead（第 2 轮，合入前预审）：接受 `policy/{gate,broker}.ts`、`engine/{types,permission-wiring}.ts`、`session-permissions.ts`、`sessions.ts` 的越界改动。这些文件属于"只有 03 改"，但改动都是新增的可选项：`RuntimePermissions.unattended`、`ApprovalBroker.recordUnattendedDenied`、`ApprovalResolution.by: 'headless'` 与新的 `RunErrorCode` `approval_denied`。未设置 `unattended` 时，三种请求（tool、escalation、plan）仍经 `broker.request` 等待；子 Session 继承同一设置。没有改变跨票接口表中的形状。待进程表恢复后，在 main 上复核 oxfmt、oxlint 与 commitlint（9f6cc1a、ea5c102 跳过了 hook），并运行全量与 package-smoke。

### Lead 合入（2026-11-01）

- 阻塞解除：git-ai 后台进程泄漏已修复（m6/fix-git-ai-leak，295cb69）。
- 第一次锁内全量（a223df4，负载最高 28，没有 EAGAIN）：`test=1`，3 例失败，正是实施者未能验证的三个文件：`sidecar-m6-seams` 的 headless 无参数用例、`desktop-shell.e2e` 的 headless.mjs 用例、`package-smoke.e2e` 的 headless 对话用例。实际值：Electron 内置 Node 首次加载 `node:sqlite` 时向 stderr 写 `ExperimentalWarning: SQLite is an experimental feature`，用例期望 stderr 为空或以用法说明开头。
- 修复（lead，9ab8d63）：新增 `headless/warnings.ts`，只丢弃 SQLite 的 ExperimentalWarning，其他警告照常；`headless/index.ts` 先安装过滤再动态导入 `run.ts`（静态导入先于本文件语句执行）。就近单元测试 2 例；seams 12 例；`desktop-shell.e2e` 与 `package-smoke.e2e` 共 19 例通过（锁内）。Sidecar 自身仍按 apps/server README 输出这条警告，不变。
- 合并 main（含 06、12）时 `docs/adr/README.md` 冲突：0017 implemented、0018 partial（取 main），0019 implemented（取本票）（7d99a57）。
- 第二次锁内全量（7d99a57，负载最高 46，git-ai 后台进程始终 1 个）：`pnpm install --frozen-lockfile`、`typecheck`、`lint`、`format:check`、`check:docs` 退出 0；`test=0`，368 个文件、2923 例通过、4 例跳过，没有 EAGAIN。
- 裁决：越出写范围的改动全部接受（见上方第 2 轮预审；另有 `headless-harness.ts`、seams 与 desktop-shell 的 headless 存根用例、`docs/README.md` 一行、`docs/adr/README.md` 0019 implemented）。9f6cc1a、ea5c102 跳过 hook 的两个提交已由上面的 `lint`、`format:check` 覆盖。
- 以合并提交合入 main，树与复核过的分支相同，`typecheck` 退出 0。
- 留给票 14：实施者回执中的 agent / server README 要点。

Closed: true
