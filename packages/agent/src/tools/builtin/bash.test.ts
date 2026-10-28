import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ExecPort, ExecRequest } from '../../ports/exec.ts'
import { SandboxUnavailableError } from '../../ports/exec.ts'
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

  it('命令环境去掉宿主专用变量与宿主声明剔除的变量，其余保留', async () => {
    const exec = createLocalExecPort({
      env: { PATH: process.env.PATH, HOME: '/home/u', ELECTRON_RUN_AS_NODE: '1', HOST_SECRET: 's', HOST_CONFIG: 'c', KEEP: 'k' },
      excludeEnv: ['HOST_CONFIG', /SECRET/],
    })
    const result = await createBashTool({ cwd: ws.dir, exec, tempDir: ws.dir }).execute('c', { command: 'env | sort' })
    const names = textOf(result)
      .split('\n')
      .map((line) => line.split('=')[0])
      .filter((name) => name && !['PWD', 'SHLVL', '_', '__CF_USER_TEXT_ENCODING', 'OLDPWD'].includes(name))
    expect(names).toEqual(['HOME', 'KEEP', 'PATH'])
  })

  it('执行上下文的沙箱策略交给执行端口；被拒绝时结果追加拒绝标记与提权提示（在退出码之前）', async () => {
    const seen: (ExecRequest['sandbox'] | undefined)[] = []
    const exec: ExecPort = {
      async exec(request) {
        seen.push(request.sandbox)
        request.onData(Buffer.from('bash: /x/f: Operation not permitted\n'))
        return { kind: 'exited', exitCode: 1, sandboxDenied: true }
      },
    }
    const sandbox = { mode: 'workspace-write' as const, writableRoots: [ws.dir] }
    const result = await createBashTool({ cwd: ws.dir, exec, tempDir: ws.dir }).execute('c', { command: 'echo x > /x/f' }, undefined, undefined, {
      idempotencyKey: 's:c',
      sandbox,
    })
    expect(seen).toEqual([sandbox])
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      'bash: /x/f: Operation not permitted\n\n\n[sandbox: file access denied under workspace-write mode]\n' +
        '[sandbox: escalation available — retry this exact command once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]\n' +
        'Command exited with code 1',
    )
    expect(result.details).toEqual({ sandbox: { mode: 'workspace-write', denied: true } })
  })

  it('沙箱不可用 → sandbox-unavailable 错误，说明命令未运行', async () => {
    const exec: ExecPort = {
      exec: async (request) => {
        throw new SandboxUnavailableError(request.sandbox!.mode, 'sandbox-exec missing')
      },
    }
    const pending = createBashTool({ cwd: ws.dir, exec, tempDir: ws.dir }).execute('c', { command: 'true' }, undefined, undefined, {
      idempotencyKey: 's:c',
      sandbox: { mode: 'read-only', writableRoots: [] },
    })
    await expect(pending).rejects.toThrow(/^sandbox-unavailable: the command was not run because the read-only sandbox is not available/)
  })

  it('参数契约：sandbox_permissions 只取更宽的两档，justification 为字符串；permissionSubject 与 sandboxRequest', () => {
    const bash = tool()
    const properties = (bash.parameters as { properties: Record<string, { anyOf?: { const: string }[] }> }).properties
    expect(properties.sandbox_permissions?.anyOf?.map((s) => s.const)).toEqual(['workspace-write', 'danger-full-access'])
    expect(properties.justification).toMatchObject({ type: 'string' })
    expect(bash.description).toContain('[sandbox: file access denied under <mode> mode]')
    expect(bash.sandboxRequest?.({ command: 'ls' })).toBeUndefined()
    expect(bash.sandboxRequest?.({ command: 'ls', sandbox_permissions: 'danger-full-access', justification: 'why' })).toEqual({
      mode: 'danger-full-access',
      justification: 'why',
    })
    expect(bash.sandboxRequest?.({ command: 'ls', justification: 'why' })).toEqual({ justification: 'why' })
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
