# 04: 后台任务：run_in_background、Job 输出与落盘、job_output / job_list / job_kill、完成通知

**What to build:** 见 [规格](../spec.md) "Background Jobs" 一节：bash 的 `run_in_background`；agent `tasks/jobs/`（Job 状态机、环形 256 KB 与游标、ANSI 去除、通知文本、工具 `job_output`、`job_list`、`job_kill`）；`ExecPort` 增加长寿命进程句柄（不等待退出、流式输出、kill）；server `JobService`（每 Session 至多 10 个、日志 `<dataDir>/jobs/<sessionId>/<jobId>.log` 0700 / 0600、64 MiB 上限、写入前按值脱敏、`job_start` / `job_end` 条目、progress `job_update` / `job_output`、登记进程 kind job、停止 Run 不终止、有序关闭终止、启动恢复提交 `job_end lost`）；`context/jobs.ts`（注册工具、`pendingInput` 合并挂起的通知）；运行中 Run 的通知经追加指令送达（`session-runs.ts`）；`routes/jobs.ts` 的三个接口。

**User stories:** 12

**Blocked by:** 03

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/tasks/jobs/`、`packages/agent/src/tools/builtin/bash.ts`、`packages/agent/src/ports/{exec,local-exec}.ts`、`packages/agent/src/session-entries/jobs.ts`、`packages/protocol/src/jobs.ts`、`apps/server/src/application/jobs.ts`、`application/session-runs.ts`（通知送达的最小改动）、`application/context/jobs.ts`、`http/routes/jobs.ts`、`packages/i18n/src/dictionaries/domains/jobs.ts`、`tests/integration/{sidecar-jobs,secrets-gate-jobs}.test.ts`（新）、`docs/subsystems/jobs.md`（新）、`docs/adr/0012-host-process-registry.md`

- [ ] agent 表驱动：job_output 游标只返回新输出、wait 在结束 / 超时 / 追加指令到达时返回、ANSI 去除、截断；通知文本（≤ 2 KB 内联，否则提示 job_output）；已被 job_output 读到终态或被 job_kill 的 Job 不通知
- [ ] 集成：后台 `for i in 1 2 3; do echo $i; sleep 0.2; done` 立即返回 jobId，`job_start` 在 toolResult 之前提交；job_output wait 读到 1–3 与 `[status: completed]`；日志文件 0600、目录 0700、内容一致；第 11 个并发 Job 返回错误结果
- [ ] 集成：Run 进行中 Job 结束 → 下一次模型请求前送达一条带 `job_notification` 的 user message（faux requestLog 断言）；Session 空闲时 Job 结束 → 不发起新 Run，下一次用户提交的 user message 以通知开头
- [ ] 集成：job_kill 与 `POST /api/jobs/:id/kill` 使进程组退出（进程表断言）、`job_end killed`；停止 Run 后 Job 仍在运行；SIGKILL Sidecar 后重启，Job 记 `lost`、进程被孤儿清理终止
- [ ] 集成：`GET /api/sessions/:id/jobs` 与 `GET /api/jobs/:id/output?offset=` 分页读取不影响模型的 job_output 游标；WS `job_output` 帧按 offset 连续
- [ ] 符号链接越界：Workspace 内指向 Job 日志目录的符号链接经 read 读取时 default 模式出现审批（日志目录不是读取根）
- [ ] 秘密总闸 `secrets-gate-jobs.test.ts`：登记的 Secret 经 bash 后台回显后，日志文件、job_output 结果、WS 帧、HTTP 输出接口、通知文本与 faux requestLog 中都没有明文；负向确认一次
- [ ] jobs.md 建立并可达（导航行写在 Comments）；ADR 0012 补 Job 证据；`check:docs` 通过

## Comments
