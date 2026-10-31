import { defineProject } from 'vitest/config'

// 发布构建（不带 COKO_TEST_BUILD）的端到端验证：只在 COKO_RELEASE_E2E=1 时选中用例。发布构建忽略 COKO_E2E_BACKGROUND，窗口会出现，
// 而且要再打一次包，所以默认的 pnpm run test 中本项目选中 0 个文件、不打包。
const enabled = process.env.COKO_RELEASE_E2E === '1'

export default defineProject({
  test: {
    name: 'desktop-release',
    environment: 'node',
    include: enabled ? ['e2e-release/**/*.e2e.test.ts'] : [],
    ...(enabled ? { globalSetup: ['e2e-release/global-setup.ts'] } : {}),
    testTimeout: 120_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
})
