// GET /api/skills?workspaceId=…（票 05）：该 Workspace 的 Skill 列表与诊断（路径相对 /api）。
import type { SkillListResponse } from '@coko/protocol'
import { isSkillsContribution } from '../../application/context/skills.ts'
import { AppError } from '../../application/errors.ts'
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function skillsRoutes(app: Application) {
  const r = domainRouter()
  r.get('/skills', async (c) => {
    const workspaceId = c.req.query('workspaceId') || undefined
    if (workspaceId === undefined) throw new AppError('bad-request', 'workspaceId is required')
    const workspace = await app.store.sessions.getWorkspace(workspaceId)
    if (!workspace) throw new AppError('not-found', `Workspace ${workspaceId} not found`)
    const scope = await app.context.scope({ workspaceId: workspace.id, cwd: workspace.path })
    const skills = app.context.contributions.find(isSkillsContribution)
    const body: SkillListResponse = skills ? await skills.list(scope) : { skills: [], diagnostics: [] }
    return c.json(body)
  })
  return r
}
