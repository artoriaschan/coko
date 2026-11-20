# 02: `auto-review` 成为可选的模式

**What to build:** 用户能在模式菜单、Shift+Tab 循环、设置页默认模式与计划审阅卡上选到“自动审查”，集成方能经协议、首次发送与无界面参数使用 `auto-review`。本票不接入 Reviewer：选中后的判定、可写根与命令沙箱都与“帮我批准”逐项相同，原本要询问的调用照旧出审批卡。它单独可演示、可合并。

**User stories:** 1–11、61（参数被接受）、64、67–69；51 中“定义可以写 `auto-review`”的取值校验。

**Blocked by:** 01；[计划生命周期 08](../../plan-lifecycle/issues/08-phase-one-acceptance-and-docs.md)（阶段一交付后 Permission Mode 才是四档）

**Status:** ready-for-agent

Closed: true

- [x] Permission Mode 取值为 read-only、default、accept-edits、auto-review、full-access；`accept-edits` 的行为不变
- [x] `permission_mode` 条目按设计稿升一版，旧版本读取结果不变，数据库行不被改写
- [x] 判定表中 `auto-review` 一列与 `accept-edits` 逐项相同（含各权限类）；Sandbox Mode 为 workspace-write，可写根与 `accept-edits` 相同
- [x] 宽窄比较覆盖五档的全部组合：read-only < default < accept-edits < auto-review < full-access
- [x] 切换 Session 模式、首次发送、默认模式设置接受 `auto-review`；项目设置文件中的默认模式照旧被忽略
- [x] 无界面运行的 `--permission-mode auto-review` 被接受，用法说明与取值错误的文本列出五档
- [x] Subagent 定义的 `permission-mode` 接受 `auto-review`，取值错误的文本列出五档；评测用例的权限模式接受新取值
- [x] 外部 Hook 输入中的权限模式在该模式下为 `auto-review`
- [x] 模式菜单为四项：请求批准、帮我批准、自动审查、完全访问权限；“自动审查”有自己的图标、使用普通档位的颜色、选择时不确认；说明文字取自设计稿
- [x] 输入区权限按钮在该模式下显示“自动审查”及其图标
- [x] Shift+Tab 循环为 read-only → default → accept-edits → auto-review，从 full-access 回到 read-only
- [x] 设置页默认模式可选“自动审查”，新 Session 以它开始
- [x] 计划审阅卡的模式菜单出现“自动审查”，且受“不得宽于进入规划前的模式”的既有约束
- [x] 从该模式的 Session 分叉或交接出的新 Session 模式相同
- [x] 真实 Sidecar 集成测试：切到 `auto-review` 后读回模式；可写根内编辑免审批；未被规则覆盖的命令出现普通审批请求；重启后模式仍在
- [x] renderer 的 Browser Mode 测试覆盖菜单四项与勾选、说明文字、循环顺序、设置页选项
- [x] 以四档为全集的现有断言按五档更新，不删除其覆盖的场景
- [x] 中英文文案齐全

## Comments

### 2026-11-20 实施完成（票 02）

- 取值：agent 与 protocol 的 Permission Mode 加入 `auto-review`（accept-edits 与 full-access 之间）；`permission_mode` 升 v4（v3 → v4 恒等，v1–v3 schema 仍为四档）；`PERMISSION_MODE_ORDER`、定义文件错误文本、`modeAllows`（与 accept-edits 共用分支）、`SANDBOX_MODE`（workspace-write）、`CYCLED_PERMISSION_MODES`（四档）、headless `MODES`（用法说明改为列出五档）、`EvalPermissionMode`。
- 界面：菜单四项（`IconShieldSearch`，普通档位颜色，不确认）、设置页五项、中英文名称与说明（accept-edits 说明按设计稿改写）。
- 偏离或说明：
  - 计划审阅卡：按设计稿“对规格的事实更正”，现状没有“不得宽于进入规划前的模式”约束，本票未新增；审阅卡随 `ModePicker` 得到“自动审查”。
  - 交接：把 `sidecar-handoff.test.ts` 中源 Session 的模式由 accept-edits 改为 auto-review（交接复制与模式值无关）。
  - Electron E2E `permissions.e2e.test.ts` 的循环断言已改为四档，但该用例在基线上即失败于更早的 `'hello'` 文本断言（消息页脚多出 “Usage unavailable”），未能跑到循环部分。
- 实际运行（均在本 worktree）：
  - `pnpm exec vitest run packages/agent/src/policy/decide.test.ts packages/agent/src/policy/sandbox.test.ts packages/agent/src/agents/definitions.test.ts`：先红（11 失败）后绿（148 通过）。
  - `pnpm exec vitest run packages/agent packages/protocol packages/i18n apps/server/src apps/desktop/src/renderer/stores tests/evals/case.test.ts`：2060 通过、10 失败；10 个失败在 `feat/auto-review` 基线上同样失败（entries kind 列表、capability 默认值、条目顺序等，与本票无关）。
  - Browser Mode：`mode-picker.browser.test.tsx`（新，4）、`plan.browser.test.tsx`、`new-chat.browser.test.tsx`、`agents-section.browser.test.tsx`：42 通过。
  - 真实 Sidecar：`sidecar-permissions`、`headless`、`sidecar-handoff`、`sidecar-skills`、`sidecar-plan`、`sidecar-hooks`：77 通过。
  - `pnpm typecheck` 通过；`pnpm lint` 通过（0 告警）；改动文件经 `oxfmt` 格式化。
  - `pnpm exec vitest run --project desktop-e2e apps/desktop/e2e/permissions.e2e.test.ts -t "Shift\+Tab"`：1 失败（基线同样失败，见上）。

### 关闭（2026-11-20）

已合入集成分支 `feat/auto-review`（最终 HEAD c8633a1d，含两轴代码评审的修复）。
