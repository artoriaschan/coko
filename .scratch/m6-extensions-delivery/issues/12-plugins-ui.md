# 12: 插件界面：设置 → 插件分区、安装、批准对话框、启用 / 更新 / 卸载

**What to build:** 见 [规格](../spec.md)"插件"与 [grilling B6](../grilling.md#第-4-轮)：renderer `plugins-store`（经 `requestJson`）、设置 → 插件分区（注册表 `plugins` 一行改为可用）：安装（目录选择经现有的目录选择 IPC，或 git URL 与可选 ref）、列表（名字、版本、来源与 commit、状态、贡献计数、诊断）、批准对话框（每条 Hook 的事件 / matcher / 完整命令，每个 MCP / LSP Server 的命令、参数、地址与 env 键；Skills / 命令 / 子代理的名字）、启用开关、更新（digest 变化时提示重新批准）、卸载（确认框）。参考 DSH `client/ui-settings` 的列表与 `ui-cordis` 的扩展详情。

**User stories:** 1, 2, 3（界面）

**Blocked by:** 04

**Status:** ready-for-agent

**Write scope:** renderer `features/settings/{plugins-section.tsx（新）,plugin-approval-dialog.tsx（新）,sections.ts（只改 plugins 一行）}`、`stores/plugins-store.ts`（新）、`packages/i18n/src/dictionaries/domains/plugins.ts`、就近测试、`apps/desktop/e2e/plugins.e2e.test.ts`（新）、`docs/subsystems/plugins.md`（界面一节）、`docs/adr/0017-plugins-declarative-user-installed.md`（改 implemented）、`docs/adr/README.md`（0017 一行）

**跨票接口：** 使用 04 的 `GET / POST / PATCH / DELETE /api/plugins` 与 `PluginView`，不改服务端。

- [ ] Browser Mode：列表的五种状态与诊断；批准对话框显示全部命令（长命令换行、不截断）且只有"批准"后才发 approve；卸载确认；store 的错误体按 `ErrorResponse` 校验
- [ ] E2E（真实 Electron 与 Sidecar）：从夹具目录安装 → 待批准 → 打开对话框看到 Hook 的完整命令 → 批准 → 启用；新会话的 `/` 命令菜单出现 `sample:hello`；禁用后消失；更新夹具副本的 Hook 命令后"更新"→ 回到待批准；卸载后列表为空；明暗主题对比度与键盘操作（Tab 到批准按钮、Esc 关闭对话框）
- [ ] plugins.md 界面一节；ADR 0017 改 implemented（链接 04 与本票的证据），README 索引同步；docs/README 一行（若 04 未加）；`check:docs` 通过

## Comments
