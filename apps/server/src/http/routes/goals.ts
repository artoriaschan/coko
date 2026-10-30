// /api/sessions/:id/goal（路径相对 /api）：读取当前 Goal 与已用量（GET）、用户的动作（POST，见 GoalActionRequest）。
import { GoalActionRequest } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { body, domainRouter } from './shared.ts'

export function goalsRoutes(app: Application) {
  const { goals } = app
  const r = domainRouter()
  r.get('/sessions/:id/goal', async (c) => c.json(await goals.get(c.req.param('id'))))
  r.post('/sessions/:id/goal', async (c) => c.json(await goals.act(c.req.param('id'), await body(c, GoalActionRequest))))
  return r
}
