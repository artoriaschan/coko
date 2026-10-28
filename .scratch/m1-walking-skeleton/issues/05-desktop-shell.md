# 05: 桌面壳：窗口、Sidecar 生命周期与协议代理

**What to build:** apps/desktop main / preload：单实例锁、macOS 窗口参数、spawn Sidecar（可用占位 Sidecar 或 04 的产物）、ready / fatal 处理、inspect-quit 与分级退出、`coko-app://` 代理与 cookie 注入、WebSocket 头注入、boot IPC、目录选择；Forge 配置、tsdown（main / preload / sidecar）与 Vite renderer 接线，renderer 显示连接状态页。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `pnpm --filter desktop start` 启动窗口并显示 Sidecar 已连接（清除 ELECTRON_RUN_AS_NODE）
- [ ] Playwright Electron E2E：窗口加载 coko-app://，renderer 能经代理请求 health 并建立 WebSocket
- [ ] renderer 无法读到令牌或 cookie；非主窗口来源的 WebSocket 升级被取消
- [ ] 退出后 Sidecar 进程不存在；Sidecar 启动失败时显示错误对话框

## Comments
