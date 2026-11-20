# 01: 设计稿与 ADR

**What to build:** 把 [规格](../spec.md) 的 Implementation Decisions 落成可照着实施的设计稿，并把“用户可以把判定最后一步的询问委托给模型，硬边界不可委托”记录为新的 ADR。之后的每张票都从这份设计稿取端口形状、条目 payload、模型可见文本与界面文案，不再各自决定。本票不改代码。

**User stories:** 无直接对应；支撑全部。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Closed: true

- [x] 设计稿保存为本功能目录下的 `design.md`，按 [设计模板](../../../docs/templates/design.md) 写：约束与驱动场景、责任与依赖、主要成功与失败路径、持久化与演进、比较过的方案、测试接口与验收证据
- [x] 设计以计划生命周期阶段一交付后的代码形状为基线，并写明这一前提
- [x] 写明 Reviewer 端口的形状（输入、放行与转交两种结果、失败的表达、取消），由谁提供实现，以及它在权限 gate 中相对 PreToolUse、PermissionRequest 与无人回答拒绝的位置
- [x] 写明调用 Reviewer 的完整条件与不调用的各种询问，包括 Hook 的强制询问、执行前复核、automation 类
- [x] 写明审查结果生效前的复核规则，以及模式或规则变化后各种新判定的处理
- [x] 写明 `permission_mode`、审批决定、审批请求三个条目新版本的 payload 与迁移规则，以及旧版本应用读取新数据时的行为
- [x] 写明审查请求的全部模型可见内容：固定的审查提示全文（含必须转交的类别）、输入三个分区的标注与数据边界、输出的结构与取值、供 faux 匹配的标记
- [x] 写明输入的字符上限、丢弃顺序与标注、待审调用过长的判定，理由的长度上限，超时时长
- [x] 写明失败原因的代码集合及其与界面文案的对应
- [x] 写明“自动审查中”推送的形状、发送与结束的时机、重连后的表现，以及 Sidecar 在审查途中退出后的恢复
- [x] 写明审查请求如何经请求前检查、如何记为 purpose `review` 的模型请求并归入 Run 用量与 Goal Budget
- [x] 写明 Subagent 的审查使用哪个模型、授权从哪里取，子 Session 的首条消息如何归类
- [x] 写明全部界面文案（中英文）：菜单四项的名称与说明、工具卡的审查中与放行标注、审批卡上的转交理由与各失败原因；“帮我批准”与“自动审查”的说明须能一眼分清
- [x] 新 ADR 按 [决定模板](../../../docs/templates/decision.md) 写，取当时的下一个编号：决定、理由、被否决的方案（改写 `accept-edits`、与模式正交的开关、Reviewer 可直接拒绝、失败即放行），并说明与 ADR 0005、0013、0019 的关系；批准状态为已批准、实施状态为未开始，确认依据引用 2026-11-20 的讨论结论
- [x] ADR 0005 标注“模式放行之后的最后一步询问可由用户委托给 Reviewer”由新 ADR 细化，其余决定继续有效；[ADR 索引](../../../docs/adr/README.md) 同步
- [x] 术语表不在本票修改
- [x] `pnpm run check:docs` 通过；从文档导航读回新 ADR 与 ADR 0005 的关系

## Comments

2026-11-20 实施代理：设计稿 [design.md](../design.md)（status approved，基线为 `feat/auto-review` 的 `69fa250e`）与 [ADR 0029](../../../docs/adr/0029-auto-review-delegates-final-ask.md)（accepted / not-started）已写成；ADR 0005 的 description、决定首段与“来源与后继”标注由 0029 细化，[ADR 索引](../../../docs/adr/README.md) 加入 0029 行并更新 0005 行；术语表未改。`pnpm run check:docs` 通过（452 个文件 0 个问题），从 docs/README → adr/README 读回 0005 与 0029 的互链。设计稿另列 7 条规格授权内的工程补充决定与 2 处对规格的事实更正（计划审阅卡现无“不得宽于规划前模式”的约束；Reviewer 的实现在 Sidecar 宿主而非 agent 运行时），供后续票与用户复核。

### 关闭（2026-11-20）

已合入集成分支 `feat/auto-review`（最终 HEAD c8633a1d，含两轴代码评审的修复）。
