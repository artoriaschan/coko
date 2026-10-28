# 09: 回退对话 / 代码与从此分叉

**What to build:** agent `planRewind(entries, targetSeq, mode)` 与有效上下文计算（跳过 `rewind` 区间，可叠加）；server `GET …/checkpoints`、`POST …/rewind { targetSeq, mode, dryRun? }`（conversation 追加 rewind 条目并重建 runtime 上下文；code 按 ADR 0006 恢复最早备份、删除原先不存在的文件，返回 restored / deleted / diverged / untracked；both 两者）、`POST …/fork { targetSeq }`（新 Session 首条 `fork_origin`，复制有效条目，标题加后缀）；Run 进行中、待审批、待确认 409 `session-busy`。renderer：用户消息的"回退到此处" / "从这里分叉"（悬停与聚焦可达）、确认对话框（模式选择、dry-run 文件清单、外部改动警示、bash 不追踪说明）、时间线折叠被回退区间、目标文本回到输入区、分叉后打开新会话。

**User stories:** 27, 28, 29, 30, 31

**Blocked by:** 08

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/checkpoints/`、`packages/agent/src/engine/`、`packages/protocol/src/checkpoints.ts`、`apps/server/src/application/`（不含 `providers.ts`）、`apps/server/src/http/app.ts`、`apps/server/README.md`、`apps/desktop/src/renderer/features/conversation/`、`apps/desktop/src/renderer/features/sidebar/`、`apps/desktop/src/renderer/stores/`、`packages/ui/src/`（不含 `components/sonner.tsx`、`components/dialog.tsx`）、`packages/i18n/src/dictionaries/`、`apps/desktop/e2e/rewind.e2e.test.ts`（新）、`tests/integration/sidecar-rewind.test.ts`（新）、`docs/adr/0006-file-checkpoints-and-rewind.md`、`docs/adr/README.md`

- [x] agent 测试：有效上下文跳过 rewind 区间；两次 rewind 叠加；rewind 之后的新消息正常进入上下文
- [x] 集成测试：三条消息、每条 edit 同一文件 → rewind code 到第二条 → 文件等于第一条 Run 之后的内容；新建于第二条之后的文件被删除；未被追踪的文件逐字节不变
- [x] 集成测试：rewind conversation → 下一次模型请求不含被回退的消息，条目仍可经 detail 读到；both 同时满足两者
- [x] 集成测试：dry-run 不改任何文件；在 Agent 之外改过的文件出现在 diverged
- [x] 集成测试：fork → 新 Session 首条 fork_origin、条目为目标前的有效条目、原 Session 条目数不变
- [x] 集成测试：Run 进行中 rewind / fork → 409 session-busy
- [x] Electron E2E：悬停用户消息出现回退动作，确认对话框列出文件与 bash 说明，执行后输入区为原消息文本、时间线折叠；分叉后侧栏出现新会话并打开
- [x] 回退动作键盘可达（Tab 到消息后可触发）
- [x] ADR 0006 implementation 改为 implemented（附测试位置）或写明剩余项

## Comments
- 2026-10-29 lead：来自票 08——(1) 存在未回答的 confirmation_request 时 rewind 与 fork 返回 409 confirmation-pending，复用 SessionService 的同一判断（unansweredConfirmations(entries)）；(2) 恢复补齐的 write / edit 结果不提交 file_change，代码回退时这些路径不要误报为"在 Agent 之外被改动"，按 file_backup 与 toolResult 关联判断，并加用例。

- 2026-10-29 implementer（分支 m2/09-rewind-and-fork）：
  - 覆盖验收：全部 9 项。agent `packages/agent/src/checkpoints/rewind.test.ts`（13）：有效上下文跳过区间、嵌套与不相交叠加、回退后新消息进入上下文、planRewind（最早备份、记录状态、目标校验、未追踪、恢复补齐结果为 unknown）、restoreFiles（dry-run 不改文件、逐字节恢复、删除、未追踪不动、diverged）、forkEntries。集成 `tests/integration/sidecar-rewind.test.ts`（6）：三条消息 edit 同一文件回退代码、新建文件删除、未追踪文件逐字节不变、dry-run 不改文件、外部改动进 diverged；回退对话后 faux requestLog 中下一次请求不含被回退消息、条目仍在详情中、both 同时删除文件并清空上下文；fork 首条 fork_origin、复制目标前的有效条目、原 Session 条目数不变、新 Session 的请求只含分叉前上下文；等待审批时 rewind / dry-run / fork 409 session-busy；SIGKILL 后待确认 409 confirmation-pending；write 执行后 file_change 前被杀（新增仅测试开关 COKO_TEST_HOLD_BEFORE_CHECKPOINT），恢复补齐的结果不误报 diverged。Lead 说明 (1)(2) 均有用例。Electron `apps/desktop/e2e/rewind.e2e.test.ts`（3）：悬停出现动作（opacity 0→1）、对话框列 restored/deleted 与 bash 说明、执行后输入区为原消息、时间线折叠、文件恢复；Tab 到消息后 Tab 到"回退到此处"、Enter 打开、Esc 关闭不回退；分叉后侧栏两条会话、新会话 aria-current、输入区为原消息。store `chat-store-rewind.test.ts`（5）、时间线 `timeline.test.ts`（2）。secrets-gate 第一段追加 checkpoints、dry-run、both 回退、fork 与读回。
  - 命令与结果（merge main 后，main 14516a0 已在分支中，无新提交）：`pnpm install --frozen-lockfile` 0；`pnpm run typecheck` 0；`pnpm run lint` 0 warnings / 0 errors；`pnpm run format:check` 通过；`pnpm run check:docs` 83 文件 0 问题；`pnpm run test` 100 文件、775 通过、1 跳过（settings.e2e 的真实 DeepSeek 用例，无凭据），含 desktop-e2e（rewind、package-smoke 等）与 Browser Mode。
  - 设计取舍：分叉复制目标前有效的 message、permission_mode、permission_rule（去掉 runId），不复制 run_start/run_end、审批、tool_exec、file_backup/file_change（锚点属于原 Session；不复制 run 生命周期避免启动扫描误判未完成 Run）；新 Session 标题为"<原标题> (fork)"（Sidecar 侧固定英文后缀）。ForkResponse 为 { sessionId, text }，不内嵌 Session（protocol 的 checkpoints.ts 引 http.ts 会形成循环导入），renderer 分叉后重新读列表。"Agent 之外改过"按最后一次记录比对；被中断 Run 中 write/edit 的 tool_exec 多于 file_change 时该 Run 涉及路径记为 unknown、不标记（按 Run 计数，可能漏报同 Run 内的外部改动）；代码回退本身不提交条目，再次回退代码时已恢复的路径可能被标为 diverged（写入 ADR 0006）。回退的 Session 运行时被丢弃，下次 Run 按有效条目重建；activity 与 lastRunStatus 按有效条目计算（被回退的暂停/中断 Run 不再显示横幅）。
  - 越出 Write scope 的最小改动（请裁决）：`packages/protocol/src/errors.ts`（新增 ErrorCode session-busy；规格要求的 409 码不存在）；`apps/server/src/application/errors.ts` 在 scope 内；`apps/server/src/adapters/checkpoints.ts`（openCheckpointStore 同时给出读快照正文的端口）与 `apps/server/src/runtime/layers.ts`（把它注入 SessionService.checkpoints；新增仅测试 COKO_TEST_HOLD_BEFORE_CHECKPOINT）；`apps/desktop/src/renderer/client/api.ts`（listCheckpoints / rewind / fork）；`apps/desktop/src/renderer/app/chat-failure.ts`（rewind / fork 失败文案与 session-busy）；`apps/desktop/src/renderer/testing/fixture-chat.ts`（ApiClient satisfies 需要新方法）；文档 `packages/agent/README.md`（删去"尚未实现：回退与分叉"）、`docs/subsystems/recovery.md`（第 72 行的限制已解决，改写并加 409 一句）。
  - 未验证：真实模型（无凭据）；Windows / Linux；暗色主题与窄窗口下的对话框只做了亮色 1280 宽截图目视检查。
  - 文档影响：ADR 0006 implementation → implemented（证据列出测试位置），docs/adr/README.md 行同步；apps/server/README.md 增加路由、条目、测试开关与测试文件；以上两处越界文档同上。GLOSSARY 的 Rewind / Fork 定义无需改动。
