# 05: 桌面壳：窗口、Sidecar 生命周期与协议代理

**What to build:** apps/desktop main / preload：单实例锁、macOS 窗口参数、spawn Sidecar（可用占位 Sidecar 或 04 的产物）、ready / fatal 处理、inspect-quit 与分级退出、`coko-app://` 代理与 cookie 注入、WebSocket 头注入、boot IPC、目录选择；Forge 配置、tsdown（main / preload / sidecar）与 Vite renderer 接线，renderer 显示连接状态页。

**Blocked by:** 01

**Status:** ready-for-agent

- [x] `pnpm --filter desktop start` 启动窗口并显示 Sidecar 已连接（清除 ELECTRON_RUN_AS_NODE）
- [x] Playwright Electron E2E：窗口加载 coko-app://，renderer 能经代理请求 health 并建立 WebSocket
- [x] renderer 无法读到令牌或 cookie；非主窗口来源的 WebSocket 升级被取消
- [x] 退出后 Sidecar 进程不存在；Sidecar 启动失败时显示错误对话框

## Comments

### 实施记录（m1/05-desktop-shell）

**覆盖的验收**

- start：`COKO_SIDECAR_ENTRY=<占位 sidecar> pnpm --filter desktop start -- --remote-debugging-port=9339`，经 CDP 读到窗口 `coko-app://app/`、`data-connection=connected`、文本"Sidecar connected"，页面由 Vite 开发服务器经协议代理提供（含 `@vite/client`）。SIGTERM 结束后无残留 Electron / sidecar 进程。不设 `COKO_SIDECAR_ENTRY` 时使用 tsdown 构建的 `apps/server/src/index.ts`；main 上的占位入口立即退出，会显示启动失败对话框，04 合入后应显示已连接（未验证）。
- E2E（`apps/desktop/e2e/desktop-shell.e2e.test.ts`，Playwright 驱动真实 Electron + 占位 sidecar）：加载 coko-app 并显示已连接；经代理请求 health、经头注入建立 WebSocket 回显；renderer 的 `document.cookie`、boot 信息、HTML 不含令牌或 cookie，响应无 set-cookie，代理对令牌交换入口返回 404，Chromium cookie jar 为空；隐藏的第二窗口发往 sidecar 的升级被取消且 sidecar 未收到 upgrade（把取消改为放行后该用例按预期失败，已撤销）；退出后 sidecar 进程不存在；有活动 Run 时取消保持运行、确认后退出并关闭 sidecar；fatal 时弹出 error 对话框且 renderer 显示失败状态与错误码；目录选择返回路径、取消为 null；同 userData 第二实例退出码 0 且不再 spawn sidecar；窗口 1280×820、最小 520×600、红绿灯 (16,18)。
- 单元 / 集成（Vitest，占位 sidecar 以 `ELECTRON_RUN_AS_NODE=1` 运行）：SidecarProcess 的 ready、参数传递、graceful / SIGTERM / SIGKILL 三级退出、fatal、ready 前退出（stderr 诊断）、非法消息、ready 超时、inspectQuit 结果与超时、ready 后意外退出；协议代理的 cookie 注入与替换、set-cookie 剥离、流式请求体、跨源 403、503、静态资源 CSP 与越界路径；WebSocket 头决策；退出确认合并；protocol 控制消息 schema。

**实际运行的命令与结果**

- `pnpm run test apps/desktop/src/main`：5 个文件 28 个用例通过。
- `pnpm run test packages/protocol`：2 个文件 18 个用例通过。
- `pnpm exec vitest run --project desktop-e2e`：1 个文件 10 个用例通过（globalSetup 先构建 main / preload / renderer）。
- `pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm run check:docs`：均退出 0。
- `pnpm --filter desktop package`：退出 0；`Resources/sidecar/index.mjs` 存在，app.asar 只含 package.json 与 dist/electron、dist/renderer；fuses 读回 RunAsNode 开、NodeOptions / CLI inspect 关、asar 完整性与仅从 asar 加载开；产物以 `ELECTRON_RUN_AS_NODE=1` 运行报告 Electron 41.0.3 / Node 24.14.0 并能执行随包 sidecar 入口。

**与规格的差异与待 Lead 裁决**

- 控制 IPC 增加 sidecar → main 的 `inspect-quit.result { requestId, activeRuns }`：规格只列了 main → sidecar 的 inspect-quit，没有回答消息。main → sidecar 的 `inspect-quit` 带 `requestId`。credential.* 未加入，留给 08。
- 新增 `API_ROUTES`（`/api/auth/exchange` POST `{ token }` → 204 + Set-Cookie、`/api/health` → `{ status: 'ok' }`、WebSocket `/api/ws`）与 `HealthResponse`。04 若选其他路径，改 `packages/protocol/src/api.ts` 即可，main 与占位 sidecar 都引用它。
- main 传给 sidecar 的启动参数：`--data-dir <userData>/data --log-dir <logs>`；ripgrep 路径留给 09。
- sidecar 构建入口：desktop 的 `build/build.ts` 以 tsdown 把 `../server/src/index.ts` 打成 `dist/sidecar/index.mjs`；04 若在 apps/server 自带 tsdown 配置，可改为调用它。
- E2E 放在 `apps/desktop/e2e`（`vitest.e2e.config.ts`，项目名 desktop-e2e，根配置按 glob 自动发现，会随 `pnpm run test` 运行），未放在架构约定的根 `tests/e2e`：这些用例只覆盖桌面壳 + 占位 sidecar，跨应用场景（07）再放根目录。
- 测试与开发用的环境变量：`COKO_USER_DATA_DIR`（任意构建生效，在单实例锁之前设置 userData 与日志目录）、`COKO_SIDECAR_ENTRY`（仅未打包时生效）、`COKO_RENDERER_DEV_URL`（仅未打包时生效，由 preStart 设置）。

**未验证项**

- 开发 watch：preStart 只做一次 tsdown 构建，main / preload / sidecar 改动后的自动重建与重启未接入；renderer 走 Vite middleware 与 HMR，HMR 实际刷新未手动验证。
- 安装包 GUI 启动与对话（依赖 04 与 09）；sidecar 重启后的重新交换（ADR 0002，M1 未实现自动重启，ready 后意外退出只弹错误对话框）。
- 非 macOS 平台。DMG / ZIP makers 未配置（`makers: []`）。
- renderer 状态页文案为临时 zh / en 字典，样式只用系统颜色关键字；06 / 07 接入 i18n 与 ui 后替换。

**文档影响**

- `docs/TECH_STACK.md` 接入状态：apps/desktop 行补充本切片的 devDependencies，新增 packages/protocol 行（typebox）。
- `docs/tech-stack/architecture.md` 运行链路：补充 `/api` 路由前缀与代理边界、boot IPC 返回的 WebSocket 基址，以及 inspect-quit 的 2 秒确认规则。
- 2026-10-28 lead：评审后合入 main（1f93d07）。main 上复核：install、typecheck、lint 退出 0；test 27 文件 177 用例通过（含 desktop-e2e）；check:docs 0 问题。接受新增的 inspect-quit.result 与 /api 路由约定，票 04 按 packages/protocol 的 api.ts / control.ts 实现。watch 重启与打包 GUI 启动留给票 09 验证。worktree 已清理。

Closed: true
