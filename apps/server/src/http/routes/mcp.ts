// GET /api/mcp、PUT /api/mcp/servers、POST /api/mcp/approvals、POST /api/mcp/reconnect、GET /api/mcp/presets（路径相对 /api）。
import { McpApprovalRequest, McpReconnectRequest, UpdateMcpServersRequest } from '@coko/protocol'
import type { Application } from '../../application/index.ts'
import { body, domainRouter } from './shared.ts'

export function mcpRoutes(app: Application) {
  const r = domainRouter()
  r.get('/mcp', async (c) => c.json(await app.mcp.view(c.req.query('workspaceId') || undefined)))
  r.get('/mcp/presets', (c) => c.json(app.mcp.presets()))
  r.put('/mcp/servers', async (c) => c.json(await app.mcp.updateServers(await body(c, UpdateMcpServersRequest))))
  r.post('/mcp/approvals', async (c) => c.json(await app.mcp.approve(await body(c, McpApprovalRequest))))
  r.post('/mcp/reconnect', async (c) => c.json(await app.mcp.reconnect(await body(c, McpReconnectRequest))))
  return r
}
