// M4 的装配接入点：真实 Sidecar（faux）。空贡献时发给模型的请求不变；待送达内容（pendingInput）合并到下一个 Run 的 user message 开头；
// /goal 的动作在 Run 进行中的可用性（Goal 本身见 sidecar-goal.test.ts，/plan 见 sidecar-plan.test.ts）；有序关闭的顺序；faux 回复的 usage；harness 的重启、进程存在与 Job 日志扫描辅助。
// 本文件不新增文件读取路径（没有读取根或注入点涉及符号链接）。
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DATE_TEST_BLOCK as dateBlock, DATE_TEST_ENV } from './date-state-fixture.ts'
import { DEFAULT_SYSTEM_PROMPT } from '@coko/agent'
import { API_ROUTES, apiPaths, permissionPaths, type SessionEntryRecord } from '@coko/protocol'
import { jobLogDir, leaksIn, marker, persisted } from './secrets-gate-harness.ts'
import {
  client,
  connect,
  exchange,
  fauxScript,
  killAndRestart,
  processExists,
  sidecarDirs,
  startSidecar,
  tempDir,
  waitProcessesGone,
  type SidecarDirs,
} from './sidecar-harness.ts'

type Logged = { role: string; content: unknown; sections?: unknown }[]

async function boot(dirs: SidecarDirs, root: string, env: Record<string, string>) {
  const sidecar = await startSidecar({ dirs, env: { ...DATE_TEST_ENV, ...env } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspace = (await api.post(API_ROUTES.workspaces, { path: root })).body
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body.id as string
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  const runEnds = (n: number) => stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= n)
  return { sidecar, api, stream, sessionId, runEnds }
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

describe('M4 装配接入点', () => {
  it('没有额外贡献时仍有基础提示与环境；user message 原样；run_start 为 submit', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(root, { requestLog, responses: [{ content: 'hi' }] })
    const { sidecar, api, sessionId, stream, runEnds } = await boot(dirs, root, { COKO_FAUX_SCRIPT: script })
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'hello' })).status).toBe(202)
    await runEnds(1)
    const [messages, ...rest] = await requests(requestLog)
    expect(rest).toEqual([])
    expect(messages!.map((m) => m.role)).toEqual(['system', 'user'])
    expect(messages![0]).toEqual(
      expect.objectContaining({ role: 'system', sections: { 'coko.base': DEFAULT_SYSTEM_PROMPT, environment: expect.stringContaining('<environment>') } }),
    )
    expect(texts(messages![1]!.content)).toEqual([dateBlock, 'hello'])
    expect(stream.entries(sessionId).find((e) => e.kind === 'run_start')?.payload).toEqual({ trigger: 'submit' })
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('pendingInput 的内容出现在下一个 Run 的 user message 开头，送达后不再出现', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const script = await fauxScript(root, {
      requestLog,
      responses: [
        { content: [{ type: 'toolCall', name: 'test_queue_input', id: 'q1', arguments: { text: '<note>queued</note>' } }] },
        { content: 'queued it' },
        { content: 'second reply' },
        { content: 'third reply' },
      ],
    })
    const { sidecar, api, sessionId, stream, runEnds } = await boot(dirs, root, { COKO_FAUX_SCRIPT: script, COKO_TEST_TOOLS: '1' })
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'queue something' })
    await runEnds(1)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'second' })
    await runEnds(2)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'third' })
    await runEnds(3)

    expect(users(stream.entries(sessionId))).toEqual([[dateBlock, 'queue something'], ['<note>queued</note>', 'second'], ['third']])
    const logged = await requests(requestLog)
    expect(logged).toHaveLength(4)
    expect(texts(logged[2]!.at(-1)!.content)).toEqual(['<note>queued</note>', 'second'])
    expect(texts(logged[3]!.at(-1)!.content)).toEqual(['third'])
    expect(stream.invalidEntries).toEqual([])
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('没有 Goal 时 /goal pause 为 404 且不产生条目；Run 进行中 /goal pause 照常执行（Run 中可用的动作），/plan 与 /goal resume 为 409', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const script = await fauxScript(root, { responses: [{ content: [{ type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: 'sleep 30' } }] }] })
    const { sidecar, api, sessionId, stream, runEnds } = await boot(dirs, root, { COKO_FAUX_SCRIPT: script })
    const idle = await api.post(apiPaths.sessionMessages(sessionId), { text: '/goal pause' })
    expect([idle.status, idle.body.error?.code]).toEqual([404, 'not-found'])
    // 动作不产生条目：Session 只有初始模式。
    expect((await api.get(apiPaths.session(sessionId))).body.entries.map((e: SessionEntryRecord) => e.kind)).toEqual(['permission_mode'])

    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'start' })).status).toBe(202)
    await stream.waitFor((m) => m.type === 'entry' && m.sessionId === sessionId && m.entry.kind === 'tool_exec')
    const paused = await api.post(apiPaths.sessionMessages(sessionId), { text: '/goal pause' })
    expect([paused.status, paused.body.error?.code]).toEqual([404, 'not-found'])
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: '/plan' })).body.error?.code).toBe('run-in-progress')
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: '/goal resume' })).body.error?.code).toBe('run-in-progress')
    await api.post(apiPaths.sessionAbort(sessionId))
    await runEnds(1)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('有序关闭：Job → 上下文贡献 → 登记进程 → 存储', async () => {
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({ dirs })
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    const steps = (await readFile(join(dirs.logDir, 'sidecar.jsonl'), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { message: string; properties: { step?: string } })
      .filter((r) => r.message.startsWith('shutdown step'))
      .map((r) => r.properties.step)
    // M4 的四步保持相对顺序；M5 在前面加了定时器与 Run（全部顺序见 sidecar-m5-seams.test.ts）。
    expect(steps.filter((step) => ['jobs', 'contributions', 'processes', 'storage'].includes(step!))).toEqual(['jobs', 'contributions', 'processes', 'storage'])
  })

  it('faux 脚本的 usage 原样出现在 assistant 条目中；省略时为估算值', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const usage = { input: 1200, output: 80, cacheRead: 300, cacheWrite: 20, cost: { input: 0.01, output: 0.002 } }
    const script = await fauxScript(root, { responses: [{ content: 'priced', usage }, { content: 'estimated' }] })
    const { sidecar, api, sessionId, stream, runEnds } = await boot(dirs, root, { COKO_FAUX_SCRIPT: script })
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'one' })
    await runEnds(1)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'two' })
    await runEnds(2)
    const assistants = stream
      .entries(sessionId)
      .filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'assistant')
      .map((e) => e.payload as { usage: Record<string, unknown>; responseId?: string })
    expect(assistants[0]!.usage).toEqual({
      input: 1200,
      output: 80,
      cacheRead: 300,
      cacheWrite: 20,
      totalTokens: 1600,
      cost: { input: 0.01, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.012 },
    })
    expect(assistants[0]).not.toHaveProperty('responseId')
    expect(assistants[1]!.usage.input).not.toBe(1200)
    expect((assistants[1]!.usage.totalTokens as number) > 0).toBe(true)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

describe('harness 辅助', () => {
  it('killAndRestart：SIGKILL 后以同一数据目录重启，之前的数据可读；旧进程已不存在', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const first = await startSidecar({ dirs })
    const api = client(first, await exchange(first))
    const workspace = (await api.post(API_ROUTES.workspaces, { path: root })).body
    const oldPid = first.child.pid!
    const next = await killAndRestart(first, { dirs })
    expect(processExists(oldPid)).toBe(false)
    const nextApi = client(next, await exchange(next))
    expect((await nextApi.get(API_ROUTES.workspaces)).body.workspaces.map((w: { id: string }) => w.id)).toEqual([workspace.id])
    expect(await next.stop()).toEqual({ code: 0, signal: null })
  })

  it('processExists 与 waitProcessesGone：区分存活与已退出的进程', async () => {
    const child = spawn('/bin/sleep', ['30'], { stdio: 'ignore' })
    const exited = new Promise((resolve) => child.once('exit', resolve))
    const pid = child.pid!
    expect(processExists(pid)).toBe(true)
    await expect(waitProcessesGone([pid], 200)).rejects.toThrow(String(pid))
    child.kill('SIGKILL')
    await exited
    await waitProcessesGone([pid])
    expect(processExists(pid)).toBe(false)
  })

  it('秘密总闸的落盘扫描包含 <dataDir>/jobs：写在 Job 日志中的标记被报告', async () => {
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({ dirs })
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    const secret = marker('joblog')
    await mkdir(join(jobLogDir(dirs), 's1'), { recursive: true })
    await writeFile(join(jobLogDir(dirs), 's1', 'j1.log'), `output ${secret}\n`)
    const files = await persisted(dirs)
    expect(files.map((f) => f.name)).toContain('jobs/s1/j1.log')
    expect(
      leaksIn(
        files.map((f): [string, Buffer] => [f.name, f.bytes]),
        { 'job secret': secret },
      ),
    ).toEqual(['jobs/s1/j1.log contains job secret'])
  })
})
