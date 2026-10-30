// GET /api/commands?sessionId=… | workspaceId=…：该 Workspace 的命令目录与诊断（路径相对 /api）。
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function commandsRoutes(app: Application) {
  const r = domainRouter()
  r.get('/commands', async (c) => {
    const scope = await app.context.scopeFor({ sessionId: c.req.query('sessionId') || undefined, workspaceId: c.req.query('workspaceId') || undefined })
    return c.json(await app.context.commands(scope))
  })
  return r
}
