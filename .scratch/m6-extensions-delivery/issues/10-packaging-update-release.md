# 10: 安装包、自动更新接线与发布构建 E2E：DMG / ZIP、UpdateCoordinator、关于页、desktop-release 项目

**What to build:** 见 [规格](../spec.md)"安装包、自动更新与发布构建"：Forge makers（ZIP、DMG）与 `make` 脚本、`COKO_FORGE_OUT_DIR`、allowBuilds 裁决；`build.ts` 的 `__COKO_UPDATE_FEED__`；main `UpdateCoordinator` 的实现与 IPC；设置 → 关于；测试构建中本地 feed 的 E2E；`desktop-release` 项目（发布构建 + make + 产物断言）。

**User stories:** 18, 19

**Blocked by:** 03

**Status:** ready-for-agent

**Write scope:** `apps/desktop/{forge.config.ts,package.json,build/,vitest.release.config.ts,e2e-release/}`、`apps/desktop/src/main/{update-coordinator,build-flags}.ts`（及就近测试）、renderer `features/settings/about-section.tsx`、`stores/update-store.ts`（新）、`packages/i18n/src/dictionaries/domains/update.ts`、`apps/desktop/e2e/update.e2e.test.ts`（新）、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`docs/TECH_STACK.md`（桌面端表与接入状态一行、allowBuilds 说明）、`docs/tech-stack/desktop-delivery.md`（自动更新一节）、`docs/tech-stack/testing.md`（发布构建 E2E 一段）、`docs/subsystems/delivery.md`（新）、`docs/adr/0001-sidecar-on-electron-node.md`（产物证据一句）

**跨票接口：** 实现 03 定义的 `UpdateStatus` 与 bridge 的 `onUpdateStatus` / `checkForUpdates` / `installUpdate`，形状不改。

- [ ] 依赖：两个 maker 以精确版本安装，`pnpm install --frozen-lockfile` 通过；appdmg 链的每个安装脚本在 allowBuilds 中有裁决与理由（TECH_STACK）；无法安装时以 BLOCKED 报告
- [ ] `pnpm --filter @coko/desktop run make` 生成 `out/make/zip/darwin/arm64/*.zip` 与 `out/make/*.dmg`（darwin）
- [ ] main 单元：没有打包或 feed 为空时 disabled（两种 reason）；autoUpdater 事件到 UpdateStatus 的映射；`installUpdate` 经退出确认；发布构建不读 `COKO_TEST_UPDATE_FEED_URL`（构建期标志）
- [ ] E2E（测试构建，接收侧）：本地 feed 服务器（loopback 端口 0）收到 main 的请求；204 时关于页显示"已是最新"；返回一个更新时状态变为 error（或 downloading 后 error），应用不崩溃，关于页显示错误；"检查更新"按钮触发新请求；明暗主题与键盘操作
- [ ] `desktop-release`（`COKO_RELEASE_E2E=1`，**对手用例：发布构建忽略测试钩子**）：设 `COKO_FAUX_SCRIPT`、`COKO_TEST_CLOCK`、`COKO_E2E_BACKGROUND` 启动发布构建 → 没有可用模型（设置显示需要配置 Provider）、日志 `test hooks ignored in a packaged build` 列出这些名字、`POST /api/test/clock` 404、随包 ripgrep 与 node-pty 被加载、`auto update disabled { reason: no-feed }`；`out-release/make/` 的 dmg 经 `hdiutil attach -readonly -nobrowse` 挂载后有 `Coko.app`，`codesign --verify` 结果写进 Comments，卸载；未设 `COKO_RELEASE_E2E` 时 `pnpm run test` 不选中该项目、不打第二次包
- [ ] delivery.md 建立并可达；desktop-delivery.md 的自动更新一节改写为当前做法；testing.md 一段；TECH_STACK 同步；`check:docs` 通过；签名与公证记为不在范围

## Comments
