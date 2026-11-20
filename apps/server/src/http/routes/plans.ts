// /api/sessions/:id/plan（路径相对 /api）：读取 Session 的计划阶段与活动的 Plan（GET，见 SessionPlanResponse；子 Session 为根 Session 的）；
// 进入与退出规划（POST，见 PlanActionRequest；不改变 Permission Mode，ADR 0028）。
import { PlanActionRequest } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { body, domainRouter } from './shared.ts'

export function plansRoutes(app: Application) {
  const r = domainRouter()
  r.get('/sessions/:id/plan', async (c) => c.json(await app.sessions.sessionPlan(c.req.param('id'))))
  r.post('/sessions/:id/plan', async (c) => c.json(await app.sessions.planAction(c.req.param('id'), (await body(c, PlanActionRequest)).action)))
  return r
}
