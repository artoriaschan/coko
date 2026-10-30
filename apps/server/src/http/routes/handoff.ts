// Handoff（/api/sessions/:id/handoff）的路由（路径相对 /api）。当前为空 router：领域的实现在此登记接口。
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function handoffRoutes(_app: Application) {
  return domainRouter()
}
