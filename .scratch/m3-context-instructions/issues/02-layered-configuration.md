# 02: 分层配置、能力开关与项目设置

**What to build:** agent `config/` 的合并与诊断（默认 ← 全局 ← 项目，项目只收紧，见 [ADR 0008](../../../docs/adr/0008-project-files-only-tighten.md) 与 [规格](../spec.md#配置-schemaagent-config票-01-预先定义类型与默认值票-02-实现加载合并与接口)）；server `application/config.ts` 读设置键 `config`（只能经 `/api/config` 改）与 `<Workspace>/.coko/settings.json`（每次 Run 开始与 GET 时按 mtime 读取），把有效配置交给各上下文贡献；项目 `permissions.deny` / `permissions.ask` 作为只读 `project` 作用域进入 PermissionService 的判定；`GET / PUT /api/config`。界面：General 分区"项目设置"行（路径、诊断数，展开看诊断），Permissions 分区显示 project 规则（只读、标来源）。

**User stories:** 26, 27

**Blocked by:** 01

**Status:** ready-for-agent（实施完成，待 Lead 合入）

**Write scope:** `packages/agent/src/config/`、`apps/server/src/application/config.ts`、`apps/server/src/application/permissions.ts`、`apps/server/src/http/routes/config.ts`、`packages/protocol/src/config.ts`、`packages/protocol/src/permissions.ts`（project 作用域）、`packages/i18n/src/dictionaries/domains/config.ts`、`apps/desktop/src/renderer/features/settings/general-section.tsx`、`apps/desktop/src/renderer/features/settings/permissions-section.tsx`、`apps/desktop/src/renderer/stores/config-store.ts`（新）、`tests/integration/sidecar-config.test.ts`（新）、`apps/desktop/e2e/config.e2e.test.ts`（新）、`docs/subsystems/configuration.md`（新）、`docs/subsystems/permissions.md`、`docs/adr/0008-project-files-only-tighten.md`

- [x] agent 表驱动测试：默认 / 全局 / 项目合并；项目 true 不打开全局 false；`permissions.allow`、`defaultMode` 与 true 开关产生 `project-cannot-grant`；未知键 `unknown-key`；不合 schema 的值 `invalid-value` 且其余键照常生效；JSON 解析失败整文件忽略并诊断
- [x] 集成测试：`GET /api/config` 返回 effective、global、revision 与项目诊断；`PUT` 带过期 revision 409 `revision-conflict`；通用设置接口改 `config` 键 400；修改 `.coko/settings.json` 后下一次 GET / Run 读到新值
- [x] 集成测试：项目 deny 规则 `Bash(echo *)` 在 full-access 下拒绝调用；项目 allow 规则不放行（仍出现审批请求）；Session、全局、Workspace 规则行为不变
- [x] E2E：General 分区显示项目设置路径与诊断；Permissions 分区列出 project 规则且没有删除入口
- [x] `docs/subsystems/configuration.md` 建立并从 `docs/README.md` 可达（导航行写在 Comments 由 Lead 合并）；permissions.md 增加 project 作用域与权限类表；ADR 0008 记录本票证据；`pnpm run check:docs` 通过

## Comments

### 实施者报告（m3/02-layered-configuration，2026-10-29）

**覆盖的验收**

1. agent `packages/agent/src/config/merge.test.ts`（24 个用例）：默认 / 全局 / 项目合并、项目 true 不打开全局 false、`skills.disabled` 并集；`permissions.allow`、`defaultMode` 与 true 开关为 `project-cannot-grant`；顶层与下层未知键 `unknown-key`；不合 schema 的值 `invalid-value` 且其余键照常生效（单条非法规则只剔除该条）；JSON 解析失败 `invalid-json` 整文件忽略；顶层非对象整文件忽略。
2. 集成 `tests/integration/sidecar-config.test.ts` 用例 1：`GET /api/config` 返回 effective、global、globalRevision 与 project（path、exists、values、diagnostics）；`PUT` 过期 revision 409 `revision-conflict`、非法值 400；`PUT /api/settings/config` 与 `config.extra` 400；未知 Workspace 404；改写 `.coko/settings.json` 后下一次 GET 读到新值（含改成非法 JSON）。
3. 同文件用例 2：项目 deny `bash(echo *)` 在 full-access 下拒绝（优先于全局 allow `Bash(echo *)`），文件在两个 Run 之间写入，下一个 Run 生效；项目 allow `Bash(printf *)` 不放行（default 下仍出现审批请求）；"本 Workspace 总是允许"照常保存并生效；`GET /api/permissions` 的 `project` 为规范名、带来源路径、不含 allow。M2 的 sidecar-permissions / approvals 等在全量中照常通过。
4. E2E `apps/desktop/e2e/config.e2e.test.ts`：General 分区显示项目设置路径与诊断数（2），展开后列出 unknown-key、project-cannot-grant；Permissions 分区的 `[data-rule-list="project"]` 列出 deny 与 ask 规则、标出来源文件，没有按钮与输入框，项目 allow 不出现。
5. 文档：新建 `docs/subsystems/configuration.md`；`permissions.md` 增加 project 作用域行、作用域 × 规则类型表、协议的 `project` 字段、界面与验证；ADR 0008 `implementation: partial` 并记录本票证据；`pnpm run check:docs` 106 个文件 0 问题。

**实际运行的命令与结果**（worktree，已 `git merge main`，main 为 5aef15d，Already up to date）

- `pnpm install --frozen-lockfile` 0；`pnpm run typecheck` 0；`pnpm run lint` 0（0 warnings）；`pnpm run format:check` 0；`pnpm run check:docs` 0。
- `pnpm run test`（含 desktop E2E 与 `package-smoke.e2e.test.ts` 2 个）：119 个文件通过，911 通过、1 跳过（settings E2E 中 M2 已有的跳过）。票 01 合入后的基线为 116 文件、884 通过；新增 3 个文件、27 个用例。无未处理错误。

**负向确认**

- 去掉 `PermissionService.rulesFor` 中的 project 规则 → 集成用例 2 失败；撤销后通过。
- 去掉通用设置接口对 `config` 键的拒绝 → 集成用例 1 失败；撤销后通过。
- 给项目规则列表传入 `onRemove`（出现删除按钮）→ E2E 失败（`expected 2 to be +0`）；撤销后通过。
- agent 测试在实现之前全部失败（24 个）。

**未验证项**

- 真实模型：无凭据，未运行（本票不涉及模型行为）。
- 视觉：E2E 只断言结构与交互，没有逐项检查明暗主题与窄窗口下的项目设置行。
- `config-store.ts` 没有单独的单元测试，由 E2E 覆盖读取路径。
- 项目文件变化不触发待审批请求的重新判定（文档已写明）；项目规则的工具名不检查是否为已注册工具。

**越出 Write scope 的改动**（请 Lead 裁决）

- `apps/server/src/runtime/layers.ts`（票 01 所有）：`new ConfigService({ store })`，并在 SessionService 创建后 `sessions.permissions.useProjectRules(capabilities)` 接入 project 作用域。ConfigService 读取全局值必须有 store，没有其他装配位置。
- `apps/server/src/application/settings.ts`：通用设置接口拒绝 `config` / `config.*`（验收要求 400）。
- `packages/i18n/src/dictionaries/domains/index.ts`（票 01 所有）：登记 `config` 领域（一行导入、一处对象键）。
- `apps/desktop/src/renderer/stores/settings-store.ts`：保存全局规则或默认模式后保留已知的 `project`（与已有的 `workspace` 保留相同），否则项目规则在一次无关保存后从界面消失。
- `docs/README.md`："当前行为"增加一行 `[分层配置](subsystems/configuration.md)`（验收要求可达；与其他票的一行冲突由 Lead 处理）。

**文档影响**：新子系统页 configuration.md；permissions.md、ADR 0008 已同步；`apps/server/README.md` 的协议总览未加 `/api/config`（该文件不在本票写范围，顺序为 01 → 07 → 10 → 11），建议 Lead 合入时或由票 07 补一句并链接 configuration.md。

### 供后续票

- **有效配置**：`ContextScope.config` 已是合并后的有效值（每个 Run 开始时读项目文件）。各贡献直接读 `scope.config.skills.enabled`、`scope.config.skills.disabled` 等。
- **诊断 DTO**：协议的 `ResourceDiagnostic`（`packages/protocol/src/config.ts`，source 含 instructions / skills / commands / mcp / config / memory）。后续票的接口请复用它，不要在领域文件中再定义同名导出（`index.ts` 的 `export *` 会冲突）。agent 侧仍用 `instructions/shared` 的同名类型。
- **修改全局值**：`PUT /api/config { values, expectedRevision, workspaceId? }` 整体替换全局值。票 05 改 `skills.disabled` 时须带上当前 `global` 的其他键（从 `GET` 的 `global` 读出再改）。renderer 的 `stores/config-store.ts`（`configStore`、`createConfigStore(fetchConfig)`）目前只有 `load(workspaceId?)`；需要保存时在该文件加 `save`（409 时读回）。
- **键名**：协议 `CONFIG_SETTING` / `isConfigSettingKey`，agent `CONFIG_SETTING_KEY`（server 编译期比对两者与两份 schema）；项目文件位置 `PROJECT_SETTINGS_PATH = '.coko/settings.json'`。
- **项目规则**：`PermissionsResponse.project { workspaceId, path, rules }`；`PermissionService.useProjectRules(source)`，`ProjectRuleSource` 由 `ConfigService` 实现。票 07 若要让项目 `.mcp.json` 的诊断走同一形状，用 `diagnostic('mcp', …)`。
