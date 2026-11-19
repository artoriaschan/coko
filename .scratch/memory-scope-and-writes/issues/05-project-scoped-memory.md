# 05: 项目归属：Run 的项目记忆与工具作用域

**What to build:** 记忆跟着项目走。Session 属于某个 Project 时，Agent 看到并维护的是该项目主要文件夹上的项目记忆和用户级记忆；不属于任何项目时只有用户级记忆，工具里也没有“记到当前工作区”的选项。把独立对话移入项目、把对话从项目 A 移到项目 B、把对话移出项目或删除项目之后，从下一个 Run 起按新的归属生效，正在进行的 Run 不变。同一项目里的 worktree 对话与子代理使用同一份项目记忆。项目更换主要文件夹后改用新文件夹上的记忆。存储不变：记忆仍以 Workspace 为键保存，不新增 schema 版本，不迁移已有数据。

**规格场景:** [spec](../spec.md) 的 AC-01 至 AC-11；实现决定“归属的解析”“工具”；用户故事 1 至 9。

**文档影响:** [Memory](../../../docs/subsystems/memory.md) 的条目与作用域、注入与工具；[项目与会话列表](../../../docs/subsystems/projects.md) 中会话移动、删除项目对记忆的说明；[权限判定与审批](../../../docs/subsystems/permissions.md) 中“按 Workspace 保存的批准和记忆保持原绑定”的说法（批准不变，记忆改为跟随归属）；[子代理](../../../docs/subsystems/subagents.md) 的上下文一节。

**Blocked by:** 01 新增 ADR 与术语更新；03 Memory 段：声明、来源标注与写入引导

**Status:** ready-for-agent

- [ ] 每个 Run 开始时解析本次使用的项目记忆 Workspace：根 Session 当前属于某个 Project 时取其主要文件夹对应的 Workspace，否则为空；解析时机与来源和每个 Run 的 Workspace 根快照相同。
- [ ] AC-01：项目 P 的主要文件夹上已有项目记忆、另有用户级记忆时，在 P 中新建 Session 并发送，请求的 Memory 段同时包含两者。
- [ ] AC-02、AC-03：不属于任何项目的 Session 的 Memory 段只有用户级条目；`memory_write` 与 `memory_list` 的 `scope` 没有 `workspace` 取值，`memory_write` 的作用域缺省为 `user`；段内没有关于项目级的引导；模型仍以 `workspace` 调用时得到参数错误，库中没有新增条目。
- [ ] AC-04、AC-05：独立对话移入项目 P 后，下一个 Run 的 Memory 段包含 P 的项目记忆，以 `workspace` 写入的条目保存在 P 的主要 Workspace 上并对 P 的其他 Session 的下一个 Run 可见；Run 进行中移入时，本次 Run 后续的记忆工具调用仍按 Run 开始时的归属。
- [ ] AC-06：项目 A 的 Session 移到项目 B 后，下一个 Run 使用 B 的项目记忆，不含 A 的；以 `workspace` 写入落在 B。
- [ ] AC-07、AC-08：Session 移出项目或其项目被删除后，下一个 Run 只有用户级；原项目记忆仍在库中；用同一文件夹重新创建项目后，新项目中的 Session 能看到它们。
- [ ] AC-09：项目 Session 派发的子代理与 Teammate 按根 Session 的归属使用同一份项目记忆。
- [ ] AC-10：绑定 worktree 的项目 Session 使用该项目的项目记忆。
- [ ] AC-11：项目更换主要文件夹后，项目 Session 的下一个 Run 使用新主要文件夹上的记忆，原记忆仍保存在原 Workspace 上。
- [ ] 尚未创建 Session 的新对话草稿按草稿当前选择的项目解析；上下文用量中的 Memory 统计使用同一解析结果。
- [ ] 面向模型的说明把 `workspace` 作用域解释为当前项目；存储值与协议值不改名。
- [ ] 场景经真实 Sidecar（faux 脚本）验证，用请求日志断言 Memory 段与工具声明，用记忆接口断言库中的结果；现有记忆用例中“另一个 Workspace 只有用户级”等按 Session 的 Workspace 判定的断言按本规格改写。
- [ ] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-19：用户确认 9 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
- 判定只看项目归属，不看工作目录：从项目移出或项目被删除后留下的 Session 即使工作目录仍是原项目文件夹，也只有用户级记忆。
