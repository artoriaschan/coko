// 定时任务的重启（ADR 0015：至多一次、只补最近一次）：真实 Sidecar，同一数据目录重启；测试时钟的起点由 COKO_TEST_CLOCK_START 给出（停机期间的时间）。
// 停机跨越 5 个发生次后启动只投递 1 次且 missed: 4；在 recordFire 之后、run_start 之前 SIGKILL（COKO_TEST_HOLD_SCHEDULE_FIRE 挂起点），重启后该发生次
// 不再投递。等待用条目与 HTTP 的可观察状态，不用固定 sleep。本功能不读取文件，不涉及符号链接越界。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, schedulePaths } from '@coko/protocol'
import {
  advanceClock,
  client,
  connect,
  exchange,
  fauxScript,
  killAndRestart,
  sidecarDirs,
  startSidecar,
  tempDir,
  type SidecarDirs,
  type Stream,
} from './sidecar-harness.ts'

type Fire = { scheduleId: string; occurrence: number; status: string; missed?: number }

const of = (stream: Stream, sessionId: string, kind: string) => stream.entries(sessionId).filter((e) => e.kind === kind)

async function attach(sidecar: Awaited<ReturnType<typeof startSidecar>>, sessionId?: string) {
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const subscribe = async (id: string) => {
    stream.send({ type: 'subscribe', sessionId: id, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === id)
  }
  if (sessionId) await subscribe(sessionId)
  return { api, stream, subscribe }
}

async function setup() {
  const root = await tempDir()
  const workspaceDir = join(root, 'ws')
  await mkdir(workspaceDir)
  await writeFile(join(root, 'requests.jsonl'), '')
  const script = await fauxScript(root, {
    requestLog: join(root, 'requests.jsonl'),
    responses: [
      { match: 'prompt-tick', content: 'tick 1' },
      { match: 'prompt-tick', content: 'tick 2' },
    ],
  })
  const dirs: SidecarDirs = await sidecarDirs()
  return { root, workspaceDir, script, dirs }
}

describe('定时任务：重启', { timeout: 120_000 }, () => {
  it('停机跨越 5 个发生次：启动后只投递最近 1 次，missed: 4，下一次按原对齐', async () => {
    const { workspaceDir, script, dirs } = await setup()
    const first = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script, COKO_TEST_CLOCK: '1' } })
    const a = await attach(first)
    const workspaceId = (await a.api.post(API_ROUTES.workspaces, { path: workspaceDir })).body.id as string
    const sessionId = (await a.api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    const t0 = await advanceClock(a.api, 0)
    const schedule = (
      await a.api.post(schedulePaths.sessionSchedules(sessionId), { title: 'tick', prompt: 'prompt-tick', rule: { kind: 'every', seconds: 60 } })
    ).body as { id: string; nextAt: number }
    expect(schedule.nextAt).toBe(t0 + 60_000)
    expect(await first.stop()).toEqual({ code: 0, signal: null })

    // 停机期间经过 t0 + 60 s … t0 + 300 s 共 5 个发生次；启动时刻为 t0 + 330 s。
    const second = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script, COKO_TEST_CLOCK: '1', COKO_TEST_CLOCK_START: String(t0 + 330_000) } })
    const b = await attach(second, sessionId)
    await b.stream.waitFor(() => of(b.stream, sessionId, 'run_end').length >= 1)
    expect(of(b.stream, sessionId, 'schedule_fire').map((e) => e.payload as Fire)).toEqual([
      { scheduleId: schedule.id, occurrence: t0 + 300_000, status: 'started', missed: 4 },
    ])
    expect(of(b.stream, sessionId, 'run_start').map((e) => e.payload)).toEqual([
      { trigger: 'schedule', schedule: { scheduleId: schedule.id, occurrence: t0 + 300_000 } },
    ])
    expect((await b.api.get(schedulePaths.list(sessionId))).body[0]).toMatchObject({ status: 'active', nextAt: t0 + 360_000, lastOccurrence: t0 + 300_000 })
    expect(await second.stop()).toEqual({ code: 0, signal: null })
  })

  it('recordFire 之后、run_start 之前 SIGKILL：重启后该发生次不再投递（至多一次），之后的发生次照常', async () => {
    const { workspaceDir, script, dirs } = await setup()
    const env = { COKO_FAUX_SCRIPT: script, COKO_TEST_CLOCK: '1' }
    const first = await startSidecar({ dirs, env: { ...env, COKO_TEST_HOLD_SCHEDULE_FIRE: '1' } })
    const a = await attach(first)
    const workspaceId = (await a.api.post(API_ROUTES.workspaces, { path: workspaceDir })).body.id as string
    const sessionId = (await a.api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    await a.subscribe(sessionId)
    const t0 = await advanceClock(a.api, 0)
    const schedule = (
      await a.api.post(schedulePaths.sessionSchedules(sessionId), { title: 'tick', prompt: 'prompt-tick', rule: { kind: 'every', seconds: 60 } })
    ).body as { id: string }
    await advanceClock(a.api, 60_000)
    // schedule_fire（started）已提交、Run 没有开始：挂在测试钩子上。
    await a.stream.waitFor(() => of(a.stream, sessionId, 'schedule_fire').length >= 1)
    expect(of(a.stream, sessionId, 'run_start')).toEqual([])

    // 重启时刻在本次之后、下一次（t0 + 120 s）之前：没有到期的任务。
    const second = await killAndRestart(first, { dirs, env: { ...env, COKO_TEST_CLOCK_START: String(t0 + 90_000) } })
    const b = await attach(second, sessionId)
    expect((await b.api.get(schedulePaths.list(sessionId))).body[0]).toMatchObject({
      nextAt: t0 + 120_000,
      lastOccurrence: t0 + 60_000,
      lastFire: { status: 'started' },
    })
    // 拨到下一次：只投递 t0 + 120 s；t0 + 60 s 的那一次从未开始 Run，也不再投递。
    await advanceClock(b.api, 30_000)
    await b.stream.waitFor(() => of(b.stream, sessionId, 'run_end').length >= 1)
    expect(of(b.stream, sessionId, 'schedule_fire').map((e) => e.payload as Fire)).toEqual([
      { scheduleId: schedule.id, occurrence: t0 + 60_000, status: 'started' },
      { scheduleId: schedule.id, occurrence: t0 + 120_000, status: 'started' },
    ])
    expect(of(b.stream, sessionId, 'run_start').map((e) => e.payload)).toEqual([
      { trigger: 'schedule', schedule: { scheduleId: schedule.id, occurrence: t0 + 120_000 } },
    ])
    expect(await second.stop()).toEqual({ code: 0, signal: null })
  })
})
