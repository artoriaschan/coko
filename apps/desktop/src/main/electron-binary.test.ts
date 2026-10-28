import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)
// electron 包在 Node 中导出可执行文件路径。
const electronPath = createRequire(import.meta.url)('electron') as string

describe('Electron 二进制', () => {
  it('以 ELECTRON_RUN_AS_NODE 运行并报告锁定的 Electron 与内置 Node 版本', async () => {
    const { stdout } = await run(electronPath, ['-e', 'console.log(JSON.stringify(process.versions))'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeout: 30_000,
    })
    const versions = JSON.parse(stdout) as Record<string, string>
    expect(versions.electron).toBe('41.0.3')
    expect(versions.node).toBe('24.14.0')
  })
})
