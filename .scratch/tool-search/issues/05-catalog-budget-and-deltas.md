# 05: 目录预算降级与增量公告

**What to build:** MCP 工具很多时，目录在预算内尽量写全：先统一缩短说明（最短 24 字），仍超出时从最长的组开始降为只列名称，再降为只列 Server 与工具数。预算取 5000 token 与上下文窗口 2.5% 中的较小值；token 按中日韩字符 1 个、其余字符 chars/4 估算。第一个 Run 送完整目录，之后的 Run 只送 Added/Removed；压缩或回退移除了前一条目录之后，下一个 Run 重发完整目录；目录不变不送。Run 进行中重连成功的 Server，它的工具在下一个 Run 才进入目录，并可以搜索。

**规格场景:** [spec](../spec.md) 的 AC-06、AC-07、AC-08；对应 TS-11、12、13。

**设计依据:** [design.md](../design.md) 第 5 节“目录 State Update”与第 9 节的 token 估算；[ADR 0024](../../../docs/adr/0024-session-state-as-state-updates.md)。

**文档影响:** [上下文管理](../../../docs/subsystems/context.md) 的 State Update 说明补充目录的增量与重发规则。

**Blocked by:** 03 按需加载最小闭环：目录、按确切名称加载与加载记录

**Status:** ready-for-agent

- [ ] AC-06：完整渲染超出预算时按上述顺序降级；说明不少于 24 字；任何一级都不含 schema。预算与 token 估算按上述规则计算，单测覆盖每一级降级的边界。
- [ ] AC-07：两个 Run 之间新增一个 Server、移除另一个，下一个 Run 只送达 Added 与 Removed；手动压缩之后，以及回退到压缩之前之后，下一个 Run 各重发完整目录；目录不变的 Run 不送。已公告的名单从有效上下文判断，不另存。
- [ ] AC-08：Run 开始时某 Server 连接失败，Run 进行中手动重连成功，本 Run 搜不到它的工具；下一个 Run 的目录包含这些工具，可以搜索加载。
- [ ] 目录读取或渲染失败时记 warn，本次不发送，Run 继续。
- [ ] 场景经真实 Sidecar（faux 脚本）验证，降级与增量渲染另有纯函数单测；模型可见文本的变化同步到会话回放或快照。
- [ ] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系，并采用目录预算的 token 估算：中日韩字符按 1 token，其余按 chars/4。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
