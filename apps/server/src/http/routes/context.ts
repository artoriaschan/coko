// GET /api/sessions/:id/context、GET /api/workspaces/:id/context：上下文用量（路径相对 /api）。
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function contextRoutes(app: Application) {
  const r = domainRouter()
  r.get('/sessions/:id/context', async (c) => c.json(await app.context.contextUsage({ sessionId: c.req.param('id') })))
  r.get('/workspaces/:id/context', async (c) => c.json(await app.context.contextUsage({ workspaceId: c.req.param('id') })))
  return r
}
