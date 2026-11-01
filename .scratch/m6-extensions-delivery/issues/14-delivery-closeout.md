# 14: 交付收尾：README 汇总、能力覆盖证据、发布构建 E2E 复跑、人工验证清单

**What to build:** M6 的收尾，不新增功能：(1) `packages/agent/README.md` 与 `apps/server/README.md` 汇总 04–13 写在 Comments 中的要点；(2) [capability-coverage.md](../capability-coverage.md) 每一行的"证据"列填入实际测试文件与 subsystem 页，确认没有"未开始"或"部分"行；(3) 在 main 上运行 `COKO_RELEASE_E2E=1` 的 `desktop-release` 与全量测试（锁内）；(4) 把规格的"人工验证清单"复制为 `.scratch/m6-extensions-delivery/manual-verification.md`，每项留"结果 / 日期 / 执行者"空栏；(5) ADR 索引与 docs/README 导航的最终核对。

**User stories:** 19, 20

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13

**Status:** ready-for-agent

**Write scope:** `packages/agent/README.md`、`apps/server/README.md`、`packages/session/README.md`（如需）、`docs/README.md`（只修正导航）、`docs/adr/README.md`（只核对）、`docs/TECH_STACK.md` 的接入状态表（只核对 M6 行）、`.scratch/m6-extensions-delivery/{capability-coverage.md,manual-verification.md（新）}`（在 worktree 中修改，随分支合入）

- [x] 两个 README 的 M6 内容齐全（每个新服务、路由、工具、条目、启动参数与 headless 入口），与代码一致（逐条核对，Comments 列出来源票）
- [x] capability-coverage.md 每行都有"已交付"与证据；agent-runtime.md 能力表 35 行与桌面交付三项全部覆盖
- [x] main 上 `COKO_RELEASE_E2E=1 pnpm vitest run --project desktop-release` 通过（结果与 codesign 输出写进 Comments）；全量 `pnpm run test`（全量测试锁内）退出 0，报告文件数、用例数与重叠数（在基于 main 7f1438f 的本分支上运行，见回执；main 上的锁内全量由 Lead 在 m6/fix-team-goal-flakes 合入后复跑）
- [x] manual-verification.md 建立；ADR 0017、0018、0019 为 implemented，0003 为 implemented；`check:docs` 通过

## Comments
- 2026-10-31 lead：发布构建 E2E 复跑时确认插件声明的 LSP 服务器被启动（票 04 移给票 05 的验收）。

- 2026-11-01 lead（来自票 04）：以下几处仍写着插件"未接入"或"只有 COKO_TEST_PLUGINS"，合入时已过时：`docs/subsystems/hooks.md:45`、`docs/subsystems/mcp.md:36`（票 09 先改，未改则由本票修正）、`apps/server/README.md:62`（PluginService 与 routes/plugins.ts 已实现，不再是空存根或 501）。
- 2026-11-01 lead（来自票 05、10）：共用的 `text-destructive` 在卡片背景上的对比度为 4.50（浅色）与 4.24（深色），不高于 4.5。票 10 的关于页已经改为中性色文字加 destructive 图标。本票复核时确认各处错误文字的对比度，不达标的由 lead 另开修复票（改 `packages/ui` 的 token，按 ui-design-system.md 处理）。
- 2026-11-01 lead（来自票 07）：`apps/server/README.md` 中"TraceService 为空 / 501"的说法已过时；`tests/integration/sidecar-m6-seams.test.ts` 文件头注释的"501 占位"同样过时（合并 05 与 07 后已不剩 501 断言）；agent README 的 observability 导出要点见票 07 的实施者回执。
- 2026-11-01 lead（来自票 12）：`docs/README.md` 当前行为导航中插件一行（票 04 加入）补"设置中的插件分区与批准对话框"。
- 2026-11-01 lead（来自票 06、09）：两处间歇失败另由 m6/fix-team-goal-flakes 修复，本票的锁内全量在它合入之后运行：`secrets-gate-teams.test.ts` 第 80 行（teammate 的 `<team>` section 只在 Run 开始时读一次，任务可能在 mate 的 Run 开始之后才创建）；`apps/desktop/e2e/goal.e2e.test.ts`（期望预算 exhausted，实际 normal，只读一次状态）。

### 实施回执（票 14，2026-11-01）

分支 `m6/14-delivery-closeout`，worktree `/Users/chenzheng/Desktop/Work/person/coko-worktrees/14-delivery-closeout`，基于 main 7f1438f（01–13、fix-git-ai-leak、fix-memory-search-flake 已合入；完成前 main 没有新提交）。

**(1) README 汇总（逐条与代码核对，来源票）**
- `packages/agent/README.md`：frontmatter 描述加 M6 领域；`@coko/agent/testing` 加 `loadExport`（07）；"M6 接缝"去掉"`tools/lsp/`、`agents/teams/`、`observability/` 目前只有类型"，补 run_start v4 `subagent.triggerRunId`（06）与 `RunErrorCode` `approval_denied`（08）；新增"M6 领域"一节：插件 `loadPlugin` / `listPluginContributions` / `copyPluginTree` / `PLUGIN_LIMITS`（04）、lsp `createLspTool` / `formatLspResult` / `toLspPosition` / `fromLspPosition` / `encodeFrame` / `decodeFrames`（05）、团队任务板 / 名册 / 四个工具与 `goalChildRuns`（06）、`deriveTrace` / `traceTotals` / `deriveAudit` / `formatExport` / `sessionExportHeader` / `loadExport` / `SESSION_EXPORT_*`（07）、`RuntimePermissions.unattended` 与 `ApprovalBroker.recordUnattendedDenied`（08）、`isMcpAuthError` / `McpTransportContext` / `auth-required`（09）、`MemoryPort.search` 与 `MEMORY_SEARCH_LIMIT`（11）；验证一节加 M6 单元测试文件。每个导出名经 barrel（`extensions/plugins`、`tools/lsp`、`agents/teams`、`observability`、`context/memory`、`extensions/mcp`、`testing`）与 grep 核对。
- `apps/server/README.md`：frontmatter；入口加 headless 一行（`dist/sidecar/headless.mjs`，链接 headless.md）；环境变量表加 `COKO_TEST_PLUGINS`、`COKO_TEST_NO_FTS`、`COKO_TEST_LSP_IDLE_MS`（`config.ts`、`layers.ts` 核对，均只在未 --packaged 时读）；fatal 码加 `config-invalid`（`StartupError` → `main.ts`）；MCP 段加 `GET /api/mcp/presets`、auth-required 与诊断、`reconcileAll`（04、09）；"M6 接缝"删去 `PluginService` / `LspService` / `TeamService` / `TraceService` 与四个路由"为空结果或 501"、`lsp-client` "只有端口形状"、headless "打印说明并以 4 退出"三处过时说法，补 Skill / 命令正文展开前脱敏（04）；新增"M6 服务"：PluginService 与六个路由（04）、LspService / lsp-client / 三个路由与常量（05）、TeamService、teammate 的 `deliverMessage` 与 `agent-not-reachable`、`GET …/team`（06）、TraceService 与 trace / audit / export（07）、MemoryService.search 与 `/api/memories` 的 query / scope（11）、headless 模块、`headlessLayer` / `silentControl`、`ProviderService.upsertFromConfig`（08）、M6 秘密总闸清单；关闭顺序加"关闭语言服务器进程"（`layers.ts` finalizer 顺序核对：contributions → lsp → processes）；产物覆盖加 package-smoke 的插件 MCP / LSP、headless 与 release E2E；M6 集成测试列表替换"新路由的空结果与 501"。路由逐条对 `http/routes/{plugins,lsp,teams,trace,mcp,memories}.ts` 核对。
- `packages/session/README.md`：限制一节"目前只做探测，还没有建立索引"改为 v9 建立 `memories_fts`（11 的写范围之后遗留）。

**(2) capability-coverage.md**：重写为"M6 前 / 交付后 / 当前行为 / 证据（测试文件）"，35 行与桌面交付三项全部"已交付"，签名与公证"不在范围"。证据列的 117 个测试文件写法（展开花括号后 129 个）经 `git ls-files` 逐一确认存在；行名与 agent-runtime.md 能力表 35 行一致。

**(3) 发布构建 E2E**（锁内，后台；`/tmp/coko-full-test.lock` 18:13:14 取得）
- `COKO_RELEASE_E2E=1 pnpm vitest run --project desktop-release`：退出 0，1 文件、2 例通过（27.1 秒；globalSetup 先删 `out-release` 再 make，产物 `out-release/make/zip/darwin/arm64/Coko-darwin-arm64-0.0.0.zip` 与 `out-release/make/dmg/arm64/Coko-0.0.0-arm64.dmg` 时间戳 18:13）。
- dmg 内 `Coko.app` 的 codesign（用例记录的原文）：
  ```text
  codesign --verify ok=false: …/coko-release-dmg-C9fUYx/Coko.app: invalid Info.plist (plist or signature have been modified)
  In architecture: arm64
  CodeDirectory v=20400 size=300 flags=0x2(adhoc) hashes=3+3 location=embedded
  Signature=adhoc
  TeamIdentifier=not set
  ```
  与票 10 记录一致：adhoc 签名，`--verify --deep --strict` 失败；签名与公证不在范围，列入人工清单。
- **插件声明的 LSP 服务器**：release E2E 没有这一项（两例为 make / dmg 挂载 / codesign 与测试钩子被忽略的对手用例；发布构建没有可用模型与测试钩子，不能驱动 lsp 调用）。证据为测试构建产物 smoke `apps/desktop/e2e/package-smoke.e2e.test.ts` 中票 05 的用例：安装并批准插件夹具后在打包应用中调用 lsp，`sample:ts` 被启动并登记为 kind lsp，退出后登记删除，假服务器记录了 initialize 与 hover（接收侧）。本票的全量中该文件通过。
- 全量 `pnpm run test`（同一把锁内，release E2E 之后，18:13:44–18:21:14）：`test=0`，Test Files 381 passed，Tests 2961 passed、5 skipped（2966）；日志 0 处 EAGAIN；本票持锁，没有其他全量重叠（锁保证；未采样锁外的单文件运行）。`secrets-gate-teams.test.ts` 与 `goal.e2e.test.ts` 本次都通过（已知间歇失败仍由 m6/fix-team-goal-flakes 处理，本票未改）。结束后 `git-ai bg run` 进程数为 1。
- 全量开始时 HEAD 为 7f1438f（与 main 相同）；之后本分支只改文档与一行测试注释，另以单文件复核（见下）。

**(4) manual-verification.md**：从规格复制 10 项，加入 390px 宽度下的 Team tab、GET 流上的 401、没有 FTS5 的运行时、Developer ID 签名与公证、真实更新 feed 的下载与安装；真实 Playwright MCP（含 `COKO_REAL_PLAYWRIGHT_MCP=1` 的用例）、要求认证的真实 HTTP MCP、真实语言服务器、真实模型下的 teammate 协作与 headless 已在其中并写成可执行的操作。每行留"结果 / 日期 / 执行者"空栏。

**(5) ADR 与导航**：`docs/adr/README.md` 19 行与 `docs/adr/` 19 个文件一一对应；0003、0017、0018、0019 的 frontmatter 与索引都是 accepted / implemented，未改。`docs/README.md` 插件一行补"设置中的插件分区与批准对话框"；当前行为导航含 M6 新页 plugins、lsp、teams、tracing、headless、delivery（`docs/subsystems/` 25 页均在导航中）。TECH_STACK 接入状态表 apps/desktop 一行的"安装包切片"与 `apps/desktop/package.json` 的 maker-zip / maker-dmg 8.0.1 一致，allowBuilds 说明与 `pnpm-workspace.yaml` 一致，未改。

**过时说法**：`apps/server/README.md`（PluginService / TraceService 为空或 501，见上）；`docs/subsystems/hooks.md:45`"插件的安装与批准尚未接入，当前只有测试构建的 COKO_TEST_PLUGINS"改为批准并启用后加载、链接 plugins.md（按本票 Comments 授权）；`docs/subsystems/mcp.md:36` 票 09 已改，未动；`tests/integration/sidecar-m6-seams.test.ts` 文件头"新路由的空结果与 501 占位"改为"新路由在没有数据时的空结果"（只改注释）。

**另发现的过时说法（未改，不在写范围）**：`docs/subsystems/configuration.md:41`"`teams.enabled` 已进入有效配置，读取它的功能尚未接入"。实际 `context/teams.ts:21` 与 `subagents.ts:298` 都读它（关闭时不注入 `<team>`、带 name 的 agent 调用报错）。请 Lead 合并时改一句或另开票。

**共用 token 对比度（实测，未改 token）**：按 `packages/ui/src/styles/theme.css` 的 palette 计算 WCAG 对比度。
| 主题 | `--destructive` | 背景 | 对比度 |
| --- | --- | --- | --- |
| 浅色 | red-500 rgb(236 19 19) | `--card-fill` / `--card` / `--background` / `--popover` 白 | **4.498** |
| 浅色 | 同上 | `--muted` gray-50 | **4.304** |
| 深色 | red-300 rgb(242 90 90) | `--card-fill` / `--card` gray-800 | **4.238** |
| 深色 | 同上 | `--popover` gray-850 | 4.775 |
| 深色 | 同上 | `--muted` gray-900 | 5.233 |
| 深色 | 同上 | `--background` gray-950 | 5.545 |
| 两者 | `bg-destructive` 按钮文字 | 白 on red-500 / ink on red-300 | 4.498 / 5.746 |

浅色主题下所有表面都低于 4.5（白色 4.498 四舍五入后才是 4.50）；深色只在设置卡片（`settings-page.tsx:134` 的 `bg-card-fill`）上低于 4.5。renderer 与 packages/ui 中 `text-destructive` 共 59 处（31 个文件）。小号或正文大小的错误文字（需 4.5:1）：
- 设置卡片上（浅色 4.498 / 深色 4.238，两套都不达标）：`provider-form.tsx:259,319`、`model-catalog.tsx:322`、`models-section.tsx:274`（删除按钮）、`general-section.tsx:127`、`memory-section.tsx:141,299`、`skills-section.tsx:133,163`、`capability-toggle.tsx:61`、`permissions-section.tsx:89,106,202,299`、`lsp-section.tsx:20（failed 状态）,183,265`、`plugins-section.tsx:193`、`hooks-section.tsx:195`、`mcp-section.tsx:48（failed 状态）,261,433,699,836`。
- 背景 / 对话框 / 右栏 / 时间线 / dock（浅色 4.498 不达标，深色 4.775–5.545 达标）：`worktrees.tsx:140`、`fetch-models-dialog.tsx:179`、`delete-provider-dialog.tsx:104`、`schedules-tab.tsx:171,405`、`trace-tab.tsx:84,131,265`、`plan-tab.tsx:113`、`hook-row.tsx:28`、`tool-cards.tsx:273,280`、`timeline-view.tsx:228`、`plan-review-panel.tsx:268`、`mode-picker.tsx:62,83,108`、`handoff-dialog.tsx:256,361`、`rewind-dialog.tsx:128`、`goal-card.tsx:151,343,363,488,496,555,585`；packages/ui 的 `button.tsx`（aria-invalid、destructive 变体）、`dropdown-menu.tsx:69`（destructive 菜单项，浅色 popover 白 4.498）、`context-ring.tsx:23`。
- 已绕开（只给图标用 destructive，图标要求 3:1）：`about-section.tsx:65`（票 10）、`plugins-section.tsx:256`（票 12）、`handoff-row.tsx:25`。
建议 Lead 另开票按 ui-design-system.md 调整 `--destructive`（浅色加深一档、深色在 gray-800 上提高亮度）或新增 `--destructive-text`（与 `--success-text` / `--warning-text` 同一做法），并加计算样式断言。

**实际运行的命令与结果**
- `pnpm install --frozen-lockfile`：退出 0。
- `COKO_RELEASE_E2E=1 pnpm vitest run --project desktop-release`：2 passed，退出 0（见上）。
- `pnpm run test`（锁内）：test=0，381 files、2961 passed、5 skipped。
- `pnpm run check:docs`：216 个文件，0 个问题（新增 manual-verification.md 之后）。
- 改动后复核：`pnpm exec oxfmt --check tests/integration/sidecar-m6-seams.test.ts` 通过；`pnpm exec vitest run tests/integration/sidecar-m6-seams.test.ts scripts/source-references.test.ts`：2 files、12 passed；`check:docs` 216 个文件 0 个问题。

**未验证**：签名与公证、真实更新 feed、真实模型 / 语言服务器 / Playwright MCP / 要求认证的 HTTP MCP / GET 流 401 / 无 FTS5 运行时 / 390px Team tab：未验证（需真实凭据或外部条件），列在 manual-verification.md。非 darwin：不在范围。main 上合入后的锁内全量：由 Lead 运行。

**越出 Write scope 的改动**：`docs/subsystems/hooks.md`（第 45 行一句，本票 Comments 授权）；`tests/integration/sidecar-m6-seams.test.ts`（文件头注释一行）。其余都在写范围内：两个 README、`packages/session/README.md`、`docs/README.md` 一行、`capability-coverage.md`、`manual-verification.md`（新）与本票文件。
