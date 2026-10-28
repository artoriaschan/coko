# 09: 回退对话 / 代码与从此分叉

**What to build:** agent `planRewind(entries, targetSeq, mode)` 与有效上下文计算（跳过 `rewind` 区间，可叠加）；server `GET …/checkpoints`、`POST …/rewind { targetSeq, mode, dryRun? }`（conversation 追加 rewind 条目并重建 runtime 上下文；code 按 ADR 0006 恢复最早备份、删除原先不存在的文件，返回 restored / deleted / diverged / untracked；both 两者）、`POST …/fork { targetSeq }`（新 Session 首条 `fork_origin`，复制有效条目，标题加后缀）；Run 进行中、待审批、待确认 409 `session-busy`。renderer：用户消息的"回退到此处" / "从这里分叉"（悬停与聚焦可达）、确认对话框（模式选择、dry-run 文件清单、外部改动警示、bash 不追踪说明）、时间线折叠被回退区间、目标文本回到输入区、分叉后打开新会话。

**User stories:** 27, 28, 29, 30, 31

**Blocked by:** 08

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/checkpoints/`、`packages/agent/src/engine/`、`packages/protocol/src/checkpoints.ts`、`apps/server/src/application/`（不含 `providers.ts`）、`apps/server/src/http/app.ts`、`apps/server/README.md`、`apps/desktop/src/renderer/features/conversation/`、`apps/desktop/src/renderer/features/sidebar/`、`apps/desktop/src/renderer/stores/`、`packages/ui/src/`（不含 `components/sonner.tsx`、`components/dialog.tsx`）、`packages/i18n/src/dictionaries/`、`apps/desktop/e2e/rewind.e2e.test.ts`（新）、`tests/integration/sidecar-rewind.test.ts`（新）、`docs/adr/0006-file-checkpoints-and-rewind.md`、`docs/adr/README.md`

- [ ] agent 测试：有效上下文跳过 rewind 区间；两次 rewind 叠加；rewind 之后的新消息正常进入上下文
- [ ] 集成测试：三条消息、每条 edit 同一文件 → rewind code 到第二条 → 文件等于第一条 Run 之后的内容；新建于第二条之后的文件被删除；未被追踪的文件逐字节不变
- [ ] 集成测试：rewind conversation → 下一次模型请求不含被回退的消息，条目仍可经 detail 读到；both 同时满足两者
- [ ] 集成测试：dry-run 不改任何文件；在 Agent 之外改过的文件出现在 diverged
- [ ] 集成测试：fork → 新 Session 首条 fork_origin、条目为目标前的有效条目、原 Session 条目数不变
- [ ] 集成测试：Run 进行中 rewind / fork → 409 session-busy
- [ ] Electron E2E：悬停用户消息出现回退动作，确认对话框列出文件与 bash 说明，执行后输入区为原消息文本、时间线折叠；分叉后侧栏出现新会话并打开
- [ ] 回退动作键盘可达（Tab 到消息后可触发）
- [ ] ADR 0006 implementation 改为 implemented（附测试位置）或写明剩余项

## Comments
