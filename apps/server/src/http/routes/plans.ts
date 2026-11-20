// /api/sessions/:id/plan（路径相对 /api）：读取 Session 的计划阶段与活动的 Plan（GET，见 SessionPlanResponse；子 Session 为根 Session 的）。
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function plansRoutes(app: Application) {
  const r = domainRouter()
  r.get('/sessions/:id/plan', async (c) => c.json(await app.sessions.sessionPlan(c.req.param('id'))))
  return r
}
