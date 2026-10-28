import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalExecPort } from '../../ports/local-exec.ts'
import { isProcessAlive, readPids, waitFor } from '../../testing/process.ts'
import { createTempWorkspace, type TempWorkspace } from '../../testing/workspace.ts'
import { createBashTool } from './bash.ts'

const textOf = (result: { content: { type: string; text?: string }[] }) => result.content.map((block) => block.text ?? '').join('')

describe('内置 bash', () => {
  let ws: TempWorkspace
  beforeEach(async () => {
    ws = await createTempWorkspace('coko-bash-')
  })
  afterEach(async () => {
    await ws.dispose()
  })

  const tool = () => createBashTool({ cwd: ws.dir, exec: createLocalExecPort(), tempDir: ws.dir })

  it('在 Workspace 中执行并返回输出与结构化结果', async () => {
    const result = await tool().execute('c', { command: 'pwd; echo out; echo err 1>&2' })
    expect(textOf(result)).toBe(`${ws.dir}\nout\nerr\n`)
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toMatchObject({ exit_code: 0, truncated: false, output: `${ws.dir}\nout\nerr\n` })
  })

  it('非零退出码为错误结果', async () => {
    const result = await tool().execute('c', { command: 'echo nope; exit 3' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('nope\n\n\nCommand exited with code 3')
    expect(result.structuredContent).toMatchObject({ exit_code: 3 })
  })

  it('输出保留末尾 2000 行，完整输出写入临时文件', async () => {
    const result = await tool().execute('c', { command: 'seq 1 2500' })
    const text = textOf(result)
    expect(text.startsWith('501\n')).toBe(true)
    expect(text).toContain('[Showing lines 501-2500 of 2500. Full output: ')
    const fullPath = (result.details as { fullOutputPath: string }).fullOutputPath
    expect((await readFile(fullPath, 'utf-8')).split('\n')).toHaveLength(2501)
  })

  it('timeout 参数到期后结束进程并报错', async () => {
    await expect(tool().execute('c', { command: 'sleep 5', timeout: 0.2 })).rejects.toThrow('Command timed out after 0.2 seconds')
  })

  it('取消后命令及其子进程都已退出', async () => {
    const pidFile = ws.path('pids')
    const controller = new AbortController()
    const pending = tool().execute('c', { command: `sleep 30 & echo "$$ $!" > ${pidFile}; wait` }, controller.signal)
    expect(await waitFor(async () => (await readPids(pidFile)).length === 2)).toBe(true)
    const pids = await readPids(pidFile)
    controller.abort()
    await expect(pending).rejects.toThrow('Command aborted')
    expect(isProcessAlive(pids[0] as number)).toBe(false)
    expect(await waitFor(() => !isProcessAlive(pids[1] as number), 2_000)).toBe(true)
  })
})
