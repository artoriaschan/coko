import type { MemoryEntry } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { createMemoryClient, createMemoryStore } from './memory-store.ts'

const memory = (id: string, content: string): MemoryEntry => ({ id, scope: 'user', workspaceId: null, content, source: 'user', createdAt: 1, updatedAt: 1 })

/** 记录请求路径；每个 GET 的响应由调用方决定何时给出（deferred），以确定请求交叠的位置。 */
function deferredClient() {
  const pending: { path: string; resolve: (memories: MemoryEntry[]) => void }[] = []
  const client = createMemoryClient(
    (path, init) =>
      new Promise<Response>((resolve) => {
        if (init?.method === 'DELETE') return resolve(new Response(null, { status: 204 }))
        if ((init?.method ?? 'GET') !== 'GET') return resolve(new Response(JSON.stringify(memory('x', 'x')), { status: 200 }))
        pending.push({ path, resolve: (memories) => resolve(new Response(JSON.stringify({ memories }), { status: 200 })) })
      }),
  )
  const settle = async (index: number, memories: MemoryEntry[]) => {
    pending[index]!.resolve(memories)
    await new Promise((r) => setTimeout(r, 0))
  }
  return { client, pending, settle }
}

describe('memory-store：检索', () => {
  it('search 以 query 请求 GET /api/memories?query=…&workspaceId=…；清空 query 时恢复为列表请求', async () => {
    const { client, pending, settle } = deferredClient()
    const store = createMemoryStore(client)
    const loading = store.getState().load('w 1')
    await settle(0, [memory('a', 'all')])
    await loading
    const searching = store.getState().search('docker  compose')
    expect(store.getState().query).toBe('docker  compose')
    await settle(1, [memory('d', 'docker compose')])
    await searching
    expect(store.getState()).toMatchObject({ status: 'ready', query: 'docker  compose', memories: [memory('d', 'docker compose')] })
    const clearing = store.getState().search('')
    await settle(2, [memory('a', 'all')])
    await clearing
    expect(pending.map((p) => p.path)).toEqual([
      '/api/memories?workspaceId=w%201',
      '/api/memories?query=docker++compose&workspaceId=w+1',
      '/api/memories?workspaceId=w%201',
    ])
    expect(store.getState()).toMatchObject({ query: '', memories: [memory('a', 'all')] })
  })

  it('较早发出的检索晚到时被丢弃；增删改后按当前 query 重新读取', async () => {
    const { client, pending, settle } = deferredClient()
    const store = createMemoryStore(client)
    const first = store.getState().search('dock')
    const second = store.getState().search('docker')
    await settle(1, [memory('new', 'docker')])
    await settle(0, [memory('old', 'dock')])
    await Promise.all([first, second])
    expect(store.getState().memories.map((m) => m.id)).toEqual(['new'])
    const removing = store.getState().remove('new')
    await new Promise((r) => setTimeout(r, 0))
    expect(pending.at(-1)!.path).toBe('/api/memories?query=docker')
    await settle(pending.length - 1, [])
    await removing
    expect(store.getState().memories).toEqual([])
  })
})
