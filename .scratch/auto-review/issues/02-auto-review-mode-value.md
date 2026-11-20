# 02: `auto-review` 成为可选的模式

**What to build:** 用户能在模式菜单、Shift+Tab 循环、设置页默认模式与计划审阅卡上选到“自动审查”，集成方能经协议、首次发送与无界面参数使用 `auto-review`。本票不接入 Reviewer：选中后的判定、可写根与命令沙箱都与“帮我批准”逐项相同，原本要询问的调用照旧出审批卡。它单独可演示、可合并。

**User stories:** 1–11、61（参数被接受）、64、67–69；51 中“定义可以写 `auto-review`”的取值校验。

**Blocked by:** 01；[计划生命周期 08](../../plan-lifecycle/issues/08-phase-one-acceptance-and-docs.md)（阶段一交付后 Permission Mode 才是四档）

**Status:** ready-for-agent

- [ ] Permission Mode 取值为 read-only、default、accept-edits、auto-review、full-access；`accept-edits` 的行为不变
- [ ] `permission_mode` 条目按设计稿升一版，旧版本读取结果不变，数据库行不被改写
- [ ] 判定表中 `auto-review` 一列与 `accept-edits` 逐项相同（含各权限类）；Sandbox Mode 为 workspace-write，可写根与 `accept-edits` 相同
- [ ] 宽窄比较覆盖五档的全部组合：read-only < default < accept-edits < auto-review < full-access
- [ ] 切换 Session 模式、首次发送、默认模式设置接受 `auto-review`；项目设置文件中的默认模式照旧被忽略
- [ ] 无界面运行的 `--permission-mode auto-review` 被接受，用法说明与取值错误的文本列出五档
- [ ] Subagent 定义的 `permission-mode` 接受 `auto-review`，取值错误的文本列出五档；评测用例的权限模式接受新取值
- [ ] 外部 Hook 输入中的权限模式在该模式下为 `auto-review`
- [ ] 模式菜单为四项：请求批准、帮我批准、自动审查、完全访问权限；“自动审查”有自己的图标、使用普通档位的颜色、选择时不确认；说明文字取自设计稿
- [ ] 输入区权限按钮在该模式下显示“自动审查”及其图标
- [ ] Shift+Tab 循环为 read-only → default → accept-edits → auto-review，从 full-access 回到 read-only
- [ ] 设置页默认模式可选“自动审查”，新 Session 以它开始
- [ ] 计划审阅卡的模式菜单出现“自动审查”，且受“不得宽于进入规划前的模式”的既有约束
- [ ] 从该模式的 Session 分叉或交接出的新 Session 模式相同
- [ ] 真实 Sidecar 集成测试：切到 `auto-review` 后读回模式；可写根内编辑免审批；未被规则覆盖的命令出现普通审批请求；重启后模式仍在
- [ ] renderer 的 Browser Mode 测试覆盖菜单四项与勾选、说明文字、循环顺序、设置页选项
- [ ] 以四档为全集的现有断言按五档更新，不删除其覆盖的场景
- [ ] 中英文文案齐全

## Comments
