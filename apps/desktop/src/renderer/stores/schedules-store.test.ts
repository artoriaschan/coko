import type { Schedule } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../client/api.ts'
import { createSchedulesStore, type SchedulesBackend } from './schedules-store.ts'

const schedule = (id: string, patch: Partial<Schedule> = {}): Schedule => ({
  id,
  sessionId: 's1',
  title: `title ${id}`,
  prompt: 'check the build',
  rule: { kind: 'every', seconds: 600 },
  status: 'active',
  nextAt: 1_000,
  revision: 1,
  ...patch,
})

/** 内存后端：与 Sidecar 相同的 revision 规则（不一致 409 revision-conflict，成功时 revision + 1）。 */
function backend(initial: Schedule[] = []) {
  const rows = new Map(initial.map((s) => [s.id, s]))
  const calls: string[] = []
  let next = 1
  const api: SchedulesBackend = {
    list: async (sessionId) => (calls.push(`list:${sessionId ?? '*'}`), [...rows.values()].filter((s) => sessionId === undefined || s.sessionId === sessionId)),
    create: async (sessionId, input) => {
      calls.push(`create:${sessionId}`)
      const created = schedule(`new-${next++}`, { sessionId, ...input })
      rows.set(created.id, created)
      return created
    },
    update: async (id, patch) => {
      calls.push(`update:${id}`)
      const row = rows.get(id)
      if (!row) throw new ApiError('not-found', 'missing', 404)
      if (row.revision !== patch.revision) throw new ApiError('revision-conflict', 'conflict', 409, { expected: patch.revision, actual: row.revision })
      const { revision: _r, ...rest } = patch
      const updated = { ...row, ...rest, revision: row.revision + 1 }
      rows.set(id, updated)
      return updated
    },
    remove: async (id) => {
      calls.push(`remove:${id}`)
      if (!rows.delete(id)) throw new ApiError('not-found', 'missing', 404)
    },
  }
  /** 另一处（Agent 的工具、另一窗口）修改了任务。 */
  const external = (id: string, patch: Partial<Schedule>) => rows.set(id, { ...rows.get(id)!, ...patch, revision: rows.get(id)!.revision + 1 })
  return { api, rows, calls, external }
}

function progress() {
  const listeners = new Set<(p: { sessionId: string; runId: string; event: { type: string; schedule?: Schedule } }) => void>()
  return {
    onProgress(listener: (p: never) => void) {
      listeners.add(listener as never)
      return () => void listeners.delete(listener as never)
    },
    emit(event: { type: 'schedule_update'; schedule: Schedule }) {
      for (const l of listeners) l({ sessionId: event.schedule.sessionId, runId: '', event })
    },
  }
}

describe('schedules-store', () => {
  it('load：按会话与全部会话分别读取；较早的请求晚到时丢弃', async () => {
    const b = backend([schedule('a'), schedule('b', { sessionId: 's2' })])
    let release!: () => void
    const slow = new Promise<void>((r) => (release = r))
    const original = b.api.list
    let first = true
    b.api.list = async (sessionId) => {
      if (first) {
        first = false
        await slow
        return []
      }
      return original(sessionId)
    }
    const store = createSchedulesStore(b.api)
    const stale = store.getState().load('s1')
    await store.getState().load('s1')
    release()
    await stale
    expect(store.getState().lists.s1).toMatchObject({ status: 'ready', schedules: [{ id: 'a' }] })
    await store.getState().load()
    expect(store.getState().lists['*']?.schedules.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('create 与 update：结果并入列表；schedule_update 进度更新两份列表，较旧的 revision 不覆盖', async () => {
    const b = backend([schedule('a')])
    const store = createSchedulesStore(b.api)
    const source = progress()
    store.getState().attach(source as never)
    await Promise.all([store.getState().load('s1'), store.getState().load()])
    const created = await store.getState().create('s1', { title: 'nightly', prompt: 'p', rule: { kind: 'cron', expression: '0 9 * * *', timeZone: 'UTC' } })
    expect(store.getState().lists.s1?.schedules.map((s) => s.id)).toEqual(['a', created.id])
    expect(store.getState().lists['*']?.schedules.map((s) => s.id)).toEqual(['a', created.id])
    source.emit({ type: 'schedule_update', schedule: schedule('a', { revision: 3, status: 'paused' }) })
    expect(store.getState().lists.s1?.schedules[0]).toMatchObject({ status: 'paused', revision: 3 })
    expect(store.getState().lists['*']?.schedules[0]).toMatchObject({ status: 'paused', revision: 3 })
    source.emit({ type: 'schedule_update', schedule: schedule('a', { revision: 2, status: 'active' }) })
    expect(store.getState().lists.s1?.schedules[0]).toMatchObject({ status: 'paused', revision: 3 })
  })

  it('update 的 revision 冲突：返回 conflict 并读回最新值，之后以新的 revision 成功', async () => {
    const b = backend([schedule('a')])
    const store = createSchedulesStore(b.api)
    await store.getState().load('s1')
    b.external('a', { title: 'changed elsewhere' })
    expect(await store.getState().update('a', { status: 'paused' })).toEqual({ status: 'conflict' })
    expect(store.getState().lists.s1?.schedules[0]).toMatchObject({ title: 'changed elsewhere', revision: 2, status: 'active' })
    expect(await store.getState().update('a', { status: 'paused' })).toMatchObject({ status: 'saved' })
    expect(b.rows.get('a')).toMatchObject({ status: 'paused', revision: 3, title: 'changed elsewhere' })
  })

  it('update 的其他错误抛出；remove 后从列表去掉，已不存在（404）视为已删除', async () => {
    const b = backend([schedule('a'), schedule('b')])
    const store = createSchedulesStore(b.api)
    await store.getState().load('s1')
    b.api.update = async () => Promise.reject(new ApiError('bad-request', 'no future occurrence', 400))
    await expect(store.getState().update('a', { status: 'active' })).rejects.toMatchObject({ code: 'bad-request' })
    await store.getState().remove('a')
    expect(store.getState().lists.s1?.schedules.map((s) => s.id)).toEqual(['b'])
    b.rows.delete('b')
    await store.getState().remove('b')
    expect(store.getState().lists.s1?.schedules).toEqual([])
    b.api.remove = async () => Promise.reject(new ApiError('internal', 'x', 500))
    await expect(store.getState().remove('c')).rejects.toMatchObject({ code: 'internal' })
  })

  it('requestOpen：记下待打开的会话，取走后清除（只取一次）', () => {
    const store = createSchedulesStore(backend().api)
    store.getState().requestOpen('s2')
    expect(store.getState().takeOpenRequest('s1')).toBe(false)
    expect(store.getState().takeOpenRequest('s2')).toBe(true)
    expect(store.getState().takeOpenRequest('s2')).toBe(false)
  })
})
