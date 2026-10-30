// GET /api/skills?workspaceId=…：该 Workspace 的 Skill 列表与诊断（路径相对 /api）。
import { AppError } from '../../application/errors.ts'
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function skillsRoutes(app: Application) {
  const r = domainRouter()
  r.get('/skills', async (c) => {
    const workspaceId = c.req.query('workspaceId') || undefined
    if (workspaceId === undefined) throw new AppError('bad-request', 'workspaceId is required')
    return c.json(await app.context.skills(await app.context.scopeFor({ workspaceId })))
  })
  return r
}
