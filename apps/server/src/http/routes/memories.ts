// /api/memories（票 09，路径相对 /api）：用户级与某个 Workspace 的记忆；手动添加的条目 source 为 user。
import { CreateMemoryRequest, MemoryListResponse, UpdateMemoryRequest } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { MemoryService } from '../../application/context/memory.ts'
import { body, domainRouter } from './shared.ts'

export function memoriesRoutes(app: Application) {
  const memories = new MemoryService(app.store)
  const r = domainRouter()
  const workspaceId = (query: string | undefined) => query || undefined
  r.get('/memories', async (c) => c.json({ memories: await memories.list(workspaceId(c.req.query('workspaceId'))) } satisfies MemoryListResponse))
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
