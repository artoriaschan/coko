# 12: 桌面 E2E 后台运行，不抢焦点

**What to build:** 用户反馈：跑 desktop E2E 时 Electron 窗口不断弹出、抢走焦点。新增只在未打包或测试构建中生效的开关 `COKO_E2E_BACKGROUND=1`（E2E harness 与 package-smoke 默认设置；`COKO_E2E_VISIBLE=1` 在本地调试时关闭后台模式），发布构建与其他测试钩子一样忽略它。后台模式下 macOS 用 `app.setActivationPolicy('accessory')`，不显示 Dock 图标、不激活应用；主窗口不调用 `show()` / `focus()`，改为 `showInactive()` + `setOpacity(0)`；第二实例激活路径同样不 focus。依赖真实窗口焦点的用例在页面内聚焦解决，不放宽断言。写采样脚本证明全量 desktop E2E 期间本仓库的 Electron / Coko 从未成为前台应用。

**User stories:** 无（开发体验修复）

**Blocked by:** None

**Status:** ready-for-agent

**Write scope:** `apps/desktop/src/main/e2e-background.ts`（新）、`e2e-background.test.ts`（新）、`apps/desktop/src/main/window.ts`、`apps/desktop/src/main/index.ts`、`apps/desktop/e2e/harness.ts`、`apps/desktop/e2e/package-smoke.e2e.test.ts`、`apps/desktop/e2e/background.e2e.test.ts`（新）、`apps/desktop/e2e/foreground-watch.ts`（新）、`docs/tech-stack/testing.md`、本票

- [x] 开关只在未打包或测试构建中生效，发布构建忽略；单元测试覆盖
- [x] 后台模式：accessory、不激活、showInactive + opacity 0，第二实例不 focus；E2E 断言窗口状态与 renderer 不节流
- [x] 依赖焦点的用例逐个列出并保持原断言通过
- [x] 全量 desktop E2E（含 package-smoke）期间每 500ms 采样前台应用，本仓库的 Electron / Coko 从未成为前台
- [x] testing.md "运行与编排"补后台运行约定与调试开关；`pnpm run check:docs` 通过
- [x] git merge main 后全量 `pnpm run test` 退出码 0

## Comments
- 2026-10-29 实施者：完成。

  **方案与依据。** 选 `showInactive()` + `setOpacity(0)`，另加 `setIgnoreMouseEvents(true)`、`skipTaskbar` 与 `backgroundThrottling: false`；macOS 在单实例锁之前 `app.setActivationPolicy('accessory')`（第二实例退出前也不进 Dock）。在本机 Electron 41.0.3 上用独立进程做了对照：`show:false` + `backgroundThrottling:false` 与 `showInactive` + opacity 0 在 1 秒内都有 60 帧 rAF、10ms 计时器 100 次、`visibilityState=visible`，`capturePage` 都可用；被另一个窗口完全覆盖时后者仍是 60 帧 / 100 次。两者都可行，选后者是因为窗口真实处于"已显示"状态，`isVisible()`、对话框归属与遮挡判定和正常运行一致，从未显示的窗口则依赖 Chromium 对隐藏窗口的特殊处理。透明窗口忽略鼠标，用户点到它所在区域时不会激活应用；Playwright 经 CDP 注入输入，不受影响。实现：`apps/desktop/src/main/e2e-background.ts`（开关）、`window.ts` 的 `revealMainWindow`（首次显示与第二实例共用）、`index.ts`；启动日志 `app starting` 增加 `background`。

  **发布构建忽略开关。** `e2eBackgroundEnabled(env, { packaged, testBuild })` 在 `packaged && !testBuild` 时返回 false，与 `sidecarEnvironment` 同样按构建期 `__COKO_TEST_BUILD__` 区分；`e2e-background.test.ts` 4 例覆盖（未打包 / 测试构建开启、发布构建忽略、VISIBLE 关闭、取值不是 1）。package-smoke 断言测试构建产物的 `app starting` 带 `background: true`。

  **依赖焦点的用例。** 逐个核对：`commands.e2e.test.ts`:62、:109，`permissions.e2e.test.ts`:71，`references-drafts.e2e.test.ts`:84（composer 为 `document.activeElement`），`chat.e2e.test.ts`:154（焦点回到 composer），`rewind.e2e.test.ts`:112–116（`locator.focus()` 后 activeElement），`context.e2e.test.ts`:74–82（Esc 后焦点回到上下文环，失败信息带 `document.hasFocus()`）。全部不改代码、不放宽断言即通过：Playwright 1.64.0 对 `_electron.launch` 与 `connectOverCDP` 的主框架都发送 `Emulation.setFocusEmulationEnabled`（playwright-core `lib/coreBundle.js` 第 39021 行，只有 `noDefaults` 时跳过，本仓库未使用）。没有 `:focus-visible` 与 IME 用例。

  **不抢焦点的证据。** `apps/desktop/e2e/foreground-watch.ts`：运行给定命令，期间每 500ms 用 `lsappinfo front` + `lsappinfo info -only name,pid,bundlepath` 采样；bundle 路径在本检出之下的前台应用记为违规（命令成功但有违规时退出码 3）。按 bundle 路径而不是名字判定，因为并行的其他检出（票 10 worktree、Lead 在 main 上的复核）启动的 Electron 也叫 "Electron"。全量运行 `node apps/desktop/e2e/foreground-watch.ts --out /tmp/coko-fg-full/summary.json -- pnpm run test`（merge main 之后）：命令退出码 0，耗时 275.5 s，547 个样本；前台为 Google Chrome 413、DeepSeek Harness 109、Electron 25；**本检出违规 0**。25 个 Electron 样本全部来自 `/Users/chenzheng/Desktop/Work/person/coko/node_modules/electron/dist/Electron.app`（主仓库的另一次运行，8 个 pid，03:35:45–03:36:06Z），不是本检出启动的进程。

  **命令与结果。** `pnpm run test apps/desktop/src/main/e2e-background.test.ts`：4 passed。受监视的子集（background + desktop-shell）：13 passed，52 个样本全是 DeepSeek Harness，违规 0。merge main 后全量 `pnpm run test`：166 个文件通过，1211 passed、1 skipped（`settings.e2e.test.ts` 的真实 DeepSeek 凭据用例，没有 `DEEPSEEK_API_KEY`），desktop-e2e 19 个文件全部通过（含 package-smoke 2 例、新 background 1 例）。日志中唯一的 Error 文本是 ui Browser Mode 用例 `file-reference-node.browser.test.tsx` 输出到 stderr 的 `ResizeObserver loop completed with undelivered notifications`，不是 Vitest 报告的未处理错误，与本票无关。`pnpm run typecheck`、`lint`、`format:check`、`check:docs` 均退出码 0。

  **负向确认。** (1) 去掉 `packaged && !testBuild` 一行：单元测试"打包的发布构建忽略该开关"失败，恢复后 4 passed。(2) 把后台分支改成 `show()` + `focus()`：`background.e2e.test.ts` 失败（focused true、opacity 1），foreground-watch 记录到 1 个违规样本（本检出的 Electron.app，pid 78811），退出码非 0；已恢复。这一步让窗口出现了一次。

  **未验证。** Windows / Linux 上的后台行为（只有 skipTaskbar、showInactive 与 opacity，没有 accessory 对应项）；用户手动在 Dock / Cmd-Tab 中检查未做，由 lsappinfo 的 `ApplicationType=UIElement` 与 `app.dock.isVisible() === false` 断言代替。

  **文档。** `docs/tech-stack/testing.md` 的"运行与编排"加了一段后台运行约定与 `COKO_E2E_VISIBLE=1`。不需要合并导航行或导出。

  **越出范围。** 无。main / harness 属于共享装配点，本票由用户直接授权修改。

