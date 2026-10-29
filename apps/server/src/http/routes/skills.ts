// GET /api/skills：票 05 实现；票 01 为空 router（路径相对 /api）。
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function skillsRoutes(_app: Application) {
  return domainRouter()
}
