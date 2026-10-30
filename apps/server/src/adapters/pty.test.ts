// node-pty 适配器（PtyPort）：真实 PTY 中读到输出、写入的输入被程序读到、kill 向进程组发信号（派生的子进程一起结束）、信号退出带信号号。
// 只在 darwin 运行：其他平台的预编译产物与进程组行为未验证。Electron 内置 Node 中的加载见 pty-runtime.test.ts。
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { PtyExit, PtyProcess } from '@coko/agent'
import { probeNodePty } from './pty.ts'

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function start(command: string) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'coko-pty-adapter-')))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  const probe = probeNodePty()
  if (!probe.available) throw new Error(probe.reason)
  const term: PtyProcess = await probe.port.spawn({
    argv: ['/bin/bash', '-c', command],
    cwd: dir,
    env: { PATH: process.env.PATH ?? '', TERM: 'xterm-256color' },
    cols: 120,
    rows: 30,
  })
  onTestFinished(() => {
    for (const target of [-term.pid, term.pid])
      try {
        process.kill(target, 'SIGKILL')
      } catch {
        // 已退出。
      }
  })
  let output = ''
  term.onData((chunk) => (output += chunk))
  const exited = new Promise<PtyExit>((resolve) => term.onExit(resolve))
  return { dir, term, exited, output: () => output }
}

describe.skipIf(process.platform !== 'darwin')('node-pty 适配器', () => {
  it('探测给出版本与路径', () => {
    const probe = probeNodePty()
    expect(probe).toMatchObject({ available: true, version: '1.2.0-beta.15' })
  })

  it('cwd、尺寸与 TERM 进入子进程；写入的输入被读到；退出码原样返回', async () => {
    const h = await start('echo "$(pwd -P) $(tput cols)x$(tput lines) $TERM"; read line; echo "got:$line"; exit 4')
    await expect.poll(h.output).toContain(`${h.dir} 120x30 xterm-256color`)
    h.term.write('hello\r')
    expect(await h.exited).toEqual({ exitCode: 4 })
    expect(h.output()).toContain('got:hello')
  })

  it('kill 向进程组发信号：后台子进程一起结束，退出带信号号', async () => {
    const h = await start('sleep 300 & echo $! > child.pid; echo "$$ $(ps -o pgid= -p $$)"; wait')
    let child = 0
    await expect.poll(async () => (child = Number((await readFile(join(h.dir, 'child.pid'), 'utf8').catch(() => '0')).trim()))).toBeGreaterThan(0)
    await expect.poll(() => /(\d+)\s+(\d+)/.test(h.output())).toBe(true)
    const [, pid, pgid] = /(\d+)\s+(\d+)/.exec(h.output())!
    expect(Number(pid)).toBe(h.term.pid)
    expect(Number(pgid)).toBe(h.term.pid)
    h.term.kill('SIGTERM')
    expect(await h.exited).toMatchObject({ signal: 15 })
    await expect.poll(() => alive(child)).toBe(false)
  })
})
