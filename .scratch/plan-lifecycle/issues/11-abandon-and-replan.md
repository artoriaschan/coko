# 11: 放弃与重新规划

**What to build:** 用户可以明确结束一份执行中的计划。执行中用 `/plan off` 或 Plan chip 的 × 放弃，Plan 标为已放弃，已做的改动原样保留；执行中再输入 `/plan` 则先放弃旧计划，再进入新一轮禁止写入的规划，新计划使用新的编号。一个 Session 同一时刻只有一份活动的 Plan。见 [规格](../spec.md) 的“阶段二：执行中与完成”中的放弃、重新规划与分叉三条。

**User stories:** 60、61、62、63、64、65、66（放弃部分）、67

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] 执行中的退出动作（`/plan off`、Plan chip 的 ×、计划接口）：依次提交已放弃的 `plan` 条目与计划阶段“无”；Workspace 文件逐字节不变，不产生 Checkpoint 操作；取代 09 的过渡行为
- [ ] 放弃不弹确认；失败时界面保留状态并提示
- [ ] Run 进行中放弃：之后本 Run 再调用 `complete_plan` 得到错误结果
- [ ] 执行中的进入动作（`/plan`、计划接口）：先按放弃处理当前 Plan，再提交“规划中”；之后写入被拒；新提交的计划使用新的 planId、修订从 1 开始
- [ ] 规划中的退出不改动待审阅的 `plan` 条目，行为与阶段一相同
- [ ] 任一时刻至多一份活动的 Plan：规划中没有执行中的 Plan，执行中不能同时规划
- [ ] 放弃后的下一个 Run：执行中的 State Update 送达一次清空；`<approved_plan>` 不再注入
- [ ] 回退到放弃之前的消息：计划阶段回到执行中，Plan 的状态回到已批准
- [ ] 分叉与交接：从执行中的 Session 得到的新 Session 没有计划阶段，也没有活动的 Plan
- [ ] 桌面：时间线计划卡与右栏 Plan 页显示“已放弃”；Plan chip 消失；重新规划后 chip 显示“计划”
- [ ] Sidecar 集成测试与 renderer 浏览器测试覆盖以上各项
- [ ] 文档：Plan Mode、命令（`/plan` 的语义）、桌面工作台；`pnpm run check:docs` 通过
