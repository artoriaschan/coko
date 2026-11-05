# 07: 全局开关的设置界面与项目收紧

**What to build:** 用户在设置 → MCP 顶部的「工具搜索」分组中开关「按需加载 MCP 工具」。关闭后所有 MCP 工具直接提供，不注册 `tool_search`，不发目录；关闭期间直接调用过的工具，重新打开后仍是按需工具，不算已加载。项目设置只能把它设为 false；设为 true 时被忽略，并给出诊断。开关从下一个 Run 生效，进行中的 Run 沿用开始时的设置。

**规格场景:** [spec](../spec.md) 的 AC-13，以及 AC-23 中 MCP 分区的部分；对应 TS-02、18、25 中全局开关的部分、27。

**设计依据:** [design.md](../design.md) 第 2 节“仍然适用的决定”；[ADR 0008](../../../docs/adr/0008-project-files-only-tighten.md)。

**文档影响:** [分层配置](../../../docs/subsystems/configuration.md) 补充该键与项目收紧规则；[MCP](../../../docs/subsystems/mcp.md) 说明开关关闭时的行为。

**Blocked by:** 03 按需加载最小闭环：目录、按确切名称加载与加载记录

**Status:** ready-for-agent

**Closed:** true

- [x] 设置的 MCP 分区顶部增加「工具搜索」分组与开关，标题、选项名与说明按 TS-27 经 zh/en 字典提供；Browser Mode 测试覆盖切换、保存与两种语言的文案。
- [x] AC-13：关闭期间所有 MCP 工具直接提供，没有 `tool_search` 与目录；关闭期间直接调用工具 D，重新打开后 D 仍是按需工具，不在已加载名单中。
- [x] 项目设置设为 false 时，该项目的会话不按需加载；设为 true 时被忽略，并给出诊断。
- [x] 切换开关从下一个 Run 生效，重试与继续也算新 Run；进行中的 Run（含等待审批的）沿用开始时的值；已加载的工具不丢。
- [x] 场景经真实 Sidecar（faux 脚本）验证。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05 实施：MCP 顶部新增工具搜索分组，复用 CapabilityToggle 与 config-store 的单键保存，默认值沿用 11 号票的 true；标题、选项与说明按 TS-27 的 zh/en 文案。项目收紧与 Run 配置快照沿用现有解析/装配实现，无新增服务器策略。
- TDD：先运行 Browser Mode 新的中英文场景，因缺少 Tool search/工具搜索标题与开关而失败；接入后通过。测试接缝沿用已确认规格：实际 Browser Mode UI 与真实 Sidecar/faux 请求、条目和 MCP stdio 调用，不 mock 搜索或持久化。
- Sidecar 新增 5 例：关闭时全部工具直接提供且调用不生成加载；重新开启后未搜索的工具仍按需；项目 false 生效、true 忽略且诊断（全局关闭也不可打开）；审批中切换后本 Run 的下一次请求沿用旧设置，retry 与 paused continue 使用新设置，重新打开后原加载工具保留。测试使用真实存在的未加载 env_sha 工具区分完整列表，避免以不存在名称断言缺席。
- 验证：rtk pnpm run test tests/integration/sidecar-tool-search-settings.test.ts tests/integration/sidecar-tool-search.test.ts tests/integration/sidecar-config.test.ts apps/desktop/src/renderer/features/settings/mcp-section.browser.test.tsx apps/desktop/src/renderer/stores/config-store.test.ts packages/agent/src/config/merge.test.ts packages/i18n/src/domains.test.ts：7 文件 56/56；其中 MCP Browser 文件 10/10、新 Sidecar 文件 5/5。rtk pnpm run typecheck、定向 oxfmt/oxlint、rtk git diff --check 均退出 0。
- 文档：原地更新 docs/subsystems/configuration.md 的键表和开关入口、docs/subsystems/mcp.md 的关闭/重新开启与 Run 边界；搜索当前无界面开关、mcp.toolSearch、MCP 分区顶部，修正两处失效入口并保留历史票依据。从 AGENTS → docs/README → 两正文读回，路径/语义/归属/引用方向/生命周期/当前入口/历史保留均通过；rtk pnpm run check:docs 检查 396 个 Markdown、0 问题。
- 限制：Browser Mode 为无头 Chromium；390px 与明暗联合视觉验收归 15 号票。未运行真实 Provider、真实 Electron 指针或原生层、打包产物或 CI；只提交本地分支，不推送。

- 合入 05/12 的集成 tip 6ab2944b：MCP 正文邻接段落有一处冲突，保留本票的全局开关说明、05 的目录增量/预算和 12 的 Provider 段落。合并态再验 rtk pnpm run test tests/integration/sidecar-tool-search-settings.test.ts tests/integration/sidecar-incremental-tools.test.ts tests/integration/sidecar-tool-search-catalog.test.ts apps/desktop/src/renderer/features/settings/mcp-section.browser.test.tsx apps/desktop/src/renderer/features/settings/models-section.browser.test.tsx：5 文件 47/47；typecheck、check:docs（396/0）通过。
