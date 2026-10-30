// 计划批准的状态不一致：待审批的 plan 请求没有对应的审阅记录（propose 总在询问之前登记，正常走不到）时，不猜测 revision，以 internal 失败
// （HTTP 500），不提交新 revision 的 plan 条目，也不放行该请求。
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
  await store.sessions.appendEntries(session.id, [{ kind: 'permission_mode', payload: { mode: 'plan', prior: 'default' } }])
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
  return { session, permissions, answered, plans }
}

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
