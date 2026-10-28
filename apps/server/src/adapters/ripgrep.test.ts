import { rgPath } from '@vscode/ripgrep'
import { describe, expect, it } from 'vitest'
import { createGrepTool } from '@coko/agent'
import { describeGrepContract } from '@coko/agent/testing'
import { createRipgrepSearcher } from './ripgrep.ts'

// apps/server 只在测试中使用 @vscode/ripgrep 解析二进制；运行时路径由 desktop main 经 --ripgrep 传入。
describeGrepContract({ name: 'ripgrep', createTool: (cwd) => createGrepTool({ cwd, searcher: createRipgrepSearcher(rgPath) }) })

describe('ripgrep searcher', () => {
  it('二进制不存在时报错', async () => {
    const searcher = createRipgrepSearcher('/nonexistent/rg')
    await expect(searcher({ pattern: 'x', searchPath: process.cwd(), isDirectory: true, ignoreCase: false, literal: false, limit: 1 })).rejects.toBeInstanceOf(
      Error,
    )
  })
})
