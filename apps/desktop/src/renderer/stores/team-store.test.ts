// 团队 store（docs/subsystems/teams.md#界面）：按根 Session 读取 TeamSnapshot，team_update 替换快照，较早发出的读取晚到时不覆盖较新的快照，
// 读取失败保留已有快照；progress 订阅按来源引用计数；HTTP 后端按 schema 校验响应。
import type { ProgressEvent, TeamSnapshot } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { createTeamStore, httpTeamBackend, type TeamBackend } from './team-store.ts'

const usage = { turns: 1, toolCalls: 0, tokens: 10, cost: 0, durationMs: 100 }
const team = (names: string[], patch: Partial<TeamSnapshot> = {}): TeamSnapshot => ({
  members: names.map((name) => ({ agentId: `c-${name}`, name, status: 'idle', usage })),
  tasks: [],
  warnings: [],
  ...patch,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

function source() {
  const listeners = new Set<(p: { sessionId: string; runId: string; event: ProgressEvent }) => void>()
  return {
    onProgress(listener: (p: { sessionId: string; runId: string; event: ProgressEvent }) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(sessionId: string, event: ProgressEvent) {
      for (const l of listeners) l({ sessionId, runId: '', event })
    },
    get size() {
      return listeners.size
    },
  }
}

describe('team store', () => {
  it('load 读取快照；team_update 替换该会话的快照；读取期间到达的 team_update 不被较早的响应覆盖', async () => {
    const pending: ReturnType<typeof deferred<TeamSnapshot>>[] = []
    const backend: TeamBackend = {
      get: () => {
        const d = deferred<TeamSnapshot>()
        pending.push(d)
        return d.promise
      },
    }
    const store = createTeamStore(backend)
    const src = source()
    const off = store.getState().attach(src)

    const first = store.getState().load('s-1')
    expect(store.getState().teams['s-1']?.status).toBe('loading')
    pending[0]!.resolve(team(['alice']))
    await first
    expect(store.getState().teams['s-1']).toEqual({ status: 'ready', team: team(['alice']) })

    // 再次读取期间 team_update 到达：之后到的（较早的）响应被丢弃。
    const second = store.getState().load('s-1')
    src.emit('s-1', { type: 'team_update', team: team(['alice', 'bob']) })
    expect(store.getState().teams['s-1']?.team?.members.map((m) => m.name)).toEqual(['alice', 'bob'])
    pending[1]!.resolve(team(['alice']))
    await second
    expect(store.getState().teams['s-1']?.team?.members.map((m) => m.name)).toEqual(['alice', 'bob'])

    // 其他会话的 team_update 只影响那个会话；其他进度忽略。
    src.emit('s-2', { type: 'team_update', team: team(['carol']) })
    src.emit('s-1', { type: 'agent_update', agentId: 'c-alice', status: 'running' })
    expect(store.getState().teams['s-2']).toEqual({ status: 'ready', team: team(['carol']) })
    expect(store.getState().teams['s-1']?.team?.members.map((m) => m.name)).toEqual(['alice', 'bob'])
    off()
    expect(src.size).toBe(0)
  })

  it('读取失败：已有快照保留并标为 error；没有快照时为 error 且没有 team', async () => {
    let fail = false
    const store = createTeamStore({
      get: async () => {
        if (fail) throw new Error('offline')
        return team(['alice'])
      },
    })
    fail = true
    await store.getState().load('s-x')
    expect(store.getState().teams['s-x']).toEqual({ status: 'error' })
    fail = false
    await store.getState().load('s-1')
    fail = true
    await store.getState().load('s-1')
    expect(store.getState().teams['s-1']).toEqual({ status: 'error', team: team(['alice']) })
  })

  it('attach 按来源引用计数：两次 attach 只订阅一次，全部释放后取消订阅；release 重复调用只生效一次', () => {
    const store = createTeamStore({ get: async () => team([]) })
    const src = source()
    const a = store.getState().attach(src)
    const b = store.getState().attach(src)
    expect(src.size).toBe(1)
    a()
    a()
    expect(src.size).toBe(1)
    b()
    expect(src.size).toBe(0)
  })

  it('HTTP 后端：GET /api/sessions/:id/team，响应不符合 TeamSnapshot 时拒绝', async () => {
    const urls: string[] = []
    const reply = (body: unknown) =>
      httpTeamBackend(async (url) => {
        urls.push(String(url))
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
      })
    await expect(reply(team(['alice'])).get('s 1')).resolves.toEqual(team(['alice']))
    expect(urls[0]).toMatch(/\/api\/sessions\/s%201\/team$/)
    await expect(reply({ members: [{ name: 'x' }], tasks: [], warnings: [] }).get('s-1')).rejects.toMatchObject({ code: 'bad-response' })
  })
})
