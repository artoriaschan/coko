# 09: 设置菜单分组

**What to build:** 设置左侧菜单按个人（常规、外观、记忆）、环境（权限）、插件（插件、技能、MCP、Hook）、模型（模型服务）分组，“关于”在最底部且不属于任何分类。未交付的外观、插件、Hook 不显示；没有可显示菜单项的分类不显示标题。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉以 Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 为准（画面 01 的左侧菜单）。

- [x] MS-01 通过
- [x] 现有分区的打开、切换与 setSection 行为不变；未交付分区仍不能被打开
- [x] 分类标题与菜单项的 zh / en 文案齐全
- [x] 键盘导航与焦点可见，明暗主题正确

## Comments

### 实施记录（ms-09，2026-10-29）

**覆盖的验收**

- MS-01：`navigationGroups()` 按 个人（常规、记忆）/ 环境（权限）/ 插件（技能、MCP）/ 模型（模型服务）分组，关于不属于任何分类、排在最后并在竖排布局中贴底（`sm:mt-auto`）。外观、插件、Hook 登记为 `available: false`，不显示；分类内没有可显示项时不渲染该分类。
- 行为不变：`show` / `setSection` 打开已交付分区并标记唯一的 `aria-current="page"`；`appearance` / `plugins` / `hooks` 回到常规。`data-section` 选择器未变，e2e 定位不受影响。
- 文案：`settings.groups.*`（分类标题）与 `settings.nav.*`（菜单项）的 zh / en 齐全；zh 的 `settings.general`（常规分区标题）由“通用”改为“常规”，与菜单一致。
- 键盘与主题：Tab 按菜单顺序移动，每步 `:focus-visible` 时 outline 为 solid，Enter 打开分区；明暗主题下分类标题为弱化色、菜单项为前景色，且都不等于弹窗背景。另截图人工检查了浅色 zh、暗色 en、600px 窄窗口 zh（截图未提交）。

**测试接缝**（本票按须知自行确定，未单独征询）：`sections.ts` 的 `navigationGroups` / `resolveSection`（纯函数）；经 `<App>` 装配的设置弹窗（Browser Mode）。

**实际运行的命令与结果**

- `pnpm exec vitest run --project desktop-renderer`：7 个文件，52 个用例全部通过。
- `pnpm exec vitest run --project i18n`：2 个文件，13 个用例通过。
- `pnpm run typecheck`：通过。改动文件的 `oxlint`：0 个错误；`oxfmt --check`：通过。

**负向确认**

- 先红：分组测试在实现前因缺少 `navigationGroups` 导出而失败；弹窗结构测试（zh / en、主题）在弹窗分组渲染前失败（3 个失败）。
- 变异：去掉“空分类不显示”的过滤后，“分类内没有可显示的菜单项时不显示该分类”失败，恢复后通过。

**未验证项**：未运行桌面 e2e（需要 Electron 构建；选择器 `data-section` 未变）。窄窗口（< sm）下导航仍是原有的横向滚动，分类标题只作为 group 的无障碍名称，视觉上隐藏。

**文档影响**：无。正式文档未描述设置菜单结构。

**已有测试的改动**：`app.browser.test.tsx` 的菜单按钮名改为 `settings.nav.*`（“Models”/“模型”改为“Model services”/“模型服务”）；Provider 表单的 `getByLabelText('Models')` 改为 `getByRole('textbox', { name: 'Models' })`，因为新的“Models”分类 group 也会匹配这个标签。

**供后续票**

- `SettingsSectionId` 新增 `'appearance' | 'plugins' | 'hooks'`；`SettingsGroupId = 'personal' | 'environment' | 'plugins' | 'models'`；`SettingsSectionDefinition.group?`（省略表示无分类，排最底部）。
- 导出 `SETTINGS_GROUPS`、`navigationGroups(sections?)`；`visibleSections()` 现按菜单顺序返回。
- 菜单项文案用 `settings.nav.<id>`，与分区页标题（如 `settings.models`、`providers.title`）分开；交付外观、插件、Hook 时只需把 `available` 改为 true 并换上组件。
- DOM：分类为 `role="group"`，带 `data-settings-group` 和指向标题的 `aria-labelledby`；菜单项仍为 `[data-section=<id>]`。
- 测试注意：分类“Models”/“模型”是 group 的无障碍名称，在弹窗内用 `getByLabelText('Models')` 会多匹配，应改用带角色的查询。

