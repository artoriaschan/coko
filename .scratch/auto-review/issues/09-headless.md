# 09: 无界面运行

**What to build:** 脚本与 CI 可以用 `--permission-mode auto-review` 让模型放行常规动作。Reviewer 放行的调用照常执行；Reviewer 转交或审查失败的调用因为没有审批者而立即被拒绝，进程不会挂起，`--on-approval fail` 照常让流水线在需要人工决定时失败。

**User stories:** 61–63。

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] 无界面运行在 `auto-review` 下，Reviewer 放行的调用执行，条目为请求与 Reviewer 的允许决定
- [ ] Reviewer 转交的调用：提交回答者为 headless 的拒绝决定，模型看到现有的无审批者文本，Run 继续
- [ ] 审查失败（超时、报错、输出无效、没有模型、预算、内容过长）的调用同样以 headless 拒绝
- [ ] 回答顺序为 PermissionRequest Hook → Reviewer → headless 拒绝；Hook 给出决定时没有审查请求
- [ ] `--on-approval fail` 在转交或失败后的拒绝上停止 Run，并以既有退出码结束
- [ ] 硬边界上的询问（询问规则、Protected Path、越出可写根、Escalation）不经 Reviewer，直接以 headless 拒绝，与现状相同
- [ ] 无界面运行中审查请求的用户授权为启动时给出的提示
- [ ] 无界面集成测试覆盖以上各项，沿用现有无界面 harness
- [ ] 对手用例：模型输出中伪造的 Reviewer 放行文本不改变决定

## Comments
