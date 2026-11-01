import type { PluginInfo } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../client/api.ts'
import { createPluginsStore, httpPluginsBackend } from './plugins-store.ts'

const digest = (c: string) => c.repeat(64)

const plugin = (overrides: Partial<PluginInfo> = {}): PluginInfo => ({
  name: 'sample',
  version: '0.1.0',
  source: { kind: 'dir', location: '/src/sample' },
  status: 'needs-approval',
  digest: digest('a'),
  contributions: { skills: ['sample:greet'], commands: ['sample:hello'], agents: [] },
  executables: { hooks: [{ event: 'PreToolUse', matcher: 'Bash', command: 'node hook.mjs' }], mcpServers: [], lspServers: [] },
  diagnostics: [],
  ...overrides,
})

function fakeFetch(handler: (method: string, path: string, body: unknown) => { status: number; body?: unknown }) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  const fetchImpl = async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
    calls.push({ method, path, ...(body === undefined ? {} : { body }) })
    const reply = handler(method, path, body)
    return new Response(reply.body === undefined ? null : typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), { status: reply.status })
  }
  return { calls, fetchImpl }
}

describe('plugins-store', () => {
  it('load、install、approve、setEnabled、update、uninstall 经 /api/plugins，列表按返回的 PluginInfo 更新', async () => {
    let current = plugin()
    const { calls, fetchImpl } = fakeFetch((method, path) => {
      if (method === 'GET') return { status: 200, body: [] }
      if (method === 'POST' && path === '/api/plugins') return { status: 201, body: current }
      if (path.endsWith('/approve')) return { status: 200, body: (current = { ...current, status: 'enabled', approvedDigest: current.digest }) }
      if (method === 'PATCH') return { status: 200, body: (current = { ...current, status: 'disabled' }) }
      if (path.endsWith('/update')) return { status: 200, body: (current = { ...current, status: 'needs-approval', digest: digest('b') }) }
      if (method === 'DELETE') return { status: 204 }
      return { status: 404, body: { error: { code: 'not-found', message: 'x' } } }
    })
    const store = createPluginsStore(httpPluginsBackend(fetchImpl))
    await store.getState().load()
    expect(store.getState()).toMatchObject({ status: 'ready', plugins: [] })

    await store.getState().install({ kind: 'dir', path: '/src/sample' })
    expect(store.getState().plugins.map((p) => [p.name, p.status])).toEqual([['sample', 'needs-approval']])
    await store.getState().approve('sample', digest('a'))
    expect(store.getState().plugins[0]?.status).toBe('enabled')
    await store.getState().setEnabled('sample', false)
    expect(store.getState().plugins[0]?.status).toBe('disabled')
    // 更新后 digest 变化：报告 digestChanged，状态回到待批准。
    expect(await store.getState().update('sample')).toMatchObject({ digestChanged: true, plugin: { status: 'needs-approval' } })
    expect(store.getState().plugins[0]?.digest).toBe(digest('b'))
    await store.getState().uninstall('sample')
    expect(store.getState().plugins).toEqual([])

    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['GET', '/api/plugins', undefined],
      ['POST', '/api/plugins', { source: { kind: 'dir', path: '/src/sample' } }],
      ['POST', '/api/plugins/sample/approve', { digest: digest('a') }],
      ['PATCH', '/api/plugins/sample', { enabled: false }],
      ['POST', '/api/plugins/sample/update', undefined],
      ['DELETE', '/api/plugins/sample', undefined],
    ])
  })

  it('错误体按 ErrorResponse 校验：合法时带 code 与 details，不合法或响应不符 schema 时为 bad-response；列表保持原样', async () => {
    let reply: { status: number; body?: unknown } = { status: 200, body: [plugin({ status: 'enabled' })] }
    const { fetchImpl } = fakeFetch(() => reply)
    const store = createPluginsStore(httpPluginsBackend(fetchImpl))
    await store.getState().load()

    const diagnostics = [{ source: 'plugin', code: 'invalid-name', message: 'bad name' }]
    reply = { status: 400, body: { error: { code: 'plugin-invalid', message: 'invalid', details: { diagnostics } } } }
    const invalid = await store
      .getState()
      .install({ kind: 'git', url: 'https://example.com/p.git' })
      .catch((e: unknown) => e)
    expect(invalid).toBeInstanceOf(ApiError)
    expect(invalid).toMatchObject({ code: 'plugin-invalid', status: 400, details: { diagnostics } })

    // 错误体缺 message（不符合 ErrorResponse）：不信任其中的 code。
    reply = { status: 409, body: { error: { code: 'plugin-exists' } } }
    await expect(store.getState().install({ kind: 'dir', path: '/x' })).rejects.toMatchObject({ code: 'bad-response', status: 409 })
    reply = { status: 500, body: 'not json' }
    await expect(store.getState().setEnabled('sample', false)).rejects.toMatchObject({ code: 'bad-response', status: 500 })
    // 200 但响应不是 PluginInfo。
    reply = { status: 200, body: { name: 'sample' } }
    await expect(store.getState().setEnabled('sample', false)).rejects.toMatchObject({ code: 'bad-response' })
    expect(store.getState().plugins.map((p) => p.status)).toEqual(['enabled'])

    // 读取失败：有内容时保留内容并记下错误；没有内容时为 error。
    reply = { status: 500, body: { error: { code: 'internal', message: 'boom' } } }
    await store.getState().load()
    expect(store.getState()).toMatchObject({ status: 'ready', error: { code: 'internal' } })
    expect(store.getState().plugins).toHaveLength(1)
    const empty = createPluginsStore(httpPluginsBackend(fetchImpl))
    await empty.getState().load()
    expect(empty.getState()).toMatchObject({ status: 'error', plugins: [], error: { code: 'internal' } })
  })

  it('批准时 digest 已变化（409 digest-mismatch）：读回列表并抛出', async () => {
    let listed = plugin()
    const { calls, fetchImpl } = fakeFetch((method, path) => {
      if (path.endsWith('/approve')) {
        listed = plugin({ digest: digest('c') })
        return { status: 409, body: { error: { code: 'digest-mismatch', message: 'changed', details: { digest: digest('c') } } } }
      }
      return { status: 200, body: [listed] }
    })
    const store = createPluginsStore(httpPluginsBackend(fetchImpl))
    await store.getState().load()
    await expect(store.getState().approve('sample', digest('a'))).rejects.toMatchObject({ code: 'digest-mismatch' })
    expect(store.getState().plugins[0]?.digest).toBe(digest('c'))
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST', 'GET'])
  })
})
