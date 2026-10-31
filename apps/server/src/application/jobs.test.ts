// 后台任务的停止：job_end 的 signal 取宿主发出的终止信号（进程以退出码而不是信号结束时，例如外层 shell 或 sandbox-exec
// 把子进程的信号死亡转为 128 + n），退出本身带 signal 时以退出的为准；自然结束的 Job 不带 signal。假的 spawn 决定退出的形状，
// 与时序无关；其后的 JobService、BackgroundJob、内存存储与 job_kill / job_output 工具都是真实实现。
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJobKillTool, createJobOutputTool, SESSION_ENTRY_PAYLOADS, type ExecProcess, type JobEndPayload, type ProcessExit } from '@coko/agent'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { describe, expect, it, onTestFinished } from 'vitest'
import { SessionHub } from './hub.ts'
import { JobService } from './jobs.ts'

/** 假进程：记下收到的信号；onKill 决定收到信号时如何结束（不调用 exit 即忽略该信号）。 */
function fakeProcess(onKill: (signal: NodeJS.Signals, exit: (result: ProcessExit) => void) => void) {
  let resolve!: (result: ProcessExit) => void
  const exited = new Promise<ProcessExit>((r) => (resolve = r))
  const signals: NodeJS.Signals[] = []
  let done = false
  const exit = (result: ProcessExit) => {
    if (done) return
    done = true
    resolve(result)
  }
  const process: ExecProcess = {
    pid: 4242,
    pgid: 4242,
    kill: (signal = 'SIGTERM') => {
      if (done) return
      signals.push(signal)
      onKill(signal, exit)
    },
    exited,
  }
  return { process, signals, exit }
}

async function setup(proc: ExecProcess, killGraceMs?: number) {
  const store = createMemoryStore({ payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) })
  const workspace = await store.sessions.registerWorkspace({ path: process.cwd(), name: 'ws' })
  const session = await store.sessions.createSession({ workspaceId: workspace.id, model: null })
  const logDir = await mkdtemp(join(tmpdir(), 'coko-jobs-'))
  onTestFinished(() => rm(logDir, { recursive: true, force: true }))
  const jobs = new JobService({
    store,
    hub: new SessionHub(),
    runs: { activeRunId: () => undefined, deliver: () => false },
    logDir,
    ...(killGraceMs === undefined ? {} : { killGraceMs }),
  })
  onTestFinished(() => jobs.close())
  const { jobId } = await jobs.launcher(session.id).start({ toolCallId: 't1', command: 'sleep 300', cwd: process.cwd(), spawn: async () => proc })
  const port = jobs.port(session.id)
  const jobEnd = async () => {
    const entries = await store.sessions.listEntries(session.id)
    return entries.find((e) => e.kind === 'job_end')?.payload as unknown as JobEndPayload | undefined
  }
  const text = (result: { content: { type: string; text?: string }[] }) => result.content.map((c) => c.text ?? '').join('')
  return {
    jobId,
    jobEnd,
    kill: async () => text(await createJobKillTool(port).execute('k1', { job_id: jobId })),
    output: async () => text(await createJobOutputTool(port).execute('o1', { job_id: jobId })),
    list: () => jobs.list(session.id),
  }
}

describe('job_kill 后 job_end 的 signal', () => {
  it('SIGTERM 后以退出码 143 结束、退出不带 signal：job_end 与 job_output 的状态都带 signal SIGTERM', async () => {
    const fake = fakeProcess((signal, exit) => signal === 'SIGTERM' && exit({ exitCode: 143 }))
    const h = await setup(fake.process)
    expect(await h.kill()).toContain('[status: killed (signal SIGTERM)]')
    expect(fake.signals).toEqual(['SIGTERM'])
    expect(await h.jobEnd()).toMatchObject({ status: 'killed', exitCode: 143, signal: 'SIGTERM' })
    expect(await h.output()).toContain('[status: killed (signal SIGTERM)]')
    expect((await h.list())[0]).toMatchObject({ status: 'killed', exitCode: 143, signal: 'SIGTERM' })
  })

  it('SIGTERM 被忽略、宽限后 SIGKILL 结束且退出不带 signal：job_end 的 signal 为 SIGKILL', async () => {
    const fake = fakeProcess((signal, exit) => signal === 'SIGKILL' && exit({ exitCode: 137 }))
    const h = await setup(fake.process, 10)
    expect(await h.kill()).toContain('[status: killed (signal SIGKILL)]')
    expect(fake.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(await h.jobEnd()).toMatchObject({ status: 'killed', exitCode: 137, signal: 'SIGKILL' })
  })

  it('退出本身带 signal 时以退出的为准', async () => {
    const fake = fakeProcess((signal, exit) => signal === 'SIGTERM' && exit({ exitCode: 130, signal: 'SIGINT' }))
    const h = await setup(fake.process)
    await h.kill()
    expect(await h.jobEnd()).toMatchObject({ status: 'killed', exitCode: 130, signal: 'SIGINT' })
  })
})

describe('自然结束的 Job 不带 signal', () => {
  it.each([
    { exit: { exitCode: 0 }, status: 'completed' },
    { exit: { exitCode: 143 }, status: 'failed' },
  ])('退出码 $exit.exitCode：$status，job_end 没有 signal', async ({ exit, status }) => {
    const fake = fakeProcess(() => undefined)
    const h = await setup(fake.process)
    fake.exit(exit)
    await expect.poll(h.jobEnd).toMatchObject({ status, exitCode: exit.exitCode })
    expect(await h.jobEnd()).not.toHaveProperty('signal')
    expect(fake.signals).toEqual([])
  })
})
