import { defineProject } from 'vitest/config'

// 评测（docs/subsystems/tracing.md#评测）：每个用例启动真实 Sidecar（与 integration 相同的 harness），按文件结果判定并写报告。
// 只收本目录的测试文件：cases/*/workspace/ 是用例的初始文件，不是本项目的测试。pnpm run eval 只运行本项目。
export default defineProject({
  test: {
    name: 'evals',
    environment: 'node',
    include: ['*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
