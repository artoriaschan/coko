# 08: 启动恢复、中断判定与结果确认

**What to build:** 迁移 v2（索引 `session_entries(session_id, kind, seq)`）与"有 run_start 而无其后 run_end"的查询；agent `planRecovery`（grilling E3 分类：pending 审批 expired、无 tool_exec 补"未执行"、read 补"已中断可重试"、side-effect 用 `probeOutcome` 判定，否则 `confirmation_request`；最后 run_end interrupted）；write 比对内容、edit 检查新旧文本的 `probeOutcome`；server 在打开存储后、开始监听前运行扫描（正常关闭不触发，解决地图 Carry-over"崩溃时进行中的 Run 不留 run_end"）；`POST …/confirmations/:toolCallId`（applied / not-applied / unknown → 补 toolResult）；存在待确认时 submit、continue、rewind 返回 409 `confirmation-pending`；activity 的 interrupted / awaiting-confirmation。renderer：中断横幅带"继续"、确认卡接管 composer、侧栏徽标。

**User stories:** 20, 21, 22, 26（迁移）

**Blocked by:** 06, 07

**Status:** ready-for-agent

**Write scope:** `packages/session/src/sqlite/`（含 `schema.ts`）、`packages/session/README.md`、`packages/agent/src/recovery/`、`packages/agent/src/tools/types.ts`、`packages/agent/src/tools/builtin/write.ts`、`packages/agent/src/tools/builtin/edit.ts`、`packages/agent/src/session-entries/runs.ts`、`packages/agent/README.md`、`packages/protocol/src/runs.ts`、`apps/server/src/application/sessions.ts`、`apps/server/src/http/app.ts`、`apps/server/src/runtime/layers.ts`、`apps/server/README.md`、`apps/desktop/src/renderer/features/conversation/`、`apps/desktop/src/renderer/features/sidebar/`、`apps/desktop/src/renderer/stores/`、`packages/ui/src/`（不含 `components/sonner.tsx`、`components/dialog.tsx`）、`packages/i18n/src/dictionaries/`、`apps/desktop/e2e/recovery.e2e.test.ts`（新）、`tests/integration/sidecar-recovery.test.ts`（新）、`tests/fixtures/`、`docs/adr/0003-settings-and-sessions-in-sqlite.md`、`docs/adr/README.md`、`docs/subsystems/recovery.md`（新）、`docs/README.md`

- [ ] 集成测试（迁移）：用 v1 库启动 Sidecar → 版本 2、生成 `.backup-v1-*`、原有 Session 与条目可读
- [ ] 集成测试：full-access 下 bash `sleep 30; touch done` 执行中 SIGKILL Sidecar → 重启后该 Run 有 run_end interrupted 与 confirmation_request，activity awaiting-confirmation；submit / continue 返回 409 confirmation-pending；回答 not-applied → 补 toolResult、activity interrupted；continue → 模型上下文含补齐的 toolResult
- [ ] 集成测试：等待审批时 SIGKILL → 重启后 approval_decision expired、补"未执行"结果、文件不存在，没有 confirmation_request
- [ ] 集成测试：write 执行后、toolResult 前被杀（用测试钩子在 tool_exec 后阻塞）→ probeOutcome 判定 applied，直接补结果、无确认
- [ ] 集成测试：正常关闭（shutdown 消息）中断的 Run 仍是 aborted，不产生 interrupted
- [ ] Electron E2E：Run 中 SIGKILL 真实 Sidecar → supervisor 重启后会话显示中断横幅与确认卡，回答后可继续
- [ ] 秘密总闸追加：确认流程的条目与推送无明文
- [ ] ADR 0003 的迁移证据写入 partial 说明；`docs/subsystems/recovery.md` 描述恢复分类并从导航可达；地图 Carry-over 对应条目可在里程碑末勾除

## Comments
