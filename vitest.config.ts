import { defineConfig } from 'vitest/config'
import { withoutGitWrappers } from './scripts/test-path.ts'

// worker 启动前去掉 git 包装目录（见 scripts/test-path.ts），测试中的 git 不再为每个临时 HOME 留下后台进程。
process.env.PATH = withoutGitWrappers(process.env.PATH)

// 每个 workspace 用自己的 vitest.config.ts / vitest.*.config.ts 声明测试项目；根配置只负责发现。
export default defineConfig({
  test: {
    projects: [
      'apps/*/vitest{,.*}.config.ts',
      'packages/*/vitest{,.*}.config.ts',
      'tests/integration/vitest.config.ts',
      'tests/evals/vitest.config.ts',
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
