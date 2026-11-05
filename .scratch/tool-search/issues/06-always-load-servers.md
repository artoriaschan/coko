# 06: MCP Server「始终加载」

**What to build:** 用户可以把几乎每次都用的 MCP Server 设为「始终加载」：它的工具始终直接出现在请求中，不进入目录，也不需要先搜索。全局、项目与插件提供的 Server 都可以设置；为已批准的项目 Server 增加这个字段，不需要重新批准。MCP Server 编辑表单增加这个选项与中英文说明；它只在「按需加载 MCP 工具」打开时生效。

**规格场景:** [spec](../spec.md) 的 AC-14，以及 AC-23 中 MCP Server 编辑表单的部分；对应 TS-04、27。

**设计依据:** [design.md](../design.md) 第 2 节代码事实表中 MCP 配置的一行。

**文档影响:** [分层配置](../../../docs/subsystems/configuration.md) 与 [MCP](../../../docs/subsystems/mcp.md) 补充 `alwaysLoad` 字段，以及它不进入批准摘要的规则。

**Blocked by:** 03 按需加载最小闭环：目录、按确切名称加载与加载记录

**Status:** ready-for-agent

**Closed:** true

- [x] MCP Server 配置接受可选的 `alwaysLoad`；全局、项目与插件 Server 经同一校验；该字段不进入项目 Server 的批准摘要，已批准的 Server 增加它之后不需要重新批准。
- [x] AC-14：三个来源的 Server 都设为始终加载后开始 Run，它们的工具直接出现在请求中，不在目录里；`tool_search` 按确切名称选中它们时列为已可用。
- [x] 「按需加载 MCP 工具」关闭时，该字段没有效果。
- [x] MCP Server 编辑表单增加「始终加载」与说明，文案按 TS-27 经 zh/en 字典提供；Browser Mode 测试覆盖保存、回显与两种语言的文案。
- [x] 场景经真实 Sidecar（faux 脚本）验证。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05 实施：配置接受可选布尔值 `alwaysLoad`（缺省 false），全局、项目与插件沿用同一校验器；启动摘要仍只覆盖启动字段。Run 快照通过 `McpRunTools.alwaysLoad` / `ContributedTool.mcpAlwaysLoad` 保存该策略；目录排除这些工具，模型与用量共用的清单保留它们。MCP Server 表单使用已有 Checkbox 组件，按 TS-27 提供中英文标题、说明与保存回显。
- 红→绿：配置单测先因 unknown key "alwaysLoad" 失败，修复后 10/10；真实 Sidecar 的三来源用例先因首次请求缺少常驻 MCP 工具失败，接入快照元数据后通过；Browser Mode 新用例先找不到 Always load 控件，接入后通过。中文测试夹具语言值采用项目支持的 `zh`。
- 当前有效验证：`pnpm run test tests/integration/sidecar-mcp-always-load.test.ts tests/integration/sidecar-tool-search.test.ts apps/server/src/application/context/usage.test.ts`：3 文件 23/23 通过；新文件 4 例覆盖全局、已批准项目与插件同时始终加载、确切名称返回 alreadyAvailable、不写加载条目、真实 MCP 执行；项目增加字段后批准摘要相同；全局开关关闭时字段 true/false 都提供完整工具列表，以及所有 Server 均始终加载时没有目录或 tool_search。`pnpm run test packages/agent/src/extensions/mcp/config.test.ts apps/server/src/application/context/mcp.test.ts` 的两文件 11 例具备同版本通过证据（与新 Sidecar 用例合跑的最初组为 14/14）。
- `pnpm run test apps/desktop/src/renderer/features/settings/mcp-section.browser.test.tsx`：1 文件 8/8 通过（新增 zh/en 两例保存 true、回显并关闭；既有 6 例继续通过）。`pnpm run typecheck`、改动 TypeScript 的 oxfmt / oxlint、`git diff --check` 通过；`pnpm run check:docs`：396 文件、0 问题。全部命令均以 rtk 前缀执行。
- 文档同步：MCP 配置字段、摘要、按需提供规则与表单说明，以及分层配置中的策略边界已更新；从 AGENTS → docs/README → 两份正文读回，生命周期 active，既有导航与锚点保持有效，正式文档不依赖任务目录。
- 限制：验证使用真实 Sidecar 与本地 stdio MCP fixture、faux 模型及 Chromium Browser Mode；真实 Provider、真实 Electron 指针/原生层、产物与 CI 未验证。390px 与明暗联合视觉验收由 15 号票负责。本票提交到独立本地分支，未推送或发布。
