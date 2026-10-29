// GET /api/mcp、PUT /api/mcp/servers、POST /api/mcp/approvals、POST /api/mcp/reconnect：票 07 实现；票 01 为空 router（路径相对 /api）。
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function mcpRoutes(_app: Application) {
  return domainRouter()
}
