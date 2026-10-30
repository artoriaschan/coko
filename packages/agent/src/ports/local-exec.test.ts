// 本地执行端口的沙箱接缝：受限档位经宿主给出的 LocalSandbox 包裹命令；没有沙箱或无法启用时 fail-closed（命令不运行）。
// 这里用不依赖系统二进制的替身包裹器观察接缝；真实 Seatbelt 由 apps/server 的 seatbelt 适配器与 darwin 集成测试覆盖。
// 生命周期回调（ADR 0012）：spawn 成功后 onSpawn 报告 pid 与进程组，进程退出后 onExit；没有启动的命令两者都不调用。
import { access, readFile, symlink } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { SandboxUnavailableError, type ExecRequest, type SandboxPolicy, type SpawnedProcess } from './exec.ts'
import { createLocalExecPort, type LocalSandbox } from './local-exec.ts'
import { PTY_COLS, PTY_ROWS, PtyUnavailableError, type PtyExit, type PtyPort, type PtySpawnRequest } from './pty.ts'

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-exec-')
})
afterEach(async () => {
  await ws.dispose()
})

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )
const policy = (mode: SandboxPolicy['mode']): SandboxPolicy => ({ mode, writableRoots: mode === 'workspace-write' ? [ws.dir] : [] })

async function run(port: ReturnType<typeof createLocalExecPort>, command: string, sandbox?: SandboxPolicy) {
  let output = ''
  const request: ExecRequest = { command, cwd: ws.dir, onData: (chunk) => (output += chunk.toString()), ...(sandbox ? { sandbox } : {}) }
  const outcome = await port.exec(request)
  return { outcome, output }
}

/** 替身：前缀是一个先打印标记再 exec 原命令的 shell，记录收到的策略。 */
function fakeSandbox(seen: SandboxPolicy[] = []): LocalSandbox {
  return {
    denialSignature: 'operation not permitted',
    wrap: (p) => {
      seen.push(p)
      return ['/bin/sh', '-c', 'echo wrapped; exec "$@"', 'sh']
    },
  }
}

describe('本地执行的沙箱接缝', () => {
  it('受限档位经包裹器运行，包裹器收到该次策略', async () => {
    const seen: SandboxPolicy[] = []
    const { outcome, output } = await run(createLocalExecPort({ sandbox: fakeSandbox(seen) }), 'echo inner', policy('workspace-write'))
    expect(outcome).toEqual({ kind: 'exited', exitCode: 0 })
    expect(output).toBe('wrapped\ninner\n')
    expect(seen).toEqual([policy('workspace-write')])
  })

  it('非零退出且输出含拒绝签名（跨分块、大小写不敏感）→ sandboxDenied', async () => {
    const command = 'printf "bash: f: Operation not "; printf "permitted\\n" >&2; exit 1'
    const { outcome } = await run(createLocalExecPort({ sandbox: fakeSandbox() }), command, policy('read-only'))
    expect(outcome).toEqual({ kind: 'exited', exitCode: 1, sandboxDenied: true })
  })

  it('零退出或无签名不算拒绝；danger-full-access 与不带策略都不经包裹器', async () => {
    const seen: SandboxPolicy[] = []
    const port = createLocalExecPort({ sandbox: fakeSandbox(seen) })
    expect((await run(port, 'echo Operation not permitted', policy('workspace-write'))).outcome).toEqual({ kind: 'exited', exitCode: 0 })
    expect((await run(port, 'exit 2', policy('workspace-write'))).outcome).toEqual({ kind: 'exited', exitCode: 2 })
    expect(await run(port, 'echo Operation not permitted; exit 1', policy('danger-full-access'))).toEqual({
      outcome: { kind: 'exited', exitCode: 1 },
      output: 'Operation not permitted\n',
    })
    expect((await run(port, 'echo plain')).output).toBe('plain\n')
    expect(seen).toHaveLength(2)
  })

  it('没有沙箱时受限档位 fail-closed：SandboxUnavailableError，命令不运行', async () => {
    const marker = ws.path('ran')
    await expect(run(createLocalExecPort(), `touch ${marker}`, policy('workspace-write'))).rejects.toBeInstanceOf(SandboxUnavailableError)
    expect(await exists(marker)).toBe(false)
    // 不受限的请求照常运行。
    await run(createLocalExecPort(), `touch ${marker}`, policy('danger-full-access'))
    expect(await exists(marker)).toBe(true)
  })

  it('包裹器报告不可用或包裹的可执行文件不存在 → SandboxUnavailableError，命令不运行', async () => {
    const marker = ws.path('ran')
    const refusing: LocalSandbox = {
      denialSignature: 'x',
      wrap: (p) => {
        throw new SandboxUnavailableError(p.mode, 'probe failed')
      },
    }
    const missing: LocalSandbox = { denialSignature: 'x', wrap: () => [ws.path('no-such-sandbox-exec')] }
    for (const sandbox of [refusing, missing]) {
      const error = await run(createLocalExecPort({ sandbox }), `touch ${marker}`, policy('read-only')).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(SandboxUnavailableError)
      expect(error).toMatchObject({ code: 'sandbox-unavailable', mode: 'read-only' })
    }
    expect(await exists(marker)).toBe(false)
  })
})

describe('本地执行的生命周期回调', () => {
  it('spawn 后 onSpawn 报告 pid 与独立进程组（pgid = pid，与命令自身看到的一致），退出后 onExit，各一次', async () => {
    const events: string[] = []
    let spawned: SpawnedProcess | undefined
    let output = ''
    const outcome = await createLocalExecPort().exec({
      command: 'echo "$$ $(ps -o pgid= -p $$)"',
      cwd: ws.dir,
      onData: (chunk) => (output += chunk.toString()),
      onSpawn: (process) => {
        spawned = process
        events.push('spawn')
      },
      onExit: () => events.push('exit'),
    })
    expect(outcome).toEqual({ kind: 'exited', exitCode: 0 })
    expect(events).toEqual(['spawn', 'exit'])
    const [pid, pgid] = output.trim().split(/\s+/).map(Number)
    expect(spawned).toEqual({ pid, pgid })
    expect(pgid).toBe(pid)
  })

  it('中止与超时同样在 onSpawn 之后调用 onExit；回调抛错不影响命令结果', async () => {
    const events: string[] = []
    const controller = new AbortController()
    const aborted = await createLocalExecPort().exec({
      command: 'sleep 30',
      cwd: ws.dir,
      onData: () => undefined,
      signal: controller.signal,
      onSpawn: () => {
        events.push('spawn')
        controller.abort()
        throw new Error('host failed to record')
      },
      onExit: () => events.push('exit'),
    })
    expect(aborted).toEqual({ kind: 'aborted' })
    const timedOut = await createLocalExecPort().exec({
      command: 'sleep 30',
      cwd: ws.dir,
      onData: () => undefined,
      timeoutMs: 50,
      onSpawn: () => events.push('spawn'),
      onExit: () => {
        events.push('exit')
        throw new Error('host failed to remove')
      },
    })
    expect(timedOut).toEqual({ kind: 'timeout' })
    expect(events).toEqual(['spawn', 'exit', 'spawn', 'exit'])
  })

  it('没有启动的命令不调用回调：工作目录不存在、fail-closed、包裹的可执行文件不存在', async () => {
    const calls: string[] = []
    const hooks = { onSpawn: () => calls.push('spawn'), onExit: () => calls.push('exit') }
    const base = { command: 'true', onData: () => undefined, ...hooks }
    await expect(createLocalExecPort().exec({ ...base, cwd: ws.path('missing') })).rejects.toThrow(/Working directory/)
    await expect(createLocalExecPort().exec({ ...base, cwd: ws.dir, sandbox: policy('read-only') })).rejects.toBeInstanceOf(SandboxUnavailableError)
    const missing: LocalSandbox = { denialSignature: 'x', wrap: () => [ws.path('no-such-sandbox-exec')] }
    await expect(createLocalExecPort({ sandbox: missing }).exec({ ...base, cwd: ws.dir, sandbox: policy('read-only') })).rejects.toBeInstanceOf(
      SandboxUnavailableError,
    )
    await expect(createLocalExecPort({ shell: ws.path('no-such-shell') }).exec({ ...base, cwd: ws.dir })).rejects.toMatchObject({ code: 'ENOENT' })
    expect(calls).toEqual([])
  })
})

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('本地执行的后台命令（spawn）', () => {
  it('不等待退出即返回进程句柄，流式送出输出，退出后 exited 与 onExit', async () => {
    const port = createLocalExecPort()
    const chunks: string[] = []
    const events: string[] = []
    const proc = await port.spawn!({
      command: 'echo one; sleep 0.2; echo two',
      cwd: ws.dir,
      onData: (chunk) => chunks.push(chunk.toString()),
      onSpawn: (p) => events.push('spawn:' + (p.pgid === p.pid)),
      onExit: () => events.push('exit'),
    })
    expect(proc.pgid).toBe(proc.pid)
    expect(events).toEqual(['spawn:true'])
    expect(await proc.exited).toEqual({ exitCode: 0 })
    await new Promise((resolve) => setImmediate(resolve))
    expect(chunks.join('')).toBe('one\ntwo\n')
    expect(events).toEqual(['spawn:true', 'exit'])
  })

  it('kill 向进程组发信号：派生的子进程一起结束，退出码为 128 + 信号', async () => {
    const port = createLocalExecPort()
    const proc = await port.spawn!({ command: `sleep 30 & echo $! > ${ws.dir}/child.pid; wait`, cwd: ws.dir, onData: () => undefined })
    let child = 0
    await expect.poll(async () => (child = Number((await readFile(ws.dir + '/child.pid', 'utf8').catch(() => '0')).trim()))).toBeGreaterThan(0)
    proc.kill('SIGTERM')
    const exit = await proc.exited
    expect(exit.exitCode).toBe(143)
    await expect.poll(() => alive(child)).toBe(false)
  })

  it('没能启动时 reject：工作目录不存在、没有沙箱时的受限档位', async () => {
    const port = createLocalExecPort()
    await expect(port.spawn!({ command: 'true', cwd: ws.dir + '/missing', onData: () => undefined })).rejects.toThrow('Working directory does not exist')
    await expect(port.spawn!({ command: 'true', cwd: ws.dir, onData: () => undefined, sandbox: policy('read-only') })).rejects.toBeInstanceOf(
      SandboxUnavailableError,
    )
  })
})

/** 替身 PtyPort：记录 spawn 请求、写入与信号；由测试驱动输出与退出。 */
function fakePty() {
  const requests: PtySpawnRequest[] = []
  const writes: string[] = []
  const signals: (string | undefined)[] = []
  const data = new Set<(chunk: string) => void>()
  const exits = new Set<(exit: PtyExit) => void>()
  const port: PtyPort = {
    async spawn(request) {
      requests.push(request)
      return {
        pid: 4242,
        write: (text) => void writes.push(text),
        resize: () => undefined,
        kill: (signal) => void signals.push(signal),
        onData: (listener) => (data.add(listener), () => data.delete(listener)),
        onExit: (listener) => (exits.add(listener), () => exits.delete(listener)),
      }
    },
  }
  return {
    port,
    requests,
    writes,
    signals,
    emit: (chunk: string) => data.forEach((l) => l(chunk)),
    exit: (exit: PtyExit) => exits.forEach((l) => l(exit)),
  }
}

describe('本地执行的 PTY 命令（spawn tty）', () => {
  it('argv 为沙箱前缀 + shell -c 命令，cwd 为真实路径，120×30，环境经过滤；输出、写入、信号与退出经句柄', async () => {
    const pty = fakePty()
    const seen: SandboxPolicy[] = []
    const link = ws.path('link')
    await symlink(ws.dir, link)
    const port = createLocalExecPort({
      pty: pty.port,
      shell: '/bin/bash',
      sandbox: fakeSandbox(seen),
      env: { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1', HOST_SECRET: 's', KEEP: 'k' },
      excludeEnv: [/SECRET/],
    })
    const chunks: string[] = []
    const events: string[] = []
    const proc = await port.spawn!({
      command: 'python3 -i',
      cwd: link,
      tty: true,
      sandbox: policy('read-only'),
      onData: (chunk) => chunks.push(chunk.toString()),
      onSpawn: (p) => events.push(`spawn:${p.pid}:${p.pgid}`),
      onExit: () => events.push('exit'),
    })
    expect(pty.requests).toEqual([
      {
        argv: ['/bin/sh', '-c', 'echo wrapped; exec "$@"', 'sh', '/bin/bash', '-c', 'python3 -i'],
        cwd: ws.dir,
        env: { PATH: '/usr/bin', KEEP: 'k', TERM: 'xterm-256color' },
        cols: PTY_COLS,
        rows: PTY_ROWS,
      },
    ])
    expect([PTY_COLS, PTY_ROWS]).toEqual([120, 30])
    expect(seen).toEqual([policy('read-only')])
    expect(proc).toMatchObject({ pid: 4242, pgid: 4242 })
    expect(events).toEqual(['spawn:4242:4242'])
    pty.emit('>>> ')
    proc.write!('print(6*7)\r')
    proc.kill('SIGINT')
    pty.exit({ exitCode: 0, signal: 15 })
    expect(await proc.exited).toEqual({ exitCode: 143, signal: 'SIGTERM' })
    await new Promise((resolve) => setImmediate(resolve))
    expect(chunks).toEqual(['>>> '])
    expect(pty.writes).toEqual(['print(6*7)\r'])
    expect(pty.signals).toEqual(['SIGINT'])
    expect(events).toEqual(['spawn:4242:4242', 'exit'])
    // 退出后的信号被忽略。
    proc.kill('SIGKILL')
    expect(pty.signals).toEqual(['SIGINT'])
  })

  it('普通退出码原样返回；宿主给出 TERM 时保留', async () => {
    const pty = fakePty()
    const port = createLocalExecPort({ pty: pty.port, env: { TERM: 'dumb' } })
    const proc = await port.spawn!({ command: 'exit 3', cwd: ws.dir, tty: true, onData: () => undefined })
    expect(pty.requests[0]!.env).toEqual({ TERM: 'dumb' })
    pty.exit({ exitCode: 3 })
    expect(await proc.exited).toEqual({ exitCode: 3 })
  })

  it('没有 PtyPort：PtyUnavailableError（pty-unavailable），命令不运行；工作目录不存在与 fail-closed 同样 reject', async () => {
    const calls: string[] = []
    const base = { command: 'true', tty: true, onData: () => undefined, onSpawn: () => calls.push('spawn') }
    await expect(createLocalExecPort().spawn!({ ...base, cwd: ws.dir })).rejects.toMatchObject({ code: 'pty-unavailable' })
    await expect(createLocalExecPort().spawn!({ ...base, cwd: ws.dir })).rejects.toBeInstanceOf(PtyUnavailableError)
    const pty = fakePty()
    await expect(createLocalExecPort({ pty: pty.port }).spawn!({ ...base, cwd: ws.path('missing') })).rejects.toThrow('Working directory does not exist')
    await expect(createLocalExecPort({ pty: pty.port }).spawn!({ ...base, cwd: ws.dir, sandbox: policy('read-only') })).rejects.toBeInstanceOf(
      SandboxUnavailableError,
    )
    expect(pty.requests).toEqual([])
    expect(calls).toEqual([])
  })

  it('非 PTY 的后台命令没有 write（stdin 关闭）', async () => {
    const proc = await createLocalExecPort().spawn!({ command: 'true', cwd: ws.dir, onData: () => undefined })
    expect(proc.write).toBeUndefined()
    await proc.exited
  })
})
