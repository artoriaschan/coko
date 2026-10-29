# 12: 桌面 E2E 后台运行，不抢焦点

**What to build:** 用户反馈：跑 desktop E2E 时 Electron 窗口不断弹出、抢走焦点。新增只在未打包或测试构建中生效的开关 `COKO_E2E_BACKGROUND=1`（E2E harness 与 package-smoke 默认设置；`COKO_E2E_VISIBLE=1` 在本地调试时关闭后台模式），发布构建与其他测试钩子一样忽略它。后台模式下 macOS 用 `app.setActivationPolicy('accessory')`，不显示 Dock 图标、不激活应用；主窗口不调用 `show()` / `focus()`，改为 `showInactive()` + `setOpacity(0)`；第二实例激活路径同样不 focus。依赖真实窗口焦点的用例在页面内聚焦解决，不放宽断言。写采样脚本证明全量 desktop E2E 期间本仓库的 Electron / Coko 从未成为前台应用。

**User stories:** 无（开发体验修复）

**Blocked by:** None

**Status:** ready-for-agent

**Write scope:** `apps/desktop/src/main/e2e-background.ts`（新）、`e2e-background.test.ts`（新）、`apps/desktop/src/main/window.ts`、`apps/desktop/src/main/index.ts`、`apps/desktop/e2e/harness.ts`、`apps/desktop/e2e/package-smoke.e2e.test.ts`、`apps/desktop/e2e/background.e2e.test.ts`（新）、`apps/desktop/e2e/foreground-watch.ts`（新）、`docs/tech-stack/testing.md`、本票

- [ ] 开关只在未打包或测试构建中生效，发布构建忽略；单元测试覆盖
- [ ] 后台模式：accessory、不激活、showInactive + opacity 0，第二实例不 focus；E2E 断言窗口状态与 renderer 不节流
- [ ] 依赖焦点的用例逐个列出并保持原断言通过
- [ ] 全量 desktop E2E（含 package-smoke）期间每 500ms 采样前台应用，本仓库的 Electron / Coko 从未成为前台
- [ ] testing.md "运行与编排"补后台运行约定与调试开关；`pnpm run check:docs` 通过
- [ ] git merge main 后全量 `pnpm run test` 退出码 0

## Comments
