// 语言服务器客户端：真实子进程（仓库内的 LSP 假服务器与按用例写出的脚本服务器）。Content-Length 分帧（分包、粘包、非法头）、initialize、请求超时、
// 服务器发来的请求得到空结果、服务器退出时挂起的请求失败与关闭序列。
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createLspClient, LspClientError, type LspClient, type LspClientOptions } from './lsp-client.ts'

const fixture = fileURLToPath(new URL('../../../../tests/fixtures/lsp/server.mjs', import.meta.url))
const hostEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' }
// 真实子进程：启动、关闭与超时各数百毫秒，全量负载下默认 5 秒不够。预算只限制等待上限。
const REAL_PROCESS_BUDGET = { timeout: 20_000 }

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'coko-lsp-client-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function open(options: Partial<LspClientOptions> & Pick<LspClientOptions, 'args' | 'cwd'>): Promise<LspClient> {
  const client = await createLspClient({ command: process.execPath, hostEnv, graceMs: 500, ...options })
  onTestFinished(() => client.close())
  return client
}

const records = async (file: string) =>
  (await readFile(file, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown })

/**
 * 脚本服务器：initialize 正常回答；hover 的回答按字节分包写出，并在同一块中粘着一条通知、前面先写一帧非法头；definition 不回答（超时）；
 * references 时先向客户端发 workspace/configuration 请求，收到回答后把它写进记录再回答；exit-now 通知使进程立即退出；忽略 shutdown 与 SIGTERM 的
 * 模式由 --stubborn 打开。
 */
const SCRIPT = `
import { appendFileSync } from 'node:fs'
const record = process.argv[2]
const stubborn = process.argv.includes('--stubborn')
if (stubborn) process.on('SIGTERM', () => {})
const frame = (m) => { const b = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...m })); return Buffer.concat([Buffer.from('Content-Length: ' + b.length + '\\r\\n\\r\\n'), b]) }
let buffer = Buffer.alloc(0)
let pendingRefs
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const end = buffer.indexOf('\\r\\n\\r\\n'); if (end < 0) return
    const length = Number(/Content-Length: *(\\d+)/i.exec(buffer.subarray(0, end).toString())[1])
    if (buffer.length < end + 4 + length) return
    const m = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString()); buffer = buffer.subarray(end + 4 + length)
    appendFileSync(record, JSON.stringify(m) + '\\n')
    if (m.method === 'initialize') process.stdout.write(frame({ id: m.id, result: { capabilities: { hoverProvider: true } } }))
    else if (m.method === 'textDocument/hover') {
      const bytes = Buffer.concat([Buffer.from('Content-Length: x\\r\\n\\r\\n'), frame({ id: m.id, result: { contents: '中文😀' } }), frame({ method: 'window/logMessage', params: { type: 3, message: 'hi' } })])
      let i = 0
      const tick = () => { if (i >= bytes.length) return; process.stdout.write(bytes.subarray(i, i + 7)); i += 7; setTimeout(tick, 1) }
      tick()
    } else if (m.method === 'textDocument/references') { pendingRefs = m.id; process.stdout.write(frame({ id: 'srv-1', method: 'workspace/configuration', params: { items: [{ section: 'a' }, { section: 'b' }] } })) }
    else if (m.id === 'srv-1') process.stdout.write(frame({ id: pendingRefs, result: [] }))
    else if (m.method === 'exit-now') process.exit(3)
    else if (m.method === 'shutdown' && !stubborn) process.stdout.write(frame({ id: m.id, result: null }))
    else if (m.method === 'exit' && !stubborn) process.exit(0)
  }
})
setInterval(() => {}, 1000)
`

async function scripted(dir: string, extra: string[] = []) {
  const script = join(dir, 'server.mjs')
  await writeFile(script, SCRIPT)
  const record = join(dir, 'record.jsonl')
  await writeFile(record, '')
  return { args: [script, record, ...extra], record }
}

describe('createLspClient', REAL_PROCESS_BUDGET, () => {
  it('initialize 的 rootUri 为工作目录，随后 initialized；capabilities 来自回答；登记进程，退出后释放', async () => {
    const cwd = await tempDir()
    const record = join(cwd, 'rec.jsonl')
    const tracked: { pid: number; pgid?: number }[] = []
    let released = 0
    const client = await open({ cwd, args: [fixture, '--record', record], onProcess: (p) => (tracked.push(p), () => void released++) })
    expect(client.capabilities).toMatchObject({ hoverProvider: true, definitionProvider: true })
    await client.close()
    const messages = await records(record)
    expect(messages.map((m) => m.method)).toEqual(['initialize', 'initialized', 'shutdown', 'exit'])
    expect(messages[0]!.params).toMatchObject({
      rootUri: pathToFileURL(cwd).href,
      capabilities: { textDocument: { hover: {}, definition: {}, references: {} } },
    })
    expect(tracked).toEqual([process.platform === 'win32' ? { pid: client.pid } : { pid: client.pid, pgid: client.pid }])
    expect(released).toBe(1)
  })

  it('分包（每 7 字节一块、切开多字节字符）、粘包与前面的非法头：回答照常解码，通知送达', async () => {
    const cwd = await tempDir()
    const { args } = await scripted(cwd)
    const notifications: [string, unknown][] = []
    const client = await open({ cwd, args, onNotification: (method, params) => notifications.push([method, params]) })
    expect(await client.request('textDocument/hover', {})).toEqual({ contents: '中文😀' })
    await expect.poll(() => notifications).toEqual([['window/logMessage', { type: 3, message: 'hi' }]])
  })

  it('请求超时：以 timeout 失败并发 $/cancelRequest', async () => {
    const cwd = await tempDir()
    const { args, record } = await scripted(cwd)
    const client = await open({ cwd, args, requestTimeoutMs: 300 })
    const error = await client.request('textDocument/definition', {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LspClientError)
    expect((error as LspClientError).code).toBe('timeout')
    await expect.poll(async () => (await records(record)).find((m) => m.method === '$/cancelRequest')?.params).toEqual({ id: 2 })
  })

  it('服务器发来的请求得到空结果（workspace/configuration 每项 null）', async () => {
    const cwd = await tempDir()
    const { args, record } = await scripted(cwd)
    const client = await open({ cwd, args })
    expect(await client.request('textDocument/references', {})).toEqual([])
    expect((await records(record)).find((m) => m.id === 'srv-1')).toEqual({ jsonrpc: '2.0', id: 'srv-1', result: [null, null] })
  })

  it('服务器退出时挂起的请求以 exited 失败；之后的请求立即失败', async () => {
    const cwd = await tempDir()
    const { args } = await scripted(cwd)
    const exits: unknown[] = []
    const client = await open({ cwd, args, onExit: (info) => exits.push(info) })
    const hanging = client.request('textDocument/definition', {})
    client.notify('exit-now', {})
    await expect(hanging).rejects.toMatchObject({ code: 'exited' })
    expect(await client.exited).toEqual({ code: 3, signal: null })
    expect(exits).toEqual([{ code: 3, signal: null }])
    await expect(client.request('textDocument/hover', {})).rejects.toMatchObject({ code: 'exited' })
  })

  it('initialize 之前退出：启动失败', async () => {
    const cwd = await tempDir()
    await expect(createLspClient({ command: process.execPath, args: ['-e', 'process.exit(5)'], cwd, hostEnv })).rejects.toThrow(/exited during startup/)
  })

  it('可执行文件不存在：spawn-failed', async () => {
    const cwd = await tempDir()
    await expect(createLspClient({ command: join(cwd, 'no-such-server'), cwd, hostEnv })).rejects.toMatchObject({ code: 'spawn-failed' })
  })

  it('环境：剔除 COKO_* 与凭据形态的变量，合并配置的 env', async () => {
    const cwd = await tempDir()
    const out = join(cwd, 'env.json')
    const script = join(cwd, 'env.mjs')
    await writeFile(script, `import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], JSON.stringify(process.env)); process.exit(0)`)
    await createLspClient({
      command: process.execPath,
      args: [script, out],
      cwd,
      hostEnv: { ...hostEnv, COKO_CREDENTIAL_X: 'k', OPENAI_API_KEY: 'k', GITHUB_TOKEN: 't', KEEP: 'yes' },
      env: { FROM_CONFIG: '1' },
    }).catch(() => undefined)
    const env = JSON.parse(await readFile(out, 'utf8')) as Record<string, string>
    expect(env).toMatchObject({ KEEP: 'yes', FROM_CONFIG: '1' })
    expect(Object.keys(env)).not.toEqual(expect.arrayContaining(['COKO_CREDENTIAL_X']))
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.GITHUB_TOKEN).toBeUndefined()
  })

  it.skipIf(process.platform !== 'darwin')('关闭序列：不回答 shutdown、忽略 exit 与 SIGTERM 时以 SIGKILL 结束（进程组只在 darwin 上验证）', async () => {
    const cwd = await tempDir()
    const { args, record } = await scripted(cwd, ['--stubborn'])
    const client = await open({ cwd, args })
    await client.close()
    expect(await client.exited).toEqual({ code: null, signal: 'SIGKILL' })
    // shutdown 等待 graceMs 未回答：取消该请求，再发 exit。
    expect((await records(record)).map((m) => m.method)).toEqual(['initialize', 'initialized', 'shutdown', '$/cancelRequest', 'exit'])
  })
})
