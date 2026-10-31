// 包入口经 package.json 的 exports 解析到源码。导入放在模块顶层：转译整个包的耗时属于测试文件的收集，不计入单个用例的超时
// （全量运行时各 worker 同时冷启动，用例内的动态导入曾超过 30 秒；单独运行约 1 秒）。
import * as entry from '@coko/agent'
import * as testing from '@coko/agent/testing'
import { describe, expect, it } from 'vitest'

describe('@coko/agent 包入口', () => {
  it('经包名的 exports 解析到源码入口', () => {
    expect(entry.createAgentRuntime).toBeTypeOf('function')
    expect(entry.createBuiltinToolRegistry).toBeTypeOf('function')
  })

  it('测试入口导出 grep 契约套件', () => {
    expect(testing.describeGrepContract).toBeTypeOf('function')
    expect(testing.createFauxModels).toBeTypeOf('function')
  })
})
