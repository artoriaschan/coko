// 本地执行端口的沙箱接缝：受限档位经宿主给出的 LocalSandbox 包裹命令；没有沙箱或无法启用时 fail-closed（命令不运行）。
// 这里用不依赖系统二进制的替身包裹器观察接缝；真实 Seatbelt 由 apps/server 的 seatbelt 适配器与 darwin 集成测试覆盖。
import { access } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { SandboxUnavailableError, type ExecRequest, type SandboxPolicy } from './exec.ts'
import { createLocalExecPort, type LocalSandbox } from './local-exec.ts'

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
