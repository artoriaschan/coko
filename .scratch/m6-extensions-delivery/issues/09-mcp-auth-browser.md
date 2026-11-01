# 09: MCP 认证状态与浏览器预设：auth-required、Playwright MCP 预设、图像结果

**What to build:** 见 [规格](../spec.md)"MCP 认证与浏览器预设"：HTTP 传输的 `AuthProvider.onUnauthorized` 与 401 识别 → `auth-required`（不重连、诊断）；`MCP_PRESETS` 与 `GET /api/mcp/presets`；设置 → MCP 分区的"需要认证"徽标与"编辑请求头"、"添加浏览器"菜单；测试 MCP Server 的 image 结果与工具卡缩略图；layers.ts 的 mcp 块（如需）。

**User stories:** 11, 12

**Blocked by:** 03

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/extensions/mcp/`、`packages/protocol/src/mcp.ts`（只增加 preset DTO）、`apps/server/src/application/context/{mcp,mcp-admin}.ts`、`http/routes/mcp.ts`、`runtime/layers.ts` 的 mcp 块、`packages/i18n/src/dictionaries/domains/mcp.ts`、renderer `features/settings/mcp-section.tsx`、`features/conversation/tool-cards.tsx`（只为 image 缩略图追加，若已渲染则不改）、`tests/fixtures/mcp/`（401 HTTP Server 与 screenshot 工具）、就近测试、`tests/integration/{sidecar-mcp-auth,sidecar-mcp-presets}.test.ts`（新）、`apps/desktop/e2e/mcp-browser.e2e.test.ts`（新）、`docs/subsystems/mcp.md`、`docs/TECH_STACK.md`（Agent 表 @playwright/mcp 一行）

**跨票接口：** `McpServerStatus` 的 `auth-required` 由 03 声明；插件 MCP Server 经 03 已并入，本票不改并入逻辑。

- [x] 集成 `sidecar-mcp-auth`：HTTP 测试 Server 对缺少或错误 Authorization 返回 401 → 状态 `auth-required`、诊断 `mcp-auth-required`、此后 10 秒内没有新的连接尝试（测试 Server 的请求计数）；改配置带上正确的请求头（引用登记的 Secret）后 connected；401 只发生在 tools/call 时同样进入 auth-required
- [x] **对手用例**：401 响应体与 `WWW-Authenticate` 中的令牌不出现在诊断、日志、HTTP 与 WS 中
- [x] 集成 `sidecar-mcp-presets`：`GET /api/mcp/presets` 返回 playwright 预设（args 含精确版本 0.0.83 与 `--isolated`）；不发起网络（测试中以夹具替换 command 断言保存后的配置形状）
- [x] 图像：测试 Server 的 `screenshot` 结果在条目中为 image 块、faux requestLog 中原样传给模型
- [x] E2E：MCP 分区"添加浏览器"→ 确认 → 列表出现 playwright（夹具 command）；401 Server 显示"需要认证"徽标，"编辑请求头"打开表单并聚焦 headers；工具卡显示截图缩略图（naturalWidth > 0）；明暗主题与键盘操作
- [x] mcp.md 更新（auth-required、预设、"尚未实现"一节改写）；TECH_STACK 一行；`check:docs` 通过；真实 Playwright MCP 与真实 401 服务记为未验证（人工清单）

## Comments

- 2026-11-01 lead（来自票 04）：票 04 已在 `apps/server/src/application/context/mcp.ts` 增加 `McpManager.reconcileAll()`，并订阅 `plugins.onChange`（插件变更后关闭不再提供的 Server），已在 main 上。`docs/subsystems/mcp.md:36` 中"插件未接入、只有 COKO_TEST_PLUGINS"的说法已过时，本票改 mcp.md 时一并修正。

- 2026-11-01 implementer（票 09 回执）：
  - **覆盖的验收**：全部 6 项。
    - auth：`McpConnection` 把 `authProvider` 交给宿主的 `createTransport({ authProvider })`。它的 `onUnauthorized` 立即抛出 `McpAuthRequiredError`，同样的请求头不再重试。401、403 `insufficient_scope` 和连接错误中的 HTTP 401 都使状态变为 `auth-required`，不进入退避。已连接时调用遇到 401：返回固定错误，连接关闭，工具清空。
    - 诊断：`mcp-auth-required` 与 `mcp-npx-missing` 随连接状态派生，放在 `McpManager.runtimeDiagnostics`。
    - 预设：`MCP_PRESETS` 在 `context/mcp-admin.ts`，接口为 `GET /api/mcp/presets`。
    - 界面：需要认证的说明与"编辑请求头"；"添加浏览器"菜单与确认对话框，名字冲突时提示改名；通用工具卡显示图片缩略图，可看大图。
  - **实际运行**（均从仓库根运行，未单独使用项目配置）：
    - `pnpm exec vitest run packages/agent/src/extensions/mcp/connection.test.ts`：10 passed，其中新增 4。
    - `tests/integration/sidecar-mcp-auth.test.ts`：1 passed，约 11.5 秒，含 10 秒的观察窗口。
    - `tests/integration/sidecar-mcp-presets.test.ts`：2 passed，1 skipped（真实 Playwright）。
    - `mcp-section.browser.test.tsx`：6 passed，其中新增 3。
    - `tool-card-images.browser.test.tsx`：1 passed。
    - `tool-cards.browser.test.tsx`：10 passed，合并 main 后共 17 passed。
    - E2E：`apps/desktop/e2e/mcp-browser.e2e.test.ts` 1 passed；`mcp.e2e.test.ts` 1 passed。
    - 回归：`sidecar-mcp`、`secrets-gate-mcp`、`sidecar-mcp-resources-prompts` 和 MCP 单元测试共 49 passed；guards（style、browser-deps、source-references、i18n）58 passed。
    - `pnpm run typecheck` 通过；`pnpm run check:docs` 检查 215 个文件，0 个问题。
    - 全量 `pnpm run test` 在锁内运行，结果见完成报告。
  - **负向确认**：
    - 新测试先红：connection 4 failed；sidecar-mcp-auth 先因缺少 error 与诊断失败；mcp-section 3 failed；tool-card-images 1 failed。
    - 变异一：auth 错误按 failed 处理。connection 3 个、sidecar-mcp-auth 1 个用例失败（状态变为 failed，并在 10 秒内重连）。
    - 变异二：预设去掉 `--isolated`，同时 npx 诊断的匹配写错。sidecar-mcp-presets 2 个用例都失败。
  - **对手用例**：401 响应体与 `WWW-Authenticate` 中带有令牌。扫描模型请求、WS 帧、HTTP 响应体、运行中与停止后的库和日志、Sidecar stderr，令牌和登记的 Secret 都不出现。
  - **新通道与注入点**：
    - 认证诊断与日志是新的输出通道。它们只含固定文本和 Server 名；上面的扫描就在 `sidecar-mcp-auth` 中，复用 secrets-gate harness，没有另建 `secrets-gate-*.test.ts`。
    - MCP 图像结果是注入点。图片以 base64 原样透传，按值替换 Secret 只作用于文本，图片字节中的明文不被替换（与已有的 `read_mcp_resource` 图片相同）；渲染时只显示 PNG、JPEG、GIF、WebP。
    - 本票没有新的读取根，因此没有符号链接越界用例：图片来自 MCP 工具结果，不读文件。
  - **未验证**（需外部条件，见人工验证清单）：
    - 真实 Playwright MCP 需要网络与 npx：`sidecar-mcp-presets` 的真实用例只在 `COKO_REAL_PLAYWRIGHT_MCP=1` 时运行。
    - 真实要求认证的 HTTP 服务未验证。
    - 401 发生在 GET 流上的情况未单独验证，因为测试 Server 对 GET 回 405。
  - **越出写范围**：`apps/server/src/adapters/mcp.ts`。`McpTransportOptions` 加了可选的 `authProvider`，并交给 `StreamableHttpTransport`。这是 HTTP 传输所在的唯一位置，新增参数为可选，原有调用不变。新文件 `apps/desktop/src/renderer/features/conversation/tool-card-images.browser.test.tsx` 属于就近测试。
  - **其他说明**：
    - 预设的读取写在 `mcp-section.tsx` 内（`usePresets`，响应按 `McpPresetsResponse` 校验），没有改 `stores/mcp-store.ts`。
    - `sections.browser.test.tsx` 未改：不给 `/api/mcp/presets` 打桩的测试走到"读取失败"分支，不影响原有断言。
    - E2E 中的假 npx 写在用例内：desktop 的 composite tsconfig 不包含 `tests/fixtures`。集成测试用 `tests/fixtures/mcp` 的 `fakeNpx`。
    - `tool-cards.tsx` 的唯一合并冲突是 lucide 导入列表（票 13 的 List* 图标），合并时两边都保留。
  - **文档影响**：
    - `docs/subsystems/mcp.md`：auth-required、浏览器预设一节、图像结果、协议、界面、"尚未实现"、验证；第 37 行插件一句按票 04 改为 `reconcileAll`。
    - `docs/TECH_STACK.md`：Agent 表增加 @playwright/mcp 0.0.83 一行。
    - `docs/README.md` 不需要新行：mcp.md 已在导航中。
  - **给 14 的 README 要点**：
    - agent 新导出 `isMcpAuthError` 与类型 `McpTransportContext`；`McpConnectionStatus` 增加 `auth-required`。
    - protocol 新增 `McpPreset` 与 `McpPresetsResponse`。
    - server 的路由增加 `GET /api/mcp/presets`。
