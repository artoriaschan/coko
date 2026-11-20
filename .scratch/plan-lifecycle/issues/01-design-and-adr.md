# 01: 设计稿与 ADR

**What to build:** 把 [规格](../spec.md) 的 Implementation Decisions 落成可照着实施的设计稿，并把“计划是独立的 Session 状态，不是 Permission Mode”记录为新的 ADR。之后的每张票都从这份设计稿取条目形状、接口路径与模型可见文本，不再各自决定。本票不改代码。

**User stories:** 无直接对应；支撑全部。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Closed: true

- [x] 设计稿保存为本功能目录下的 `design.md`，按 [设计模板](../../../docs/templates/design.md) 写：约束与驱动场景、责任与依赖、主要成功与失败路径、持久化与演进、比较过的方案、测试接口与验收证据
- [x] 写明计划阶段条目的名称与 payload（无、规划中、执行中及其 planId），`permission_mode` 新版本的 payload 与读取迁移规则，`plan` 条目新增的两个状态与完成报告字段
- [x] 写明 Session 计划接口的路径、读取结果、进入与退出动作的请求、结果与错误码，以及 Run 进行中调用的效果
- [x] 写明判定中“规划中拒绝写入”的位置、与外部 Hook 的组合、沙箱档位的推导、提权与固定更宽沙箱的处理
- [x] 写明全部模型可见文本：两份 `<plan_mode>`（根 Session 与子 Session）、写入拒绝、提权拒绝、批准的工具结果（阶段一与阶段二两版）、执行中的 State Update 名称、值与渲染、`complete_plan` 的参数上限、成功与错误结果
- [x] 写明回退、分叉、交接时计划阶段与 `plan` 条目的回放与复制规则，以及服务端在回退后如何重新计算
- [x] 写明两处过渡状态及其结束点：02 到 07 之间旧的 `plan` 模式路径与计划阶段并存；阶段一与阶段二之间批准后的计划阶段为“无”
- [x] 写明旧版本应用读取含新条目、新版本条目的数据库时的行为
- [x] 新 ADR 按 [决定模板](../../../docs/templates/decision.md) 写：决定、理由、被否决的方案（借用只读判定、沿用权限模式对应的沙箱、批准时自动创建 Goal），批准状态为已批准、实施状态为未开始，确认依据引用 2026-11-20 的讨论结论
- [x] ADR 0005 标注其中“plan 作为模式取值”的部分被新 ADR 替代，其余决定继续有效；[ADR 索引](../../../docs/adr/README.md) 同步
- [x] 术语表不在本票修改
- [x] `pnpm run check:docs` 通过；从文档导航读回新 ADR 与 ADR 0005 的替代关系

## Comments

- 2026-11-20（implementer）：设计稿 [design.md](../design.md) 已按设计模板完成并标为 approved（依据：规格已确认、01 票授权设计阶段确定路径；超出规格字面的 7 项工程判断列在其“待决问题与确认”中，均不阻塞）。新 ADR 为 [ADR 0028](../../../docs/adr/0028-plan-phase-not-permission-mode.md)（accepted / not-started）；ADR 0005 在“决定”、相应条目、description 与“来源与后继”标注 plan 取值部分被替代，[ADR 索引](../../../docs/adr/README.md) 已同步；规格头部补了设计与 ADR 0028 的链接。术语表未改。`pnpm run check:docs` 通过，并从 docs/README → adr/README → 0028 / 0005 读回替代关系。未改代码、未运行测试。

### 关闭（2026-11-20）

已合入集成分支 `feat/plan-lifecycle`（最终 HEAD ecfcbde8，含代码审查修复）。
