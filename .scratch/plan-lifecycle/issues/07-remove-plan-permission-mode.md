# 07: 从 Permission Mode 中移除 `plan`

**What to build:** 收尾清理。04 之后已经没有路径会把 Permission Mode 设为 `plan`，本票把它从类型、判定、沙箱映射与界面里删掉，并让旧 Session 中记录的 `plan` 按它进入前的模式读取。升级后打开旧对话不出错，权限也不会变宽。见 [规格](../spec.md) 的“两个阶段共用的数据形状”与设计稿。

**User stories:** 41、42、43、44

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Permission Mode 的类型只有四档；判定、沙箱映射、Subagent 的模式比较、模式图标与循环顺序中针对 `plan` 的分支全部删除；`pnpm run typecheck` 通过
- [ ] `permission_mode` 条目升一版：读取时 `plan` 取 `prior`，没有 `prior` 取 default；不改写数据库行（用例读回数据库中的原始版本号）
- [ ] 预置含旧 `plan` 记录的 Session：模式读回为 `prior`，不在规划中，没有 `<plan_mode>`，已提交的计划仍可在时间线与右栏查看
- [ ] 预置“首次发送带 `plan`、没有 `prior`”的旧 Session：模式读回为 default
- [ ] Session 权限的读取结果与审计的权限模式事件不再带 `prior`
- [ ] 02 留下的过渡状态结束：不再有 `plan` 模式与计划阶段并存的 Session
- [ ] 新对话草稿里残留的 `plan` 权限读取时按未设置处理，首次发送不带它
- [ ] 删除不再使用的规划模式说明与恢复模式文案，两种语言的词典保持同构
- [ ] 旧版本应用读取新版本 `permission_mode` 条目的行为写入兼容说明
- [ ] 现有涉及 `plan` 模式的测试文件逐个核对：场景保留，断言按新行为更新
- [ ] 文档：权限判定与审批（模式数量与模式表）、追踪与审计；`pnpm run check:docs` 通过
