// /api/sessions/:id/goal（路径相对 /api）：读取 Goal 与用量、动作。尚未接入：没有路由（请求得到 404）。
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function goalsRoutes(_app: Application) {
  return domainRouter()
}
