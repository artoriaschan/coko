// Goal 与宿主派生的 Run（ADR 0011）：交接完成后源 Session 的 running Goal 暂停（handed-off），交接 Run 结束不发起下一轮；waiting-input 的
// Goal 只由用户的输入唤醒（submit、continue、retry），定时任务、交接与子代理的 Run 结束都不唤醒它。
import { SESSION_ENTRY_PAYLOADS, type GoalPayload, type RunResult } from '@coko/agent'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { describe, expect, it } from 'vitest'
import type { RunRequest } from './context/types.ts'
import { GoalService } from './goals.ts'
import { SessionHub } from './hub.ts'
import type { JobService } from './jobs.ts'

const base: GoalPayload = {
  id: 'goal-1',
  revision: 1,
  objective: 'o',
  criteria: [{ id: 'c1', text: 'done' }],
  budget: { maxRounds: 5 },
  phase: 'running',
  resumedAtRound: 0,
  source: 'model',
}

async function setup(goal: GoalPayload) {
  const store = createMemoryStore({ payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) })
  const workspace = await store.sessions.registerWorkspace({ path: '/tmp/coko-goals-wake' })
  const session = await store.sessions.createSession({ workspaceId: workspace.id, model: null })
  await store.sessions.appendEntries(session.id, [{ kind: 'goal', payload: goal as never }])
  const started: RunRequest[] = []
  const jobs = { useGoals: () => undefined, port: () => ({ get: () => undefined, list: () => [] }), killSession: async () => 0 } as unknown as JobService
  const service = new GoalService({
    store,
    hub: new SessionHub(),
    jobs,
    runs: {
      activeRunId: () => undefined,
      stopAfterBatch: () => false,
      startRun: async (_id, request) => {
        started.push(request)
        return { runId: `g${started.length}` }
      },
      modelPriced: async () => true,
      isRunning: () => false,
      abort: async () => false,
      pause: async () => undefined,
    },
  })
  const run = async (trigger: RunRequest['trigger'], runId: string, end: Omit<RunResult, 'runId'> = { status: 'completed' }) => {
    await store.sessions.appendEntries(session.id, [
      { kind: 'run_start', runId, payload: { trigger } },
      { kind: 'run_end', runId, payload: end as never },
    ])
    const result: RunResult = { runId, ...end }
    await service.runEnded({ sessionId: session.id, runId, trigger, result })
  }
  const phase = async () => {
    const goals = (await store.sessions.listEntries(session.id)).filter((e) => e.kind === 'goal')
    return goals.at(-1)!.payload as unknown as GoalPayload
  }
  return { service, session, started, run, phase }
}

describe('交接之后的源 Goal', () => {
  it('交接 Run 结束不发起下一轮；交接完成时 running 的 Goal 暂停（handed-off）', async () => {
    const t = await setup(base)
    await t.run('handoff', 'h1')
    expect(t.started).toEqual([])
    await t.service.handedOff(t.session.id)
    expect(await t.phase()).toMatchObject({ phase: 'paused', reason: { code: 'handed-off' } })
  })
})

describe('Hook 的停止与阻止', () => {
  it('手动压缩被 PreCompact 阻止（error + hook_blocked）：running 的 Goal 不暂停', async () => {
    const t = await setup(base)
    await t.run('compact', 'c1', { status: 'error', error: { code: 'hook_blocked', message: 'compaction is frozen' } })
    expect(await t.phase()).toMatchObject({ phase: 'running' })
  })

  it('continue: false（paused + hook_stopped）：running 的 Goal 暂停（hook-stopped）', async () => {
    const t = await setup(base)
    await t.run('submit', 's1', { status: 'paused', error: { code: 'hook_stopped', message: 'enough' } })
    expect(await t.phase()).toMatchObject({ phase: 'paused', reason: { code: 'hook-stopped', message: 'enough' } })
  })
})

describe('waiting-input 的 Goal 只由用户的输入唤醒', () => {
  const waiting: GoalPayload = { ...base, phase: 'waiting-input', reason: { code: 'needs-input', message: 'm' } }
  it.each(['schedule', 'handoff', 'subagent'] as const)('%s 的 Run 结束不唤醒', async (trigger) => {
    const t = await setup(waiting)
    await t.run(trigger, 'x1')
    expect((await t.phase()).phase).toBe('waiting-input')
    expect(t.started).toEqual([])
  })

  it('用户提交的 Run 结束唤醒并发起下一轮', async () => {
    const t = await setup(waiting)
    await t.run('submit', 's1')
    expect((await t.phase()).phase).toBe('running')
    expect(t.started.map((r) => r.trigger)).toEqual(['goal'])
  })
})
