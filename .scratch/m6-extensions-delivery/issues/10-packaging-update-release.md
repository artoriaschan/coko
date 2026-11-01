# 10: 安装包、自动更新接线与发布构建 E2E：DMG / ZIP、UpdateCoordinator、关于页、desktop-release 项目

**What to build:** 见 [规格](../spec.md)"安装包、自动更新与发布构建"：Forge makers（ZIP、DMG）与 `make` 脚本、`COKO_FORGE_OUT_DIR`、allowBuilds 裁决；`build.ts` 的 `__COKO_UPDATE_FEED__`；main `UpdateCoordinator` 的实现与 IPC；设置 → 关于；测试构建中本地 feed 的 E2E；`desktop-release` 项目（发布构建 + make + 产物断言）。

**User stories:** 18, 19

**Blocked by:** 03

**Status:** ready-for-agent

**Write scope:** `apps/desktop/{forge.config.ts,package.json,build/,vitest.release.config.ts,e2e-release/}`、`apps/desktop/src/main/{update-coordinator,build-flags}.ts`（及就近测试）、renderer `features/settings/about-section.tsx`、`stores/update-store.ts`（新）、`packages/i18n/src/dictionaries/domains/update.ts`、`apps/desktop/e2e/update.e2e.test.ts`（新）、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`docs/TECH_STACK.md`（桌面端表与接入状态一行、allowBuilds 说明）、`docs/tech-stack/desktop-delivery.md`（自动更新一节）、`docs/tech-stack/testing.md`（发布构建 E2E 一段）、`docs/subsystems/delivery.md`（新）、`docs/adr/0001-sidecar-on-electron-node.md`（产物证据一句）

**跨票接口：** 实现 03 定义的 `UpdateStatus` 与 bridge 的 `onUpdateStatus` / `checkForUpdates` / `installUpdate`，形状不改。

- [x] 依赖：两个 maker 以精确版本安装，`pnpm install --frozen-lockfile` 通过；appdmg 链的每个安装脚本在 allowBuilds 中有裁决与理由（TECH_STACK）；无法安装时以 BLOCKED 报告
- [x] `pnpm --filter @coko/desktop run make` 生成 `out/make/zip/darwin/arm64/*.zip` 与 `out/make/*.dmg`（darwin）
- [x] main 单元：没有打包或 feed 为空时 disabled（两种 reason）；autoUpdater 事件到 UpdateStatus 的映射；`installUpdate` 经退出确认；发布构建不读 `COKO_TEST_UPDATE_FEED_URL`（构建期标志）
- [x] E2E（测试构建，接收侧）：本地 feed 服务器（loopback 端口 0）收到 main 的请求；204 时关于页显示"已是最新"；返回一个更新时状态变为 error（或 downloading 后 error），应用不崩溃，关于页显示错误；"检查更新"按钮触发新请求；明暗主题与键盘操作
- [x] `desktop-release`（`COKO_RELEASE_E2E=1`，**对手用例：发布构建忽略测试钩子**）：设 `COKO_FAUX_SCRIPT`、`COKO_TEST_CLOCK`、`COKO_E2E_BACKGROUND` 启动发布构建 → 没有可用模型（设置显示需要配置 Provider）、日志 `test hooks ignored in a packaged build` 列出这些名字、`POST /api/test/clock` 404、随包 ripgrep 与 node-pty 被加载、`auto update disabled { reason: no-feed }`；`out-release/make/` 的 dmg 经 `hdiutil attach -readonly -nobrowse` 挂载后有 `Coko.app`，`codesign --verify` 结果写进 Comments，卸载；未设 `COKO_RELEASE_E2E` 时 `pnpm run test` 不选中该项目、不打第二次包
- [x] delivery.md 建立并可达；desktop-delivery.md 的自动更新一节改写为当前做法；testing.md 一段；TECH_STACK 同步；`check:docs` 通过；签名与公证记为不在范围

## Comments

### 实施者回执（m6/10-packaging-update-release）

**覆盖的验收**（全部勾选；证据文件）：
- 依赖：`@electron-forge/maker-zip@8.0.1`、`@electron-forge/maker-dmg@8.0.1`（apps/desktop devDependencies，精确版本）；新增安装脚本只有 `fs-xattr@0.3.1` 与 `macos-alias@0.2.12`（appdmg 0.6.6 链，均只有 binding.gyp），`allowBuilds` 放行，理由写入 `pnpm-workspace.yaml` 与 TECH_STACK 的依赖说明段；`pnpm install --frozen-lockfile` 退出 0。
- make：`pnpm --filter @coko/desktop run make` 生成 `out/make/zip/darwin/arm64/Coko-darwin-arm64-0.0.0.zip` 与 `out/make/dmg/arm64/Coko-0.0.0-arm64.dmg`。**与票面的差异**：Forge 8 的 DMG 路径是 `out/make/dmg/<arch>/*.dmg`，不是 `out/make/*.dmg`；release E2E 按 `make/` 下递归查找 .dmg 断言恰好一个。
- main 单元：`update-coordinator.test.ts`（10 例：not-packaged / no-feed 两种 reason 与两者同时、调度 30 秒与 6 小时、事件映射与 `update status` 日志、error 脱敏与不抛出、setFeedURL / checkForUpdates 同步抛出、去重与 error 后重试、安装经确认→收尾→quitAndInstall 的顺序、取消确认不安装）；`build-flags.test.ts`（4 例：发布构建不读 `COKO_TEST_UPDATE_FEED_URL`、测试构建替换、被忽略的测试钩子名字）。
- E2E（测试构建，接收侧）：`apps/desktop/e2e/update.e2e.test.ts`（darwin）：本地 feed（127.0.0.1 端口 0）收到 main 的 GET；204 → 关于页"已是最新"；返回一个更新（下载内容不是 zip）→ `error`，进程仍在、`/api/health` 200、可重试；"检查更新"按钮与键盘 Enter 各触发一次新请求；明暗主题下状态与原因文字对比度 ≥ 4.5；desktop.jsonl 有 `auto update enabled` 与 `update status` 的 checking / not-available / error。
- `desktop-release`：`apps/desktop/e2e-release/{global-setup,release.e2e.test}.ts`，2 例通过（锁内，见下）。对手用例：带 `COKO_FAUX_SCRIPT`、`COKO_TEST_CLOCK`、`COKO_E2E_BACKGROUND`、`COKO_TEST_UPDATE_FEED_URL` 启动发布构建 → `/api/providers` 为空、设置 → 模型显示"还没有 Provider"、日志 `test hooks ignored in a packaged build` 列出这四个名字（main 记录；Sidecar 收不到它们）、`POST /api/test/clock` 404、测试 feed 服务器收到 0 个请求、`auto update disabled { reason: no-feed }`、关于页 disabled 且显示"此版本没有配置更新源"、`app starting { packaged: true, testBuild: false, background: false }`、`pty backend selected` 与 `grep implementation selected` 指向 `Resources/` 下的随包路径、没有 `faux provider enabled for tests`、日志不含 faux 脚本路径。dmg 经 `hdiutil attach -readonly -nobrowse -mountpoint <tmp>` 挂载后 `Coko.app` 存在，卸载。未设 `COKO_RELEASE_E2E` 时项目选中 0 个文件（全量中 desktop-release 不出现）。
- 文档：`docs/subsystems/delivery.md`（新）、desktop-delivery.md 自动更新一节、testing.md 一段、TECH_STACK（接入状态 apps/desktop 一行追加、allowBuilds 说明）、ADR 0001 一句；签名与公证记为不在范围；`pnpm run check:docs` 209 文件 0 问题。

**codesign --verify 结果**（2026-10-31，dmg 内的 `Coko.app`）：`--verify --deep --strict` 失败：`invalid Info.plist (plist or signature have been modified)`；`codesign -dv`：`flags=0x2(adhoc)`、`Signature=adhoc`、`TeamIdentifier=not set`。`out/` 中的测试构建同样如此。没有修复：签名不在本票范围，Developer ID 接入时需在打包后重新签名并复查。

**实际运行的命令与结果**：见完成报告（最终数字在本段之后补记）。

**负向确认**：`resolveUpdateFeed` 把 `options.testBuild` 改为 `true` 后 `build-flags.test.ts` 的"发布构建不读"用例变红，已还原。关于页的对比度用例先红（`text-destructive` 在卡片上 4.498 / 4.238 < 4.5），改为中性色文字 + destructive 图标后通过。release E2E 的对照是测试构建 E2E：同一个 `COKO_TEST_UPDATE_FEED_URL` 在测试构建中被请求、在发布构建中收到 0 个请求。

**实现要点与偏离（请 Lead 裁决）**：
- `update-available` 映射为 `downloading`（Squirrel.Mac 发现更新即下载，没有单独的可下载阶段）；`available` 留在联合中但当前不产生。形状未改。
- `UpdateCoordinator` 接口加了 `start()`（日志就绪后启用或记 disabled，避免日志配置前丢记录），`createUpdateCoordinator` 需要参数（packaged、feedUrl、updater、confirmQuit、prepareQuit）。bridge 与 `UpdateStatus` 形状未改。
- "test hooks ignored in a packaged build"在发布构建中由 **main** 记录（main 已不把这些变量交给 Sidecar，所以 Sidecar 侧的同名日志在发布构建里不会出现）；列表含 main 自己读的 `COKO_E2E_BACKGROUND` / `COKO_E2E_VISIBLE` 与 `TEST_HOOK_ENV` 匹配的全部名字，只记名字。
- 关于页的 Electron / Node 版本：`build.ts` 以 `ELECTRON_RUN_AS_NODE` 运行依赖的 Electron 读取 `process.versions`，作为 `__COKO_RUNTIME_VERSIONS__` 经 viteBuild / dev server 的 inline `define` 注入（不改 vite.config.ts）；Browser Mode 中没有该定义，版本行不显示。
- 发布构建 E2E 启动应用用 `open -g -n --stderr <file> --env ...`，进程号从 CDP `SystemInfo.getProcessInfo` 的 browser 进程读取，只结束它及其子进程（不按名字查找）。
- release globalSetup 会让 prePackage 以发布标志重建 `dist/`；之后运行测试构建 E2E 时其 globalSetup 会重打测试构建（未打包路径的用例不受这些标志影响）。

**越出 Write scope 的最小改动**：
- `apps/desktop/src/main/index.ts`：update 协调者的装配（autoUpdater、`quitCoordinator.decide`、`prepareQuit`）、把 `finishQuit` 拆为 `prepareQuit` + `app.quit()`、日志就绪后 `updates.start()`、`test hooks ignored in a packaged build` 日志。03 已在此文件放好 update IPC；没有其他进行中的票写它。
- `apps/desktop/.gitignore`：加 `out-release/`。
- `apps/desktop/tsconfig.json`：include 加 `e2e-release`（03 的骨架此前不在类型检查范围内）。
- 新文件 `apps/desktop/src/renderer/features/settings/about-section.browser.test.tsx`、`stores/update-store.test.ts`（就近测试）。
- `docs/README.md`：当前行为导航只加 delivery.md 一行。

**新的读取根 / 注入点 / 外发通道**：不适用于新的读取根与模型注入点。新的输出通道是 main → renderer 的 `UpdateStatus.message`（`redactText` 脱敏，单元用例覆盖含 `sk-` 的说明）与 desktop.jsonl 的 `update status` / `test hooks ignored`（只含状态、版本与变量名）；不经过 Sidecar、不进 Session Entry 或模型请求，所以没有新增 `secrets-gate-<channel>` 用例。

**未验证（需真实凭据 / 外部条件）**：Developer ID 签名与公证；真实更新 feed 上的一次成功下载与 `quitAndInstall`（adhoc 签名下 Squirrel.Mac 只能验证到 error）；非 darwin 平台（E2E 以 `describe.skipIf` 跳过）。

**给 Lead 的合并事项**：docs/README.md 当前行为导航加了 delivery.md 一行；TECH_STACK 接入状态只在 apps/desktop 一行末尾追加"安装包切片"。
