# 09: 随包 ripgrep、日志落盘与打包 smoke

**What to build:** @vscode/ripgrep 经 apps/desktop 分发并传给 Sidecar，server 覆盖内置 grep；main 的 desktop.jsonl 与 renderer 日志转发；`electron-forge package` 产物 smoke（启动、一次对话、确认使用随包 ripgrep）。

**Blocked by:** 07

**Status:** ready-for-agent

- [x] ripgrep grep 通过与内置 grep 相同的契约测试
- [x] 路径不可执行时 Sidecar fatal 并在窗口提示
- [x] package 产物 E2E：启动并完成一次 faux 对话；日志显示生效的 grep 实现为 ripgrep
- [x] desktop.jsonl 与 sidecar.jsonl 存在且已脱敏

## Comments

- 2026-10-28 implementer（分支 m1/09-ripgrep-logging-package-smoke）：

**覆盖的验收**

- 契约：`apps/server/src/adapters/ripgrep.test.ts` 让 `createGrepTool({ cwd, searcher: createRipgrepSearcher(rgPath) })` 运行 `describeGrepContract`（17 项 + 1 项二进制缺失报错）。rg 参数：`--json --no-config --hidden --no-require-git --sort path --no-messages --glob !.git`，目录搜索以搜索目录为 cwd、路径参数为 `.`。逐个去掉 `--sort path`、`--glob !.git`、cwd 锚定，契约分别有 2 / 2 / 8 项失败。去掉 `--no-require-git` 时契约原本仍然全部通过：每个用例都写了 `.git/HEAD`，rg 把临时目录当成 git 仓库。因此在共享契约（`packages/agent/src/testing/grep-contract.ts`）里补了"目录不是 git 仓库时 .gitignore 仍生效"一项，内置 grep 与 ripgrep 都通过，去掉该参数时这一项失败。
- fatal：`tests/integration/sidecar-ripgrep.test.ts` 中，`--ripgrep` 不存在或不可执行时 fatal `ripgrep-unavailable` 并以 1 退出，没有 ready（探测在打开存储之前，不占租约）。窗口提示由 `apps/desktop/e2e/ripgrep-logging.e2e.test.ts` 覆盖：未打包路径下用 `COKO_RIPGREP_PATH` 注入 0644 文件，窗口进入 failed，显示 `data-error-code=ripgrep-unavailable`，sidecar 进程退出。错误对话框走同一个 `showSidecarError`，已由壳层 E2E 的 fatal 用例断言，这里没有重复替换 dialog。
- 实际经过给定路径：集成测试给 `--ripgrep` 传一个包装脚本，脚本记录调用后 exec 真实 rg。记录到 `--version` 探测和一次搜索，toolResult 为 `notes.txt:2: needle here`；sidecar.jsonl 中 `grep implementation selected { implementation: 'ripgrep', path, version }`。不传 `--ripgrep` 时记录 `builtin`。
- 产物 smoke：`apps/desktop/e2e/package-smoke.e2e.test.ts` 运行 `out/Coko-darwin-arm64/Coko.app`，环境中已清除 ELECTRON_RUN_AS_NODE、凭据与开发用变量。Fuses 关闭了 Node 调试参数，Playwright 的 `_electron.launch` 不可用，所以用 `--remote-debugging-port=0` 启动，再经 CDP 连接。断言内容：sidecar 子进程的命令行是 `Resources/sidecar/index.mjs … --ripgrep Resources/ripgrep/rg`；经协议代理登记 Workspace、从侧栏新建会话、发送；grep 工具卡 done，展开后含 `notes.txt:2: needle in the haystack`；回复按 Markdown 渲染；SIGTERM 后应用以 0 退出，sidecar 进程消失；sidecar.jsonl 的生效实现为 ripgrep，路径为随包 rg，并有 `run ended completed`。把 `dist/ripgrep` 从 extraResource 去掉后，该用例在等待连接时失败（sidecar fatal），说明能捕获漏打包。
- 日志：desktop.jsonl 有 `app starting`（packaged、ripgrep 路径）、`sidecar ready`（只记端口与 pid）、`app quitting`，每条带 `process: desktop`、`appVersion`。renderer 经 `window.coko.log` 转发的记录写为 `coko.renderer.*`，`source: renderer` 由 main 标记，renderer 传入的 source / process 被丢弃。转发内容中 `sk-…` 文本与 `apiKey` 字段已脱敏；两个文件都不含明文、sk 值或 43 字符令牌形态的串。未打包 E2E 与产物 smoke 都做了断言。`src/main/logging.test.ts` 覆盖校验（级别、分类、属性类型、16 KiB 上限、保留字段）和 JSONL 的实际内容。

**实现要点**

- apps/server：`config.ts` 接受可选的 `--ripgrep`（绝对路径）。`runtime/layers.ts` 新增 Tools 层，位于 Logging 之后、Store 之前，负责探测与生效实现日志。`SessionService` 新增可选参数 `tools: (cwd) => ToolRegistry`。`adapters/ripgrep.ts` 用 `createBuiltinToolRegistry` 加 `register(createGrepTool({ cwd, searcher }), { override: true })`，达到 limit 时终止 rg，abort 时 kill 子进程。
- apps/desktop：`build/build.ts` 的 `prepareRipgrep()` 把 @vscode/ripgrep 解析出的 rg 复制到 `dist/ripgrep/`。该包是 ESM，按自身位置解析平台包，不能打进 CommonJS main。Forge 的 preStart、prePackage 与 CLI 构建都会调用它，`extraResource` 增加 `dist/ripgrep`。main 在开发时用 `dist/ripgrep/rg`，打包后用 `Resources/ripgrep/rg`；`COKO_RIPGREP_PATH` 只在未打包时生效。
- main 日志模块 `src/main/logging.ts`；preload 与 bridge 新增 `log`（`ipcRenderer.send`，main 只收主窗口主框架的消息）；renderer 的 `app/renderer-log.ts` 转发未捕获错误、未处理的拒绝和连接失败。
- desktop-e2e 的 globalSetup 改为运行一次 `pnpm run package`：prePackage 构建的 dist 供未打包用例使用，out/ 供产物 smoke 使用，不做第二次构建。代价是每次 `pnpm run test` 都会打包一次（本机约 6 秒）。

**实际运行的命令与结果**（worktree，main 为 889bf44，合入时 Already up to date）

- `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run lint`（0 警告 0 错误）、`pnpm run format:check`、`pnpm run check:docs`（60 个文件 0 问题）：均退出 0。
- `pnpm run test`：48 个文件、365 个用例全部通过，其中 desktop-e2e 19 例（package-smoke 2、ripgrep-logging 2、chat 5、desktop-shell 10）、integration 中 sidecar-ripgrep 4 例、server 中 ripgrep 18 例、agent 中 grep 契约 17 例。
- `pnpm --filter desktop package`：退出 0；`Resources/ripgrep/rg` 可执行，`--version` 输出 ripgrep 15.0.0。应用为 adhoc 签名。

**未验证项**

- 已签名、公证的安装包；DMG / ZIP（makers 仍为空）；非 macOS arm64 平台。
- 产物中的目录选择对话框：产物无法替换 dialog，smoke 经协议代理登记 Workspace。
- rg 读取全局 gitignore（`core.excludesFile`）与 `.git/info/exclude`，内置 grep 不读。契约没有覆盖这种差异，已写入 apps/server README 的限制。
- 主 / sidecar 的 Effect 日志与 pi 事件适配、跨 IPC 的 requestId 关联（observability 约定的其余部分），本票未做。

**需要 Lead 注意**

- 与票 08 的合并点：`src/shared/bridge.ts`（IPC 常量与 CokoBridge 接口）、`src/preload/index.ts`、`src/main/index.ts`。本票只增加了 log 相关的几行。另外 `e2e/desktop-shell.e2e.test.ts` 的 bridge 键白名单改为 `['boot', 'log', 'pickDirectory']`，08 加入凭据方法后需要合并这一行。
- 共享契约文件 `packages/agent/src/testing/grep-contract.ts` 增加了一项（原属票 03）。
- `COKO_FAUX_SCRIPT` 与 `COKO_USER_DATA_DIR` 在打包产物中仍然生效（票 04 / 05 的既有设计），smoke 依赖这一点。是否在发布构建中关闭，留待后续决定。

**文档影响**

- `docs/TECH_STACK.md` 接入状态：apps/desktop 行增加 @vscode/ripgrep、@coko/logging；apps/server 行与根集成测试行增加 @vscode/ripgrep（devDependency，只用于解析二进制）。Agent 表中的 ripgrep 行改为"只由 apps/desktop 分发"。
- `docs/tech-stack/desktop-delivery.md` 的"内置 ripgrep"：开发与打包都使用复制到 `dist/ripgrep/` 的副本。
- `apps/server/README.md`：`--ripgrep` 参数、`ripgrep-unavailable`、生效实现日志、rg 参数与全局 gitignore 的限制、测试入口；删除"尚未实现 ripgrep"和"产物启动尚未验证"两句。
- ADR 0001 维持 partial：其 implemented 条件要求已签名安装包的 smoke。
