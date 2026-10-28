# 08: 启动恢复、中断判定与结果确认

**What to build:** 迁移 v2（索引 `session_entries(session_id, kind, seq)`）与"有 run_start 而无其后 run_end"的查询；agent `planRecovery`（grilling E3 分类：pending 审批 expired、无 tool_exec 补"未执行"、read 补"已中断可重试"、side-effect 用 `probeOutcome` 判定，否则 `confirmation_request`；最后 run_end interrupted）；write 比对内容、edit 检查新旧文本的 `probeOutcome`；server 在打开存储后、开始监听前运行扫描（正常关闭不触发，解决地图 Carry-over"崩溃时进行中的 Run 不留 run_end"）；`POST …/confirmations/:toolCallId`（applied / not-applied / unknown → 补 toolResult）；存在待确认时 submit、continue、rewind 返回 409 `confirmation-pending`；activity 的 interrupted / awaiting-confirmation。renderer：中断横幅带"继续"、确认卡接管 composer、侧栏徽标。

**User stories:** 20, 21, 22, 26（迁移）

**Blocked by:** 06, 07

**Status:** ready-for-agent

**Write scope:** `packages/session/src/sqlite/`（含 `schema.ts`）、`packages/session/README.md`、`packages/agent/src/recovery/`、`packages/agent/src/tools/types.ts`、`packages/agent/src/tools/builtin/write.ts`、`packages/agent/src/tools/builtin/edit.ts`、`packages/agent/src/session-entries/runs.ts`、`packages/agent/README.md`、`packages/protocol/src/runs.ts`、`apps/server/src/application/sessions.ts`、`apps/server/src/http/app.ts`、`apps/server/src/runtime/layers.ts`、`apps/server/README.md`、`apps/desktop/src/renderer/features/conversation/`、`apps/desktop/src/renderer/features/sidebar/`、`apps/desktop/src/renderer/stores/`、`packages/ui/src/`（不含 `components/sonner.tsx`、`components/dialog.tsx`）、`packages/i18n/src/dictionaries/`、`apps/desktop/e2e/recovery.e2e.test.ts`（新）、`tests/integration/sidecar-recovery.test.ts`（新）、`tests/fixtures/`、`docs/adr/0003-settings-and-sessions-in-sqlite.md`、`docs/adr/README.md`、`docs/subsystems/recovery.md`（新）、`docs/README.md`

- [x] 集成测试（迁移）：用 v1 库启动 Sidecar → 版本 2、生成 `.backup-v1-*`、原有 Session 与条目可读
- [x] 集成测试：full-access 下 bash `sleep 30; touch done` 执行中 SIGKILL Sidecar → 重启后该 Run 有 run_end interrupted 与 confirmation_request，activity awaiting-confirmation；submit / continue 返回 409 confirmation-pending；回答 not-applied → 补 toolResult、activity interrupted；continue → 模型上下文含补齐的 toolResult
- [x] 集成测试：等待审批时 SIGKILL → 重启后 approval_decision expired、补"未执行"结果、文件不存在，没有 confirmation_request
- [x] 集成测试：write 执行后、toolResult 前被杀（用测试钩子在 tool_exec 后阻塞）→ probeOutcome 判定 applied，直接补结果、无确认
- [x] 集成测试：正常关闭（shutdown 消息）中断的 Run 仍是 aborted，不产生 interrupted
- [x] Electron E2E：Run 中 SIGKILL 真实 Sidecar → supervisor 重启后会话显示中断横幅与确认卡，回答后可继续
- [x] 秘密总闸追加：确认流程的条目与推送无明文
- [x] ADR 0003 的迁移证据写入 partial 说明；`docs/subsystems/recovery.md` 描述恢复分类并从导航可达；地图 Carry-over 对应条目可在里程碑末勾除

## Comments
- 2026-10-29 lead：来自票 07——pi 先对整批调用做完调用前检查再执行，同批中后一个调用的 file_backup 可能排在前一个调用的 tool_exec 之前。恢复逻辑按 toolCallId 关联 tool_exec、file_backup、file_change 与 toolResult，不依赖相邻顺序。
- 2026-10-29 lead：来自票 06——server continue() 已在未回答的 confirmation_request 存在时返回 409 confirmation-pending；运行时接受 lastRunStatus（interrupted 时可 continue）；不在运行中的 activity 由内存记录派生，重启后未打开的 Session 读条目前显示 idle，本票的未完成 Run 查询需补齐 Session 列表的 activity。

- 2026-10-29 implementer（票 08）：
  - **覆盖的验收**：全部 8 项。迁移、SIGKILL 确认流程、审批中 SIGKILL、write 已执行未记录、正常关闭 5 项在 `tests/integration/sidecar-recovery.test.ts`（SIGKILL 前以 WebSocket 推送的已提交条目 `tool_exec` / `approval_request` / `file_change` 与 Workspace 文件同步，无固定 sleep）；E2E 在 `apps/desktop/e2e/recovery.e2e.test.ts`（以标记文件与 Sidecar 进程号变化同步）；秘密总闸新增第 3 个用例"崩溃恢复与结果确认流程之后仍无明文"（两个 Sidecar 进程的帧、响应体、库、日志）；文档见下。
  - **实现要点**：`store.recovery.listUnfinishedRuns()` / `listLatestEntries(kind)` 放在 SQLite 入口（`SqliteStore.recovery`），不改 `SessionRepository` 接口与内存实现（types.ts 不在写范围；恢复只在 Sidecar 中运行）。`planRecovery` 是不提交的 async 函数（探测要读文件），按 toolCallId 关联、只看该 runId 的条目。Session 列表的 activity：启动扫描后从每个 Session 最后一条 run_end 建立，待确认的 Session 记在 `#awaitingConfirmation`，因此未打开的 Session 重启后即显示 interrupted / awaiting-confirmation（票 06 的说明）。submit、retry、continue 都在 `#start` 中检查待确认（409）。回答确认时 confirmation_answer 与补齐的 toolResult 同一事务提交；空闲运行时被丢弃并在下次开始 Run 时从条目重建。
  - **写范围外的最小改动**（请 Lead 裁决）：`apps/desktop/src/renderer/client/api.ts`（新增 `answerConfirmation`，renderer 调新路由必须）；`apps/desktop/src/renderer/app/chat-failure.ts`（ChatFailure 新增 `confirmation` kind 的文案映射，`satisfies Record<kind, …>` 要求）；`docs/subsystems/permissions.md`（"尚未实现"中 expired 一句已过时，改为链接 recovery.md；activity 一句同改）。
  - **与规格的差异 / 留给后续**：rewind 尚不存在，"待确认时 rewind 409" 由票 09 在 rewind 入口检查同一条件（`SessionService` 的 `#awaitingConfirmation` 或 `unansweredConfirmations(entries)`）。恢复补的 write / edit 结果不提交 file_change，回退时这些路径可能被标为在 Agent 之外改动过（已写入 recovery.md 限制）。M1 库中没有 run_start 的旧 Run 不会被识别。测试钩子 `COKO_TEST_HOLD_AFTER_TOOL`（需 `COKO_TEST_TOOLS=1`）挂在 checkpoint hook 之后，未改 config.ts。结果确认 404 而非新错误码（未改 protocol errors.ts）。
  - **运行的命令与结果**（worktree，已 `git merge main`，main 在 e498340 未变）：`pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm run check:docs`（83 文件 0 问题）均 exit 0；`pnpm run test` exit 0：95 个文件，746 通过、1 跳过（`settings.e2e.test.ts` 的真实 DeepSeek 用例，无 `DEEPSEEK_API_KEY`），含 desktop E2E（含 `recovery.e2e.test.ts`）与 `package-smoke.e2e.test.ts` 产物 smoke。分项：session 45、agent recovery 11、integration recovery 5、secrets-gate 3、renderer/ui/i18n 235（含新 store 4、ConfirmationCard browser 4）。
  - **未验证**：真实模型（无凭据）；非 darwin 平台。被 SIGKILL 的 bash 子进程是 detached 进程组，Sidecar 被强杀后它会继续运行到 sleep 结束（测试临时目录删除后其 touch 失败，无影响）；产品中这类孤儿进程的清理不在本票。
  - **文档影响**：新增 `docs/subsystems/recovery.md`（导航 `docs/README.md` 可达）；ADR 0003 partial 说明写入迁移 v2 的协议证据（implementation 仍为 partial：Memory、FTS5 未实现，`docs/adr/README.md` 无需改）；更新 `packages/agent/README.md`、`apps/server/README.md`、`packages/session/README.md`、`docs/subsystems/permissions.md`。无新增依赖，TECH_STACK 未改。地图 Carry-over"崩溃时进行中的 Run 不留 run_end"可在里程碑末勾除。
- 2026-10-29 lead：评审后合入 main（fd387e5）。接受越界：renderer client/api.ts 的 answerConfirmation、chat-failure.ts 的 confirmation kind、permissions.md 两句过时说明。接受：恢复查询放在 SqliteStore.recovery；无待回答确认时 404 not-found；M1 库中无 run_start 的 Run 不可识别。main 上复核：install、typecheck、lint、format:check 退出 0；全量 test 95 文件 746 通过、1 跳过（真实模型），无页面重载；check:docs 83 文件 0 问题。worktree 已清理。

Closed: true
