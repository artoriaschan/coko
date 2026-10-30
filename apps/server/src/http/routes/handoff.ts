// 交接（docs/subsystems/handoff.md）的路由（路径相对 /api）：POST /sessions/:id/handoff → 202 { runId }。
import { HandoffRequest } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { body, domainRouter } from './shared.ts'

export function handoffRoutes(app: Application) {
  const r = domainRouter()
  r.post('/sessions/:id/handoff', async (c) => c.json(await app.handoff.start(c.req.param('id'), await body(c, HandoffRequest)), 202))
  return r
}
