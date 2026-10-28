import { defineProject } from 'vitest/config'

// 跨应用集成测试：以 ELECTRON_RUN_AS_NODE=1 启动真实 Sidecar（见 docs/tech-stack/testing.md）。
export default defineProject({
  test: {
    name: 'integration',
    environment: 'node',
    include: ['**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
