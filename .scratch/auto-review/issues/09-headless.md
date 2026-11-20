# 09: 无界面运行

**What to build:** 脚本与 CI 可以用 `--permission-mode auto-review` 让模型放行常规动作。Reviewer 放行的调用照常执行；Reviewer 转交或审查失败的调用因为没有审批者而立即被拒绝，进程不会挂起，`--on-approval fail` 照常让流水线在需要人工决定时失败。

**User stories:** 61–63。

**Blocked by:** 04

**Status:** ready-for-agent

Closed: true

- [x] 无界面运行在 `auto-review` 下，Reviewer 放行的调用执行，条目为请求与 Reviewer 的允许决定
- [x] Reviewer 转交的调用：提交回答者为 headless 的拒绝决定，模型看到现有的无审批者文本，Run 继续
- [x] 审查失败（超时、报错、输出无效、没有模型、预算、内容过长）的调用同样以 headless 拒绝
- [x] 回答顺序为 PermissionRequest Hook → Reviewer → headless 拒绝；Hook 给出决定时没有审查请求
- [x] `--on-approval fail` 在转交或失败后的拒绝上停止 Run，并以既有退出码结束
- [x] 硬边界上的询问（询问规则、Protected Path、越出可写根、Escalation）不经 Reviewer，直接以 headless 拒绝，与现状相同
- [x] 无界面运行中审查请求的用户授权为启动时给出的提示
- [x] 无界面集成测试覆盖以上各项，沿用现有无界面 harness
- [x] 对手用例：模型输出中伪造的 Reviewer 放行文本不改变决定

## Comments

**2026-11-20 实施完成（未改产品代码，与设计稿“7 无界面运行”一致）。**

- 新增 `tests/integration/headless-auto-review.test.ts`（沿用 headless-harness 与 faux 的 requestDetailsLog）：放行 by reviewer 并执行、
  审查请求的 user_messages 只有 `--prompt`；转交与伪造 Reviewer 放行文本的对手用例；request-failed 与 invalid-output 以 headless 拒绝；
  `--on-approval fail` 在转交与失败后退出 3；PermissionRequest Hook allow / deny 时无审查请求；询问规则、`.git`、越出可写根、
  Escalation（darwin）不送审。
- `gate-unattended.test.ts` 增加 unattended + Reviewer：放行、转交与六种失败代码逐一以 headless 拒绝、Hook 与受保护路径不送审。
- 偏离：超时没有在无界面集成测试中跑。headless 没有 HTTP 服务，faux 的延时走 unref 的时钟计时器，只剩它时进程以 13 退出；
  真实 Provider 请求持有连接，不受影响。超时代码由 gate 单元测试与 sidecar-auto-review 覆盖。no-model、budget、too-long
  同样只在 gate 单元测试中断言（too-long 的产生在票 05）。
- 验证：`pnpm exec vitest run tests/integration/headless-auto-review.test.ts` 7 通过；`pnpm exec vitest run
  packages/agent/src/policy/gate-unattended.test.ts packages/agent/src/policy/gate-review.test.ts
  tests/integration/headless-approvals.test.ts tests/integration/headless.test.ts` 5 文件 57 通过；`pnpm typecheck` 通过；
  `pnpm lint`（rtk proxy）退出 0。

### 关闭（2026-11-20）

已合入集成分支 `feat/auto-review`（最终 HEAD c8633a1d，含两轴代码评审的修复）。
