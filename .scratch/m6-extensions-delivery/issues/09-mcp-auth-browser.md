# 09: MCP 认证状态与浏览器预设：auth-required、Playwright MCP 预设、图像结果

**What to build:** 见 [规格](../spec.md)"MCP 认证与浏览器预设"：HTTP 传输的 `AuthProvider.onUnauthorized` 与 401 识别 → `auth-required`（不重连、诊断）；`MCP_PRESETS` 与 `GET /api/mcp/presets`；设置 → MCP 分区的"需要认证"徽标与"编辑请求头"、"添加浏览器"菜单；测试 MCP Server 的 image 结果与工具卡缩略图；layers.ts 的 mcp 块（如需）。

**User stories:** 11, 12

**Blocked by:** 03

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/extensions/mcp/`、`packages/protocol/src/mcp.ts`（只增加 preset DTO）、`apps/server/src/application/context/{mcp,mcp-admin}.ts`、`http/routes/mcp.ts`、`runtime/layers.ts` 的 mcp 块、`packages/i18n/src/dictionaries/domains/mcp.ts`、renderer `features/settings/mcp-section.tsx`、`features/conversation/tool-cards.tsx`（只为 image 缩略图追加，若已渲染则不改）、`tests/fixtures/mcp/`（401 HTTP Server 与 screenshot 工具）、就近测试、`tests/integration/{sidecar-mcp-auth,sidecar-mcp-presets}.test.ts`（新）、`apps/desktop/e2e/mcp-browser.e2e.test.ts`（新）、`docs/subsystems/mcp.md`、`docs/TECH_STACK.md`（Agent 表 @playwright/mcp 一行）

**跨票接口：** `McpServerStatus` 的 `auth-required` 由 03 声明；插件 MCP Server 经 03 已并入，本票不改并入逻辑。

- [ ] 集成 `sidecar-mcp-auth`：HTTP 测试 Server 对缺少或错误 Authorization 返回 401 → 状态 `auth-required`、诊断 `mcp-auth-required`、此后 10 秒内没有新的连接尝试（测试 Server 的请求计数）；改配置带上正确的请求头（引用登记的 Secret）后 connected；401 只发生在 tools/call 时同样进入 auth-required
- [ ] **对手用例**：401 响应体与 `WWW-Authenticate` 中的令牌不出现在诊断、日志、HTTP 与 WS 中
- [ ] 集成 `sidecar-mcp-presets`：`GET /api/mcp/presets` 返回 playwright 预设（args 含精确版本 0.0.83 与 `--isolated`）；不发起网络（测试中以夹具替换 command 断言保存后的配置形状）
- [ ] 图像：测试 Server 的 `screenshot` 结果在条目中为 image 块、faux requestLog 中原样传给模型
- [ ] E2E：MCP 分区"添加浏览器"→ 确认 → 列表出现 playwright（夹具 command）；401 Server 显示"需要认证"徽标，"编辑请求头"打开表单并聚焦 headers；工具卡显示截图缩略图（naturalWidth > 0）；明暗主题与键盘操作
- [ ] mcp.md 更新（auth-required、预设、"尚未实现"一节改写）；TECH_STACK 一行；`check:docs` 通过；真实 Playwright MCP 与真实 401 服务记为未验证（人工清单）

## Comments
