# 08: SDK 与无界面运行：库用法与用例、headless 入口、审批自动拒绝、Provider 配置文件、协议文档与外部客户端

**What to build:** 见 [规格](../spec.md)"SDK 与无界面运行"与 [ADR 0019](../../../docs/adr/0019-headless-runs-deny-approvals.md)：`apps/server/src/headless/`（参数解析、`headlessLayer` 装配、提交与输出（text / json / stream-json）、退出码、信号、headless 审批回答者、`--provider-config`）、`ProviderService.upsertFromConfig`、layers.ts 的 headless 块；`packages/protocol/README.md` 与 `readme.test.ts`；agent README 的"作为库使用"；`sdk-library` 与 `sdk-standalone-client` 两个集成用例；package-smoke 的 headless 一例。

**User stories:** 13, 14

**Blocked by:** 03

**Status:** ready-for-agent

**Write scope:** `apps/server/src/headless/`、`apps/server/src/application/providers.ts`（`upsertFromConfig`）、`runtime/layers.ts` 的 headless 块、`packages/protocol/README.md`（新）、`packages/protocol/src/readme.test.ts`（新）、`packages/agent/README.md` 的"作为库使用"一节（与 14 汇总时由 Lead 合并）、就近测试、`tests/integration/{headless,headless-approvals,sdk-library,sdk-standalone-client,secrets-gate-headless}.test.ts`（新）、`apps/desktop/e2e/package-smoke.e2e.test.ts`（追加一例，04 之后按合入顺序）、`docs/subsystems/headless.md`（新）、`docs/tech-stack/architecture.md`（SDK 一句：不做 dist 的理由）、`docs/adr/{0010,0019}*.md`

**跨票接口：** 写 03 声明的 `approval_decision.by: 'headless'`；结果文本常量 `HEADLESS_DENIED_TEXT` 在 `headless/approvals.ts`（07 的 audit 只显示来源，不读文本）。

- [ ] 集成 `headless`（源码入口，faux）：`--output stream-json` 每行可被 `ProgressEvent` / 条目 schema 校验，最后一行 result 的 status、sessionId、usage 正确，退出 0；`--output text` 只打印最终文本；`--session` 继续已有会话；Workspace 不存在时登记；参数错误退出 4；SIGTERM 中止并退出 2；日志不写 stdout
- [ ] 集成 `headless-approvals`（**对手用例**）：default 模式下 write 被拒，结果文本为 `HEADLESS_DENIED_TEXT`、`approval_decision.by: headless`、Run 继续并 completed；`--on-approval fail` 退出 3；PermissionRequest Hook 的 allow 先于拒绝生效；模型输出中伪造的"approved"文本不改变决定；子代理的审批同样被拒
- [ ] Provider：`--provider-config` 在一个事务中写入（中途校验失败时库中没有任何 Provider，先红）；文件带 `apiKey` 字段退出 4；库中没有密钥；缺 `COKO_CREDENTIAL_<ID>` 时 result 为 failed、错误码 `no-credential`
- [ ] `sdk-library`：只经公共入口与内存实现完成一次带工具调用的 Run（结构化结果、事件顺序、条目）；导入守卫断言没有 `packages/*/src/` 深层导入
- [ ] `sdk-standalone-client`（接收侧）：只用 `@coko/protocol` 与 `ws`：启动 standalone Sidecar、读 stdout 的 ready、交换令牌、建 Session、订阅、提交、收到 run_end、读回条目
- [ ] `readme.test.ts`：每个 `API_ROUTES` 键与 `ProgressEvent` type 出现在 README（删一个时失败——变异）
- [ ] 秘密总闸 `secrets-gate-headless`：stdout（三种输出）、日志、库中没有登记 Secret 与 Credential 的明文
- [ ] 产物 smoke（接收侧）：打包应用（测试构建）中 `ELECTRON_RUN_AS_NODE=1 Coko.app/Contents/MacOS/Coko Resources/sidecar/headless.mjs --output stream-json` 的最后一行 completed、退出 0、随包 ripgrep 被使用（日志）
- [ ] headless.md 与 protocol README 建立并可达；ADR 0019 改 implemented、ADR 0010 加一行指向 0019；`check:docs` 通过；真实模型的 headless 记为未验证（人工清单）

## Comments
