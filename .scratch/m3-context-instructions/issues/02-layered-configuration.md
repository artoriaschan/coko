# 02: 分层配置、能力开关与项目设置

**What to build:** agent `config/` 的合并与诊断（默认 ← 全局 ← 项目，项目只收紧，见 [ADR 0008](../../../docs/adr/0008-project-files-only-tighten.md) 与 [规格](../spec.md#配置-schemaagent-config票-01-预先定义类型与默认值票-02-实现加载合并与接口)）；server `application/config.ts` 读设置键 `config`（只能经 `/api/config` 改）与 `<Workspace>/.coko/settings.json`（每次 Run 开始与 GET 时按 mtime 读取），把有效配置交给各上下文贡献；项目 `permissions.deny` / `permissions.ask` 作为只读 `project` 作用域进入 PermissionService 的判定；`GET / PUT /api/config`。界面：General 分区"项目设置"行（路径、诊断数，展开看诊断），Permissions 分区显示 project 规则（只读、标来源）。

**User stories:** 26, 27

**Blocked by:** 01

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/config/`、`apps/server/src/application/config.ts`、`apps/server/src/application/permissions.ts`、`apps/server/src/http/routes/config.ts`、`packages/protocol/src/config.ts`、`packages/protocol/src/permissions.ts`（project 作用域）、`packages/i18n/src/dictionaries/domains/config.ts`、`apps/desktop/src/renderer/features/settings/general-section.tsx`、`apps/desktop/src/renderer/features/settings/permissions-section.tsx`、`apps/desktop/src/renderer/stores/config-store.ts`（新）、`tests/integration/sidecar-config.test.ts`（新）、`apps/desktop/e2e/config.e2e.test.ts`（新）、`docs/subsystems/configuration.md`（新）、`docs/subsystems/permissions.md`、`docs/adr/0008-project-files-only-tighten.md`

- [ ] agent 表驱动测试：默认 / 全局 / 项目合并；项目 true 不打开全局 false；`permissions.allow`、`defaultMode` 与 true 开关产生 `project-cannot-grant`；未知键 `unknown-key`；不合 schema 的值 `invalid-value` 且其余键照常生效；JSON 解析失败整文件忽略并诊断
- [ ] 集成测试：`GET /api/config` 返回 effective、global、revision 与项目诊断；`PUT` 带过期 revision 409 `revision-conflict`；通用设置接口改 `config` 键 400；修改 `.coko/settings.json` 后下一次 GET / Run 读到新值
- [ ] 集成测试：项目 deny 规则 `Bash(echo *)` 在 full-access 下拒绝调用；项目 allow 规则不放行（仍出现审批请求）；Session、全局、Workspace 规则行为不变
- [ ] E2E：General 分区显示项目设置路径与诊断；Permissions 分区列出 project 规则且没有删除入口
- [ ] `docs/subsystems/configuration.md` 建立并从 `docs/README.md` 可达（导航行写在 Comments 由 Lead 合并）；permissions.md 增加 project 作用域与权限类表；ADR 0008 记录本票证据；`pnpm run check:docs` 通过

## Comments
