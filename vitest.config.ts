import { defineConfig } from 'vitest/config'

// 每个 workspace 用自己的 vitest.config.ts / vitest.*.config.ts 声明测试项目；根配置只负责发现。
export default defineConfig({
  test: {
    projects: [
      'apps/*/vitest{,.*}.config.ts',
      'packages/*/vitest{,.*}.config.ts',
      {
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.test.ts'],
        },
      },
    ],
  },
})
