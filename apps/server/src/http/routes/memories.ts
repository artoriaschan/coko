// /api/memories（路径相对 /api）：用户级与某个 Workspace 的记忆；手动添加的条目 source 为 user。
// GET 带非空 query 时为检索（至多 20 条，按相关度；FTS5 不可用时按 updatedAt 倒序），否则为列表；scope 只留一种。
import { CreateMemoryRequest, MemoryListResponse, MemoryScope, UpdateMemoryRequest } from '@coko/protocol'
import { Value } from 'typebox/value'
import type { Application } from '../../application/index.ts'
import { AppError } from '../../application/errors.ts'
import { body, domainRouter } from './shared.ts'

export function memoriesRoutes(app: Application) {
  const { memories } = app
  const r = domainRouter()
  const workspaceId = (query: string | undefined) => query || undefined
  const scopeOf = (query: string | undefined): MemoryScope | undefined => {
    if (!query) return undefined
    if (!Value.Check(MemoryScope, query)) throw new AppError('bad-request', 'scope must be user or workspace')
    return query
  }
  r.get('/memories', async (c) => {
    const workspace = workspaceId(c.req.query('workspaceId'))
    const scope = scopeOf(c.req.query('scope'))
    const query = c.req.query('query')?.trim() ?? ''
    const list =
      query === ''
        ? await memories.list(workspace, scope)
        : await memories.search(query, { ...(workspace ? { workspaceId: workspace } : {}), ...(scope ? { scope } : {}) })
    return c.json({ memories: list } satisfies MemoryListResponse)
  })
  r.post('/memories', async (c) => {
    const input = await body(c, CreateMemoryRequest)
    return c.json(await memories.create({ ...input, source: 'user' }), 201)
  })
  r.put('/memories/:id', async (c) => {
    const { content } = await body(c, UpdateMemoryRequest)
    return c.json(await memories.update(c.req.param('id'), content, workspaceId(c.req.query('workspaceId'))))
  })
  r.delete('/memories/:id', async (c) => {
    await memories.delete(c.req.param('id'), workspaceId(c.req.query('workspaceId')))
    return c.body(null, 204)
  })
  return r
}
