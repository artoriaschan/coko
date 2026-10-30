// /api/sessions/:id/jobs 与 /api/jobs/:id/…（路径相对 /api）：Job 快照、日志输出与停止。尚未接入：没有路由（请求得到 404）。
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function jobsRoutes(_app: Application) {
  return domainRouter()
}
