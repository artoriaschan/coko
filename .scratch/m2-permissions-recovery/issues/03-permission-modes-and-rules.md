# 03: 权限模式、规则作用域与 Permissions 设置

**What to build:** 四种 Permission Mode（read-only、default、accept-edits、full-access）的判定（ADR 0005 表，不含沙箱执行）；规则语法与匹配（grilling A4：read / edit 组 gitignore 风格路径、bash 精确与前缀、复合命令拆分、命令替换与超 50 个子命令询问、安全 env 前缀剥离）；作用域 once / session / workspace / global 与持久化（Session 规则与模式为条目，Workspace 与全局为带 schema 的设置键，默认模式 `permissions.defaultMode`）；审批卡的"总是允许"下拉；模式或规则变更后重新判定 pending 请求（superseded）。server：`PUT …/permission-mode`、`GET/PUT /api/permissions`、`POST/DELETE …/permission-rules`。renderer：composer 模式选择（Shift+Tab 循环前三档，full-access 显式选择并有警示）、设置弹窗 Permissions 分区。

**User stories:** 5, 6, 7, 8, 9

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/policy/`（不含 `sandbox.ts`）、`packages/agent/src/session-entries/permissions.ts`、`packages/protocol/src/permissions.ts`、`apps/server/src/application/`（不含 `providers.ts`）、`apps/server/src/http/app.ts`、`apps/server/README.md`、`apps/desktop/src/renderer/features/conversation/`、`apps/desktop/src/renderer/features/settings/settings-dialog.tsx`、`apps/desktop/src/renderer/features/settings/permissions-section.tsx`（新）、`apps/desktop/src/renderer/stores/`、`packages/ui/src/`（不含 `components/sonner.tsx`、`components/dialog.tsx`）、`packages/i18n/src/dictionaries/`、`apps/desktop/e2e/permissions.e2e.test.ts`（新）、`tests/integration/sidecar-permissions.test.ts`（新）、`docs/subsystems/permissions.md`、`docs/adr/0005-permission-mode-and-sandbox.md`、`docs/adr/README.md`

- [ ] agent 表驱动测试：四种模式 × 工具类型的判定；规则匹配（`Bash(npm test)`、`Bash(git *)`、`git status && rm -rf x` 拆分后 deny、`$(…)` 询问、`FOO=1 npm test` 剥前缀、`LD_PRELOAD=… npm test` 不剥、`Edit(src/**)`、`Read(~/x)`）；拒绝规则在 full-access 下仍生效；受保护路径不被允许规则免除
- [ ] 集成测试：选"本 Workspace 总是允许"后同类调用不再询问；重启 Sidecar 后规则与模式仍生效；Session 规则只影响该 Session
- [ ] 集成测试：等待审批时切到 full-access → 请求以 superseded 结束并执行；新增拒绝规则 → superseded 并拒绝
- [ ] 集成测试：新 Session 的初始模式取 `permissions.defaultMode`；非法设置值经 `/api/permissions` 被 400 拒绝；通用设置接口不能写 `permissions.*`
- [ ] Electron E2E：Shift+Tab 循环三档且不进入 full-access；菜单选 full-access 后有警示样式；Permissions 分区增删全局规则并在下一次调用生效
- [ ] 总是允许下拉不对越界写入显示（越界写入由 05 定义为提权，本票先对"Workspace 外写入"隐藏）
- [ ] permissions.md 与 ADR 0005 同步

## Comments
