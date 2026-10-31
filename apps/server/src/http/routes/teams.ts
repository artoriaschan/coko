// Agent Teams（/api/sessions/:id/team）的路由（路径相对 /api），ADR 0018。
import type { TeamSnapshot } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function teamsRoutes(app: Application) {
  const { teams } = app
  const r = domainRouter()
  r.get('/sessions/:id/team', async (c) => c.json((await teams.snapshot(c.req.param('id'))) satisfies TeamSnapshot))
  return r
}
