// GET /api/workspaces/:id/files?query=&limit=：@ 菜单的文件候选（路径相对 /api）。遍历与内置 find / grep 相同，遵守忽略规则、不含 .git。
import { WORKSPACE_FILES_LIMIT } from '@coko/protocol'
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
    return c.json(await app.context.files(c.req.param('id'), c.req.query('query') ?? '', { limit, signal: c.req.raw.signal }))
  })
  return r
}
