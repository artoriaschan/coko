// GET /api/workspaces/:id/files?query=&limit=（票 06）：@ 菜单的文件候选（路径相对 /api）。遍历与内置 find / grep 相同，遵守忽略规则、不含 .git。
import { searchWorkspaceFiles } from '@coko/agent'
import { WORKSPACE_FILES_LIMIT, type WorkspaceFilesResponse } from '@coko/protocol'
import { AppError } from '../../application/errors.ts'
import type { Application } from '../../application/index.ts'
import { domainRouter } from './shared.ts'

export function filesRoutes(app: Application) {
  const r = domainRouter()
  r.get('/workspaces/:id/files', async (c) => {
    const raw = c.req.query('limit')
    const limit = raw === undefined || raw === '' ? WORKSPACE_FILES_LIMIT : Number(raw)
    if (!Number.isInteger(limit) || limit < 1 || limit > WORKSPACE_FILES_LIMIT)
      throw new AppError('bad-request', `limit must be an integer between 1 and ${WORKSPACE_FILES_LIMIT}`)
    const workspace = await app.store.sessions.getWorkspace(c.req.param('id'))
    if (!workspace) throw new AppError('not-found', `Workspace ${c.req.param('id')} not found`)
    const files = await searchWorkspaceFiles(workspace.path, c.req.query('query') ?? '', { limit, signal: c.req.raw.signal })
    const body: WorkspaceFilesResponse = { files }
    return c.json(body)
  })
  return r
}
