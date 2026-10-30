// 定时任务（/api/schedules、/api/sessions/:id/schedules）的路由（路径相对 /api）：列表（按 Session 或全部）、新建、修改（revision）与删除。
import { CreateScheduleRequest, UpdateScheduleRequest, type ScheduleListResponse } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { body, domainRouter } from './shared.ts'

export function schedulesRoutes(app: Application) {
  const { schedules } = app
  const r = domainRouter()
  r.get('/schedules', async (c) => c.json((await schedules.list(c.req.query('sessionId') || undefined)) satisfies ScheduleListResponse))
  r.post('/sessions/:id/schedules', async (c) => c.json(await schedules.create(c.req.param('id'), await body(c, CreateScheduleRequest)), 201))
  r.patch('/schedules/:id', async (c) => c.json(await schedules.update(c.req.param('id'), await body(c, UpdateScheduleRequest))))
  r.delete('/schedules/:id', async (c) => {
    await schedules.delete(c.req.param('id'))
    return c.body(null, 204)
  })
  return r
}
