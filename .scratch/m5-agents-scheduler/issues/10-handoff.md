# 10: Handoff：/handoff 与对话框、摘要 Run、目标会话（当前目录或 worktree）、继承规则与草稿

**What to build:** 见 [规格](../spec.md)"Handoff"：agent `agents/handoff.ts`（摘要提示与目标条目推导，复制权限条目与 `forkEntries` 同一规则）；server `HandoffService`（准入、`trigger: handoff` 的摘要 Run、Run 正常结束后创建目标 worktree（经票 04）与目标 Session、`handoff_origin` 与源 `handoff` 条目）、`context/handoff.ts`（`/handoff` 命令）、`routes/handoff.ts`；renderer 标题栏"交接"、对话框（目标、未提交改动提示经 `git-status`）、进行中与停止、完成后切到目标会话并写入草稿、`handoff` / `handoff_origin` 时间线行。

**User stories:** 18

**Blocked by:** 04

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/agents/handoff.ts`、`packages/protocol/src/handoff.ts`、`apps/server/src/application/handoff.ts`、`application/context/handoff.ts`、`http/routes/handoff.ts`、`packages/i18n/src/dictionaries/domains/handoff.ts`、renderer `features/conversation/{handoff-dialog（新）,handoff-row}.tsx`、`header-actions.ts`（只改 handoff 一行）、`stores/handoff-store.ts`（新）、composer 草稿存储模块（只增加"为指定会话写入草稿"的导出）、就近测试、`tests/integration/{sidecar-handoff,secrets-gate-handoff}.test.ts`（新）、`apps/desktop/e2e/handoff.e2e.test.ts`（新）、`docs/subsystems/handoff.md`（新）

- [ ] 集成：`/handoff 接着实现登录页` → 一个 `trigger: handoff` 的 Run、faux requestLog 中只有一次无工具的摘要请求（含有效上下文与 instructions）→ 目标 Session 存在、首条 `handoff_origin`、模型 / 推理档位 / 权限模式与 Session 规则与源相同、没有 message / goal / todo_list / plan / job 条目；源 Session 有 `handoff { targetSessionId, summary, usage }`，其余不变
- [ ] 集成：目标为新 worktree（git 夹具）时目标 Session 绑定该 worktree、工作目录正确；源有未提交改动时 `git-status.dirtyFiles` 为实际数量；目标为已有 worktree 时复用
- [ ] 集成：Run 进行中 409、子 Session 409、没有用户消息 400；摘要 Run 被停止时不创建目标 Session 与 worktree
- [ ] **对手用例（预算）**：Goal running 且 `maxTokens` 已耗尽时 `/handoff` 不发出摘要请求、Run 以 `budget_exhausted` 结束、没有目标 Session；正常交接的 `handoff.usage` 计入 Goal 的 tokens（`GET …/goal` 断言）
- [ ] 秘密总闸 `secrets-gate-handoff`：源对话含登记 Secret 时摘要请求（requestLog）、`handoff` 条目、HTTP、WS 与库中没有明文；目标会话的草稿（renderer 读取的条目）同样没有
- [ ] E2E：标题栏"交接"打开对话框 → 选择新 worktree → 提交后显示进行中 → 切到目标会话、输入区草稿为摘要（未发送）→ 源会话时间线显示"已交接到 …"、目标时间线可跳回源；明暗主题与键盘操作
- [ ] 符号链接：不新增读取根（worktree 的检查在票 04；Comments 写明）
- [ ] handoff.md 建立并可达（含与 Fork 的差异表）；`check:docs` 通过

## Comments
- 2026-10-31 lead：来自票 02——/handoff 已出现在命令目录中，动作目前为 400 占位，由本票替换；摘要模式只提交 run_start / run_end，摘要的 usage 在 RunResult.summaryUsage，由本票写进 handoff 条目。
