import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ExecPort, ExecRequest } from '../../ports/exec.ts'
import { SandboxUnavailableError } from '../../ports/exec.ts'
import { createLocalExecPort } from '../../ports/local-exec.ts'
import { isProcessAlive, readPids, waitFor } from '../../testing/process.ts'
import { createTempWorkspace, type TempWorkspace } from '../../testing/workspace.ts'
import type { BackgroundJobLauncher } from '../../tasks/jobs/tools.ts'
import { createBashTool, type BashExecutionContext } from './bash.ts'

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

describe('bash run_in_background', () => {
  let ws: TempWorkspace
  beforeEach(async () => {
    ws = await createTempWorkspace('coko-bash-bg-')
  })
  afterEach(async () => {
    await ws.dispose()
  })

  it('经宿主的后台任务入口启动（同一执行端口与沙箱档位），立即返回 jobId', async () => {
    const seen: { toolCallId: string; command: string; cwd: string; sandbox?: unknown }[] = []
    const jobs: BackgroundJobLauncher = {
      async start(request) {
        seen.push({ toolCallId: request.toolCallId, command: request.command, cwd: request.cwd, sandbox: request.sandbox })
        const proc = await request.spawn({ command: request.command, cwd: request.cwd, onData: () => undefined })
        await proc.exited
        return { jobId: 'j7', label: 'sleep 0' }
      },
    }
    const sandbox = { mode: 'danger-full-access' as const, writableRoots: [] }
    const result = await createBashTool({ cwd: ws.dir, exec: createLocalExecPort() }).execute(
      'c9',
      { command: 'sleep 0', run_in_background: true },
      undefined,
      undefined,
      {
        idempotencyKey: 's:c9',
        sandbox,
        jobs,
      } as BashExecutionContext,
    )
    expect(textOf(result)).toBe('Started background job j7: sleep 0. Read output with job_output.')
    expect(seen).toEqual([{ toolCallId: 'c9', command: 'sleep 0', cwd: ws.dir, sandbox }])
  })

  it.each([
    { name: 'tty 而不后台：参数错误，不启动', args: { command: 'python3 -i', tty: true }, error: 'tty requires run_in_background: true' },
    {
      name: 'tty 且 run_in_background: false：参数错误',
      args: { command: 'python3 -i', tty: true, run_in_background: false },
      error: 'tty requires run_in_background',
    },
  ])('$name', async ({ args, error }) => {
    const started: unknown[] = []
    const jobs: BackgroundJobLauncher = { start: async (request) => (started.push(request), { jobId: 'j', label: 'x' }) }
    const pending = createBashTool({ cwd: ws.dir, exec: createLocalExecPort() }).execute('c', args, undefined, undefined, {
      idempotencyKey: 's:c',
      jobs,
    } as BashExecutionContext)
    await expect(pending).rejects.toThrow(error)
    expect(started).toEqual([])
  })

  it('tty 后台：请求带 tty 交给宿主；宿主没有 PTY 时 pty-unavailable 错误，说明命令未运行', async () => {
    const seen: (boolean | undefined)[] = []
    const jobs: BackgroundJobLauncher = {
      async start(request) {
        seen.push(request.tty)
        await request.spawn({ command: request.command, cwd: request.cwd, tty: request.tty, onData: () => undefined })
        return { jobId: 'j1', label: 'python3 -i' }
      },
    }
    const pending = createBashTool({ cwd: ws.dir, exec: createLocalExecPort() }).execute(
      'c',
      { command: 'python3 -i', tty: true, run_in_background: true },
      undefined,
      undefined,
      { idempotencyKey: 's:c', jobs } as BashExecutionContext,
    )
    await expect(pending).rejects.toThrow(/^pty-unavailable: the command was not run because no pseudo terminal is available on this host/)
    expect(seen).toEqual([true])
  })

  it('宿主没有后台任务或执行端口不能 spawn：错误结果', async () => {
    const tool = createBashTool({ cwd: ws.dir, exec: { exec: createLocalExecPort().exec } })
    await expect(tool.execute('c', { command: 'true', run_in_background: true })).rejects.toThrow('Background jobs are not available')
  })
})
