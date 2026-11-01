import type { LspResponse, LspServerStatus, ProgressEvent } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../client/api.ts'
import { createLspStore, httpLspBackend } from './lsp-store.ts'

const status = (state: LspServerStatus['state']): LspServerStatus => ({ name: 'ts', source: 'global', extensions: ['.ts'], state, cwd: '/w' })
const view = (globalRevision: number, workspaceRevision = 0): LspResponse => ({
  enabled: true,
  global: { servers: {}, revision: globalRevision, diagnostics: [] },
  workspace: { workspaceId: 'w1', servers: {}, revision: workspaceRevision, diagnostics: [] },
  status: [status('idle')],
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

describe('lsp-store', () => {
  it('load 按会话读取；保存 Workspace 作用域带 workspaceId 与已知 revision 并读回；重启后读回', async () => {
    let revision = 3
    const { calls, fetchImpl } = fakeFetch((method) => {
      if (method === 'PUT') return ((revision = 4), { status: 200, body: view(1, 4) })
      if (method === 'POST') return { status: 204 }
      return { status: 200, body: view(1, revision) }
    })
    const store = createLspStore(httpLspBackend(fetchImpl))
    await store.getState().load({ sessionId: 's 1' })
    await store.getState().save('workspace', { ts: { command: 'tsls', extensionToLanguage: { '.ts': 'typescript' } } })
    expect(store.getState().view?.workspace?.revision).toBe(4)
    await store.getState().restart('ts', '/w')
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['GET', '/api/lsp?sessionId=s%201', undefined],
      [
        'PUT',
        '/api/lsp',
        { scope: { workspaceId: 'w1' }, servers: { ts: { command: 'tsls', extensionToLanguage: { '.ts': 'typescript' } } }, expectedRevision: 3 },
      ],
      ['GET', '/api/lsp?sessionId=s%201', undefined],
      ['POST', '/api/lsp/restart', { name: 'ts', cwd: '/w' }],
      ['GET', '/api/lsp?sessionId=s%201', undefined],
    ])
  })

  it('revision 冲突时读回并抛出；400 抛出带诊断', async () => {
    let gets = 0
    const { fetchImpl } = fakeFetch((method, _path, body) => {
      if (method === 'PUT') {
        if ((body as { servers: object }).servers && Object.keys((body as { servers: object }).servers).length === 0)
          return {
            status: 400,
            body: { error: { code: 'bad-request', message: 'bad', details: { diagnostics: [{ source: 'lsp', code: 'invalid-lsp-server', message: 'x' }] } } },
          }
        return { status: 409, body: { error: { code: 'revision-conflict', message: 'stale' } } }
      }
      gets++
      return { status: 200, body: view(gets) }
    })
    const store = createLspStore(httpLspBackend(fetchImpl))
    await store.getState().load()
    const conflict = await store
      .getState()
      .save('global', { a: { command: 'x', extensionToLanguage: { '.x': 'x' } } })
      .catch((e: unknown) => e)
    expect(conflict).toBeInstanceOf(ApiError)
    expect((conflict as ApiError).code).toBe('revision-conflict')
    expect(store.getState().view?.global.revision).toBe(2)
    const bad = (await store
      .getState()
      .save('global', {})
      .catch((e: unknown) => e)) as ApiError
    expect([bad.status, (bad.details as { diagnostics: unknown[] }).diagnostics]).toEqual([400, [{ source: 'lsp', code: 'invalid-lsp-server', message: 'x' }]])
  })

  it('lsp_update 只替换当前会话的状态', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: view(1) }))
    const store = createLspStore(httpLspBackend(fetchImpl))
    const listeners: ((p: { sessionId: string; runId: string; event: ProgressEvent }) => void)[] = []
    const off = store.getState().attach({ onProgress: (l) => (listeners.push(l), () => undefined) })
    await store.getState().load({ sessionId: 's1' })
    listeners[0]!({ sessionId: 'other', runId: '', event: { type: 'lsp_update', servers: [status('failed')] } })
    expect(store.getState().view?.status[0]?.state).toBe('idle')
    listeners[0]!({ sessionId: 's1', runId: '', event: { type: 'lsp_update', servers: [status('running')] } })
    expect(store.getState().view?.status[0]?.state).toBe('running')
    off()
  })
})
