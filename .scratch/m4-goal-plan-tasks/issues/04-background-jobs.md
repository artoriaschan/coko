# 04: 后台任务：run_in_background、Job 输出与落盘、job_output / job_list / job_kill、完成通知

**What to build:** 见 [规格](../spec.md) "Background Jobs" 一节：bash 的 `run_in_background`；agent `tasks/jobs/`（Job 状态机、环形 256 KB 与游标、ANSI 去除、通知文本、工具 `job_output`、`job_list`、`job_kill`）；`ExecPort` 增加长寿命进程句柄（不等待退出、流式输出、kill）；server `JobService`（每 Session 至多 10 个、日志 `<dataDir>/jobs/<sessionId>/<jobId>.log` 0700 / 0600、64 MiB 上限、写入前按值脱敏、`job_start` / `job_end` 条目、progress `job_update` / `job_output`、登记进程 kind job、停止 Run 不终止、有序关闭终止、启动恢复提交 `job_end lost`）；`context/jobs.ts`（注册工具、`pendingInput` 合并挂起的通知）；运行中 Run 的通知经追加指令送达（`session-runs.ts`）；`routes/jobs.ts` 的三个接口。

**User stories:** 12

**Blocked by:** 03

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/tasks/jobs/`、`packages/agent/src/tools/builtin/bash.ts`、`packages/agent/src/ports/{exec,local-exec}.ts`、`packages/agent/src/session-entries/jobs.ts`、`packages/protocol/src/jobs.ts`、`apps/server/src/application/jobs.ts`、`application/session-runs.ts`（通知送达的最小改动）、`application/context/jobs.ts`、`http/routes/jobs.ts`、`packages/i18n/src/dictionaries/domains/jobs.ts`、`tests/integration/{sidecar-jobs,secrets-gate-jobs}.test.ts`（新）、`docs/subsystems/jobs.md`（新）、`docs/adr/0012-host-process-registry.md`

- [x] agent 表驱动：job_output 游标只返回新输出、wait 在结束 / 超时 / 追加指令到达时返回、ANSI 去除、截断；通知文本（≤ 2 KB 内联，否则提示 job_output）；已被 job_output 读到终态或被 job_kill 的 Job 不通知
- [x] 集成：后台 `for i in 1 2 3; do echo $i; sleep 0.2; done` 立即返回 jobId，`job_start` 在 toolResult 之前提交；job_output wait 读到 1–3 与 `[status: completed]`；日志文件 0600、目录 0700、内容一致；第 11 个并发 Job 返回错误结果
- [x] 集成：Run 进行中 Job 结束 → 下一次模型请求前送达一条带 `job_notification` 的 user message（faux requestLog 断言）；Session 空闲时 Job 结束 → 不发起新 Run，下一次用户提交的 user message 以通知开头
- [x] 集成：job_kill 与 `POST /api/jobs/:id/kill` 使进程组退出（进程表断言）、`job_end killed`；停止 Run 后 Job 仍在运行；SIGKILL Sidecar 后重启，Job 记 `lost`、进程被孤儿清理终止
- [x] 集成：`GET /api/sessions/:id/jobs` 与 `GET /api/jobs/:id/output?offset=` 分页读取不影响模型的 job_output 游标；WS `job_output` 帧按 offset 连续
- [x] 符号链接越界：Workspace 内指向 Job 日志目录的符号链接经 read 读取时 default 模式出现审批（日志目录不是读取根）
- [x] 秘密总闸 `secrets-gate-jobs.test.ts`：登记的 Secret 经 bash 后台回显后，日志文件、job_output 结果、WS 帧、HTTP 输出接口、通知文本与 faux requestLog 中都没有明文；负向确认一次
- [x] jobs.md 建立并可达（导航行写在 Comments）；ADR 0012 补 Job 证据；`check:docs` 通过

## Comments
- 2026-10-30 lead：来自票 03——用 processes.track({ pid, pgid?, kind, sessionId?, jobId?, command }) 登记 Job 进程并在退出时调用返回的释放函数，或用 processes.trackExec(port, { kind, ... }) 包装 ExecPort；命令文本入库前已由登记表脱敏。来自票 07——贡献可经 options.entries.commit(sessionId, entry) 提交自己的条目（无 runId，与运行时条目同样脱敏与推送），Job 完成通知等条目可复用。
- 2026-10-30 implementer（m4/04-background-jobs）：
  - **覆盖的验收：** 全部 8 项。agent 表驱动 `packages/agent/src/tasks/jobs/jobs.test.ts`（31 例）；`ports/local-exec.test.ts` 与 `tools/builtin/bash.test.ts` 增加 spawn 与 run_in_background；集成 `tests/integration/sidecar-jobs.test.ts`（9 例，其中停止 / 孤儿 3 例只在 darwin）与 `secrets-gate-jobs.test.ts`（1 例）。符号链接用例在 sidecar-jobs 中（default 模式下 read 经 Workspace 内指向 `<dataDir>/jobs/<sessionId>` 的链接出现 approval_request）。
  - **负向确认（变异，均已还原）：** 去掉输出的流式脱敏 → secrets-gate-jobs 失败；忽略 observedEnd → "读到终态后不通知"与"job_kill 不通知"两例失败；关闭运行中送达 → "Run 进行中"一例失败。
  - **越出 Write scope 的最小改动：** `packages/protocol/src/errors.ts` 与 `apps/server/src/application/errors.ts` 增加错误码 `job-not-running`（409，规格 HTTP 一节要求）；`apps/server/src/application/processes.ts` 的 `trackExec` 原样转交 `spawn`；`apps/server/src/runtime/layers.ts` 一行把 `processes.track` 交给 JobService；`apps/server/src/adapters/faux.ts` 增加测试占位 `$LAST_JOB_ID`（jobId 随机，脚本无法预写；票 10 改 faux.ts 时保留）；`docs/subsystems/execution.md` 补 spawn 与 job 登记行；`docs/README.md` 当前行为增加 jobs.md 一行（只增这一行）。
  - **设计说明：** bash 不知道 sessionId，session-runs 在运行时的基础工具集上包装 bash，经执行上下文（`BashExecutionContext.jobs`）注入本 Session 的 `BackgroundJobLauncher`；进程经 bash 的同一执行端口 `spawn`（同沙箱、同环境过滤）。完成通知在 Run 进行中经 `SessionRuns.deliver`（不经输入展开）作为追加指令送达；Run 结束时在 undeliveredSteering 中的挂起到下一个 Run。追加指令（用户的或通知）到达时唤醒本 Session 等待中的 job_output。
  - **未验证 / 未做：** Goal 相关（取消 Goal 终止其 Job：提供了 `JobService.killSession(sessionId)`；`job_start.goalId` 未写入；空闲 Session 有 Goal 时的唤醒）留给票 09；PTY 留给票 05；真实模型未验证（无凭据）。
  - **供后续票：** 票 05——`BackgroundJobRequest.spawn` 与 `JobService.#start` 目前只有 kind bash，PTY 需在 #start 增加 kind 与 PtyPort 分支，日志保存原始输出、模型读取时已去除 ANSI（`BackgroundJob.unread`）。票 06——`GET /api/sessions/:id/jobs` 返回 `{ jobs }`（`SessionJobsResponse`），`jobPaths.{sessionJobs,output,kill}`，WS `job_output` 的 offset 与 HTTP 日志偏移相同（脱敏后字节），`job_update` 在 running / stopping / 结束时各一次。票 09——`JobService.killSession`、`pendingInput` 已在 goal 触发的 Run 合并。票 10（README 汇总）：agent README 记 `ExecPort.spawn`、`tasks/jobs/` 导出与 `BashExecutionContext`；server README 记 JobService、routes/jobs、`job-not-running`、faux 的 `$LAST_JOB_ID`。
  - **文档影响：** 新建 `docs/subsystems/jobs.md`；ADR 0012 补后台 Job 证据（implementation 仍为 not-started，PTY 完成后由票 05 改）；execution.md 更新；`pnpm run check:docs` 通过。
