// 计划批准的状态不一致：待审批的 plan 请求没有对应的审阅记录（propose 总在询问之前登记，正常走不到）时，不猜测 revision，以 internal 失败
// （HTTP 500），不提交新 revision 的 plan 条目，也不放行该请求。Session 计划的读取：子 Session 取根 Session 的阶段与活动 Plan，没有阶段条目时为 none；
// 计划接口的动作对子 Session 为 child-session。旧数据（permission_mode v2 的 plan）读为进入前的模式，不在规划中。
import { SESSION_ENTRY_PAYLOADS, type AgentRuntime } from '@coko/agent'
import { createPayloadRegistry, type SessionStore } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { describe, expect, it } from 'vitest'
import { AppError } from './errors.ts'
import { SessionHub } from './hub.ts'
import { PermissionService } from './permissions.ts'
import { SessionPermissions } from './session-permissions.ts'
import { SessionRuntimes } from './session-runtimes.ts'

async function setup() {
  const store: SessionStore = createMemoryStore({ payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) })
  const workspace = await store.sessions.registerWorkspace({ path: process.cwd(), name: 'ws' })
  const session = await store.sessions.createSession({ workspaceId: workspace.id, title: 't', model: null })
  // 升级前（permission_mode v2）停在 plan 模式的 Session。
  await store.sessions.appendEntries(session.id, [{ kind: 'permission_mode', payloadVersion: 2, payload: { mode: 'plan', prior: 'default' } }])
  const runtimes = new SessionRuntimes(store, new SessionHub())
  const answered: unknown[] = []
  // 只用到 pendingApprovals 与 answerApproval 的运行时替身：一个 plan 请求在等待，但没有经过 propose。
  const runtime = {
    isRunning: true,
    pendingApprovals: [{ requestId: 'a1', kind: 'plan', toolCallId: 'call-1' }],
    answerApproval: async (requestId: string, answer: unknown) => void answered.push({ requestId, answer }),
  } as unknown as AgentRuntime
  await runtimes.obtain(session.id, async () => runtime)
  const permissions = new SessionPermissions({ store, runtimes, service: new PermissionService(store, () => []) })
  const plans = async () => (await store.sessions.listEntries(session.id)).filter((e) => e.kind === 'plan')
  return { session, permissions, answered, plans, store }
}

describe('Session 计划的读取', () => {
  it('子 Session 读到根 Session 的阶段与待审阅的计划；未知 Session 为 not-found', async () => {
    const { session, permissions, store } = await setup()
    const proposed = { planId: 'p1', revision: 1, markdown: '# P', status: 'proposed' as const }
    await store.sessions.appendEntries(session.id, [
      { kind: 'plan_phase', payload: { phase: 'planning' } },
      { kind: 'plan', payload: proposed },
    ])
    const child = await store.sessions.createSession({ workspaceId: session.workspaceId, title: 'c', model: null, parentSessionId: session.id })
    expect(await permissions.sessionPlan(child.id)).toEqual({ phase: 'planning', plan: proposed })
    expect(await permissions.sessionPlan(session.id)).toEqual({ phase: 'planning', plan: proposed })
    await expect(permissions.sessionPlan('missing')).rejects.toMatchObject({ code: 'not-found', status: 404 })
  })

  it('动作：子 Session 409 child-session，不提交条目；未知 Session 为 not-found', async () => {
    const { session, permissions, store } = await setup()
    const child = await store.sessions.createSession({ workspaceId: session.workspaceId, title: 'c', model: null, parentSessionId: session.id })
    await expect(permissions.planAction(child.id, 'enter')).rejects.toMatchObject({
      code: 'child-session',
      status: 409,
      message: 'A subagent session uses the plan of its root session',
    })
    expect((await store.sessions.listEntries(child.id)).filter((e) => e.kind === 'plan_phase')).toEqual([])
    expect((await store.sessions.listEntries(session.id)).filter((e) => e.kind === 'plan_phase')).toEqual([])
    await expect(permissions.planAction('missing', 'enter')).rejects.toMatchObject({ code: 'not-found', status: 404 })
  })

  it('升级前停在 plan 模式、没有阶段条目的 Session：模式读为 prior、读取结果不带 prior，不在规划中，运行时不按规划判定', async () => {
    const { session, permissions } = await setup()
    expect(await permissions.sessionPermissions(session.id)).toEqual({ mode: 'default', rules: [] })
    expect(await permissions.sessionPlan(session.id)).toEqual({ phase: 'none', plan: null })
    expect(await permissions.review(session.id).active()).toBe(false)
    const runtime = permissions.runtimePermissions(await permissions.state(session), session.workspaceId, session.id)
    expect([runtime.mode(), runtime.planning()]).toEqual(['default', false])
  })

  it.each([
    [{ mode: 'plan', prior: 'accept-edits' }, 'accept-edits'],
    [{ mode: 'plan', prior: 'full-access' }, 'full-access'],
    [{ mode: 'plan' }, 'default'],
    [{ mode: 'read-only' }, 'read-only'],
  ])('旧的 permission_mode v2 %j 读为 %s（没有 prior 的 plan 为 default）', async (payload, mode) => {
    const { store } = await setup()
    const workspace = await store.sessions.registerWorkspace({ path: process.cwd(), name: 'ws' })
    const old = await store.sessions.createSession({ workspaceId: workspace.id, title: 'old', model: null })
    await store.sessions.appendEntries(old.id, [{ kind: 'permission_mode', payloadVersion: 1, payload: { mode: 'accept-edits' } }])
    await store.sessions.appendEntries(old.id, [{ kind: 'permission_mode', payloadVersion: 2, payload }])
    const permissions = new SessionPermissions({
      store,
      runtimes: new SessionRuntimes(store, new SessionHub()),
      service: new PermissionService(store, () => []),
    })
    expect(await permissions.sessionPermissions(old.id)).toEqual({ mode, rules: [] })
    expect(await permissions.sessionPlan(old.id)).toEqual({ phase: 'none', plan: null })
  })
})

describe('计划批准找不到待审阅记录', () => {
  it('回答批准：internal（500），不放行请求，不提交 plan 条目', async () => {
    const { session, permissions, answered, plans } = await setup()
    const error = await permissions.answerApproval(session.id, 'a1', { decision: 'allow' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({ code: 'internal', status: 500 })
    expect(answered).toEqual([])
    expect(await plans()).toEqual([])
  })

  it('exit_plan_mode 执行时（approved）：internal，不新建 revision', async () => {
    const { session, permissions, plans } = await setup()
    const error = await permissions
      .review(session.id)
      .approved('call-1', '# Plan')
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'internal', status: 500 })
    expect(await plans()).toEqual([])
  })
})
