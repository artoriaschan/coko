// node-pty 在产品运行时（Electron 内置 Node，ELECTRON_RUN_AS_NODE=1）中可加载并能启动 PTY 子进程：读到输出、写入输入、得到退出码；
// 预编译的 spawn-helper 有可执行位（npm 包丢失该位时由根 postinstall 恢复）。只在 darwin 运行：其他平台的预编译产物与 spawn-helper 不同。
import { spawn } from 'node:child_process'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'

const require = createRequire(import.meta.url)
const electronPath = require('electron') as string
const ptyRoot = dirname(require.resolve('node-pty/package.json'))

const PROBE = `
const pty = require(process.argv[2])
const [file, ...args] = JSON.parse(process.argv[3])
const p = pty.spawn(file, args, { cwd: process.cwd(), env: { PATH: process.env.PATH }, cols: 120, rows: 30 })
let out = ''
p.onData((d) => (out += d))
if (process.argv[4]) p.write(process.argv[4])
p.onExit((e) => process.stdout.write(JSON.stringify({ out, exitCode: e.exitCode, pid: p.pid, electron: process.versions.electron })))
`

async function runProbe(argv: string[], input?: string): Promise<{ out: string; exitCode: number; pid: number; electron: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'coko-pty-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  const script = join(dir, 'probe.cjs')
  await writeFile(script, PROBE)
  const child = spawn(electronPath, [script, ptyRoot, JSON.stringify(argv), ...(input === undefined ? [] : [input])], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? '', ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  onTestFinished(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  const code = await new Promise<number | null>((resolve) => child.once('exit', resolve))
  if (code !== 0) throw new Error(`probe exited with ${String(code)}: ${stderr}`)
  return JSON.parse(stdout)
}

describe.skipIf(process.platform !== 'darwin')('node-pty 在 Electron 内置 Node 中', () => {
  it('版本为 1.2.0-beta.15，预编译的 spawn-helper 可执行', async () => {
    const helper = join(ptyRoot, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper')
    expect((await stat(helper)).mode & 0o111).not.toBe(0)
    expect((require('node-pty/package.json') as { version: string }).version).toBe('1.2.0-beta.15')
  })

  it('ELECTRON_RUN_AS_NODE=1 下加载 node-pty 并 spawn /bin/echo ok：读到 ok，退出码 0', async () => {
    const result = await runProbe(['/bin/echo', 'ok'])
    expect(result.electron).toBe('41.0.3')
    expect(result.out.trim()).toBe('ok')
    expect(result.exitCode).toBe(0)
    expect(result.pid).toBeGreaterThan(0)
  })

  it('写入的输入被程序读到，非零退出码原样返回', async () => {
    const result = await runProbe(['/bin/sh', '-c', 'read line; echo "got:$line"; exit 3'], 'hello\r')
    expect(result.out).toContain('got:hello')
    expect(result.exitCode).toBe(3)
  })
})
