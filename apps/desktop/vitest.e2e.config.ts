import { defineProject } from 'vitest/config'

// Playwright 驱动真实 Electron；globalSetup 先构建 main / preload / renderer 产物，测试只读取本次构建。
export default defineProject({
  test: {
    name: 'desktop-e2e',
    environment: 'node',
    include: ['e2e/**/*.e2e.test.ts'],
    globalSetup: ['e2e/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // 每个用例启动一个 Electron 窗口；限制同时运行的文件数，资源各自隔离。
    fileParallelism: false,
  },
})
