---
kind: reference
description: "当前的桌面交付：开发运行（electron-forge start 的 watch、Electron 与 Sidecar 的重启），Forge 的 ZIP / DMG makers 与 make 脚本、COKO_FORGE_OUT_DIR、appdmg 链的安装脚本裁决，main 的 UpdateCoordinator（构建期更新源、disabled 原因、autoUpdater 事件到 UpdateStatus 的映射、检查调度、经退出确认的安装），设置 → 关于，发布构建与测试构建的差异，以及两类 E2E 入口（测试构建的本地 feed、COKO_RELEASE_E2E 的发布构建）。修改打包、更新或发布构建前查阅。"
lifecycle: active
---

# 安装包、自动更新与发布构建

本文说明 Coko 桌面端当前如何生成安装包、检查与安装更新，以及发布构建与测试构建的差异和各自的端到端验证。构建职责与 Forge 边界见 [桌面构建与交付约定](../tech-stack/desktop-delivery.md)；精确版本与安装脚本裁决见 [技术栈](../TECH_STACK.md)；Sidecar 进程模型见 [ADR 0001](../adr/0001-sidecar-on-electron-node.md)。签名（Developer ID）与公证不在当前范围。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `apps/desktop/forge.config.ts` | `outDir`（`COKO_FORGE_OUT_DIR`，缺省 `out`）、`packagerConfig.icon`（仓库根 `brand/rukie-app-icon`）、`MakerZIP({}, ['darwin'])`、`MakerDMG({ format: 'ULFO' })`、Fuses、preStart 的 watch 与开发服务器、prePackage 构建 |
| `apps/desktop/build/build.ts` | 构建期定义：`__COKO_TEST_BUILD__`、`__COKO_UPDATE_FEED__`（main）、`__COKO_RUNTIME_VERSIONS__`（renderer 的关于页）；`watchElectron`、`watchSidecar`、Sidecar 重建通知文件 |
| `apps/desktop/src/main/dev-reload.ts`、`sidecar-supervisor.ts` 的 `reload` | 开发时 Sidecar 重建后的计划重启 |
| `apps/desktop/src/main/build-flags.ts` | `TEST_BUILD`、`UPDATE_FEED`、`resolveUpdateFeed`、`ignoredTestHooks` |
| `apps/desktop/src/main/update-coordinator.ts` | `createUpdateCoordinator`：状态、调度、日志与安装；autoUpdater 与退出流程由 `index.ts` 注入 |
| `apps/desktop/src/shared/bridge.ts`、`src/preload/` | `UpdateStatus`；`onUpdateStatus`（订阅时先给出当前状态）、`checkForUpdates`、`installUpdate` |
| `apps/desktop/src/renderer/stores/update-store.ts`、`features/settings/about-section.tsx` | 关于页的更新状态与操作 |
| `apps/desktop/e2e/update.e2e.test.ts` | 测试构建的打包产物 + 本地 feed |
| `apps/desktop/vitest.release.config.ts`、`e2e-release/` | `desktop-release` 项目：发布构建 + make + 产物断言 |

## 开发运行

`pnpm dev:desktop`（根脚本，等价 `pnpm --filter @coko/desktop run start`；`electron-forge start`）的 preStart 依次：复制 ripgrep；启动 main / preload 与 Sidecar 的 tsdown watch 构建，两者首次构建都成功后启动 renderer 的 Vite 开发服务器（middleware 模式，HMR 复用同一端口），再由 Forge 启动 Electron。首次构建失败时 tsdown 报告错误并继续监听，修复后继续启动。

| 改动范围 | 结果 |
| --- | --- |
| renderer（`src/renderer` 及其引入的共享模块） | Vite HMR，窗口与 Sidecar 不重启 |
| main / preload（`src/main`、`src/preload` 及其引入的模块） | 重建后经 Forge 的 `requestAppRestart` 重启 Electron（与在终端输入 `rs` 或在 Forge 界面按 `r` 相同）；旧 main 退出时按正常退出收尾并停止它的 Sidecar。main 与 preload 在 200 毫秒内的重建合并为一次重启 |
| Sidecar（`apps/server` 及其引入的 packages） | 重建后 `build.ts` 原子替换 `dist/dev/sidecar-build`（经 `COKO_SIDECAR_RELOAD_FILE` 交给 main，不进安装包）；main 监视所在目录，内容变化时调用 `SidecarSupervisor.reload()` |

`reload()` 是计划重启：先通知控制通道当前进程不可用（等待中的请求被拒绝），分级停止当前进程（不触发意外退出与崩溃重启），启动新进程并重新交换 cookie。状态经 `restarting` 回到 `ready`，renderer 与崩溃重启时一样连向新地址并以 afterSeq 补齐；不计入连续故障次数。新进程启动失败时直接进入 `failed { reason: crashed }`，不按退避重试，修复后的下一次重建可以从这里恢复到 `ready`。进行中的 reload 期间的重建合并为它结束后的一次。Sidecar 首次启动失败（`reason: startup`）时 reload 不做任何事，需要重启 Electron。

已知限制：tsdown 的 watch 在 stdin 上注册了自己的快捷键（`r`、`c`、`q` 加回车；`q` 会直接结束 Forge 进程）。只对未打包的运行生效：main 只在 `!app.isPackaged` 时读取 `COKO_SIDECAR_RELOAD_FILE`。

## 安装包

`pnpm make:desktop`（根脚本，等价 `pnpm --filter @coko/desktop run make`；`electron-forge make`）先运行与 `package` 相同的 prePackage 构建与打包，再生成：

- `out/make/zip/darwin/<arch>/Coko-darwin-<arch>-<version>.zip`：自动更新（Squirrel.Mac）下载的格式。
- `out/make/dmg/<arch>/Coko-<version>-<arch>.dmg`：首次安装，ULFO 格式，内含 `Coko.app` 与 Applications 别名。

`COKO_FORGE_OUT_DIR` 改变 `out` 这一级目录；发布构建 E2E 用 `out-release`，与测试构建 E2E 的 `out/` 分开（两者都被 git 忽略）。只做当前平台（本机 macOS arm64）。DMG maker 经 electron-installer-dmg 使用 appdmg，后者依赖两个需要编译的原生模块 fs-xattr 与 macos-alias；它们只在构建机的 make 中运行，不进安装包。

打包产物为 adhoc 签名（`codesign -dv`：`Signature=adhoc`，`TeamIdentifier=not set`）。2026-10-31 的本机 make 中，`codesign --verify --deep --strict` 对 `out/` 与 dmg 内的 `Coko.app` 都报 `invalid Info.plist (plist or signature have been modified)`；本机运行与测试不受影响。Developer ID 签名接入时需要在打包后重新签名并复查这一项。

## 自动更新

更新源只来自构建期：`build.ts` 把 `process.env.COKO_UPDATE_FEED_URL ?? ''` 定义为 `__COKO_UPDATE_FEED__`。它属于发布方，不是用户设置。测试构建（`COKO_TEST_BUILD=1`）另读运行时的 `COKO_TEST_UPDATE_FEED_URL`（非空时替换构建期的值）；发布构建不读它（`resolveUpdateFeed`）。

`UpdateCoordinator` 在日志就绪后 `start()`：

- 未打包 → `disabled { reason: not-packaged }`；打包但更新源为空 → `disabled { reason: no-feed }`。两者都记 `auto update disabled { reason }`，不设置 autoUpdater、不检查。
- 否则注册 autoUpdater 的监听，`setFeedURL({ url })`，记 `auto update enabled`，30 秒后第一次检查，之后每 6 小时一次。`setFeedURL` 同步抛出（例如应用没有可用签名）时进入 `error`，不安排检查。

| autoUpdater 事件 | UpdateStatus |
| --- | --- |
| `checking-for-update` | `checking` |
| `update-available` | `downloading`（Squirrel.Mac 发现更新后立即下载） |
| `update-not-available` | `not-available` |
| `update-downloaded` | `downloaded { version: releaseName }` |
| `error` | `error { message }`（`redactText` 脱敏） |

`available` 保留在联合中，当前不产生。每次变化记 `update status { state, version? }` 并经 `IPC.updateStatus` 推给主窗口；renderer 订阅时先经 `IPC.getUpdateStatus` 取当前状态。`checkForUpdates` 在 disabled，或 `checking` / `downloading` / `downloaded` 时不做任何事；`error` 之后可以重试。同步抛出的检查同样进入 `error`。始终有 `error` 监听，autoUpdater 的错误不会使 main 崩溃。

`installUpdate` 只在 `downloaded` 时生效：先经与普通退出相同的 `QuitCoordinator`（有活动 Run 时询问），确认后记 `update install requested`，执行退出收尾（停止定时检查、隐藏窗口、停止 Sidecar、刷新日志），最后 `autoUpdater.quitAndInstall()`；收尾之后的 before-quit 直接放行。取消确认时什么都不做，状态保持 `downloaded`。

## 关于页

设置 → 关于显示应用版本、随包 Electron 与 Node 版本（构建时以 `ELECTRON_RUN_AS_NODE` 运行依赖的 Electron 读取 `process.versions`）、更新卡片：状态文字，disabled 的原因、下载中或已下载的版本、错误原因，"检查更新"（disabled、检查中、下载中时不可用）或已下载时的"重启以更新"。错误只用图标着色，文字保持中性色以满足对比度。没有 bridge（浏览器中运行 renderer）时视为 `disabled { reason: not-packaged }`。

## 发布构建与测试构建

| | 测试构建（`COKO_TEST_BUILD=1`） | 发布构建 |
| --- | --- | --- |
| 打包方 | 桌面 E2E 的 globalSetup（`pnpm run package`，`out/`） | `pnpm run make`；发布构建 E2E 的 globalSetup 打到 `out-release/` |
| `COKO_FAUX_SCRIPT`、`COKO_SANDBOX_EXEC`、`COKO_TEST_*` | 交给 Sidecar 并生效 | main 不交给 Sidecar，Sidecar 带 `--packaged` 也不读 |
| `COKO_E2E_BACKGROUND` / `COKO_E2E_VISIBLE` | 生效 | 忽略，窗口正常出现 |
| `COKO_TEST_UPDATE_FEED_URL` | 替换更新源 | 忽略 |
| 日志 | — | main 记 `test hooks ignored in a packaged build { variables }`（只列名字，含 main 自己读取的 `COKO_E2E_*`） |

未打包运行（单元测试、`electron-forge start`）时更新始终 `disabled { reason: not-packaged }`。

## 验证入口

- 开发运行：`sidecar-supervisor.test.ts`（reload 换进程且旧进程经 shutdown 退出、不触发意外退出；新进程失败进入 failed 后再次 reload 恢复；并发 reload 合并；首次启动失败后不动作；reload 途中 stop）、`dev-reload.test.ts`（原子替换触发、内容未变与其他文件不触发、close 后不触发）。`electron-forge start` 的整条链路没有自动化测试，2026-11-02 本机手动验证：改 `apps/server/src/index.ts` 后 Electron 进程不变、Sidecar 约 0.3 秒后重新 ready；改 `src/main` 后 Electron 重启、旧 Sidecar 退出、新 Sidecar ready；结束 Electron 后 Forge 退出，没有残留进程。
- main 单元：`update-coordinator.test.ts`（两种 disabled、事件映射、调度、去重、同步抛出、脱敏、经确认的安装与取消）、`build-flags.test.ts`（发布构建不读 `COKO_TEST_UPDATE_FEED_URL`、被忽略的名字）。
- renderer：`update-store.test.ts`、`about-section.browser.test.tsx`（各状态文案、键盘、明暗主题对比度）。
- 测试构建 E2E `update.e2e.test.ts`（darwin）：本地 feed（loopback 端口 0）收到 main 的请求；204 → 已是最新；返回一个更新（下载内容不是签名应用）→ `error`，应用与 Sidecar 仍在，按钮与键盘触发新请求，明暗主题。
- 发布构建 E2E：`COKO_RELEASE_E2E=1 pnpm exec vitest run --project desktop-release`，在全量测试锁内运行（会再打一次包）。未设置时该项目选中 0 个文件、不装 globalSetup。断言见 [测试约定](../tech-stack/testing.md#运行与编排)。
