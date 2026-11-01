// 任务板的并发（TeamService，ADR 0018）：同一根 Session 的 task_update 经 KeyedMutex 串行。第一次认领在读取条目处停住（deferred）时第二次认领
// 进入：只有一个成功，另一个为 stale-revision 且带当前快照；没有串行时两个都会读到 revision 1 并成功。
import { SESSION_ENTRY_PAYLOADS, TeamTaskError, type RunEntry } from '@coko/agent'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { describe, expect, it } from 'vitest'
import { TeamService } from './teams.ts'

async function team() {
  const store = createMemoryStore({ payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) })
  const workspace = await store.sessions.registerWorkspace({ path: '/tmp/coko-team-cas' })
  const root = await store.sessions.createSession({ workspaceId: workspace.id, model: null })
  const start = (agentId: string, name: string) =>
    ({
      kind: 'agent_start',
      payload: { agentId, agentType: 'general', description: name, background: true, toolCallId: 'c-' + name, name, teammate: true },
    }) as never
  await store.sessions.appendEntries(root.id, [start('s-alice', 'alice'), start('s-bob', 'bob')])
  const names: Record<string, string> = { 's-alice': 'alice', 's-bob': 'bob' }
  const listEntries = store.sessions.listEntries.bind(store.sessions)
  let hold: Promise<void> | undefined
  const sessions = new Proxy(store.sessions, {
    get(target, key, receiver) {
      if (key !== 'listEntries') return Reflect.get(target, key, receiver)
      return async (...args: Parameters<typeof listEntries>) => {
        const entries = await listEntries(...args)
        const waiting = hold
        hold = undefined
        if (waiting) await waiting
        return entries
      }
    },
  })
  const service = new TeamService({
    store: { sessions },
    entries: {
      list: (id) => listEntries(id),
      commit: async (id, entry: RunEntry) => (await store.sessions.appendEntries(id, [entry as never]))[0]!,
    },
    subagents: {
      teammateOf: (sessionId: string) => (names[sessionId] ? { name: names[sessionId], rootId: root.id } : undefined),
      liveInfo: () => undefined,
    } as never,
  })
  return { root: root.id, service, holdNextRead: (released: Promise<void>) => (hold = released), listEntries }
}

describe('任务板的并发认领', () => {
  it('两个 teammate 用同一 expected_revision 认领、读取交叠：一个成功，另一个 stale-revision 带当前快照', async () => {
    const { root, service, holdNextRead, listEntries } = await team()
    await service.port(root, root).createTask({ subject: 'shared work' })
    let release!: () => void
    holdNextRead(new Promise<void>((resolve) => (release = resolve)))
    // alice 的读取停住时 bob 的认领已经提交：两次调用在时间上交叠。
    const alice = service.port('s-alice', root).updateTask({ taskId: 't1', expectedRevision: 1, status: 'in_progress' })
    const bob = service.port('s-bob', root).updateTask({ taskId: 't1', expectedRevision: 1, status: 'in_progress' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    release()
    const [a, b] = await Promise.allSettled([alice, bob])
    const won = [a, b].filter((r) => r.status === 'fulfilled')
    const lost = [a, b].filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(1)
    expect(lost[0]!.reason).toBeInstanceOf(TeamTaskError)
    expect(lost[0]!.reason).toMatchObject({ code: 'stale-revision', task: { taskId: 't1', revision: 2, status: 'in_progress' } })
    const snapshots = (await listEntries(root)).filter((e) => e.kind === 'team_task').map((e) => e.payload)
    expect(snapshots).toEqual([
      expect.objectContaining({ revision: 1, status: 'pending' }),
      expect.objectContaining({ revision: 2, status: 'in_progress', owner: (won[0] as PromiseFulfilledResult<{ owner: string }>).value.owner }),
    ])
  })
})
