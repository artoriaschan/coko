# 01: `/` 菜单的插件分组

**What to build:** 用户在草稿开头输入 `/` 时，已启用插件贡献的命令与 Skill 出现在单独的“插件”组里，位于 Skill 组之后、MCP 组之前；其余各组只剩不来自插件的条目。条目的名字、参数提示、描述、调用方式与同名取舍都不变。

**User stories:** 1–8。

**规格：** [spec.md](../spec.md) 的“`/` 菜单的插件分组”。

**Blocked by:** None（可立即开始）

**Status:** ready-for-agent

Closed: true

- [x] 命令目录的每一项带可选的插件名：插件贡献的命令与 Skill 有，其余条目没有
- [x] 来源取值不变：插件命令仍为用户来源，插件 Skill 仍为 Skill 来源；`command` 条目的来源字段不变
- [x] 菜单把带插件名的条目归入“插件”组，位于 Skill 组之后、MCP 组之前；“用户”组与“Skill”组不再含插件条目
- [x] “插件”组内按名字排序；组内仍是前缀匹配在前、包含匹配在后
- [x] 没有带插件名的可用条目时不出现“插件”组；停用的插件命令照旧不出现
- [x] 同名优先级、遮蔽诊断、启停与提交时的展开不变；设置页“Skills & Commands”分区不变
- [x] “插件”组名中英文文案齐全
- [x] 集成测试（真实 Sidecar）：装有一个带命令与 Skill 的插件时，命令目录中这两项带插件名，其余不带；同名取舍与现状一致
- [x] renderer 的 Browser Mode 测试：分组的顺序与归属、没有插件条目时没有该组
- [x] 以五个来源分组为全集的现有菜单断言按新增分组更新，不删除其覆盖的场景
- [x] 当前行为文档同步：命令（命令目录字段、菜单分组）与插件（菜单中的分组）
- [x] 记录实际运行的检查与未验证项

## Comments

2026-11-21 实施代理（分支 `session-reference/01-plugin-group`）：

**做了什么。** 命令目录的 `CommandInfo` 增加可选的 `plugin`（插件名）：模板加载器在插件的命令上带出、Skill 来源把 Skill 已有的 `plugin` 带出，`source` 不变（插件命令 `user`、插件 Skill `skill`），`command` 条目、注册表（同名优先级、遮蔽诊断、启停）与展开都没有改。`/` 菜单把带 `plugin` 的条目归入“插件”组（Skill 之后、MCP 之前，组内按名字），其余各组只含不带 `plugin` 的条目；文案 `commands.pluginGroup`（中“插件”/ 英“Plugin”）。设置页“Skills & Commands”分区没有改。

**运行的检查。**

- `pnpm exec vitest run tests/integration/sidecar-plugins.test.ts -t "安装 201 待批准"`：实现前失败（`plugin` 为 undefined），实现后通过。
- `pnpm exec vitest run apps/desktop/src/renderer/features/conversation/command-menu.browser.test.tsx`：实现前 3 失败、1 通过（“没有插件条目时没有该组”在实现前即成立，作为回归保护），实现后 4 通过。
- `pnpm exec vitest run packages/agent/src/instructions/commands packages/agent/src/extensions/plugins packages/protocol packages/i18n apps/server/src/application/context/commands.test.ts apps/server/src/application/context/skills tests/integration/sidecar-plugins.test.ts tests/integration/sidecar-commands.test.ts tests/integration/sidecar-skills.test.ts apps/desktop/src/renderer/features/conversation/command-menu.browser.test.tsx apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx apps/desktop/src/renderer/features/settings/skills packages/ui/src/composer/composer-typeahead.browser.test.tsx`：21 个文件，203 通过、1 失败。失败的是 `packages/protocol/src/entries.test.ts`“预先声明规格表中全部 M2–M6 kind”（期望清单缺 `plan_phase`、`state_update`、`tool_load`）；暂存本票改动后在基线上同样失败，与本票无关，未处理。
- 格式化后重跑 `pnpm exec vitest run tests/integration/sidecar-plugins.test.ts apps/desktop/src/renderer/features/conversation/command-menu.browser.test.tsx`：2 个文件 9 个用例通过。
- `pnpm run typecheck`：通过。`pnpm run lint`：退出码 0。`pnpm run check:docs`：460 个文件 0 个问题。
- `pnpm exec oxfmt --check apps packages tests`：本票改动的文件无问题；报出的 `apps/desktop/src/renderer/features/conversation/process-timeline.css` 是基线已有的，未改。

**未验证。**

- 没有运行 Electron E2E（协议规定除非票要求不跑）。`apps/desktop/e2e/commands.e2e.test.ts` 断言的三个分组（内置、项目、用户）不含插件条目，`apps/desktop/e2e/plugins.e2e.test.ts` 只断言菜单中有 `/sample:hello`、不看分组；按阅读判断两者不受影响，未执行。
- 没有在真实窗口中看过“插件”组的视觉效果；组标题沿用 typeahead 已有的分组样式，没有新增样式。

**文档影响。** `docs/subsystems/commands.md`（协议的 `plugin` 字段、菜单分组、验证清单）与 `docs/subsystems/plugins.md`（命令目录中的插件名与菜单分组）已同批更新。导航摘要、术语表与 ADR 不需要改。

**规格没写明、由实现补上的决定。**

1. 字段名取 `plugin`（与 Skill 定义上已有的 `plugin` 一致）。
2. 菜单的条目顺序（↑↓ 的顺序）改为与显示的分组顺序一致：菜单在匹配前把目录重排为“内置、项目、用户、Skill、插件、MCP”，“插件”组内按名字，其余各组保持目录顺序。不这样做的话，插件的命令在目录里排在 Skill 之前，↓ 会从用户组跳到“插件”组再回到 Skill 组。有查询时“先全部前缀匹配、后全部包含匹配”的既有规则没有改。
3. 英文组名用单数 “Plugin”，与同一行的 Project / User / Skill 一致。
4. “以五个来源分组为全集的现有菜单断言”在仓库中没有找到（只有菜单自己的分组常量），因此没有需要更新的断言；E2E 的分组断言见“未验证”。
5. 规格 Testing Decisions 列了“Sidecar 上下文贡献的单元测试：命令目录的内容”，票只要求真实 Sidecar 集成测试；同一事实已由集成测试断言，没有再加单元测试。
