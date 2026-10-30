import type { HooksResponse } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../client/api.ts'
import { createHooksStore, httpHooksBackend } from './hooks-store.ts'

const view = (revision: number, approved = false): HooksResponse => ({
  enabled: true,
  global: { hooks: {}, revision, diagnostics: [] },
  project: {
    path: '/w/.coko/settings.json',
    entries: [{ hookId: 'project:PreToolUse:0:0', event: 'PreToolUse', command: 'guard.sh', digest: 'd'.repeat(64), approved }],
    diagnostics: [],
  },
})

function fakeFetch(handler: (method: string, path: string, body: unknown) => { status: number; body?: unknown }) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  const fetchImpl = async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
    calls.push({ method, path, ...(body === undefined ? {} : { body }) })
    const reply = handler(method, path, body)
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status })
  }
  return { calls, fetchImpl }
}

describe('hooks-store', () => {
  it('load 按会话读取；approve 带 sessionId 并读回；响应按 schema 校验', async () => {
    let approved = false
    const { calls, fetchImpl } = fakeFetch((method) => {
      if (method === 'POST') return ((approved = true), { status: 204 })
      return { status: 200, body: view(2, approved) }
    })
    const store = createHooksStore(httpHooksBackend(fetchImpl))
    await store.getState().load('s 1')
    expect(store.getState().view?.project?.entries[0]?.approved).toBe(false)
    await store.getState().approve('w1', 'd'.repeat(64))
    expect(store.getState().view?.project?.entries[0]?.approved).toBe(true)
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['GET', '/api/hooks?sessionId=s%201', undefined],
      ['POST', '/api/hooks/approvals', { workspaceId: 'w1', digest: 'd'.repeat(64), sessionId: 's 1' }],
      ['GET', '/api/hooks?sessionId=s%201', undefined],
    ])
  })

  it('没有会话时按 Workspace 读取；批准不带 sessionId', async () => {
    const { calls, fetchImpl } = fakeFetch((method) => (method === 'POST' ? { status: 204 } : { status: 200, body: view(1) }))
    const store = createHooksStore(httpHooksBackend(fetchImpl))
    await store.getState().load({ workspaceId: 'w 1' })
    await store.getState().approve('w 1', 'd'.repeat(64))
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['GET', '/api/hooks?workspaceId=w%201', undefined],
      ['POST', '/api/hooks/approvals', { workspaceId: 'w 1', digest: 'd'.repeat(64) }],
      ['GET', '/api/hooks?workspaceId=w%201', undefined],
    ])
  })

  it('save 带当前 revision；revision 冲突时读回并抛出；诊断在 error.details', async () => {
    let revision = 1
    const { calls, fetchImpl } = fakeFetch((method, _path, body) => {
      if (method === 'PUT') {
        const request = body as { expectedRevision: number; hooks: Record<string, unknown> }
        if ('Bad' in request.hooks)
          return {
            status: 400,
            body: { error: { code: 'bad-request', message: 'x', details: { diagnostics: [{ source: 'config', code: 'unknown-event', message: 'x' }] } } },
          }
        if (request.expectedRevision !== revision) return { status: 409, body: { error: { code: 'revision-conflict', message: 'stale' } } }
        revision++
        return { status: 200, body: view(revision) }
      }
      return { status: 200, body: view(revision) }
    })
    const store = createHooksStore(httpHooksBackend(fetchImpl))
    await store.getState().load()
    await store.getState().save({ Stop: [] })
    expect(store.getState().view?.global.revision).toBe(2)
    revision = 5
    await expect(store.getState().save({ Stop: [] })).rejects.toMatchObject({ code: 'revision-conflict' })
    expect(store.getState().view?.global.revision).toBe(5)
    const bad = await store
      .getState()
      .save({ Bad: [] })
      .catch((e: unknown) => e)
    expect(bad).toBeInstanceOf(ApiError)
    expect((bad as ApiError).details).toEqual({ diagnostics: [{ source: 'config', code: 'unknown-event', message: 'x' }] })
    expect(calls.filter((c) => c.method === 'PUT').map((c) => (c.body as { expectedRevision: number }).expectedRevision)).toEqual([1, 2, 5])
  })
})
