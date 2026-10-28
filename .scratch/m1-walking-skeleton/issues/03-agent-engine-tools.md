# 03: Agent 运行时与内置工具

**What to build:** packages/agent 封装 pi Agent：models（pi-ai 三协议、CredentialStore 端口、可重试错误）、tools（注册表、显式覆盖、内置 read/write/edit/bash/grep/find/ls、截断、超时与取消）、engine（run / abort / subscribe，message_end 可等待提交，工具结果按调用顺序，progress 与 entry 区分）、最小 Hook 调度点、ports（执行接口）。参考 [pi 研究](../../desktop-app/research/pi-agent-core-and-coding-agent.md)。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] faux provider + 临时 Workspace：模型调用 write 后文件内容正确，read / edit / ls / find / grep / bash 结果与 schema 一致
- [ ] 并行工具调用的持久化顺序等于模型调用顺序
- [ ] abort 后 Run 以取消结束，bash 子进程已退出
- [ ] 未声明覆盖的重名注册报错；声明覆盖后生效实现被替换且契约不变
- [ ] 内置 grep 契约测试可被宿主实现复用（导出契约测试套件）
- [ ] pi-ai 流错误转为 Run 错误条目，可重试错误按策略重试

## Comments
