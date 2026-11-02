// Seatbelt 适配器：profile 文本（与规格一致）、启动探测、真实 sandbox-exec 下的拒绝判定。
// 真实 sandbox-exec 的用例只在 darwin 运行；其他平台没有 sandbox-exec，显式跳过（探测失败的路径另有平台无关用例）。
import { access, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalExecPort, PROTECTED_PATH_NAMES } from '@coko/agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { probeSeatbelt, seatbeltProfile, createSeatbeltSandbox } from './seatbelt.ts'

const darwin = process.platform === 'darwin'
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

describe('Seatbelt profile', () => {
  it('拒绝全部写入，放行 /dev/null 与可写根（字符串按 SBPL 转义）', () => {
    expect(seatbeltProfile({ mode: 'read-only', writableRoots: [] })).toBe(
      '(version 1) (allow default) (deny file-write*) (allow file-write* (literal "/dev/null"))',
    )
    expect(seatbeltProfile({ mode: 'workspace-write', writableRoots: ['/w/a "b"', '/private/tmp'] })).toBe(
      '(version 1) (allow default) (deny file-write*) (allow file-write* (literal "/dev/null")) (allow file-write* (subpath "/w/a \\"b\\"") (subpath "/private/tmp"))',
    )
  })
})

describe('受保护路径', () => {
  it('可写根之后对任意深度的受保护名字追加 deny（不区分大小写，不插入根路径）', () => {
    const profile = seatbeltProfile({ mode: 'workspace-write', writableRoots: ['/w/a.b'], protectedNames: ['.git'] })
    expect(profile).toBe(
      '(version 1) (allow default) (deny file-write*) (allow file-write* (literal "/dev/null")) (allow file-write* (subpath "/w/a.b")) (deny file-write* (regex #"^/(.*/)?([.][gG][iI][tT])(/|$)"))',
    )
  })

  it('受保护名字的集合与权限判定相同（含 .git、.coko、.ssh）', () => {
    expect(PROTECTED_PATH_NAMES).toEqual(expect.arrayContaining(['.git', '.coko', '.vscode', '.idea', '.ssh', '.bashrc', '.zshrc', '.mcp.json']))
  })
})

describe('启动探测', () => {
  it('可执行文件不存在 → 不可用并给出原因', async () => {
    expect(await probeSeatbelt('/nonexistent/sandbox-exec')).toEqual({
      available: false,
      executable: '/nonexistent/sandbox-exec',
      reason: expect.stringMatching(/ENOENT|not found|no such file/i),
    })
  })

  it.skipIf(!darwin)('darwin：系统 sandbox-exec 可用（非 darwin 无 sandbox-exec，跳过）', async () => {
    expect(await probeSeatbelt()).toEqual({ available: true })
  })
})

describe.skipIf(!darwin)('真实 sandbox-exec（只在 darwin 运行：其他平台没有 Seatbelt）', () => {
  let workspace: string
  let outside: string
  beforeEach(async () => {
    workspace = await realpath(await mkdtemp(join(tmpdir(), 'coko-sb-ws-')))
    outside = await realpath(await mkdtemp(join(tmpdir(), 'coko-sb-out-')))
  })
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  const run = async (command: string, mode: 'read-only' | 'workspace-write') => {
    const port = createLocalExecPort({ sandbox: createSeatbeltSandbox(await probeSeatbelt()) })
    let output = ''
    const outcome = await port.exec({
      command,
      cwd: workspace,
      onData: (c) => (output += c.toString()),
      sandbox: { mode, writableRoots: mode === 'read-only' ? [] : [workspace], protectedNames: PROTECTED_PATH_NAMES },
    })
    return { outcome, output }
  }

  it('workspace-write：可写根内写入成功，之外被拒绝（sandboxDenied、文件不存在）', async () => {
    expect((await run('echo in > in.txt', 'workspace-write')).outcome).toEqual({ kind: 'exited', exitCode: 0 })
    expect(await readFile(join(workspace, 'in.txt'), 'utf8')).toBe('in\n')
    const denied = await run(`echo x > ${outside}/f`, 'workspace-write')
    expect(denied.outcome).toEqual({ kind: 'exited', exitCode: 1, sandboxDenied: true })
    expect(denied.output).toMatch(/operation not permitted/i)
    expect(await exists(join(outside, 'f'))).toBe(false)
  })

  it('workspace-write：可写根内的 .git、.coko（含大小写变体与子目录中的）被拒绝，普通文件照常写入', async () => {
    await mkdir(join(workspace, '.git', 'hooks'), { recursive: true })
    await mkdir(join(workspace, 'sub', '.GIT'), { recursive: true })
    for (const command of ['echo x > .git/hooks/pre-commit', 'echo x > sub/.GIT/config', 'mkdir .coko', 'echo x > .zshrc']) {
      expect({ command, outcome: (await run(command, 'workspace-write')).outcome }).toEqual({
        command,
        outcome: { kind: 'exited', exitCode: 1, sandboxDenied: true },
      })
    }
    expect(await exists(join(workspace, '.git', 'hooks', 'pre-commit'))).toBe(false)
    expect(await exists(join(workspace, '.coko'))).toBe(false)
    expect((await run('echo ok > .gitignore && mkdir -p src/git && echo ok > src/git/x', 'workspace-write')).outcome).toEqual({ kind: 'exited', exitCode: 0 })
  })

  it.each(['quote"', 'back\\slash', 'close]', 'caret^'])('特殊字符附加根 %s：普通写入成功，受保护文件保持不变', async (name) => {
    const extra = join(workspace, name)
    await mkdir(join(extra, '.git'), { recursive: true })
    const port = createLocalExecPort({ sandbox: createSeatbeltSandbox(await probeSeatbelt()) })
    const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'"
    const policy = { mode: 'workspace-write' as const, writableRoots: [extra], protectedNames: PROTECTED_PATH_NAMES }
    expect(await port.exec({ command: `printf ok > ${quote(join(extra, 'ok'))}`, cwd: workspace, onData() {}, sandbox: policy })).toEqual({
      kind: 'exited',
      exitCode: 0,
    })
    expect(await readFile(join(extra, 'ok'), 'utf8')).toBe('ok')
    expect(await port.exec({ command: `printf bad > ${quote(join(extra, '.git', 'config'))}`, cwd: workspace, onData() {}, sandbox: policy })).toEqual({
      kind: 'exited',
      exitCode: 1,
      sandboxDenied: true,
    })
    expect(await exists(join(extra, '.git', 'config'))).toBe(false)
  })

  it('read-only：Workspace 内也不能写；/dev/null 可写', async () => {
    expect((await run('echo ok > /dev/null', 'read-only')).outcome).toEqual({ kind: 'exited', exitCode: 0 })
    expect((await run('echo x > in.txt', 'read-only')).outcome).toEqual({ kind: 'exited', exitCode: 1, sandboxDenied: true })
    expect(await exists(join(workspace, 'in.txt'))).toBe(false)
  })
})
