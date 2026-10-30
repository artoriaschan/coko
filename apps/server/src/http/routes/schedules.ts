// 定时任务（/api/schedules、/api/sessions/:id/schedules）的路由（路径相对 /api）。当前为空 router：领域的实现在此登记接口。
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function schedulesRoutes(_app: Application) {
  return domainRouter()
}
