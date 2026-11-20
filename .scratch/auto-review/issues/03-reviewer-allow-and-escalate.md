# 03: Reviewer 放行与转交

**What to build:** 在“自动审查”下，原本要出审批卡的调用先发一次审查请求。Reviewer 放行时调用直接执行，工具卡标出“已由自动审查允许”并可展开查看理由；Reviewer 不放行时出现与现在相同的审批卡。拒绝规则、询问规则、Protected Path、越出可写根、Escalation、计划审阅、Hook 的决定与定时任务的创建都不经 Reviewer。本票的审查输入只含用户消息与待审调用，分区、上限与其余来源在 05 完成；转交理由与失败原因的展示在 04 完成，本票中失败按转交处理并出普通审批卡。

**User stories:** 12–19、21、23、26–37、59、65、66。

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] 权限 gate 有 Reviewer 端口；没有端口时行为与 02 交付后相同
- [ ] 只在以下条件同时成立时调用 Reviewer：模式为 `auto-review`、最终结论是来自判定第 7 步的询问、PermissionRequest Hook 没有决定、权限类不是 automation
- [ ] Reviewer 放行：依次提交审批请求与回答者为 Reviewer、带理由、scope 为 once 的允许决定，不进入等待表，随后执行
- [ ] Reviewer 转交或审查失败：出现普通的待审批请求，带原有的建议规则；用户允许、带反馈拒绝、无反馈拒绝的语义与现状相同
- [ ] Reviewer 不能使调用被拒绝
- [ ] 审批决定条目按设计稿升版（回答者增加 Reviewer、可选理由），旧版本读取正常
- [ ] 审查请求使用 Session 当前模型、不带工具、输出上限与超时取自设计稿，系统提示为设计稿中的固定审查提示
- [ ] 审查请求记为带 runId、purpose 为 `review` 的模型请求，出现在追踪中
- [ ] 审查放行的命令仍在 workspace-write 沙箱中运行
- [ ] 同一批的多个调用按现有顺序逐个审查
- [ ] 工具卡在 Reviewer 放行后标题行显示“已由自动审查允许”，展开可读理由
- [ ] 集成测试（faux 审查应答为放行）：没有等待中的审批请求，条目顺序为请求、Reviewer 的允许决定、执行
- [ ] 集成测试（faux 审查应答为转交）：出现待审批请求，允许后执行，拒绝后与现有拒绝语义相同
- [ ] 送审范围的集成测试：MCP 工具调用、Workspace 外的读取、带 Worktree 隔离的 Subagent 派发都有审查请求
- [ ] 不送审的集成测试：允许规则覆盖的命令、Workspace 内读取、可写根内编辑没有审查请求；`schedule_create` 直接出审批请求
- [ ] Hook 顺序的集成测试：PermissionRequest Hook 给出 allow 或 deny 时没有审查请求，没有决定时有；PreToolUse Hook 的强制询问不经审查
- [ ] 对手用例（faux 审查应答恒为放行）：拒绝规则拒绝；询问规则、`.git` 内写入、越出可写根的写入、Escalation、计划审阅都出现审批请求，且请求明细日志中没有对应的审查请求
- [ ] 对手用例：审查放行的越界写入命令被 Seatbelt 拒绝（darwin；其他平台按现有约定跳过）
- [ ] gate 的运行时级测试：端口的放行、转交、抛错三种结果；没有端口时不变
- [ ] renderer 的 Browser Mode 测试覆盖工具卡的放行标注与理由

## Comments
