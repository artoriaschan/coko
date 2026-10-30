# 05: PTY 与 stdin：node-pty 端口、tty 后台任务、job_input、打包与产物 smoke

**What to build:** 见 [规格](../spec.md) "PTY 与 stdin" 一节：agent `ports/pty.ts` 的 `PtyPort`；bash `tty`（须同时后台）；Job kind `pty`；`job_input { job_id, text, submit?, ctrl_c? }`（权限类 bash，判定对象为 text）；server `adapters/pty.ts`（node-pty，沙箱 argv 前缀，cwd 为 Workspace 真实路径，120×30，登记进程 kind pty）与 layers.ts 接线；没有端口时 `pty-unavailable`。打包：sidecar tsdown 把 node-pty 保留为 external，构建步骤复制 `package.json`、`lib/`、`prebuilds/darwin-arm64/` 到 `dist/sidecar/node_modules/node-pty/` 并设 spawn-helper 0755；产物 smoke 启动 PTY Job。

**User stories:** 14

**Blocked by:** 04

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/ports/{pty,exec,local-exec}.ts`、`packages/agent/src/tools/builtin/bash.ts`、`packages/agent/src/tasks/jobs/`、`packages/agent/src/session-entries/jobs.ts`、`packages/protocol/src/jobs.ts`、`apps/server/src/adapters/pty.ts`（新）、`apps/server/src/application/{jobs,context/jobs}.ts`、`apps/server/src/http/routes/jobs.ts`、`apps/server/src/runtime/layers.ts`、`apps/desktop/build/build.ts`、`apps/desktop/tsdown.config.ts`、`apps/desktop/forge.config.ts`、`apps/desktop/e2e/package-smoke.e2e.test.ts`、`tests/integration/{sidecar-pty,secrets-gate-pty}.test.ts`（新）、`docs/subsystems/execution.md`、`docs/tech-stack/desktop-delivery.md`、`docs/adr/0012-host-process-registry.md`

- [ ] agent：`tty` 而不后台为参数错误；没有 PtyPort 时 `pty-unavailable`；job_input 只接受 running 的 pty Job（表驱动）
- [ ] 集成（darwin）：后台 tty 运行 `python3 -i`（不可用时用 `bash -i` 的 `read`）→ job_input 写入 `print(6*7)` 并 submit → job_output 读到 42；`ctrl_c` 中断前台的 `sleep 100`；default 模式 job_input 出现审批、full-access 不出现，deny 规则匹配 text 时拒绝
- [ ] 集成：tty Job 在 read-only 档位的 Seatbelt 下写 Workspace 被拒绝；SIGKILL Sidecar 后 PTY 子进程被孤儿清理终止
- [ ] 符号链接越界：Workspace 以符号链接路径登记时，PTY 中 `pwd -P` 输出目标路径，判定以真实路径进行
- [ ] 秘密总闸 `secrets-gate-pty.test.ts`：PTY 回显登记的 Secret 后日志、job_output、WS 帧与 requestLog 中没有明文
- [ ] 产物 smoke：`electron-forge package` 产物中 `Resources/sidecar/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper` 可执行，打包应用中一个 tty Job 输出 `ok`
- [ ] execution.md 补 PTY 与 stdin；desktop-delivery.md 说明 node-pty 的打包方式与不需要 asar 解包的理由；ADR 0012 改为 implemented 并链接 03–05 的证据；permissions.md 的 job_input 一行写在 Comments；`check:docs` 通过

## Comments
- 2026-10-30 lead：来自票 03——pi-mcp 1.4.0 以 detached（独立进程组）启动 stdio MCP Server；本票把 MCP 登记改为记录 pgid，使孤儿清理覆盖经 npx 启动的孙进程，并同步 spec.md 与 ADR 0012 中"MCP 登记不记 pgid"的措辞（越出写范围，已授权：apps/server/src/adapters/mcp.ts 的登记一行、spec.md、ADR 0012）；sidecar-orphans.test.ts 增加孙进程被清理的用例。ADR 0012 的 implementation 由本票按证据改为 implemented。processes.track / trackExec 用法见票 03 Comments 的"供后续票"。
