// M5 的装配接入点：真实 Sidecar（faux）。空贡献时发给模型的请求不变；测试贡献驱动 beforeSubmit（reject 400 hook-blocked、context 进入
// user message）与 onStop（多一次请求）；/handoff 在没有用户消息时 400（交接本身见 sidecar-handoff）；有序关闭（定时器 → Run → Job → 贡献 → 登记进程 → 存储）；测试时钟只在
// 测试构建中开启时挂载。harness 自测：faux match、git 夹具、Hook 夹具、秘密总闸的额外扫描目录。
// 本文件不新增读取根或注入点（测试贡献的上下文是固定文本）：符号链接越界用例由引入读取根的功能各自给出。
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, onTestFinished } from 'vitest'
import { DEFAULT_SYSTEM_PROMPT } from '@coko/agent'
import { API_ROUTES, apiPaths, permissionPaths, type SessionEntryRecord } from '@coko/protocol'
import { createGitWorkspace, GIT_FIXTURE_AUTHOR } from '../fixtures/git/index.ts'
import { leaksIn, marker, persisted } from './secrets-gate-harness.ts'
import {
  advanceClock,
  client,
  connect,
  exchange,
  fauxScript,
  hookCommand,
  hookFixturePath,
  pollUntil,
  sidecarDirs,
  startSidecar,
  tempDir,
  type SidecarDirs,
} from './sidecar-harness.ts'

const run = promisify(execFile)
type Logged = { role: string; content: unknown; sections?: unknown }[]

async function boot(dirs: SidecarDirs, root: string, env: Record<string, string>) {
  const sidecar = await startSidecar({ dirs, env })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspace = (await api.post(API_ROUTES.workspaces, { path: root })).body
  const open = async () => {
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    return sessionId
  }
  const sessionId = await open()
  const runEnds = (id: string, n: number) => stream.waitFor(() => stream.entries(id).filter((e) => e.kind === 'run_end').length >= n)
  return { sidecar, api, stream, sessionId, open, runEnds }
}

async function requests(path: string): Promise<Logged[]> {
  return (await readFile(path, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Logged)
}

const texts = (content: unknown) => (content as { type: string; text?: string }[]).map((b) => b.text)
const users = (entries: SessionEntryRecord[]) =>
  entries.filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'user').map((e) => texts((e.payload as { content: unknown }).content))

async function logSteps(dirs: SidecarDirs) {
  return (await readFile(join(dirs.logDir, 'sidecar.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { message: string; properties: { step?: string } })
    .filter((r) => r.message.startsWith('shutdown step'))
    .map((r) => r.properties.step)
}

describe('M5 装配接入点', () => {
  it('空贡献时请求与之前相同：开头只有基础系统提示，没有 sections；user message 原样；run_start 为 submit', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(root, { requestLog, responses: [{ content: 'hi' }] })
    const { sidecar, api, sessionId, stream, runEnds } = await boot(dirs, root, { COKO_FAUX_SCRIPT: script })
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'hello' })).status).toBe(202)
    await runEnds(sessionId, 1)
    const [messages, ...rest] = await requests(requestLog)
    expect(rest).toEqual([])
    expect(messages!.map((m) => m.role)).toEqual(['system', 'user'])
    expect(messages![0]).toEqual(expect.objectContaining({ role: 'system', content: DEFAULT_SYSTEM_PROMPT }))
    expect(messages![0]).not.toHaveProperty('sections')
    expect(texts(messages![1]!.content)).toEqual(['hello'])
    expect(stream.entries(sessionId).find((e) => e.kind === 'run_start')?.payload).toEqual({ trigger: 'submit' })
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('beforeSubmit：reject 为 400 hook-blocked 且不提交 user message、不开始 Run；context 作为 user message 中单独的文本块', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(root, { requestLog, responses: [{ content: 'with context' }] })
    const { sidecar, api, sessionId, stream, runEnds } = await boot(dirs, root, { COKO_FAUX_SCRIPT: script, COKO_TEST_TOOLS: '1' })
    const rejected = await api.post(apiPaths.sessionMessages(sessionId), { text: 'please [m5:reject]' })
    expect([rejected.status, rejected.body.error?.code, rejected.body.error?.message]).toEqual([400, 'hook-blocked', 'Blocked by the M5 test seam'])
    expect((await api.get(apiPaths.session(sessionId))).body.entries.map((e: SessionEntryRecord) => e.kind)).toEqual(['permission_mode'])

    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'note [m5:context]' })).status).toBe(202)
    await runEnds(sessionId, 1)
    expect(users(stream.entries(sessionId))).toEqual([['note [m5:context]', '<hook-context>\nContext from the M5 test seam\n</hook-context>']])
    const logged = await requests(requestLog)
    expect(logged).toHaveLength(1)
    expect(texts(logged[0]!.at(-1)!.content)).toEqual(['note [m5:context]', '<hook-context>\nContext from the M5 test seam\n</hook-context>'])
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('onStop 的测试贡献使 Run 多一次请求：继续的 user message 在同一 Run 中，之后正常结束', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(root, { requestLog, responses: [{ content: 'first' }, { content: 'second' }] })
    const { sidecar, api, sessionId, stream, runEnds } = await boot(dirs, root, { COKO_FAUX_SCRIPT: script, COKO_TEST_TOOLS: '1' })
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'go [m5:continue]' })
    await runEnds(sessionId, 1)
    const entries = stream.entries(sessionId)
    expect(users(entries)).toEqual([['go [m5:continue]'], ['Continue from the M5 test seam']])
    expect(new Set(entries.filter((e) => e.kind === 'message').map((e) => e.runId)).size).toBe(1)
    expect(entries.find((e) => e.kind === 'run_end')?.payload).toEqual({ status: 'completed' })
    expect(await requests(requestLog)).toHaveLength(2)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('/handoff 在没有用户消息的 Session 中为 400 nothing-to-hand-off，不开始 Run', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const script = await fauxScript(root, { responses: [] })
    const { sidecar, api, sessionId } = await boot(dirs, root, { COKO_FAUX_SCRIPT: script })
    const response = await api.post(apiPaths.sessionMessages(sessionId), { text: '/handoff continue the refactor' })
    expect([response.status, response.body.error?.code]).toEqual([400, 'nothing-to-hand-off'])
    expect((await api.get(apiPaths.session(sessionId))).body.entries.map((e: SessionEntryRecord) => e.kind)).toEqual(['permission_mode'])
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('有序关闭：停止 HTTP 之后定时器 → Run → Job → 上下文贡献 → 登记进程 → 存储', async () => {
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({ dirs })
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    expect(await logSteps(dirs)).toEqual(['timers', 'runs', 'jobs', 'contributions', 'processes', 'storage'])
  })

  it('POST /api/test/clock：开启测试时钟时拨快并返回时刻；未开启或 --packaged 时 404', async () => {
    const dirs = await sidecarDirs()
    const enabled = await startSidecar({ dirs, env: { COKO_TEST_CLOCK: '1' } })
    const api = client(enabled, await exchange(enabled))
    const before = (await api.post('/api/test/clock', { advanceMs: 0 })).body.now as number
    expect(await advanceClock(api, 60_000)).toBe(before + 60_000)
    expect((await api.post('/api/test/clock', { setMs: before })).status).toBe(400)
    expect(await enabled.stop()).toEqual({ code: 0, signal: null })

    const plain = await startSidecar({ dirs: await sidecarDirs() })
    expect((await client(plain, await exchange(plain)).post('/api/test/clock', { advanceMs: 1 })).status).toBe(404)
    expect(await plain.stop()).toEqual({ code: 0, signal: null })

    const packagedDirs = await sidecarDirs()
    const packaged = await startSidecar({
      dirs: packagedDirs,
      env: { COKO_TEST_CLOCK: '1' },
      args: ['--data-dir', packagedDirs.dataDir, '--log-dir', packagedDirs.logDir, '--packaged'],
    })
    expect((await client(packaged, await exchange(packaged)).post('/api/test/clock', { advanceMs: 1 })).status).toBe(404)
    expect(await packaged.stop()).toEqual({ code: 0, signal: null })
  })
})

describe('M5 harness 自测', () => {
  it('faux match：两个并行 Session 各取到自己的回复（与提交顺序无关）', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const script = await fauxScript(root, {
      tokensPerSecond: 50,
      responses: [
        { match: 'alpha task', content: 'reply for alpha' },
        { match: 'beta task', content: 'reply for beta' },
      ],
    })
    const { sidecar, api, sessionId: a, open, stream, runEnds } = await boot(dirs, root, { COKO_FAUX_SCRIPT: script })
    const b = await open()
    await Promise.all([api.post(apiPaths.sessionMessages(b), { text: 'beta task' }), api.post(apiPaths.sessionMessages(a), { text: 'alpha task' })])
    await Promise.all([runEnds(a, 1), runEnds(b, 1)])
    const reply = (id: string) =>
      stream
        .entries(id)
        .filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'assistant')
        .map((e) => texts((e.payload as { content: unknown }).content).join(''))
    expect([reply(a), reply(b)]).toEqual([['reply for alpha'], ['reply for beta']])
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('git 夹具：Sidecar 中 git config user.email 为夹具值，来自仓库的 .git/config，没有读真实 ~/.gitconfig', async () => {
    const repo = await createGitWorkspace()
    onTestFinished(() => repo.dispose())
    const dirs = await sidecarDirs()
    const script = await fauxScript(repo.root, {
      responses: [
        {
          content: [
            {
              type: 'toolCall',
              name: 'bash',
              id: 'g1',
              arguments: { command: 'git config --show-origin user.email; git config --global --list; echo "home=$HOME"' },
            },
          ],
        },
        { content: 'done' },
      ],
    })
    // 夹具的环境（临时 HOME、GIT_CONFIG_GLOBAL=/dev/null、固定 author）交给 Sidecar。
    const { sidecar, api, sessionId, stream, runEnds } = await boot(dirs, repo.root, { COKO_FAUX_SCRIPT: script, ...repo.env })
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'check git' })
    await runEnds(sessionId, 1)
    const result = stream.entries(sessionId).find((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'toolResult')!
    const output = texts((result.payload as { content: unknown }).content).join('')
    expect(output).toContain(`file:.git/config\t${GIT_FIXTURE_AUTHOR.email}`)
    expect(output).toContain(`home=${repo.home}`)
    expect(output).not.toContain(process.env.HOME + '/.gitconfig')
    // 夹具仓库的提交来自固定 author。
    expect((await repo.git('log', '-1', '--format=%ae %aI')).trim()).toBe(`${GIT_FIXTURE_AUTHOR.email} 2026-01-01T00:00:00Z`)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('Hook 夹具：记录 stdin 一行、按参数输出与退出；--ignore-term 时 SIGTERM 不结束进程', async () => {
    const root = await tempDir()
    const record = join(root, 'stdin.jsonl')
    const child = run('/bin/bash', [
      '-c',
      `echo '{"hook_event_name":"Stop"}' | ${hookCommand('--record', record, '--exit', '2', '--stderr', 'blocked by fixture')}`,
    ]).catch((e) => e)
    const outcome = (await child) as { code?: number; stderr?: string }
    expect([outcome.code, outcome.stderr]).toEqual([2, 'blocked by fixture'])
    const ok = await run('/bin/bash', ['-c', `${hookCommand('--stdout', '{"decision":"block"}')} < /dev/null`])
    expect(ok.stdout).toBe('{"decision":"block"}')
    expect(await readFile(record, 'utf8')).toBe('{"hook_event_name":"Stop"}\n')

    const { spawn } = await import('node:child_process')
    const ready = join(root, 'ready.jsonl')
    const sleeper = spawn(process.execPath, [hookFixturePath, '--ignore-term', '--record', ready, '--sleep', '30000'], { stdio: ['pipe', 'ignore', 'ignore'] })
    const exited = new Promise<NodeJS.Signals | null>((resolve) => sleeper.once('exit', (_code, signal) => resolve(signal)))
    sleeper.stdin.end('{}\n')
    // 记录文件出现时夹具已装好 SIGTERM 处理并进入 sleep：此后 SIGTERM 不结束它；随后 SIGKILL 结束它（只终止本测试启动的进程）。
    await pollUntil(() => readFile(ready, 'utf8').catch(() => ''), { timeoutMs: 10_000, what: 'the hook fixture to start' })
    sleeper.kill('SIGTERM')
    const stillAlive = await Promise.race([exited.then(() => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 300))])
    expect(stillAlive).toBe(true)
    sleeper.kill('SIGKILL')
    expect(await exited).toBe('SIGKILL')
  })

  it('秘密总闸的落盘扫描接受额外目录：写在 Hook 记录目录中的标记被报告（负向确认）', async () => {
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({ dirs })
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    const hookDir = join(await tempDir(), 'hook-records')
    await mkdir(hookDir, { recursive: true })
    const secret = marker('hookstdin')
    await writeFile(join(hookDir, 'stdin.jsonl'), `{"tool_input":"${secret}"}\n`)
    const without = await persisted(dirs)
    expect(
      leaksIn(
        without.map((f): [string, Buffer] => [f.name, f.bytes]),
        { 'hook secret': secret },
      ),
    ).toEqual([])
    const files = await persisted(dirs, { extraDirs: { hooks: hookDir } })
    expect(files.map((f) => f.name)).toContain('hooks/stdin.jsonl')
    expect(
      leaksIn(
        files.map((f): [string, Buffer] => [f.name, f.bytes]),
        { 'hook secret': secret },
      ),
    ).toEqual(['hooks/stdin.jsonl contains hook secret'])
  })
})
