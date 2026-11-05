# 11: 默认打开按需加载并迁移现有 MCP 测试

**What to build:** 「按需加载 MCP 工具」改为默认打开，达到 TS-02 的最终状态。经 Run 装配直接调用 MCP 工具的现有 integration 与 E2E 测试逐个检查，按测试目的改为先搜索、把 fixture Server 设为始终加载，或关闭全局开关，并记录理由。没有配置 MCP 的会话行为不变。

**规格场景:** [spec](../spec.md) 的 TS-02 中的默认值与用户故事 34；Testing Decisions 的“旧测试与执行范围”。

**设计依据:** [design.md](../design.md) 第 8 节。

**文档影响:** [MCP](../../../docs/subsystems/mcp.md)、[分层配置](../../../docs/subsystems/configuration.md) 与 [上下文管理](../../../docs/subsystems/context.md) 中的默认值与工具提供方式按默认打开更新。

**Blocked by:** 03 按需加载最小闭环：目录、按确切名称加载与加载记录；06 MCP Server「始终加载」

**Status:** ready-for-agent

**Closed:** true

- [x] 全局配置的默认值改为 true；未设置该键的用户与 Headless Run 都得到打开的行为。07 号票已完成时，设置界面的默认显示与相关测试同步更新；未完成时，由 07 号票按新的默认值实现。
- [x] 含 `mcp__` 工具名的测试逐个检查：验证 MCP 执行链本身的，改为先搜索或把 fixture Server 设为始终加载；与按需加载无关的，可以关闭全局开关。每个文件的处理方式与理由记入 Comments；不放宽断言，不跳过或删除测试。
- [x] 断言“用量计入全部 MCP 工具”的测试随行为修改，并说明理由。
- [x] 没有配置 MCP 的会话，请求与改动前相同，没有 `tool_search` 与目录。
- [x] 前面各票中显式打开开关的测试继续通过。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行受影响的 MCP 相关 unit、integration 与 E2E 测试及类型检查；改动波及共享装配，范围按实际受影响的模块确定。实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05 实施：`mcp.toolSearch` 默认true；新用户与旧版仅保存 `mcp.enabled` 的用户经真实HTTP模型请求验证，首次请求有tool_search、没有MCP schema。未保存该键的Headless完成搜索、耐久加载与真实stdio调用；无MCP的默认会话没有搜索工具或目录。07尚未合入，本票同步config-store有效值fixture，07按新默认值实现界面。
- TDD：HTTP用例先移除显式开启。第一次误用响应values字段，纠正为effective后观察到预期红灯（false对true）；修改默认值后绿灯。随后补旧部分配置，保留03显式开启的场景。

### mcp__ 测试文件清单

检索：`rg -l --hidden "mcp__" --glob "*.test.ts" --glob "*.test.tsx" --glob "!node_modules/**" --glob "!.git/**" .`。合并04后共32文件，逐个处理如下。未修改共享fixture默认值，未跳过、删除测试或放宽业务断言。

| 文件（仓库根相对路径） | 处理与理由 |
| --- | --- |
| `apps/desktop/e2e/mcp-browser.e2e.test.ts` | 先经tool_search加载截图工具，再执行；保留预设原样保存、审批与图像解码。 |
| `apps/desktop/e2e/mcp.e2e.test.ts` | 管理/批准接口不经Run，无需迁移；修正已复现的旧数据路径断言，扫描主数据根与Chromium两者。 |
| `apps/desktop/e2e/package-smoke.e2e.test.ts` | 执行fixture显式alwaysLoad；保留随包MCP执行与审批。另修正已复现的LSP真实路径URI断言。 |
| `apps/desktop/src/renderer/features/conversation/integrated-detail.browser.test.tsx` | 不改：固定TimelineItem/SessionEntry的浏览器渲染fixture，不启动Sidecar或执行工具。 |
| `apps/desktop/src/renderer/features/conversation/process-groups.browser.test.tsx` | 不改：固定TimelineItem/SessionEntry的浏览器渲染fixture，不启动Sidecar或执行工具。 |
| `apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx` | 不改：固定TimelineItem/SessionEntry的浏览器渲染fixture，不启动Sidecar或执行工具。 |
| `apps/desktop/src/renderer/features/conversation/structured-tool-details.browser.test.tsx` | 不改：固定TimelineItem/SessionEntry的浏览器渲染fixture，不启动Sidecar或执行工具。 |
| `apps/desktop/src/renderer/features/conversation/tool-card-images.browser.test.tsx` | 不改：固定TimelineItem/SessionEntry的浏览器渲染fixture，不启动Sidecar或执行工具。 |
| `apps/desktop/src/renderer/features/conversation/tool-cards.browser.test.tsx` | 不改：固定TimelineItem/SessionEntry的浏览器渲染fixture，不启动Sidecar或执行工具。 |
| `apps/desktop/src/renderer/features/conversation/tool-rows.browser.test.tsx` | 不改：固定TimelineItem/SessionEntry的浏览器渲染fixture，不启动Sidecar或执行工具。 |
| `apps/server/src/application/entry-payloads.test.ts` | 不改：持久化payload schema对照，不经Run装配。 |
| `packages/agent/src/agents/definitions.test.ts` | 不改：纯工具名集合交集，不读取全局默认值。 |
| `packages/agent/src/engine/tool-loading.test.ts` | 不改：公开Runtime接缝显式注入registry及加载通道，不读取宿主默认配置。 |
| `packages/agent/src/extensions/hooks/hooks.test.ts` | 不改：matcher纯函数输入。 |
| `packages/agent/src/extensions/mcp/config.test.ts` | 不改：MCP配置校验与摘要，不读取toolSearch默认值。 |
| `packages/agent/src/extensions/mcp/connection.test.ts` | 不改：显式连接与工具包装，不经Run工具选择。 |
| `packages/agent/src/extensions/mcp/naming.test.ts` | 不改：纯名称编码与冲突处理。 |
| `packages/agent/src/policy/decide.test.ts` | 不改：显式调用权限策略，加载不改变external判定。 |
| `packages/agent/src/tools/registry.test.ts` | 不改：独立registry注册及权限类。 |
| `packages/agent/src/tools/tool-search/tool-search.test.ts` | 不改：显式目录快照的纯检索/结果测试，合并04后通过。 |
| `tests/integration/secrets-gate-mcp-prompts.test.ts` | 不改：mcp__名字是prompts/get提示模板命令，不是按需业务工具调用。 |
| `tests/integration/secrets-gate-mcp.test.ts` | 实际执行的dsn Server显式alwaysLoad；保留请求数、登记Secret与全部泄漏断言。 |
| `tests/integration/sidecar-context.test.ts` | 不改：只调用常驻资源工具，未注册mcp__名字只用于权限规则输入。 |
| `tests/integration/sidecar-m6-seams.test.ts` | 仅插件消费接线一例显式关闭toolSearch，以保持无关的命令/Hook序列；其余用例保留默认。 |
| `tests/integration/sidecar-mcp-always-load.test.ts` | 不改：显式列举开关/alwaysLoad组合及三种来源。 |
| `tests/integration/sidecar-mcp-auth.test.ts` | tools/call返回401的callonly Server显式alwaysLoad，保留认证、退避及脱敏断言。 |
| `tests/integration/sidecar-mcp-presets.test.ts` | 先搜索截图工具，预设仍原样保存；新增搜索请求后在第三次请求核对图像结果。 |
| `tests/integration/sidecar-mcp-resources-prompts.test.ts` | fixture Server显式alwaysLoad，保留资源/提示模板的条目顺序、权限和list_changed。 |
| `tests/integration/sidecar-mcp.test.ts` | 执行/审批/超时/截断场景的local、remote显式alwaysLoad；连接/批准场景无须迁移。 |
| `tests/integration/sidecar-plugins.test.ts` | 仅安装消费与整根迁移两例显式关闭toolSearch，保持插件批准、文本与Hook序列；其余保留默认。 |
| `tests/integration/sidecar-tool-search-keywords.test.ts` | 不改：显式开启，继续验证BM25、权限、Hook、Plan及可见范围。 |
| `tests/integration/sidecar-tool-search.test.ts` | 保留03显式开启场景；实际HTTP新增未保存键的新用户/旧部分配置，Headless与空目录用默认值。 |

补充检查：`sidecar-mcp-data-directory.test.ts`、`secrets-gate-context.test.ts`、`sidecar-plugins-trust.test.ts`不含该工具名前缀但会装配MCP，已运行，语义无须迁移。`sidecar-project-permissions.test.ts`的配置只验证附加文件夹未加载，`sidecar-orphans.test.ts`只验证进程生命周期，无须修改。`context/usage.test.ts`的工具贡献与历史声明用例在02已改为实际提供清单，本票保持并复验；不存在仍应计全部MCP的断言。

### 验证与边界

- `rtk pnpm run test tests/integration/sidecar-tool-search.test.ts tests/integration/sidecar-mcp.test.ts tests/integration/sidecar-mcp-auth.test.ts tests/integration/sidecar-mcp-presets.test.ts tests/integration/sidecar-mcp-resources-prompts.test.ts tests/integration/secrets-gate-mcp.test.ts tests/integration/sidecar-plugins.test.ts tests/integration/sidecar-m6-seams.test.ts`：8文件30通过、1既有可选真实Playwright MCP用例跳过；默认/旧配置/Headless随后新增一例，单文件7/7。
- `rtk pnpm run test tests/integration/sidecar-config.test.ts tests/integration/sidecar-mcp-always-load.test.ts tests/integration/sidecar-context.test.ts tests/integration/secrets-gate-context.test.ts tests/integration/secrets-gate-mcp-prompts.test.ts tests/integration/sidecar-mcp-data-directory.test.ts tests/integration/sidecar-plugins-trust.test.ts apps/server/src/application/context/usage.test.ts packages/agent/src/config/merge.test.ts apps/desktop/src/renderer/stores/config-store.test.ts packages/agent/src/extensions/mcp/config.test.ts packages/agent/src/extensions/mcp/connection.test.ts packages/agent/src/extensions/mcp/naming.test.ts packages/agent/src/tools/tool-search/tool-search.test.ts`：14文件84/84。
- `rtk pnpm run test apps/desktop/e2e/mcp.e2e.test.ts apps/desktop/e2e/mcp-browser.e2e.test.ts apps/desktop/e2e/package-smoke.e2e.test.ts`首次6通过/2失败。临时恢复产品默认false后，`rtk pnpm run test apps/desktop/e2e/mcp.e2e.test.ts apps/desktop/e2e/package-smoke.e2e.test.ts -t '添加 stdio|插件的语言服务器'`两例仍在相同位置失败：数据库已迁至COKO_HOME/data；macOS注册Workspace已规范化为/private/var，旧断言仍用/var。恢复true后，前者同时扫描主数据根与原Chromium profile，后者用realpath/pathToFileURL核对URI；完整3文件8/8通过，globalSetup构建了本次应用和测试包。首次失败清理另出现一次ENOTEMPTY，旧默认复现及修正后完整通过未再出现。
- 合并04后，`rtk pnpm run test tests/integration/sidecar-tool-search.test.ts tests/integration/sidecar-tool-search-keywords.test.ts tests/integration/sidecar-mcp-always-load.test.ts tests/integration/sidecar-tool-accounting.test.ts packages/agent/src/tools/tool-search/tool-search.test.ts apps/server/src/application/context/usage.test.ts`：6文件39/39。`rtk pnpm run typecheck`及定向oxfmt/oxlint、`rtk git diff --check`通过。
- 文档：更新MCP、分层配置、上下文的最终默认值，未改变导航或锚点；`rtk pnpm run check:docs`检查396个Markdown、0问题。从AGENTS→docs/README→三份正文读回，链接、适用范围、实际行为与引用方向通过。03任务保留当时临时false的历史原意。
- Electron由现有后台harness运行，不激活窗口；覆盖CDP驱动的管理、审批、截图和产物执行，未验证真实指针/原生层。真实Provider、真实Playwright MCP和CI未验证。实现提交aaa2782b，已把最新集成分支合入本分支；未反向合入、未推送。
