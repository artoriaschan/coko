// 后台任务（docs/subsystems/jobs.md）：真实 Sidecar（faux）上 bash run_in_background、job_output 的游标与等待、日志文件、并发上限、完成通知
// （Run 进行中与 Session 空闲两种，faux requestLog 断言）、job_kill 与 HTTP 停止（进程表断言）、停止 Run 不终止 Job、SIGKILL 后重启记 lost、
// HTTP 分页与 WS 帧的偏移、指向日志目录的符号链接经 read 读取时需要审批。faux 脚本用 $LAST_JOB_ID 引用最近启动的 Job。
// 进程组信号与孤儿清理只在 darwin 验证（ADR 0012），其他平台显式跳过。
import { existsSync } from 'node:fs'
import { readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, jobPaths, permissionPaths, type JobSnapshot, type ServerMessage } from '@coko/protocol'
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
  waitApproval,
  waitProcessesGone,
  type SidecarDirs,
} from './sidecar-harness.ts'

const darwin = process.platform === 'darwin'

type Message = { role: string; content: string | { type: string; text?: string }[]; toolCallId?: string; isError?: boolean }
const textOf = (m: Message) => (typeof m.content === 'string' ? m.content : m.content.map((b) => b.text ?? '').join(''))

/** 测试结束时终止记录的进程组与 pid（只针对本测试启动的进程）。 */
function reap(...pids: number[]): void {
  onTestFinished(() => {
    for (const pid of pids)
      for (const target of [-pid, pid])
        try {
          process.kill(target, 'SIGKILL')
        } catch {
          // 已退出。
        }
  })
}

const readPid = async (path: string) => Number((await readFile(path, 'utf8').catch(() => '')).trim())

function dbRows<T>(dirs: SidecarDirs, sql: string): T[] {
  const path = join(dirs.dataDir, 'coko.db')
  if (!existsSync(path)) return []
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return db.prepare(sql).all() as T[]
  } finally {
    db.close()
  }
}

async function setup(responses: unknown[], options: { mode?: string } = {}) {
  const root = await tempDir()
  const dirs = await sidecarDirs()
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const env = { COKO_FAUX_SCRIPT: await fauxScript(root, { requestLog, responses }) }
  const sidecar = await startSidecar({ dirs, env })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: options.mode ?? 'full-access' })).status).toBe(200)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  const entries = () => stream.entries(sessionId)
  const count = (kind: string) => entries().filter((e) => e.kind === kind).length
  const send = async (text: string) => expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
  const turn = async (text: string) => {
    const before = count('run_end')
    await send(text)
    await stream.waitFor(() => count('run_end') > before, 30_000)
  }
  const requests = async () =>
    (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Message[])
  const toolResult = (toolCallId: string) => entries().find((e) => e.kind === 'message' && (e.payload as Message).toolCallId === toolCallId)
  const jobEnd = (jobId: string) => entries().find((e) => e.kind === 'job_end' && (e.payload as { jobId: string }).jobId === jobId)
  const jobStarts = () =>
    entries()
      .filter((e) => e.kind === 'job_start')
      .map((e) => e.payload as { jobId: string; logPath: string; label: string })
  return { root, dirs, env, sidecar, api, stream, sessionId, entries, count, send, turn, requests, toolResult, jobEnd, jobStarts }
}

const bg = (id: string, command: string) => ({ type: 'toolCall', name: 'bash', id, arguments: { command, run_in_background: true } })
const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })

describe('后台任务（真实 Sidecar）', { timeout: 120_000 }, () => {
  it('立即返回 jobId，job_start 在 toolResult 之前；job_output wait 读到 1–3 与 [status: completed]；日志 0600 / 目录 0700、内容一致；读到终态后不通知', async () => {
    const h = await setup([
      { content: [bg('b1', 'for i in 1 2 3; do echo $i; sleep 0.2; done')] },
      { content: [call('o1', 'job_output', { job_id: '$LAST_JOB_ID', wait: true, timeout_ms: 20_000 })] },
      { content: 'done' },
      { content: 'again' },
    ])
    await h.turn('start it')
    const [start] = h.jobStarts()
    expect(start).toBeDefined()
    const started = h.toolResult('b1')!
    expect(textOf(started.payload as Message)).toBe(
      `Started background job ${start!.jobId}: for i in 1 2 3; do echo $i; sleep 0.2; done. Read output with job_output.`,
    )
    const startSeq = h.entries().find((e) => e.kind === 'job_start')!.seq
    expect(startSeq).toBeLessThan(started.seq)
    const output = textOf(h.toolResult('o1')!.payload as Message)
    expect(output).toBe('1\n2\n3\n\n\n[status: completed]')
    await h.stream.waitFor(() => h.jobEnd(start!.jobId) !== undefined)
    expect(h.jobEnd(start!.jobId)!.payload).toEqual({ jobId: start!.jobId, status: 'completed', exitCode: 0, outputBytes: 6, truncated: false })

    expect(start!.logPath).toBe(join(h.dirs.dataDir, 'jobs', h.sessionId, start!.jobId + '.log'))
    expect((await stat(start!.logPath)).mode & 0o777).toBe(0o600)
    expect((await stat(join(h.dirs.dataDir, 'jobs', h.sessionId))).mode & 0o777).toBe(0o700)
    expect(await readFile(start!.logPath, 'utf8')).toBe('1\n2\n3\n')

    await h.turn('again')
    const last = (await h.requests()).at(-1)!
    expect(last.map(textOf).join('\n')).not.toContain('<job-notification>')
    expect(h.count('job_notification')).toBe(0)
  })

  it('每 Session 同时至多 10 个：第 11 个为错误结果；有序关闭终止全部 Job（job_end killed）', async () => {
    const h = await setup([{ content: Array.from({ length: 11 }, (_, i) => bg('b' + i, 'sleep 30')) }, { content: 'ok' }])
    await h.turn('many')
    expect(h.jobStarts()).toHaveLength(10)
    const eleventh = h.toolResult('b10')!.payload as Message
    expect(eleventh.isError).toBe(true)
    expect(textOf(eleventh)).toContain('At most 10 background jobs')
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
    const ends = dbRows<{ payload: string }>(h.dirs, "SELECT payload FROM session_entries WHERE kind = 'job_end'").map((r) => JSON.parse(r.payload))
    expect(ends).toHaveLength(10)
    expect(ends.every((e) => e.status === 'killed')).toBe(true)
    expect(dbRows(h.dirs, 'SELECT id FROM host_processes')).toEqual([])
  })

  it('Run 进行中 Job 结束：下一次模型请求前送达带 job_notification 的 user message（requestLog），不开始新 Run', async () => {
    const h = await setup([{ content: [bg('b1', 'echo hello-from-job'), call('f1', 'bash', { command: 'sleep 2' })] }, { content: 'saw it' }])
    await h.turn('go')
    const requests = await h.requests()
    expect(requests).toHaveLength(2)
    const notification = requests[1]!.filter((m) => m.role === 'user').at(-1)!
    const text = textOf(notification)
    expect(text.startsWith('<job-notification>')).toBe(true)
    expect(text).toContain('<status>completed</status>')
    expect(text).toContain('<output>hello-from-job\n</output>')
    const entries = h.entries()
    const at = entries.findIndex((e) => e.kind === 'job_notification')
    expect(entries[at]!.payload).toEqual({ jobIds: [h.jobStarts()[0]!.jobId] })
    expect(entries[at + 1]).toMatchObject({ kind: 'message', payload: { role: 'user' } })
    expect(entries[at]!.runId).toBe(entries[at + 1]!.runId)
    expect(h.count('run_start')).toBe(1)
  })

  it('Session 空闲时 Job 结束：不开始新 Run；下一次提交的 user message 以通知开头，前置 job_notification', async () => {
    const h = await setup([{ content: [bg('b1', 'sleep 0.5; echo idle-done')] }, { content: 'started' }, { content: 'ok' }])
    await h.turn('go')
    const jobId = h.jobStarts()[0]!.jobId
    await h.stream.waitFor(() => h.jobEnd(jobId) !== undefined)
    expect(h.count('run_start')).toBe(1)
    await h.turn('next')
    expect(h.count('run_start')).toBe(2)
    const user = (await h.requests())[2]!.filter((m) => m.role === 'user').at(-1)!
    expect(typeof user.content).not.toBe('string')
    const blocks = user.content as { text: string }[]
    expect(blocks[0]!.text.startsWith('<job-notification>')).toBe(true)
    expect(blocks[0]!.text).toContain('idle-done')
    expect(blocks.at(-1)!.text).toBe('next')
    const entries = h.entries()
    const at = entries.findIndex((e) => e.kind === 'job_notification')
    expect(entries[at + 1]).toMatchObject({ kind: 'message', payload: { role: 'user' } })
  })

  it('HTTP 分页读取不影响模型游标；WS job_output 帧按 offset 连续，与日志一致', async () => {
    const h = await setup([
      { content: [bg('b1', 'seq 1 1000')] },
      { content: 'started' },
      { content: [call('o1', 'job_output', { job_id: '$LAST_JOB_ID' })] },
      { content: 'read' },
    ])
    await h.turn('go')
    const { jobId, logPath } = h.jobStarts()[0]!
    await h.stream.waitFor(() => h.jobEnd(jobId) !== undefined)
    const expected = Array.from({ length: 1000 }, (_, i) => String(i + 1) + '\n').join('')
    expect(await readFile(logPath, 'utf8')).toBe(expected)

    let offset = 0
    let paged = ''
    for (let page = 0; page < 20; page++) {
      const res = await h.api.get(jobPaths.output(jobId, offset, 1000))
      expect(res.status).toBe(200)
      expect(res.body.offset).toBe(offset)
      paged += res.body.chunk
      offset = res.body.nextOffset
      if (res.body.done) break
    }
    expect(paged).toBe(expected)
    expect((await h.api.get(jobPaths.output(jobId, 0, 300_000))).status).toBe(400)
    expect((await h.api.get(jobPaths.output('job_missing'))).status).toBe(404)

    const frames = h.stream.messages.flatMap((m: ServerMessage) =>
      m.type === 'progress' && m.event.type === 'job_output' && m.event.jobId === jobId ? [m.event] : [],
    )
    expect(frames.length).toBeGreaterThan(0)
    let next = 0
    for (const frame of frames) {
      expect(frame.offset).toBe(next)
      next += Buffer.byteLength(frame.chunk, 'utf8')
    }
    expect(frames.map((f) => f.chunk).join('')).toBe(expected)
    const updates = h.stream.messages.flatMap((m: ServerMessage) => (m.type === 'progress' && m.event.type === 'job_update' ? [m.event.job.status] : []))
    expect(updates).toEqual(['running', 'completed'])

    const listed = (await h.api.get(jobPaths.sessionJobs(h.sessionId))).body.jobs as JobSnapshot[]
    expect(listed).toMatchObject([{ jobId, status: 'completed', exitCode: 0, outputBytes: expected.length, label: 'seq 1 1000' }])

    await h.turn('read it')
    const read = textOf(h.toolResult('o1')!.payload as Message)
    expect(read.startsWith('1\n2\n3\n')).toBe(true)
    expect(read).toContain('1000\n')
    expect(read.endsWith('[status: completed]')).toBe(true)
  })

  it('Workspace 内指向 Job 日志目录的符号链接：default 模式下 read 需要审批（日志目录不是读取根）', async () => {
    const h = await setup([
      { content: [bg('b1', 'echo log-line')] },
      { content: 'started' },
      { content: [call('r1', 'read', { path: 'joblogs/$LAST_JOB_ID.log' })] },
      { content: 'denied' },
    ])
    await symlink(join(h.dirs.dataDir, 'jobs', h.sessionId), join(h.root, 'joblogs'))
    await h.turn('go')
    await h.stream.waitFor(() => h.jobEnd(h.jobStarts()[0]!.jobId) !== undefined)
    expect((await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'default' })).status).toBe(200)
    await h.send('read the log')
    const approval = await waitApproval(h.stream, h.sessionId)
    expect(approval.toolName).toBe('read')
    expect((await h.api.post(apiPaths.sessionApproval(h.sessionId, approval.requestId), { decision: 'deny' })).status).toBe(204)
    await h.stream.waitFor(() => h.count('run_end') >= 2)
    expect(textOf(h.toolResult('r1')!.payload as Message)).not.toContain('log-line')
  })
})

describe.skipIf(!darwin)('后台任务的停止与孤儿（darwin）', { timeout: 120_000 }, () => {
  const holder = (root: string, name: string) => `echo $$ > ${join(root, name + '.pid')}; sleep 300 & echo $! > ${join(root, name + '-child.pid')}; wait`
  const waitPids = async (root: string, name: string) => {
    let shell = 0
    let child = 0
    await expect
      .poll(
        async () => {
          shell = await readPid(join(root, name + '.pid'))
          child = await readPid(join(root, name + '-child.pid'))
          return shell > 0 && child > 0
        },
        { timeout: 20_000 },
      )
      .toBe(true)
    reap(shell, child)
    return [shell, child]
  }
  const jobRows = (dirs: SidecarDirs) =>
    dbRows<{ pid: number; pgid: number; kind: string; job_id: string }>(dirs, "SELECT pid, pgid, kind, job_id FROM host_processes WHERE kind = 'job'")

  it('job_kill 使进程组退出（进程表）、job_end killed、登记行删除；被 job_kill 停止的 Job 不通知', async () => {
    const root = await tempDir()
    const wait = `while [ ! -s ${join(root, 'a-child.pid')} ]; do sleep 0.05; done`
    const h = await setup([
      { content: [bg('b1', holder(root, 'a'))] },
      { content: [call('w1', 'bash', { command: wait })] },
      { content: [call('k1', 'job_kill', { job_id: '$LAST_JOB_ID' })] },
      { content: 'killed' },
      { content: 'ok' },
    ])
    const pids = waitPids(root, 'a')
    await h.turn('go')
    const [shell, child] = await pids
    const jobId = h.jobStarts()[0]!.jobId
    expect(textOf(h.toolResult('k1')!.payload as Message)).toContain('[status: killed')
    await waitProcessesGone([shell!, child!], 5_000)
    expect(h.jobEnd(jobId)!.payload).toMatchObject({ status: 'killed', signal: 'SIGTERM' })
    await expect.poll(() => jobRows(h.dirs)).toEqual([])
    await h.turn('again')
    expect((await h.requests()).at(-1)!.map(textOf).join('\n')).not.toContain('<job-notification>')
  })

  it('停止 Run 后 Job 仍在运行；POST /api/jobs/:id/kill 使进程组退出（204），再次停止 409 job-not-running；用户停止的 Job 下一次提交时通知', async () => {
    const root = await tempDir()
    const h = await setup([{ content: [bg('b1', holder(root, 'b')), call('f1', 'bash', { command: 'sleep 300' })] }, { content: 'ok' }])
    const pids = waitPids(root, 'b')
    await h.send('go')
    const [shell, child] = await pids
    const jobId = h.jobStarts()[0]!.jobId
    await expect.poll(() => jobRows(h.dirs)).toEqual([{ pid: shell, pgid: shell, kind: 'job', job_id: jobId }])
    expect((await h.api.post(apiPaths.sessionAbort(h.sessionId))).status).toBeLessThan(300)
    await h.stream.waitFor(() => h.count('run_end') === 1)
    expect(processExists(shell!) && processExists(child!)).toBe(true)
    expect(((await h.api.get(jobPaths.sessionJobs(h.sessionId))).body.jobs as JobSnapshot[])[0]!.status).toBe('running')

    expect((await h.api.post(jobPaths.kill(jobId))).status).toBe(204)
    await waitProcessesGone([shell!, child!], 5_000)
    expect(h.jobEnd(jobId)!.payload).toMatchObject({ status: 'killed' })
    expect(await h.api.post(jobPaths.kill(jobId))).toMatchObject({ status: 409, body: { error: { code: 'job-not-running' } } })
    expect((await h.api.post(jobPaths.kill('job_unknown'))).status).toBe(404)
    await expect.poll(() => jobRows(h.dirs)).toEqual([])

    await h.turn('next')
    expect((await h.requests()).at(-1)!.map(textOf).join('\n')).toContain('<status>killed</status>')
  })

  it('SIGKILL Sidecar 后重启：Job 记 lost，进程组被孤儿清理终止', async () => {
    const root = await tempDir()
    const h = await setup([{ content: [bg('b1', holder(root, 'c'))] }, { content: 'started' }])
    const pids = waitPids(root, 'c')
    await h.turn('go')
    const [shell, child] = await pids
    const jobId = h.jobStarts()[0]!.jobId
    await expect.poll(() => jobRows(h.dirs).length).toBe(1)

    const restarted = await killAndRestart(h.sidecar, { dirs: h.dirs, env: h.env })
    await waitProcessesGone([shell!, child!], 5_000)
    const api = client(restarted, await exchange(restarted))
    const jobs = (await api.get(jobPaths.sessionJobs(h.sessionId))).body.jobs as JobSnapshot[]
    expect(jobs).toMatchObject([{ jobId, status: 'lost' }])
    expect(await restarted.stop()).toEqual({ code: 0, signal: null })
    const log = (await readFile(join(h.dirs.logDir, 'sidecar.jsonl'), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { message: string; properties: Record<string, unknown> })
    expect(log.some((r) => r.message === 'orphan process terminated' && r.properties.kind === 'job' && r.properties.pid === shell)).toBe(true)
  })
})
