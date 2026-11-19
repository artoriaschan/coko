# 01: 新增 ADR 与术语更新

**What to build:** 把本规格中两项长期决定写成一条 ADR，让之后想恢复审批、放宽限制或再次调整记忆归属的人能读到当初的理由：一是 Session 使用哪个 Workspace 的记忆由当前项目归属决定，不属于项目的 Session 只有用户级记忆；二是记忆的写入、替换与删除不经审批，改由 Memory 段声明、来源标注、用户来源条目不可被模型改动、子 Session 与 Headless Run 只读来约束，并写明残余风险。同时更新术语表中 Memory Entry 的定义，使它与“用户级 / 项目级”的说法一致。本票只写文档，不改变产品行为。

**规格场景:** [spec](../spec.md) 的“来源、确认与实施状态”“Solution”与 Further Notes 中的“新增 ADR”“残余风险”。

**文档影响:** 新增一条 ADR（下一个可用编号，当前为 0027）；[ADR 0020](../../../docs/adr/0020-projects-organize-workspaces.md) 增加后继说明，指出关于记忆的部分被局部替代、批准规则与工作目录的部分不变；[ADR 索引](../../../docs/adr/README.md)；[术语表](../../../GLOSSARY.md) 的 Memory Entry。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 新 ADR 按[决策模板](../../../docs/templates/decision.md)写成，包含上下文、决定、理由与考虑过的备选方案（记忆继续固定在 Session 的 Workspace 上；只放行项目级写入、用户级仍询问；保留默认询问）、后果与残余风险、需要重新审视的条件。
- [ ] ADR 写明用户确认的日期与依据（2026-11-19 的需求澄清），区分用户明确提出的要求与采纳的推荐；正文自身提炼必要背景，不链接任务材料。
- [ ] ADR 的 status 与 implementation 按[状态与晋升](../../../docs/DOCUMENTATION_SYSTEM.md#四-状态与晋升)填写；功能尚未实施，不得标为已实施。
- [ ] ADR 0020 的“来源与后继”指向新 ADR，写明局部替代的范围；[ADR 0022](../../../docs/adr/0022-project-removal-preserves-sessions.md) 关于删除项目保留记忆的决定不变，新 ADR 中引用它。
- [ ] 术语表中 Memory Entry 的定义改为反映用户级与项目级两个层级，只保留定义，不写存储字段与实现细节。
- [ ] ADR 索引新增一行；`pnpm run check:docs` 通过，并从 AGENTS.md、docs/README 到正文依次读回。
- [ ] 实际执行的检查与文档影响记入 Comments。

## Comments

- 2026-11-19：用户确认 9 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
