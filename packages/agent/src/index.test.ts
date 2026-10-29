import { describe, expect, it } from 'vitest'

describe('@coko/agent 包入口', () => {
  // 冷启动时按需转译整个包入口；全量并行运行时可能超过默认的 5 秒。
  it('经包名的 exports 解析到源码入口', { timeout: 30_000 }, async () => {
    const entry = await import('@coko/agent')
    expect(entry.createAgentRuntime).toBeTypeOf('function')
    expect(entry.createBuiltinToolRegistry).toBeTypeOf('function')
  })

  it('测试入口导出 grep 契约套件', async () => {
    const testing = await import('@coko/agent/testing')
    expect(testing.describeGrepContract).toBeTypeOf('function')
    expect(testing.createFauxModels).toBeTypeOf('function')
  })
})
