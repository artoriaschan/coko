# 05: PTY 与 stdin：node-pty 端口、tty 后台任务、job_input、打包与产物 smoke

**What to build:** 见 [规格](../spec.md) "PTY 与 stdin" 一节：agent `ports/pty.ts` 的 `PtyPort`；bash `tty`（须同时后台）；Job kind `pty`；`job_input { job_id, text, submit?, ctrl_c? }`（权限类 bash，判定对象为 text）；server `adapters/pty.ts`（node-pty，沙箱 argv 前缀，cwd 为 Workspace 真实路径，120×30，登记进程 kind pty）与 layers.ts 接线；没有端口时 `pty-unavailable`。打包：sidecar tsdown 把 node-pty 保留为 external，构建步骤复制 `package.json`、`lib/`、`prebuilds/darwin-arm64/` 到 `dist/sidecar/node_modules/node-pty/` 并设 spawn-helper 0755；产物 smoke 启动 PTY Job。

**User stories:** 14

**Blocked by:** 04

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/ports/{pty,exec,local-exec}.ts`、`packages/agent/src/tools/builtin/bash.ts`、`packages/agent/src/tasks/jobs/`、`packages/agent/src/session-entries/jobs.ts`、`packages/protocol/src/jobs.ts`、`apps/server/src/adapters/pty.ts`（新）、`apps/server/src/application/{jobs,context/jobs}.ts`、`apps/server/src/http/routes/jobs.ts`、`apps/server/src/runtime/layers.ts`、`apps/desktop/build/build.ts`、`apps/desktop/tsdown.config.ts`、`apps/desktop/forge.config.ts`、`apps/desktop/e2e/package-smoke.e2e.test.ts`、`tests/integration/{sidecar-pty,secrets-gate-pty}.test.ts`（新）、`docs/subsystems/execution.md`、`docs/tech-stack/desktop-delivery.md`、`docs/adr/0012-host-process-registry.md`

- [x] agent：`tty` 而不后台为参数错误；没有 PtyPort 时 `pty-unavailable`；job_input 只接受 running 的 pty Job（表驱动）
- [x] 集成（darwin）：后台 tty 运行 `python3 -i`（不可用时用 `bash -i` 的 `read`）→ job_input 写入 `print(6*7)` 并 submit → job_output 读到 42；`ctrl_c` 中断前台的 `sleep 100`；default 模式 job_input 出现审批、full-access 不出现，deny 规则匹配 text 时拒绝
- [x] 集成：tty Job 在 read-only 档位的 Seatbelt 下写 Workspace 被拒绝；SIGKILL Sidecar 后 PTY 子进程被孤儿清理终止
- [x] 符号链接越界：Workspace 以符号链接路径登记时，PTY 中 `pwd -P` 输出目标路径，判定以真实路径进行
- [x] 秘密总闸 `secrets-gate-pty.test.ts`：PTY 回显登记的 Secret 后日志、job_output、WS 帧与 requestLog 中没有明文
- [x] 产物 smoke：`electron-forge package` 产物中 `Resources/sidecar/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper` 可执行，打包应用中一个 tty Job 输出 `ok`
- [x] execution.md 补 PTY 与 stdin；desktop-delivery.md 说明 node-pty 的打包方式与不需要 asar 解包的理由；ADR 0012 改为 implemented 并链接 03–05 的证据；permissions.md 的 job_input 一行写在 Comments；`check:docs` 通过

## Comments
- 2026-10-30 lead：来自票 03——pi-mcp 1.4.0 以 detached（独立进程组）启动 stdio MCP Server；本票把 MCP 登记改为记录 pgid，使孤儿清理覆盖经 npx 启动的孙进程，并同步 spec.md 与 ADR 0012 中"MCP 登记不记 pgid"的措辞（越出写范围，已授权：apps/server/src/adapters/mcp.ts 的登记一行、spec.md、ADR 0012）；sidecar-orphans.test.ts 增加孙进程被清理的用例。ADR 0012 的 implementation 由本票按证据改为 implemented。processes.track / trackExec 用法见票 03 Comments 的"供后续票"。
- 2026-10-30 lead：来自票 04——在 JobService.#start 中增加 PTY 分支；Job 日志、游标与通知沿用票 04 的实现。
- 2026-10-30 implementer（m4/05-pty-and-stdin）：
  - **覆盖的验收：** 全部 7 项。(1) agent 表驱动：`tools/builtin/bash.test.ts`（tty 而不后台、tty 与 run_in_background: false 均为参数错误且不启动；宿主没有 PTY 时 `pty-unavailable`），`tasks/jobs/jobs.test.ts` 的 job_input 表（running pty 写入、submit、ctrl_c、ctrl_c+文本顺序、非 PTY、stopping、已结束、未知 id、全空参数错误；判定对象为 text），`ports/local-exec.test.ts` 的 tty 分支（argv、真实 cwd、120×30、环境过滤与 TERM、信号退出、没有 PtyPort）。(2)(3)(4) `tests/integration/sidecar-pty.test.ts`（darwin，describe 超时 120 s）6 例：`PYTHON_BASIC_REPL=1 python3 -q -i` 经 job_input 写 `print(6*7)` 并 submit 后 job_output 读到 42（python3 不可用时用 bash `read`）；ctrl_c 中断前台 `sleep 100`（trap INT）；full-access 不询问、default 出现 job_input 审批（subject 为 text）、`Bash(rm *)` 拒绝 `rm -rf x`；read-only 档位 Seatbelt 拒绝写 Workspace；SIGKILL 后忽略 SIGHUP 的 PTY shell 与其 sleep 被孤儿清理终止（登记 kind pty、pgid = pid，Job 记 lost）；Workspace 以符号链接登记时 `pwd -P` 与 `$PWD` 都是目标路径、workspace-write 写入放行。(5) `tests/integration/secrets-gate-pty.test.ts`（darwin）：PTY 分两段打印并经 job_input 输入完整值（终端回显），日志、job_output、WS 帧、HTTP 输出、库、日志目录、stderr 与 requestLog 均无明文。(6) `package-smoke.e2e.test.ts` 新增 darwin 用例：`Resources/sidecar/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper` 可执行，打包应用中 tty Job 日志为 `ok\r\n`，sidecar 日志 `pty backend selected` 的 path 在 Resources/sidecar 下；describe 设 180 s 超时。(7) execution.md 新增"PTY 与 stdin"节与登记表 pty / mcp 行；desktop-delivery.md 新增"随包 node-pty"节（不需要 asar 解包的理由）；ADR 0012 改为 implemented 并补 05 证据，决定中的 MCP 孙进程限制按授权修订；`check:docs` 0 问题。
  - **Lead 授权的改动：** `layers.ts` 的 MCP 登记加 `pgid: pid`（非 Windows）；`adapters/mcp.ts` 头注释一行；`sidecar-orphans.test.ts` 的 stubborn Server 改经 `/bin/sh` 启动并留下同组孙进程，断言 mcp 行 `pgid = pid`、command `/bin/sh`、孙进程被清理；spec.md 第 143 行与 ADR 0012 的措辞。
  - **负向确认（变异，均已还原）：** MCP 不登记 pgid → orphans 2 例失败；PTY cwd 不取真实路径 → 符号链接例失败；PTY 登记为 job / 不带 pgid → SIGKILL 例失败；job_input 权限类改为 session-state → 判定例失败；JobService 去掉流式脱敏 → secrets-gate-pty 失败。agent 单元测试先红（local-exec 3 例、bash 与 job_input 13 例）后绿。
  - **越出 Write scope：** `apps/server/src/adapters/ripgrep.ts`：`WorkspaceToolsOptions.pty?` 并传给 `createLocalExecPort`（3 行；bash 的执行端口在工具集内部创建，与票 03 的 wrapExec 同理）。`apps/server/src/application/context/jobs.ts` 不在票头列表但属 `application/{jobs,context/jobs}.ts`，已在范围内。新测试文件 `apps/server/src/adapters/pty.test.ts`（与范围内源码同目录）。`forge.config.ts` 未改（不需要）。
  - **设计说明：** `SpawnRequest.tty?` 与 `ExecProcess.write?`（exec.ts），local-exec 在 `spawn({ tty: true })` 时做同样的工作目录检查、沙箱前缀与环境过滤，再交给 `LocalExecOptions.pty`（PtyPort）；cwd 经 realpath；环境无 TERM 时设 xterm-256color。node-pty 在 ToolsLive 中探测一次（`probeNodePty`，打开存储之前），失败只记 warn，tty 调用为 pty-unavailable。`JobsPort.input(jobId, data)` 为新增必需方法。
  - **全量运行记录：** 第 1 次（负载约 18，06 的全量同时在跑）=1：`sidecar-process.test.ts` 一例 5 秒超时（本票未改 apps/desktop/src，单独重跑 3 次通过）。第 2 次=1：`secrets-gate-pty` 一例失败——终端在输入到达时立即回显，job_input 早于第二段打印时回显插进两段之间，值被拆开（不是泄漏：两段都没有被替换，但前置断言失败）；改为等 ready 文件后再输入（cde6682），之后 PTY 两个文件连续 12 次通过（负载 22–35）。同次另有 `agent/src/index.test.ts` 30 秒超时与 `thinking-levels.browser.test.tsx` 点击 336 ms 超时，均为高负载下的既有用例，与本票无关。
  - **未验证：** 非 darwin 平台（PTY 用例显式跳过）；真实模型（无凭据）；renderer 中 pty Job 的显示（票 06）。
  - **文档影响 / 需要 Lead 合并处理：** permissions.md 权限类表加一行（或在 bash 行说明）：`| bash（M4 增加） | job_input（判定对象为 text，与 bash 命令同一套规则，规则组名 Bash） | 与 bash 相同 |`。jobs.md（票 06 写范围）第 9 行"PTY Job 与 `job_input`、后台任务视图尚未实现"需改为只剩后台任务视图，并可链接 execution.md#pty-与-stdin。docs/README 当前行为导航不需要新行（execution.md 已有）。TECH_STACK 接入状态表不需要新行。
  - **供后续票：** 票 06——Job kind `pty` 的日志与 WS `job_output` 帧是终端原始输出（带 CR 与 SGR），anser 渲染即可；用户在界面输入不做（规格 Out of Scope）。票 10（README 汇总）——agent README 记 `PtyPort`、`PTY_COLS/ROWS/TERM`、`SpawnRequest.tty`、`ExecProcess.write`、`createJobInputTool`、`JobsPort.input`、`LocalExecOptions.pty`；server README 记 `adapters/pty.ts`（`probeNodePty`、日志 `pty backend selected`）、`WorkspaceToolsOptions.pty`、MCP 登记进程组。
